import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('table empty state wrapper', () => {
	it('uses the shared Empty primitive with create and optional import actions', () => {
		const componentPath = join(process.cwd(), 'src/lib/components/table-empty-state.svelte');
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import * as Empty from '$lib/components/ui/empty/index.js';");
		expect(source).toContain('<Empty.Root');
		expect(source).toContain('{config.createLabel}');
		expect(source).toContain('{config.importLabel}');
		expect(source).toContain('secondaryActionLabel');
		expect(source).toContain('onSecondaryAction');
		expect(source).toContain('stackSecondaryAction');
		expect(source).toContain('max-w-3xl');
		expect(source).toContain('sm:flex-nowrap');
		expect(source).not.toContain('Learn More');
	});
});

describe('table pages', () => {
	it('route wizard-backed tables through the shared empty state and global import wizard', () => {
		const importBackedPages = [
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/materials/material-table.svelte',
			'src/lib/components/labour-rates/labour-rate-table.svelte',
			'src/lib/components/equipment-rates/equipment-rate-table.svelte',
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
			'src/lib/components/estimate-templates/estimate-templates-table.svelte'
		];
		const createOnlyPages = [
			'src/lib/components/classification-systems/classification-systems-table.svelte',
			'src/lib/components/classification-systems/cost-codes-table.svelte'
		];

		for (const file of importBackedPages) {
			const source = readSource(file);
			expect(source).toContain('<TableEmptyState');
			expect(source).toContain('appState.openSetupImportDialog()');
		}

		for (const file of createOnlyPages) {
			const source = readSource(file);
			expect(source).toContain('<TableEmptyState');
			expect(source).not.toContain('appState.openSetupImportDialog()');
		}
	});

	it('keeps unsupported pages on the shared empty state without exposing import', () => {
		const rfqSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const templatesSource = readSource(
			'src/lib/components/wbs/project-structure-templates-table.svelte'
		);

		expect(rfqSource).toContain('<TableEmptyState');
		expect(rfqSource).toContain('appState.openSetupImportDialog()');
		expect(rfqSource).toContain("importLabel: 'Import Setup Data'");
		expect(rfqSource).not.toContain('Import RFQs');
		expect(templatesSource).toContain('<TableEmptyState');
		expect(templatesSource).not.toContain('openSetupImportDialog');
	});

	it('keeps project structure empty actions aligned with the shared CTA contract', () => {
		const wbsSource = readSource('src/lib/components/wbs/wbs-table.svelte');

		expect(wbsSource).toContain('variant="filled"');
		expect(wbsSource).toContain('Add Structure Node');
		expect(wbsSource).toContain('Start from Template');
		expect(wbsSource).toContain('gap-2 px-4');
	});

	it('keeps archived records reachable from clean empty states on active-only pages', () => {
		const rfqSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const contactSource = readSource('src/lib/components/contacts/contact-table.svelte');

		expect(rfqSource).toContain('secondaryActionLabel');
		expect(rfqSource).toContain('stackSecondaryAction');
		expect(rfqSource).toContain("activeProjectFilter = 'archived'");
		expect(contactSource).toContain('secondaryActionLabel');
		expect(contactSource).toContain('stackSecondaryAction');
		expect(contactSource).toContain("activeCompanyFilter = 'archived'");
	});
});
