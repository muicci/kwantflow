import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAD_3MF_PARSE_TIMEOUT_MS, CadLoadError, hasValidGeometryIndex } from './cad-loader';

const cadLoaderSource = readFileSync(join(process.cwd(), 'src/lib/services/cad-loader.ts'), 'utf8');
const occtWorkerSource = readFileSync(
	join(process.cwd(), 'src/lib/workers/occt-worker.ts'),
	'utf8'
);

describe('hasValidGeometryIndex', () => {
	it('accepts missing index buffers', () => {
		expect(hasValidGeometryIndex(3, null)).toBe(true);
	});

	it('accepts valid integer indices within bounds', () => {
		expect(
			hasValidGeometryIndex(4, {
				count: 6,
				array: new Uint16Array([0, 1, 2, 0, 2, 3])
			})
		).toBe(true);
	});

	it('rejects indices outside the available vertex range', () => {
		expect(
			hasValidGeometryIndex(3, {
				count: 3,
				array: new Uint16Array([0, 1, 3])
			})
		).toBe(false);
	});

	it('rejects negative or non-integer index values', () => {
		expect(
			hasValidGeometryIndex(3, {
				count: 3,
				getX(index) {
					return [0, -1, 2.5][index] ?? 0;
				}
			})
		).toBe(false);
	});

	it('uses a bounded timeout for 3MF parsing', () => {
		expect(CAD_3MF_PARSE_TIMEOUT_MS).toBe(10_000);
		expect(cadLoaderSource).toContain('withCadLoadTimeout(');
		expect(cadLoaderSource).toContain("'3MF preview generation'");
	});

	it('routes STEP and IGES through dedicated format drivers', () => {
		expect(cadLoaderSource).toContain('async function loadMeshCadFile(');
		expect(cadLoaderSource).toContain('async function loadBrepCadFile(');
		expect(cadLoaderSource).toContain("case 'step':");
		expect(cadLoaderSource).toContain("case 'iges':");
	});

	it('uses the maintained OCCT import boundary for STEP and IGES files', () => {
		expect(occtWorkerSource).toContain("from 'occt-import-js'");
		expect(occtWorkerSource).toContain('parser.ReadStepFile(bytes, null)');
		expect(occtWorkerSource).toContain('parser.ReadIgesFile(bytes, null)');
		expect(occtWorkerSource).not.toContain('STEPControl_Reader_1');
	});

	it('exports typed CAD load errors and a discriminated preview contract', () => {
		expect(CadLoadError).toBeTypeOf('function');
		expect(cadLoaderSource).toContain('export class CadLoadError extends Error');
		expect(cadLoaderSource).toContain(
			"export type CadPreviewMode = 'mesh' | 'wire' | 'metadata_only';"
		);
		expect(cadLoaderSource).toContain("kind: 'previewable';");
		expect(cadLoaderSource).toContain('renderBounds: CadBounds;');
		expect(cadLoaderSource).toContain("kind: 'metadata_only';");
		expect(cadLoaderSource).toContain('previewMode: CadPreviewMode;');
	});

	it('classifies OCCT root and shape failures with typed worker codes', () => {
		expect(occtWorkerSource).toContain('result.success');
		expect(occtWorkerSource).toContain("'transfer_failed'");
		expect(occtWorkerSource).toContain("'no_previewable_geometry'");
	});

	it('propagates structured OCCT diagnostics through CAD load errors', () => {
		for (const field of [
			'readStatus',
			'modelEntityCount',
			'rootCount',
			'transferCount',
			'parserVersion',
			'format'
		]) {
			expect(occtWorkerSource).toContain(field);
			expect(cadLoaderSource).toContain(field);
		}
	});

	it('falls back to wire or metadata-only preview for STEP and IGES when OCCT cannot build a mesh', () => {
		expect(cadLoaderSource).toContain('parseCadWireframeFallback(data, format)');
		expect(cadLoaderSource).toContain('buildWireCadLoadResult(THREE, format, wireframe)');
		expect(cadLoaderSource).toContain(
			'buildMetadataOnlyCadLoadResult(format, cadError.message, null, {'
		);
		expect(cadLoaderSource).toContain('parseStepWireframe(data)');
		expect(cadLoaderSource).toContain('parseIgesWireframe(data)');
	});

	it('keeps line-only mesh-format files previewable as wire geometry', () => {
		expect(cadLoaderSource).toContain('summary.lineCount');
		expect(cadLoaderSource).not.toContain('Line/point-only files are not supported.');
		expect(cadLoaderSource).toContain("sanitized.summary.meshCount > 0 ? 'mesh' : 'wire'");
	});

	it('drops non-finite CAD geometry before it can reach preview bounds calculations', () => {
		expect(cadLoaderSource).toContain('Discarded CAD geometry with non-finite positions');
		expect(cadLoaderSource).toContain(
			'Recovered CAD mesh by dropping non-finite triangles during sanitisation'
		);
		expect(cadLoaderSource).toContain(
			'if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))'
		);
		expect(cadLoaderSource).toContain('buildFiniteMeshTrianglePositions');
		expect(cadLoaderSource).toContain('This CAD file does not contain safe drawable geometry.');
		expect(cadLoaderSource).toContain('buildFiniteWirePositions');
	});

	it('normalises rogue STL trailer lines before parsing OBJ files', () => {
		expect(cadLoaderSource).toContain('function normaliseObjSourceText(text: string)');
		expect(cadLoaderSource).toContain(
			'/^\\s*(solid|endsolid|facet\\s+normal|outer\\s+loop|endloop|endfacet)\\b/i'
		);
	});
});
