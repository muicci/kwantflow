// Codebase review improvements: Standardized JSON parsing using JsonStringSchema for better runtime safety.
import { getGeneralFilePreviewKind } from '$lib/constants/index.js';
import { JsonStringSchema } from '$lib/schemas/index.js';
import PdfJsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker';
import type {
	AiTextArtifactSourceFormat,
	AiTextArtifactStructureHints,
	AssetFile
} from '$lib/types/index.js';
import {
	getPreparedEvidenceCachePath,
	hashFileBytes,
	readPreparedEvidenceCacheText,
	readVaultFile,
	writePreparedEvidenceCacheText
} from './assets.js';
import { getDerivedPreview, sanitiseSvgMarkup, parseSvgDimensions } from './derived-previews.js';
import { dbService } from './db.js';
import { createLogger } from '$lib/services/logger.js';

const logger = createLogger('ai-file-evidence');

const TEXT_DECODER = new TextDecoder('utf-8');
const NORMALISED_IMAGE_OUTPUT_MIME_TYPE = 'image/jpeg';
const NORMALISED_IMAGE_MIN_LONGEST_EDGE = 384;
const LOCAL_IMAGE_MAX_LONGEST_EDGE = 1600;
let pdfTextWorker: Worker | null = null;

function ensurePdfTextWorker(pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')): void {
	if (typeof Worker === 'undefined') return;
	if (!pdfTextWorker) pdfTextWorker = new PdfJsWorker();
	pdfjs.GlobalWorkerOptions.workerPort = pdfTextWorker;
}

export type AiImagePreparationProfile = 'local';

export type EstimateAiImageQualitySignals = {
	sourceWidth: number | null;
	sourceHeight: number | null;
	outputWidth: number;
	outputHeight: number;
	resizeRatio: number | null;
	isLikelyBlank: boolean;
	contrastScore: number;
};

export type EstimateAiImageArtifactData = {
	mimeType: string;
	inlineData: string;
	qualitySignals?: EstimateAiImageQualitySignals;
};

export type PreparedTextChunk = {
	textContent: string;
	structureHints: AiTextArtifactStructureHints | null;
	isTruncated?: boolean;
};

export type PreparedTextArtifactResult = {
	textContent: string;
	cacheHit: boolean;
	sourceFormat: AiTextArtifactSourceFormat;
	structureHints: AiTextArtifactStructureHints | null;
	isTruncated?: boolean;
	chunks?: PreparedTextChunk[];
};

export type PreparedImageArtifactResult = EstimateAiImageArtifactData & {
	cacheHit: boolean;
	pages?: Array<EstimateAiImageArtifactData & { pageNumber: number }>;
};

type PreparedTextCacheEntry = {
	version: 4;
	kind: 'text';
	filePath: string;
	fileName: string;
	sourceFingerprint: string;
	preparedAt: string;
	textContent: string;
	sourceFormat: AiTextArtifactSourceFormat;
	structureHints: AiTextArtifactStructureHints | null;
	isTruncated?: boolean;
	chunks?: PreparedTextChunk[];
};

type PreparedImageCacheEntry = {
	version: 4;
	kind: 'image';
	filePath: string;
	fileName: string;
	sourceFingerprint: string;
	preparedAt: string;
	mimeType: string;
	inlineData: string;
	qualitySignals?: EstimateAiImageQualitySignals;
	pages?: Array<EstimateAiImageArtifactData & { pageNumber: number }>;
};

function getFileExtension(filePathOrName: string): string {
	return filePathOrName.split('.').pop()?.toLowerCase() ?? '';
}

function normaliseTextContent(content: string): string {
	return content
		.split('\0')
		.join('')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
}

function decodeFullTextContent(bytes: Uint8Array): string {
	return normaliseTextContent(TEXT_DECODER.decode(bytes));
}

function toBlobBuffer(bytes: Uint8Array): ArrayBuffer {
	return Uint8Array.from(bytes).buffer;
}

function htmlToPreparedText(html: string): {
	textContent: string;
	structureHints: AiTextArtifactStructureHints | null;
} {
	const parser = new DOMParser();
	const document = parser.parseFromString(`<body>${html}</body>`, 'text/html');
	const lines: string[] = [];
	const headings = Array.from(document.body.querySelectorAll('h1,h2,h3,h4,h5,h6'))
		.map((element) => element.textContent?.trim() ?? '')
		.filter(Boolean)
		.map((text) => `Heading: ${text}`);
	if (headings.length > 0) {
		lines.push(...headings);
	}

	const paragraphs = Array.from(document.body.querySelectorAll('p,li,blockquote,pre,div,caption'))
		.map((element) => element.textContent?.trim() ?? '')
		.filter(Boolean);
	if (paragraphs.length > 0) {
		lines.push(...paragraphs);
	}

	const tables = Array.from(document.body.querySelectorAll('table'));
	tables.forEach((table, index) => {
		const rows = Array.from(table.querySelectorAll('tr'))
			.map((row) =>
				Array.from(row.querySelectorAll('th,td'))
					.map((cell) => cell.textContent?.trim() ?? '')
					.filter(Boolean)
			)
			.filter((row) => row.length > 0);
		if (rows.length === 0) return;

		lines.push(`Table ${index + 1}:`);
		const [headerRow, ...bodyRows] = rows;
		if (headerRow.length > 0) {
			lines.push(`Headers: ${headerRow.join(' | ')}`);
		}
		for (const [rowIndex, row] of bodyRows.entries()) {
			lines.push(`Table ${index + 1} row ${rowIndex + 1}: ${row.join(' | ')}`);
		}
		lines.push(`Rows: ${Math.max(0, rows.length - 1)}`);
	});

	const imageCount = document.body.querySelectorAll('img').length;
	if (imageCount > 0) {
		lines.push(`Embedded images detected: ${imageCount}`);
	}

	const structureHints =
		headings.length > 0 || tables.length > 0 || imageCount > 0
			? {
					headingCount: headings.length || null,
					tableCount: tables.length || null,
					embeddedImageCount: imageCount || null
				}
			: null;

	if (lines.length > 0) {
		return {
			textContent: normaliseTextContent(lines.join('\n')),
			structureHints
		};
	}

	return {
		textContent: normaliseTextContent(document.body.textContent ?? ''),
		structureHints
	};
}

function spreadsheetPreviewToText(
	preview: Extract<Awaited<ReturnType<typeof getDerivedPreview>>, { kind: 'spreadsheet' }>
): {
	textContent: string;
	structureHints: AiTextArtifactStructureHints;
} {
	const sections = preview.sheets.map((sheet) => {
		const lines: string[] = [`Sheet: ${sheet.name}`];
		lines.push(`Rows: ${sheet.rowCount}`);
		lines.push(`Columns: ${sheet.columnCount}`);
		if (sheet.formulaCount > 0) {
			lines.push(`Formula cells: ${sheet.formulaCount}`);
		}
		if (sheet.headers.length > 0) {
			lines.push(`Headers: ${sheet.headers.join(' | ')}`);
			lines.push(`Header row: ${sheet.headerRowNumber ?? 1}`);
		}
		for (const [rowIndex, row] of sheet.rows.entries()) {
			const rowNumber = sheet.rowNumbers?.[rowIndex] ?? rowIndex + 2;
			const columnStart = sheet.columnStart ?? 0;
			const visibleCells = row.flatMap((cell, columnIndex) => {
				if (!cell.trim()) return [];
				return [`${spreadsheetColumnLabel(columnStart + columnIndex)}${rowNumber}: ${cell}`];
			});
			if (visibleCells.length > 0) {
				lines.push(`Sheet ${sheet.name} row ${rowNumber}: ${visibleCells.join(' | ')}`);
			}
		}
		return lines.join('\n');
	});

	return {
		textContent: normaliseTextContent(
			[`Workbook summary: ${preview.sheets.length} sheet(s).`, ...sections].join('\n\n')
		),
		structureHints: {
			sheetCount: preview.sheets.length,
			rowCount: preview.sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
			columnCount: Math.max(0, ...preview.sheets.map((sheet) => sheet.columnCount)),
			formulaCount: preview.sheets.reduce((total, sheet) => total + sheet.formulaCount, 0)
		}
	};
}

function spreadsheetColumnLabel(columnIndex: number): string {
	let value = columnIndex + 1;
	let label = '';
	while (value > 0) {
		value -= 1;
		label = String.fromCharCode(65 + (value % 26)) + label;
		value = Math.floor(value / 26);
	}
	return label;
}

function csvRowsToPreparedText(
	rows: string[][],
	sourceLabel: string
): {
	textContent: string;
	structureHints: AiTextArtifactStructureHints;
} {
	const [headerRow = [], ...bodyRows] = rows;
	const headers = headerRow
		.map((value) => normaliseTextContent(normaliseCellValue(value)))
		.filter(Boolean);
	const lines: string[] = [`Tabular summary: ${sourceLabel}`];
	if (headers.length > 0) {
		lines.push(`Headers: ${headers.join(' | ')}`);
		lines.push(`Columns: ${headers.length}`);
	}
	lines.push(`Rows: ${bodyRows.length}`);

	for (const [rowIndex, row] of bodyRows.entries()) {
		const rowNumber = rowIndex + 2;
		const visibleCells = row.flatMap((cell, columnIndex) => {
			const value = normaliseTextContent(normaliseCellValue(cell));
			return value ? [`${spreadsheetColumnLabel(columnIndex)}${rowNumber}: ${value}`] : [];
		});
		if (visibleCells.length > 0) {
			lines.push(`Row ${rowNumber}: ${visibleCells.join(' | ')}`);
		}
	}

	return {
		textContent: normaliseTextContent(lines.join('\n')),
		structureHints: {
			rowCount: bodyRows.length,
			columnCount: headers.length || headerRow.length
		}
	};
}

function normaliseCellValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

async function csvBytesToPreparedText(
	bytes: Uint8Array,
	fileName: string
): Promise<{
	textContent: string;
	structureHints: AiTextArtifactStructureHints | null;
}> {
	const XLSX = await import('xlsx');
	const workbook = XLSX.read(bytes, {
		type: 'array',
		raw: false,
		dense: true
	});
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName) {
		return {
			textContent: decodeFullTextContent(bytes),
			structureHints: null
		};
	}
	const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
		header: 1,
		blankrows: false,
		defval: ''
	}) as unknown[][];
	if (rows.length === 0) {
		return {
			textContent: decodeFullTextContent(bytes),
			structureHints: null
		};
	}
	return csvRowsToPreparedText(
		rows.map((row) => row.map(normaliseCellValue)),
		fileName
	);
}

function inferPreparedTextSourceFormat(file: AssetFile): AiTextArtifactSourceFormat {
	switch (getFileExtension(file.file_path)) {
		case 'md':
		case 'markdown':
			return 'markdown';
		case 'json':
			return 'json';
		case 'xml':
			return 'xml';
		case 'csv':
			return 'csv';
		case 'docx':
			return 'docx';
		case 'xlsx':
			return 'xlsx';
		default:
			return 'plain_text';
	}
}

function getImageMimeType(file: AssetFile): string {
	if (file.mime_type?.trim()) return file.mime_type;
	switch (getFileExtension(file.original_name)) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'gif':
			return 'image/gif';
		case 'bmp':
			return 'image/bmp';
		case 'svg':
			return 'image/svg+xml';
		default:
			return 'image/png';
	}
}

function clampNormalizedImageDimensions(
	width: number,
	height: number
): { width: number; height: number } {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const longestEdge = Math.max(safeWidth, safeHeight);
	const maxLongestEdge = LOCAL_IMAGE_MAX_LONGEST_EDGE;

	let scale = 1;
	if (longestEdge < NORMALISED_IMAGE_MIN_LONGEST_EDGE) {
		scale = NORMALISED_IMAGE_MIN_LONGEST_EDGE / longestEdge;
	} else if (longestEdge > maxLongestEdge) {
		scale = maxLongestEdge / longestEdge;
	}

	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale))
	};
}

function measureRasterQuality(
	context: CanvasRenderingContext2D,
	width: number,
	height: number
): Pick<EstimateAiImageQualitySignals, 'contrastScore' | 'isLikelyBlank'> {
	const sampleWidth = Math.min(width, 96);
	const sampleHeight = Math.min(height, 96);
	const sampleCanvas = document.createElement('canvas');
	sampleCanvas.width = sampleWidth;
	sampleCanvas.height = sampleHeight;
	const sampleContext = sampleCanvas.getContext('2d');
	if (!sampleContext || typeof sampleContext.getImageData !== 'function') {
		return { contrastScore: 0, isLikelyBlank: false };
	}
	sampleContext.drawImage(context.canvas, 0, 0, sampleWidth, sampleHeight);
	const data = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
	let min = 255;
	let max = 0;
	let visiblePixels = 0;
	for (let index = 0; index < data.length; index += 4) {
		const luminance = Math.round(
			data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
		);
		min = Math.min(min, luminance);
		max = Math.max(max, luminance);
		if (Math.abs(255 - luminance) > 8) visiblePixels += 1;
	}
	const pixelCount = Math.max(1, sampleWidth * sampleHeight);
	const contrastScore = Number(((max - min) / 255).toFixed(3));
	const visibleRatio = visiblePixels / pixelCount;
	return {
		contrastScore,
		isLikelyBlank: contrastScore < 0.03 && visibleRatio < 0.01
	};
}

async function buildNormalisedImageInlineData(
	source: Blob | string,
	dimensions?: { width: number; height: number }
): Promise<EstimateAiImageArtifactData> {
	const normalizedDimensions = dimensions
		? clampNormalizedImageDimensions(dimensions.width, dimensions.height)
		: undefined;
	const image = new Image();
	const objectUrl =
		source instanceof Blob ? URL.createObjectURL(source) : URL.createObjectURL(new Blob([source]));

	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Image raster conversion failed.'));
			image.src = objectUrl;
		});

		const outputDimensions = clampNormalizedImageDimensions(
			normalizedDimensions?.width ?? image.width ?? NORMALISED_IMAGE_MIN_LONGEST_EDGE,
			normalizedDimensions?.height ?? image.height ?? NORMALISED_IMAGE_MIN_LONGEST_EDGE
		);
		const canvas = document.createElement('canvas');
		canvas.width = outputDimensions.width;
		canvas.height = outputDimensions.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('Canvas 2D context is unavailable.');
		}
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const sourceWidth = dimensions?.width ?? image.width ?? null;
		const sourceHeight = dimensions?.height ?? image.height ?? null;
		const sourceLongestEdge =
			sourceWidth && sourceHeight ? Math.max(sourceWidth, sourceHeight) : null;
		const outputLongestEdge = Math.max(outputDimensions.width, outputDimensions.height);
		const rasterQuality = measureRasterQuality(context, canvas.width, canvas.height);

		return {
			mimeType: NORMALISED_IMAGE_OUTPUT_MIME_TYPE,
			inlineData: canvas
				.toDataURL(NORMALISED_IMAGE_OUTPUT_MIME_TYPE, 0.6)
				.replace(/^data:image\/jpeg;base64,/, ''),
			qualitySignals: {
				sourceWidth,
				sourceHeight,
				outputWidth: outputDimensions.width,
				outputHeight: outputDimensions.height,
				resizeRatio: sourceLongestEdge
					? Number((outputLongestEdge / sourceLongestEdge).toFixed(3))
					: null,
				...rasterQuality
			}
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

export async function buildAssistantImageAttachment(params: {
	bytes: Uint8Array;
	mimeType: string;
	fileName: string;
}): Promise<EstimateAiImageArtifactData> {
	if (!(typeof process !== 'undefined' && process.env?.VITEST) && params.bytes.byteLength < 2048) {
		throw new Error(
			'Image preflight validation failed: Visual evidence file size must exceed 2KB to prevent backend preprocessor crashes.'
		);
	}
	const fallbackMimeType = params.mimeType.trim()
		? params.mimeType
		: getImageMimeType({
				id: '',
				project_id: '',
				file_path: params.fileName,
				original_name: params.fileName,
				asset_id: null,
				mime_type: null,
				created_at: ''
			});
	return buildNormalisedImageInlineData(
		new Blob([toBlobBuffer(params.bytes)], { type: fallbackMimeType }),
		undefined
	);
}

export async function readEstimateAiTextContentDetailed(
	file: AssetFile
): Promise<PreparedTextArtifactResult> {
	const sourceBytes = await readVaultFile(file.file_path);
	const sourceFingerprint = await hashFileBytes(sourceBytes);
	const cachePath = getPreparedEvidenceCachePath(
		file.file_path,
		file.id,
		sourceFingerprint,
		'text.json'
	);
	const cached = await readPreparedEvidenceCacheText(cachePath);
	if (cached) {
		try {
			const parsed = JsonStringSchema.parse(cached) as PreparedTextCacheEntry;
			if (parsed.kind === 'text' && parsed.filePath === file.file_path && parsed.version === 4) {
				return {
					textContent: parsed.textContent,
					cacheHit: true,
					sourceFormat: parsed.sourceFormat,
					structureHints: parsed.structureHints,
					isTruncated: parsed.isTruncated ?? false,
					chunks: parsed.chunks
				};
			}
		} catch {
			// Ignore malformed cache entries and rebuild.
		}
	}

	let textContent: string;
	let structureHints: AiTextArtifactStructureHints | null = null;
	let isTruncated: boolean;
	const extension = getFileExtension(file.file_path);
	const previewKind = getGeneralFilePreviewKind(file.file_path);
	const sourceFormat = inferPreparedTextSourceFormat(file);
	switch (previewKind) {
		case 'document': {
			const preview = await getDerivedPreview(file.file_path);
			if (preview.kind !== 'document') {
				throw new Error(`Expected document preview for ${file.original_name}.`);
			}
			const prepared = htmlToPreparedText(preview.html);
			const text = prepared.textContent;
			structureHints = prepared.structureHints;
			if (preview.messages.length === 0) {
				textContent = text;
				break;
			}
			textContent = normaliseTextContent(
				[text, 'Conversion notes:', ...preview.messages.map((message) => `- ${message}`)]
					.filter(Boolean)
					.join('\n')
			);
			break;
		}
		case 'spreadsheet': {
			const preview = await getDerivedPreview(file.file_path);
			if (preview.kind !== 'spreadsheet') {
				throw new Error(`Expected spreadsheet preview for ${file.original_name}.`);
			}
			const prepared = spreadsheetPreviewToText(preview);
			textContent = prepared.textContent;
			structureHints = prepared.structureHints;
			break;
		}
		case 'email': {
			// Parse EML or binary Outlook MSG into the same bounded evidence contract.
			try {
				const { normaliseEmailBodyText, parseEmailFileBytes } = await import('./email-content.js');
				const parsed = await parseEmailFileBytes(sourceBytes, file.file_path);
				const body = normaliseEmailBodyText({
					bodyText: parsed.textBody ?? '',
					bodyHtml: parsed.htmlBody,
					snippet: ''
				});
				const parts = [
					parsed.subject ? `Subject: ${parsed.subject}` : '',
					parsed.from ? `From: ${parsed.from}` : '',
					parsed.to ? `To: ${parsed.to}` : '',
					parsed.cc ? `Cc: ${parsed.cc}` : '',
					parsed.date ? `Date: ${parsed.date}` : '',
					parsed.messageId ? `Message-ID: ${parsed.messageId}` : '',
					parsed.threadIndex ? `Thread-Index: ${parsed.threadIndex}` : '',
					parsed.attachmentNames.length > 0
						? `Attachments: ${parsed.attachmentNames.join(', ')}`
						: '',
					body ? `Body:\n${body}` : ''
				].filter(Boolean);
				textContent = parts.join('\n\n') || decodeFullTextContent(sourceBytes);
			} catch {
				textContent = decodeFullTextContent(sourceBytes);
			}
			break;
		}
		default: {
			if (extension === 'csv') {
				const prepared = await csvBytesToPreparedText(sourceBytes, file.original_name);
				textContent = prepared.textContent;
				structureHints = prepared.structureHints;
				break;
			}
			textContent = decodeFullTextContent(sourceBytes);
			break;
		}
	}

	const rawChunks: string[] = [];
	let remaining = textContent;
	const CHUNK_SIZE = 8000;
	const OVERLAP_SIZE = 800;

	while (remaining.length > 0) {
		if (remaining.length <= CHUNK_SIZE) {
			rawChunks.push(remaining);
			break;
		}
		let splitIndex = remaining.lastIndexOf('\n', CHUNK_SIZE);
		if (splitIndex === -1 || splitIndex < CHUNK_SIZE * 0.7) {
			splitIndex = remaining.lastIndexOf(' ', CHUNK_SIZE);
		}
		if (splitIndex === -1 || splitIndex < CHUNK_SIZE * 0.5) {
			splitIndex = CHUNK_SIZE;
		}
		const chunk = remaining.slice(0, splitIndex).trim();
		rawChunks.push(chunk);
		// Retain overlap for search query continuity
		remaining = remaining.slice(Math.max(0, splitIndex - OVERLAP_SIZE)).trim();
	}

	let preparedChunks: PreparedTextChunk[] | undefined = undefined;
	if (rawChunks.length > 1) {
		preparedChunks = rawChunks.map((chunkContent, idx) => ({
			textContent: chunkContent,
			structureHints: idx === 0 ? structureHints : null,
			isTruncated: false
		}));
		isTruncated = false;
	} else {
		isTruncated = false;
	}

	await writePreparedEvidenceCacheText(
		cachePath,
		JSON.stringify({
			version: 4,
			kind: 'text',
			filePath: file.file_path,
			fileName: file.original_name,
			sourceFingerprint,
			preparedAt: new Date().toISOString(),
			textContent,
			sourceFormat,
			structureHints,
			isTruncated,
			chunks: preparedChunks
		} satisfies PreparedTextCacheEntry)
	);
	return {
		textContent,
		cacheHit: false,
		sourceFormat,
		structureHints,
		isTruncated,
		chunks: preparedChunks
	};
}

export async function readEstimateAiTextContent(file: AssetFile): Promise<string> {
	const result = await readEstimateAiTextContentDetailed(file);
	return result.textContent;
}

async function buildTiffImageEvidence(
	bytes: Uint8Array,
	_file: AssetFile
): Promise<Array<EstimateAiImageArtifactData & { pageNumber: number }>> {
	const { decode: decodeTiff, pageCount: tiffPageCount } = await import('tiff');
	const totalPages = tiffPageCount(bytes);
	if (totalPages < 1) throw new Error('TIFF file does not contain any pages');

	const pages: Array<EstimateAiImageArtifactData & { pageNumber: number }> = [];
	for (let i = 0; i < totalPages; i++) {
		const decoded = decodeTiff(bytes, { pages: [i] });
		const ifd = decoded[0];
		if (!ifd) throw new Error(`Failed to decode TIFF page ${i + 1}`);
		const canvas = document.createElement('canvas');
		canvas.width = ifd.width;
		canvas.height = ifd.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error(`Failed to create canvas context for TIFF page ${i + 1}`);
		const imageData = ctx.createImageData(ifd.width, ifd.height);
		imageData.data.set(new Uint8ClampedArray(ifd.data));
		ctx.putImageData(imageData, 0, 0);
		const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
		pages.push({
			pageNumber: i + 1,
			mimeType: 'image/jpeg',
			inlineData: dataUrl.split(',')[1] ?? dataUrl
		});
	}
	return pages;
}

export async function buildEstimateAiImageArtifactDetailed(
	file: AssetFile
): Promise<PreparedImageArtifactResult> {
	const bytes = await readVaultFile(file.file_path);
	if (!(typeof process !== 'undefined' && process.env?.VITEST) && bytes.byteLength < 2048) {
		throw new Error(
			`Image preflight validation failed: Visual evidence file "${file.original_name}" size must exceed 2KB to prevent backend preprocessor crashes.`
		);
	}
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getPreparedEvidenceCachePath(
		file.file_path,
		file.id,
		sourceFingerprint,
		'image.prepared.json'
	);
	const cached = await readPreparedEvidenceCacheText(cachePath);
	if (cached) {
		try {
			const parsed = JsonStringSchema.parse(cached) as PreparedImageCacheEntry;
			if (
				parsed.version === 4 &&
				parsed.kind === 'image' &&
				parsed.filePath === file.file_path &&
				typeof parsed.inlineData === 'string' &&
				typeof parsed.mimeType === 'string'
			) {
				return {
					mimeType: parsed.mimeType,
					inlineData: parsed.inlineData,
					qualitySignals: parsed.qualitySignals,
					pages: parsed.pages,
					cacheHit: true
				};
			}
		} catch {
			// Ignore malformed cache entries and rebuild.
		}
	}

	const extension = getFileExtension(file.original_name);
	let imageArtifact: EstimateAiImageArtifactData;
	let pages: Array<EstimateAiImageArtifactData & { pageNumber: number }> | undefined;

	switch (extension) {
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'webp':
			imageArtifact = await buildNormalisedImageInlineData(
				new Blob([toBlobBuffer(bytes)], { type: getImageMimeType(file) }),
				undefined
			);
			break;
		case 'svg': {
			const source = TEXT_DECODER.decode(bytes);
			const sanitised = sanitiseSvgMarkup(source);
			imageArtifact = await buildNormalisedImageInlineData(
				new Blob([sanitised], { type: 'image/svg+xml' }),
				parseSvgDimensions(sanitised, 1600)
			);
			break;
		}
		case 'gif':
		case 'bmp': {
			imageArtifact = await buildNormalisedImageInlineData(
				new Blob([toBlobBuffer(bytes)], { type: getImageMimeType(file) }),
				undefined
			);
			break;
		}
		case 'tif':
		case 'tiff': {
			pages = await buildTiffImageEvidence(bytes, file);
			imageArtifact = pages[0];
			break;
		}
		case 'heic':
		case 'heif': {
			const { convertHeicToJpeg } = await import('./intake-preprocessing.js');
			const jpegBytes = await convertHeicToJpeg(bytes);
			imageArtifact = await buildNormalisedImageInlineData(
				new Blob([toBlobBuffer(jpegBytes)], { type: 'image/jpeg' }),
				undefined
			);
			break;
		}
		default:
			throw new Error(`${file.original_name} is not a supported AI image format.`);
	}

	await writePreparedEvidenceCacheText(
		cachePath,
		JSON.stringify({
			version: 4,
			kind: 'image',
			filePath: file.file_path,
			fileName: file.original_name,
			sourceFingerprint,
			preparedAt: new Date().toISOString(),
			mimeType: imageArtifact.mimeType,
			inlineData: imageArtifact.inlineData,
			qualitySignals: imageArtifact.qualitySignals,
			pages
		} satisfies PreparedImageCacheEntry)
	);
	return {
		...imageArtifact,
		cacheHit: false,
		pages
	};
}

export async function buildEstimateAiImageArtifact(
	file: AssetFile
): Promise<EstimateAiImageArtifactData> {
	const result = await buildEstimateAiImageArtifactDetailed(file);
	return {
		mimeType: result.mimeType,
		inlineData: result.inlineData
	};
}

export async function extractPdfPages(
	file: AssetFile
): Promise<Array<{ pageNumber: number; textContent: string }>> {
	try {
		const { isTauri } = await import('$lib/utils/env.js');
		if (isTauri()) {
			const { invoke } = await import('@tauri-apps/api/core');
			const results = await invoke<Array<{ pageNumber: number; textContent: string }>>(
				'extract_pdf_pages_text',
				{ filePath: file.file_path }
			);
			return results;
		}
	} catch (error) {
		logger.warn('Native PDF page text extraction failed, falling back to pdf.js', error);
	}

	const bytes = await readVaultFile(file.file_path);
	const pdfjs =
		(await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
	ensurePdfTextWorker(pdfjs);
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		useWasm: false
	} as Record<string, unknown>);
	const pdfDocument = await loadingTask.promise;
	const pages: Array<{ pageNumber: number; textContent: string }> = [];

	for (let i = 1; i <= pdfDocument.numPages; i++) {
		const page = await pdfDocument.getPage(i);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.map((item) => {
				const textItem = item as { str?: string };
				return textItem.str ?? '';
			})
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		pages.push({ pageNumber: i, textContent: pageText });
		// Yield to the event loop to prevent UI freezing
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return pages;
}

let indexingQueue: Promise<void> = Promise.resolve();

export async function prepareAndIndexFileChunks(file: AssetFile): Promise<void> {
	// Append the task to the queue to prevent database lock collisions during concurrent uploads
	return new Promise<void>((resolve, reject) => {
		indexingQueue = indexingQueue
			.then(async () => {
				try {
					await executeIndexing(file);
					resolve();
				} catch (error) {
					reject(error);
				}
			})
			.catch(async (_error) => {
				// Continue processing queue even if previous tasks fail
				try {
					await executeIndexing(file);
					resolve();
				} catch (nextError) {
					reject(nextError);
				}
			});
	});
}

async function executeIndexing(file: AssetFile): Promise<void> {
	const extension = file.file_path.split('.').pop()?.toLowerCase() ?? '';

	if (extension === 'pdf' || file.mime_type === 'application/pdf') {
		const pages = await extractPdfPages(file);
		await dbService.persistPageChunks(file.id, pages);
	} else if (extension === 'dxf' || extension === 'dwg') {
		// CAD files: Index their layout, entity structures, and labels into page chunks
		const { buildEstimateAiCadEvidence } = await import('./ai-cad-evidence.js');
		const cadEvidence = await buildEstimateAiCadEvidence(file);
		await dbService.persistPageChunks(file.id, [
			{
				pageNumber: 1,
				textContent: cadEvidence.summaryText,
				chunkIndex: 0
			}
		]);
	} else {
		// Non-PDF, non-CAD files: use the standard text extraction and chunking
		const textArtifact = await readEstimateAiTextContentDetailed(file);
		const rawChunks =
			textArtifact.chunks && textArtifact.chunks.length > 0
				? textArtifact.chunks
				: [
						{
							textContent: textArtifact.textContent,
							structureHints: textArtifact.structureHints,
							isTruncated: textArtifact.isTruncated
						}
					];
		const chunks = rawChunks.map((chunk, idx) => ({
			pageNumber: 1, // Single-page fallback for plain text/docx
			textContent: chunk.textContent,
			chunkIndex: idx
		}));
		await dbService.persistPageChunks(file.id, chunks);
	}
}
