import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('record table destructive dialog wiring', () => {
	it('explicitly closes single-delete dialogs after destructive actions', () => {
		const expectedClosePatterns = [
			{
				path: 'src/lib/components/estimate-templates/estimate-templates-table.svelte',
				fragment: 'deleteOpen = false;'
			},
			{
				path: 'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
				fragment: 'deleteOpen = false;'
			},
			{
				path: 'src/lib/components/subcontract-rates/subcontract-rate-table.svelte',
				fragment: 'isDeleteDialogOpen = false;'
			},
			{
				path: 'src/lib/components/wbs/project-structure-templates-table.svelte',
				fragment: 'deleteOpen = false;'
			}
		];

		for (const { path, fragment } of expectedClosePatterns) {
			const source = readSource(path);
			expect(source, `${path} should explicitly close its single-delete dialog`).toContain(
				fragment
			);
		}
	});

	it('treats an empty active companies view as a shared empty state', () => {
		const source = readSource('src/lib/components/contacts/contact-table.svelte');

		expect(source).toContain(
			"let activeCompanyFilter = $state<'active' | 'archived' | 'all'>('active');"
		);
		expect(source).toContain('const showEmptyState = $derived(');
		expect(source).toContain('contactsState.allCompanies.length === 0');
		expect(source).toContain(
			"(activeCompanyFilter === 'active' && contactsState.companies.length === 0)"
		);
		expect(source).toContain('stackSecondaryAction={contactsState.archivedCompanies.length > 0');
	});

	it('keeps permanent delete for archived records only on company and RFQ tables', () => {
		const contactSource = readSource('src/lib/components/contacts/contact-table.svelte');
		const projectSource = readSource('src/lib/components/rfqs/data-table.svelte');
		const projectActionsSource = readSource('src/lib/components/project-actions-menu.svelte');

		expect(contactSource).toContain("activeCompanyFilter === 'archived'");
		expect(contactSource).toContain('Delete Company');
		expect(contactSource).toContain('contactsState.deleteArchivedCompany');
		expect(projectSource).toContain('Archive RFQ');
		expect(projectSource).toContain('Restore RFQ');
		expect(projectSource).toContain('Delete RFQ');
		expect(projectActionsSource).toContain('Archive RFQ');
		expect(projectActionsSource).toContain('Restore RFQ');
		expect(projectActionsSource).toContain('Delete RFQ');
	});

	it('uses the shared compact alert-dialog spacing contract on standard destructive dialogs', () => {
		const standardDialogPaths = [
			'src/routes/+layout.svelte',
			'src/routes/project/[id]/+page.svelte',
			'src/lib/components/project-actions-menu.svelte',
			'src/lib/components/rfqs/data-table.svelte',
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/materials/material-table.svelte',
			'src/lib/components/labour-rates/labour-rate-table.svelte',
			'src/lib/components/equipment-rates/equipment-rate-table.svelte',
			'src/lib/components/cost-component-presets/cost-component-presets-table.svelte',
			'src/lib/components/estimate-templates/estimate-templates-table.svelte',
			'src/lib/components/classification-systems/classification-systems-table.svelte',
			'src/lib/components/classification-systems/cost-codes-table.svelte',
			'src/lib/components/wbs/wbs-table.svelte',
			'src/lib/components/wbs/project-structure-template-editor-dialog.svelte',
			'src/lib/components/wbs/project-structure-templates-table.svelte'
		];

		for (const path of standardDialogPaths) {
			const source = readSource(path);
			expect(
				source,
				`${path} should not add extra top padding to alert descriptions`
			).not.toContain('AlertDialog.Description class="pt-2"');
			expect(
				source,
				`${path} should not add extra footer margin to standard alert dialogs`
			).not.toContain('AlertDialog.Footer class="mt-4 gap-2"');
		}
	});

	it('keeps shared alert-dialog button sizing and title scale at the primitive level', () => {
		const actionPrimitive = readSource(
			'src/lib/components/ui/alert-dialog/alert-dialog-action.svelte'
		);
		const cancelPrimitive = readSource(
			'src/lib/components/ui/alert-dialog/alert-dialog-cancel.svelte'
		);
		const standardDialogPaths = [
			'src/routes/+layout.svelte',
			'src/lib/components/project-actions-menu.svelte',
			'src/lib/components/rfqs/data-table.svelte',
			'src/lib/components/contacts/contact-table.svelte',
			'src/lib/components/materials/material-table.svelte',
			'src/lib/components/labour-rates/labour-rate-table.svelte',
			'src/lib/components/equipment-rates/equipment-rate-table.svelte',
			'src/lib/components/wbs/wbs-table.svelte'
		];

		expect(actionPrimitive).toContain("size = 'sm'");
		expect(cancelPrimitive).toContain("size = 'sm'");

		for (const path of standardDialogPaths) {
			const source = readSource(path);
			expect(source, `${path} should not upsize alert-dialog titles at call sites`).not.toContain(
				'<AlertDialog.Title class='
			);
			expect(source, `${path} should not hardcode alert-dialog button size overrides`).not.toMatch(
				/<AlertDialog\.(Cancel|Action)[^>]*(size="sm"|class="h-8")/
			);
		}
	});
});
