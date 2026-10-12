import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	COST_COMPONENT_UNIT_OPTIONS,
	EQUIPMENT_RATE_UNIT_OPTIONS,
	getUnitLabel,
	getCostComponentUnitOptions,
	getGeneralFileThumbnailKind,
	LABOUR_RATE_UNIT_OPTIONS,
	MATERIAL_UNIT_OPTIONS,
	SUBCONTRACT_RATE_UNIT_OPTIONS
} from './index.js';

function values(options: ReadonlyArray<{ value: string }>) {
	return options.map((option) => option.value);
}

describe('cost component unit options', () => {
	it('keeps material options aligned to measurable and packaged labels', () => {
		expect(values(MATERIAL_UNIT_OPTIONS)).toEqual([
			'ea',
			'set',
			'lot',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'm',
			'm2',
			'm3',
			'mm',
			'L',
			'kg',
			't'
		]);
		expect(getUnitLabel('m2')).toBe('Square metre (m²)');
		expect(getUnitLabel('hr')).toBe('Hour (hr)');
	});

	it('limits labour and equipment units to time-based, area, and linear values plus fixed', () => {
		expect(values(LABOUR_RATE_UNIT_OPTIONS)).toEqual([
			'min',
			'm',
			'm2',
			'm3',
			'hr',
			'day',
			'shift',
			'week',
			'fixed'
		]);
		expect(values(EQUIPMENT_RATE_UNIT_OPTIONS)).toEqual([
			'min',
			'm',
			'm2',
			'm3',
			'hr',
			'day',
			'shift',
			'week',
			'fixed'
		]);
	});

	it('keeps material units focused on measurable and packaged quantities', () => {
		expect(values(getCostComponentUnitOptions('material'))).toEqual([
			'ea',
			'set',
			'lot',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'm',
			'm2',
			'm3',
			'mm',
			'L',
			'kg',
			't'
		]);
	});

	it('keeps subcontract units broader than labour but narrower than the full cost-component list', () => {
		expect(values(getCostComponentUnitOptions('subcontract'))).toEqual([
			'ea',
			'set',
			'lot',
			'job',
			'min',
			'm',
			'm2',
			'm3',
			'hr',
			'day',
			'shift',
			'week',
			'kg',
			't',
			'fixed'
		]);
		expect(values(SUBCONTRACT_RATE_UNIT_OPTIONS)).toEqual([
			'ea',
			'set',
			'lot',
			'job',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'min',
			'm',
			'm2',
			'm3',
			'hr',
			'day',
			'shift',
			'week',
			'mm',
			'L',
			'kg',
			't',
			'fixed'
		]);
	});

	it('falls back to the full cost-component list for misc or missing categories', () => {
		expect(values(getCostComponentUnitOptions('misc'))).toEqual(
			values(COST_COMPONENT_UNIT_OPTIONS)
		);
		expect(values(getCostComponentUnitOptions())).toEqual(values(COST_COMPONENT_UNIT_OPTIONS));
		expect(values(getCostComponentUnitOptions(null))).toEqual(values(COST_COMPONENT_UNIT_OPTIONS));
	});
});

describe('general file thumbnail kinds', () => {
	it('maps accepted file families to thumbnail render kinds', () => {
		expect(getGeneralFileThumbnailKind('drawing.pdf')).toBe('pdf');
		expect(getGeneralFileThumbnailKind('photo.jpg')).toBe('image');
		expect(getGeneralFileThumbnailKind('notes.txt')).toBe('text');
		expect(getGeneralFileThumbnailKind('schedule.xlsx')).toBe('spreadsheet');
		expect(getGeneralFileThumbnailKind('brief.docx')).toBe('document');
		expect(getGeneralFileThumbnailKind('layout.dxf')).toBe('dxf');
		expect(getGeneralFileThumbnailKind('assembly.step')).toBe('cad');
		expect(getGeneralFileThumbnailKind('surface.iges')).toBe('cad');
	});

	it('keeps unsupported or non-thumbnail formats on icon fallback', () => {
		expect(getGeneralFileThumbnailKind('archive.zip')).toBe('none');
		expect(getGeneralFileThumbnailKind('legacy.doc')).toBe('none');
		expect(getGeneralFileThumbnailKind('sheet.xls')).toBe('none');
	});
});

describe('runtime build constants', () => {
	it('keeps dynamic WebView imports safe when Vite define replacement is unavailable', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/constants/index.ts'), 'utf8');
		for (const name of ['__KWANTFLOW_APP_VERSION__']) {
			expect(source).toContain(`typeof ${name} !== 'undefined'`);
		}
	});
});
