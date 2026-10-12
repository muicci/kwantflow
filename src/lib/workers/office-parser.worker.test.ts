import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('comlink', () => ({
	expose: vi.fn()
}));

describe('office spreadsheet preparation', () => {
	it('returns every used spreadsheet row instead of truncating after 200', async () => {
		const { parseSpreadsheetBuffer } = await import('./office-parser.worker.js');
		const workbook = XLSX.utils.book_new();
		const sourceRows = [
			['Item', 'Qty'],
			...Array.from({ length: 205 }, (_, index) => [`Item ${index + 1}`, index + 1])
		];
		XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sourceRows), 'Schedule');
		const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

		const result = await parseSpreadsheetBuffer(bytes);

		expect(result.sheets[0]?.rows).toHaveLength(205);
		expect(result.sheets[0]?.rows.at(-1)).toEqual(['Item 205', '205']);
		expect(result.sheets[0]?.rowCount).toBe(205);
	});

	it('preserves actual spreadsheet row coordinates and formulas as text', async () => {
		const { parseSpreadsheetBuffer } = await import('./office-parser.worker.js');
		const workbook = XLSX.utils.book_new();
		const worksheet = XLSX.utils.aoa_to_sheet([]);
		XLSX.utils.sheet_add_aoa(
			worksheet,
			[
				['Item', 'Total'],
				['Plate', null]
			],
			{ origin: 'B3' }
		);
		worksheet.C4 = { t: 'n', f: '10*2', v: 20 };
		XLSX.utils.book_append_sheet(workbook, worksheet, 'Costing');
		const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

		const result = await parseSpreadsheetBuffer(bytes);

		expect(result.sheets[0]).toMatchObject({
			headerRowNumber: 3,
			rowNumbers: [4],
			columnStart: 1,
			headers: ['Item', 'Total'],
			rows: [['Plate', '=10*2']],
			formulaCount: 1
		});
	});
});
