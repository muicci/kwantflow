import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
	const filePath = join(process.cwd(), relativePath);
	expect(existsSync(filePath)).toBe(true);
	return readFileSync(filePath, 'utf8');
}

describe('unit label contract', () => {
	it('uses shared unit labels across reusable estimating preview surfaces', () => {
		const presetPreviewSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-preset-preview.svelte'
		);
		const templatePreviewSource = readSource(
			'src/lib/components/estimate-templates/estimate-template-preview.svelte'
		);

		expect(presetPreviewSource).toContain(
			"import { getUnitLabel } from '$lib/constants/index.js';"
		);
		expect(presetPreviewSource).toContain('getUnitLabel(component.unit)');
		expect(presetPreviewSource).not.toContain(
			'<TableTextCell text={component.unit} tone="secondary" />'
		);

		expect(templatePreviewSource).toContain(
			"import { getUnitLabel } from '$lib/constants/index.js';"
		);
		expect(templatePreviewSource).toContain('getUnitLabel(item.unit)');
		expect(templatePreviewSource).not.toContain(
			'<TableTextCell text={item.unit} tone="secondary" />'
		);
	});
});
