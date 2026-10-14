<script lang="ts">
	import BoxIcon from '@lucide/svelte/icons/box';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import HandIcon from '@lucide/svelte/icons/hand';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import SquareIcon from '@lucide/svelte/icons/square';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LockIcon from '@lucide/svelte/icons/lock';
	import LockOpenIcon from '@lucide/svelte/icons/lock-open';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import MoveIcon from '@lucide/svelte/icons/move';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CopyPlusIcon from '@lucide/svelte/icons/copy-plus';

	import { createLogger } from '$lib/services/logger.js';
	import { readPreviewSourceFile } from '$lib/services/derived-previews.js';
	import { Text } from '$lib/components/primitives/index.js';
	import { appState } from '$lib/state/app.svelte.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { AcEdOpenMode } from '@mlightcad/cad-simple-viewer';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { toast } from 'svelte-sonner';
	import {
		initCadViewer,
		openCadDocument,
		cadZoomExtents,
		cadPan,
		cadRegen,
		cadSwitchBackground,
		cadToggleLineWeight,
		cadMeasureDistance,
		cadMeasureArea,
		cadMeasureAngle,
		cadMeasureArc,
		cadDimlinear,
		cadExportPng,
		cadExportSvg,
		cadExportDxf,
		cadErase,
		cadCopy,
		cadMove,
		cadRotate,
		cadOffset,
		cadIsolateLayers,
		cadUnisolateLayers,
		cadThawAllLayers,
		cadLayerOn,
		getAllLayers,
		toggleLayerVisibility,
		toggleLayerLock,
		cadSelect,
		cadInstallTrackpadPan,
		getCadLineWeightEnabled,
		getInstance,
		getEntityById,
		cadSelectAllOnLayer,
		destroyCadViewer,
		cadResize
	} from '$lib/services/cad-viewer-service.js';
	import type { LayerInfo, EntityInfo } from '$lib/services/cad-viewer-service.js';

	interface Props {
		filePath: string;
		fileSource?: 'vault' | 'appLocal';
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
	}

	let {
		filePath,
		fileSource = 'vault',
		expanded = $bindable(false),
		allowExpand = true,
		detached = false
	}: Props = $props();

	let containerRef: HTMLDivElement | undefined = $state();
	let loading = $state(true);
	let error = $state(false);
	let lineWeightOn = $state(false);
	let retryCounter = $state(0);
	// Plain let — only used as a lifecycle guard in effects, never drives template rendering
	let mounted = false;
	let panActive = $state(false);
	let selectActive = $state(true);
	let selectedCount = $state(0);
	let entityInfo: EntityInfo | null = $state(null);
	const log = createLogger('viewer.cad-2d');

	/** Layer list for the panel — refreshed when viewer mounts or dropdown opens. */
	let layers: LayerInfo[] = $state([]);

	function refreshLayers(): void {
		if (!mounted) {
			layers = [];
			return;
		}
		layers = getAllLayers();
	}

	function refreshEntityInfo(): void {
		if (!mounted) {
			entityInfo = null;
			return;
		}
		const view = getInstance()?.curView;
		if (!view) return;
		const ids = view.selectionSet.ids;
		if (ids.length === 1) {
			entityInfo = getEntityById(ids[0]);
		} else {
			entityInfo = null;
		}
	}

	/** Show a toast instruction when user starts an interactive CAD command */
	function startInteractiveAction(action: () => void, instruction: string) {
		action();
		panActive = false;
		selectActive = false;
		toast.info(instruction, { duration: 6000 });
	}

	/** Show a brief success toast for instant actions */
	function confirmAction(message: string) {
		toast.success(message, { duration: 2000 });
	}

	$effect(() => {
		const path = filePath;
		const source = fileSource;
		const el = containerRef;
		void retryCounter; // Dependency: re-run on retry
		loading = true;
		error = false;
		let cancelled = false;

		(async () => {
			try {
				log.info('[CAD_VIEWER_INIT] Starting preview initialization for', path);
				const bytes = await readPreviewSourceFile(path, source);
				log.info('[CAD_VIEWER_INIT] readPreviewSourceFile completed', bytes.byteLength);

				if (cancelled || filePath !== path || fileSource !== source) return;

				if (!el) {
					error = true;
					loading = false;
					log.error('[CAD_VIEWER_INIT] containerRef is null');
					return;
				}

				log.info('[CAD_VIEWER_INIT] Calling initCadViewer');
				const initialized = await initCadViewer(el);
				log.info('[CAD_VIEWER_INIT] initCadViewer returned', initialized);

				if (!initialized) {
					error = true;
					loading = false;
					return;
				}

				// Normalise path separators and extract file name
				const fileName = path.replace(/\\/g, '/').split('/').pop() || 'drawing';
				log.info('[CAD_VIEWER_INIT] Calling openCadDocument', fileName);
				const success = await openCadDocument(fileName, bytes, AcEdOpenMode.Write);
				log.info('[CAD_VIEWER_INIT] openCadDocument returned', success);

				if (cancelled || filePath !== path || fileSource !== source) return;

				if (!success) {
					error = true;
					mounted = false;
				} else {
					log.info('[CAD_VIEWER_INIT] Setting up post-init interactions');
					mounted = true;
					cadInstallTrackpadPan();
					cadPan();
					panActive = true;
					lineWeightOn = getCadLineWeightEnabled();
					refreshLayers();
					log.info('[CAD_VIEWER_INIT] Initialization complete');
				}
				loading = false;
			} catch (loadError) {
				if (cancelled || filePath !== path || fileSource !== source) return;
				log.error('CAD 2D viewer load failed', { path, error: loadError });
				error = true;
				loading = false;
			}
		})();

		return () => {
			cancelled = true;
			mounted = false;
			try {
				destroyCadViewer();
			} catch (err) {
				log.warn('CAD viewer destruction failed during unmount (benign)', err);
			}
		};
	});

	// Resize container handler
	$effect(() => {
		if (!containerRef) return;

		const observer = new ResizeObserver(() => {
			if (!mounted) return;
			// 1. Reset canvas style to allow it to auto-shrink/expand in the layout container
			const canvas = containerRef?.querySelector('canvas');
			if (canvas) {
				canvas.style.width = '100%';
				canvas.style.height = '100%';
			}
			// 2. Call cadResize to update WebGL rendering viewport size
			cadResize();
		});

		observer.observe(containerRef);
		return () => {
			observer.disconnect();
		};
	});

	// Sync cad-viewer background when global preview theme changes.
	// switchbg is a toggle, not a setter, and the embedded CAD viewer opens in its
	// own dark default. Track that default locally so the first light-mode request
	// toggles the drawing background instead of assuming sysVars took effect.
	let prevTheme: 'dark' | 'light' = 'dark';
	$effect(() => {
		const theme = appState.previewTheme;
		// mounted guards prevent firing on unmounted viewer with stale singleton
		if (mounted && theme !== prevTheme && getInstance()) {
			cadSwitchBackground();
		}
		prevTheme = theme;
	});

	// Keyboard shortcuts + selection count tracking
	$effect(() => {
		if (!mounted) return;
		const view = getInstance()?.curView;
		if (!view || !containerRef) return;

		const root = containerRef.closest('.cad-2d-viewer-root') as HTMLElement | null;
		if (!root) return;

		// Make the root focusable for keyboard events
		if (!root.hasAttribute('tabindex')) {
			root.tabIndex = 0;
		}

		const onKeyDown = (e: KeyboardEvent) => {
			// Don't intercept if user is typing in an input
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			if (e.key === 'Escape') {
				e.preventDefault();
				cadSelect();
				panActive = false;
				selectActive = true;
			}

			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCount > 0) {
				e.preventDefault();
				cadErase();
				toast.success(`Erased ${selectedCount} entit${selectedCount === 1 ? 'y' : 'ies'}`, {
					duration: 2000
				});
				selectedCount = 0;
				entityInfo = null;
			}
		};

		const onSelectionAdded = (args: { ids: string[] }) => {
			selectedCount += args.ids.length;
			refreshEntityInfo();
		};

		const onSelectionRemoved = (_args: { ids: string[] }) => {
			selectedCount = Math.max(0, view?.selectionSet?.ids?.length ?? 0);
			refreshEntityInfo();
		};

		// Read initial selection state
		try {
			selectedCount = view?.selectionSet?.ids?.length ?? 0;
		} catch (err) {
			log.warn('Failed to read initial selection count', err);
			selectedCount = 0;
		}

		root.addEventListener('keydown', onKeyDown);
		try {
			if (view?.selectionSet?.events?.selectionAdded) {
				view.selectionSet.events.selectionAdded.addEventListener(onSelectionAdded);
			}
			if (view?.selectionSet?.events?.selectionRemoved) {
				view.selectionSet.events.selectionRemoved.addEventListener(onSelectionRemoved);
			}
		} catch (err) {
			log.error('Failed to attach selection event listeners', err);
		}

		return () => {
			try {
				root.removeEventListener('keydown', onKeyDown);
				if (view?.selectionSet?.events) {
					if (view.selectionSet.events.selectionAdded) {
						view.selectionSet.events.selectionAdded.removeEventListener(onSelectionAdded);
					}
					if (view.selectionSet.events.selectionRemoved) {
						view.selectionSet.events.selectionRemoved.removeEventListener(onSelectionRemoved);
					}
				}
			} catch (err) {
				log.warn('CAD selection listener cleanup failed during unmount (benign)', err);
			}
		};
	});
</script>

<div
	class="cad-2d-viewer-root relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
>
	<!-- Toolbar -->
	{#if !loading && !error}
		<div
			class="cad-2d-viewer-toolbar surface-strip-row surface-overlay-soft ui-viewer-strip relative z-50"
		>
			<div class="flex items-center gap-2">
				<!-- Select mode -->
				<TooltipIconButton
					tooltip="Select (Esc)"
					variant={selectActive ? 'secondary' : 'ghost'}
					size="icon-sm"
					onclick={() => {
						cadSelect();
						panActive = false;
						selectActive = true;
					}}
				>
					<CrosshairIcon class="size-3.5" />
				</TooltipIconButton>

				{#if selectedCount > 0}
					<span class="ui-badge-outline shell-meta text-xxs px-1.5 py-0.5 whitespace-nowrap">
						{selectedCount} selected
					</span>
				{/if}

				{#if entityInfo !== null}
					<button
						type="button"
						class="ui-badge-outline shell-meta text-xxs cursor-pointer px-1.5 py-0.5 whitespace-nowrap transition-colors hover:bg-accent/50"
						onclick={() => {
							const count = cadSelectAllOnLayer(entityInfo!.layer);
							toast.success(
								`Selected ${count} ${entityInfo!.type}(s) on layer ${entityInfo!.layer}`,
								{
									duration: 2000
								}
							);
							refreshEntityInfo();
						}}
						aria-label="Select all on layer {entityInfo.layer}"
					>
						Select all on {entityInfo.layer}
					</button>
				{/if}

				<!-- Navigation -->
				<TooltipIconButton
					tooltip="Zoom to fit"
					variant="ghost"
					size="icon-sm"
					onclick={() => {
						cadZoomExtents();
						confirmAction('Zoomed to fit');
					}}
				>
					<MaximizeIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton
					tooltip="Pan"
					variant={panActive ? 'secondary' : 'ghost'}
					size="icon-sm"
					onclick={() => {
						cadPan();
						panActive = true;
						selectActive = false;
					}}
				>
					<HandIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton
					tooltip="Regenerate"
					variant="ghost"
					size="icon-sm"
					onclick={() => {
						cadRegen();
						confirmAction('Regenerated');
					}}
				>
					<RefreshCwIcon class="size-3.5" />
				</TooltipIconButton>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<!-- Measure dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="w-10" aria-label="Measure">
								<RulerIcon class="mr-0.5 size-3.5" />
								<ChevronDownIcon class="size-2.5 opacity-60" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="menu-width-standard">
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadMeasureDistance,
									'Click two points in the drawing to measure distance'
								)}
						>
							<RulerIcon class="size-3.5" />
							Distance
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadMeasureArea,
									'Click points in the drawing to measure area'
								)}
						>
							<SquareIcon class="size-3.5" />
							Area
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadMeasureAngle,
									'Click two lines in the drawing to measure angle'
								)}
						>
							<RotateCwIcon class="size-3.5" />
							Angle
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadMeasureArc,
									'Click an arc in the drawing to measure arc length'
								)}
						>
							<CircleDotIcon class="size-3.5" />
							Arc
						</DropdownMenu.Item>
						<div class="mx-2 my-1 h-px bg-border"></div>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadDimlinear,
									'Click two points to dimension, then place the dimension line'
								)}
						>
							<RulerIcon class="size-3.5" />
							Linear dim
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<!-- Modify dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="w-10" aria-label="Modify">
								<MoveIcon class="mr-0.5 size-3.5" />
								<ChevronDownIcon class="size-2.5 opacity-60" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="menu-width-standard">
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadCopy,
									'Select entities, then pick base point and destination point to copy'
								)}
						>
							<CopyIcon class="size-3.5" />
							Copy
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadMove,
									'Select entities, then pick from and to points to move'
								)}
						>
							<MoveIcon class="size-3.5" />
							Move
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadRotate,
									'Select entities, then pick centre point and angle to rotate'
								)}
						>
							<RotateCwIcon class="size-3.5" />
							Rotate
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadOffset,
									'Specify offset distance, then click an entity and pick the side'
								)}
						>
							<CopyPlusIcon class="size-3.5" />
							Offset
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<!-- Layers dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="w-10" aria-label="Layers">
								<LayersIcon class="mr-0.5 size-3.5" />
								<ChevronDownIcon class="size-2.5 opacity-60" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="menu-width-standard w-64">
						<DropdownMenu.Item
							class="gap-2"
							onclick={() => {
								cadUnisolateLayers();
								cadThawAllLayers();
								cadLayerOn();
								confirmAction('All layers restored');
								refreshLayers();
							}}
						>
							<LayersIcon class="size-3.5" />
							Show all layers
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() =>
								startInteractiveAction(
									cadIsolateLayers,
									'Click a line or shape to isolate its layer'
								)}
						>
							<FilterIcon class="size-3.5" />
							Isolate layer
						</DropdownMenu.Item>
						<div class="mx-2 my-1 h-px bg-border"></div>
						{#if layers.length === 0}
							<div class="px-2 py-3 text-center">
								<Text tone="muted" class="caption">No layers available</Text>
							</div>
						{:else}
							<div class="max-h-64 overflow-y-auto">
								{#each layers as layer (layer.name)}
									<div
										class="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-accent/50"
									>
										<span
											class="border-alpha-10 size-3 shrink-0 rounded-full border"
											style="background: {layer.colorRgb}"
										></span>
										<span
											class="caption flex-1 truncate"
											class:opacity-40={layer.isOff || layer.isFrozen}
										>
											{layer.name}
										</span>
										<button
											type="button"
											class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-60 transition-opacity hover:opacity-100"
											onclick={() => {
												toggleLayerVisibility(layer.name);
												refreshLayers();
											}}
											aria-label="Toggle {layer.name} visibility"
										>
											{#if layer.isOff || layer.isFrozen}
												<EyeOffIcon class="size-3.5" />
											{:else}
												<EyeIcon class="size-3.5" />
											{/if}
										</button>
										<button
											type="button"
											class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-60 transition-opacity hover:opacity-100"
											onclick={() => {
												toggleLayerLock(layer.name);
												refreshLayers();
											}}
											aria-label="Toggle {layer.name} lock"
										>
											{#if layer.isLocked}
												<LockIcon class="size-3.5" />
											{:else}
												<LockOpenIcon class="size-3.5" />
											{/if}
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<!-- Erase -->
				<TooltipIconButton
					tooltip="Erase selected"
					variant="ghost"
					size="icon-sm"
					onclick={() => {
						cadErase();
						confirmAction('Erased selected entities');
					}}
				>
					<Trash2Icon class="size-3.5" />
				</TooltipIconButton>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<!-- Line weight toggle -->
				<TooltipIconButton
					tooltip={lineWeightOn ? 'Line weight: On' : 'Line weight: Off'}
					variant={lineWeightOn ? 'secondary' : 'ghost'}
					size="icon-sm"
					onclick={() => {
						cadToggleLineWeight();
						lineWeightOn = getCadLineWeightEnabled();
						confirmAction(lineWeightOn ? 'Line weight: On' : 'Line weight: Off');
					}}
				>
					{#if lineWeightOn}
						<EyeIcon class="size-3.5" />
					{:else}
						<EyeOffIcon class="size-3.5" />
					{/if}
				</TooltipIconButton>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<!-- Export dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="w-10" aria-label="Export">
								<DownloadIcon class="mr-0.5 size-3.5" />
								<ChevronDownIcon class="size-2.5 opacity-60" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="menu-width-standard">
						<DropdownMenu.Item
							class="gap-2"
							onclick={() => {
								cadExportPng();
								confirmAction('Drawing exported as PNG');
							}}
						>
							<CameraIcon class="size-3.5" />
							PNG
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() => {
								cadExportSvg();
								confirmAction('Drawing exported as SVG');
							}}
						>
							<DownloadIcon class="size-3.5" />
							SVG
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="gap-2"
							onclick={() => {
								cadExportDxf();
								confirmAction('Drawing exported as DXF');
							}}
						>
							<DownloadIcon class="size-3.5" />
							DXF
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
			<div class="flex items-center gap-2">
				{#if allowExpand && !detached}
					<TooltipIconButton
						tooltip={expanded ? 'Collapse' : 'Expand'}
						variant="ghost"
						size="icon-sm"
						onclick={() => (expanded = !expanded)}
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

	{#if entityInfo !== null}
		<div
			class="surface-card ui-radius-lg ui-elevation-overlay absolute top-3 right-3 z-[60] space-y-1.5 border p-3"
		>
			<div class="flex items-center gap-2">
				<span
					class="border-alpha-10 size-3 shrink-0 rounded-full border"
					style="background: {entityInfo.colorRgb}"
				></span>
				<span class="shell-meta">{entityInfo.type}</span>
			</div>
			<div class="caption grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
				<span class="muted">Layer</span>
				<span class="truncate">{entityInfo.layer}</span>
				<span class="muted">Line type</span>
				<span>{entityInfo.lineType}</span>
			</div>
		</div>
	{/if}

	<!-- Canvas container -->
	<div
		bind:this={containerRef}
		class="relative min-h-0 min-w-0 flex-1"
		class:invisible={loading || error}
	></div>

	<!-- Loading / Error -->
	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2">
				<RotateCwIcon class="muted size-6 animate-spin" />
				<Text tone="muted" class="animate-pulse">Loading drawing…</Text>
			</div>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-4 opacity-60">
				<BoxIcon class="muted size-16 stroke-1" />
				<Text tone="muted">Could not render the drawing</Text>
				<Button variant="secondary" size="default" class="gap-1.5" onclick={() => retryCounter++}>
					<RefreshCwIcon class="size-3" />
					Retry
				</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* [[HIDDEN]] Suppress cad-simple-viewer's built-in command prompt bar.
	   The viewer creates a command line container with "✕▾" buttons and
	   prompt text. It overlays our toolbar and intercepts mouse clicks.
	   Hide all its internal UI chrome since we provide our own toolbar.
	   NOTE: This removes keyboard-accessible command input for power users
	   who know AutoCAD commands. All viewer commands are available via the
	   toolbar buttons above. If keyboard command input is needed later,
	   add a compact inline input in the toolbar that wraps sendStringToExecute().
	*/
	.cad-2d-viewer-root :global(.ml-cli-container),
	.cad-2d-viewer-root :global(.ml-cli-bar),
	.cad-2d-viewer-root :global(.ml-cli-wrapper),
	.cad-2d-viewer-root :global(.ml-cli-recent),
	.cad-2d-viewer-root :global(.ml-cli-messages),
	.cad-2d-viewer-root :global(.ml-ccl-wrapper),
	.cad-2d-viewer-root :global(.ml-cli-left),
	.cad-2d-viewer-root :global(.ml-cli-center),
	.cad-2d-viewer-root :global(.ml-cli-right),
	.cad-2d-viewer-root :global(.ml-cli-prompt),
	.cad-2d-viewer-root :global(.ml-cli-text),
	.cad-2d-viewer-root :global(.ml-cli-close-btn),
	.cad-2d-viewer-root :global(.ml-cli-down),
	.cad-2d-viewer-root :global(.ml-cli-up),
	.cad-2d-viewer-root :global(.ml-cli-cmd-popup),
	.cad-2d-viewer-root :global(.ml-cli-msg-panel),
	.cad-2d-viewer-root :global(.ml-cli-history-line),
	.cad-2d-viewer-root :global(.ml-cli-msg-error),
	.cad-2d-viewer-root :global(.ml-cli-option) {
		display: none !important;
	}
	/* Keep ml-floating-input in the DOM for keyboard Escape routing,
	   but make it visually invisible and zero-size */
	.cad-2d-viewer-root :global(.ml-floating-input) {
		position: fixed;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
		overflow: hidden;
	}
</style>
