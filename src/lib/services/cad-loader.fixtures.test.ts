import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureManifestEntry = {
	id: string;
	file: string;
	format: string;
	expectedPreviewMode: 'wire' | 'mesh' | 'metadata_only';
	note: string;
};

type FixtureManifest = {
	version: number;
	fixtures: FixtureManifestEntry[];
};

const fixtureDir = join(process.cwd(), 'tests/fixtures/cad');
const fixtureManifest = JSON.parse(
	readFileSync(join(fixtureDir, 'manifest.json'), 'utf8')
) as FixtureManifest;

function readFixtureBytes(file: string) {
	return new Uint8Array(readFileSync(join(fixtureDir, file)));
}

type MockWorkerResponse = {
	success: boolean;
	id: number;
	positions?: Float32Array;
	normals?: Float32Array;
	indices?: Uint32Array;
	vertexCount?: number;
	faceCount?: number;
	bounds?: {
		minX: number;
		minY: number;
		minZ: number;
		maxX: number;
		maxY: number;
		maxZ: number;
	};
	error?: string;
	code?:
		| 'timeout'
		| 'parse_failed'
		| 'read_failed'
		| 'no_transferable_roots'
		| 'transfer_failed'
		| 'no_shape'
		| 'no_previewable_geometry';
};

class MockOcctWorker {
	private readonly listeners = {
		message: new Set<(event: MessageEvent<MockWorkerResponse>) => void>(),
		error: new Set<(event: ErrorEvent) => void>()
	};

	addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
		this.listeners[type].add(listener as never);
	}

	removeEventListener(type: 'message' | 'error', listener: (event: never) => void) {
		this.listeners[type].delete(listener as never);
	}

	postMessage(message: { id: number; data: ArrayBuffer; format: 'step' | 'iges' }) {
		const text = new TextDecoder().decode(new Uint8Array(message.data));
		const response = this.buildResponse(message.id, message.format, text);
		queueMicrotask(() => {
			for (const listener of this.listeners.message) {
				listener({ data: response } as MessageEvent<MockWorkerResponse>);
			}
		});
	}

	private buildResponse(id: number, format: 'step' | 'iges', text: string): MockWorkerResponse {
		if (format === 'step' && text.includes('MESH_FIXTURE_STEP')) {
			return {
				success: true,
				id,
				positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
				normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
				indices: new Uint32Array([0, 1, 2]),
				vertexCount: 3,
				faceCount: 1,
				bounds: {
					minX: 0,
					minY: 0,
					minZ: 0,
					maxX: 10,
					maxY: 10,
					maxZ: 0
				}
			};
		}

		return {
			success: false,
			id,
			code: 'no_transferable_roots',
			error: `${format.toUpperCase()} file contains no transferable roots`
		};
	}
}

describe('CAD fixture manifest', () => {
	it('tracks the expected repo-owned CAD preview support matrix', () => {
		expect(fixtureManifest.version).toBe(1);
		expect(fixtureManifest.fixtures.length).toBeGreaterThanOrEqual(6);
		for (const fixture of fixtureManifest.fixtures) {
			expect(existsSync(join(fixtureDir, fixture.file))).toBe(true);
			expect(fixture.note.length).toBeGreaterThan(10);
		}
	});
});

describe('loadCadFile fixture coverage', () => {
	const originalWorker = globalThis.Worker;

	beforeEach(() => {
		vi.resetModules();
		globalThis.Worker = MockOcctWorker as unknown as typeof Worker;
	});

	afterEach(() => {
		globalThis.Worker = originalWorker;
	});

	it('keeps line-only OBJ fixtures previewable as wire geometry', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('obj_line_wire.obj'), 'obj');
		expect(result.kind).toBe('previewable');
		if (result.kind !== 'previewable') return;
		expect(result.previewMode).toBe('wire');
		expect(result.metadata.edgeCount).toBeGreaterThan(0);
		expect(result.renderBounds.maxX).toBeGreaterThanOrEqual(result.renderBounds.minX);
	});

	it('returns wire preview for the tracked IGES line fixture', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('iges_line_wire.iges'), 'iges');
		expect(result.kind).toBe('previewable');
		if (result.kind !== 'previewable') return;
		expect(result.previewMode).toBe('wire');
		expect(result.metadata.format).toBe('iges');
		expect(result.metadata.edgeCount).toBe(1);
		expect(result.renderBounds.maxX).toBeGreaterThanOrEqual(result.renderBounds.minX);
	});

	it('returns wire preview for the tracked STEP wire fixture', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('step_line_or_polyline_wire.step'), 'step');
		expect(result.kind).toBe('previewable');
		if (result.kind !== 'previewable') return;
		expect(result.previewMode).toBe('wire');
		expect(result.metadata.format).toBe('step');
		expect(result.metadata.edgeCount).toBeGreaterThanOrEqual(2);
		expect(result.renderBounds.maxX).toBeGreaterThanOrEqual(result.renderBounds.minX);
	});

	it('returns previewable mesh for the tracked STEP mesh fixture', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('step_surface_or_solid_mesh.step'), 'step');
		expect(result.kind).toBe('previewable');
		if (result.kind !== 'previewable') return;
		expect(result.previewMode).toBe('mesh');
		expect(result.metadata.faceCount).toBe(1);
		expect(result.renderBounds.maxX).toBe(10);
	});

	it('returns metadata-only for the tracked STEP metadata fixture', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('step_metadata_only.step'), 'step');
		expect(result.kind).toBe('metadata_only');
		if (result.kind !== 'metadata_only') return;
		expect(result.metadata.previewMode).toBe('metadata_only');
		expect(result.metadata.format).toBe('step');
	});

	it('returns metadata-only for the tracked IGES metadata fixture', async () => {
		const { loadCadFile } = await import('./cad-loader');
		const result = await loadCadFile(readFixtureBytes('iges_metadata_only.iges'), 'iges');
		expect(result.kind).toBe('metadata_only');
		if (result.kind !== 'metadata_only') return;
		expect(result.metadata.previewMode).toBe('metadata_only');
		expect(result.metadata.format).toBe('iges');
	});
});
