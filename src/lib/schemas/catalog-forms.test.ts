import { describe, expect, it } from 'vitest';
import {
	classificationSystemFormSchema,
	costCodeFormSchema,
	equipmentRateCardFormSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	subcontractRateCardFormSchema,
	wbsNodeFormSchema
} from './index.js';

describe('estimating catalog form schemas', () => {
	it('accepts a valid material catalog item payload', () => {
		const result = materialCatalogItemFormSchema.safeParse({
			code: 'MS-001',
			name: 'Mild Steel Plate',
			specification: '250 Grade',
			aliases: ['plate', 'ms plate'],
			unit: 'kg',
			default_rate: 4.5,
			is_active: true
		});

		expect(result.success).toBe(true);
	});

	it('rejects a material catalog item with a labour-only unit', () => {
		const result = materialCatalogItemFormSchema.safeParse({
			code: 'MS-002',
			name: 'Hourly Steel',
			specification: 'Invalid unit example',
			unit: 'hr',
			default_rate: 4.5,
			is_active: true
		});

		expect(result.success).toBe(false);
	});

	it('accepts a labour rate card with shift as a supported unit', () => {
		const result = labourRateCardFormSchema.safeParse({
			code: 'LASER',
			name: 'Laser Cutting',
			work_center: 'Laser Bay',
			aliases: ['laser crew'],
			unit: 'shift',
			default_rate: 120,
			is_active: true
		});

		expect(result.success).toBe(true);
	});

	it('accepts an equipment rate card with week as a supported unit', () => {
		const result = equipmentRateCardFormSchema.safeParse({
			code: 'CRANE-WEEK',
			name: 'Crane Weekly Hire',
			work_center: 'Hire Fleet',
			aliases: ['mobile crane'],
			unit: 'week',
			default_rate: 2400,
			is_active: true
		});

		expect(result.success).toBe(true);
	});

	it('accepts subcontract rates with broader subcontract units', () => {
		const result = subcontractRateCardFormSchema.safeParse({
			code: 'CRANE',
			name: 'Crane hire',
			aliases: ['lift subcontractor'],
			unit: 'shift',
			default_rate: 420,
			is_active: true
		});

		expect(result.success).toBe(true);
	});

	it('requires a valid classification system type', () => {
		const result = classificationSystemFormSchema.safeParse({
			name: 'CSI MasterFormat',
			code: 'CSI',
			classification_type: 'masterformat',
			is_default: true
		});

		expect(result.success).toBe(true);
	});

	it('accepts alias arrays for source records', () => {
		const result = materialCatalogItemFormSchema.safeParse({
			name: 'Checker Plate',
			aliases: ['checker plate', 'floor plate'],
			unit: 'ea',
			default_rate: 7.5,
			is_active: true
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.aliases).toEqual(['checker plate', 'floor plate']);
		}
	});

	it('requires a cost code name and code', () => {
		const result = costCodeFormSchema.safeParse({
			parent_id: null,
			code: '',
			name: '',
			description: '',
			is_active: true,
			sort_order: 0
		});

		expect(result.success).toBe(false);
	});

	it('requires a WBS node name and type', () => {
		const result = wbsNodeFormSchema.safeParse({
			parent_id: null,
			code: 'L1',
			name: 'Level 1',
			type: 'level',
			sort_order: 10
		});

		expect(result.success).toBe(true);
	});
});
