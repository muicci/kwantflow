import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readSource(relativePath: string): string {
	return readFileSync(join(root, relativePath), 'utf8');
}

describe('setup table actions', () => {
	it('supports an optional import action and keeps the shared action chrome on the default flat control size', () => {
		const source = readSource('src/lib/components/setup-table-actions.svelte');
		expect(source).toContain('Import Setup Data');
		expect(source).toContain('Create');
		expect(source).toContain('variant="secondary" size="default"');
		expect(source).toContain('variant="brand" size="default"');
		expect(source).not.toContain('shadow-none');
		expect(source).not.toContain('class="h-8');
	});

	it('is used by active setup-backed tables, not only empty states', () => {
		const files = [
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/materials/material-table.svelte',
			'src/lib/components/labour-rates/labour-rate-table.svelte',
			'src/lib/components/equipment-rates/equipment-rate-table.svelte',
			'src/lib/components/subcontract-rates/subcontract-rate-table.svelte',
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
			'src/lib/components/estimate-templates/estimate-templates-table.svelte',
			'src/lib/components/classification-systems/classification-systems-table.svelte'
		];

		for (const relativePath of files) {
			const source = readSource(relativePath);
			expect(source, relativePath).toContain(
				"import SetupTableActions from '../setup-table-actions.svelte'"
			);
			expect(source, relativePath).toContain('<SetupTableActions');
		}
	});

	it('keeps setup import in the empty-state workflow instead of crowding active table bars', () => {
		const emptyStateImportFiles = [
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/subcontract-rates/subcontract-rate-table.svelte'
		];
		const activeBarFiles = [
			'src/lib/components/materials/material-table.svelte',
			'src/lib/components/labour-rates/labour-rate-table.svelte',
			'src/lib/components/equipment-rates/equipment-rate-table.svelte',
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
			'src/lib/components/estimate-templates/estimate-templates-table.svelte',
			'src/lib/components/classification-systems/classification-systems-table.svelte',
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/subcontract-rates/subcontract-rate-table.svelte'
		];

		for (const relativePath of emptyStateImportFiles) {
			const source = readSource(relativePath);
			expect(source, relativePath).toContain('onImport={() => appState.openSetupImportDialog()}');
		}

		for (const relativePath of activeBarFiles) {
			const source = readSource(relativePath);
			expect(source, relativePath).not.toMatch(
				/<SetupTableActions[\s\S]*onImport=\{\(\) => appState\.openSetupImportDialog\(\)\}/
			);
		}
	});
});
