/**
 * OCCT Web Worker — imports STEP/IGES geometry off the main thread.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// @ts-expect-error occt-import-js does not publish TypeScript declarations
import createOC from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

type OcctFormat = 'step' | 'iges';
const PARSER_VERSION = 'occt-import-js@0.0.23';

interface WorkerRequest {
	id: number;
	data: ArrayBuffer;
	format: OcctFormat;
}

interface OcctDiagnostics {
	readStatus: number | null;
	modelEntityCount: number | null;
	rootCount: number | null;
	transferCount: number | null;
	parserVersion: string;
	format: OcctFormat;
}

interface ImportedMesh {
	attributes?: {
		position?: { array?: number[] };
		normal?: { array?: number[] };
	};
	index?: { array?: number[] };
}

interface ImportResult {
	success: boolean;
	root?: {
		children?: unknown[];
	};
	meshes?: ImportedMesh[];
}

interface WorkerSuccess extends OcctDiagnostics {
	success: true;
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	vertexCount: number;
	faceCount: number;
	bounds: {
		minX: number;
		minY: number;
		minZ: number;
		maxX: number;
		maxY: number;
		maxZ: number;
	};
}

interface WorkerFailure extends Partial<OcctDiagnostics> {
	success: false;
	error: string;
	code:
		| 'parse_failed'
		| 'read_failed'
		| 'no_transferable_roots'
		| 'transfer_failed'
		| 'no_shape'
		| 'no_previewable_geometry';
}

let oc: any = null;

async function initOC(): Promise<any> {
	if (oc) return oc;
	oc = await createOC({
		locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path)
	});
	return oc;
}

let processing: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	processing = processing.then(() => handleMessage(event));
};

async function handleMessage(event: MessageEvent<WorkerRequest>): Promise<void> {
	const { id, data, format } = event.data;
	try {
		const parser = await initOC();
		const bytes = new Uint8Array(data);
		const result: ImportResult =
			format === 'step' ? parser.ReadStepFile(bytes, null) : parser.ReadIgesFile(bytes, null);
		const payload = buildWorkerSuccess(result, format);
		self.postMessage(
			{ ...payload, id },
			{ transfer: [payload.positions.buffer, payload.normals.buffer, payload.indices.buffer] }
		);
	} catch (error) {
		const payload: WorkerFailure & { id: number } = {
			success: false,
			id,
			code: getWorkerErrorCode(error),
			error: error instanceof Error ? error.message : 'Unknown OCCT error',
			readStatus: null,
			modelEntityCount: null,
			rootCount: null,
			transferCount: null,
			parserVersion: PARSER_VERSION,
			format
		};
		self.postMessage(payload);
	}
}

function createWorkerCadError(code: WorkerFailure['code'], message: string) {
	const error = new Error(message) as Error & { code: WorkerFailure['code'] };
	error.code = code;
	return error;
}

function getWorkerErrorCode(error: unknown): WorkerFailure['code'] {
	if (typeof error === 'object' && error !== null && 'code' in error) {
		const code = (error as { code?: unknown }).code;
		if (
			code === 'parse_failed' ||
			code === 'read_failed' ||
			code === 'no_transferable_roots' ||
			code === 'transfer_failed' ||
			code === 'no_shape' ||
			code === 'no_previewable_geometry'
		) {
			return code;
		}
	}
	return 'parse_failed';
}

function buildWorkerSuccess(result: ImportResult, format: OcctFormat): WorkerSuccess {
	if (!result.success) {
		throw createWorkerCadError(
			'transfer_failed',
			`Failed to import ${format.toUpperCase()} geometry`
		);
	}

	const meshes = result.meshes ?? [];
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	let vertexOffset = 0;

	for (const mesh of meshes) {
		const meshPositions = mesh.attributes?.position?.array ?? [];
		const meshNormals = mesh.attributes?.normal?.array ?? [];
		const meshIndices = mesh.index?.array ?? [];
		positions.push(...meshPositions);
		if (meshNormals.length === meshPositions.length) {
			normals.push(...meshNormals);
		} else {
			normals.push(...new Array(meshPositions.length).fill(0));
		}
		indices.push(...meshIndices.map((index) => index + vertexOffset));
		vertexOffset += meshPositions.length / 3;
	}

	if (positions.length === 0 || indices.length === 0) {
		throw createWorkerCadError('no_previewable_geometry', 'CAD import produced no triangle mesh');
	}

	const positionArray = new Float32Array(positions);
	const normalArray = new Float32Array(normals);
	const indexArray = new Uint32Array(indices);
	const bounds = calculateBounds(positionArray);

	return {
		success: true,
		positions: positionArray,
		normals: normalArray,
		indices: indexArray,
		vertexCount: positionArray.length / 3,
		faceCount: indexArray.length / 3,
		readStatus: null,
		modelEntityCount: null,
		rootCount: countRootNodes(result.root),
		transferCount: meshes.length,
		parserVersion: PARSER_VERSION,
		format,
		bounds
	};
}

function countRootNodes(root: ImportResult['root']): number | null {
	if (!root) return null;
	return root.children?.length ?? 1;
}

function calculateBounds(positions: Float32Array): WorkerSuccess['bounds'] {
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index];
		const y = positions[index + 1];
		const z = positions[index + 2];
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		maxZ = Math.max(maxZ, z);
	}

	return { minX, minY, minZ, maxX, maxY, maxZ };
}
