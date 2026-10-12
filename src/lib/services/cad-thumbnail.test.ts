/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as cadLoader from './cad-loader';
import * as assets from './assets';

vi.mock('./cad-loader', () => ({
	getCadFormat: vi.fn(),
	loadCadFile: vi.fn(),
	getTHREE: vi.fn()
}));

vi.mock('./assets', () => ({
	readVaultFile: vi.fn()
}));

vi.mock('./logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn()
	})
}));

describe('cad-thumbnail', () => {
	let originalCreateObjectURL: typeof URL.createObjectURL;
	let originalCreateElement: typeof document.createElement;
	let mockToBlob: any;
	let getCadThumbnail: any;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();

		const module = await import('./cad-thumbnail');
		getCadThumbnail = module.getCadThumbnail;

		originalCreateObjectURL = globalThis.URL.createObjectURL;
		globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

		mockToBlob = vi.fn((cb, type) => cb(new Blob(['mock'], { type: type || 'image/png' })));

		originalCreateElement = globalThis.document.createElement;
		globalThis.document.createElement = vi.fn((tagName: string) => {
			if (tagName === 'canvas') {
				return {
					width: 200,
					height: 200,
					toBlob: mockToBlob
				} as unknown as HTMLCanvasElement;
			}
			return originalCreateElement.call(globalThis.document, tagName);
		}) as typeof globalThis.document.createElement;

		const mockTHREE = {
			WebGLRenderer: class {
				setSize() {}
				setClearColor() {}
				render() {}
			},
			Scene: class {
				add() {}
			},
			PerspectiveCamera: class {
				position = { set: vi.fn() };
				lookAt() {}
			},
			AmbientLight: class {},
			DirectionalLight: class {
				position = { set: vi.fn() };
			},
			Vector3: class {
				x: number;
				y: number;
				z: number;
				constructor(x = 0, y = 0, z = 0) {
					this.x = x;
					this.y = y;
					this.z = z;
				}
			}
		};
		vi.mocked(cadLoader.getTHREE).mockResolvedValue(mockTHREE as any);
	});

	afterEach(() => {
		globalThis.URL.createObjectURL = originalCreateObjectURL;
		globalThis.document.createElement = originalCreateElement;
	});

	it('returns null if format is unsupported', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue(null);
		const result = await getCadThumbnail('test1.xyz');
		expect(result).toBeNull();
	});

	it('returns null if loadCadFile yields metadata_only', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue('step');
		vi.mocked(assets.readVaultFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
		vi.mocked(cadLoader.loadCadFile).mockResolvedValue({
			kind: 'metadata_only',
			metadata: { format: 'step', sizeBytes: 3 } as any,
			reason: 'mock reason'
		} as cadLoader.CadLoadResult);

		const result = await getCadThumbnail('test2.step');
		expect(result).toBeNull();
	});

	it('handles render failure gracefully', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue('step');
		vi.mocked(assets.readVaultFile).mockRejectedValue(new Error('Read failed'));

		const result = await getCadThumbnail('test3.step');
		expect(result).toBeNull();
	});

	it('renders thumbnail and disposes geometry/materials', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue('step');
		vi.mocked(assets.readVaultFile).mockResolvedValue(new Uint8Array([1, 2, 3]));

		const disposeGeometry = vi.fn();
		const disposeMaterial1 = vi.fn();
		const disposeMaterial2 = vi.fn();

		const mockObject = {
			traverse: (cb: (obj: any) => void) => {
				cb({
					isMesh: true,
					geometry: { dispose: disposeGeometry },
					material: [{ dispose: disposeMaterial1 }, { dispose: disposeMaterial2 }]
				});
				cb({
					isMesh: true,
					geometry: { dispose: disposeGeometry },
					material: { dispose: disposeMaterial1 }
				});
			}
		};

		vi.mocked(cadLoader.loadCadFile).mockResolvedValue({
			kind: 'previewable',
			object: mockObject as any,
			renderBounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }
		} as cadLoader.CadLoadResult);

		const result = await getCadThumbnail('test4.step');

		expect(result).toBe('blob:mock-url');
		expect(disposeGeometry).toHaveBeenCalledTimes(2);
		expect(disposeMaterial1).toHaveBeenCalledTimes(2);
		expect(disposeMaterial2).toHaveBeenCalledTimes(1);
		expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
	});

	it('returns cached result if available', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue('step');
		vi.mocked(assets.readVaultFile).mockResolvedValue(new Uint8Array([1, 2, 3]));

		const mockObject = { traverse: vi.fn() };
		vi.mocked(cadLoader.loadCadFile).mockResolvedValue({
			kind: 'previewable',
			object: mockObject as any,
			renderBounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }
		} as cadLoader.CadLoadResult);

		const result1 = await getCadThumbnail('test5.step');
		expect(result1).toBe('blob:mock-url');
		expect(cadLoader.loadCadFile).toHaveBeenCalledTimes(1);

		// Second call should hit the module-level cache
		const result2 = await getCadThumbnail('test5.step');
		expect(result2).toBe('blob:mock-url');
		expect(cadLoader.loadCadFile).toHaveBeenCalledTimes(1);
	});

	it('deduplicates concurrent requests via inflight queue', async () => {
		vi.mocked(cadLoader.getCadFormat).mockReturnValue('step');

		let resolveReadVaultFile: any;
		const readVaultFilePromise = new Promise((r) => (resolveReadVaultFile = r));

		vi.mocked(assets.readVaultFile).mockImplementation(async () => {
			await readVaultFilePromise;
			return new Uint8Array([1, 2, 3]);
		});

		const mockObject = { traverse: vi.fn() };
		vi.mocked(cadLoader.loadCadFile).mockResolvedValue({
			kind: 'previewable',
			object: mockObject as any,
			renderBounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }
		} as cadLoader.CadLoadResult);

		// Start two requests for the same file simultaneously
		const p1 = getCadThumbnail('test6.step');
		const p2 = getCadThumbnail('test6.step');

		// Unblock the rendering
		resolveReadVaultFile();

		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe('blob:mock-url');
		expect(r2).toBe('blob:mock-url');

		// Should only perform the actual render work once
		expect(assets.readVaultFile).toHaveBeenCalledTimes(1);
		expect(cadLoader.loadCadFile).toHaveBeenCalledTimes(1);
	});
});
