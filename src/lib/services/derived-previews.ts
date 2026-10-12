import { JsonStringSchema } from '$lib/schemas/index.js';

import { getGeneralFilePreviewKind } from '$lib/constants/index.js';

/**
 * Increment this version whenever the SVG sanitisation logic changes.
 * This invalidates all cached CAD preview SVGs so users see the latest
 * rendering fixes without needing to re-ingest their DWG/DXF files.
 */
const CAD_PREVIEW_CACHE_VERSION = 2;
import {
	getDerivedPreviewCachePath,
	hashFileBytes,
	readAppLocalFile,
	readDerivedPreviewCacheText,
	readVaultFile,
	writeDerivedPreviewCacheText
} from './assets';
import { renderMTextElement } from './cad-text-utils.js';
import * as Comlink from 'comlink';
import type { OfficeParserWorkerAPI } from '../workers/office-parser.worker';

// ── Office parser worker singleton ───────────────────────────────────────────
// Created once on first use; kept alive so the imported modules (xlsx,
// mammoth, dxf-renew) are warm for subsequent calls on the same session.
let officeWorker: Worker | null = null;
let officeWorkerAPI: Comlink.Remote<OfficeParserWorkerAPI> | null = null;

function getOfficeWorkerAPI(): Comlink.Remote<OfficeParserWorkerAPI> {
	if (!officeWorkerAPI) {
		officeWorker = new Worker(new URL('../workers/office-parser.worker.ts', import.meta.url), {
			type: 'module'
		});
		officeWorkerAPI = Comlink.wrap<OfficeParserWorkerAPI>(officeWorker);
	}
	return officeWorkerAPI;
}

export interface DocumentDerivedPreview {
	kind: 'document';
	html: string;
	messages: string[];
}

export interface SpreadsheetDerivedPreviewSheet {
	name: string;
	headers: string[];
	headerRowNumber?: number | null;
	rows: string[][];
	rowNumbers?: number[];
	columnStart?: number;
	rowCount: number;
	columnCount: number;
	formulaCount: number;
}

export interface SpreadsheetDerivedPreview {
	kind: 'spreadsheet';
	sheets: SpreadsheetDerivedPreviewSheet[];
}

export interface DxfDerivedPreview {
	kind: 'dxf';
	svg: string;
	svgUrl: string;
	entityCount: number;
}

export interface TextDerivedPreview {
	kind: 'text';
	lines: string[];
	lineCount: number;
	truncated: boolean;
}

export interface TiffDerivedPreview {
	kind: 'tiff';
	images: Array<{ svgUrl: string; width: number; height: number }>;
	pageCount: number;
}

export interface DwgDerivedPreview {
	kind: 'dwg';
	svg: string;
	svgUrl: string;
}

export type DerivedPreview =
	| DocumentDerivedPreview
	| SpreadsheetDerivedPreview
	| DxfDerivedPreview
	| DwgDerivedPreview
	| TextDerivedPreview
	| TiffDerivedPreview;
export type DerivedPreviewFileSource = 'vault' | 'appLocal';

const inflightPreviewLoads = new Map<string, Promise<DerivedPreview>>();

function shouldDeduplicatePreviewLoad(
	_previewKind: ReturnType<typeof getGeneralFilePreviewKind>
): boolean {
	// Deduplicate all heavy pipeline loads (including DXF, DWG, and TIFF) to prevent duplicate runs
	return true;
}

const ALLOWED_DOCUMENT_TAGS = new Set([
	'a',
	'b',
	'blockquote',
	'br',
	'caption',
	'code',
	'del',
	'div',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'span',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
]);
const BLOCKED_DOCUMENT_TAGS = new Set([
	'embed',
	'iframe',
	'link',
	'meta',
	'object',
	'script',
	'style',
	'video',
	'audio'
]);
const ALLOWED_DOCUMENT_GLOBAL_ATTRS = new Set(['alt', 'colspan', 'rowspan', 'scope', 'title']);
const ALLOWED_DOCUMENT_ATTRS = new Map<string, Set<string>>([
	['a', new Set(['href', 'title'])],
	['img', new Set(['alt', 'src', 'title'])],
	['td', new Set(['colspan', 'rowspan'])],
	['th', new Set(['colspan', 'rowspan', 'scope'])]
]);
const ALLOWED_SVG_TAGS = new Set([
	'circle',
	'defs',
	'ellipse',
	'g',
	'line',
	'marker',
	'path',
	'polygon',
	'polyline',
	'rect',
	'svg',
	'text',
	'tspan',
	'use'
]);
const BLOCKED_SVG_TAGS = new Set(['embed', 'foreignobject', 'iframe', 'object', 'script', 'style']);
const ALLOWED_SVG_GLOBAL_ATTRS = new Set([
	'cx',
	'cy',
	'd',
	'dominant-baseline',
	'fill',
	'fill-opacity',
	'font-family',
	'font-size',
	'height',
	'id',
	'marker-end',
	'marker-mid',
	'marker-start',
	'markerend',
	'markermid',
	'markerstart',
	'markerheight',
	'markerunits',
	'markerwidth',
	'opacity',
	'orient',
	'points',
	'preserveaspectratio',
	'r',
	'refx',
	'refy',
	'rx',
	'ry',
	'stroke',
	'stroke-dasharray',
	'stroke-dashoffset',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-miterlimit',
	'stroke-opacity',
	'stroke-width',
	'text-anchor',
	'transform',
	'vector-effect',
	'viewbox',
	'width',
	'x',
	'x1',
	'x2',
	'xmlns',
	'xmlns:xlink',
	'y',
	'y1',
	'y2'
]);
const ALLOWED_SVG_ATTRS = new Map<string, Set<string>>([['use', new Set(['href', 'xlink:href'])]]);

function unwrapElement(element: Element): void {
	const parent = element.parentNode;
	if (!parent) {
		element.remove();
		return;
	}

	while (element.firstChild) {
		parent.insertBefore(element.firstChild, element);
	}
	parent.removeChild(element);
}

function isSafeDocumentHref(value: string): boolean {
	const normalised = value.trim().toLowerCase();
	return (
		normalised.startsWith('#') ||
		normalised.startsWith('http://') ||
		normalised.startsWith('https://') ||
		normalised.startsWith('mailto:') ||
		normalised.startsWith('tel:')
	);
}

function isSafeDocumentImageSrc(value: string): boolean {
	const normalised = value.trim().toLowerCase();
	return /^(data:image\/(?:png|jpe?g|gif|webp);base64,)/.test(normalised);
}

function isSafeSvgReference(value: string): boolean {
	return value.trim().startsWith('#');
}

function sanitiseDocumentElement(element: Element): void {
	const tagName = element.tagName.toLowerCase();
	if (!ALLOWED_DOCUMENT_TAGS.has(tagName)) {
		if (BLOCKED_DOCUMENT_TAGS.has(tagName)) {
			element.remove();
			return;
		}
		unwrapElement(element);
		return;
	}

	for (const attribute of [...element.attributes]) {
		const attrName = attribute.name.toLowerCase();
		const attrValue = attribute.value.trim();
		if (attrName.startsWith('on') || attrName === 'style') {
			element.removeAttribute(attribute.name);
			continue;
		}

		const allowedAttrs = ALLOWED_DOCUMENT_ATTRS.get(tagName);
		const isAllowed =
			ALLOWED_DOCUMENT_GLOBAL_ATTRS.has(attrName) || Boolean(allowedAttrs?.has(attrName));
		if (!isAllowed) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (tagName === 'a' && attrName === 'href' && !isSafeDocumentHref(attrValue)) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (tagName === 'img' && attrName === 'src' && !isSafeDocumentImageSrc(attrValue)) {
			element.removeAttribute(attribute.name);
		}
	}
}

function sanitiseHtmlMarkup(input: string): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(`<body>${input}</body>`, 'text/html');
	const elements = Array.from(document.body.querySelectorAll('*')).reverse();
	for (const element of elements) {
		sanitiseDocumentElement(element);
	}

	return document.body.innerHTML;
}

function sanitiseSvgElement(element: Element): void {
	const tagName = element.tagName.toLowerCase();
	if (!ALLOWED_SVG_TAGS.has(tagName)) {
		if (BLOCKED_SVG_TAGS.has(tagName)) {
			element.remove();
			return;
		}
		unwrapElement(element);
		return;
	}

	for (const attribute of [...element.attributes]) {
		const attrName = attribute.name.toLowerCase();
		const attrValue = attribute.value.trim();
		if (attrName.startsWith('on') || attrName === 'style') {
			element.removeAttribute(attribute.name);
			continue;
		}

		const allowedAttrs = ALLOWED_SVG_ATTRS.get(tagName);
		const isAllowed =
			ALLOWED_SVG_GLOBAL_ATTRS.has(attrName) || Boolean(allowedAttrs?.has(attrName));
		if (!isAllowed) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if ((attrName === 'href' || attrName === 'xlink:href') && !isSafeSvgReference(attrValue)) {
			element.removeAttribute(attribute.name);
		}
	}
}

/**
 * Parse SVG width/height from viewBox (preferred) or width/height attributes.
 * viewBox-first priority handles dxf-renew's width="100%" output correctly.
 * Falls back to the caller-provided default when neither source is available.
 */
export function parseSvgDimensions(
	svg: string,
	fallbackSize = 768
): { width: number; height: number } {
	try {
		const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
		const root = document.documentElement;
		const viewBox = root.getAttribute('viewBox');
		if (viewBox) {
			const [, , width, height] = viewBox.split(/[\s,]+/).map((value) => Number.parseFloat(value));
			if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
				return { width, height };
			}
		}

		const width = Number.parseFloat(root.getAttribute('width') ?? '');
		const height = Number.parseFloat(root.getAttribute('height') ?? '');
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
			return { width, height };
		}
	} catch {
		// Fall through to defaults.
	}

	return { width: fallbackSize, height: fallbackSize };
}

export function sanitiseSvgMarkup(input: string): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(input, 'image/svg+xml');
	const root = document.documentElement;
	const elements = Array.from(root.querySelectorAll('*')).reverse();
	for (const element of elements) {
		sanitiseSvgElement(element);
	}

	// ── SVG quality fixes for dxf-renew output ──────────────────────────────
	//
	// Problem 1: stroke-width="0.1%" — relative to viewport width (not
	// viewBox). At 700px: 0.1% = 0.7px — sub-pixel, jagged lines.
	// Fix: convert ALL percentage stroke-width values across the SVG to 1px.
	//
	// Problem 2: fill="none" on the root <g> is inherited by <text> elements,
	// making ALL text labels invisible. Additionally, some text elements may
	// have fill="none" explicitly set from dxf-renew dimension renderers.
	// Fix: set fill="currentColor" on every <text> that is missing a visible
	// fill (no fill attribute, or fill="none").
	//
	// Problem 3: The root <g> itself has fill="none" which cascades to
	// stroked entity groups (LINE, CIRCLE, etc.) — correct behaviour — but
	// also to groups that contain text. Instead of patching every descendant,
	// we remove fill="none" from the root and add fill="none" to the first-
	// level entity <g> children that are NOT SOLID/TRACE fills.

	// Step 1: Fix percentage stroke-width on all elements, not just root.
	const elementsToFixStroke = [
		root as Element,
		...Array.from((root as Element).querySelectorAll('*'))
	];
	for (const el of elementsToFixStroke) {
		const sw = el.getAttribute('stroke-width');
		if (sw && sw.endsWith('%')) {
			el.setAttribute('stroke-width', '1px');
		}
		const style = el.getAttribute('style');
		if (style) {
			const updatedStyle = style.replace(/stroke-width\s*:\s*[^;]*%[;\s]*/gi, 'stroke-width: 1px;');
			if (style !== updatedStyle) {
				el.setAttribute('style', updatedStyle);
			}
		}
	}

	// Step 2: Remove fill="none" from the root <g> so text groups can inherit
	// a visible fill. Then add fill="none" back to non-fill entity groups.
	const rootG =
		root.firstElementChild?.tagName.toLowerCase() === 'g'
			? root.firstElementChild
			: root.querySelector('g');
	if (rootG) {
		const rootFill = rootG.getAttribute('fill');
		if (rootFill === 'none') {
			rootG.removeAttribute('fill');
			// Add fill="none" to direct child <g> groups that represent
			// stroked entities (those without an explicit fill attribute).
			// SOLID/TRACE groups already have fill="…" set by dxf-renew.
			for (const childG of Array.from(rootG.querySelectorAll(':scope > g'))) {
				if (!childG.hasAttribute('fill')) {
					childG.setAttribute('fill', 'none');
				}
			}
		}
	}

	// Step 3: Ensure every <text> element has a visible fill. Handles both
	// the case where fill is missing (inherited none) and where fill="none"
	// is set explicitly (e.g. from dxf-renew dimension text renderers).
	// Skip <text> inside <defs> (marker labels) — they're not rendered.
	const defsEl = root.querySelector('defs');
	for (const textEl of Array.from((root as Element).querySelectorAll('text'))) {
		// Skip text inside <defs> elements
		if (defsEl && defsEl.contains(textEl)) continue;
		const fill = textEl.getAttribute('fill');
		if (!fill || fill === 'none') {
			textEl.setAttribute('fill', 'currentColor');
		}
		renderMTextElement(textEl as SVGTextElement);
	}

	return new XMLSerializer().serializeToString(root);
}

export async function readPreviewSourceFile(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<Uint8Array> {
	return fileSource === 'appLocal' ? readAppLocalFile(filePath) : readVaultFile(filePath);
}

async function buildDocumentPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<DocumentDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		'docx.v2.json'
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		return JsonStringSchema.parse(cached) as unknown as DocumentDerivedPreview;
	}

	// Transfer the ArrayBuffer zero-copy to the background worker.
	// After transfer the `bytes` buffer is detached — do not reuse it.
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
	const result = await getOfficeWorkerAPI().parseDocument(Comlink.transfer(buffer, [buffer]));
	const preview: DocumentDerivedPreview = {
		kind: 'document',
		// sanitiseHtmlMarkup needs DOMParser — runs here on the main thread.
		html: sanitiseHtmlMarkup(result.html),
		messages: result.messages
	};
	await writeDerivedPreviewCacheText(cachePath, JSON.stringify(preview));
	return preview;
}

async function buildSpreadsheetPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<SpreadsheetDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		'xlsx.v2.json'
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		return JsonStringSchema.parse(cached) as unknown as SpreadsheetDerivedPreview;
	}

	// Transfer the ArrayBuffer zero-copy to the background worker.
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
	const result = await getOfficeWorkerAPI().parseSpreadsheet(Comlink.transfer(buffer, [buffer]));
	const preview: SpreadsheetDerivedPreview = { kind: 'spreadsheet', sheets: result.sheets };
	await writeDerivedPreviewCacheText(cachePath, JSON.stringify(preview));
	return preview;
}

async function buildDxfPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<DxfDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		`dxf.v${CAD_PREVIEW_CACHE_VERSION}.svg`
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		return {
			kind: 'dxf',
			svg: cached,
			svgUrl: '',
			entityCount: 0
		};
	}

	// Parse DXF in the background worker — dxf-renew is CPU-heavy for large files.
	// String transfer: DXF text is already decoded; postMessage structured-clones it
	// (acceptable — decoding cost dominates for large files).
	const dxfSource = new TextDecoder().decode(bytes);
	const result = await getOfficeWorkerAPI().parseDxf(dxfSource);
	// sanitiseSvgMarkup + renderMTextElement need DOMParser — run on main thread.
	const svg = sanitiseSvgMarkup(result.svg);
	await writeDerivedPreviewCacheText(cachePath, svg);

	return {
		kind: 'dxf',
		svg,
		svgUrl: '',
		entityCount: result.entityCount
	};
}

async function buildTextPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<TextDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		'txt.json'
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		return JsonStringSchema.parse(cached) as unknown as TextDerivedPreview;
	}

	const content = new TextDecoder('utf-8').decode(bytes);
	const allLines = content.split(/\r?\n/);
	const visibleLineLimit = 4;
	const maxLineLength = 120;
	const previewLines = allLines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, visibleLineLimit)
		.map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}…` : line));

	const preview: TextDerivedPreview = {
		kind: 'text',
		lines: previewLines,
		lineCount: allLines.length,
		truncated:
			allLines.length > visibleLineLimit || allLines.some((line) => line.length > maxLineLength)
	};
	await writeDerivedPreviewCacheText(cachePath, JSON.stringify(preview));
	return preview;
}

async function buildTiffPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<TiffDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		'tiff.v2.json'
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		const parsed = JsonStringSchema.parse(cached) as unknown as {
			pageCount: number;
			imageDataUrls: string[];
		};
		return {
			kind: 'tiff',
			images: parsed.imageDataUrls.map((dataUrl) => {
				const blob = new Blob([dataUrl], { type: 'image/svg+xml' });
				return { svgUrl: URL.createObjectURL(blob), width: 0, height: 0 };
			}),
			pageCount: parsed.pageCount
		};
	}

	const { decode: decodeTiff, pageCount: tiffPageCount } = await import('tiff');
	const pages = tiffPageCount(bytes);
	const images: TiffDerivedPreview['images'] = [];
	const imageDataUrls: string[] = [];

	for (let i = 0; i < pages; i++) {
		try {
			const decoded = decodeTiff(bytes, { pages: [i] });
			const ifd = decoded[0];
			if (!ifd) continue;
			const width = ifd.width;
			const height = ifd.height;
			const pixelData = ifd.data;

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) continue;

			const imageData = ctx.createImageData(width, height);
			imageData.data.set(new Uint8ClampedArray(pixelData));
			ctx.putImageData(imageData, 0, 0);

			const dataUrl = canvas.toDataURL('image/png');
			imageDataUrls.push(dataUrl);

			const response = await fetch(dataUrl);
			const blob = await response.blob();
			images.push({
				svgUrl: URL.createObjectURL(blob),
				width,
				height
			});
		} catch (error) {
			throw new Error(`Failed to prepare TIFF page ${i + 1} of ${pages}.`, { cause: error });
		}
	}

	await writeDerivedPreviewCacheText(
		cachePath,
		JSON.stringify({ pageCount: pages, imageDataUrls })
	);

	return { kind: 'tiff', images, pageCount: pages };
}

async function buildDwgPreview(
	filePath: string,
	fileSource: DerivedPreviewFileSource
): Promise<DwgDerivedPreview> {
	const bytes = await readPreviewSourceFile(filePath, fileSource);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getDerivedPreviewCachePath(
		`${fileSource}:${filePath}`,
		sourceFingerprint,
		`dwg.v${CAD_PREVIEW_CACHE_VERSION}.svg`
	);
	const cached = await readDerivedPreviewCacheText(cachePath);
	if (cached) {
		return {
			kind: 'dwg',
			svg: cached,
			svgUrl: ''
		};
	}

	const { convertDwgToSvg } = await import('./dwg-converter.js');
	const { svg: svgRaw } = await convertDwgToSvg(bytes);
	const svg = sanitiseSvgMarkup(svgRaw);
	await writeDerivedPreviewCacheText(cachePath, svg);

	return {
		kind: 'dwg',
		svg,
		svgUrl: ''
	};
}

export async function getDerivedPreview(
	filePath: string,
	options: { fileSource?: DerivedPreviewFileSource } = {}
): Promise<DerivedPreview> {
	const fileSource = options.fileSource ?? 'vault';
	const previewCacheKey = `${fileSource}:${filePath}`;
	const previewKind = getGeneralFilePreviewKind(filePath);
	if (shouldDeduplicatePreviewLoad(previewKind)) {
		const pending = inflightPreviewLoads.get(previewCacheKey);
		if (pending) return pending;
	}
	const loadPromise = (async () => {
		switch (previewKind) {
			case 'document':
				return buildDocumentPreview(filePath, fileSource);
			case 'spreadsheet':
				return buildSpreadsheetPreview(filePath, fileSource);
			case 'dxf':
				return buildDxfPreview(filePath, fileSource);
			case 'text':
				return buildTextPreview(filePath, fileSource);
			case 'tiff':
				return buildTiffPreview(filePath, fileSource);
			case 'dwg':
				return buildDwgPreview(filePath, fileSource);
			default:
				throw new Error(`No derived preview available for ${filePath}`);
		}
	})();

	if (shouldDeduplicatePreviewLoad(previewKind)) {
		inflightPreviewLoads.set(previewCacheKey, loadPromise);
	}

	try {
		const preview = await loadPromise;
		if (preview.kind === 'dxf') {
			return {
				...preview,
				svgUrl: URL.createObjectURL(new Blob([preview.svg], { type: 'image/svg+xml' }))
			};
		}
		if (preview.kind === 'dwg') {
			return {
				...preview,
				svgUrl: URL.createObjectURL(new Blob([preview.svg], { type: 'image/svg+xml' }))
			};
		}
		return preview;
	} finally {
		if (shouldDeduplicatePreviewLoad(previewKind)) {
			inflightPreviewLoads.delete(previewCacheKey);
		}
	}
}

export function disposeDerivedPreview(preview: DerivedPreview | null): void {
	if (preview?.kind === 'dxf' && preview.svgUrl) {
		URL.revokeObjectURL(preview.svgUrl);
	}
	if (preview?.kind === 'dwg' && preview.svgUrl) {
		URL.revokeObjectURL(preview.svgUrl);
	}
	if (preview?.kind === 'tiff') {
		for (const image of preview.images) {
			URL.revokeObjectURL(image.svgUrl);
		}
	}
}
