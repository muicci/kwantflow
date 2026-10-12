<script lang="ts">
	import { readAppLocalFile, readVaultFile } from '$lib/services/assets';
	import {
		getCadFormat,
		loadCadFile,
		getTHREE,
		cacheCadFile,
		getCachedCadFile,
		cacheCameraState,
		getCachedCameraState,
		type CadBounds,
		type CadMetadata
	} from '$lib/services/cad-loader';
	import { createLogger } from '$lib/services/logger.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { assistantState } from '$lib/state/assistant.svelte.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import type { Material, Object3D } from 'three';
	import { toast } from 'svelte-sonner';

	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import PentagonIcon from '@lucide/svelte/icons/pentagon';
	import Grid3x3Icon from '@lucide/svelte/icons/grid-3x3';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import BoxIcon from '@lucide/svelte/icons/box';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';

	import { onMount, tick, untrack } from 'svelte';
	const log = createLogger('viewer.cad');

	interface Props {
		filePath: string;
		fileSource?: 'vault' | 'appLocal';
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
		targetViewLabel?: string | null;
	}

	type DisposableGeometry = { dispose(): void };
	type DisposableValue = { dispose(): void };
	type ViewerMaterial = Material & { wireframe?: boolean } & Record<string, unknown>;
	type LineWidthCapableMaterial = ViewerMaterial & {
		linewidth?: number;
		wireframeLinewidth?: number;
	};
	type ViewerNode = Object3D & {
		geometry?: DisposableGeometry;
		material?: ViewerMaterial | ViewerMaterial[];
		isMesh?: boolean;
	};

	let {
		filePath,
		fileSource = 'vault',
		expanded = $bindable(false),
		allowExpand = true,
		detached = false,
		targetViewLabel = null
	}: Props = $props();

	// ── State ─────────────────────────────────────────────────────────
	let containerRef: HTMLDivElement | undefined = $state();
	let viewportRef: HTMLDivElement | undefined = $state();
	let canvasRef: HTMLCanvasElement | undefined = $state();
	let loading = $state(true);
	let error = $state(false);
	let retryCounter = $state(0);
	let metadataOnlyReason = $state<string | null>(null);

	let metadata = $state<CadMetadata | null>(null);
	let wireframe = $state(false);
	let showGrid = $state(true);

	const primaryGeometryDisplay = $derived(
		metadata === null
			? ''
			: metadata.previewMode === 'wire'
				? `${metadata.edgeCount.toLocaleString()} edges`
				: `${metadata.faceCount.toLocaleString()} faces`
	);
	const dimsDisplay = $derived(
		metadata?.dimensions
			? `${metadata.dimensions.x} × ${metadata.dimensions.y} × ${metadata.dimensions.z}`
			: ''
	);
	const previewBg = $derived.by(() =>
		appState.previewTheme === 'dark'
			? 'var(--color-dark-surface-background)'
			: 'var(--color-neutral-50)'
	);

	// Three.js references (not reactive — managed imperatively)
	let THREE: typeof import('three') | null = null;
	let renderer: import('three').WebGLRenderer | null = null;
	let scene: import('three').Scene | null = null;
	let camera: import('three').PerspectiveCamera | null = null;
	let controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null = null;
	let animationFrameId: number | null = null;
	let resizeFrameId: number | null = null;
	let loadedObject: import('three').Group | null = null;
	let loadedBounds: CadBounds | null = null;
	let loadedFilePath: string | null = null;
	let loadedCadMetadata: CadMetadata | null = null;
	let sceneReady = false;
	let loadingPath: string | null = null;
	let viewerActive = false;
	let sceneInitGeneration = 0;
	let wheelCanvas: HTMLCanvasElement | null = null;
	let lastViewportWidth = 0;
	let lastViewportHeight = 0;

	/**
	 * Clamp line widths to 1 — WebGL ALIASED_LINE_WIDTH_RANGE almost
	 * always returns [1, 1] on modern GPUs and browsers.
	 */
	function clampLineWidths(material: ViewerMaterial) {
		const lineMaterial = material as LineWidthCapableMaterial;
		if (typeof lineMaterial.linewidth === 'number') {
			lineMaterial.linewidth = 1;
		}
		if (typeof lineMaterial.wireframeLinewidth === 'number') {
			lineMaterial.wireframeLinewidth = 1;
		}
	}

	function clampObjectLineWidths(object: import('three').Object3D) {
		object.traverse((child) => {
			const node = child as ViewerNode;
			if (!node.material) return;
			if (Array.isArray(node.material)) {
				node.material.forEach(clampLineWidths);
			} else {
				clampLineWidths(node.material);
			}
		});
	}

	// ── Scene initialization ─────────────────────────────────────────
	async function initScene() {
		if (!canvasRef || sceneReady) return;
		const initGeneration = ++sceneInitGeneration;
		const canvas = canvasRef;
		if (!viewerActive || !canvas.isConnected) return;

		THREE = await getTHREE();
		if (
			!viewerActive ||
			sceneInitGeneration !== initGeneration ||
			canvasRef !== canvas ||
			!canvas.isConnected
		) {
			return;
		}
		const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
		if (
			!viewerActive ||
			sceneInitGeneration !== initGeneration ||
			canvasRef !== canvas ||
			!canvas.isConnected
		) {
			return;
		}

		renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true
		});
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;

		scene = new THREE.Scene();
		// Transparent — CSS surface-faint shows through

		camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
		camera.position.set(5, 5, 5);

		// Lights
		const ambient = new THREE.AmbientLight(0xffffff, 0.6);
		scene.add(ambient);

		const directional = new THREE.DirectionalLight(0xffffff, 0.8);
		directional.position.set(10, 20, 10);
		scene.add(directional);

		const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
		fillLight.position.set(-10, -5, -10);
		scene.add(fillLight);

		// Floor plane keeps spatial grounding without WebGL line-width issues from GridHelper.
		const grid = new THREE.Mesh(
			new THREE.PlaneGeometry(10, 10),
			new THREE.MeshBasicMaterial({
				color: 0xcbd5e1,
				transparent: true,
				opacity: 0.12,
				side: THREE.DoubleSide,
				depthWrite: false
			})
		);
		grid.name = '__grid';
		grid.rotation.x = -Math.PI / 2;
		scene.add(grid);

		// OrbitControls
		controls = new OrbitControls(camera, canvas);
		controls.enableDamping = true;
		controls.dampingFactor = 0.1;
		controls.minDistance = 0.1;
		controls.maxDistance = 5000;
		controls.screenSpacePanning = true;
		controls.enableZoom = false; // We handle zoom ourselves to separate scroll vs pinch
		controls.mouseButtons = {
			LEFT: THREE.MOUSE.ROTATE,
			MIDDLE: THREE.MOUSE.PAN,
			RIGHT: THREE.MOUSE.PAN
		};

		// Custom wheel: two-finger scroll = pan, pinch (ctrl+scroll) = zoom
		wheelCanvas = canvas;
		wheelCanvas.addEventListener('wheel', handleWheel, { passive: false });

		// Initial size
		scheduleResize();

		// Animation loop
		function animate() {
			animationFrameId = requestAnimationFrame(animate);
			if (!viewerActive || !canvasRef?.isConnected) return;
			controls?.update();
			if (renderer && scene && camera) {
				renderer.render(scene, camera);
			}
		}
		animate();

		sceneReady = true;
	}

	// ── Resize handler ───────────────────────────────────────────────
	function flushResize() {
		resizeFrameId = null;
		if (
			!viewerActive ||
			!viewportRef ||
			!viewportRef.isConnected ||
			!canvasRef ||
			!canvasRef.isConnected ||
			!renderer ||
			!camera
		)
			return;
		const rect = viewportRef.getBoundingClientRect();
		const w = Math.max(1, Math.round(rect.width));
		const h = Math.max(1, Math.round(rect.height));
		if ((w === lastViewportWidth && h === lastViewportHeight) || w === 0 || h === 0) return;
		lastViewportWidth = w;
		lastViewportHeight = h;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	function scheduleResize() {
		if (!viewerActive) return;
		if (resizeFrameId !== null) return;
		resizeFrameId = requestAnimationFrame(() => flushResize());
	}

	// ── DOM setup ────────────────────────────────────────────────────
	onMount(() => {
		let disposed = false;
		viewerActive = true;

		initScene().then(() => {
			if (disposed) cleanup();
		});

		const ro = new ResizeObserver(() => scheduleResize());
		if (viewportRef) ro.observe(viewportRef);

		return () => {
			disposed = true;
			ro.disconnect();
			cleanup();
		};
	});

	function cleanup() {
		viewerActive = false;
		sceneReady = false;
		sceneInitGeneration += 1;
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		if (resizeFrameId !== null) {
			cancelAnimationFrame(resizeFrameId);
			resizeFrameId = null;
		}
		wheelCanvas?.removeEventListener('wheel', handleWheel);
		wheelCanvas = null;

		// Save camera state before destroying controls
		if (controls && camera && loadedFilePath) {
			cacheCameraState(loadedFilePath, camera.position, controls.target);
		}
		controls?.dispose();
		controls = null;

		// Cache the loaded CAD object instead of disposing geometry.
		// GPU memory is freed via renderer.dispose() below.
		// Geometry stays in JS cache for instant tab-return.
		// Actual geometry disposal happens only on cache eviction.
		if (loadedObject && scene && loadedFilePath) {
			scene.remove(loadedObject);
			if (loadedCadMetadata) {
				cacheCadFile(loadedFilePath, {
					kind: 'previewable',
					previewMode: loadedCadMetadata.previewMode as 'mesh' | 'wire',
					object: loadedObject,
					renderBounds: loadedBounds ?? {
						minX: 0,
						minY: 0,
						minZ: 0,
						maxX: 0,
						maxY: 0,
						maxZ: 0
					},
					metadata: loadedCadMetadata
				});
			}
			loadedObject = null;
		}
		loadedBounds = null;
		loadedFilePath = null;
		loadedCadMetadata = null;
		assistantState.activeCadMetadata = null;

		// Dispose scene contents (grid, lights, ambient — NOT the cached model)
		if (scene) {
			scene.traverse((child) => {
				const node = child as ViewerNode;
				if (node.geometry) node.geometry.dispose();
				if (node.material) {
					if (Array.isArray(node.material)) {
						node.material.forEach(disposeMaterial);
					} else {
						disposeMaterial(node.material);
					}
				}
			});
		}

		renderer?.dispose();
		renderer?.forceContextLoss();
		renderer = null;
		scene = null;
		camera = null;
	}

	// ── GPU memory cleanup ───────────────────────────────────────────
	function _disposeObject(obj: import('three').Object3D) {
		obj.traverse((child) => {
			const node = child as ViewerNode;
			if (node.geometry) node.geometry.dispose();
			if (node.material) {
				if (Array.isArray(node.material)) {
					node.material.forEach(disposeMaterial);
				} else {
					disposeMaterial(node.material);
				}
			}
		});
	}

	function disposeMaterial(material: ViewerMaterial) {
		material.dispose();
		for (const val of Object.values(material)) {
			if (isDisposableValue(val)) {
				val.dispose();
			}
		}
	}

	function isDisposableValue(value: unknown): value is DisposableValue {
		return (
			typeof value === 'object' &&
			value !== null &&
			'dispose' in value &&
			typeof value.dispose === 'function'
		);
	}

	// ── File loading (reactive on filePath) ──────────────────────────
	$effect(() => {
		const path = filePath;
		const source = fileSource;
		void retryCounter; // Dependency: re-run on retry
		if (!containerRef) return;

		loading = true;
		error = false;
		metadataOnlyReason = null;
		metadata = null;
		loadedBounds = null;

		// Remove previous model — cache it for instant tab-return instead of disposing
		if (loadedObject && scene && loadedFilePath) {
			// Save camera state before swapping to a different file
			if (controls && camera) {
				cacheCameraState(loadedFilePath, camera.position, controls.target);
			}
			const toCache = loadedObject;
			scene.remove(toCache);
			loadedObject = null;
			if (loadedCadMetadata) {
				cacheCadFile(loadedFilePath, {
					kind: 'previewable',
					previewMode: loadedCadMetadata.previewMode as 'mesh' | 'wire',
					object: toCache,
					renderBounds: loadedBounds ?? {
						minX: 0,
						minY: 0,
						minZ: 0,
						maxX: 0,
						maxY: 0,
						maxZ: 0
					},
					metadata: loadedCadMetadata
				});
			}
		}

		(async () => {
			try {
				// Guard: prevent double-processing if the same path is already loading
				if (loadingPath === path) return;
				loadingPath = path;

				// Ensure scene is ready before checking cache or loading.
				// untrack() prevents sceneReady from becoming a reactive dependency
				// that would re-trigger the $effect and create a race with itself.
				if (untrack(() => !sceneReady)) await initScene();

				// Check cache now that scene exists — avoids re-parsing the CAD file
				const cached = getCachedCadFile(path);
				if (cached && scene) {
					// Clone shares geometry/material by reference (Three.js docs).
					// GPU memory: renderer already exists from initScene().
					const cloned = cached.object.clone();
					scene.add(cloned);
					loadedObject = cloned;
					loadedBounds = cached.renderBounds;
					loadedFilePath = path;
					loadedCadMetadata = cached.metadata;
					metadata = cached.metadata;
					clampObjectLineWidths(cloned);

					loadingPath = null;
					loading = false;
					await tick();
					if (!viewerActive || filePath !== path || fileSource !== source) return;
					scheduleResize();

					// Restore saved camera position, or fit to view on first load
					const savedCam = getCachedCameraState(path);
					if (savedCam && camera && controls) {
						camera.position.set(savedCam.position.x, savedCam.position.y, savedCam.position.z);
						controls.target.set(savedCam.target.x, savedCam.target.y, savedCam.target.z);
						controls.update();
					} else {
						fitToView();
					}
					return;
				}

				const format = getCadFormat(path);
				if (!format) {
					throw new Error(`Unsupported CAD format: ${path.split('.').pop()}`);
				}

				const fileData =
					source === 'appLocal' ? await readAppLocalFile(path) : await readVaultFile(path);
				if (filePath !== path || fileSource !== source) return; // stale

				const result = await loadCadFile(fileData, format);
				if (filePath !== path || fileSource !== source) return; // stale

				if (result.kind === 'metadata_only') {
					metadata = result.metadata;
					metadataOnlyReason = result.reason;
					loadedBounds = null;
					loadedFilePath = null;
					loadedCadMetadata = null;
					loadingPath = null;
					loading = false;
					return;
				}

				if (!viewerActive || filePath !== path || fileSource !== source) return;

				if (scene) {
					scene.add(result.object);
					loadedObject = result.object;
					loadedBounds = result.renderBounds;
					loadedFilePath = path;
					loadedCadMetadata = result.metadata;
					clampObjectLineWidths(result.object);
					metadata = result.metadata;
					assistantState.activeCadMetadata = result.metadata;
				}

				loadingPath = null;
				loading = false;
				await tick();
				if (!viewerActive || filePath !== path || fileSource !== source) return;
				scheduleResize();
				fitToView();
			} catch (e: unknown) {
				if (filePath !== path || fileSource !== source) return;
				log.error('Load failed', { path, error: e });
				error = true;
				loadingPath = null;
				loading = false;
			}
		})();
	});

	$effect(() => {
		if (!targetViewLabel || loading || error || metadataOnlyReason || !loadedObject) return;
		setNamedView(targetViewLabel);
	});

	// ── Fit-to-view ──────────────────────────────────────────────────
	function fitToView() {
		if (!THREE || !loadedObject || !camera || !controls || !scene || !loadedBounds) return;

		const center = new THREE.Vector3(
			(loadedBounds.minX + loadedBounds.maxX) / 2,
			(loadedBounds.minY + loadedBounds.maxY) / 2,
			(loadedBounds.minZ + loadedBounds.maxZ) / 2
		);
		const size = new THREE.Vector3(
			Math.max(0, loadedBounds.maxX - loadedBounds.minX),
			Math.max(0, loadedBounds.maxY - loadedBounds.minY),
			Math.max(0, loadedBounds.maxZ - loadedBounds.minZ)
		);

		const maxDim = Math.max(size.x, size.y, size.z);
		if (maxDim === 0) return;

		const fov = camera.fov * (Math.PI / 180);
		const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

		camera.position.set(
			center.x + distance * 0.7,
			center.y + distance * 0.5,
			center.z + distance * 0.7
		);
		controls.target.copy(center);
		controls.update();

		// Position grid at model bottom
		const grid = scene.getObjectByName('__grid');
		if (grid) {
			const gridScale = Math.max(0.01, Math.pow(10, Math.floor(Math.log10(maxDim))));
			grid.scale.set(gridScale / 10, 1, gridScale / 10);
			grid.position.y = loadedBounds.minY;
		}
	}

	function setNamedView(viewLabel: string) {
		if (!THREE || !loadedObject || !camera || !controls || !loadedBounds) return;

		const center = new THREE.Vector3(
			(loadedBounds.minX + loadedBounds.maxX) / 2,
			(loadedBounds.minY + loadedBounds.maxY) / 2,
			(loadedBounds.minZ + loadedBounds.maxZ) / 2
		);
		const size = new THREE.Vector3(
			Math.max(0, loadedBounds.maxX - loadedBounds.minX),
			Math.max(0, loadedBounds.maxY - loadedBounds.minY),
			Math.max(0, loadedBounds.maxZ - loadedBounds.minZ)
		);
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		const distance = maxDim * 2;
		const positions: Record<string, [number, number, number]> = {
			iso: [0.8, 0.6, 0.8],
			front: [0, 0, 1],
			top: [0, 1, 0.0001],
			side: [1, 0, 0]
		};
		const vector = positions[viewLabel];
		if (!vector) {
			fitToView();
			return;
		}

		camera.position.set(
			center.x + distance * vector[0],
			center.y + distance * vector[1],
			center.z + distance * vector[2]
		);
		controls.target.copy(center);
		controls.update();
	}

	// ── Pan / Zoom helpers ──────────────────────────────────────
	function panView(dx: number, dy: number) {
		if (!THREE || !camera || !controls) return;
		const right = new THREE.Vector3();
		const up = new THREE.Vector3();
		right.setFromMatrixColumn(camera.matrix, 0);
		up.setFromMatrixColumn(camera.matrix, 1);

		const distance = camera.position.distanceTo(controls.target);
		const step = distance * 0.15;

		const offset = new THREE.Vector3();
		offset.addScaledVector(right, dx * step);
		offset.addScaledVector(up, dy * step);

		camera.position.add(offset);
		controls.target.add(offset);
		controls.update();
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();

		// Trackpad heuristic: small deltas in DOM_DELTA_PIXEL mode, no ctrlKey
		const absDx = Math.abs(e.deltaX);
		const absDy = Math.abs(e.deltaY);
		const smallDelta = (absDx > 0 && absDx < 30) || (absDy > 0 && absDy < 30);
		const isTrackpad = smallDelta && e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && !e.ctrlKey;

		if (isTrackpad) {
			// Two-finger scroll → pan
			panView(e.deltaX * 0.005, -e.deltaY * 0.005);
		} else {
			// Mouse scroll / pinch (ctrl+scroll) → zoom
			if (!camera || !controls) return;
			const factor = 1 + e.deltaY * 0.005;
			const dir = camera.position.clone().sub(controls.target);
			dir.multiplyScalar(factor);
			camera.position.copy(controls.target).add(dir);
			controls.update();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target !== containerRef) return;
		const step = 0.3;
		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				panView(-step, 0);
				break;
			case 'ArrowRight':
				e.preventDefault();
				panView(step, 0);
				break;
			case 'ArrowUp':
				e.preventDefault();
				panView(0, step);
				break;
			case 'ArrowDown':
				e.preventDefault();
				panView(0, -step);
				break;
		}
	}

	// ── Toolbar actions ──────────────────────────────────────────────
	/** Show a brief success toast for instant actions. */
	function confirmAction(message: string) {
		toast.success(message, { duration: 2000 });
	}

	/** Export the current viewport as a PNG download. */
	function exportPng() {
		if (!renderer || !scene || !camera) return;
		// Re-render to populate the drawing buffer before capture.
		// WebGL discards the buffer after the frame by default,
		// so toDataURL would otherwise read an empty (white) canvas.
		renderer.render(scene, camera);
		const canvas = renderer.domElement;
		if (!canvas || typeof canvas.toDataURL !== 'function') return;
		const dataUrl = canvas.toDataURL('image/png');
		if (!dataUrl || dataUrl === 'data:,') return;
		const link = document.createElement('a');
		link.download = `model-${Date.now()}.png`;
		link.href = dataUrl;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		confirmAction('Viewport exported as PNG');
	}

	function toggleWireframe() {
		wireframe = !wireframe;
		if (!loadedObject) return;
		loadedObject.traverse((child) => {
			const node = child as ViewerNode;
			if (node.isMesh && node.material) {
				if (Array.isArray(node.material)) {
					node.material.forEach((material) => {
						material.wireframe = wireframe;
						clampLineWidths(material);
					});
				} else {
					node.material.wireframe = wireframe;
					clampLineWidths(node.material);
				}
			}
		});
		confirmAction(wireframe ? 'Wireframe: On' : 'Wireframe: Off');
	}

	function toggleGrid() {
		showGrid = !showGrid;
		const grid = scene?.getObjectByName('__grid');
		if (grid) grid.visible = showGrid;
		confirmAction(showGrid ? 'Grid: On' : 'Grid: Off');
	}

	function resetView() {
		fitToView();
		confirmAction('View reset');
	}

	function toggleExpand() {
		expanded = !expanded;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerRef}
	class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
	style="background: {previewBg};"
	tabindex="-1"
	role="application"
	aria-label="3D model preview"
	dir="ltr"
	oncontextmenu={(e) => e.preventDefault()}
	onkeydown={handleKeydown}
>
	<!-- Toolbar -->
	{#if !loading && !error && !metadataOnlyReason}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<!-- Model Info -->
			<div class="flex items-center gap-2">
				<Meta as="span" class="tabular-nums">
					{primaryGeometryDisplay}
				</Meta>
				{#if dimsDisplay}
					<Meta as="span" class="tabular-nums">
						{dimsDisplay}
					</Meta>
				{/if}
			</div>

			<!-- View Controls -->
			<div class="flex items-center gap-1">
				{#if metadata?.previewMode === 'mesh'}
					<TooltipIconButton
						tooltip="Toggle wireframe"
						variant={wireframe ? 'secondary' : 'ghost'}
						size="icon-xs"
						onclick={toggleWireframe}
					>
						<PentagonIcon class="size-3.5" />
					</TooltipIconButton>
				{/if}
				<TooltipIconButton
					tooltip="Toggle grid"
					variant={showGrid ? 'secondary' : 'ghost'}
					size="icon-xs"
					onclick={toggleGrid}
				>
					<Grid3x3Icon class="size-3.5" />
				</TooltipIconButton>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<!-- D-pad -->
				<div class="-my-0.5 inline-grid grid-cols-3" title="Pan (arrow keys / two-finger scroll)">
					<span></span>
					<button
						class="ui-radius-sm flex size-4 items-center justify-center hover:bg-accent"
						onclick={() => panView(0, 0.3)}
					>
						<ChevronUpIcon class="muted size-2.5" />
					</button>
					<span></span>
					<button
						class="ui-radius-sm flex size-4 items-center justify-center hover:bg-accent"
						onclick={() => panView(-0.3, 0)}
					>
						<ChevronLeftIcon class="muted size-2.5" />
					</button>
					<button
						class="ui-radius-sm flex size-4 items-center justify-center hover:bg-accent"
						onclick={() => panView(0, -0.3)}
					>
						<ChevronDownIcon class="muted size-2.5" />
					</button>
					<button
						class="ui-radius-sm flex size-4 items-center justify-center hover:bg-accent"
						onclick={() => panView(0.3, 0)}
					>
						<ChevronRightIcon class="muted size-2.5" />
					</button>
				</div>

				<div class="mx-1 h-4 w-px bg-border"></div>

				<TooltipIconButton tooltip="Fit to view" variant="ghost" size="icon-xs" onclick={fitToView}>
					<MaximizeIcon class="size-3.5" />
				</TooltipIconButton>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-1">
				<TooltipIconButton tooltip="Export PNG" variant="ghost" size="icon-xs" onclick={exportPng}>
					<CameraIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton tooltip="Reset view" variant="ghost" size="icon-xs" onclick={resetView}>
					<CrosshairIcon class="size-3.5" />
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

	<!-- Canvas -->
	<div
		bind:this={viewportRef}
		class="relative min-h-0 min-w-0 flex-1 overflow-hidden {loading || error || metadataOnlyReason
			? 'invisible'
			: ''}"
	>
		<canvas bind:this={canvasRef} class="absolute inset-0 h-full w-full"></canvas>
	</div>

	<!-- Loading / Error overlays -->
	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2">
				<RefreshCwIcon class="muted size-6 animate-spin" />
				<Text tone="muted" class="animate-pulse">Loading drawing…</Text>
			</div>
		</div>
	{:else if metadataOnlyReason}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex max-w-sm flex-col items-center gap-2 px-6 text-center opacity-60">
				<BoxIcon class="muted size-16 stroke-1" />
				<Text>No preview available for this file</Text>
				<Meta>This CAD file is valid, but it does not contain drawable geometry for preview.</Meta>
				{#if metadata}
					<div class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
						<Meta as="span">{metadata.format.toUpperCase()}</Meta>
						{#if dimsDisplay}
							<Meta as="span" class="tabular-nums">{dimsDisplay}</Meta>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-3 opacity-50">
				<BoxIcon class="muted size-16 stroke-1" />
				<Text as="p" tone="muted">Could not load 3D model</Text>
				<Button variant="secondary" size="default" class="gap-1.5" onclick={() => retryCounter++}>
					<RefreshCwIcon class="size-3" />
					Retry
				</Button>
			</div>
		</div>
	{/if}
</div>
