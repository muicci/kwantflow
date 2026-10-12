import { describe, it, expect } from 'vitest';
import { generateQuoteXlsxBytes, buildCostBreakdownRows } from './quote-excel-export.js';
import type { TakeoffItem } from '$lib/types/index.js';

describe('buildCostBreakdownRows', () => {
	it('returns rows for takeoff items with cost components', () => {
		const takeoffItems: TakeoffItem[] = [
			{
				id: 'item-1',
				estimate_asset_id: 'asset-1',
				parent_id: null,
				wbs_node_id: null,
				cost_code_id: null,
				applied_preset_id: null,
				applied_preset_name: null,
				name: 'Steel Beam',
				description: '200UB25.4',
				quantity: 4,
				unit: 'm',
				properties: {},
				sort_order: 1,
				cost_components: [
					{
						id: 'comp-1',
						takeoff_item_id: 'item-1',
						category: 'material',
						source_type: 'manual',
						source_id: null,
						name: 'Steel cost',
						description: 'Beam material',
						quantity: 4,
						unit: 'm',
						unit_rate: 85,
						formula: {},
						metadata: {},
						sort_order: 1
					},
					{
						id: 'comp-2',
						takeoff_item_id: 'item-1',
						category: 'labour',
						source_type: 'manual',
						source_id: null,
						name: 'Welding labour',
						description: 'Labour',
						quantity: 2,
						unit: 'hr',
						unit_rate: 120,
						formula: {},
						metadata: {},
						sort_order: 2
					}
				]
			}
		];

		const rows = buildCostBreakdownRows('Portal Frame', takeoffItems);
		expect(rows).toHaveLength(2);
		expect(rows[0].assetName).toBe('Portal Frame');
		expect(rows[0].takeoffItemName).toBe('Steel Beam');
		expect(rows[0].componentName).toBe('Steel cost');
		expect(rows[0].category).toBe('material');
		expect(rows[0].unitRate).toBe(85);
		expect(rows[0].componentTotal).toBe(340); // 4 * 85
		expect(rows[1].componentTotal).toBe(240); // 2 * 120
	});

	it('returns empty cost component row when takeoff item has no components', () => {
		const takeoffItems: TakeoffItem[] = [
			{
				id: 'item-2',
				estimate_asset_id: 'asset-2',
				parent_id: null,
				wbs_node_id: null,
				cost_code_id: null,
				applied_preset_id: null,
				applied_preset_name: null,
				name: 'Labour',
				description: 'General labour',
				quantity: 8,
				unit: 'hr',
				properties: {},
				sort_order: 1,
				cost_components: []
			}
		];

		const rows = buildCostBreakdownRows('Labour Only', takeoffItems);
		expect(rows).toHaveLength(1);
		expect(rows[0].componentName).toBe('');
		expect(rows[0].componentTotal).toBe(0);
	});
});

describe('generateQuoteXlsxBytes', () => {
	it('produces a valid XLSX binary with two sheets', async () => {
		const bytes = await generateQuoteXlsxBytes({
			rfqNumber: 'RFQ-001',
			lineItems: [
				{
					assetName: 'Steel Frame',
					scopeSummary: 'Main structural steel',
					quantity: 1,
					leadTime: '2 weeks',
					estCost: 15000,
					markupPercent: 10,
					unitPrice: 16500,
					lineTotal: 16500
				}
			],
			costBreakdownRows: [
				{
					assetName: 'Steel Frame',
					takeoffItemName: 'Steel Beam',
					itemDescription: '200UB25.4',
					itemQuantity: 4,
					itemUnit: 'm',
					componentName: 'Steel cost',
					category: 'material',
					unitRate: 85,
					componentTotal: 340
				}
			],
			grandTotal: 16500
		});

		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(bytes.length).toBeGreaterThan(100);

		// Verify we can read it back
		const XLSX = await import('xlsx');
		const workbook = XLSX.read(bytes, { type: 'array' });
		expect(workbook.SheetNames).toEqual(['Quote Summary', 'Cost Breakdown']);

		// Verify summary sheet data
		const summarySheet = workbook.Sheets['Quote Summary'];
		const summaryData = XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as unknown[][];
		expect(summaryData[0]).toEqual([
			'Asset Name',
			'Scope Summary',
			'Quantity',
			'Lead Time',
			'Est. Cost ($)',
			'Markup (%)',
			'Unit Price ($)',
			'Line Total ($)'
		]);
		expect(summaryData[1]).toEqual([
			'Steel Frame',
			'Main structural steel',
			1,
			'2 weeks',
			15000,
			10,
			16500,
			16500
		]);
		// Footer row
		const lastRow = summaryData[summaryData.length - 1];
		expect(lastRow[0]).toBe('Grand Total');
		expect(lastRow[7]).toBe(16500);

		// Verify breakdown sheet
		const breakdownSheet = workbook.Sheets['Cost Breakdown'];
		const breakdownData = XLSX.utils.sheet_to_json(breakdownSheet, { header: 1 }) as unknown[][];
		expect(breakdownData[0]).toEqual([
			'Asset Name',
			'Takeoff Item',
			'Description',
			'Quantity',
			'Unit',
			'Cost Component',
			'Category',
			'Unit Rate ($)',
			'Component Total ($)'
		]);
		expect(breakdownData[1][0]).toBe('Steel Frame');
	});

	it('handles empty line items gracefully', async () => {
		const bytes = await generateQuoteXlsxBytes({
			rfqNumber: 'RFQ-EMPTY',
			lineItems: [],
			costBreakdownRows: [],
			grandTotal: 0
		});

		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(bytes.length).toBeGreaterThan(100);

		const XLSX = await import('xlsx');
		const workbook = XLSX.read(bytes, { type: 'array' });
		expect(workbook.SheetNames).toEqual(['Quote Summary', 'Cost Breakdown']);
	});
});
