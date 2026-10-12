import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { normaliseUnitCode } from '$lib/constants/index.js';

export const PreviewTakeoffCostComponentSchema = z.object({
	name: z.string().trim().min(1).max(160),
	description: z.string().trim().max(500).default(''),
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	quantity: z.string().trim().min(1).max(120),
	unit: z.string().trim().min(1),
	unitRate: z.string().trim().min(1).max(120),
	sourceType: z
		.enum([
			'manual',
			'material_catalog',
			'labour_rate_card',
			'equipment_rate_card',
			'subcontract_rate_card'
		])
		.default('manual'),
	sourceId: z.string().trim().min(1).nullable().optional()
});

export const PreviewTakeoffItemParametersSchema = z.object({
	name: z.string().trim().min(1).max(160),
	description: z.string().trim().max(500).default(''),
	quantity: z.string().trim().min(1).max(120),
	unit: z.string().trim().min(1),
	precision: z.number().int().min(1).max(40).default(20),
	decimalPlaces: z.number().int().min(0).max(12).optional(),
	costComponents: z.array(PreviewTakeoffCostComponentSchema).min(0).max(25)
});

type PreviewTakeoffItemParameters = z.infer<typeof PreviewTakeoffItemParametersSchema>;
type PreviewTakeoffCostComponent = z.infer<typeof PreviewTakeoffCostComponentSchema>;

export type TakeoffPreviewResult = {
	previewOnly: true;
	name: string;
	description: string;
	quantity: string;
	unit: string;
	itemUnitCost: string;
	itemTotalCost: string;
	costComponents: Array<{
		name: string;
		category: PreviewTakeoffCostComponent['category'];
		quantity: string;
		unit: string;
		unitRate: string;
		unitCost: string;
	}>;
	issues: Array<{ code: 'invalid_unit'; message: string }>;
	provenance: {
		toolName: 'estimate_preview_takeoff_item';
		math: 'quote_engine_preview_rules';
		engine: 'decimal.js';
	};
};

function parsePositiveDecimal(Dec: typeof Decimal, value: string, label: string): Decimal {
	let decimal: Decimal;
	try {
		decimal = new Dec(value);
	} catch {
		throw new Error(`Invalid decimal ${label}: ${value}`);
	}
	if (!decimal.isFinite()) throw new Error(`Invalid decimal ${label}: value must be finite.`);
	if (decimal.lt(0)) throw new Error(`Invalid decimal ${label}: value must not be negative.`);
	return decimal;
}

function normaliseRequiredUnit(value: string, issues: TakeoffPreviewResult['issues']): string {
	const unit = normaliseUnitCode(value);
	if (unit) return unit;
	issues.push({ code: 'invalid_unit', message: `Unsupported estimator unit: ${value}` });
	return value.trim();
}

export function previewTakeoffItem(input: unknown): TakeoffPreviewResult {
	const parsed: PreviewTakeoffItemParameters = PreviewTakeoffItemParametersSchema.parse(input);
	const Dec = Decimal.clone({ precision: parsed.precision, rounding: Decimal.ROUND_HALF_UP });
	const issues: TakeoffPreviewResult['issues'] = [];
	const itemQuantity = parsePositiveDecimal(Dec, parsed.quantity, 'takeoff quantity');
	const costComponents: TakeoffPreviewResult['costComponents'] = [];
	let itemUnitCost = new Dec(0);

	for (const component of parsed.costComponents) {
		const quantity = parsePositiveDecimal(Dec, component.quantity, `${component.name} quantity`);
		const unitRate = parsePositiveDecimal(Dec, component.unitRate, `${component.name} unitRate`);
		let unitCost = quantity.mul(unitRate);
		if (parsed.decimalPlaces !== undefined) {
			unitCost = unitCost.toDecimalPlaces(parsed.decimalPlaces, Decimal.ROUND_HALF_UP);
		}
		itemUnitCost = itemUnitCost.plus(unitCost);
		costComponents.push({
			name: component.name,
			category: component.category,
			quantity: quantity.toString(),
			unit: normaliseRequiredUnit(component.unit, issues),
			unitRate: unitRate.toString(),
			unitCost: unitCost.toString()
		});
	}

	let itemTotalCost = itemQuantity.mul(itemUnitCost);
	if (parsed.decimalPlaces !== undefined) {
		itemUnitCost = itemUnitCost.toDecimalPlaces(parsed.decimalPlaces, Decimal.ROUND_HALF_UP);
		itemTotalCost = itemTotalCost.toDecimalPlaces(parsed.decimalPlaces, Decimal.ROUND_HALF_UP);
	}

	return {
		previewOnly: true,
		name: parsed.name,
		description: parsed.description,
		quantity: itemQuantity.toString(),
		unit: normaliseRequiredUnit(parsed.unit, issues),
		itemUnitCost: itemUnitCost.toString(),
		itemTotalCost: itemTotalCost.toString(),
		costComponents,
		issues,
		provenance: {
			toolName: 'estimate_preview_takeoff_item',
			math: 'quote_engine_preview_rules',
			engine: 'decimal.js'
		}
	};
}
