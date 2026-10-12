import { getGeneralFilePreviewKind } from '$lib/constants/index.js';
import type { AiArtifactExtractionMode, AssetFile } from '$lib/types/index.js';
import { readVaultFile } from './assets.js';
import {
	getCadFormat,
	loadCadFile,
	getTHREE,
	type CadFormat,
	type CadBounds,
	type CadMetadata,
	type PreviewableCadLoadResult
} from './cad-loader.js';
import { createLogger } from './logger.js';
import {
	disposeDerivedPreview,
	getDerivedPreview,
	sanitiseSvgMarkup,
	parseSvgDimensions
} from './derived-previews.js';

export type AiCadRender = {
	viewLabel: string;
	mimeType: string;
	data: string;
};

export type AiCadMetadata = Omit<CadMetadata, 'format'> & {
	format: CadFormat | 'dxf';
	renderCount: number;
	renderPolicyVersion: string;
	renderSize: number | null;
	viewLabels: string[];
	reason: string | null;
};

export type AiCadArtifactData = {
	metadata: AiCadMetadata;
	renders: AiCadRender[];
	summaryText: string;
	extractionMode: Extract<AiArtifactExtractionMode, 'cad_renders' | 'cad_metadata'>;
};

// Render sizes balance drawing legibility with the stage visual-token budget.
// Renders travel as native multimodal parts, never as base64 inside the text
// prompt, and the evidence orchestrator keeps each CAD request to four views.
const CAD_RENDER_SIZE = 768;
const DXF_RENDER_SIZE = 768;
const CAD_RENDER_POLICY_VERSION = 'cad-render-v4';
const CAD_RENDER_IMAGE_MIME_TYPE = 'image/jpeg';
const CAD_RENDER_QUALITY = 0.6;
const log = createLogger('aiCadEvidence');

type SharedCadEvidenceRenderer = {
	renderer: InstanceType<typeof import('three').WebGLRenderer>;
	canvas: HTMLCanvasElement;
};

let sharedCadEvidenceRenderer: SharedCadEvidenceRenderer | null = null;
let cadRenderQueue: Promise<void> = Promise.resolve();
let cadRendererIdleTimer: ReturnType<typeof setTimeout> | null = null;
const CAD_RENDERER_IDLE_RELEASE_MS = 5_000;

function disposeSharedCadEvidenceRenderer(): void {
	if (cadRendererIdleTimer) {
		clearTimeout(cadRendererIdleTimer);
		cadRendererIdleTimer = null;
	}
	sharedCadEvidenceRenderer?.renderer.dispose();
	sharedCadEvidenceRenderer?.renderer.forceContextLoss();
	sharedCadEvidenceRenderer = null;
}

function scheduleCadEvidenceRendererRelease(): void {
	if (cadRendererIdleTimer) clearTimeout(cadRendererIdleTimer);
	cadRendererIdleTimer = setTimeout(() => {
		disposeSharedCadEvidenceRenderer();
	}, CAD_RENDERER_IDLE_RELEASE_MS);
}

async function withCadRenderSlot<T>(work: () => Promise<T>): Promise<T> {
	const previous = cadRenderQueue;
	let release!: () => void;
	cadRenderQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	if (cadRendererIdleTimer) {
		clearTimeout(cadRendererIdleTimer);
		cadRendererIdleTimer = null;
	}
	try {
		return await work();
	} finally {
		scheduleCadEvidenceRendererRelease();
		release();
	}
}

function getSharedCadEvidenceRenderer(
	THREE: typeof import('three'),
	renderSize: number
): SharedCadEvidenceRenderer {
	if (!sharedCadEvidenceRenderer) {
		const canvas = document.createElement('canvas');
		const renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			preserveDrawingBuffer: true,
			alpha: false
		});
		sharedCadEvidenceRenderer = { renderer, canvas };
	}
	sharedCadEvidenceRenderer.canvas.width = renderSize;
	sharedCadEvidenceRenderer.canvas.height = renderSize;
	sharedCadEvidenceRenderer.renderer.setSize(renderSize, renderSize);
	sharedCadEvidenceRenderer.renderer.setClearColor(0xffffff, 1);
	return sharedCadEvidenceRenderer;
}

function inferMetadataOnlySourceSummary(format: CadFormat, reason: string): string {
	const upperFormat = format.toUpperCase();
	if (/no transferable roots/i.test(reason)) {
		return `${upperFormat} content appears to contain placements, references, or non-transferable entities instead of drawable geometry.`;
	}
	if (/no shape/i.test(reason)) {
		return `${upperFormat} content appears valid but did not yield a drawable shape for rendering.`;
	}
	if (/no previewable geometry/i.test(reason)) {
		return `${upperFormat} content appears valid but does not contain triangulated or line drawable geometry.`;
	}
	return `${upperFormat} content is valid but could not be rendered into drawable geometry for preview.`;
}

function extractCadTextMetadata(bytes: Uint8Array, format: CadFormat): string | null {
	if (format !== 'step' && format !== 'iges') return null;
	const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	if (format === 'step') {
		const values = Array.from(
			text.matchAll(
				/(?:FILE_DESCRIPTION|PRODUCT|DESCRIPTIVE_REPRESENTATION_ITEM)\(([^;]{0,600})\);/gi
			)
		)
			.flatMap((match) => Array.from(match[1]!.matchAll(/'([^']{2,180})'/g), (value) => value[1]!))
			.map((value) => value.replace(/\s+/g, ' ').trim())
			.filter((value) => /[a-z]/i.test(value));
		const unique = Array.from(new Set(values)).slice(0, 6);
		return unique.length > 0 ? `Source metadata: ${unique.join(' | ')}.` : null;
	}
	const igesLines = text
		.split(/\r?\n/)
		.filter((line) => /[a-z]/i.test(line))
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line.length >= 3 && line.length <= 180)
		.slice(0, 4);
	return igesLines.length > 0 ? `Source metadata: ${igesLines.join(' | ')}.` : null;
}

function summariseDimensions(dimensions: CadMetadata['dimensions']): string | null {
	if (!dimensions) return null;
	return `${dimensions.x} × ${dimensions.y} × ${dimensions.z}`;
}

function buildPreviewableSummaryText(
	format: CadFormat | 'dxf',
	previewMode: 'mesh' | 'wire',
	renderCount: number,
	metadata: Pick<AiCadMetadata, 'dimensions' | 'faceCount' | 'edgeCount' | 'entityCount'>,
	entityMetadata?: string | null
): string {
	const parts = [
		`${String(format).toUpperCase()} CAD evidence prepared for AI drafting.`,
		previewMode === 'mesh'
			? `Rendered ${renderCount} shaded views from surface or solid geometry.`
			: `Rendered ${renderCount} drawing views from wire or line geometry.`
	];
	const dims = summariseDimensions(metadata.dimensions);
	if (dims) parts.push(`Approximate extents: ${dims}.`);
	if (metadata.faceCount > 0) parts.push(`Face count: ${metadata.faceCount}.`);
	if (metadata.edgeCount > 0) parts.push(`Edge count: ${metadata.edgeCount}.`);
	if (metadata.entityCount && metadata.entityCount > 0) {
		parts.push(`Detected drawing entities: ${metadata.entityCount}.`);
	}
	if (entityMetadata) parts.push(`\nEntity structure:\n${entityMetadata}`);
	return parts.join(' ');
}

function buildMetadataOnlySummaryText(metadata: AiCadMetadata): string {
	const parts = [
		`Valid ${String(metadata.format).toUpperCase()} CAD file prepared for AI drafting without rendered views.`,
		'No drawable geometry was available, so AI must reason from metadata only.'
	];
	if (metadata.reason) parts.push(`Rendering limitation: ${metadata.reason}.`);
	if (metadata.rootCount !== null) parts.push(`Transfer roots detected: ${metadata.rootCount}.`);
	if (metadata.transferCount !== null) {
		parts.push(`Transferred roots: ${metadata.transferCount}.`);
	}
	if (metadata.entityCount !== null) parts.push(`Detected entities: ${metadata.entityCount}.`);
	if (metadata.sourceSummary) parts.push(metadata.sourceSummary);
	const dims = summariseDimensions(metadata.dimensions);
	if (dims) parts.push(`Approximate extents: ${dims}.`);
	return parts.join(' ');
}

function getBoundsCenterAndSize(bounds: CadBounds): {
	center: { x: number; y: number; z: number };
	size: { x: number; y: number; z: number };
} {
	return {
		center: {
			x: (bounds.minX + bounds.maxX) / 2,
			y: (bounds.minY + bounds.maxY) / 2,
			z: (bounds.minZ + bounds.maxZ) / 2
		},
		size: {
			x: Math.max(0, bounds.maxX - bounds.minX),
			y: Math.max(0, bounds.maxY - bounds.minY),
			z: Math.max(0, bounds.maxZ - bounds.minZ)
		}
	};
}

function buildCadRenderPositions(
	previewMode: 'mesh' | 'wire'
): Array<{ viewLabel: string; vector: [number, number, number] }> {
	if (previewMode === 'wire') {
		return [
			{ viewLabel: 'iso', vector: [0.8, 0.6, 0.8] },
			{ viewLabel: 'front', vector: [0, 0, 1] },
			{ viewLabel: 'side', vector: [1, 0, 0] },
			{ viewLabel: 'top', vector: [0, 1, 0.0001] }
		];
	}

	return [
		{ viewLabel: 'iso', vector: [0.8, 0.6, 0.8] },
		{ viewLabel: 'front', vector: [0, 0, 1] },
		{ viewLabel: 'top', vector: [0, 1, 0.0001] },
		{ viewLabel: 'side', vector: [1, 0, 0] }
	];
}

async function renderPreviewableCad(result: PreviewableCadLoadResult): Promise<AiCadRender[]> {
	return withCadRenderSlot(async () => {
		const THREE = await getTHREE();
		const scene = new THREE.Scene();
		scene.add(result.object);
		scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(1, 2, 3);
		scene.add(directionalLight);

		const isHighDensity = result.metadata.faceCount > 100000;
		const activeRenderSize = isHighDensity ? 512 : CAD_RENDER_SIZE;
		if (isHighDensity) {
			log.info('Dense 3D model detected. Applying adaptive render budgeting (512px, 2 views)', {
				faceCount: result.metadata.faceCount,
				vertexCount: result.metadata.vertexCount
			});
		}

		const { renderer, canvas } = getSharedCadEvidenceRenderer(THREE, activeRenderSize);
		const bounds = result.renderBounds;
		const { center: centerValues, size: sizeValues } = getBoundsCenterAndSize(bounds);
		const center = new THREE.Vector3();
		center.set(centerValues.x, centerValues.y, centerValues.z);
		const maxDim = Math.max(sizeValues.x, sizeValues.y, sizeValues.z) || 1;
		const camera = new THREE.PerspectiveCamera(40, 1, maxDim * 0.01, maxDim * 100);
		const distance = maxDim * 2;
		let positions = buildCadRenderPositions(result.previewMode);
		if (isHighDensity) {
			positions = positions.filter(
				(position) => position.viewLabel === 'iso' || position.viewLabel === 'front'
			);
		}

		const renders: AiCadRender[] = [];
		try {
			for (const position of positions) {
				camera.position.set(
					center.x + distance * position.vector[0],
					center.y + distance * position.vector[1],
					center.z + distance * position.vector[2]
				);
				camera.lookAt(center);
				renderer.render(scene, camera);
				const mimePrefix = `data:${CAD_RENDER_IMAGE_MIME_TYPE};base64,`;
				renders.push({
					viewLabel: position.viewLabel,
					mimeType: CAD_RENDER_IMAGE_MIME_TYPE,
					data: canvas
						.toDataURL(CAD_RENDER_IMAGE_MIME_TYPE, CAD_RENDER_QUALITY)
						.replace(mimePrefix, '')
				});
			}
		} finally {
			result.object.traverse((child) => {
				const node = child as {
					isMesh?: boolean;
					isLine?: boolean;
					geometry?: { dispose(): void };
					material?: { dispose(): void } | Array<{ dispose(): void }>;
				};
				if (!node.isMesh && !node.isLine) return;
				node.geometry?.dispose();
				if (Array.isArray(node.material)) {
					node.material.forEach((material) => material.dispose());
				} else {
					node.material?.dispose();
				}
			});
			(renderer as { renderLists?: { dispose(): void } }).renderLists?.dispose();
		}

		return renders;
	});
}

async function rasterizeSvgToPng(svg: string): Promise<string> {
	const dimensions = parseSvgDimensions(svg, DXF_RENDER_SIZE);
	const scale = Math.min(
		1,
		DXF_RENDER_SIZE /
			Math.max(dimensions.width || DXF_RENDER_SIZE, dimensions.height || DXF_RENDER_SIZE)
	);
	const width = Math.max(1, Math.round(dimensions.width * scale));
	const height = Math.max(1, Math.round(dimensions.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('Unable to create a canvas context for DXF AI evidence.');
	}

	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, width, height);

	const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const next = new Image();
			next.onload = () => resolve(next);
			next.onerror = () => reject(new Error('Unable to rasterise DXF drawing for AI evidence.'));
			next.src = blobUrl;
		});
		context.drawImage(image, 0, 0, width, height);
		return canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
	} finally {
		URL.revokeObjectURL(blobUrl);
	}
}

async function buildDxfAiEvidence(file: AssetFile): Promise<AiCadArtifactData> {
	const preview = await getDerivedPreview(file.file_path);
	if (preview.kind !== 'dxf') {
		throw new Error(`Expected a DXF derived preview for ${file.original_name}.`);
	}

	try {
		const renderData = await rasterizeSvgToPng(preview.svg);

		// Extract entity type breakdown from SVG markup
		let entityMetadata: string | null = null;
		try {
			const { extractSvgEntityTypes } = await import('./dwg-converter.js');
			const metadata = extractSvgEntityTypes(preview.svg);
			if (metadata.length > 0) {
				entityMetadata = `Entity types: ${metadata.map((m) => `${m.type}:${m.count}`).join(', ')}`;
			}
		} catch {
			// Best-effort
		}

		const metadata: AiCadMetadata = {
			format: 'dxf',
			previewMode: 'wire',
			vertexCount: 0,
			faceCount: 0,
			edgeCount: preview.entityCount,
			dimensions: null,
			rootCount: null,
			transferCount: null,
			renderCount: 1,
			renderPolicyVersion: CAD_RENDER_POLICY_VERSION,
			renderSize: DXF_RENDER_SIZE,
			viewLabels: ['drawing'],
			reason: null,
			entityCount: preview.entityCount,
			sourceSummary: 'DXF linework was converted into a raster drawing view for AI evidence.'
		};

		return {
			metadata,
			renders: [{ viewLabel: 'drawing', mimeType: 'image/jpeg', data: renderData }],
			summaryText: buildPreviewableSummaryText('dxf', 'wire', 1, metadata, entityMetadata),
			extractionMode: 'cad_renders'
		};
	} finally {
		disposeDerivedPreview(preview);
	}
}

async function buildDwgAiEvidence(file: AssetFile): Promise<AiCadArtifactData> {
	const bytes = await readVaultFile(file.file_path);
	const { convertDwgToSvg, extractSvgEntityTypes } = await import('./dwg-converter.js');
	const { svg, metadata: serializedMetadata } = await convertDwgToSvg(bytes);
	const sanitised = sanitiseSvgMarkup(svg);

	try {
		const renderData = await rasterizeSvgToPng(sanitised);

		// Try to extract structured metadata from DWG database
		let entityMetadata: string | null = serializedMetadata || null;
		let entityCount = 0;

		if (serializedMetadata) {
			const entityMatch = serializedMetadata.match(/Entities:\s*(\d+)/i);
			if (entityMatch) {
				entityCount = parseInt(entityMatch[1], 10);
			}
		} else {
			try {
				const metadata = extractSvgEntityTypes(svg);
				if (metadata.length > 0) {
					entityMetadata = `Entity types: ${metadata.map((m) => `${m.type}:${m.count}`).join(', ')}`;
					entityCount = metadata.reduce((acc, m) => acc + m.count, 0);
				}
			} catch {
				// Metadata extraction is best-effort
			}
		}

		const metadata: AiCadMetadata = {
			format: 'dwg',
			previewMode: 'wire',
			vertexCount: 0,
			faceCount: 0,
			edgeCount: entityCount,
			dimensions: null,
			rootCount: null,
			transferCount: null,
			renderCount: 1,
			renderPolicyVersion: CAD_RENDER_POLICY_VERSION,
			renderSize: DXF_RENDER_SIZE,
			viewLabels: ['drawing'],
			reason: null,
			entityCount: entityCount,
			sourceSummary: 'DWG drawing was converted to DXF then rasterised for AI evidence.'
		};

		return {
			metadata,
			renders: [{ viewLabel: 'drawing', mimeType: 'image/jpeg', data: renderData }],
			summaryText: buildPreviewableSummaryText('dwg', 'wire', 1, metadata, entityMetadata),
			extractionMode: 'cad_renders'
		};
	} finally {
		// SVG is in-memory string, no URL to revoke
	}
}

async function buildModelCadAiEvidence(file: AssetFile): Promise<AiCadArtifactData> {
	const format = getCadFormat(file.file_path);
	if (!format) {
		throw new Error('Unsupported CAD format for AI drafting.');
	}

	const bytes = await readVaultFile(file.file_path);
	const result = await loadCadFile(bytes, format);
	if (result.kind === 'metadata_only') {
		const extractedSourceMetadata = extractCadTextMetadata(bytes, format);
		const metadata: AiCadMetadata = {
			...result.metadata,
			renderCount: 0,
			renderPolicyVersion: CAD_RENDER_POLICY_VERSION,
			renderSize: null,
			viewLabels: [],
			reason: result.reason,
			sourceSummary: [
				result.metadata.sourceSummary ?? inferMetadataOnlySourceSummary(format, result.reason),
				extractedSourceMetadata
			]
				.filter((value): value is string => Boolean(value?.trim()))
				.join(' ')
		};
		return {
			metadata,
			renders: [],
			summaryText: buildMetadataOnlySummaryText(metadata),
			extractionMode: 'cad_metadata'
		};
	}

	const renders = await renderPreviewableCad(result);
	const isHighDensity = result.metadata.faceCount > 100000;
	const activeRenderSize = isHighDensity ? 512 : CAD_RENDER_SIZE;

	const metadata: AiCadMetadata = {
		...result.metadata,
		renderCount: renders.length,
		renderPolicyVersion: CAD_RENDER_POLICY_VERSION,
		renderSize: activeRenderSize,
		viewLabels: renders.map((render) => render.viewLabel),
		reason: null
	};
	return {
		metadata,
		renders,
		summaryText: buildPreviewableSummaryText(format, result.previewMode, renders.length, metadata),
		extractionMode: 'cad_renders'
	};
}

const CAD_EVIDENCE_CACHE_LIMIT = 6;
const cadEvidenceCache = new Map<string, Promise<AiCadArtifactData>>();

function cadEvidenceCacheKey(file: AssetFile): string {
	return `${file.id}:${file.file_path}:${file.created_at}`;
}

async function prepareEstimateAiCadEvidence(file: AssetFile): Promise<AiCadArtifactData> {
	if (getGeneralFilePreviewKind(file.file_path) === 'dxf') {
		const evidence = await buildDxfAiEvidence(file);
		log.info('Prepared DXF AI evidence', {
			fileId: file.id,
			fileName: file.original_name,
			evidenceMode: evidence.extractionMode,
			previewMode: evidence.metadata.previewMode,
			renderCount: evidence.renders.length,
			renderSize: evidence.metadata.renderSize,
			viewLabels: evidence.metadata.viewLabels
		});
		return evidence;
	}

	if (getGeneralFilePreviewKind(file.file_path) === 'dwg') {
		const evidence = await buildDwgAiEvidence(file);
		log.info('Prepared DWG AI evidence', {
			fileId: file.id,
			fileName: file.original_name,
			evidenceMode: evidence.extractionMode,
			previewMode: evidence.metadata.previewMode,
			renderCount: evidence.renders.length,
			renderSize: evidence.metadata.renderSize,
			viewLabels: evidence.metadata.viewLabels
		});
		return evidence;
	}

	const evidence = await buildModelCadAiEvidence(file);
	log.info('Prepared CAD AI evidence', {
		fileId: file.id,
		fileName: file.original_name,
		evidenceMode: evidence.extractionMode,
		previewMode: evidence.metadata.previewMode,
		renderCount: evidence.renders.length,
		renderSize: evidence.metadata.renderSize,
		viewLabels: evidence.metadata.viewLabels,
		metadataOnlyReason: evidence.metadata.reason
	});
	return evidence;
}

export function buildEstimateAiCadEvidence(file: AssetFile): Promise<AiCadArtifactData> {
	const key = cadEvidenceCacheKey(file);
	const cached = cadEvidenceCache.get(key);
	if (cached) return cached;

	const prepared = prepareEstimateAiCadEvidence(file).catch((error) => {
		cadEvidenceCache.delete(key);
		throw error;
	});
	cadEvidenceCache.set(key, prepared);
	while (cadEvidenceCache.size > CAD_EVIDENCE_CACHE_LIMIT) {
		const oldestKey = cadEvidenceCache.keys().next().value as string | undefined;
		if (!oldestKey) break;
		cadEvidenceCache.delete(oldestKey);
	}
	return prepared;
}

export const _testExports = {
	parseSvgDimensions: (svg: string) => parseSvgDimensions(svg, DXF_RENDER_SIZE),
	clearCache: () => {
		cadEvidenceCache.clear();
		disposeSharedCadEvidenceRenderer();
	},
	disposeRenderer: disposeSharedCadEvidenceRenderer
};
