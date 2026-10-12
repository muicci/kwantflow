import type { TakeoffItem } from '$lib/types/index.js';
import { dec } from '$lib/utils/math.js';

export interface QuoteExcelSummaryRow {
	assetName: string;
	scopeSummary: string;
	quantity: number;
	leadTime: string;
	estCost: number;
	markupPercent: number;
	unitPrice: number;
	lineTotal: number;
}

export interface QuoteExcelCostBreakdownRow {
	assetName: string;
	takeoffItemName: string;
	itemDescription: string;
	itemQuantity: number;
	itemUnit: string;
	componentName: string;
	category: string;
	unitRate: number;
	componentTotal: number;
}

export interface QuoteExcelExportPayload {
	rfqNumber: string;
	lineItems: QuoteExcelSummaryRow[];
	costBreakdownRows: QuoteExcelCostBreakdownRow[];
	grandTotal: number;
}

/**
 * Build a Quote Summary + Cost Breakdown XLSX workbook as a Uint8Array.
 * Uses dynamic import of the `xlsx` library (already a dependency).
 */
export async function generateQuoteXlsxBytes(
	payload: QuoteExcelExportPayload
): Promise<Uint8Array> {
	const XLSX = await import('xlsx');

	// ── Sheet 1: Quote Summary ──────────────────────────────────────────

	const summaryHeader: (string | number)[] = [
		'Asset Name',
		'Scope Summary',
		'Quantity',
		'Lead Time',
		'Est. Cost ($)',
		'Markup (%)',
		'Unit Price ($)',
		'Line Total ($)'
	];

	const summaryRows: (string | number)[][] = payload.lineItems.map((item) => [
		item.assetName,
		item.scopeSummary,
		item.quantity,
		item.leadTime,
		item.estCost,
		item.markupPercent,
		item.unitPrice,
		item.lineTotal
	]);

	const summaryFooter: (string | number)[] = [
		'Grand Total',
		'',
		'',
		'',
		'',
		'',
		'',
		payload.grandTotal
	];

	const summarySheetData = [summaryHeader, ...summaryRows, summaryFooter];
	const summaryWs = XLSX.utils.aoa_to_sheet(summarySheetData);

	// Set column widths for summary
	summaryWs['!cols'] = [
		{ wch: 30 }, // Asset Name
		{ wch: 40 }, // Scope Summary
		{ wch: 10 }, // Quantity
		{ wch: 14 }, // Lead Time
		{ wch: 14 }, // Est. Cost
		{ wch: 12 }, // Markup
		{ wch: 14 }, // Unit Price
		{ wch: 14 } // Line Total
	];

	// Freeze the header row
	summaryWs['!freeze'] = { x: 0, y: 1 };

	// ── Sheet 2: Cost Breakdown ─────────────────────────────────────────

	const breakdownHeader: (string | number)[] = [
		'Asset Name',
		'Takeoff Item',
		'Description',
		'Quantity',
		'Unit',
		'Cost Component',
		'Category',
		'Unit Rate ($)',
		'Component Total ($)'
	];

	const breakdownRows: (string | number)[][] = payload.costBreakdownRows.map((row) => [
		row.assetName,
		row.takeoffItemName,
		row.itemDescription,
		row.itemQuantity,
		row.itemUnit,
		row.componentName,
		row.category,
		row.unitRate,
		row.componentTotal
	]);

	const breakdownSheetData = [breakdownHeader, ...breakdownRows];
	const breakdownWs = XLSX.utils.aoa_to_sheet(breakdownSheetData);

	breakdownWs['!cols'] = [
		{ wch: 30 }, // Asset Name
		{ wch: 28 }, // Takeoff Item
		{ wch: 40 }, // Description
		{ wch: 10 }, // Quantity
		{ wch: 8 }, // Unit
		{ wch: 28 }, // Cost Component
		{ wch: 18 }, // Category
		{ wch: 14 }, // Unit Rate
		{ wch: 16 } // Component Total
	];

	breakdownWs['!freeze'] = { x: 0, y: 1 };

	// ── Build workbook ──────────────────────────────────────────────────

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, summaryWs, 'Quote Summary');
	XLSX.utils.book_append_sheet(wb, breakdownWs, 'Cost Breakdown');

	const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
	return new Uint8Array(bytes);
}

/**
 * Build cost breakdown rows from an estimate's takeoff items.
 */
export function buildCostBreakdownRows(
	assetName: string,
	takeoffItems: TakeoffItem[]
): QuoteExcelCostBreakdownRow[] {
	const rows: QuoteExcelCostBreakdownRow[] = [];

	for (const item of takeoffItems) {
		if (item.cost_components.length === 0) {
			// Item without cost components still appears as a row
			rows.push({
				assetName,
				takeoffItemName: item.name,
				itemDescription: item.description,
				itemQuantity: item.quantity,
				itemUnit: item.unit,
				componentName: '',
				category: '',
				unitRate: 0,
				componentTotal: 0
			});
			continue;
		}

		for (const component of item.cost_components) {
			const componentTotal = dec(component.quantity).mul(component.unit_rate).toNumber();
			rows.push({
				assetName,
				takeoffItemName: item.name,
				itemDescription: item.description,
				itemQuantity: item.quantity,
				itemUnit: item.unit,
				componentName: component.name,
				category: component.category,
				unitRate: component.unit_rate,
				componentTotal
			});
		}
	}

	return rows;
}
