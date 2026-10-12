import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('setup create dialog mounting', () => {
	it('keeps preset and template create dialogs mounted in create mode', () => {
		const presetTableSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte'
		);
		const templateTableSource = readSource(
			'src/lib/components/estimate-templates/estimate-templates-table.svelte'
		);

		expect(presetTableSource).toContain(
			'<CostComponentPresetDialog bind:open={editOpen} preset={presetToEdit} />'
		);
		expect(presetTableSource).not.toContain('{#if editOpen && presetToEdit}');
		expect(presetTableSource).not.toContain('{#if editOpen}');

		expect(templateTableSource).toContain(
			'<EstimateTemplateDialog bind:open={editOpen} template={templateToEdit} />'
		);
		expect(templateTableSource).not.toContain('{#if editOpen && templateToEdit}');
		expect(templateTableSource).not.toContain('{#if editOpen}');
	});

	it('supports real create-mode save flows with create-specific copy', () => {
		const presetDialogSource = readSource(
			'src/lib/components/cost-component-presets/cost-component-preset-dialog.svelte'
		);
		const templateDialogSource = readSource(
			'src/lib/components/estimate-templates/estimate-template-dialog.svelte'
		);
		const presetStateSource = readSource('src/lib/state/cost-component-presets.svelte.ts');
		const templateStateSource = readSource('src/lib/state/estimate-templates.svelte.ts');

		expect(presetDialogSource).toContain('await costComponentPresetsState.addPreset(result.data);');
		expect(presetDialogSource).toContain("{preset ? `Edit ${preset.name}` : 'New Cost Preset'}");
		expect(presetDialogSource).toContain(
			"{isSaving ? 'Saving...' : preset ? 'Save Changes' : 'Save Preset'}"
		);
		expect(presetStateSource).toContain('async addPreset(data: CostComponentPresetFormValues)');

		expect(templateDialogSource).toContain(
			'await estimateTemplatesState.addTemplate(result.data);'
		);
		expect(templateDialogSource).toContain(
			"{template ? `Edit ${template.name}` : 'New Estimate Template'}"
		);
		expect(templateDialogSource).toContain(
			"{isSaving ? 'Saving...' : template ? 'Save Changes' : 'Save Template'}"
		);
		expect(templateStateSource).toContain('async addTemplate(data: EstimateTemplateFormValues)');
	});
});
