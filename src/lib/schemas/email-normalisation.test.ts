import { describe, expect, it } from 'vitest';

import { contactFormSchema, workspaceProfileSettingsSchema } from '$lib/schemas/index.js';

describe('editable email schema contract', () => {
	it('normalises contact emails to trimmed lowercase values', () => {
		const result = contactFormSchema.parse({
			kind: 'company',
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
			email: '  Office@Atlas.Example  ',
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
		});

		expect(result.email).toBe('office@atlas.example');
	});

	it('normalises workspace profile business contact email to trimmed lowercase values', () => {
		const result = workspaceProfileSettingsSchema.parse({
			displayName: 'Atlas Workspace',
			countryCode: 'AU',
			businessName: 'Atlas Steel',
			businessContactFirstName: 'Mia',
			businessContactLastName: 'Collins',
			businessContactEmail: '  MiA.Collins@Atlas.Example  ',
			businessContactPhone: '+61 400 000 000',
			businessIdValue: '',
			businessAddress: ''
		});

		expect(result.businessContactEmail).toBe('mia.collins@atlas.example');
	});
});
