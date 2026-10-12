import { readVaultFile } from './assets';
import { getCadFormat, loadCadFile, getTHREE, type CadLoadResult } from './cad-loader';
import { createLogger } from './logger.js';
import type { Material, Object3D } from 'three';

/** Module-level cache: filePath → object URL of rendered thumbnail. */
const cache = new Map<string, string>();

/** In-flight renders: deduplicates concurrent requests for the same file. */
const inflight = new Map<string, Promise<string | null>>();
const log = createLogger('cadThumbnailService');

/** Thumbnail canvas size (square). */
const THUMB_SIZE = 200;

type ThumbnailMesh = Object3D & {
	isMesh?: boolean;
	geometry?: { dispose(): void };
	material?: Material | Material[];
};

/** Max concurrent CAD thumbnail renders — keeps GPU and worker pressure low. */
const MAX_CONCURRENT = 1;
let active = 0;
const queue: Array<() => void> = [];

function waitForSlot(): Promise<void> {
	if (active < MAX_CONCURRENT) return Promise.resolve();
	return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
	active--;
	if (queue.length > 0) queue.shift()!();
}

/**
 * Get a thumbnail blob URL for a CAD file.
 * Returns cached result instantly if available.
 * Returns null on render failure or unsupported format.
 */
export async function getCadThumbnail(filePath: string): Promise<string | null> {
	const format = getCadFormat(filePath);
	if (!format) return null;

	const cached = cache.get(filePath);
	if (cached) return cached;

	const pending = inflight.get(filePath);
	if (pending) return pending;

	const promise = renderThumbnail(filePath);
	inflight.set(filePath, promise);

	try {
		return await promise;
	} finally {
		inflight.delete(filePath);
	}
}

// ── Singleton offscreen renderer (avoids WebGL context limit) ───────
let _renderer: InstanceType<typeof import('three').WebGLRenderer> | null = null;
let _canvas: HTMLCanvasElement | null = null;

function getRenderer(THREE: typeof import('three')) {
	if (!_renderer) {
		_canvas = document.createElement('canvas');
		_canvas.width = THUMB_SIZE;
		_canvas.height = THUMB_SIZE;
		_renderer = new THREE.WebGLRenderer({
			canvas: _canvas,
			antialias: true,
			preserveDrawingBuffer: true,
			alpha: true
		});
		_renderer.setSize(THUMB_SIZE, THUMB_SIZE);
		_renderer.setClearColor(0x000000, 0);
	}
	return _renderer;
}

async function renderThumbnail(filePath: string): Promise<string | null> {
	await waitForSlot();
	active++;

	try {
		const THREE = await getTHREE();
		const format = getCadFormat(filePath);
		if (!format) return null;

		const data = await readVaultFile(filePath);
		const result: CadLoadResult = await loadCadFile(new Uint8Array(data), format);
		if (result.kind === 'metadata_only') {
			log.info('CAD thumbnail unavailable because file has no drawable geometry', {
				filePath,
				reason: result.reason
			});
			return null;
		}

		// ── Scene setup ─────────────────────────────────────────────
		const scene = new THREE.Scene();
		scene.add(result.object);

		const ambient = new THREE.AmbientLight(0xffffff, 0.6);
		const dir = new THREE.DirectionalLight(0xffffff, 0.8);
		dir.position.set(1, 2, 3);
		scene.add(ambient, dir);

		// ── Camera — isometric-ish angle, fit to loader-provided finite bounds ───────
		const center = new THREE.Vector3(
			(result.renderBounds.minX + result.renderBounds.maxX) / 2,
			(result.renderBounds.minY + result.renderBounds.maxY) / 2,
			(result.renderBounds.minZ + result.renderBounds.maxZ) / 2
		);
		const size = new THREE.Vector3(
			Math.max(0, result.renderBounds.maxX - result.renderBounds.minX),
			Math.max(0, result.renderBounds.maxY - result.renderBounds.minY),
			Math.max(0, result.renderBounds.maxZ - result.renderBounds.minZ)
		);

		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		const camera = new THREE.PerspectiveCamera(40, 1, maxDim * 0.01, maxDim * 100);

		const dist = maxDim * 1.8;
		camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
		camera.lookAt(center);

		// ── Render and capture ──────────────────────────────────────
		const r = getRenderer(THREE);
		r.render(scene, camera);

		const blob = await new Promise<Blob>((resolve, reject) => {
			_canvas!.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
		});

		// ── Dispose loaded 3D object (keep renderer alive) ──────────
		result.object.traverse((child) => {
			const mesh = child as ThumbnailMesh;
			if (mesh.isMesh) {
				mesh.geometry?.dispose();
				if (mesh.material) {
					if (Array.isArray(mesh.material)) {
						mesh.material.forEach((m) => m.dispose());
					} else {
						mesh.material.dispose();
					}
				}
			}
		});

		const url = URL.createObjectURL(blob);
		cache.set(filePath, url);
		return url;
	} catch (e) {
		log.error('Render failed', { filePath, error: e });
		return null;
	} finally {
		releaseSlot();
	}
}
