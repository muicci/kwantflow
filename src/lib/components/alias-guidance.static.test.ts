import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('alias guidance contract', () => {
	it('reuses the shared alias guidance across setup dialogs and estimator save flows', () => {
		const aliasGuidanceSource = readSource('src/lib/constants/alias-guidance.ts');
		const materialsSource = readSource('src/lib/components/materials/material-dialog.svelte');
		const labourSource = readSource('src/lib/components/labour-rates/labour-rate-dialog.svelte');
		const equipmentSource = readSource(
			'src/lib/components/equipment-rates/equipment-rate-dialog.svelte'
		);
		const subcontractSource = readSource(
			'src/lib/components/subcontract-rates/subcontract-rate-dialog.svelte'
		);
		const presetSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-preset-dialog.svelte'
		);
		const templateSource = readSource(
			'src/lib/components/estimate-templates/estimate-template-dialog.svelte'
		);
		const classificationSource = readSource(
			'src/lib/components/classification-systems/classification-system-dialog.svelte'
		);
		const estimateEditorSource = readSource(
			'src/lib/components/assets/asset-estimate-editor.svelte'
		);
		const wizardSource = readSource('src/lib/components/user/setup-import-dialog.svelte');

		expect(aliasGuidanceSource).toContain('ALIAS_INPUT_PLACEHOLDER');
		expect(aliasGuidanceSource).toContain('ALIAS_FIELD_HELP_TEXT');
		expect(aliasGuidanceSource).toContain('SETUP_IMPORT_ALIAS_UPLOAD_HELP');
		expect(aliasGuidanceSource).toContain('SETUP_IMPORT_ALIAS_FIELD_DESCRIPTION');

		for (const source of [
			materialsSource,
			labourSource,
			equipmentSource,
			subcontractSource,
			presetSource,
			templateSource,
			classificationSource,
			estimateEditorSource
		]) {
			expect(source).toContain('ALIAS_INPUT_PLACEHOLDER');
			expect(source).toContain('ALIAS_FIELD_HELP_TEXT');
		}

		expect(wizardSource).toContain('SETUP_IMPORT_ALIAS_UPLOAD_HELP');
		expect(wizardSource).toContain('SETUP_IMPORT_ALIAS_FIELD_DESCRIPTION');
		expect(wizardSource).toContain("if (field.id === 'aliases')");
		expect(estimateEditorSource).toContain('<FieldShell>');
		expect(estimateEditorSource).toContain(
			'<FieldLabelRow for="template-aliases" tooltip={ALIAS_FIELD_HELP_TEXT}'
		);
		expect(estimateEditorSource).toContain('<Select.Trigger id="template-active" class="w-full">');
	});
});
