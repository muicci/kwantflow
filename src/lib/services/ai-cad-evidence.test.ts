import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetFile } from '$lib/types/index.js';
import { _testExports } from './ai-cad-evidence.js';

const {
	mockReadVaultFile,
	mockLoadCadFile,
	mockGetTHREE,
	mockGetDerivedPreview,
	mockDisposeDerivedPreview
} = vi.hoisted(() => ({
	mockReadVaultFile: vi.fn(),
	mockLoadCadFile: vi.fn(),
	mockGetTHREE: vi.fn(),
	mockGetDerivedPreview: vi.fn(),
	mockDisposeDerivedPreview: vi.fn()
}));

vi.mock('$lib/constants/index.js', () => ({
	getGeneralFilePreviewKind: (filePath: string) => (filePath.endsWith('.dxf') ? 'dxf' : 'cad')
}));

vi.mock('./assets.js', () => ({
	readVaultFile: mockReadVaultFile
}));

vi.mock('./cad-loader.js', async () => {
	const actual = await vi.importActual<typeof import('./cad-loader.js')>('./cad-loader.js');
	return {
		...actual,
		getCadFormat: (filePath: string) =>
			filePath.endsWith('.step') ? 'step' : filePath.endsWith('.iges') ? 'iges' : null,
		loadCadFile: mockLoadCadFile,
		getTHREE: mockGetTHREE
	};
});

vi.mock('./derived-previews.js', () => ({
	getDerivedPreview: mockGetDerivedPreview,
	disposeDerivedPreview: mockDisposeDerivedPreview,
	sanitiseSvgMarkup: (svg: string) => svg,
	parseSvgDimensions: (svg: string, fallback = 768) => {
		// Minimal viewBox-first parser for tests — mirrors shared utility logic
		const match = /viewBox="[\d.,\s]+"/.exec(svg);
		if (match) {
			const parts = match[0]
				.replace('viewBox="', '')
				.replace('"', '')
				.split(/[\s,]+/)
				.map(Number);
			if (parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] };
		}
		const w = Number.parseFloat(/width="([^"]+)"/.exec(svg)?.[1] ?? '');
		const h = Number.parseFloat(/height="([^"]+)"/.exec(svg)?.[1] ?? '');
		if (w > 0 && h > 0) return { width: w, height: h };
		return { width: fallback, height: fallback };
	}
}));

function createAssetFile(
	overrides: Partial<AssetFile> &
		Pick<AssetFile, 'id' | 'project_id' | 'file_path' | 'original_name'>
): AssetFile {
	return {
		asset_id: null,
		mime_type: null,
		created_at: '2026-04-04T00:00:00Z',
		...overrides
	};
}

function createFakeThree(rendererLifecycle?: {
	constructed: () => void;
	disposed: () => void;
	contextLost: () => void;
}) {
	class BufferAttribute {
		constructor(
			public array: ArrayLike<number>,
			public itemSize: number
		) {}
	}

	class BufferGeometry {
		attributes: Record<string, unknown> = {};
		index: unknown = null;
		setAttribute(name: string, attribute: unknown) {
			this.attributes[name] = attribute;
		}
		setIndex(index: unknown) {
			this.index = index;
		}
		dispose() {}
	}

	class Scene {
		add() {}
	}

	class AmbientLight {
		constructor() {}
	}

	class DirectionalLight {
		position = { set() {} };
		constructor() {}
	}

	class Vector3 {
		x = 0;
		y = 0;
		z = 0;
		set(x: number, y: number, z: number) {
			this.x = x;
			this.y = y;
			this.z = z;
		}
	}

	class Box3 {
		setFromObject() {
			return this;
		}
		getCenter(target: Vector3) {
			target.set(0, 0, 0);
			return target;
		}
		getSize(target: Vector3) {
			target.set(20, 10, 5);
			return target;
		}
	}

	class PerspectiveCamera {
		position = { set() {} };
		constructor() {}
		lookAt() {}
	}

	class WebGLRenderer {
		renderLists = { dispose() {} };
		constructor() {
			rendererLifecycle?.constructed();
		}
		setSize() {}
		setClearColor() {}
		render() {}
		dispose() {
			rendererLifecycle?.disposed();
		}
		forceContextLoss() {
			rendererLifecycle?.contextLost();
		}
	}

	class MeshStandardMaterial {
		dispose() {}
	}

	class LineBasicMaterial {
		dispose() {}
	}

	class Mesh {
		constructor(
			public geometry: BufferGeometry,
			public material: { dispose(): void }
		) {}
	}

	class LineSegments {
		constructor(
			public geometry: BufferGeometry,
			public material: { dispose(): void }
		) {}
	}

	class Group {
		children: unknown[] = [];
		add(child: unknown) {
			this.children.push(child);
		}
		traverse(callback: (child: unknown) => void) {
			for (const child of this.children) callback(child);
		}
	}

	return {
		Scene,
		AmbientLight,
		DirectionalLight,
		BufferGeometry,
		BufferAttribute,
		Box3,
		Vector3,
		PerspectiveCamera,
		WebGLRenderer,
		MeshStandardMaterial,
		LineBasicMaterial,
		Mesh,
		LineSegments,
		Group,
		Color: { NAMES: { slategray: 0x708090 } }
	};
}

describe('ai cad evidence', () => {
	let dataUrlCounter = 0;

	beforeEach(() => {
		_testExports.clearCache();
		mockReadVaultFile.mockReset();
		mockLoadCadFile.mockReset();
		mockGetTHREE.mockReset();
		mockGetDerivedPreview.mockReset();
		mockDisposeDerivedPreview.mockReset();
		dataUrlCounter = 0;

		vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
			if (tagName === 'canvas') {
				return {
					width: 0,
					height: 0,
					getContext: () => ({
						fillStyle: '#ffffff',
						fillRect() {},
						drawImage() {}
					}),
					toDataURL: () => `data:image/png;base64,render-${++dataUrlCounter}`
				} as unknown as HTMLCanvasElement;
			}

			return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
		});

		globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
		globalThis.URL.revokeObjectURL = vi.fn();
		globalThis.Image = class MockImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		} as unknown as typeof Image;
	});

	it('builds four WebP render views for previewable CAD evidence', async () => {
		const fakeThree = createFakeThree();
		mockGetTHREE.mockResolvedValue(fakeThree);
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockLoadCadFile.mockResolvedValue({
			kind: 'previewable',
			previewMode: 'mesh',
			renderBounds: {
				minX: 0,
				minY: 0,
				minZ: 0,
				maxX: 20,
				maxY: 10,
				maxZ: 5
			},
			object: {
				traverse(callback: (child: unknown) => void) {
					callback({
						isMesh: true,
						geometry: { dispose() {} },
						material: { dispose() {} }
					});
				}
			},
			metadata: {
				format: 'step',
				previewMode: 'mesh',
				vertexCount: 12,
				faceCount: 6,
				edgeCount: 0,
				dimensions: { x: 20, y: 10, z: 5 },
				rootCount: 2,
				transferCount: 2,
				entityCount: null,
				sourceSummary: null
			}
		});

		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');
		const result = await buildEstimateAiCadEvidence(
			createAssetFile({
				id: 'cad-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/frame.step',
				original_name: 'frame.step'
			})
		);

		expect(result.extractionMode).toBe('cad_renders');
		expect(result.metadata.renderPolicyVersion).toBe('cad-render-v4');
		expect(result.metadata.renderCount).toBe(4);
		expect(result.metadata.renderSize).toBe(768);
		expect(result.metadata.viewLabels).toEqual(['iso', 'front', 'top', 'side']);
		expect(result.renders.map((render) => render.viewLabel)).toEqual([
			'iso',
			'front',
			'top',
			'side'
		]);
		expect(result.renders.every((render) => render.mimeType === 'image/jpeg')).toBe(true);
		expect(result.summaryText).toContain('Rendered 4 shaded views');
	});

	it('deduplicates concurrent preparation and reuses bounded in-memory CAD evidence', async () => {
		const fakeThree = createFakeThree();
		mockGetTHREE.mockResolvedValue(fakeThree);
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockLoadCadFile.mockResolvedValue({
			kind: 'metadata_only',
			reason: 'metadata only',
			metadata: {
				format: 'step',
				previewMode: 'metadata_only',
				vertexCount: 0,
				faceCount: 0,
				edgeCount: 0,
				dimensions: null,
				rootCount: 0,
				transferCount: 0,
				entityCount: null,
				sourceSummary: null
			}
		});
		const file = createAssetFile({
			id: 'cad-cache',
			project_id: 'project-1',
			file_path: 'workspace/project-1/cache.step',
			original_name: 'cache.step'
		});
		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');

		const [first, second] = await Promise.all([
			buildEstimateAiCadEvidence(file),
			buildEstimateAiCadEvidence(file)
		]);
		const third = await buildEstimateAiCadEvidence(file);

		expect(first).toBe(second);
		expect(second).toBe(third);
		expect(mockReadVaultFile).toHaveBeenCalledTimes(1);
		expect(mockLoadCadFile).toHaveBeenCalledTimes(1);
	});

	it('reuses one evidence WebGL context across files and releases it at the lifecycle boundary', async () => {
		const rendererLifecycle = {
			constructed: vi.fn(),
			disposed: vi.fn(),
			contextLost: vi.fn()
		};
		mockGetTHREE.mockResolvedValue(createFakeThree(rendererLifecycle));
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockLoadCadFile.mockImplementation(async () => ({
			kind: 'previewable',
			previewMode: 'mesh',
			renderBounds: { minX: 0, minY: 0, minZ: 0, maxX: 20, maxY: 10, maxZ: 5 },
			object: {
				traverse(callback: (child: unknown) => void) {
					callback({
						isMesh: true,
						geometry: { dispose() {} },
						material: { dispose() {} }
					});
				}
			},
			metadata: {
				format: 'step',
				previewMode: 'mesh',
				vertexCount: 12,
				faceCount: 6,
				edgeCount: 0,
				dimensions: { x: 20, y: 10, z: 5 },
				rootCount: 1,
				transferCount: 1,
				entityCount: null,
				sourceSummary: null
			}
		}));

		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');
		await buildEstimateAiCadEvidence(
			createAssetFile({
				id: 'cad-reuse-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/reuse-1.step',
				original_name: 'reuse-1.step'
			})
		);
		await buildEstimateAiCadEvidence(
			createAssetFile({
				id: 'cad-reuse-2',
				project_id: 'project-1',
				file_path: 'workspace/project-1/reuse-2.step',
				original_name: 'reuse-2.step'
			})
		);

		expect(rendererLifecycle.constructed).toHaveBeenCalledTimes(1);
		expect(rendererLifecycle.disposed).not.toHaveBeenCalled();
		_testExports.disposeRenderer();
		expect(rendererLifecycle.disposed).toHaveBeenCalledTimes(1);
		expect(rendererLifecycle.contextLost).toHaveBeenCalledTimes(1);
	});

	it('keeps metadata-only CAD evidence usable without renders', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockLoadCadFile.mockResolvedValue({
			kind: 'metadata_only',
			reason: 'STEP file contains no transferable roots',
			metadata: {
				format: 'step',
				previewMode: 'metadata_only',
				vertexCount: 0,
				faceCount: 0,
				edgeCount: 0,
				dimensions: null,
				rootCount: 0,
				transferCount: 0,
				entityCount: null,
				sourceSummary: 'STEP content appears to contain placements or references only.'
			}
		});

		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');
		const result = await buildEstimateAiCadEvidence(
			createAssetFile({
				id: 'cad-2',
				project_id: 'project-1',
				file_path: 'workspace/project-1/layout.step',
				original_name: 'layout.step'
			})
		);

		expect(result.extractionMode).toBe('cad_metadata');
		expect(result.renders).toEqual([]);
		expect(result.metadata.renderPolicyVersion).toBe('cad-render-v4');
		expect(result.metadata.renderSize).toBeNull();
		expect(result.metadata.viewLabels).toEqual([]);
		expect(result.metadata.rootCount).toBe(0);
		expect(result.metadata.transferCount).toBe(0);
		expect(result.summaryText).toContain('No drawable geometry was available');
		expect(result.summaryText).toContain('Transfer roots detected: 0');
	});

	it('rasterises DXF drawing evidence into a WebP render', async () => {
		mockGetDerivedPreview.mockResolvedValue({
			kind: 'dxf',
			svg: '<svg viewBox="0 0 100 50"></svg>',
			svgUrl: 'blob:dxf',
			entityCount: 12
		});

		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');
		const result = await buildEstimateAiCadEvidence(
			createAssetFile({
				id: 'dxf-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/layout.dxf',
				original_name: 'layout.dxf',
				mime_type: 'image/vnd.dxf'
			})
		);

		expect(result.extractionMode).toBe('cad_renders');
		expect(result.renders).toHaveLength(1);
		expect(result.renders[0]).toMatchObject({
			viewLabel: 'drawing',
			mimeType: 'image/jpeg'
		});
		expect(result.metadata.renderPolicyVersion).toBe('cad-render-v4');
		expect(result.metadata.renderSize).toBe(768);
		expect(result.metadata.viewLabels).toEqual(['drawing']);
		expect(result.metadata.entityCount).toBe(12);
		expect(mockDisposeDerivedPreview).toHaveBeenCalledTimes(1);
	});
});

describe('parseSvgDimensions', () => {
	it('parses space-separated viewBox dimensions', () => {
		expect(_testExports.parseSvgDimensions('<svg viewBox="0 0 100 50"></svg>')).toEqual({
			width: 100,
			height: 50
		});
	});

	it('parses comma-separated viewBox dimensions', () => {
		expect(_testExports.parseSvgDimensions('<svg viewBox="0,0,200,150"></svg>')).toEqual({
			width: 200,
			height: 150
		});
	});

	it('parses mixed space and comma separated viewBox dimensions', () => {
		expect(_testExports.parseSvgDimensions('<svg viewBox="0, 0, 300 250"></svg>')).toEqual({
			width: 300,
			height: 250
		});
	});

	it('falls back to width and height attributes when viewBox is missing', () => {
		expect(_testExports.parseSvgDimensions('<svg width="400" height="300"></svg>')).toEqual({
			width: 400,
			height: 300
		});
	});

	it('falls back to width and height attributes if viewBox is invalid', () => {
		expect(
			_testExports.parseSvgDimensions('<svg viewBox="invalid" width="500" height="450"></svg>')
		).toEqual({ width: 500, height: 450 });
		expect(
			_testExports.parseSvgDimensions('<svg viewBox="0 0 -10 -20" width="500" height="450"></svg>')
		).toEqual({ width: 500, height: 450 });
	});

	it('falls back to default dimensions when SVG is invalid or missing dimensions', () => {
		const expectedDefault = { width: 768, height: 768 }; // DXF_RENDER_SIZE

		// Empty SVG tag
		expect(_testExports.parseSvgDimensions('<svg></svg>')).toEqual(expectedDefault);

		// Negative width/height
		expect(_testExports.parseSvgDimensions('<svg width="-100" height="50"></svg>')).toEqual(
			expectedDefault
		);

		// Non-numeric attributes
		expect(_testExports.parseSvgDimensions('<svg width="auto" height="100%"></svg>')).toEqual(
			expectedDefault
		);

		// Malformed SVG
		expect(_testExports.parseSvgDimensions('not an svg')).toEqual(expectedDefault);
	});
});
