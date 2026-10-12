import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Comlink.wrap creates a proxy that expects real Worker communication.
// In vitest+jsdom, Workers are stubs that never respond, so wrap() hangs.
// Mock wrap() to return a controllable proxy with the methods derived-previews needs.
const mockParseDocument = vi.fn();
const mockParseSpreadsheet = vi.fn();
const mockParseDxf = vi.fn();

vi.mock('comlink', async () => {
	const actual = await vi.importActual<typeof import('comlink')>('comlink');
	return {
		...actual,
		wrap: vi.fn(() => ({
			parseDocument: mockParseDocument,
			parseSpreadsheet: mockParseSpreadsheet,
			parseDxf: mockParseDxf
		})),
		transfer: actual.transfer
	};
});

const {
	readVaultFileMock,
	readAppLocalFileMock,
	hashFileBytesMock,
	getDerivedPreviewCachePathMock,
	readDerivedPreviewCacheTextMock,
	writeDerivedPreviewCacheTextMock,
	createObjectURLMock,
	revokeObjectURLMock,
	convertToHtmlMock,
	xlsxReadMock,
	dxfHelperMock,
	decodeTiffMock,
	tiffPageCountMock
} = vi.hoisted(() => ({
	readVaultFileMock: vi.fn(),
	readAppLocalFileMock: vi.fn(),
	hashFileBytesMock: vi.fn(),
	getDerivedPreviewCachePathMock: vi.fn(),
	readDerivedPreviewCacheTextMock: vi.fn(),
	writeDerivedPreviewCacheTextMock: vi.fn(),
	createObjectURLMock: vi.fn(),
	revokeObjectURLMock: vi.fn(),
	convertToHtmlMock: vi.fn(),
	xlsxReadMock: vi.fn(),
	dxfHelperMock: vi.fn(),
	decodeTiffMock: vi.fn(),
	tiffPageCountMock: vi.fn()
}));

vi.mock('tiff', () => ({
	decode: decodeTiffMock,
	pageCount: tiffPageCountMock
}));

vi.mock('./assets', () => ({
	readVaultFile: readVaultFileMock,
	readAppLocalFile: readAppLocalFileMock,
	hashFileBytes: hashFileBytesMock,
	getDerivedPreviewCachePath: getDerivedPreviewCachePathMock,
	readDerivedPreviewCacheText: readDerivedPreviewCacheTextMock,
	writeDerivedPreviewCacheText: writeDerivedPreviewCacheTextMock
}));

vi.mock('../utils/env', () => ({
	isTauri: () => true
}));

vi.mock('mammoth', () => ({
	default: {
		convertToHtml: convertToHtmlMock
	},
	convertToHtml: convertToHtmlMock
}));

vi.mock('xlsx', () => ({
	read: xlsxReadMock,
	utils: {
		sheet_to_json: vi.fn()
	}
}));

vi.mock('@linkiez/dxf-renew', () => ({
	Helper: dxfHelperMock
}));

describe('derived previews', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockParseDocument.mockReset();
		mockParseSpreadsheet.mockReset();
		mockParseDxf.mockReset();
		decodeTiffMock.mockReset();
		tiffPageCountMock.mockReset();
		Object.defineProperty(URL, 'createObjectURL', {
			value: createObjectURLMock,
			configurable: true
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: revokeObjectURLMock,
			configurable: true
		});
		createObjectURLMock.mockReturnValue('blob:preview');
		hashFileBytesMock.mockImplementation(
			async (bytes: Uint8Array) => Array.from(bytes).join('-') || 'empty'
		);
		getDerivedPreviewCachePathMock.mockImplementation(
			(filePath: string, fingerprint: string, suffix: string) =>
				`generated-previews/${filePath.replaceAll(/[./]/g, '_')}__${fingerprint}.${suffix}`
		);
		readDerivedPreviewCacheTextMock.mockResolvedValue(null);
		writeDerivedPreviewCacheTextMock.mockResolvedValue(undefined);
	});

	it('sanitises generated document markup with a strict allowlist', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mockParseDocument.mockResolvedValue({
			html:
				'<p onclick="alert(1)">Safe <a href="https://example.com/spec">Link</a></p>' +
				'<script>alert(1)</script>' +
				'<a href="blob:evil">Blob</a>' +
				'<img src="data:image/png;base64,abc" onerror="oops()">' +
				'<img src="data:image/svg+xml;base64,abc">' +
				'<video src="https://example.com/movie.mp4"></video>',
			messages: ['ignored style']
		});

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/spec.docx');

		expect(preview.kind).toBe('document');
		if (preview.kind !== 'document') {
			throw new Error('Expected document preview');
		}
		expect(preview.messages).toEqual(['ignored style']);
		expect(preview.html).toContain('<p>Safe <a href="https://example.com/spec">Link</a></p>');
		expect(preview.html).not.toContain('onclick=');
		expect(preview.html).not.toContain('<script');
		expect(preview.html).not.toContain('blob:evil');
		expect(preview.html).not.toContain('onerror=');
		expect(preview.html).toContain('data:image/png;base64,abc');
		expect(preview.html).not.toContain('data:image/svg+xml');
		expect(preview.html).not.toContain('<video');
		expect(writeDerivedPreviewCacheTextMock).toHaveBeenCalledTimes(1);
	});

	it('rebuilds derived document previews when file content changes at the same path', async () => {
		readVaultFileMock
			.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
			.mockResolvedValueOnce(new Uint8Array([9, 9, 9]));
		mockParseDocument
			.mockResolvedValueOnce({ html: '<p>First</p>', messages: [] })
			.mockResolvedValueOnce({ html: '<p>Second</p>', messages: [] });

		const { getDerivedPreview } = await import('./derived-previews');

		const firstPreview = await getDerivedPreview('workspace/project/spec.docx');
		const secondPreview = await getDerivedPreview('workspace/project/spec.docx');

		expect(firstPreview.kind).toBe('document');
		expect(secondPreview.kind).toBe('document');
		if (firstPreview.kind !== 'document' || secondPreview.kind !== 'document') {
			throw new Error('Expected document previews');
		}
		expect(firstPreview.html).toContain('First');
		expect(secondPreview.html).toContain('Second');
		expect(mockParseDocument).toHaveBeenCalledTimes(2);
		expect(getDerivedPreviewCachePathMock).toHaveBeenNthCalledWith(
			1,
			'vault:workspace/project/spec.docx',
			'1-2-3',
			'docx.v2.json'
		);
		expect(getDerivedPreviewCachePathMock).toHaveBeenNthCalledWith(
			2,
			'vault:workspace/project/spec.docx',
			'9-9-9',
			'docx.v2.json'
		);
	});

	it('builds spreadsheet previews with sheet summaries and rows', async () => {
		mockParseSpreadsheet.mockResolvedValue({
			sheets: [
				{
					name: 'Takeoff',
					headers: ['Part', 'Qty'],
					rows: [
						['Plate', '2'],
						['Bracket', '4']
					],
					rowCount: 2,
					columnCount: 2,
					formulaCount: 0
				},
				{
					name: 'Notes',
					headers: ['Code', 'Description'],
					rows: [['A1', 'Notes']],
					rowCount: 1,
					columnCount: 2,
					formulaCount: 0
				}
			]
		});
		readVaultFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/register.xlsx');

		expect(preview.kind).toBe('spreadsheet');
		if (preview.kind !== 'spreadsheet') {
			throw new Error('Expected spreadsheet preview');
		}
		expect(preview.sheets).toHaveLength(2);
		expect(preview.sheets[0]).toMatchObject({
			name: 'Takeoff',
			columnCount: 2,
			rowCount: 2,
			headers: ['Part', 'Qty'],
			formulaCount: 0
		});
		expect(preview.sheets[0].rows[1]).toEqual(['Bracket', '4']);
	});

	it('builds a preview for every TIFF page beyond the former 20-page cap', async () => {
		readVaultFileMock.mockResolvedValue(new Uint8Array([73, 73, 42, 0]));
		tiffPageCountMock.mockReturnValue(21);
		decodeTiffMock.mockImplementation((_bytes: Uint8Array, options: { pages: number[] }) => [
			{
				width: 2,
				height: 1,
				data: new Uint8Array(8).fill(options.pages[0] ?? 0)
			}
		]);
		vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
			if (tagName === 'canvas') {
				return {
					width: 0,
					height: 0,
					getContext: () => ({
						createImageData: (width: number, height: number) => ({
							data: new Uint8ClampedArray(width * height * 4)
						}),
						putImageData() {}
					}),
					toDataURL: () => 'data:image/png;base64,cGFnZQ=='
				} as unknown as HTMLCanvasElement;
			}
			return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ blob: async () => new Blob(['page'], { type: 'image/png' }) }))
		);

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/drawing.tiff');

		expect(preview.kind).toBe('tiff');
		if (preview.kind !== 'tiff') throw new Error('Expected TIFF preview');
		expect(preview.pageCount).toBe(21);
		expect(preview.images).toHaveLength(21);
		expect(decodeTiffMock).toHaveBeenCalledTimes(21);
	});

	it('converts DXF previews into sanitised SVG object URLs', async () => {
		readVaultFileMock.mockResolvedValue(
			new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF')
		);
		mockParseDxf.mockResolvedValue({
			svg:
				'<svg xmlns="http://www.w3.org/2000/svg" stroke-width="0.1%" style="stroke-width: 0.1%;">' +
				'<script>alert(1)</script>' +
				'<foreignObject><div>Unsafe</div></foreignObject>' +
				'<use href="#layer-1" />' +
				'<use href="https://example.com/evil.svg#icon" />' +
				'<line x1="0" y1="0" x2="10" y2="10" onclick="alert(1)" stroke-width="0.1%" style="stroke-width: 0.1%; fill: none;" />' +
				'</svg>',
			entityCount: 2
		});

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/layout.dxf');

		expect(preview.kind).toBe('dxf');
		if (preview.kind !== 'dxf') {
			throw new Error('Expected DXF preview');
		}
		expect(preview.svgUrl).toBe('blob:preview');
		expect(preview.entityCount).toBe(2);
		expect(preview.svg).toContain('<use href="#layer-1"/>');
		expect(preview.svg).not.toContain('<script');
		expect(preview.svg).not.toContain('foreignObject');
		expect(preview.svg).not.toContain('https://example.com/evil.svg');
		expect(preview.svg).not.toContain('onclick=');
		expect(preview.svg).toContain('stroke-width="1px"');
		expect(preview.svg).not.toContain('stroke-width="0.1%"');
		expect(preview.svg).toContain('stroke-width: 1px;');
		expect(preview.svg).not.toContain('stroke-width: 0.1%;');
		expect(createObjectURLMock).toHaveBeenCalledTimes(1);
		expect(writeDerivedPreviewCacheTextMock).toHaveBeenCalledTimes(1);
	});

	it('fixes invisible text by setting missing or "none" fills to currentColor', async () => {
		readVaultFileMock.mockResolvedValue(
			new TextEncoder().encode('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF')
		);
		mockParseDxf.mockResolvedValue({
			svg:
				'<svg xmlns="http://www.w3.org/2000/svg">' +
				'<g fill="none">' +
				'<text>No fill</text>' +
				'<text fill="none">None fill</text>' +
				'<text fill="red">Red fill</text>' +
				'</g>' +
				'<defs><text>Defs text</text></defs>' +
				'</svg>',
			entityCount: 1
		});

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/layout.dxf');

		expect(preview.kind).toBe('dxf');
		if (preview.kind === 'dxf') {
			expect(preview.svg).toContain('<text fill="currentColor">No fill</text>');
			expect(preview.svg).toContain('<text fill="currentColor">None fill</text>');
			expect(preview.svg).toContain('<text fill="red">Red fill</text>');
		}
	});

	it('builds text previews with trimmed lines and truncation metadata', async () => {
		readVaultFileMock.mockResolvedValue(
			new TextEncoder().encode(
				'\nFirst line\nSecond line\n\nThird line\nFourth line\nFifth line\n' + 'A'.repeat(140)
			)
		);

		const { getDerivedPreview } = await import('./derived-previews');
		const preview = await getDerivedPreview('workspace/project/notes.txt');

		expect(preview.kind).toBe('text');
		if (preview.kind !== 'text') {
			throw new Error('Expected text preview');
		}
		expect(preview.lines).toEqual(['First line', 'Second line', 'Third line', 'Fourth line']);
		expect(preview.lineCount).toBe(8);
		expect(preview.truncated).toBe(true);
		expect(writeDerivedPreviewCacheTextMock).toHaveBeenCalledTimes(1);
	});

	describe('parseSvgDimensions', () => {
		it('parses space-separated viewBox dimensions', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg viewBox="0 0 100 50"></svg>')).toEqual({
				width: 100,
				height: 50
			});
		});

		it('parses comma-separated viewBox dimensions', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg viewBox="0,0,200,150"></svg>')).toEqual({
				width: 200,
				height: 150
			});
		});

		it('parses mixed space and comma separated viewBox dimensions', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg viewBox="0, 0, 300 250"></svg>')).toEqual({
				width: 300,
				height: 250
			});
		});

		it('falls back to width and height attributes when viewBox is missing', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg width="400" height="300"></svg>')).toEqual({
				width: 400,
				height: 300
			});
		});

		it('falls back to width and height attributes if viewBox is invalid', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg viewBox="invalid" width="500" height="450"></svg>')).toEqual({
				width: 500,
				height: 450
			});
			expect(
				parseSvgDimensions('<svg viewBox="0 0 -10 -20" width="500" height="450"></svg>')
			).toEqual({ width: 500, height: 450 });
		});

		it('falls back to default dimensions when SVG is invalid or missing dimensions', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			const expectedDefault = { width: 768, height: 768 };

			expect(parseSvgDimensions('<svg></svg>')).toEqual(expectedDefault);
			expect(parseSvgDimensions('<svg width="-100" height="50"></svg>')).toEqual(expectedDefault);
			expect(parseSvgDimensions('<svg width="auto" height="100%"></svg>')).toEqual(expectedDefault);
		});

		it('prefers viewBox over width/height when both are present (viewBox-first priority)', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			// Non-CAD SVGs may have both viewBox (logical) and width/height (pixel display).
			// The viewBox-first order handles dxf-renew's width="100%" output correctly,
			// but also applies to user-uploaded SVGs where viewBox and pixel dimensions differ.
			expect(
				parseSvgDimensions('<svg viewBox="0 0 100 50" width="800" height="600"></svg>')
			).toEqual({
				width: 100,
				height: 50
			});
			// width="100%" should be ignored in favor of viewBox
			expect(
				parseSvgDimensions('<svg viewBox="0 0 2000 1500" width="100%" height="100%"></svg>')
			).toEqual({
				width: 2000,
				height: 1500
			});
		});

		it('uses custom fallback size when specified', async () => {
			const { parseSvgDimensions } = await import('./derived-previews');
			expect(parseSvgDimensions('<svg></svg>', 1600)).toEqual({
				width: 1600,
				height: 1600
			});
		});
	});
});
