import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { AssetFile } from '$lib/types/index.js';

const readVaultFileMock = vi.fn();
const hashFileBytesMock = vi.fn(async (bytes: Uint8Array) => `hash-${bytes.length}`);
const getPreparedEvidenceCachePathMock = vi.fn(
	(filePath: string, fingerprint: string, suffix: string) =>
		`prepared://${filePath}:${fingerprint}:${suffix}`
);
const readPreparedEvidenceCacheTextMock = vi.fn(async () => null);
const writePreparedEvidenceCacheTextMock = vi.fn(async () => undefined);
const getDocumentMock = vi.fn();
const invokeMock = vi.fn();
const workerInstances: unknown[] = [];
const envMock = {
	isTauri: vi.fn(() => false)
};

vi.mock('$lib/services/assets.js', () => ({
	readVaultFile: readVaultFileMock,
	hashFileBytes: hashFileBytesMock,
	getPreparedEvidenceCachePath: getPreparedEvidenceCachePathMock,
	readPreparedEvidenceCacheText: readPreparedEvidenceCacheTextMock,
	writePreparedEvidenceCacheText: writePreparedEvidenceCacheTextMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('$lib/utils/env.js', () => ({
	isTauri: envMock.isTauri
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
	getDocument: getDocumentMock,
	GlobalWorkerOptions: {
		workerPort: null
	}
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?worker', () => ({
	default: class MockPdfJsWorker {
		constructor() {
			workerInstances.push(this);
		}
	}
}));

function createPdfFile(): AssetFile {
	return {
		id: 'file-pdf',
		project_id: 'project-1',
		asset_id: 'asset-1',
		file_path: 'workspace/project-1/validation-rfq.pdf',
		original_name: 'validation-rfq.pdf',
		mime_type: 'application/pdf',
		created_at: '2026-03-16T00:00:00Z'
	};
}

describe('readPdfAssetFile', () => {
	beforeEach(() => {
		vi.resetModules();
		readVaultFileMock.mockReset();
		hashFileBytesMock.mockClear();
		getPreparedEvidenceCachePathMock.mockClear();
		readPreparedEvidenceCacheTextMock.mockReset();
		writePreparedEvidenceCacheTextMock.mockReset();
		readPreparedEvidenceCacheTextMock.mockResolvedValue(null);
		getDocumentMock.mockReset();
		invokeMock.mockReset();
		envMock.isTauri.mockReset();
		envMock.isTauri.mockReturnValue(false);
		workerInstances.length = 0;
	});

	it('prefers the native Tauri PDF text extraction path in the desktop runtime', async () => {
		const pdfDocument = await PDFDocument.create();
		pdfDocument.addPage([200, 200]);
		const pdfBytes = await pdfDocument.save();

		envMock.isTauri.mockReturnValue(true);
		readVaultFileMock.mockResolvedValue(Uint8Array.from(pdfBytes));
		invokeMock.mockImplementation((command) => {
			if (command === 'extract_pdf_pages_text') {
				return Promise.resolve([
					{ pageNumber: 1, textContent: 'Page 1 native text' },
					{ pageNumber: 2, textContent: 'Page 2 native text' }
				]);
			} else if (command === 'rasterize_pdf_pages') {
				return Promise.resolve(['base64-page1', 'base64-page2']);
			}
			return Promise.reject(new Error(`Unknown command ${command}`));
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(invokeMock).toHaveBeenCalledWith('extract_pdf_pages_text', {
			filePath: 'workspace/project-1/validation-rfq.pdf'
		});
		expect(invokeMock).toHaveBeenCalledWith('rasterize_pdf_pages', {
			filePath: 'workspace/project-1/validation-rfq.pdf',
			pages: [1, 2]
		});
		expect(getDocumentMock).toHaveBeenCalledTimes(0);
		expect(result).toMatchObject({
			pageCount: 2,
			text: '[Page 1]\nPage 1 native text\n\n[Page 2]\nPage 2 native text',
			mimeType: 'application/pdf',
			inlineData: null,
			rasterPages: [
				{ pageNumber: 1, mimeType: 'image/jpeg', inlineData: 'base64-page1' },
				{ pageNumber: 2, mimeType: 'image/jpeg', inlineData: 'base64-page2' }
			],
			issues: []
		});
	});

	it('falls back to PDF.js rendering if native Tauri PDF page rasterization fails', async () => {
		const pdfDocument = await PDFDocument.create();
		pdfDocument.addPage([200, 200]);
		const pdfBytes = await pdfDocument.save();

		envMock.isTauri.mockReturnValue(true);
		readVaultFileMock.mockResolvedValue(Uint8Array.from(pdfBytes));

		invokeMock.mockImplementation((command) => {
			if (command === 'extract_pdf_pages_text') {
				return Promise.resolve([
					{ pageNumber: 1, textContent: 'Page 1 native text' },
					{ pageNumber: 2, textContent: 'Page 2 native text' }
				]);
			} else if (command === 'rasterize_pdf_pages') {
				return Promise.reject(new Error('Rasterization failed'));
			}
			return Promise.reject(new Error(`Unknown command ${command}`));
		});

		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 2,
				getPage: async () => ({
					getViewport: () => ({ width: 100, height: 100 }),
					render: () => ({ promise: Promise.resolve() })
				})
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(invokeMock).toHaveBeenCalledWith('extract_pdf_pages_text', {
			filePath: 'workspace/project-1/validation-rfq.pdf'
		});
		expect(getDocumentMock).toHaveBeenCalledTimes(1);
		expect(result.text).toBe('[Page 1]\nPage 1 native text\n\n[Page 2]\nPage 2 native text');
	});

	it('prepares visual evidence for every page in a scanned document', async () => {
		envMock.isTauri.mockReturnValue(true);
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		invokeMock.mockImplementation((command, args) => {
			if (command === 'extract_pdf_pages_text') {
				return Promise.resolve(
					Array.from({ length: 25 }, (_, index) => ({
						pageNumber: index + 1,
						textContent: ''
					}))
				);
			}
			if (command === 'rasterize_pdf_pages') {
				const pages = (args as { pages: number[] }).pages;
				return Promise.resolve(pages.map((page) => `base64-page-${page}`));
			}
			return Promise.reject(new Error(`Unknown command ${command}`));
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result.rasterPages).toHaveLength(25);
		expect(invokeMock).toHaveBeenCalledWith('rasterize_pdf_pages', {
			filePath: 'workspace/project-1/validation-rfq.pdf',
			pages: Array.from({ length: 25 }, (_, index) => index + 1)
		});
		expect(result.issues).not.toContainEqual(
			expect.objectContaining({ code: 'pdf_visual_pages_omitted' })
		);
	});

	it('records a terminal error for each required PDF visual page that cannot be prepared', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({
					getTextContent: async () => ({ items: [] }),
					getViewport: () => ({ width: 100, height: 100 }),
					render: () => ({ promise: Promise.reject(new Error('raster failed')) })
				})
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result.rasterPages).toEqual([]);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: 'pdf_visual_page_failed',
				severity: 'error',
				fileId: 'file-pdf',
				message: expect.stringContaining('page 1')
			})
		);
	});

	it('preserves actual page numbers and terminal text states for every PDF page', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		const getPage = vi.fn(async (pageNumber: number) => ({
			getTextContent: async () => {
				if (pageNumber === 3) throw new Error('page text unavailable');
				return {
					items: pageNumber === 2 ? [{ str: 'Page 2 scope' }] : []
				};
			},
			getViewport: () => ({ width: 100, height: 100 }),
			render: () => ({ promise: Promise.resolve() })
		}));
		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 3,
				getPage
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result.text).toContain('[Page 1]\n[No extractable text]');
		expect(result.text).toContain('[Page 2]\nPage 2 scope');
		expect(result.text).toContain('[Page 3]\n[Text extraction failed]');
		expect(getPage.mock.calls.slice(0, 3).map(([pageNumber]) => pageNumber)).toEqual([1, 2, 3]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'pdf_text_extraction_fallback',
					message: expect.stringContaining('page 3')
				})
			])
		);
	});

	it('does not rasterize text-rich PDFs with no estimating signals', async () => {
		envMock.isTauri.mockReturnValue(true);
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		const researchText = 'visual reasoning primitives and benchmark discussion '.repeat(500);
		invokeMock.mockImplementation((command) => {
			if (command === 'extract_pdf_pages_text') {
				return Promise.resolve(
					Array.from({ length: 12 }, (_, index) => ({
						pageNumber: index + 1,
						textContent: researchText
					}))
				);
			}
			if (command === 'rasterize_pdf_pages') {
				return Promise.resolve([]);
			}
			return Promise.reject(new Error(`Unknown command ${command}`));
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result.rasterPages).toEqual([]);
		expect(invokeMock).not.toHaveBeenCalledWith(
			'rasterize_pdf_pages',
			expect.objectContaining({ pages: expect.any(Array) })
		);
	});

	it('loads PDFs through the worker-aware byte-array contract used by the app viewer', async () => {
		const pdfDocument = await PDFDocument.create();
		const page = pdfDocument.addPage([200, 200]);
		page.drawText('Steel stairs RFQ');
		const pdfBytes = await pdfDocument.save();

		readVaultFileMock.mockResolvedValue(Uint8Array.from(pdfBytes));
		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({
					getTextContent: async () => ({
						items: [{ str: 'Steel' }, { str: 'stairs' }, { str: 'RFQ' }]
					})
				})
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(getDocumentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.any(Uint8Array),
				useWasm: false
			})
		);
		expect(getDocumentMock.mock.calls[0]?.[0]).not.toHaveProperty('disableWorker');
		if (typeof Worker !== 'undefined') {
			expect(workerInstances).toHaveLength(1);
		}
		expect(result).toMatchObject({
			pageCount: 1,
			text: '[Page 1]\nSteel stairs RFQ',
			mimeType: 'application/pdf',
			inlineData: null
		});
	});

	it('keeps the PDF artifact usable when PDF.js text extraction fails in the desktop runtime', async () => {
		const pdfDocument = await PDFDocument.create();
		pdfDocument.addPage([200, 200]);
		const pdfBytes = await pdfDocument.save();

		readVaultFileMock.mockResolvedValue(Uint8Array.from(pdfBytes));
		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({
					getTextContent: async () => {
						throw new TypeError(
							"undefined is not a function (near '...value of readableStream...')"
						);
					}
				})
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result).toMatchObject({
			pageCount: 1,
			text: '[Page 1]\n[Text extraction failed]',
			mimeType: 'application/pdf',
			inlineData: null,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: 'pdf_text_extraction_fallback',
					severity: 'warning',
					fileId: 'file-pdf',
					fileName: 'validation-rfq.pdf'
				}),
				expect.objectContaining({
					code: 'pdf_visual_page_failed',
					severity: 'error',
					fileId: 'file-pdf'
				})
			])
		});
	});

	it('recovers simple PDF text from raw content streams when structured extraction returns nothing', async () => {
		const rawPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 106 >> stream
BT
/F1 18 Tf
72 720 Td
(Henderson Logistics Canopy Package) Tj
0 -28 Td
/F1 12 Tf
(1 canopy package) Tj
0 -18 Td
(2 installers for 7 days) Tj
ET
endstream
endobj
trailer << /Size 5 /Root 1 0 R >>
%%EOF`;

		readVaultFileMock.mockResolvedValue(new TextEncoder().encode(rawPdf));
		getDocumentMock.mockReturnValue({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({
					getTextContent: async () => ({
						items: []
					})
				})
			})
		});

		const { readPdfAssetFile } = await import('./ai-drafting.js');
		const result = await readPdfAssetFile(createPdfFile());

		expect(result.pageCount).toBe(1);
		expect(result.text).toContain('[Page 1]\nHenderson Logistics Canopy Package');
		expect(result.text).toContain('1 canopy package');
		expect(result.text).toContain('2 installers for 7 days');
		expect(result.issues ?? []).not.toContainEqual(
			expect.objectContaining({
				code: 'pdf_text_extraction_fallback'
			})
		);
	});
});
