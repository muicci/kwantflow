import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = join(process.cwd(), 'src/lib/components/contacts/contact-dialog.svelte');

describe('contact dialog', () => {
	it('uses the shared phone input for company and person phone inputs', () => {
		expect(existsSync(componentPath)).toBe(true);

		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import PhoneInput from '$lib/components/phone-input.svelte';");
		expect(source).toContain('formatPhoneDraft');
		expect(source).toContain('<PhoneInput');
		expect(source).toContain('bind:value={formValues.phone}');
		expect(source).toContain('countryCode={formValues.phone_country_code}');
		expect(source.indexOf('<FieldLabel for="{id}-email">Email</FieldLabel>')).toBeLessThan(
			source.indexOf('<FieldLabel for="{id}-phone">Phone</FieldLabel>')
		);
		expect(source).not.toContain('handlePhoneInput');
		expect(source).not.toContain('oninput={handlePhoneInput}');
		expect(source).not.toContain(
			'placeholder={`e.g. ${selectedCountryProfile.callingCode} 000 000 000`}'
		);
	});

	it('uses a simple select menu for company type', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('<FieldLabel for="{id}-roles">Type</FieldLabel>');
		expect(source).toContain('Select company type');
		expect(source).toContain('size="default"');
		expect(source).toContain('formValues.roles = value ? [value as ContactRole] : []');
		expect(source).not.toContain('Search company types...');
	});

	it('uses the shared logo format contract for company logo picking', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('pickLabel="Upload logo"');
		expect(source).toContain('clearLabel="Remove logo"');
		expect(source).toContain('showActions');
		expect(source).toContain('BRAND_LOGO_EXTENSIONS');
		expect(source).toContain('extensions: [...BRAND_LOGO_EXTENSIONS]');
		expect(source).not.toContain('extensions: [...FILE_EXTENSIONS.image]');
	});

	it('uses delete-confirmation flow for people instead of direct archive buttons', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain(
			"import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';"
		);
		expect(source).toContain('Delete person?');
		expect(source).toContain('handleDeletePerson');
		expect(source).toContain('contactsState.deletePerson');
		expect(source).not.toContain('>Archive<');
	});

	it('hydrates every catalogue before showing company relationships', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain("import NetworkIcon from '@lucide/svelte/icons/network';");
		expect(source).toContain("{ id: 'details' as const, name: 'Details', icon: NotebookPenIcon }");
		expect(source).toContain("{ id: 'relations' as const, name: 'Relations', icon: NetworkIcon }");

		for (const stateName of [
			'materialsState',
			'labourRatesState',
			'equipmentRatesState',
			'subcontractRatesState'
		]) {
			expect(source).toContain(`${stateName}.hydrate()`);
		}
		expect(source).toContain("activeStep !== 'relations'");
		expect(source).toContain('untrack(() => syncSelectedCatalogueIds(companyId))');
		expect(source).toContain('item.is_active !== false || selectedMaterialIds.includes(item.id)');
		expect(source).toContain('item.is_active !== false || selectedLabourRateIds.includes(item.id)');
		expect(source).toContain(
			'item.is_active !== false || selectedEquipmentRateIds.includes(item.id)'
		);
		expect(source).toContain(
			'item.is_active !== false || selectedSubcontractRateIds.includes(item.id)'
		);
	});
});
