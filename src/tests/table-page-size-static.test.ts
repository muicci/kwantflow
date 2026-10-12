import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
	readFileSync(join(process.cwd(), relativePath), 'utf8');

const paginatedTables = [
	'src/lib/components/contacts/contact-table.svelte',
	'src/lib/components/rfqs/data-table.svelte',
	'src/lib/components/materials/material-table.svelte',
	'src/lib/components/labour-rates/labour-rate-table.svelte',
	'src/lib/components/equipment-rates/equipment-rate-table.svelte',
	'src/lib/components/classification-systems/classification-systems-table.svelte',
	'src/lib/components/classification-systems/cost-codes-table.svelte',
	'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
	'src/lib/components/estimate-templates/estimate-templates-table.svelte',
	'src/lib/components/wbs/wbs-table.svelte',
	'src/lib/components/wbs/project-structure-templates-table.svelte'
] as const;

describe('table page size persistence wiring', () => {
	it('routes every first-class paginated table through the shared table preference state', () => {
		const preferencesSource = readSource('src/lib/state/table-preferences.svelte.ts');
		expect(preferencesSource).toContain('TABLE_PAGE_SIZE_IDS');
		expect(preferencesSource).toContain('hydratePageSize');
		expect(preferencesSource).toContain('setPageSize');

		for (const relativePath of paginatedTables) {
			const source = readSource(relativePath);
			expect(source).toContain('tablePreferencesState');
			expect(source).toContain('TABLE_PAGE_SIZE_IDS');
		}
	});
});
