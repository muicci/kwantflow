import type { BufferGeometry, Group, Material, Object3D } from 'three';
import { createLogger } from './logger.js';

// Cached Three.js module — avoids re-evaluation on every load
let _THREE: typeof import('three') | null = null;

/** Get the cached Three.js module, importing it on first call. */
export async function getTHREE() {
	if (!_THREE) _THREE = await import('three');
	return _THREE;
}

export type CadFormat = 'stl' | 'obj' | '3mf' | 'step' | 'iges' | 'dwg';
export type CadPreviewMode = 'mesh' | 'wire' | 'metadata_only';

export interface CadMetadata {
	vertexCount: number;
	faceCount: number;
	edgeCount: number;
	dimensions: { x: number; y: number; z: number } | null;
	format: CadFormat;
	previewMode: CadPreviewMode;
	rootCount: number | null;
	transferCount: number | null;
	entityCount: number | null;
	sourceSummary: string | null;
}

export interface PreviewableCadLoadResult {
	kind: 'previewable';
	previewMode: Extract<CadPreviewMode, 'mesh' | 'wire'>;
	object: Group;
	renderBounds: CadBounds;
	metadata: CadMetadata;
}

export interface MetadataOnlyCadLoadResult {
	kind: 'metadata_only';
	metadata: CadMetadata;
	reason: string;
}

export type CadLoadResult = PreviewableCadLoadResult | MetadataOnlyCadLoadResult;

export type CadLoadErrorCode =
	| 'timeout'
	| 'parse_failed'
	| 'read_failed'
	| 'no_transferable_roots'
	| 'transfer_failed'
	| 'no_shape'
	| 'no_previewable_geometry';

export class CadLoadError extends Error {
	code: CadLoadErrorCode;
	diagnostics?: {
		readStatus?: number | null;
		modelEntityCount?: number | null;
		rootCount?: number | null;
		transferCount?: number | null;
		parserVersion?: string;
		format?: 'step' | 'iges';
	};

	constructor(
		code: CadLoadErrorCode,
		message: string,
		options?: {
			cause?: unknown;
			diagnostics?: {
				readStatus?: number | null;
				modelEntityCount?: number | null;
				rootCount?: number | null;
				transferCount?: number | null;
				parserVersion?: string;
				format?: 'step' | 'iges';
			};
		}
	) {
		super(message, options);
		this.name = 'CadLoadError';
		this.code = code;
		this.diagnostics = options?.diagnostics;
	}
}

type TraversableMesh = Object3D & {
	isMesh?: boolean;
	isLine?: boolean;
	isPoints?: boolean;
	parent?: Object3D & { remove(...object: Object3D[]): void };
	geometry?: BufferGeometry & {
		attributes?: {
			position?: {
				count: number;
				getX(index: number): number;
				getY(index: number): number;
				getZ(index: number): number;
			};
			normal?: {
				count: number;
				getX(index: number): number;
				getY(index: number): number;
				getZ(index: number): number;
			};
		};
		index?: {
			count: number;
			array?: ArrayLike<number>;
			getX?(index: number): number;
		};
		computeVertexNormals?: () => void;
		setIndex?: (index: null) => void;
		deleteAttribute?: (name: string) => void;
		setAttribute?: (name: string, attribute: BufferGeometry['attributes'][string]) => void;
	};
	material?: Material | Material[];
};

type MaterialWithOptionalLineWidths = Material & {
	linewidth?: number;
	wireframeLinewidth?: number;
};

export type CadBounds = {
	minX: number;
	minY: number;
	minZ: number;
	maxX: number;
	maxY: number;
	maxZ: number;
};

const log = createLogger('cadLoader');

type CadGeometrySummary = {
	meshCount: number;
	lineCount: number;
	vertexCount: number;
	faceCount: number;
	edgeCount: number;
	bounds: CadBounds | null;
	rootCount?: number | null;
	transferCount?: number | null;
	readStatus?: number | null;
	modelEntityCount?: number | null;
	parserVersion?: string;
	format?: 'step' | 'iges';
	entityCount?: number | null;
	sourceSummary?: string | null;
};

type WireframeGeometryData = {
	positions: Float32Array;
	edgeCount: number;
	bounds: CadBounds | null;
	entityCount: number | null;
	sourceSummary: string | null;
};

export const CAD_3MF_PARSE_TIMEOUT_MS = 10_000;

const FORMAT_MAP: Record<string, CadFormat> = {
	stl: 'stl',
	obj: 'obj',
	'3mf': '3mf',
	step: 'step',
	stp: 'step',
	iges: 'iges',
	igs: 'iges',
	dwg: 'dwg'
};

/**
 * Returns the supported CAD format for a file path, or null if unsupported.
 * Tier 1: STL, OBJ, 3MF (Three.js loaders).
 * Tier 2: STEP, IGES (opencascade.js WASM via Web Worker).
 * DWG/SLDPRT return null (no viable browser parser).
 */
export function getCadFormat(filePath: string): CadFormat | null {
	const ext = filePath.split('.').pop()?.toLowerCase() || '';
	return FORMAT_MAP[ext] ?? null;
}

function createDefaultCadMaterial(THREE: typeof import('three')) {
	return new THREE.MeshStandardMaterial({
		color: 0x8899aa,
		metalness: 0.3,
		roughness: 0.6
	});
}

function createDefaultWireMaterial(THREE: typeof import('three')) {
	return new THREE.LineBasicMaterial({
		color: THREE.Color.NAMES.slategray ?? 0x708090,
		transparent: true,
		opacity: 0.9
	});
}

export function hasValidGeometryIndex(
	positionCount: number,
	index:
		| {
				count: number;
				array?: ArrayLike<number>;
				getX?(index: number): number;
		  }
		| null
		| undefined
): boolean {
	if (!index) return true;
	for (let i = 0; i < index.count; i++) {
		const value = index.getX ? index.getX(i) : index.array?.[i];
		if (
			typeof value !== 'number' ||
			!Number.isInteger(value) ||
			value < 0 ||
			value >= positionCount
		) {
			return false;
		}
	}
	return true;
}

function sanitizeCadObject(
	object: Group,
	THREE: typeof import('three')
): { object: Group; summary: CadGeometrySummary } {
	let meshCount = 0;
	let lineCount = 0;
	let vertexCount = 0;
	let faceCount = 0;
	let edgeCount = 0;
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	object.traverse((child) => {
		const node = child as TraversableMesh;
		if (node.isPoints) {
			node.parent?.remove(node);
			return;
		}

		if (!node.isMesh && !node.isLine) return;

		const geometry = node.geometry;
		const positionCount = geometry?.attributes?.position?.count;
		if (!geometry || !positionCount) {
			node.parent?.remove(node);
			return;
		}

		if (node.isMesh && !hasValidGeometryIndex(positionCount, geometry.index)) {
			geometry.setIndex?.(null);
		}

		if (
			node.isMesh &&
			!geometry.attributes?.normal &&
			typeof geometry.computeVertexNormals === 'function'
		) {
			geometry.computeVertexNormals();
		}

		let positions = geometry.attributes?.position;
		if (!positions) {
			node.parent?.remove(node);
			return;
		}

		let workingPositionCount = positionCount;
		let finiteScan = scanFinitePositionBounds(positions, workingPositionCount);
		if (!finiteScan.hasFinitePositions && node.isMesh && !geometry.index) {
			const salvagedPositions = buildFiniteMeshTrianglePositions(positions, workingPositionCount);
			if (salvagedPositions.length > 0) {
				geometry.setAttribute?.(
					'position',
					new THREE.BufferAttribute(salvagedPositions, 3) as BufferGeometry['attributes'][string]
				);
				geometry.deleteAttribute?.('normal');
				geometry.setIndex?.(null);
				if (typeof geometry.computeVertexNormals === 'function') {
					geometry.computeVertexNormals();
				}
				positions = geometry.attributes?.position;
				workingPositionCount = positions?.count ?? 0;
				finiteScan = positions
					? scanFinitePositionBounds(positions, workingPositionCount)
					: {
							hasFinitePositions: false,
							nodeMinX: Infinity,
							nodeMinY: Infinity,
							nodeMinZ: Infinity,
							nodeMaxX: -Infinity,
							nodeMaxY: -Infinity,
							nodeMaxZ: -Infinity
						};
				if (finiteScan.hasFinitePositions) {
					log.info('Recovered CAD mesh by dropping non-finite triangles during sanitisation', {
						nodeType: 'mesh',
						removedVertexCount: positionCount - workingPositionCount
					});
				}
			}
		}

		if (!finiteScan.hasFinitePositions) {
			log.warn('Discarded CAD geometry with non-finite positions', {
				nodeType: node.isMesh ? 'mesh' : node.isLine ? 'line' : 'unknown'
			});
			node.parent?.remove(node);
			return;
		}
		const { nodeMinX, nodeMinY, nodeMinZ, nodeMaxX, nodeMaxY, nodeMaxZ } = finiteScan;
		if (nodeMinX < minX) minX = nodeMinX;
		if (nodeMaxX > maxX) maxX = nodeMaxX;
		if (nodeMinY < minY) minY = nodeMinY;
		if (nodeMaxY > maxY) maxY = nodeMaxY;
		if (nodeMinZ < minZ) minZ = nodeMinZ;
		if (nodeMaxZ > maxZ) maxZ = nodeMaxZ;

		if (node.isMesh) {
			meshCount++;
			if (!node.material || (Array.isArray(node.material) && node.material.length === 0)) {
				node.material = createDefaultCadMaterial(THREE);
			}
		} else if (node.isLine) {
			lineCount++;
			if (!node.material || (Array.isArray(node.material) && node.material.length === 0)) {
				node.material = createDefaultWireMaterial(THREE);
			}
		}

		const materials = (
			Array.isArray(node.material) ? node.material : [node.material]
		) as MaterialWithOptionalLineWidths[];
		for (const material of materials) {
			if (
				typeof material.linewidth === 'number' &&
				(!Number.isFinite(material.linewidth) || material.linewidth <= 0)
			) {
				material.linewidth = 1;
			}
			if (
				typeof material.wireframeLinewidth === 'number' &&
				(!Number.isFinite(material.wireframeLinewidth) || material.wireframeLinewidth <= 0)
			) {
				material.wireframeLinewidth = 1;
			}
		}

		vertexCount += workingPositionCount;
		if (node.isMesh) {
			if (geometry.index) {
				faceCount += geometry.index.count / 3;
			} else {
				faceCount += workingPositionCount / 3;
			}
		}

		if (node.isLine) {
			if (geometry.index) {
				edgeCount += geometry.index.count / 2;
			} else {
				edgeCount += Math.max(0, workingPositionCount - 1);
			}
		}
	});

	return {
		object,
		summary: {
			meshCount,
			lineCount,
			vertexCount,
			faceCount: Math.round(faceCount),
			edgeCount,
			bounds: vertexCount > 0 ? { minX, minY, minZ, maxX, maxY, maxZ } : null
		}
	};
}

function scanFinitePositionBounds(
	positions: {
		count: number;
		getX(index: number): number;
		getY(index: number): number;
		getZ(index: number): number;
	},
	positionCount: number
): {
	hasFinitePositions: boolean;
	nodeMinX: number;
	nodeMinY: number;
	nodeMinZ: number;
	nodeMaxX: number;
	nodeMaxY: number;
	nodeMaxZ: number;
} {
	let nodeMinX = Infinity;
	let nodeMinY = Infinity;
	let nodeMinZ = Infinity;
	let nodeMaxX = -Infinity;
	let nodeMaxY = -Infinity;
	let nodeMaxZ = -Infinity;
	for (let i = 0; i < positionCount; i += 1) {
		const x = positions.getX(i);
		const y = positions.getY(i);
		const z = positions.getZ(i);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			return {
				hasFinitePositions: false,
				nodeMinX,
				nodeMinY,
				nodeMinZ,
				nodeMaxX,
				nodeMaxY,
				nodeMaxZ
			};
		}
		if (x < nodeMinX) nodeMinX = x;
		if (x > nodeMaxX) nodeMaxX = x;
		if (y < nodeMinY) nodeMinY = y;
		if (y > nodeMaxY) nodeMaxY = y;
		if (z < nodeMinZ) nodeMinZ = z;
		if (z > nodeMaxZ) nodeMaxZ = z;
	}

	return {
		hasFinitePositions: positionCount > 0,
		nodeMinX,
		nodeMinY,
		nodeMinZ,
		nodeMaxX,
		nodeMaxY,
		nodeMaxZ
	};
}

function buildFiniteMeshTrianglePositions(
	positions: {
		count: number;
		getX(index: number): number;
		getY(index: number): number;
		getZ(index: number): number;
	},
	positionCount: number
): Float32Array {
	const finiteValues: number[] = [];
	for (let start = 0; start + 2 < positionCount; start += 3) {
		const triangle = [
			[positions.getX(start), positions.getY(start), positions.getZ(start)],
			[positions.getX(start + 1), positions.getY(start + 1), positions.getZ(start + 1)],
			[positions.getX(start + 2), positions.getY(start + 2), positions.getZ(start + 2)]
		] as const;
		if (
			triangle.every(([x, y, z]) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
		) {
			for (const [x, y, z] of triangle) {
				finiteValues.push(x, y, z);
			}
		}
	}
	return new Float32Array(finiteValues);
}

function toCadArrayBuffer(data: Uint8Array): ArrayBuffer {
	return Uint8Array.from(data).buffer;
}

function createCadLoadTimeoutError(context: string): CadLoadError {
	return new CadLoadError(
		'timeout',
		`${context} timed out after ${Math.round(CAD_3MF_PARSE_TIMEOUT_MS / 1000)}s`
	);
}

function normaliseObjSourceText(text: string): string {
	return text
		.split(/\r?\n/)
		.filter(
			(line) => !/^\s*(solid|endsolid|facet\s+normal|outer\s+loop|endloop|endfacet)\b/i.test(line)
		)
		.join('\n');
}

async function withCadLoadTimeout<T>(
	task: () => Promise<T> | T,
	timeoutMs: number,
	context: string
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timeoutId = globalThis.setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(createCadLoadTimeoutError(context));
		}, timeoutMs);

		Promise.resolve()
			.then(task)
			.then((result) => {
				if (settled) return;
				settled = true;
				globalThis.clearTimeout(timeoutId);
				resolve(result);
			})
			.catch((error: unknown) => {
				if (settled) return;
				settled = true;
				globalThis.clearTimeout(timeoutId);
				reject(error);
			});
	});
}

// ── OCCT Web Worker (singleton, lazy) ─────────────────────────────────
let occtWorker: Worker | null = null;
let nextRequestId = 0;

interface OcctParseResult {
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
	code?: CadLoadErrorCode;
	rootCount?: number | null;
	transferCount?: number | null;
	readStatus?: number | null;
	modelEntityCount?: number | null;
	parserVersion?: string;
	format?: 'step' | 'iges';
}

export function isCadLoadError(error: unknown): error is CadLoadError {
	return error instanceof CadLoadError;
}

function toCadLoadError(
	error: unknown,
	fallbackCode: CadLoadErrorCode,
	fallbackMessage: string
): CadLoadError {
	if (isCadLoadError(error)) return error;

	if (error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string') {
		return new CadLoadError((error as Error & { code: CadLoadErrorCode }).code, error.message, {
			cause: error,
			diagnostics:
				typeof (error as Error & { diagnostics?: unknown }).diagnostics === 'object'
					? ((
							error as Error & {
								diagnostics?: CadLoadError['diagnostics'];
							}
						).diagnostics ?? undefined)
					: undefined
		});
	}

	if (error instanceof Error && error.message) {
		return new CadLoadError(fallbackCode, error.message, { cause: error });
	}

	return new CadLoadError(fallbackCode, fallbackMessage, { cause: error });
}

function getOcctWorker(): Worker {
	if (!occtWorker) {
		occtWorker = new Worker(new URL('../workers/occt-worker.ts', import.meta.url), {
			type: 'module'
		});
	}
	return occtWorker;
}

function boundsToDimensions(bounds: CadBounds | null): CadMetadata['dimensions'] {
	if (!bounds) return null;
	return {
		x: parseFloat((bounds.maxX - bounds.minX).toFixed(2)),
		y: parseFloat((bounds.maxY - bounds.minY).toFixed(2)),
		z: parseFloat((bounds.maxZ - bounds.minZ).toFixed(2))
	};
}

function createMetadata(
	format: CadFormat,
	previewMode: CadPreviewMode,
	summary: Pick<
		CadGeometrySummary,
		| 'vertexCount'
		| 'faceCount'
		| 'edgeCount'
		| 'bounds'
		| 'rootCount'
		| 'transferCount'
		| 'entityCount'
		| 'sourceSummary'
	>
): CadMetadata {
	return {
		vertexCount: summary.vertexCount,
		faceCount: summary.faceCount,
		edgeCount: summary.edgeCount,
		dimensions: boundsToDimensions(summary.bounds),
		format,
		previewMode,
		rootCount: summary.rootCount ?? null,
		transferCount: summary.transferCount ?? null,
		entityCount: summary.entityCount ?? null,
		sourceSummary: summary.sourceSummary ?? null
	};
}

function buildMetadataOnlyCadLoadResult(
	format: CadFormat,
	reason: string,
	bounds: CadBounds | null = null,
	summary: Pick<
		CadGeometrySummary,
		'rootCount' | 'transferCount' | 'entityCount' | 'sourceSummary'
	> = {}
): MetadataOnlyCadLoadResult {
	return {
		kind: 'metadata_only',
		reason,
		metadata: createMetadata(format, 'metadata_only', {
			vertexCount: 0,
			faceCount: 0,
			edgeCount: 0,
			bounds,
			rootCount: summary.rootCount ?? null,
			transferCount: summary.transferCount ?? null,
			entityCount: summary.entityCount ?? null,
			sourceSummary: summary.sourceSummary ?? null
		})
	};
}

function buildWireCadLoadResult(
	THREE: typeof import('three'),
	format: CadFormat,
	wireframe: WireframeGeometryData
): PreviewableCadLoadResult {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(wireframe.positions, 3));
	const material = createDefaultWireMaterial(THREE);
	const lines = new THREE.LineSegments(geometry, material);
	const object = new THREE.Group();
	object.add(lines);

	return {
		kind: 'previewable',
		previewMode: 'wire',
		object,
		renderBounds: wireframe.bounds ?? {
			minX: 0,
			minY: 0,
			minZ: 0,
			maxX: 0,
			maxY: 0,
			maxZ: 0
		},
		metadata: createMetadata(format, 'wire', {
			vertexCount: wireframe.positions.length / 3,
			faceCount: 0,
			edgeCount: wireframe.edgeCount,
			bounds: wireframe.bounds,
			entityCount: wireframe.entityCount,
			sourceSummary: wireframe.sourceSummary
		})
	};
}

function buildMeshCadLoadResult(
	THREE: typeof import('three'),
	format: Extract<CadFormat, 'step' | 'iges'>,
	result: OcctParseResult
): PreviewableCadLoadResult {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(result.positions!, 3));
	geometry.setAttribute('normal', new THREE.BufferAttribute(result.normals!, 3));
	geometry.setIndex(new THREE.BufferAttribute(result.indices!, 1));

	const material = createDefaultCadMaterial(THREE);
	const mesh = new THREE.Mesh(geometry, material);
	const object = new THREE.Group();
	object.add(mesh);

	return {
		kind: 'previewable',
		previewMode: 'mesh',
		object,
		renderBounds: result.bounds!,
		metadata: createMetadata(format, 'mesh', {
			vertexCount: result.vertexCount!,
			faceCount: Math.round(result.faceCount!),
			edgeCount: 0,
			bounds: result.bounds!,
			rootCount: result.rootCount ?? null,
			transferCount: result.transferCount ?? null
		})
	};
}

function computeBoundsFromWirePositions(values: number[]): CadBounds | null {
	if (values.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (let index = 0; index < values.length; index += 3) {
		const x = values[index];
		const y = values[index + 1];
		const z = values[index + 2];
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			return null;
		}
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	return { minX, minY, minZ, maxX, maxY, maxZ };
}

function buildFiniteWirePositions(values: number[]): Float32Array {
	const finiteValues: number[] = [];
	for (let index = 0; index < values.length; index += 6) {
		const segment = values.slice(index, index + 6);
		if (segment.length === 6 && segment.every((value) => Number.isFinite(value))) {
			finiteValues.push(...segment);
		}
	}
	return new Float32Array(finiteValues);
}

function pushWireSegment(
	target: number[],
	start: [number, number, number],
	end: [number, number, number]
) {
	target.push(start[0], start[1], start[2], end[0], end[1], end[2]);
}

function parseNumberToken(token: string | undefined): number | null {
	if (!token) return null;
	const value = Number(token.trim());
	return Number.isFinite(value) ? value : null;
}

function parseStepEntityMap(source: string): Map<string, { type: string; args: string }> {
	const entityMap = new Map<string, { type: string; args: string }>();
	const dataStart = source.indexOf('DATA;');
	const dataEnd = source.indexOf('ENDSEC;', dataStart >= 0 ? dataStart : 0);
	if (dataStart < 0 || dataEnd < 0) return entityMap;
	const body = source.slice(dataStart + 5, dataEnd);
	const entityRegex = /#(\d+)\s*=\s*([A-Z0-9_]+)\(([\s\S]*?)\)\s*;/g;
	for (const match of body.matchAll(entityRegex)) {
		entityMap.set(match[1], { type: match[2], args: match[3].trim() });
	}
	return entityMap;
}

function splitTopLevelList(input: string): string[] {
	const items: string[] = [];
	let depth = 0;
	let token = '';
	for (const char of input) {
		if (char === '(') depth += 1;
		if (char === ')') depth = Math.max(0, depth - 1);
		if (char === ',' && depth === 0) {
			items.push(token.trim());
			token = '';
			continue;
		}
		token += char;
	}
	if (token.trim()) items.push(token.trim());
	return items;
}

function parseStepCartesianPoint(
	entityMap: Map<string, { type: string; args: string }>,
	reference: string
): [number, number, number] | null {
	const entity = entityMap.get(reference.replace(/^#/, ''));
	if (!entity || entity.type !== 'CARTESIAN_POINT') return null;
	const coordsMatch = entity.args.match(/\(\s*([^)]+)\s*\)\s*$/);
	if (!coordsMatch) return null;
	const coords = coordsMatch[1].split(',').map((token) => parseNumberToken(token));
	if (coords.length < 3 || coords.some((value) => value === null)) return null;
	return [coords[0]!, coords[1]!, coords[2]!];
}

function parseStepDirection(
	entityMap: Map<string, { type: string; args: string }>,
	reference: string
): [number, number, number] | null {
	const entity = entityMap.get(reference.replace(/^#/, ''));
	if (!entity || entity.type !== 'DIRECTION') return null;
	const coordsMatch = entity.args.match(/\(\s*([^)]+)\s*\)\s*$/);
	if (!coordsMatch) return null;
	const coords = coordsMatch[1].split(',').map((token) => parseNumberToken(token));
	if (coords.length < 3 || coords.some((value) => value === null)) return null;
	return [coords[0]!, coords[1]!, coords[2]!];
}

function parseStepVector(
	entityMap: Map<string, { type: string; args: string }>,
	reference: string
): [number, number, number] | null {
	const entity = entityMap.get(reference.replace(/^#/, ''));
	if (!entity || entity.type !== 'VECTOR') return null;
	const parts = splitTopLevelList(entity.args);
	if (parts.length < 3) return null;
	const direction = parseStepDirection(entityMap, parts[1]);
	const magnitude = parseNumberToken(parts[2]);
	if (!direction || magnitude === null) return null;
	return [direction[0] * magnitude, direction[1] * magnitude, direction[2] * magnitude];
}

function parseStepAxisPlacement(
	entityMap: Map<string, { type: string; args: string }>,
	reference: string
): {
	center: [number, number, number];
	normal: [number, number, number];
	xDirection: [number, number, number];
} | null {
	const entity = entityMap.get(reference.replace(/^#/, ''));
	if (!entity || entity.type !== 'AXIS2_PLACEMENT_3D') return null;
	const parts = splitTopLevelList(entity.args);
	if (parts.length < 4) return null;
	const center = parseStepCartesianPoint(entityMap, parts[1]);
	const normal = parseStepDirection(entityMap, parts[2]);
	const xDirection = parseStepDirection(entityMap, parts[3]);
	if (!center || !normal || !xDirection) return null;
	return { center, normal, xDirection };
}

function normaliseVector(vector: [number, number, number]): [number, number, number] | null {
	const length = Math.hypot(vector[0], vector[1], vector[2]);
	if (length === 0) return null;
	return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function crossProduct(
	left: [number, number, number],
	right: [number, number, number]
): [number, number, number] {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0]
	];
}

function parseStepWireframe(data: Uint8Array): WireframeGeometryData | null {
	const source = new TextDecoder().decode(data);
	const entityMap = parseStepEntityMap(source);
	if (entityMap.size === 0) return null;
	const positions: number[] = [];
	let recognisedEntityCount = 0;

	for (const [, entity] of entityMap) {
		switch (entity.type) {
			case 'LINE': {
				recognisedEntityCount += 1;
				const parts = splitTopLevelList(entity.args);
				if (parts.length < 3) break;
				const start = parseStepCartesianPoint(entityMap, parts[1]);
				const vector = parseStepVector(entityMap, parts[2]);
				if (!start || !vector) break;
				pushWireSegment(positions, start, [
					start[0] + vector[0],
					start[1] + vector[1],
					start[2] + vector[2]
				]);
				break;
			}
			case 'POLYLINE': {
				recognisedEntityCount += 1;
				const parts = splitTopLevelList(entity.args);
				if (parts.length < 2) break;
				const pointRefsMatch = parts[1].match(/^\((.*)\)$/);
				if (!pointRefsMatch) break;
				const pointRefs = splitTopLevelList(pointRefsMatch[1]);
				for (let index = 0; index < pointRefs.length - 1; index += 1) {
					const start = parseStepCartesianPoint(entityMap, pointRefs[index]);
					const end = parseStepCartesianPoint(entityMap, pointRefs[index + 1]);
					if (!start || !end) continue;
					pushWireSegment(positions, start, end);
				}
				break;
			}
			case 'CIRCLE': {
				recognisedEntityCount += 1;
				const parts = splitTopLevelList(entity.args);
				if (parts.length < 3) break;
				const placement = parseStepAxisPlacement(entityMap, parts[1]);
				const radius = parseNumberToken(parts[2]);
				if (!placement || radius === null || radius <= 0) break;
				const normal = normaliseVector(placement.normal);
				const xDirection = normaliseVector(placement.xDirection);
				if (!normal || !xDirection) break;
				const yDirection = normaliseVector(crossProduct(normal, xDirection));
				if (!yDirection) break;
				const segmentCount = 48;
				let previousPoint: [number, number, number] | null = null;
				for (let segment = 0; segment <= segmentCount; segment += 1) {
					const angle = (segment / segmentCount) * Math.PI * 2;
					const point: [number, number, number] = [
						placement.center[0] +
							radius * (Math.cos(angle) * xDirection[0] + Math.sin(angle) * yDirection[0]),
						placement.center[1] +
							radius * (Math.cos(angle) * xDirection[1] + Math.sin(angle) * yDirection[1]),
						placement.center[2] +
							radius * (Math.cos(angle) * xDirection[2] + Math.sin(angle) * yDirection[2])
					];
					if (previousPoint) {
						pushWireSegment(positions, previousPoint, point);
					}
					previousPoint = point;
				}
				break;
			}
		}
	}

	if (positions.length === 0) return null;
	const finitePositions = buildFiniteWirePositions(positions);
	if (finitePositions.length === 0) return null;
	return {
		positions: finitePositions,
		edgeCount: finitePositions.length / 6,
		bounds: computeBoundsFromWirePositions(Array.from(finitePositions)),
		entityCount: recognisedEntityCount,
		sourceSummary:
			recognisedEntityCount > 0
				? `Recovered ${recognisedEntityCount} STEP wireframe entit${recognisedEntityCount === 1 ? 'y' : 'ies'} from fallback parsing.`
				: null
	};
}

function parseIgesWireframe(data: Uint8Array): WireframeGeometryData | null {
	const source = new TextDecoder().decode(data);
	const parameterLines = source
		.split(/\r?\n/)
		.filter((line) => line.length >= 73 && line[72] === 'P')
		.map((line) => line.slice(0, 64).trim());
	const positions: number[] = [];
	let entityCount = 0;
	for (const line of parameterLines) {
		const content = line.replace(/\s+$/, '').trim();
		if (!content.includes(';')) continue;
		const rawValues = content
			.replace(/;$/, '')
			.split(',')
			.map((token) => token.trim());
		const entityType = parseNumberToken(rawValues[0]);
		if (entityType !== 110) continue;
		entityCount += 1;
		const coords = rawValues.slice(1).map((token) => parseNumberToken(token));
		if (coords.length < 6 || coords.some((value) => value === null)) continue;
		pushWireSegment(
			positions,
			[coords[0]!, coords[1]!, coords[2]!],
			[coords[3]!, coords[4]!, coords[5]!]
		);
	}
	if (positions.length === 0) return null;
	const finitePositions = buildFiniteWirePositions(positions);
	if (finitePositions.length === 0) return null;
	return {
		positions: finitePositions,
		edgeCount: finitePositions.length / 6,
		bounds: computeBoundsFromWirePositions(Array.from(finitePositions)),
		entityCount,
		sourceSummary:
			entityCount > 0
				? `Recovered ${entityCount} IGES line entit${entityCount === 1 ? 'y' : 'ies'} from fallback parsing.`
				: null
	};
}

function parseCadWireframeFallback(
	data: Uint8Array,
	format: Extract<CadFormat, 'step' | 'iges'>
): WireframeGeometryData | null {
	return format === 'step' ? parseStepWireframe(data) : parseIgesWireframe(data);
}

function sanitizePreviewableCadLoadResult(
	format: CadFormat,
	result: PreviewableCadLoadResult,
	THREE: typeof import('three')
): CadLoadResult {
	const sanitized = sanitizeCadObject(result.object, THREE);
	if (sanitized.summary.meshCount === 0 && sanitized.summary.lineCount === 0) {
		log.warn('Downgraded CAD preview to metadata-only after sanitisation', {
			format,
			previewMode: result.previewMode
		});
		return buildMetadataOnlyCadLoadResult(
			format,
			'This CAD file does not contain safe drawable geometry.',
			sanitized.summary.bounds,
			{
				rootCount: result.metadata.rootCount,
				transferCount: result.metadata.transferCount,
				entityCount: result.metadata.entityCount,
				sourceSummary:
					result.metadata.sourceSummary ??
					'The file parsed successfully but did not contain finite drawable geometry after sanitisation.'
			}
		);
	}

	const previewMode: Extract<CadPreviewMode, 'mesh' | 'wire'> =
		sanitized.summary.meshCount > 0 ? 'mesh' : 'wire';

	return {
		kind: 'previewable',
		previewMode,
		object: result.object,
		renderBounds: sanitized.summary.bounds ?? result.renderBounds,
		metadata: createMetadata(format, previewMode, {
			...sanitized.summary,
			rootCount: result.metadata.rootCount,
			transferCount: result.metadata.transferCount,
			entityCount: result.metadata.entityCount,
			sourceSummary: result.metadata.sourceSummary
		})
	};
}

/** Send file data to the OCCT Web Worker for STEP/IGES parsing. */
function parseWithOCCT(buffer: ArrayBuffer, format: 'step' | 'iges'): Promise<OcctParseResult> {
	return new Promise((resolve, reject) => {
		const id = nextRequestId++;
		const worker = getOcctWorker();

		const handleMessage = (e: MessageEvent<OcctParseResult>) => {
			if (e.data.id !== id) return;
			worker.removeEventListener('message', handleMessage);
			worker.removeEventListener('error', handleError);

			if (e.data.success) {
				resolve(e.data);
			} else {
				reject(
					new CadLoadError(e.data.code ?? 'parse_failed', e.data.error || 'OCCT parse failed', {
						diagnostics: {
							readStatus: e.data.readStatus,
							modelEntityCount: e.data.modelEntityCount,
							rootCount: e.data.rootCount,
							transferCount: e.data.transferCount,
							parserVersion: e.data.parserVersion,
							format: e.data.format
						}
					})
				);
			}
		};

		const handleError = (e: ErrorEvent) => {
			worker.removeEventListener('message', handleMessage);
			worker.removeEventListener('error', handleError);
			reject(new CadLoadError('parse_failed', e.message || 'OCCT worker error'));
		};

		worker.addEventListener('message', handleMessage);
		worker.addEventListener('error', handleError);

		// Transfer the ArrayBuffer to the worker (zero-copy)
		worker.postMessage({ id, data: buffer, format }, [buffer]);
	});
}

async function loadMeshCadFile(
	THREE: typeof import('three'),
	data: Uint8Array,
	format: Extract<CadFormat, 'stl' | 'obj' | '3mf'>
): Promise<InstanceType<typeof THREE.Group>> {
	try {
		switch (format) {
			case 'stl': {
				const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
				const loader = new STLLoader();
				const geometry: BufferGeometry = loader.parse(toCadArrayBuffer(data));

				const material = createDefaultCadMaterial(THREE);
				material.flatShading = false;
				const mesh = new THREE.Mesh(geometry, material);
				const object = new THREE.Group();
				object.add(mesh);
				return object;
			}

			case 'obj': {
				const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
				const loader = new OBJLoader();
				const text = normaliseObjSourceText(new TextDecoder().decode(data));
				return loader.parse(text);
			}

			case '3mf': {
				const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
				const loader = new ThreeMFLoader();
				return withCadLoadTimeout(
					() => loader.parse(toCadArrayBuffer(data)) as InstanceType<typeof THREE.Group>,
					CAD_3MF_PARSE_TIMEOUT_MS,
					'3MF preview generation'
				);
			}
		}
	} catch (error) {
		throw toCadLoadError(error, 'parse_failed', 'CAD preview parsing failed.');
	}
}

async function loadBrepCadFile(
	THREE: typeof import('three'),
	data: Uint8Array,
	format: Extract<CadFormat, 'step' | 'iges'>
): Promise<CadLoadResult> {
	const buffer = toCadArrayBuffer(data);
	try {
		const result = await parseWithOCCT(buffer, format);
		return sanitizePreviewableCadLoadResult(
			format,
			buildMeshCadLoadResult(THREE, format, result),
			THREE
		);
	} catch (error) {
		const cadError = toCadLoadError(error, 'parse_failed', 'CAD preview parsing failed.');
		if (cadError.code === 'read_failed' || cadError.code === 'parse_failed') {
			throw cadError;
		}

		const wireframe = parseCadWireframeFallback(data, format);
		if (wireframe) {
			return sanitizePreviewableCadLoadResult(
				format,
				buildWireCadLoadResult(THREE, format, wireframe),
				THREE
			);
		}

		return buildMetadataOnlyCadLoadResult(format, cadError.message, null, {
			rootCount: cadError.diagnostics?.rootCount ?? null,
			transferCount: cadError.diagnostics?.transferCount ?? null
		});
	}
}

/**
 * Parse a CAD file from raw bytes using the appropriate loader.
 * STL/OBJ/3MF use Three.js loaders on the main thread.
 * STEP/IGES use opencascade.js WASM in a Web Worker.
 */
export async function loadCadFile(data: Uint8Array, format: CadFormat): Promise<CadLoadResult> {
	const THREE = await getTHREE();

	let object: InstanceType<typeof THREE.Group>;

	switch (format) {
		case 'stl':
		case 'obj':
		case '3mf':
			object = await loadMeshCadFile(THREE, data, format);
			break;
		case 'dwg':
			throw new CadLoadError(
				'parse_failed',
				'DWG evidence is handled by the drawing pipeline, not the 3D CAD loader.'
			);

		case 'step':
		case 'iges':
			return loadBrepCadFile(THREE, data, format);
	}

	return sanitizePreviewableCadLoadResult(
		format,
		{
			kind: 'previewable',
			previewMode: 'mesh',
			object,
			renderBounds: {
				minX: 0,
				minY: 0,
				minZ: 0,
				maxX: 0,
				maxY: 0,
				maxZ: 0
			},
			metadata: createMetadata(format, 'mesh', {
				vertexCount: 0,
				faceCount: 0,
				edgeCount: 0,
				bounds: null
			})
		},
		THREE
	);
}

// ── Geometry cache ───────────────────────────────────────────────────
// Keeps parsed CAD geometry in JS memory across tab switches.
// GPU memory is freed on tab switch (renderer.dispose()).
// Geometry is disposed only on explicit cache eviction.
// Cache limit: 10 entries, LRU eviction.

const cadFileCache = new Map<string, PreviewableCadLoadResult>();
const cadFileAccessOrder: string[] = [];
const CAD_CACHE_MAX = 10;

/**
 * Dispose all GPU resources held by a previewable CAD result.
 * Traverses the scene graph and disposes every geometry and material.
 */
function disposeCadObject(result: PreviewableCadLoadResult): void {
	result.object.traverse((child) => {
		const node = child as import('three').Object3D & {
			geometry?: { dispose(): void };
			material?: { dispose(): void } | Array<{ dispose(): void }>;
		};
		if (node.geometry) node.geometry.dispose();
		if (node.material) {
			if (Array.isArray(node.material)) {
				node.material.forEach((m) => {
					m.dispose();
					for (const val of Object.values(m)) {
						if (
							typeof val === 'object' &&
							val !== null &&
							'dispose' in val &&
							typeof (val as { dispose(): void }).dispose === 'function'
						) {
							(val as { dispose(): void }).dispose();
						}
					}
				});
			} else {
				node.material.dispose();
				for (const val of Object.values(node.material)) {
					if (
						typeof val === 'object' &&
						val !== null &&
						'dispose' in val &&
						typeof (val as { dispose(): void }).dispose === 'function'
					) {
						(val as { dispose(): void }).dispose();
					}
				}
			}
		}
	});
}

/** Store a parsed CAD result by file path for fast re-open. */
export function cacheCadFile(filePath: string, result: PreviewableCadLoadResult): void {
	// If already cached, just update access order
	if (cadFileCache.has(filePath)) {
		const idx = cadFileAccessOrder.indexOf(filePath);
		if (idx !== -1) cadFileAccessOrder.splice(idx, 1);
		cadFileAccessOrder.push(filePath);
		return;
	}

	// Evict oldest if at capacity
	if (cadFileCache.size >= CAD_CACHE_MAX) {
		const oldest = cadFileAccessOrder.shift();
		if (oldest) {
			const evicted = cadFileCache.get(oldest);
			if (evicted) disposeCadObject(evicted);
			cadFileCache.delete(oldest);
		}
	}

	cadFileCache.set(filePath, result);
	cadFileAccessOrder.push(filePath);
}

/** Retrieve a cached CAD result, or undefined if not cached. */
export function getCachedCadFile(filePath: string): PreviewableCadLoadResult | undefined {
	const result = cadFileCache.get(filePath);
	if (result) {
		// Bump to front of LRU
		const idx = cadFileAccessOrder.indexOf(filePath);
		if (idx !== -1) cadFileAccessOrder.splice(idx, 1);
		cadFileAccessOrder.push(filePath);
	}
	return result;
}

/**
 * Clear a cached CAD file, disposing its GPU resources.
 * Pass no argument to clear the entire cache.
 */
export function clearCadFileCache(filePath?: string): void {
	if (filePath) {
		const result = cadFileCache.get(filePath);
		if (result) disposeCadObject(result);
		cadFileCache.delete(filePath);
		const idx = cadFileAccessOrder.indexOf(filePath);
		if (idx !== -1) cadFileAccessOrder.splice(idx, 1);
		cameraStateCache.delete(filePath);
	} else {
		for (const result of cadFileCache.values()) {
			disposeCadObject(result);
		}
		cadFileCache.clear();
		cadFileAccessOrder.length = 0;
		cameraStateCache.clear();
	}
}

/**
 * Check if a file path has a valid cached CAD result with previewable geometry.
 */
export function hasCachedCadFile(filePath: string): boolean {
	return cadFileCache.has(filePath);
}

// ── Camera state cache ──────────────────────────────────────────────
// Preserves orbit controls position across tab switches so the view
// doesn't snap back to default fitToView() on return.

interface CachedCameraState {
	px: number;
	py: number;
	pz: number;
	tx: number;
	ty: number;
	tz: number;
}

const cameraStateCache = new Map<string, CachedCameraState>();

/** Save the current camera position and orbit target for a file path. */
export function cacheCameraState(
	filePath: string,
	position: { x: number; y: number; z: number },
	target: { x: number; y: number; z: number }
): void {
	cameraStateCache.set(filePath, {
		px: position.x,
		py: position.y,
		pz: position.z,
		tx: target.x,
		ty: target.y,
		tz: target.z
	});
}

/** Retrieve saved camera state, or null if none. */
export function getCachedCameraState(filePath: string): {
	position: { x: number; y: number; z: number };
	target: { x: number; y: number; z: number };
} | null {
	const state = cameraStateCache.get(filePath);
	if (!state) return null;
	return {
		position: { x: state.px, y: state.py, z: state.pz },
		target: { x: state.tx, y: state.ty, z: state.tz }
	};
}

/** Clear camera state when the associated geometry cache entry is evicted. */
export function clearCameraState(filePath: string): void {
	cameraStateCache.delete(filePath);
}
