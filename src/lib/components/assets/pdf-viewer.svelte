<script lang="ts">
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { readVaultFile } from '$lib/services/assets';
	import { createLogger } from '$lib/services/logger.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';

	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import ColumnsIcon from '@lucide/svelte/icons/columns-2';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import FileTextIcon from '@lucide/svelte/icons/file-text';

	import { onMount } from 'svelte';
	import type {
		PDFDocumentLoadingTask,
		PDFDocumentProxy,
		PDFWorker,
		RenderTask
	} from 'pdfjs-dist/legacy/build/pdf.mjs';

	interface Props {
		filePath?: string | null;
		pdfBytes?: Uint8Array | null;
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
		targetPage?: number | null;
	}

	type PdfJsLike = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

	let pdfjs: PdfJsLike | null = null;
	let pdfWorker: Worker | null = null;
	let pdfJsWorker: PDFWorker | null = null;
	let pdfjsReady: Promise<void> | null = null;
	let viewerDisposed = false;
	let pendingPdfCleanup: Promise<void> = Promise.resolve();
	const log = createLogger('viewer.pdf');

	async function ensurePdfWorker() {
		if (pdfjs) return;
		if (pdfjsReady) return pdfjsReady;

		pdfjsReady = (async () => {
			const [pdfjsLib, { default: PdfJsWorker }] = await Promise.all([
				import('pdfjs-dist/legacy/build/pdf.mjs'),
				import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker')
			]);
			if (viewerDisposed) return;
			pdfjs = pdfjsLib;
			pdfWorker = new PdfJsWorker();
			// Loading tasks own their document transport, never the reused worker.
			pdfJsWorker = pdfjs.PDFWorker.create({ port: pdfWorker });
		})();

		return pdfjsReady;
	}

	let {
		filePath = null,
		pdfBytes = null,
		expanded = $bindable(false),
		allowExpand = true,
		detached = false,
		targetPage = null
	}: Props = $props();

	// ── State ─────────────────────────────────────────────────────────
	let viewportRef: HTMLDivElement | undefined = $state();
	let canvasRef: HTMLCanvasElement | undefined = $state();
	let loading = $state(true);
	let error = $state(false);

	let pdfDoc: PDFDocumentProxy | null = $state(null);
	let currentPage = $state(1);
	let totalPages = $state(0);
	let rotation = $state(0);

	// Zoom — 5% increments from 25% to 400%
	const ZOOM_STEPS = Array.from({ length: 76 }, (_, i) => +(0.25 + i * 0.05).toFixed(2));
	const MIN_ZOOM = ZOOM_STEPS[0];
	const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

	let fitMode: 'page' | 'width' | null = $state('page');
	let manualScale = $state(1.0);
	let displayScale = $state(1.0);
	let renderedScale = $state(1.0);

	// CSS zoom bridging — instant visual zoom while PDF.js re-renders in the background.
	// When displayScale changes (user zooms), the canvas is CSS-scaled immediately.
	// When renderPage() completes, renderedScale catches up and cssZoom resets to 1.
	const cssZoom = $derived(Math.max(0.01, renderedScale > 0 ? displayScale / renderedScale : 1));

	// Pan
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let panStartX = 0;
	let panStartY = 0;

	// Render management
	let activeRenderTask: RenderTask | null = null;
	let renderGeneration = 0;
	let renderDebounceId: ReturnType<typeof setTimeout> | null = null;
	let resizeFrameId: number | null = null;
	let pendingResizeWidth = 0;
	let pendingResizeHeight = 0;
	let lastResizeWidth = 0;
	let lastResizeHeight = 0;

	const zoomPercent = $derived(Math.round(displayScale * 100));

	function flushResize() {
		resizeFrameId = null;
		const width = pendingResizeWidth;
		const height = pendingResizeHeight;
		if (width === 0 || height === 0) return;
		if (width === lastResizeWidth && height === lastResizeHeight) return;
		lastResizeWidth = width;
		lastResizeHeight = height;
		if (pdfDoc && fitMode) scheduleRender(100);
	}

	function scheduleResize(width: number, height: number) {
		pendingResizeWidth = width;
		pendingResizeHeight = height;
		if (resizeFrameId !== null) return;
		resizeFrameId = requestAnimationFrame(() => flushResize());
	}

	// ── DOM setup (wheel + resize observer) ─────────────────────────
	onMount(() => {
		viewportRef?.addEventListener('wheel', handleWheel, { passive: false });

		// Re-render when container resizes (expand/collapse, window resize, pane drag)
		const ro = new ResizeObserver((entries) => {
			const entry = entries.at(-1);
			if (!entry) return;
			const width = Math.max(0, Math.round(entry.contentRect.width));
			const height = Math.max(0, Math.round(entry.contentRect.height));
			scheduleResize(width, height);
		});
		if (viewportRef) ro.observe(viewportRef);

		return () => {
			viewerDisposed = true;
			viewportRef?.removeEventListener('wheel', handleWheel);
			ro.disconnect();
			if (resizeFrameId !== null) {
				cancelAnimationFrame(resizeFrameId);
				resizeFrameId = null;
			}
			if (renderDebounceId) clearTimeout(renderDebounceId);
			cancelRender();
			void (async () => {
				await pdfjsReady?.catch(() => {});
				await pendingPdfCleanup;
				pdfJsWorker?.destroy();
				pdfWorker?.terminate();
			})();
		};
	});

	// ── Load PDF (reactive — re-runs when the source changes) ─────────
	$effect(() => {
		const path = filePath;
		const sourceBytes = pdfBytes;
		const viewport = viewportRef;
		if (!viewport) return;
		let disposed = false;
		let loadingTask: PDFDocumentLoadingTask | null = null;
		let cleanupPromise: Promise<void> | null = null;
		function disposeLoadingTask(): Promise<void> {
			if (!loadingTask) return Promise.resolve();
			if (!cleanupPromise) {
				cleanupPromise = loadingTask.destroy().catch((error) => {
					log.warn('PDF cleanup failed', { error });
				});
				pendingPdfCleanup = Promise.all([pendingPdfCleanup, cleanupPromise]).then(() => {});
			}
			return cleanupPromise;
		}

		// Cancel anything in-flight from the previous file
		if (renderDebounceId) {
			clearTimeout(renderDebounceId);
			renderDebounceId = null;
		}
		cancelRender();

		// Reset viewer state for the new file
		loading = true;
		error = false;
		currentPage = 1;
		rotation = 0;
		panX = 0;
		panY = 0;
		fitMode = 'page';
		pdfDoc = null;
		totalPages = 0;
		renderedScale = 1.0;
		displayScale = 1.0;

		(async () => {
			try {
				const bytes = sourceBytes
					? new Uint8Array(sourceBytes)
					: path
						? new Uint8Array(await readVaultFile(path))
						: null;
				if (disposed) return;
				if (!bytes) {
					throw new Error('PDF viewer requires filePath or pdfBytes');
				}
				await ensurePdfWorker();
				if (disposed) return;
				if (!pdfjs || !pdfJsWorker) throw new Error('PDF.js failed to initialize');
				loadingTask = pdfjs.getDocument({
					data: bytes,
					worker: pdfJsWorker,
					useWasm: false,
					verbosity: pdfjs.VerbosityLevel.ERRORS
				});
				const loadedPdfDoc = await loadingTask.promise;
				if (disposed) return;
				pdfDoc = loadedPdfDoc;
				totalPages = loadedPdfDoc.numPages;
				loading = false;
				await renderPage();
			} catch (e) {
				if (disposed) return;
				log.error('Load failed', { path: path ?? '[in-memory bytes]', error: e });
				error = true;
				loading = false;
				await disposeLoadingTask();
			}
		})();
		return () => {
			disposed = true;
			if (renderDebounceId) {
				clearTimeout(renderDebounceId);
				renderDebounceId = null;
			}
			cancelRender();
			pdfDoc = null;
			void disposeLoadingTask();
		};
	});

	$effect(() => {
		if (!pdfDoc || loading || error || !targetPage || totalPages === 0) return;
		const nextPage = Math.max(1, Math.min(totalPages, targetPage));
		if (currentPage === nextPage) return;
		currentPage = nextPage;
		panX = 0;
		panY = 0;
		void renderPage();
	});

	// ── Cancel in-progress render ────────────────────────────────────
	function cancelRender() {
		renderGeneration++;
		if (activeRenderTask) {
			try {
				activeRenderTask.cancel();
			} catch {
				// A completed render may already have released its resources.
			} finally {
				activeRenderTask = null;
			}
		}
	}

	function isRenderingCancelled(error: unknown): error is { name: string } {
		return (
			typeof error === 'object' &&
			error !== null &&
			'name' in error &&
			(error as { name?: unknown }).name === 'RenderingCancelledException'
		);
	}

	// ── Debounced render — fires after zoom gestures settle ──────────
	function scheduleRender(delay = 200) {
		if (renderDebounceId) clearTimeout(renderDebounceId);
		renderDebounceId = setTimeout(() => {
			renderDebounceId = null;
			renderPage();
		}, delay);
	}

	// ── Render ────────────────────────────────────────────────────────
	async function renderPage() {
		if (!pdfDoc || !viewportRef || !canvasRef) return;

		// Cancel any in-progress render so we don't waste cycles
		cancelRender();
		const generation = renderGeneration;
		const document = pdfDoc;
		const canvas = canvasRef;
		let renderTask: RenderTask | null = null;

		try {
			const page = await document.getPage(currentPage);
			if (generation !== renderGeneration || document !== pdfDoc || canvas !== canvasRef) return;
			const baseViewport = page.getViewport({ scale: 1.0, rotation });
			const rect = viewportRef.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;

			// Toolbar height ~40px, leave some padding
			const availW = Math.max(1, rect.width - 16);
			const availH = Math.max(1, rect.height - 56);

			let scale: number;
			if (fitMode === 'page') {
				scale = Math.min(availW / baseViewport.width, availH / baseViewport.height);
			} else if (fitMode === 'width') {
				scale = availW / baseViewport.width;
			} else {
				scale = manualScale;
			}

			displayScale = scale;
			const viewport = page.getViewport({ scale: scale * dpr, rotation });

			canvasRef.width = viewport.width;
			canvasRef.height = viewport.height;
			canvasRef.style.width = `${viewport.width / dpr}px`;
			canvasRef.style.height = `${viewport.height / dpr}px`;

			renderTask = page.render({ canvas: canvasRef, viewport });
			activeRenderTask = renderTask;

			await renderTask.promise;
			if (generation !== renderGeneration) return;

			// Canvas is now rendered at this scale — CSS zoom bridging resets to 1
			renderedScale = scale;
		} catch (e: unknown) {
			// Expected when we cancel a render — just ignore
			if (generation !== renderGeneration || isRenderingCancelled(e)) return;
			log.error('Render failed', e);
		} finally {
			if (activeRenderTask === renderTask) activeRenderTask = null;
		}
	}

	// ── Page Navigation ───────────────────────────────────────────────
	function prevPage() {
		if (currentPage > 1) {
			currentPage--;
			panX = 0;
			panY = 0;
			renderPage();
		}
	}

	function nextPage() {
		if (currentPage < totalPages) {
			currentPage++;
			panX = 0;
			panY = 0;
			renderPage();
		}
	}

	// ── Zoom ──────────────────────────────────────────────────────────
	function zoomIn() {
		fitMode = null;
		const next = ZOOM_STEPS.find((s) => s > displayScale);
		manualScale = next ?? MAX_ZOOM;
		displayScale = manualScale;
		// CSS zoom gives instant visual feedback; re-render sharpens text
		renderPage();
	}

	function zoomOut() {
		fitMode = null;
		const prev = [...ZOOM_STEPS].reverse().find((s) => s < displayScale);
		manualScale = prev ?? MIN_ZOOM;
		displayScale = manualScale;
		renderPage();
	}

	function fitPage() {
		fitMode = 'page';
		panX = 0;
		panY = 0;
		renderPage();
	}

	function fitWidth() {
		fitMode = 'width';
		panX = 0;
		panY = 0;
		renderPage();
	}

	function rotateCw() {
		rotation = (rotation + 90) % 360;
		renderPage();
	}

	function resetView() {
		panX = 0;
		panY = 0;
		fitMode = 'page';
		renderPage();
	}

	// ── Expand / Collapse (hides sibling form pane) ─────────────────
	function toggleExpand() {
		expanded = !expanded;
		// ResizeObserver handles re-render after layout settles
	}

	// ── Scroll wheel / trackpad pinch zoom ───────────────────────────
	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) {
			// Native trackpad panning (e.g. 2-finger scroll)
			if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
				e.preventDefault();
				panX -= e.deltaX;
				panY -= e.deltaY;
			}
			return;
		}

		e.preventDefault();

		const zoomFactor = 1 - e.deltaY * 0.005;
		const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, displayScale * zoomFactor));
		const ratio = newScale / displayScale;

		// Adjust pan so the point under the cursor stays fixed
		if (viewportRef) {
			const rect = viewportRef.getBoundingClientRect();
			const cx = e.clientX - rect.left - rect.width / 2;
			const cy = e.clientY - rect.top - rect.height / 2;
			panX = cx - (cx - panX) * ratio;
			panY = cy - (cy - panY) * ratio;
		}

		fitMode = null;
		displayScale = newScale;
		manualScale = displayScale;

		// Debounce the actual PDF re-render until the gesture settles
		scheduleRender();
	}

	// ── Pan / Drag ────────────────────────────────────────────────────
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
	<!-- Toolbar (hidden during loading/error) -->
	{#if !loading && !error}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<!-- Page Navigation -->
			<div class="flex items-center gap-1">
				<TooltipIconButton
					tooltip="Previous page"
					variant="ghost"
					size="icon-xs"
					onclick={prevPage}
					disabled={currentPage <= 1}
				>
					<ChevronLeftIcon class="size-3.5" />
				</TooltipIconButton>
				<Meta as="span" class="min-w-16 text-center tabular-nums">
					{currentPage} / {totalPages}
				</Meta>
				<TooltipIconButton
					tooltip="Next page"
					variant="ghost"
					size="icon-xs"
					onclick={nextPage}
					disabled={currentPage >= totalPages}
				>
					<ChevronRightIcon class="size-3.5" />
				</TooltipIconButton>
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
					tooltip="Fit page"
					variant={fitMode === 'page' ? 'secondary' : 'ghost'}
					size="icon-xs"
					onclick={fitPage}
				>
					<MaximizeIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton
					tooltip="Fit width"
					variant={fitMode === 'width' ? 'secondary' : 'ghost'}
					size="icon-xs"
					onclick={fitWidth}
				>
					<ColumnsIcon class="size-3.5" />
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

	<!-- Canvas viewport — always in DOM so canvasRef is available immediately -->
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
		<canvas
			bind:this={canvasRef}
			class="absolute select-none"
			style:top="50%"
			style:left="50%"
			style:transform={`translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${cssZoom})`}
			style:will-change="transform"
		></canvas>
	</div>

	<!-- Loading / Error overlays -->
	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<Text tone="muted" class="animate-pulse">Loading PDF…</Text>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<FileTextIcon class="muted size-16 stroke-1" />
				<Text tone="muted">Could not load PDF document</Text>
			</div>
		</div>
	{/if}
</div>
