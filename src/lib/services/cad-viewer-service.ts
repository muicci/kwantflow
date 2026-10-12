/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Shared CAD viewer service — manages the singleton AcApDocManager lifecycle.
 *
 * Only ONE cad-simple-viewer instance can exist. This module ensures the
 * viewer is initialized once and provides typed helpers for file opening,
 * zoom commands, and cleanup.
 */
import {
	AcApDocManager,
	type AcEdOpenMode,
	type AcApOpenDatabaseOptions
} from '@mlightcad/cad-simple-viewer';
import type { AcDbLayerTableRecord, AcDbEntity, AcCmColor } from '@mlightcad/data-model';
import { FontManager } from '@mlightcad/mtext-renderer';
import { createLogger } from './logger.js';

const log = createLogger('cad-viewer');

let _initialized = false;
let _container: HTMLElement | null = null;
let _trackpadHandler: ((e: WheelEvent) => void) | null = null;
let _trackpadCanvas: HTMLCanvasElement | null = null;
let _activeDestroyPromise: Promise<void> | null = null;

type CadViewerTeardownView = {
	stopAnimationLoop?: () => void;
	clear?: () => void;
	renderer?: {
		domElement?: HTMLCanvasElement;
		internalRenderer?: {
			setAnimationLoop?: (callback: null) => void;
			renderLists?: { dispose?: () => void };
			dispose?: () => void;
			forceContextLoss?: () => void;
		};
	};
};

/**
 * cad-simple-viewer destroys its singleton and document state, but v1.5.7 does
 * not release the WebGL renderer or remove its DOM nodes. Do that at our single
 * ownership boundary so switching files cannot accumulate live GPU contexts.
 */
async function releaseCadViewerInstance(
	inst: AcApDocManager,
	container: HTMLElement | null
): Promise<void> {
	const view = inst.curView as unknown as CadViewerTeardownView | undefined;
	const renderer = view?.renderer?.internalRenderer;

	try {
		view?.stopAnimationLoop?.();
	} catch (error) {
		log.warn('CadViewer animation-loop cleanup failed', { error });
	}

	try {
		await inst.destroy();
	} finally {
		try {
			view?.clear?.();
			renderer?.setAnimationLoop?.(null);
			renderer?.renderLists?.dispose?.();
			renderer?.dispose?.();
			renderer?.forceContextLoss?.();
		} catch (error) {
			log.warn('CadViewer WebGL cleanup failed', { error });
		}

		if (_trackpadCanvas && _trackpadHandler) {
			_trackpadCanvas.removeEventListener('wheel', _trackpadHandler, {
				capture: true
			} as AddEventListenerOptions);
		}
		_trackpadCanvas = null;
		_trackpadHandler = null;
		container?.replaceChildren();
	}
}

export async function initCadViewer(container: HTMLElement): Promise<boolean> {
	if (_activeDestroyPromise) {
		log.info('Waiting for previous CadViewer instance to destroy...');
		try {
			await _activeDestroyPromise;
		} catch {
			/* ignore errors from previous instance destruction */
		}
		_activeDestroyPromise = null;
	}

	if (_initialized) {
		if (_container !== container) {
			log.info('CadViewer container changed — destroying old instance');
			const oldContainer = _container;
			_initialized = false;
			_container = null;
			try {
				const oldInst = getInstance();
				if (oldInst) {
					await releaseCadViewerInstance(oldInst, oldContainer);
				}
			} catch {
				/* old instance may already be destroyed */
			}
			// NOTE: If createInstance() below fails, state is left inconsistent
			// (old instance destroyed, new one not created). The component will set
			// error=true and a retry will re-attempt initialization from scratch.
		} else {
			return isCadViewerReady();
		}
	}

	try {
		// Bundled open fonts keep text local. Disable legacy cached font files so
		// an earlier installation cannot shadow the audited replacements.
		FontManager.instance.enableFontCache = false;
		FontManager.instance.setDefaultFonts(['kwantflow-latin', 'kwantflow-cjk', 'kwantflow-gdt']);
		FontManager.instance.setSymbolFonts(['kwantflow-gdt']);
		const instance = AcApDocManager.createInstance({
			container,
			autoResize: true,
			useMainThreadDraw: true,
			// DEFAULT_BASE_URL lacks trailing slash → 'cad-datafonts/' (404).
			// Trailing slash + @main ensures 'cad-data@main/fonts/' resolves.
			// Matches official example pattern from cad-simple-viewer-example repo.
			baseUrl: '/cad-data/',
			webworkerFileUrls: {
				// Workers served from /workers/ — works in all environments:
				// Dev: Vite serves static/workers/ at root
				// Build: SvelteKit copies to build/workers/
				// Tauri: frontendDist at build/ serves on tauri.localhost://
				dwgParser: '/workers/libredwg-parser-worker.js',
				mtextRender: '/workers/mtext-renderer-worker.js'
			}
		});
		if (!instance) {
			log.error('CadViewer createInstance returned undefined');
			return false;
		}
		if (!AcApDocManager.instance) {
			log.error('CadViewer instance getter is null after createInstance');
			return false;
		}
		_initialized = true;
		_container = container;
		log.info('CadViewer initialized');
		return true;
	} catch (err) {
		log.error('CadViewer init failed', { error: err instanceof Error ? err.message : String(err) });
		return false;
	}
}

export function isCadViewerReady(): boolean {
	return _initialized && getInstance() !== null;
}

/**
 * Safely get the AcApDocManager instance without throwing.
 * The static getter throws when _instance is null — optional chaining
 * (?. ) does NOT catch thrown errors, only null/undefined returns.
 */
export function getInstance(): AcApDocManager | null {
	try {
		return AcApDocManager.instance;
	} catch {
		return null;
	}
}

export async function openCadDocument(
	fileName: string,
	content: Uint8Array,
	mode: AcEdOpenMode,
	previewTheme?: string | null
): Promise<boolean> {
	if (!isCadViewerReady()) {
		log.error('CadViewer not ready — call initCadViewer first');
		return false;
	}

	// Hoist instance after guard to avoid TOCTOU race after await
	const inst = getInstance();

	// Obtain an unshared ArrayBuffer (WASM requires full buffer ownership).
	// This copies the bytes — unavoidable for WASM interop via embind's
	// dwg_read_data(). A zero-copy fast path could be added for buffers
	// already detached (byteOffset === 0 && byteLength === buffer.byteLength)
	// if large-file DWG performance becomes a reported issue.
	const buffer = content.buffer.slice(
		content.byteOffset,
		content.byteOffset + content.byteLength
	) as ArrayBuffer;

	const options: AcApOpenDatabaseOptions = {
		mode,
		minimumChunkSize: 1000,
		sysVars: {
			lwdisplay: false
		}
	};

	try {
		const success = await inst!.openDocument(fileName, buffer, options);
		if (!success) {
			log.error('CadViewer failed to open document', { fileName });
		}
		return success;
	} catch (err) {
		log.error('CadViewer openDocument error', { fileName, error: err });
		return false;
	}
}

/** Zoom to drawing extents. */
export function cadZoomExtents(): void {
	const inst = getInstance();
	if (!inst) return;
	inst.sendStringToExecute('zoom\\nall');
}

/**
 * Toggle between dark and light background.
 * NOTE: switchbg is a toggle, not a setter. Present in @mlightcad/cad-simple-viewer v1.5+.
 * If unavailable, the command is silently ignored by the library's command processor.
 */
export function cadSwitchBackground(): void {
	getInstance()?.sendStringToExecute('switchbg');
}

/** Toggle line weight display. */
export function cadToggleLineWeight(): void {
	const db = getInstance()?.curDocument?.database;
	if (db) {
		db.lwdisplay = !db.lwdisplay;
	}
}

export function getCadLineWeightEnabled(): boolean {
	return getInstance()?.curDocument?.database?.lwdisplay ?? false;
}

/** Enter pan mode (drag to pan). */
export function cadPan(): void {
	getInstance()?.sendStringToExecute('pan');
}

/** Regenerate/refresh the display. */
export function cadRegen(): void {
	getInstance()?.sendStringToExecute('regen');
}

/** Handle container resize. */
export function cadResize(): void {
	const inst = getInstance();
	if (!inst) return;
	// Call the viewer's onWindowResize method to recalculate size and update the renderer/camera/layout managers.
	// Cast through unknown to bypass TypeScript checks for private/internal methods.
	(inst as unknown as { onWindowResize?: () => void }).onWindowResize?.();
}

/** Measure distance between two points. */
export function cadMeasureDistance(): void {
	getInstance()?.sendStringToExecute('measuredistance');
}

/** Measure area of a polygon. */
export function cadMeasureArea(): void {
	getInstance()?.sendStringToExecute('measurearea');
}

/** Measure angle between two lines. */
export function cadMeasureAngle(): void {
	getInstance()?.sendStringToExecute('measureangle');
}

/** Measure arc length. */
export function cadMeasureArc(): void {
	getInstance()?.sendStringToExecute('measurearc');
}

/**
 * Export viewport as PNG image (canvas capture).
 * Reads the THREE.js renderer canvas directly for reliable frame capture,
 * avoiding the built-in 'pngout' command which can capture before render.
 */
export function cadExportPng(): void {
	const inst = getInstance();
	if (!inst) return;
	const view = inst.curView;
	if (!view) return;
	// Access the Three.js WebGLRenderer through the view's renderer getter
	const renderer = (view as unknown as { renderer?: { domElement?: HTMLCanvasElement } }).renderer;
	if (!renderer) return;
	const canvas = renderer.domElement;
	if (!canvas || typeof canvas.toDataURL !== 'function') return;

	// Force the mlightcad internal render pipeline to produce a frame.
	// The view stores its Three.js scene at _scene.internalScene and exposes
	// the camera via internalCamera. We call _layoutViewManager.render(_scene)
	// to populate the WebGL drawing buffer before capturing.
	const internal = view as unknown as {
		_layoutViewManager?: { render: (scene: unknown) => void };
		_scene?: unknown;
	};
	if (internal._layoutViewManager && internal._scene) {
		internal._layoutViewManager.render(internal._scene);
	}

	const dataUrl = canvas.toDataURL('image/png');
	if (!dataUrl || dataUrl === 'data:,') return;

	const link = document.createElement('a');
	link.download = `drawing-${Date.now()}.png`;
	link.href = dataUrl;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

/** Isolate selected layer (click an entity on the layer to keep visible). */
export function cadIsolateLayers(): void {
	getInstance()?.sendStringToExecute('layiso');
}

/** Restore all hidden layers. */
export function cadUnisolateLayers(): void {
	getInstance()?.sendStringToExecute('layuniso');
}

/** Lock the layer of a selected entity (visible but not editable). */
export function cadLockLayer(): void {
	getInstance()?.sendStringToExecute('laylck');
}

/** Unlock the layer of a selected entity. */
export function cadUnlockLayer(): void {
	getInstance()?.sendStringToExecute('layulk');
}

/** Freeze the layer of a selected entity (hidden). */
export function cadFreezeLayer(): void {
	getInstance()?.sendStringToExecute('layfrz');
}

/** Thaw all frozen layers. */
export function cadThawAllLayers(): void {
	getInstance()?.sendStringToExecute('laythw');
}

/** Turn off the layer of a selected entity. */
export function cadLayerOff(): void {
	getInstance()?.sendStringToExecute('layoff');
}

/** Turn on all layers in the drawing. */
export function cadLayerOn(): void {
	getInstance()?.sendStringToExecute('layon');
}

/** Copy selected entities to a new location (pick base + destination). */
export function cadCopy(): void {
	getInstance()?.sendStringToExecute('copy');
}

/** Move selected entities to a new location (pick from + to). */
export function cadMove(): void {
	getInstance()?.sendStringToExecute('move');
}

/** Rotate selected entities around a base point. */
export function cadRotate(): void {
	getInstance()?.sendStringToExecute('rotate');
}

/** Create a parallel copy at a specified offset distance. */
export function cadOffset(): void {
	getInstance()?.sendStringToExecute('offset');
}

/** Add a permanent linear dimension annotation to the drawing. */
export function cadDimlinear(): void {
	getInstance()?.sendStringToExecute('dimlinear');
}

// ── Layer panel helpers ──────────────────────────────────────────

/** Lightweight layer info for the UI panel. */
export interface LayerInfo {
	name: string;
	colorRgb: string;
	isOff: boolean;
	isLocked: boolean;
	isFrozen: boolean;
}

/** Read all layers from the active document's layer table. */
export function getAllLayers(): LayerInfo[] {
	const inst = getInstance();
	if (!inst) return [];

	const layerTable = inst.curDocument?.database?.tables?.layerTable;
	if (!layerTable) return [];

	const layers: LayerInfo[] = [];
	for (const layer of layerTable.newIterator()) {
		layers.push({
			name: layer.name,
			colorRgb: colorToCss(layer),
			isOff: layer.isOff,
			isLocked: layer.isLocked,
			isFrozen: layer.isFrozen
		});
	}
	return layers;
}

/** Toggle a layer's visibility on/off, then regenerate the view. */
export function toggleLayerVisibility(name: string): void {
	const inst = getInstance();
	if (!inst) return;

	const table = inst.curDocument?.database?.tables?.layerTable;
	if (!table) return;

	const layer = table.getAt(name);
	if (!layer) return;

	layer.isOff = !layer.isOff;
	// If making visible and layer was frozen, thaw it too (frozen trumps isOff)
	if (!layer.isOff && layer.isFrozen) {
		layer.isFrozen = false;
	}
	inst.regen();
}

/** Toggle a layer's locked state, then regenerate the view. */
export function toggleLayerLock(name: string): void {
	const inst = getInstance();
	if (!inst) return;

	const table = inst.curDocument?.database?.tables?.layerTable;
	if (!table) return;

	const layer = table.getAt(name);
	if (!layer) return;

	layer.isLocked = !layer.isLocked;
	inst.regen();
}

/** Convert an AcDbLayerTableRecord's color to CSS rgb() string. */
/** Convert an AcCmColor to a CSS rgb() string. */
function rgbFromColor(color: AcCmColor | null | undefined): string {
	if (!color || color.colorMethod === 0 || color.red === undefined) {
		return 'rgb(255,255,255)';
	}
	return `rgb(${color.red},${color.green},${color.blue})`;
}

function colorToCss(layer: AcDbLayerTableRecord): string {
	return rgbFromColor(layer.color);
}

function entityColorToCss(entity: AcDbEntity): string {
	// Use resolvedColor to handle ByLayer and ByBlock entity colors —
	// entity.color returns the raw AcCmColor (which may be a ByLayer/ByBlock
	// sentinel), while resolvedColor resolves against the layer's actual color.
	return rgbFromColor(entity.resolvedColor);
}

// ── Entity lookup helpers ──────────────────────────────────────────

/** Lightweight entity properties for the UI panel. */
export interface EntityInfo {
	type: string;
	layer: string;
	colorRgb: string;
	lineType: string;
}

/** Look up an entity by its object ID from the model-space entity table. */
export function getEntityById(objectId: string): EntityInfo | null {
	const inst = getInstance();
	if (!inst) return null;

	const modelSpace = inst.curDocument?.database?.tables?.blockTable?.modelSpace;
	if (!modelSpace) return null;

	for (const entity of modelSpace.newIterator()) {
		if ((entity as AcDbEntity).objectId === objectId) {
			const e = entity as AcDbEntity;
			return {
				type: e.type,
				layer: e.layer,
				colorRgb: entityColorToCss(e),
				lineType: e.lineType
			};
		}
	}
	return null;
}

/** Select all entities on the same layer as the given layer name. */
export function cadSelectAllOnLayer(layerName: string): number {
	const inst = getInstance();
	if (!inst) return 0;

	const modelSpace = inst.curDocument?.database?.tables?.blockTable?.modelSpace;
	if (!modelSpace) return 0;

	const view = inst.curView;
	if (!view) return 0;

	const matchingIds: string[] = [];
	for (const entity of modelSpace.newIterator()) {
		const e = entity as AcDbEntity;
		if (e.layer === layerName && e.objectId) {
			matchingIds.push(e.objectId);
		}
	}

	if (matchingIds.length > 0) {
		view.selectionSet.add(matchingIds);
	}
	return matchingIds.length;
}

/** Delete selected entities from the drawing. */
export function cadErase(): void {
	getInstance()?.sendStringToExecute('erase');
}

/** Export drawing as SVG file (auto-downloads). */
/** @returns a promise that resolves once the SVG file has been downloaded. */
export async function cadExportSvg(): Promise<void> {
	const inst = getInstance();
	if (!inst) return;

	// The built-in 'csvg' command generates SVG with fill/color="currentColor"
	// — valid in browsers (CSS inheritance) but invisible in Figma and other
	// design tools that don't evaluate CSS color tokens.
	//
	// We intercept the converter's download method to replace currentColor
	// with explicit black (#000000) so the drawing is visible everywhere.
	try {
		// Dynamic runtime import bypassed via @vite-ignore to prevent Vite from
		// attempting to bundle internal paths from the third-party module.
		// A function constructor is dangerous and can lead to arbitrary code execution.
		const modUrl = '@mlightcad/cad-simple-viewer/lib/command/convert/AcApSvgConvertor.js';
		const mod = await import(/* @vite-ignore */ modUrl);
		const AcApSvgConvertor: new () => {
			convert(): void;
			createFileAndDownloadIt: (svg: string) => void;
			// Storing via Record<string, unknown> to bypass unknown assignment
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} = (mod as any).AcApSvgConvertor;

		const converter = new AcApSvgConvertor();
		const origDownload = (
			converter as unknown as { createFileAndDownloadIt: (svg: string) => void }
		).createFileAndDownloadIt.bind(converter);

		(converter as unknown as Record<string, unknown>).createFileAndDownloadIt = (
			svgContent: string
		) => {
			const fixed = svgContent
				.replace(/fill="currentColor"/g, 'fill="#000000"')
				.replace(/stroke="currentColor"/g, 'stroke="#000000"')
				.replace(/stop-color="currentColor"/g, 'stop-color="#000000"');
			origDownload(fixed);
		};

		converter.convert();
	} catch {
		// Fallback: use the built-in command (will produce SVG with currentColor)
		inst.sendStringToExecute('csvg');
	}
}

/** Export drawing as DXF file (auto-downloads). */
export function cadExportDxf(): void {
	getInstance()?.sendStringToExecute('cdxf');
}

/** Enter selection mode with crosshair cursor. */
export function cadSelect(): void {
	getInstance()?.sendStringToExecute('select');
}

/**
 * Install trackpad two-finger pan on the viewer canvas.
 *
 * macOS trackpad two-finger drag generates `wheel` events instead of touch
 * events. Three.js OrbitControls (used internally by the viewer) treats all
 * wheel events as zoom. This intercepts trackpad-like wheel events (small
 * delta values, pixel mode) and converts them to direct camera pan via the
 * view's `center` property.
 *
 * Mouse scroll-wheel events (large deltas) are left untouched for zoom.
 *
 * Safe to call multiple times — reuses the same canvas element and replaces
 * any previously-installed handler.
 */
export function cadInstallTrackpadPan(): void {
	const inst = getInstance();
	if (!inst) return;
	const view = inst.curView;
	if (!view) return;

	// Get the Three.js renderer's canvas element
	const renderer = (view as unknown as { renderer?: { domElement?: HTMLCanvasElement } }).renderer;
	if (!renderer) return;
	const canvas = renderer.domElement;
	if (!canvas) return;

	// Remove old handler from the canvas that owns it if re-installing.
	if (_trackpadHandler && _trackpadCanvas) {
		_trackpadCanvas.removeEventListener('wheel', _trackpadHandler, {
			capture: true
		} as AddEventListenerOptions);
	}

	_trackpadHandler = (event: WheelEvent) => {
		// Trackpad heuristic: small deltas in DOM_DELTA_PIXEL mode
		// Mouse wheel: large deltas (~50-300+), often in LINE mode
		// Pinch zoom: small deltas + ctrlKey flag (macOS sends ctrlKey=true)
		const absDx = Math.abs(event.deltaX);
		const absDy = Math.abs(event.deltaY);
		const smallDelta = (absDx > 0 && absDx < 30) || (absDy > 0 && absDy < 30);
		// Only intercept two-finger drag (no ctrlKey). Pinch zoom with ctrlKey passes through.
		const isTrackpad =
			smallDelta && event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && !event.ctrlKey;

		if (!isTrackpad) return; // Let mouse wheel and pinch-zoom through for native handling

		event.preventDefault();
		event.stopPropagation();

		const v = inst?.curView;
		if (!v) return;

		// Get the current world center projected to screen pixels
		const centerScreen = v.worldToScreen(v.center);

		// Offset screen center by finger-drag delta (scroll direction:
		// drag right → viewport moves left, matching standard scroll behavior)
		const newScreen = {
			x: centerScreen.x + event.deltaX,
			y: centerScreen.y + event.deltaY
		};

		// Use flyTo instead of center setter because set center only moves the
		// camera position without updating the internal OrbitControls target.
		// flyTo also updates the controls target so the view doesn't snap back
		// on the next interaction (zoom, re-render, etc.).
		const newCenter = v.screenToWorld(newScreen);
		// flyTo properly updates camera position + OrbitControls target.
		// Cast through unknown to access runtime types not in the package chain.
		(
			v as unknown as {
				flyTo: (point: { x: number; y: number }, scale: number) => void;
				internalCamera: { zoom: number };
			}
		).flyTo(newCenter, (v as unknown as { internalCamera: { zoom: number } }).internalCamera.zoom);
	};

	canvas.addEventListener('wheel', _trackpadHandler, { capture: true });
	_trackpadCanvas = canvas;
}

export function destroyCadViewer(): void {
	const inst = getInstance();
	const container = _container;
	if (!inst) {
		_initialized = false;
		_container = null;
		if (_trackpadCanvas && _trackpadHandler) {
			_trackpadCanvas.removeEventListener('wheel', _trackpadHandler, {
				capture: true
			} as AddEventListenerOptions);
		}
		_trackpadCanvas = null;
		_trackpadHandler = null;
		container?.replaceChildren();
		return;
	}
	// Reset state immediately to prevent race with re-mount
	_initialized = false;
	_container = null;
	// Store the destroy promise to prevent race on re-mount
	try {
		_activeDestroyPromise = releaseCadViewerInstance(inst, container).catch((err) => {
			log.error('CadViewer destroy error', { error: err });
		});
	} catch (err) {
		log.error('CadViewer destroy synchronous error', { error: err });
		_activeDestroyPromise = null;
	}
}
