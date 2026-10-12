<script lang="ts">
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { getAssetUrl } from '$lib/services/assets';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';

	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';

	import { onMount, tick } from 'svelte';

	interface Props {
		filePath?: string;
		srcUrl?: string | null;
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
		/**
		 * When true, renders the image in an <object> tag instead of <img>.
		 * Used for SVG content where vector rendering avoids pixelation at
		 * zoom levels > 100%.
		 */
		useObjectTag?: boolean;
		locator?: Record<string, unknown> | null;
	}

	let {
		filePath = '',
		srcUrl = null,
		expanded = $bindable(false),
		allowExpand = true,
		detached = false,
		useObjectTag = false,
		locator = null
	}: Props = $props();

	// ── State ─────────────────────────────────────────────────────────
	let viewportRef: HTMLDivElement | undefined = $state();
	let imgRef: HTMLImageElement | undefined = $state();
	let objRef: HTMLObjectElement | undefined = $state();
	let loading = $state(true);
	let error = $state(false);

	let showOverlays = $state(true);

	interface ParsedLocator {
		box?: { ymin: number; xmin: number; ymax: number; xmax: number };
		points?: { y: number; x: number }[];
		observation?: string;
		confidence?: 'low' | 'medium' | 'high';
	}

	const parsedLocator = $derived.by<ParsedLocator | null>(() => {
		if (!locator) return null;

		interface LocatorData {
			box?: unknown;
			points?: unknown;
			observation?: unknown;
			confidence?: unknown;
			locator?: unknown;
			summary?: unknown;
		}

		const raw = locator as unknown as LocatorData;
		const nested = raw.locator as LocatorData | undefined;
		const target = raw.box || raw.points ? raw : nested || {};

		const box = target.box;
		const points = target.points;
		const observation =
			typeof target.observation === 'string'
				? target.observation
				: typeof raw.summary === 'string'
					? raw.summary
					: undefined;
		const confidence =
			target.confidence === 'low' || target.confidence === 'medium' || target.confidence === 'high'
				? target.confidence
				: 'medium';

		const result: ParsedLocator = { observation, confidence };

		if (Array.isArray(box) && box.length === 4) {
			const [ymin, xmin, ymax, xmax] = box.map(Number);
			if (!isNaN(ymin) && !isNaN(xmin) && !isNaN(ymax) && !isNaN(xmax)) {
				result.box = { ymin, xmin, ymax, xmax };
			}
		}

		if (Array.isArray(points)) {
			const parsedPoints: { y: number; x: number }[] = [];
			for (const pt of points) {
				if (Array.isArray(pt) && pt.length === 2) {
					const [y, x] = pt.map(Number);
					if (!isNaN(y) && !isNaN(x)) {
						parsedPoints.push({ y, x });
					}
				}
			}
			if (parsedPoints.length > 0) {
				result.points = parsedPoints;
			}
		}

		return result.box || result.points ? result : null;
	});

	let naturalWidth = $state(0);
	let naturalHeight = $state(0);

	// Zoom — multiplicative 1.2x steps, range 10%-2000%
	const MIN_ZOOM = 0.1;
	const MAX_ZOOM = 20;
	const ZOOM_STEP = 1.2;

	let fitMode: 'contain' | null = $state('contain');
	let scale = $state(1.0);
	let fitScale = $state(1.0);
	let rotation = $state(0);

	const displayScale = $derived(fitMode === 'contain' ? fitScale : scale);
	const zoomPercent = $derived(Math.round(displayScale * 100));

	// Pan
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let panStartX = 0;
	let panStartY = 0;
	let resizeFrameId: number | null = null;
	let pendingResizeWidth = 0;
	let pendingResizeHeight = 0;
	let lastResizeWidth = 0;
	let lastResizeHeight = 0;

	const imgSrc = $derived(srcUrl ?? getAssetUrl(filePath));

	function flushResize() {
		resizeFrameId = null;
		const width = pendingResizeWidth;
		const height = pendingResizeHeight;
		if (width === 0 || height === 0) return;
		if (width === lastResizeWidth && height === lastResizeHeight) return;
		lastResizeWidth = width;
		lastResizeHeight = height;
		if (fitMode) calcFitScale();
	}

	function scheduleResize(width: number, height: number) {
		pendingResizeWidth = width;
		pendingResizeHeight = height;
		if (resizeFrameId !== null) return;
		resizeFrameId = requestAnimationFrame(() => flushResize());
	}

	// ── Fit calculation ──────────────────────────────────────────────
	function calcFitScale() {
		if (!viewportRef) return;

		// For vector SVG in <object> tag, the viewBox + preserveAspectRatio
		// handles fitting naturally — no CSS scale adjustment needed.
		if (useObjectTag) {
			fitScale = 1;
			return;
		}

		if (!naturalWidth || !naturalHeight) return;
		const rect = viewportRef.getBoundingClientRect();
		const availW = Math.max(1, rect.width - 16);
		const availH = Math.max(1, rect.height - 56);

		// Account for rotation — 90/270 swap w/h
		const isRotated = rotation % 180 !== 0;
		const w = isRotated ? naturalHeight : naturalWidth;
		const h = isRotated ? naturalWidth : naturalHeight;

		fitScale = Math.min(availW / w, availH / h, 1);
	}

	// ── DOM setup ────────────────────────────────────────────────────
	onMount(() => {
		viewportRef?.addEventListener('wheel', handleWheel, { passive: false });

		const ro = new ResizeObserver((entries) => {
			const entry = entries.at(-1);
			if (!entry) return;
			const width = Math.max(0, Math.round(entry.contentRect.width));
			const height = Math.max(0, Math.round(entry.contentRect.height));
			scheduleResize(width, height);
		});
		if (viewportRef) ro.observe(viewportRef);

		return () => {
			viewportRef?.removeEventListener('wheel', handleWheel);
			ro.disconnect();
			if (resizeFrameId !== null) {
				cancelAnimationFrame(resizeFrameId);
				resizeFrameId = null;
			}
		};
	});

	// ── Reload when the rendered image source changes ────────────────
	$effect(() => {
		void imgSrc;
		loading = true;
		error = false;
		rotation = 0;
		panX = 0;
		panY = 0;
		fitMode = 'contain';
		scale = 1.0;
		naturalWidth = 0;
		naturalHeight = 0;
	});

	async function handleLoad() {
		if (useObjectTag && objRef?.contentDocument) {
			// For vector SVG in <object>, read viewBox for aspect ratio
			const svg = objRef.contentDocument.querySelector('svg');
			if (svg) {
				const vb = svg.getAttribute('viewBox');
				if (vb) {
					const parts = vb.split(/[\s,]+/).map(Number);
					if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
						naturalWidth = parts[2];
						naturalHeight = parts[3];
					}
				}
			}
		} else if (imgRef) {
			naturalWidth = imgRef.naturalWidth;
			naturalHeight = imgRef.naturalHeight;
		}
		loading = false;
		// Wait for Svelte DOM update + browser layout before measuring container
		await tick();
		requestAnimationFrame(() => calcFitScale());
	}

	function handleError() {
		error = true;
		loading = false;
	}

	function handleObjectLoad() {
		void handleLoad();
	}

	function handleObjectError() {
		handleError();
	}

	// ── Zoom ─────────────────────────────────────────────────────────
	function zoomIn() {
		fitMode = null;
		scale = Math.min(MAX_ZOOM, displayScale * ZOOM_STEP);
	}

	function zoomOut() {
		fitMode = null;
		scale = Math.max(MIN_ZOOM, displayScale / ZOOM_STEP);
	}

	function fitContain() {
		fitMode = 'contain';
		panX = 0;
		panY = 0;
		calcFitScale();
	}

	function rotateCw() {
		rotation = (rotation + 90) % 360;
		if (fitMode) calcFitScale();
	}

	function resetView() {
		panX = 0;
		panY = 0;
		rotation = 0;
		fitMode = 'contain';
		calcFitScale();
	}

	function toggleExpand() {
		expanded = !expanded;
	}

	// ── Scroll wheel / trackpad ─────────────────────────────────────
	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) {
			if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
				e.preventDefault();
				panX -= e.deltaX;
				panY -= e.deltaY;
			}
			return;
		}

		e.preventDefault();

		const zoomFactor = 1 - e.deltaY * 0.005;
		const oldScale = displayScale;
		const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldScale * zoomFactor));
		const ratio = newScale / oldScale;

		if (viewportRef) {
			const rect = viewportRef.getBoundingClientRect();
			const cx = e.clientX - rect.left - rect.width / 2;
			const cy = e.clientY - rect.top - rect.height / 2;
			panX = cx - (cx - panX) * ratio;
			panY = cy - (cy - panY) * ratio;
		}

		fitMode = null;
		scale = newScale;
	}

	// ── Pan / Drag ──────────────────────────────────────────────────
	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		isDragging = true;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		panStartX = panX;
		panStartY = panY;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		panX = panStartX + (e.clientX - dragStartX);
		panY = panStartY + (e.clientY - dragStartY);
	}

	function handlePointerUp() {
		isDragging = false;
	}
</script>

<div
	class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
	style="background: var(--preview-bg, transparent);"
	tabindex="-1"
	dir="ltr"
>
	<!-- Toolbar -->
	{#if !loading && !error}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<!-- Dimensions -->
			<div class="flex items-center gap-1">
				<Meta as="span" class="min-w-16 text-center tabular-nums">
					{Math.round(naturalWidth)} &times; {Math.round(naturalHeight)}
				</Meta>
			</div>

			<!-- Zoom Controls -->
			<div class="flex items-center gap-1">
				<TooltipIconButton
					tooltip="Zoom out"
					variant="ghost"
					size="icon-xs"
					onclick={zoomOut}
					disabled={displayScale <= MIN_ZOOM}
				>
					<ZoomOutIcon class="size-3.5" />
				</TooltipIconButton>
				<Meta as="span" class="min-w-12 text-center tabular-nums">
					{zoomPercent}%
				</Meta>
				<TooltipIconButton
					tooltip="Zoom in"
					variant="ghost"
					size="icon-xs"
					onclick={zoomIn}
					disabled={displayScale >= MAX_ZOOM}
				>
					<ZoomInIcon class="size-3.5" />
				</TooltipIconButton>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<TooltipIconButton
					tooltip="Fit to view"
					variant={fitMode === 'contain' ? 'secondary' : 'ghost'}
					size="icon-xs"
					onclick={fitContain}
				>
					<MaximizeIcon class="size-3.5" />
				</TooltipIconButton>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-1">
				<TooltipIconButton tooltip="Reset view" variant="ghost" size="icon-xs" onclick={resetView}>
					<CrosshairIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton tooltip="Rotate" variant="ghost" size="icon-xs" onclick={rotateCw}>
					<RotateCwIcon class="size-3.5" />
				</TooltipIconButton>
				{#if parsedLocator}
					<TooltipIconButton
						tooltip={showOverlays ? 'Hide overlays' : 'Show overlays'}
						variant={showOverlays ? 'secondary' : 'ghost'}
						size="icon-xs"
						onclick={() => (showOverlays = !showOverlays)}
					>
						{#if showOverlays}
							<EyeIcon class="size-3.5" />
						{:else}
							<EyeOffIcon class="size-3.5" />
						{/if}
					</TooltipIconButton>
				{/if}
				{#if allowExpand && !detached}
					<TooltipIconButton
						tooltip={expanded ? 'Collapse' : 'Expand'}
						variant="ghost"
						size="icon-xs"
						onclick={toggleExpand}
					>
						{#if expanded}
							<Minimize2Icon class="size-3.5" />
						{:else}
							<Maximize2Icon class="size-3.5" />
						{/if}
					</TooltipIconButton>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Image viewport -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={viewportRef}
		class="relative min-h-0 min-w-0 flex-1 cursor-grab overflow-hidden {isDragging
			? 'cursor-grabbing'
			: ''} {loading || error ? 'invisible' : ''}"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
		{#if useObjectTag && imgSrc}
			<object
				bind:this={objRef}
				data={imgSrc}
				type="image/svg+xml"
				class="absolute select-none"
				aria-label="Drawing preview"
				style:top="50%"
				style:left="50%"
				style:width="100%"
				style:height="100%"
				style:transform={`translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${displayScale}) rotate(${rotation}deg)`}
				style:will-change="transform"
				style:transform-origin="center center"
				style:pointer-events="none"
				onload={handleObjectLoad}
				onerror={handleObjectError}
			></object>
		{:else}
			<img
				bind:this={imgRef}
				src={imgSrc}
				alt=""
				class="absolute select-none"
				style:top="50%"
				style:left="50%"
				style:transform={`translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${displayScale}) rotate(${rotation}deg)`}
				style:will-change="transform"
				style:transform-origin="center center"
				style:image-rendering="high-quality"
				onload={handleLoad}
				onerror={handleError}
				draggable="false"
			/>
		{/if}
		{#if !loading && !error && parsedLocator && showOverlays && naturalWidth > 0 && naturalHeight > 0}
			<svg
				class="pointer-events-none absolute select-none"
				style:top="50%"
				style:left="50%"
				style:width="{naturalWidth}px"
				style:height="{naturalHeight}px"
				style:transform={`translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${displayScale}) rotate(${rotation}deg)`}
				style:will-change="transform"
				style:transform-origin="center center"
				viewBox="0 0 1000 1000"
			>
				{#if parsedLocator.box}
					{@const { ymin, xmin, ymax, xmax } = parsedLocator.box}
					<rect
						x={xmin}
						y={ymin}
						width={xmax - xmin}
						height={ymax - ymin}
						fill={parsedLocator.confidence === 'high'
							? 'color-mix(in srgb, var(--success) 12%, transparent)'
							: parsedLocator.confidence === 'low'
								? 'color-mix(in srgb, var(--error) 12%, transparent)'
								: 'color-mix(in srgb, var(--warning) 12%, transparent)'}
						stroke={parsedLocator.confidence === 'high'
							? 'var(--success)'
							: parsedLocator.confidence === 'low'
								? 'var(--error)'
								: 'var(--warning)'}
						stroke-width="2.5"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
				{#if parsedLocator.points}
					{@const pts = parsedLocator.points}
					<polyline
						points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
						fill="none"
						stroke="var(--brand)"
						stroke-width="3"
						stroke-dasharray="6,4"
						vector-effect="non-scaling-stroke"
					/>
					{#each pts as p, idx (`${p.x},${p.y}-${idx}`)}
						<circle
							cx={p.x}
							cy={p.y}
							r="5"
							fill="var(--brand)"
							stroke="var(--background)"
							stroke-width="1.5"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
				{/if}
			</svg>
		{/if}
	</div>

	<!-- Loading / Error overlays -->
	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<Text tone="muted" class="animate-pulse">Loading image...</Text>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<ImageIcon class="muted size-16 stroke-1" />
				<Text tone="muted">Could not load image</Text>
			</div>
		</div>
	{/if}
</div>
