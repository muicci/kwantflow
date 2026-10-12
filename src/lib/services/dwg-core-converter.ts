/**
 * DWG → DXF conversion service using LibreDWG WASM.
 * Core implementation designed to run inside Web Worker threads (logger-neutral).
 *
 * Uses @mlightcad/libredwg-web.
 * Docs: https://mlightcad.github.io/libredwg-web/docs/
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanMTextFormatting } from './cad-text-utils.js';
import { createLogger } from './logger.js';

const log = createLogger('dwg-core-converter');

let libreDwgPromise: Promise<any> | null = null;

async function getLibreDwg(): Promise<any> {
	if (!libreDwgPromise) {
		try {
			const { LibreDwg } = await import('@mlightcad/libredwg-web');
			libreDwgPromise = LibreDwg.create('/wasm');
		} catch (err) {
			libreDwgPromise = null; // Allow retry on next call
			throw new Error(
				`DWG: failed to load LibreDWG — ${err instanceof Error ? err.message : String(err)}`,
				{ cause: err }
			);
		}
	}
	return libreDwgPromise;
}

export async function convertDwgToDxf(
	dwgBytes: Uint8Array
): Promise<{ dxfContent: string; metadata?: string }> {
	const libredwg = await getLibreDwg();

	// Ensure a clean, properly-sized ArrayBuffer (not a view into a larger buffer)
	const cleanBuffer = dwgBytes.slice().buffer;

	const { Dwg_File_Type } = await import('@mlightcad/libredwg-web');

	// Read DWG data from bytes (uses WASM embind internally, no FS needed)
	let dwgData;
	try {
		dwgData = libredwg.dwg_read_data(cleanBuffer, Dwg_File_Type.DWG);
	} catch (e) {
		const inputPath = 'in-memory-buffer';
		log.error('DWG conversion failed', { inputPath, error: e });
		throw new Error(`DWG: read failed — ${e instanceof Error ? e.message : String(e)}`, {
			cause: e
		});
	}

	if (!dwgData) {
		throw new Error('DWG: read returned null — file may be from an unsupported version');
	}

	try {
		// Convert raw DWG data to a structured DwgDatabase
		const db = libredwg.convert(dwgData);

		if (!db) {
			throw new Error('DWG: convert returned null — no parseable data');
		}

		log.info(
			`DWG: parsed ${db.entities?.length || 0} entities, ${db.tables?.LAYER?.entries?.length || 0} layers, ${db.tables?.BLOCK_RECORD?.entries?.length || 0} block records`
		);

		// Extract structured layer and entity metadata before serializing
		let serializedMetadata: string | undefined;
		try {
			const metadata = extractDwgEntityMetadata(db);
			serializedMetadata = serializeEntityMetadata(metadata);
		} catch (metaErr) {
			log.warn('Failed to extract DWG entity metadata', { error: metaErr });
		}

		// Serialize DwgDatabase to a DXF string
		const dxfContent = dwgDatabaseToSimpleDxf(db);
		if (dxfContent.length < 100) {
			throw new Error('DWG: no usable entities found in the drawing');
		}

		return { dxfContent, metadata: serializedMetadata };
	} finally {
		// Free the raw C heap allocation
		libredwg.dwg_free(dwgData);
	}
}

// ── DXF Serializer ──────────────────────────────────────────────────────────

export type CadEntityTypeCount = {
	type: string;
	count: number;
};

export type CadLayerBreakdown = {
	name: string;
	entityTypes: CadEntityTypeCount[];
	total: number;
};

export type CadEntityMetadata = {
	entityCount: number;
	layerCount: number;
	layers: CadLayerBreakdown[];
	textLabels: string[];
	dimensionValues: string[];
};

export function extractDwgEntityMetadata(db: any): CadEntityMetadata {
	const entities: Array<any> = db.entities || [];
	const layerEntries: Array<any> = db.tables?.LAYER?.entries || [];

	const layerMap = new Map<string, Map<string, number>>();
	let totalEntities = 0;

	for (const ent of entities) {
		if (!ent) continue;
		const type = ent.type || 'UNKNOWN';
		const layer = ent.layer || '0';

		if (!layerMap.has(layer)) {
			layerMap.set(layer, new Map());
		}
		const typeMap = layerMap.get(layer)!;
		typeMap.set(type, (typeMap.get(type) || 0) + 1);
		totalEntities++;
	}

	const layers: CadLayerBreakdown[] = [];
	for (const [layerName, typeMap] of layerMap) {
		const entityTypes: CadEntityTypeCount[] = [];
		let layerTotal = 0;
		for (const [type, count] of typeMap) {
			entityTypes.push({ type, count });
			layerTotal += count;
		}
		entityTypes.sort((a, b) => b.count - a.count);
		layers.push({
			name: layerName,
			entityTypes,
			total: layerTotal
		});
	}
	layers.sort((a, b) => b.total - a.total);

	const textLabels: string[] = [];
	const dimensionValues: string[] = [];
	for (const ent of entities) {
		if (!ent) continue;
		const type = (ent.type || '').toUpperCase();
		if (type === 'TEXT' || type === 'MTEXT') {
			const text = ent.text || ent.value || '';
			if (text.trim()) textLabels.push(text.trim());
		}
		if (type === 'DIMENSION' || type === 'DIMLINEAR' || type === 'DIMALIGNED') {
			const text = ent.text || '';
			if (text.trim()) dimensionValues.push(text.trim());
		}
	}

	return {
		entityCount: totalEntities,
		layerCount: layerEntries.length,
		layers,
		textLabels: textLabels.slice(0, 50),
		dimensionValues: dimensionValues.slice(0, 30)
	};
}

export function serializeEntityMetadata(meta: CadEntityMetadata): string {
	const parts: string[] = [];
	parts.push(`Entities: ${meta.entityCount}, layers: ${meta.layerCount}`);

	for (const layer of meta.layers) {
		const typeSummary = layer.entityTypes.map((t) => `${t.type}:${t.count}`).join(', ');
		parts.push(`Layer "${layer.name}": ${layer.total} — ${typeSummary}`);
	}

	if (meta.textLabels.length > 0) {
		parts.push(`Labels: ${meta.textLabels.join(' | ')}`);
	}

	if (meta.dimensionValues.length > 0) {
		parts.push(`Dimensions: ${meta.dimensionValues.join(', ')}`);
	}

	return parts.join('\n');
}

export function extractSvgEntityTypes(svg: string): CadEntityTypeCount[] {
	const tagCount = new Map<string, number>();
	const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)[\s>]/g;
	let match;
	while ((match = tagRegex.exec(svg)) !== null) {
		const tag = match[1].toUpperCase();
		if (['SVG', 'DEFS', 'G', 'LINEARGRADIENT', 'STOP', 'CLIPPATH'].includes(tag)) continue;
		tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
	}

	return Array.from(tagCount.entries())
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count);
}

function dwgDatabaseToSimpleDxf(db: any): string {
	const lines: string[] = [];

	push(lines, 0, 'SECTION');
	push(lines, 2, 'HEADER');
	push(lines, 9, '$ACADVER');
	push(lines, 1, 'AC1027');
	push(lines, 0, 'ENDSEC');

	push(lines, 0, 'SECTION');
	push(lines, 2, 'TABLES');

	push(lines, 0, 'TABLE');
	push(lines, 2, 'LTYPE');
	push(lines, 70, 1);
	push(lines, 0, 'LTYPE');
	push(lines, 2, 'CONTINUOUS');
	push(lines, 70, 64);
	push(lines, 3, 'Solid line');
	push(lines, 72, 65);
	push(lines, 73, 0);
	push(lines, 40, 0.0);
	push(lines, 0, 'ENDTAB');

	push(lines, 0, 'TABLE');
	push(lines, 2, 'LAYER');
	const layerEntries: Array<{ name: string; color: number }> = db.tables?.LAYER?.entries || [];
	push(lines, 70, layerEntries.length || 1);
	for (const layer of layerEntries) {
		push(lines, 0, 'LAYER');
		push(lines, 2, layer.name || '0');
		push(lines, 70, 0);
		push(lines, 62, typeof layer.color === 'number' ? layer.color : 7);
		push(lines, 6, 'CONTINUOUS');
	}
	if (layerEntries.length === 0) {
		push(lines, 0, 'LAYER');
		push(lines, 2, '0');
		push(lines, 70, 0);
		push(lines, 62, 7);
		push(lines, 6, 'CONTINUOUS');
	}
	push(lines, 0, 'ENDTAB');
	push(lines, 0, 'ENDSEC');

	push(lines, 0, 'SECTION');
	push(lines, 2, 'BLOCKS');

	const blockRecords: Array<{
		name: string;
		basePoint?: { x: number; y: number; z: number };
		entities?: any[];
		flags?: number;
	}> = db.tables?.BLOCK_RECORD?.entries || [];

	for (const block of blockRecords) {
		const ucName = (block.name || '').toUpperCase();
		if (ucName === '*MODEL_SPACE') continue;
		if (ucName.startsWith('*PAPER_SPACE')) continue;

		const flags = block.flags ?? 0;
		if (flags & 4) continue;
		if (flags & 8) continue;
		if (flags & 16) continue;

		serializeDxfBlock(lines, block);
	}

	push(lines, 0, 'ENDSEC');

	push(lines, 0, 'SECTION');
	push(lines, 2, 'ENTITIES');

	const entities: any[] = db.entities || [];
	for (const ent of entities) {
		if (!ent) continue;
		serializeDxfEntity(lines, ent);
	}

	push(lines, 0, 'ENDSEC');
	push(lines, 0, 'EOF');

	return lines.join('\n');
}

function serializeDxfBlock(lines: string[], block: any): void {
	const name = block.name || '';
	const bp = block.basePoint || { x: 0, y: 0, z: 0 };
	const flags = block.flags ?? 0;

	push(lines, 0, 'BLOCK');
	push(lines, 8, '0');
	push(lines, 2, name);
	push(lines, 10, bp.x ?? 0);
	push(lines, 20, bp.y ?? 0);
	push(lines, 30, bp.z ?? 0);
	push(lines, 70, flags);

	const blockEntities: any[] = block.entities || [];
	for (const ent of blockEntities) {
		if (!ent) continue;
		serializeDxfEntity(lines, ent);
	}

	push(lines, 0, 'ENDBLK');
}

export function serializeDxfEntity(lines: string[], ent: any): void {
	if (!ent) return;
	const type = dxfEntityType(ent.type || 'LINE');
	if (!type) {
		log.warn(`DWG: skipping unknown entity type in DXF: ${ent.type}`);
		return;
	}

	push(lines, 0, type);
	push(lines, 8, ent.layer || '0');

	if (typeof ent.color === 'number') {
		push(lines, 62, ent.color);
	}

	switch (type) {
		case 'LINE': {
			const sp = ent.startPoint || ent.point || { x: 0, y: 0 };
			const ep = ent.endPoint || { x: 0, y: 0 };
			pushPt(lines, 10, sp);
			pushPt(lines, 11, ep);
			break;
		}
		case 'LWPOLYLINE': {
			const verts: Array<{ x: number; y: number }> = ent.vertices || [];
			push(lines, 90, verts.length);
			push(lines, 70, (ent.flag ?? ent.flags ?? 0) & 255);
			for (const v of verts) {
				pushPt(lines, 10, v);
				push(lines, 40, 0);
				push(lines, 41, 0);
				push(lines, 42, 0);
			}
			break;
		}
		case 'CIRCLE':
		case 'ARC': {
			const c = ent.center || { x: 0, y: 0 };
			pushPt(lines, 10, c);
			push(lines, 40, ent.radius ?? 1);
			if (type === 'ARC') {
				push(lines, 50, ent.startAngle ?? 0);
				push(lines, 51, ent.endAngle ?? 360);
			}
			break;
		}
		case 'POINT': {
			const pt = ent.position || ent.location || { x: 0, y: 0 };
			pushPt(lines, 10, pt);
			break;
		}
		case 'TEXT': {
			pushPt(lines, 10, ent.startPoint || { x: 0, y: 0 });
			push(lines, 40, ent.textHeight ?? ent.height ?? 2.5);
			const rawText = ent.text || ent.value || '';
			push(lines, 1, cleanMTextFormatting(rawText));
			if (ent.styleName) {
				push(lines, 7, ent.styleName);
			}
			break;
		}
		case 'MTEXT': {
			pushPt(lines, 10, ent.insertionPoint || { x: 0, y: 0 });
			push(lines, 40, ent.height ?? 2.5);
			const textValue = Array.isArray(ent.text)
				? ent.text.join('\\P')
				: ent.text || ent.value || '';
			push(lines, 1, cleanMTextFormatting(textValue));
			if (ent.styleName) {
				push(lines, 7, ent.styleName);
			}
			break;
		}
		case 'INSERT': {
			pushPt(lines, 10, ent.insertionPoint || ent.startPoint || { x: 0, y: 0 });
			push(lines, 2, ent.name || '');
			push(lines, 41, ent.xScale ?? 1);
			push(lines, 42, ent.yScale ?? 1);
			push(lines, 43, ent.zScale ?? 1);
			push(lines, 50, ent.rotation ?? 0);
			break;
		}
		case 'POLYLINE': {
			push(lines, 66, 1);
			push(lines, 70, (ent.flag ?? ent.flags ?? 0) & 255);
			if (ent.elevation != null && ent.elevation !== 0) {
				push(lines, 30, ent.elevation);
			}
			if (ent.thickness != null && ent.thickness !== 0) {
				push(lines, 39, ent.thickness);
			}
			const polyVertices: Array<{
				x?: number;
				y?: number;
				z?: number;
				bulge?: number;
				startWidth?: number;
				endWidth?: number;
				flag?: number;
			}> = ent.vertices || [];
			for (const v of polyVertices) {
				push(lines, 0, 'VERTEX');
				push(lines, 8, ent.layer || '0');
				pushPt(lines, 10, { x: v.x ?? 0, y: v.y ?? 0, z: v.z });
				if (v.bulge != null && v.bulge !== 0) {
					push(lines, 42, v.bulge);
				}
				if (v.startWidth != null && v.startWidth !== 0) {
					push(lines, 40, v.startWidth);
				}
				if (v.endWidth != null && v.endWidth !== 0) {
					push(lines, 41, v.endWidth);
				}
				if (v.flag != null && v.flag !== 0) {
					push(lines, 70, v.flag);
				}
			}
			push(lines, 0, 'SEQEND');
			push(lines, 8, ent.layer || '0');
			break;
		}
		case 'ATTDEF':
		case 'ATTRIB': {
			pushPt(lines, 10, ent.startPoint || ent.insertionPoint || { x: 0, y: 0 });
			push(lines, 40, ent.textHeight ?? ent.height ?? 2.5);
			push(lines, 1, ent.text ?? '');
			push(lines, 2, ent.tag ?? ent.prompt ?? '');
			push(lines, 70, ent.flags ?? 0);
			if (ent.styleName) {
				push(lines, 7, ent.styleName);
			}
			break;
		}
		case 'ELLIPSE': {
			const c = ent.center || { x: 0, y: 0 };
			pushPt(lines, 10, c);
			const majorEnd = ent.majorAxisEndPoint || { x: 1, y: 0, z: 0 };
			pushPt(lines, 11, majorEnd);
			push(lines, 40, ent.axisRatio ?? 0.5);
			push(lines, 41, ent.startAngle ?? 0);
			push(lines, 42, ent.endAngle ?? Math.PI * 2);
			break;
		}
		case 'SPLINE': {
			push(lines, 70, ent.flag ?? ent.flags ?? 0);
			push(lines, 71, ent.degree ?? 3);
			const knots: number[] = ent.knots || [];
			push(lines, 72, knots.length);
			const controlPts: Array<{ x?: number; y?: number; z?: number }> = ent.controlPoints || [];
			push(lines, 73, controlPts.length);
			const fitPts: Array<{ x?: number; y?: number; z?: number }> = ent.fitPoints || [];
			push(lines, 74, fitPts.length);
			push(lines, 42, ent.knotTolerance ?? 0.0001);
			push(lines, 43, ent.controlTolerance ?? 0.0001);
			push(lines, 44, ent.fitTolerance ?? 0.0001);
			for (const k of knots) {
				push(lines, 40, k);
			}
			const weights: number[] = ent.weights || [];
			if (weights.length > 0) {
				for (const w of weights) {
					push(lines, 41, w);
				}
			}
			for (const cp of controlPts) {
				pushPt(lines, 10, cp);
			}
			for (const fp of fitPts) {
				pushPt(lines, 11, fp);
			}
			if (ent.startTangent) {
				pushPt(lines, 12, ent.startTangent);
			}
			if (ent.endTangent) {
				pushPt(lines, 13, ent.endTangent);
			}
			break;
		}
		case 'SOLID':
		case 'TRACE': {
			const c1 = ent.corner1 || { x: 0, y: 0 };
			const c2 = ent.corner2 || { x: 0, y: 0 };
			const c3 = ent.corner3 || { x: 0, y: 0 };
			const c4 = ent.corner4 || c3 || { x: 0, y: 0 };
			pushPt(lines, 10, c1);
			pushPt(lines, 11, c2);
			pushPt(lines, 12, c3);
			pushPt(lines, 13, c4);
			if (ent.thickness != null && ent.thickness !== 0) {
				push(lines, 39, ent.thickness);
			}
			break;
		}
		case '3DFACE': {
			const c1 = ent.corner1 || { x: 0, y: 0 };
			const c2 = ent.corner2 || { x: 0, y: 0 };
			const c3 = ent.corner3 || { x: 0, y: 0 };
			const c4 = ent.corner4 || c3 || { x: 0, y: 0 };
			pushPt(lines, 10, c1);
			pushPt(lines, 11, c2);
			pushPt(lines, 12, c3);
			pushPt(lines, 13, c4);
			if (ent.flag != null && ent.flag !== 0) {
				push(lines, 70, ent.flag);
			}
			break;
		}
		case 'WIPEOUT': {
			pushPt(lines, 10, ent.position || { x: 0, y: 0 });
			pushPt(lines, 11, ent.uPixel || { x: 1, y: 0 });
			pushPt(lines, 12, ent.vPixel || { x: 0, y: 1 });
			const imgSize = ent.imageSize || { x: 1, y: 1 };
			push(lines, 13, imgSize.x ?? 1);
			push(lines, 23, imgSize.y ?? 1);
			push(lines, 340, ent.imageDefHandle ?? 0);
			push(lines, 70, ent.flags ?? 0);
			push(lines, 280, ent.clipping ?? 0);
			push(lines, 281, ent.brightness ?? 50);
			push(lines, 282, ent.contrast ?? 50);
			push(lines, 283, ent.fade ?? 0);
			push(lines, 71, ent.clippingBoundaryType ?? 2);
			const path: Array<{ x: number; y: number }> = ent.clippingBoundaryPath || [];
			push(lines, 91, path.length);
			for (const pt of path) {
				push(lines, 14, pt.x);
				push(lines, 24, pt.y);
			}
			break;
		}
		case 'TOLERANCE': {
			pushPt(lines, 10, ent.insertionPoint || { x: 0, y: 0 });
			push(lines, 1, ent.text ?? '');
			push(lines, 3, ent.styleName ?? 'Standard');
			pushPt(lines, 11, ent.xAxisDirection || { x: 1, y: 0 });
			if (ent.extrusionDirection) {
				pushPt(lines, 210, ent.extrusionDirection);
			}
			break;
		}
		case 'DIMENSION': {
			pushPt(lines, 10, ent.definitionPoint || { x: 0, y: 0 });
			pushPt(lines, 11, ent.textPoint || ent.definitionPoint || { x: 0, y: 0 });
			push(lines, 70, ent.dimensionType ?? 0);
			push(lines, 1, ent.text ?? '');
			push(lines, 3, ent.styleName ?? 'Standard');

			const dimWithSubs = ent as {
				subDefinitionPoint1?: { x: number; y: number; z: number };
				subDefinitionPoint2?: { x: number; y: number; z: number };
				centerPoint?: { x: number; y: number; z: number };
				leaderLength?: number;
				arcPoint?: { x: number; y: number; z: number };
			};
			if (dimWithSubs.subDefinitionPoint1) {
				pushPt(lines, 13, dimWithSubs.subDefinitionPoint1);
			}
			if (dimWithSubs.subDefinitionPoint2) {
				pushPt(lines, 14, dimWithSubs.subDefinitionPoint2);
			}
			if (dimWithSubs.centerPoint) {
				pushPt(lines, 15, dimWithSubs.centerPoint);
			}
			if (dimWithSubs.arcPoint) {
				pushPt(lines, 16, dimWithSubs.arcPoint);
			}
			if (dimWithSubs.leaderLength != null) {
				push(lines, 40, dimWithSubs.leaderLength);
			}
			if (ent.dimensionType != null && (ent.dimensionType & 64) !== 0) {
				push(lines, 86, 1);
			}
			break;
		}
		case 'LEADER': {
			const verts: Array<{ x?: number; y?: number; z?: number }> = ent.vertices || [];
			for (const v of verts) {
				pushPt(lines, 10, v);
			}
			push(lines, 71, ent.isArrowheadEnabled ? 1 : 0);
			push(lines, 72, ent.leaderCreationFlag ?? 3);
			push(lines, 73, verts.length);
			push(lines, 74, ent.isHooklineExists ? 1 : 0);
			push(lines, 3, ent.styleName ?? 'Standard');
			if (ent.textHeight != null) {
				push(lines, 40, ent.textHeight);
			}
			if (ent.textWidth != null) {
				push(lines, 41, ent.textWidth);
			}
			break;
		}
		case 'IMAGE': {
			pushPt(lines, 10, ent.position || { x: 0, y: 0 });
			pushPt(lines, 11, ent.uPixel || { x: 1, y: 0 });
			pushPt(lines, 12, ent.vPixel || { x: 0, y: 1 });
			const imgSize = ent.imageSize || { x: 1, y: 1 };
			push(lines, 13, imgSize.x ?? 1);
			push(lines, 23, imgSize.y ?? 1);
			push(lines, 340, ent.imageDefHandle ?? 0);
			push(lines, 70, ent.flags ?? 0);
			push(lines, 280, ent.clipping ?? 0);
			push(lines, 71, ent.brightness ?? 50);
			push(lines, 72, ent.contrast ?? 50);
			push(lines, 73, ent.fade ?? 0);
			break;
		}
		case 'HATCH': {
			const isSolid = ent.solidFill === 1 || ent.patternName === 'SOLID';
			const paths: Array<{
				vertices?: Array<{ x: number; y: number; bulge?: number }>;
				edges?: Array<{ type?: number }>;
			}> = ent.boundaryPaths || [];

			if (isSolid && paths.length > 0) {
				const firstPath = paths[0];
				const verts = firstPath.vertices || [];
				if (verts.length >= 3) {
					push(lines, 0, 'SOLID');
					push(lines, 8, ent.layer || '0');
					if (typeof ent.color === 'number') {
						push(lines, 62, ent.color);
					}
					const pts = verts.slice(0, 4);
					const ordered =
						pts.length === 4
							? [pts[0], pts[1], pts[3], pts[2]]
							: pts.length === 3
								? [pts[0], pts[1], pts[2], pts[2]]
								: pts;
					pushPt(lines, 10, ordered[0] || { x: 0, y: 0 });
					pushPt(lines, 11, ordered[1] || { x: 0, y: 0 });
					pushPt(lines, 12, ordered[2] || { x: 0, y: 0 });
					pushPt(lines, 13, ordered[3] || ordered[2] || { x: 0, y: 0 });
				}
			}

			const elev = ent.elevationPoint || { x: 0, y: 0 };
			push(lines, 10, elev.x ?? 0);
			push(lines, 20, elev.y ?? 0);
			push(lines, 30, elev.z ?? 0);
			const extrude = ent.extrusionDirection || { x: 0, y: 0, z: 1 };
			push(lines, 210, extrude.x ?? 0);
			push(lines, 220, extrude.y ?? 0);
			push(lines, 230, extrude.z ?? 1);
			push(lines, 2, isSolid ? 'SOLID' : ent.patternName || 'SOLID');
			push(lines, 70, isSolid ? 1 : 0);
			push(lines, 71, ent.associativity ?? 0);
			push(lines, 63, ent.patternFillColor ?? 7);
			push(lines, 91, paths.length);
			for (const path of paths) {
				const pathType = (path as { boundaryPathTypeFlag?: number }).boundaryPathTypeFlag ?? 0;
				push(lines, 92, pathType);
				const verts = path.vertices || [];
				if (verts.length > 0) {
					push(lines, 72, (path as { hasBulge?: boolean }).hasBulge ? 1 : 0);
					push(lines, 73, (path as { isClosed?: boolean }).isClosed ? 1 : 0);
					push(lines, 93, verts.length);
					for (const v of verts) {
						push(lines, 10, v.x ?? 0);
						push(lines, 20, v.y ?? 0);
						if (v.bulge != null) {
							push(lines, 42, v.bulge);
						}
					}
				} else if (path.edges && path.edges.length > 0) {
					push(lines, 97, path.edges.length);
					for (const edge of path.edges) {
						push(lines, 72, edge.type ?? 1);
					}
				}
			}
			push(lines, 75, ent.hatchStyle ?? 0);
			push(lines, 76, ent.patternType ?? 0);
			const defLines: Array<{
				angle?: number;
				base?: { x?: number; y?: number };
				offset?: { x?: number; y?: number };
				dashLengths?: number[];
			}> = ent.definitionLines || [];
			if (!isSolid) {
				push(lines, 52, ent.patternAngle ?? 0);
				push(lines, 41, ent.patternScale ?? 1);
				push(lines, 77, ent.pixelSize ?? 0);
				push(lines, 78, defLines.length);
				for (const dl of defLines) {
					push(lines, 53, dl.angle ?? 0);
					push(lines, 43, dl.base?.x ?? 0);
					push(lines, 44, dl.base?.y ?? 0);
					push(lines, 45, dl.offset?.x ?? 0);
					push(lines, 46, dl.offset?.y ?? 0);
					push(lines, 79, dl.dashLengths?.length ?? 0);
					if (dl.dashLengths) {
						for (const d of dl.dashLengths) {
							push(lines, 49, d);
						}
					}
				}
			}
			const seeds: Array<{ x?: number; y?: number }> = ent.seedPoints || [];
			push(lines, 98, seeds.length);
			for (const s of seeds) {
				push(lines, 10, s.x ?? 0);
				push(lines, 20, s.y ?? 0);
			}
			break;
		}
		case 'RAY':
		case 'XLINE': {
			pushPt(lines, 10, ent.firstPoint || { x: 0, y: 0 });
			pushPt(lines, 11, ent.unitDirection || { x: 1, y: 0 });
			break;
		}
		case 'VIEWPORT': {
			pushPt(lines, 10, ent.viewportCenter || { x: 0, y: 0 });
			push(lines, 40, ent.width ?? 100);
			push(lines, 41, ent.height ?? 100);
			push(lines, 68, ent.status ?? 0);
			push(lines, 69, ent.viewportId ?? 0);
			if (ent.displayCenter) {
				push(lines, 12, (ent.displayCenter as { x: number; y: number }).x ?? 0);
				push(lines, 22, (ent.displayCenter as { x: number; y: number }).y ?? 0);
			}
			break;
		}
		default: {
			const pt = ent.position || ent.startPoint || ent.center || { x: 0, y: 0 };
			pushPt(lines, 10, pt);
			break;
		}
	}
}

const ENTITY_TYPE_MAP: Record<string, string> = {
	LINE: 'LINE',
	LWPOLYLINE: 'LWPOLYLINE',
	CIRCLE: 'CIRCLE',
	ARC: 'ARC',
	POINT: 'POINT',
	ELLIPSE: 'ELLIPSE',
	TEXT: 'TEXT',
	MTEXT: 'MTEXT',
	INSERT: 'INSERT',
	ATTDEF: 'ATTDEF',
	ATTRIB: 'ATTRIB',
	POLYLINE: 'POLYLINE',
	POLYLINE2D: 'POLYLINE',
	POLYLINE3D: 'POLYLINE',
	SPLINE: 'SPLINE',
	SOLID: 'SOLID',
	TRACE: 'TRACE',
	VIEWPORT: 'VIEWPORT',
	DIMENSION: 'DIMENSION',
	LEADER: 'LEADER',
	IMAGE: 'IMAGE',
	HATCH: 'HATCH',
	RAY: 'RAY',
	XLINE: 'XLINE',
	SHAPE: 'SHAPE',
	TOLERANCE: 'TOLERANCE',
	WIPEOUT: 'WIPEOUT',
	'3DFACE': '3DFACE'
};

function dxfEntityType(rawType: string): string | null {
	return ENTITY_TYPE_MAP[rawType.toUpperCase()] || null;
}

function pushPt(lines: string[], code: number, pt: { x?: number; y?: number; z?: number }): void {
	push(lines, code, pt.x ?? 0);
	push(lines, code + 10, pt.y ?? 0);
	if (pt.z != null && pt.z !== 0) {
		push(lines, code + 20, pt.z);
	}
}

function push(lines: string[], code: number, value: string | number): void {
	lines.push(`${code}\n${value}`);
}
