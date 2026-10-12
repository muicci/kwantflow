import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

const mobileStepDialogPaths = [
	'src/lib/components/intake/intake-dialog.svelte',
	'src/lib/components/contacts/contact-dialog.svelte',
	'src/lib/components/materials/material-dialog.svelte',
	'src/lib/components/labour-rates/labour-rate-dialog.svelte',
	'src/lib/components/equipment-rates/equipment-rate-dialog.svelte',
	'src/lib/components/classification-systems/cost-code-dialog.svelte',
	'src/lib/components/wbs/wbs-node-dialog.svelte',
	'src/lib/components/wbs/project-structure-template-editor-dialog.svelte'
] as const;

describe('mobile dialog step tabs', () => {
	it('uses one shared mobile step tab component across sidebar-authored dialogs', () => {
		const componentSource = readSource('src/lib/components/mobile-dialog-step-tabs.svelte');

		expect(componentSource).toContain('overflow-x-auto');
		expect(componentSource).toContain('md:hidden');
		expect(componentSource).toContain('activeStep');
		expect(componentSource).toContain('onSelect');
	});

	it('renders the shared mobile step tabs in the multi-step authoring dialogs', () => {
		const railFrameSource = readSource('src/lib/components/ui/dialog/dialog-rail-frame.svelte');

		expect(railFrameSource).toContain(
			"import MobileDialogStepTabs from '$lib/components/mobile-dialog-step-tabs.svelte';"
		);
		expect(railFrameSource).toContain('<MobileDialogStepTabs');
		expect(railFrameSource).toContain('activeStep={activeItemId}');

		for (const path of mobileStepDialogPaths) {
			const source = readSource(path);

			expect(source).toMatch(/<Dialog\.(RailFrame|WorkflowFrame)/);
			expect(source).toContain('activeStep');
			expect(source).toContain('onStepSelect');
		}
	});
});
