import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetFile } from '$lib/types/index.js';

const {
	mockReadVaultFile,
	mockGetDerivedPreview,
	mockHashFileBytes,
	mockGetPreparedEvidenceCachePath,
	mockReadPreparedEvidenceCacheText,
	mockWritePreparedEvidenceCacheText,
	mockPersistPageChunks,
	mockGetDocument,
	mockPdfWorkerOptions,
	mockPdfWorkerInstances,
	mockDecodeTiff,
	mockTiffPageCount
} = vi.hoisted(() => ({
	mockReadVaultFile: vi.fn(),
	mockGetDerivedPreview: vi.fn(),
	mockHashFileBytes: vi.fn(async (bytes: Uint8Array) => `hash-${bytes.length}`),
	mockGetPreparedEvidenceCachePath: vi.fn(
		(filePath: string, fingerprint: string, suffix: string) =>
			`prepared://${filePath}:${fingerprint}:${suffix}`
	),
	mockReadPreparedEvidenceCacheText: vi.fn<() => Promise<string | null>>(async () => null),
	mockWritePreparedEvidenceCacheText: vi.fn(async () => undefined),
	mockPersistPageChunks: vi.fn(async () => undefined),
	mockGetDocument: vi.fn(),
	mockPdfWorkerOptions: { workerPort: null as Worker | null },
	mockPdfWorkerInstances: [] as unknown[],
	mockDecodeTiff: vi.fn(),
	mockTiffPageCount: vi.fn()
}));

vi.mock('tiff', () => ({
	decode: mockDecodeTiff,
	pageCount: mockTiffPageCount
}));

vi.mock('./db.js', () => ({
	dbService: {
		persistPageChunks: mockPersistPageChunks
	}
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
	getDocument: mockGetDocument,
	GlobalWorkerOptions: mockPdfWorkerOptions
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?worker', () => ({
	default: class MockPdfJsWorker {
		constructor() {
			mockPdfWorkerInstances.push(this);
		}
	}
}));

vi.mock('./assets.js', () => ({
	readVaultFile: mockReadVaultFile,
	hashFileBytes: mockHashFileBytes,
	getPreparedEvidenceCachePath: mockGetPreparedEvidenceCachePath,
	readPreparedEvidenceCacheText: mockReadPreparedEvidenceCacheText,
	writePreparedEvidenceCacheText: mockWritePreparedEvidenceCacheText
}));

vi.mock('./derived-previews.js', async () => {
	const actual =
		await vi.importActual<typeof import('./derived-previews.js')>('./derived-previews.js');
	return {
		...actual,
		getDerivedPreview: mockGetDerivedPreview
	};
});

function createAssetFile(
	overrides: Partial<AssetFile> &
		Pick<AssetFile, 'id' | 'project_id' | 'file_path' | 'original_name'>
): AssetFile {
	return {
		asset_id: null,
		mime_type: null,
		created_at: '2026-04-05T00:00:00Z',
		...overrides
	};
}

describe('ai file evidence', () => {
	let dataUrlCounter = 0;
	let renderedCanvasDimensions: Array<{ width: number; height: number }> = [];

	beforeEach(() => {
		mockReadVaultFile.mockReset();
		mockGetDerivedPreview.mockReset();
		mockHashFileBytes.mockClear();
		mockGetPreparedEvidenceCachePath.mockClear();
		mockReadPreparedEvidenceCacheText.mockReset();
		mockWritePreparedEvidenceCacheText.mockReset();
		mockPdfWorkerOptions.workerPort = null;
		mockPdfWorkerInstances.length = 0;
		mockDecodeTiff.mockReset();
		mockTiffPageCount.mockReset();
		mockReadPreparedEvidenceCacheText.mockResolvedValue(null);
		dataUrlCounter = 0;
		renderedCanvasDimensions = [];

		vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
			if (tagName === 'canvas') {
				const canvas = {
					width: 0,
					height: 0,
					getContext: () => ({
						fillStyle: '#ffffff',
						fillRect() {},
						drawImage() {},
						createImageData: (width: number, height: number) => ({
							data: new Uint8ClampedArray(width * height * 4)
						}),
						putImageData() {}
					}),
					toDataURL: function (mimeType?: string) {
						renderedCanvasDimensions.push({
							width: this.width,
							height: this.height
						});
						return `data:${mimeType ?? 'image/webp'};base64,render-${++dataUrlCounter}`;
					}
				};
				return canvas as unknown as HTMLCanvasElement;
			}

			return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
		});

		globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
		globalThis.URL.revokeObjectURL = vi.fn();
		globalThis.Image = class MockImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			width = 320;
			height = 160;
			set src(_value: string) {
				queueMicrotask(() => this.onload?.());
			}
		} as unknown as typeof Image;
	});

	it('converts docx previews into readable text evidence', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockGetDerivedPreview.mockResolvedValue({
			kind: 'document',
			html: '<h1>Canopy package</h1><p>Steel stairs</p><table><tr><th>Item</th><th>Qty</th></tr><tr><td>Handrail</td><td>24 m</td></tr></table><img src="data:image/png;base64,abc">',
			messages: ['Image omitted from conversion']
		});

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'docx-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/spec.docx',
				original_name: 'spec.docx'
			})
		);

		expect(content).toContain('Heading: Canopy package');
		expect(content).toContain('Steel stairs');
		expect(content).toContain('Table 1:');
		expect(content).toContain('Headers: Item | Qty');
		expect(content).toContain('Table 1 row 1: Handrail | 24 m');
		expect(content).toContain('Embedded images detected: 1');
		expect(content).toContain('Conversion notes:');
	});

	it('keeps every DOCX table row beyond the former 40-row cap', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		const bodyRows = Array.from(
			{ length: 45 },
			(_, index) => `<tr><td>Part ${index + 1}</td><td>${index + 1}</td></tr>`
		).join('');
		mockGetDerivedPreview.mockResolvedValue({
			kind: 'document',
			html: `<table><tr><th>Item</th><th>Qty</th></tr>${bodyRows}</table>`,
			messages: []
		});

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'docx-long-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/long-spec.docx',
				original_name: 'long-spec.docx'
			})
		);

		expect(content).toContain('Table 1 row 45: Part 45 | 45');
	});

	it('converts spreadsheet previews into sheet-aware text evidence', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([4, 5, 6]));
		const rows = Array.from({ length: 65 }, (_, index) => [`Item ${index + 1}`, `${index + 1}`]);
		mockGetDerivedPreview.mockResolvedValue({
			kind: 'spreadsheet',
			sheets: [
				{
					name: 'Schedule',
					headers: ['Item', 'Qty'],
					rows,
					rowCount: rows.length,
					columnCount: 2,
					formulaCount: 3
				}
			]
		});

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'xlsx-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/schedule.xlsx',
				original_name: 'schedule.xlsx'
			})
		);

		expect(content).toContain('Workbook summary: 1 sheet(s).');
		expect(content).toContain('Sheet: Schedule');
		expect(content).toContain('Formula cells: 3');
		expect(content).toContain('Headers: Item | Qty');
		expect(content).toContain('Sheet Schedule row 2: A2: Item 1 | B2: 1');
		expect(content).toContain('Sheet Schedule row 66: A66: Item 65 | B66: 65');
		expect(content).toContain('Rows: 65');
		expect(content).toContain('Columns: 2');
	});

	it('converts csv files into structured tabular text evidence', async () => {
		mockReadVaultFile.mockResolvedValue(
			new TextEncoder().encode('Item,Qty,Unit\nCanopy package,1,lot\nInstall crew,14,day\n')
		);

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'csv-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/schedule.csv',
				original_name: 'schedule.csv'
			})
		);

		expect(content).toContain('Tabular summary: schedule.csv');
		expect(content).toContain('Headers: Item | Qty | Unit');
		expect(content).toContain('Columns: 3');
		expect(content).toContain('Rows: 2');
		expect(content).toContain('Row 2: A2: Canopy package | B2: 1 | C2: lot');
		expect(content).toContain('Row 3: A3: Install crew | B3: 14 | C3: day');
	});

	it('keeps every CSV row and full cell value beyond former preparation caps', async () => {
		const longCell = 'A'.repeat(220);
		const rows = Array.from({ length: 85 }, (_, index) => `Item ${index + 1},${index + 1}`);
		rows[84] = `${longCell},85`;
		mockReadVaultFile.mockResolvedValue(new TextEncoder().encode(['Item,Qty', ...rows].join('\n')));

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'csv-long-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/long.csv',
				original_name: 'long.csv'
			})
		);

		expect(content).toContain(`Row 86: A86: ${longCell} | B86: 85`);
	});

	it('reads markdown, json, and xml as text evidence', async () => {
		mockReadVaultFile.mockResolvedValue(
			new TextEncoder().encode('# Scope\n{"material":"steel"}\n<spec>galv</spec>')
		);

		const { readEstimateAiTextContent } = await import('./ai-file-evidence.js');
		const content = await readEstimateAiTextContent(
			createAssetFile({
				id: 'txt-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/data.json',
				original_name: 'data.json'
			})
		);

		expect(content).toContain('# Scope');
		expect(content).toContain('"material":"steel"');
		expect(content).toContain('<spec>galv</spec>');
	});

	it('normalises small raster images into resized jpeg evidence', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const { buildEstimateAiImageArtifact } = await import('./ai-file-evidence.js');
		const image = await buildEstimateAiImageArtifact(
			createAssetFile({
				id: 'img-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/site.webp',
				original_name: 'site.webp',
				mime_type: 'image/webp'
			})
		);

		expect(image.mimeType).toBe('image/jpeg');
		expect(image.inlineData).toBe('render-1');
		expect(renderedCanvasDimensions).toEqual([{ width: 384, height: 192 }]);
	});

	it('rebuilds legacy image cache entries that predate raster quality metadata', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockReadPreparedEvidenceCacheText.mockImplementation(async () =>
			JSON.stringify({
				version: 1,
				kind: 'image',
				filePath: 'workspace/project-1/site.webp',
				fileName: 'site.webp',
				sourceFingerprint: 'hash-3',
				profile: 'cloud',
				preparedAt: '2026-04-01T00:00:00.000Z',
				mimeType: 'image/webp',
				inlineData: 'legacy-cache'
			})
		);

		const { buildEstimateAiImageArtifact } = await import('./ai-file-evidence.js');
		const image = await buildEstimateAiImageArtifact(
			createAssetFile({
				id: 'img-cache-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/site.webp',
				original_name: 'site.webp',
				mime_type: 'image/webp'
			})
		);

		expect(image.inlineData).toBe('render-1');
		expect(mockWritePreparedEvidenceCacheText).toHaveBeenCalledWith(
			'prepared://workspace/project-1/site.webp:img-cache-1:hash-3',
			expect.stringContaining('"version":4')
		);
	});

	it('rasterises svg, gif, and bmp into resized jpeg evidence', async () => {
		const { buildEstimateAiImageArtifact } = await import('./ai-file-evidence.js');

		mockReadVaultFile.mockResolvedValueOnce(
			new TextEncoder().encode('<svg viewBox="0 0 100 50"><rect width="100" height="50"/></svg>')
		);
		const svgImage = await buildEstimateAiImageArtifact(
			createAssetFile({
				id: 'svg-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/markup.svg',
				original_name: 'markup.svg',
				mime_type: 'image/svg+xml'
			})
		);

		mockReadVaultFile.mockResolvedValueOnce(new Uint8Array([71, 73, 70]));
		const gifImage = await buildEstimateAiImageArtifact(
			createAssetFile({
				id: 'gif-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/markup.gif',
				original_name: 'markup.gif',
				mime_type: 'image/gif'
			})
		);

		mockReadVaultFile.mockResolvedValueOnce(new Uint8Array([66, 77, 80]));
		const bmpImage = await buildEstimateAiImageArtifact(
			createAssetFile({
				id: 'bmp-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/markup.bmp',
				original_name: 'markup.bmp',
				mime_type: 'image/bmp'
			})
		);

		expect(svgImage.mimeType).toBe('image/jpeg');
		expect(gifImage.mimeType).toBe('image/jpeg');
		expect(bmpImage.mimeType).toBe('image/jpeg');
		expect(svgImage.inlineData).toBe('render-1');
		expect(gifImage.inlineData).toBe('render-2');
		expect(bmpImage.inlineData).toBe('render-3');
	});

	it('prepares every TIFF page as a separate image instead of stitching or capping pages', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([73, 73, 42, 0]));
		mockTiffPageCount.mockReturnValue(21);
		mockDecodeTiff.mockImplementation((_bytes: Uint8Array, options: { pages: number[] }) => [
			{
				width: 2,
				height: 1,
				data: new Uint8Array(8).fill(options.pages[0] ?? 0)
			}
		]);

		const { buildEstimateAiImageArtifactDetailed } = await import('./ai-file-evidence.js');
		const result = await buildEstimateAiImageArtifactDetailed(
			createAssetFile({
				id: 'tiff-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/drawing.tiff',
				original_name: 'drawing.tiff',
				mime_type: 'image/tiff'
			})
		);

		expect(result.pages).toHaveLength(21);
		expect(result.pages?.map((page) => page.pageNumber)).toEqual(
			Array.from({ length: 21 }, (_, index) => index + 1)
		);
		expect(mockDecodeTiff).toHaveBeenCalledTimes(21);
		expect(renderedCanvasDimensions).toHaveLength(21);
	});

	it('fails with the actual TIFF page number instead of returning partial page evidence', async () => {
		mockReadVaultFile.mockResolvedValue(new Uint8Array([73, 73, 42, 0]));
		mockTiffPageCount.mockReturnValue(3);
		mockDecodeTiff.mockImplementation((_bytes: Uint8Array, options: { pages: number[] }) =>
			options.pages[0] === 1 ? [] : [{ width: 2, height: 1, data: new Uint8Array(8) }]
		);

		const { buildEstimateAiImageArtifactDetailed } = await import('./ai-file-evidence.js');
		await expect(
			buildEstimateAiImageArtifactDetailed(
				createAssetFile({
					id: 'tiff-failed-page',
					project_id: 'project-1',
					file_path: 'workspace/project-1/failed-page.tiff',
					original_name: 'failed-page.tiff',
					mime_type: 'image/tiff'
				})
			)
		).rejects.toThrow('Failed to decode TIFF page 2');
	});

	it('chunks text file when size exceeds limit', async () => {
		const { readEstimateAiTextContentDetailed } = await import('./ai-file-evidence.js');
		const chunkLimit = 8000;
		const largeContentBytes = new Uint8Array(chunkLimit + 100);
		largeContentBytes.fill(65); // fill with 'A's
		mockReadVaultFile.mockResolvedValue(largeContentBytes);

		const result = await readEstimateAiTextContentDetailed(
			createAssetFile({
				id: 'large-txt-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/large.txt',
				original_name: 'large.txt'
			})
		);

		expect(result.chunks).toBeDefined();
		expect(result.chunks!.length).toBe(2);
		expect(result.chunks![0].textContent.length).toBeLessThanOrEqual(chunkLimit);
		expect(result.chunks![1].textContent.length).toBe(900); // 100 remaining + 800 overlap characters
		expect(result.isTruncated).toBe(false);
	});

	it('keeps chunking text beyond the former 100-chunk cap without claiming truncation', async () => {
		const { readEstimateAiTextContentDetailed } = await import('./ai-file-evidence.js');
		const chunkLimit = 8000;
		const maxChunks = 100;
		const hugeContentBytes = new Uint8Array(chunkLimit * (maxChunks + 1));
		hugeContentBytes.fill(65); // fill with 'A's
		mockReadVaultFile.mockResolvedValue(hugeContentBytes);

		const result = await readEstimateAiTextContentDetailed(
			createAssetFile({
				id: 'huge-txt-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/huge.txt',
				original_name: 'huge.txt'
			})
		);

		expect(result.chunks).toBeDefined();
		expect(result.chunks!.length).toBeGreaterThan(maxChunks);
		expect(result.isTruncated).toBe(false);
	});

	it('extracts PDF pages page-by-page using pdfjs', async () => {
		const { extractPdfPages } = await import('./ai-file-evidence.js');

		const mockGetPage = vi.fn().mockResolvedValue({
			getTextContent: vi.fn().mockResolvedValue({
				items: [{ str: 'Hello' }, { str: 'Page text' }]
			})
		});

		mockGetDocument.mockReturnValue({
			promise: Promise.resolve({
				numPages: 2,
				getPage: mockGetPage
			})
		});

		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await extractPdfPages(
			createAssetFile({
				id: 'pdf-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/doc.pdf',
				original_name: 'doc.pdf'
			})
		);

		expect(result).toEqual([
			{ pageNumber: 1, textContent: 'Hello Page text' },
			{ pageNumber: 2, textContent: 'Hello Page text' }
		]);
		expect(mockPdfWorkerInstances).toHaveLength(1);
		expect(mockPdfWorkerOptions.workerPort).toBe(mockPdfWorkerInstances[0]);
	});

	it('indexes every PDF page with its actual page number beyond the former 200-page cap', async () => {
		const { extractPdfPages } = await import('./ai-file-evidence.js');
		const mockGetPage = vi.fn(async (pageNumber: number) => ({
			getTextContent: async () => ({
				items: pageNumber === 201 ? [{ str: 'Final page scope' }] : []
			})
		}));
		mockGetDocument.mockReturnValue({
			promise: Promise.resolve({
				numPages: 201,
				getPage: mockGetPage
			})
		});
		mockReadVaultFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const result = await extractPdfPages(
			createAssetFile({
				id: 'pdf-long-1',
				project_id: 'project-1',
				file_path: 'workspace/project-1/long.pdf',
				original_name: 'long.pdf'
			})
		);

		expect(result).toHaveLength(201);
		expect(result[0]).toEqual({ pageNumber: 1, textContent: '' });
		expect(result[200]).toEqual({ pageNumber: 201, textContent: 'Final page scope' });
		expect(mockGetPage).toHaveBeenLastCalledWith(201);
	});

	it('prepareAndIndexFileChunks persists chunks to the database', async () => {
		const { prepareAndIndexFileChunks } = await import('./ai-file-evidence.js');
		mockPersistPageChunks.mockReset();

		mockReadVaultFile.mockResolvedValue(new TextEncoder().encode('Hello standard text'));

		const textFile = createAssetFile({
			id: 'txt-1',
			project_id: 'project-1',
			file_path: 'workspace/project-1/doc.txt',
			original_name: 'doc.txt'
		});

		await prepareAndIndexFileChunks(textFile);

		expect(mockPersistPageChunks).toHaveBeenCalledTimes(1);
		expect(mockPersistPageChunks).toHaveBeenCalledWith('txt-1', [
			{ pageNumber: 1, textContent: 'Hello standard text', chunkIndex: 0 }
		]);
	});

	it('prepareAndIndexFileChunks persists CAD summaries to the database', async () => {
		const { prepareAndIndexFileChunks } = await import('./ai-file-evidence.js');
		mockPersistPageChunks.mockReset();

		// Mock dxf preview to satisfy buildDxfAiEvidence call
		mockGetDerivedPreview.mockResolvedValue({
			kind: 'dxf',
			svg: '<svg viewBox="0 0 100 50"><rect width="100" height="50"/></svg>',
			entityCount: 15
		});

		const dxfFile = createAssetFile({
			id: 'dxf-1',
			project_id: 'project-1',
			file_path: 'workspace/project-1/layout.dxf',
			original_name: 'layout.dxf'
		});

		await prepareAndIndexFileChunks(dxfFile);

		expect(mockPersistPageChunks).toHaveBeenCalledTimes(1);
		expect(mockPersistPageChunks).toHaveBeenLastCalledWith('dxf-1', [
			{
				pageNumber: 1,
				textContent: expect.stringContaining('DXF CAD evidence prepared for AI drafting'),
				chunkIndex: 0
			}
		]);
	});
});
