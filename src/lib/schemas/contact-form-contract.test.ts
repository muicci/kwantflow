import { describe, expect, it } from 'vitest';

import { contactFormSchema, ContactSchema } from '$lib/schemas/index.js';

const baseCompany = {
	kind: 'company' as const,
	country_code: 'AU',
	display_name: 'Atlas Steel',
	name: 'Atlas Steel',
	company_name: 'Atlas Steel',
	person_first_name: '',
	person_last_name: '',
	role_title: '',
	linked_company_id: '',
	is_primary_company_contact: false,
	contact_name: 'Mia Collins',
	email: 'office@atlas.example',
	phone: '+61 2 9000 1000',
	phone_country_code: 'AU',
	phone_e164: '',
	abn: '',
	business_id_label: 'ABN',
	business_id_value: '',
	tax_id_label: 'GST',
	tax_id_value: '',
	address: '',
	notes: '',
	custom_role_label: '',
	roles: ['customer'],
	tags: [],
	is_active: true
};

describe('contactFormSchema companies-first contract', () => {
	it('accepts person contacts without a separate company-style name field', () => {
		const result = contactFormSchema.safeParse({
			...baseCompany,
			kind: 'person',
			display_name: 'Mia Collins',
			name: '',
			company_name: '',
			person_first_name: 'Mia',
			person_last_name: 'Collins',
			contact_name: '',
			linked_company_id: 'company-atlas'
		});

		expect(result.success).toBe(true);
	});

	it('accepts company logo file metadata on company records', () => {
		const result = contactFormSchema.safeParse({
			...baseCompany,
			logo_file_path: 'companies/company-atlas/logo.png',
			custom_role_label: 'Fabricator'
		});

		expect(result.success).toBe(true);
	});

	it('accepts companies with only a custom role label and no fixed role', () => {
		const result = contactFormSchema.safeParse({
			...baseCompany,
			roles: [],
			custom_role_label: 'Freight partner'
		});

		expect(result.success).toBe(true);
	});

	it('rejects person contacts that are not linked to a company', () => {
		const result = contactFormSchema.safeParse({
			...baseCompany,
			kind: 'person',
			display_name: 'Mia Collins',
			name: 'Mia Collins',
			company_name: '',
			person_first_name: 'Mia',
			person_last_name: 'Collins',
			contact_name: '',
			linked_company_id: ''
		});

		expect(result.success).toBe(false);
		expect(result.error?.flatten().fieldErrors.linked_company_id).toContain(
			'Linked company is required for people'
		);
	});

	it('rejects person contacts without a person name', () => {
		const result = contactFormSchema.safeParse({
			...baseCompany,
			kind: 'person',
			display_name: '',
			name: '',
			company_name: '',
			person_first_name: '',
			person_last_name: '',
			contact_name: '',
			linked_company_id: 'company-atlas'
		});

		expect(result.success).toBe(false);
		expect(result.error?.flatten().fieldErrors.person_first_name).toContain(
			'First name or last name is required'
		);
	});
});

describe('ContactSchema JSON parsing', () => {
	it('returns an empty array when parsing an invalid JSON string for roles', () => {
		const result = ContactSchema.shape.roles.safeParse('invalid-json');

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([]);
		}
	});
});
