/**
 * Office & 2D CAD Parser Worker
 *
 * Runs SheetJS (xlsx), Mammoth (docx), and @linkiez/dxf-renew (DXF→SVG)
 * entirely off the main thread to keep the Svelte UI at 120 FPS during
 * heavy document loads.
 *
 * Best-practice references:
 *   - SheetJS Web Worker guide: https://docs.sheetjs.com/docs/demos/worker/
 *   - MDN Transferable Objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
 *   - Comlink: https://github.com/GoogleChromeLabs/comlink
 *
 * All parse methods accept an ArrayBuffer that has been transferred (not
 * cloned) from the main thread. This is zero-copy: after postMessage the
 * main thread no longer owns the buffer, removing the most expensive part
 * of large document handling.
 */

import * as Comlink from 'comlink';
import { cleanMTextFormatting } from '../services/cad-text-utils.js';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface WorkerSpreadsheetSheet {
	name: string;
	headers: string[];
	headerRowNumber: number | null;
	rows: string[][];
	rowNumbers: number[];
	columnStart: number;
	rowCount: number;
	columnCount: number;
	formulaCount: number;
}

export interface WorkerSpreadsheetResult {
	kind: 'spreadsheet';
	sheets: WorkerSpreadsheetSheet[];
}

export interface WorkerDocumentResult {
	kind: 'document';
	html: string;
	messages: string[];
}

export interface WorkerDxfResult {
	kind: 'dxf';
	svg: string;
	entityCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseCellValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

// ── Worker API ────────────────────────────────────────────────────────────────

export async function parseSpreadsheetBuffer(
	buffer: ArrayBuffer
): Promise<WorkerSpreadsheetResult> {
	const XLSX = await import('xlsx');
	const bytes = new Uint8Array(buffer);
	const workbook = XLSX.read(bytes, { type: 'array' });
	const sheets: WorkerSpreadsheetSheet[] = workbook.SheetNames.map((sheetName) => {
		const worksheet = workbook.Sheets[sheetName];
		const cells = Object.entries(worksheet ?? {}).flatMap(([address, cell]) => {
			if (!/^[A-Z]+[1-9]\d*$/i.test(address)) return [];
			const coordinate = XLSX.utils.decode_cell(address);
			const source = cell as { f?: unknown; w?: unknown; v?: unknown };
			const formula = typeof source.f === 'string' ? source.f.trim() : '';
			return [
				{
					row: coordinate.r,
					column: coordinate.c,
					value: formula ? `=${formula}` : normaliseCellValue(source.w ?? source.v),
					formula: formula.length > 0
				}
			];
		});
		if (cells.length === 0) {
			return {
				name: sheetName,
				headers: [],
				headerRowNumber: null,
				rows: [],
				rowNumbers: [],
				columnStart: 0,
				rowCount: 0,
				columnCount: 0,
				formulaCount: 0
			};
		}

		const columnStart = Math.min(...cells.map((cell) => cell.column));
		const columnEnd = Math.max(...cells.map((cell) => cell.column));
		const columnCount = columnEnd - columnStart + 1;
		const rowsByNumber = new Map<number, string[]>();
		for (const cell of cells) {
			const row = rowsByNumber.get(cell.row) ?? Array.from({ length: columnCount }, () => '');
			row[cell.column - columnStart] = cell.value;
			rowsByNumber.set(cell.row, row);
		}
		const usedRows = Array.from(rowsByNumber.entries()).sort(([left], [right]) => left - right);
		const [headerEntry, ...bodyEntries] = usedRows;
		const headers = headerEntry?.[1] ?? [];

		return {
			name: sheetName,
			headers,
			headerRowNumber: headerEntry ? headerEntry[0] + 1 : null,
			rows: bodyEntries.map(([, row]) => row),
			rowNumbers: bodyEntries.map(([rowNumber]) => rowNumber + 1),
			columnStart,
			rowCount: bodyEntries.length,
			columnCount,
			formulaCount: cells.filter((cell) => cell.formula).length
		};
	});

	return { kind: 'spreadsheet', sheets };
}

const workerAPI = {
	/**
	 * Parse an Excel/CSV buffer with SheetJS.
	 * The buffer is consumed (transferred) — do not reuse it on the caller side.
	 */
	parseSpreadsheet: parseSpreadsheetBuffer,

	/**
	 * Parse a DOCX buffer with Mammoth and return sanitised HTML.
	 * The buffer is consumed (transferred).
	 */
	async parseDocument(buffer: ArrayBuffer): Promise<WorkerDocumentResult> {
		const mammoth = await import('mammoth');
		const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

		return {
			kind: 'document',
			html: result.value, // sanitiseHtmlMarkup runs on the main thread post-transfer
			messages: result.messages.map((m) => m.message)
		};
	},

	async parseDxf(dxfSource: string): Promise<WorkerDxfResult> {
		const { Helper: DxfHelper } = await import('@linkiez/dxf-renew');

		// Strip MTEXT formatting from the raw DXF source before rendering.
		// dxf-renew reads entity.string and passes it through escapeXmlText,
		// so we normalise the text content inline.
		const cleanedSource = dxfSource.replace(
			/(^\s*1\n)(.*)/gm,
			(_match, prefix, content) => `${prefix}${cleanMTextFormatting(content)}`
		);

		const helper = new DxfHelper(cleanedSource);
		const svg = helper.toSVG();
		const entityCount = Array.isArray(helper.parsed?.entities) ? helper.parsed.entities.length : 0;

		return { kind: 'dxf', svg, entityCount };
	},

	/**
	 * Parse DWG bytes using LibreDWG WASM and return DXF + metadata.
	 * Runs on worker thread to avoid blocking the main UI loop.
	 */
	async parseDwg(dwgBytes: Uint8Array): Promise<{ dxfContent: string; metadata?: string }> {
		const { convertDwgToDxf } = await import('../services/dwg-core-converter.js');
		return convertDwgToDxf(dwgBytes);
	}
};

export type OfficeParserWorkerAPI = typeof workerAPI;

Comlink.expose(workerAPI);
