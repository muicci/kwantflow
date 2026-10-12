import { describe, expect, it } from 'vitest';

import { previewCatalogueImport } from './catalogue-import.js';

describe('previewCatalogueImport', () => {
	it('normalises material rows and preserves quoted commas in CSV fields', () => {
		const preview = previewCatalogueImport(
			'material',
			[
				'code,name,category,specification,unit,default_rate,is_active',
				'MAT-001,"Plate, Mild Steel",Steel Plate,"AS/NZS 3678, GR250",kg,2.85,yes'
			].join('\n')
		);

		expect(preview.validRows).toEqual([
			{
				code: 'MAT-001',
				name: 'Plate, Mild Steel',
				aliases: [],
				category: 'Steel Plate',
				specification: 'AS/NZS 3678, GR250',
				unit: 'kg',
				default_rate: 2.85,
				rate_basis: 'cost',
				is_active: true
			}
		]);
		expect(preview.errors).toEqual([]);
	});

	it('reports row-level errors when labour-rate values are invalid', () => {
		const preview = previewCatalogueImport(
			'labour-rate',
			[
				'code,name,category,work_center,unit,default_rate,is_active',
				'LAB-001,,Fabrication,Laser Cell,hr,-10,true'
			].join('\n')
		);

		expect(preview.validRows).toEqual([]);
		expect(preview.errors).toEqual([
			expect.objectContaining({
				rowNumber: 2,
				messages: expect.arrayContaining([
					'Rate name is required',
					'Default rate must be 0 or greater'
				])
			})
		]);
	});

	it('normalises equipment-unit aliases and boolean flags', () => {
		const preview = previewCatalogueImport(
			'equipment-rate',
			[
				'code,name,category,work_center,unit,default_rate,active',
				'EQ-001,Forklift,Handling,Workshop,hour,$55.00,1'
			].join('\n')
		);

		expect(preview.validRows).toEqual([
			{
				code: 'EQ-001',
				name: 'Forklift',
				aliases: [],
				category: 'Handling',
				work_center: 'Workshop',
				unit: 'hr',
				default_rate: 55,
				rate_basis: 'cost',
				is_active: true
			}
		]);
		expect(preview.errors).toEqual([]);
	});
});
