/**
 * DWG → DXF → SVG conversion service using LibreDWG WASM.
 * Delegated to a background Web Worker to keep Svelte UI responsive.
 */
import * as Comlink from 'comlink';
import type { OfficeParserWorkerAPI } from '../workers/office-parser.worker.js';
import { createLogger } from './logger.js';

const log = createLogger('dwgConverter');
const SVG_TIMEOUT_MS = 15_000;

export {
	serializeDxfEntity,
	extractDwgEntityMetadata,
	serializeEntityMetadata,
	extractSvgEntityTypes,
	type CadEntityTypeCount,
	type CadLayerBreakdown,
	type CadEntityMetadata
} from './dwg-core-converter.js';

export async function convertDwgToDxf(
	dwgBytes: Uint8Array
): Promise<{ dxfContent: string; metadata?: string }> {
	log.info('DWG: starting conversion to DXF in background worker');
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('../workers/office-parser.worker.ts', import.meta.url), {
			type: 'module'
		});
		const api = Comlink.wrap<OfficeParserWorkerAPI>(worker);

		api
			.parseDwg(dwgBytes)
			.then((res) => {
				worker.terminate();
				resolve(res);
			})
			.catch((err) => {
				worker.terminate();
				reject(err);
			});
	});
}

export async function convertDwgToSvg(
	dwgBytes: Uint8Array
): Promise<{ svg: string; metadata?: string }> {
	log.info('DWG: starting conversion to SVG in background worker');
	// convertDwgToDxf runs the WASM pipeline inside the worker.
	const { dxfContent, metadata } = await convertDwgToDxf(dwgBytes);

	// toSVG can be slow for complex drawings (1000+ entities).
	// We run it in a Web Worker to avoid blocking the main thread,
	// and use a terminator if it exceeds the timeout.
	const svg = await new Promise<string>((resolve, reject) => {
		const worker = new Worker(new URL('../workers/office-parser.worker.ts', import.meta.url), {
			type: 'module'
		});
		const api = Comlink.wrap<OfficeParserWorkerAPI>(worker);

		const timer = setTimeout(() => {
			worker.terminate();
			reject(new Error('DWG: SVG rendering timed out'));
		}, SVG_TIMEOUT_MS);

		api
			.parseDxf(dxfContent)
			.then((result) => {
				clearTimeout(timer);
				worker.terminate();
				resolve(result.svg);
			})
			.catch((err) => {
				clearTimeout(timer);
				worker.terminate();
				resolve(`DWG: SVG render failed — ${err instanceof Error ? err.message : String(err)}`);
			});
	});

	return { svg, metadata };
}
