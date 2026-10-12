import { describe, expect, it } from 'vitest';
import {
	formatContactRoleLabel,
	normaliseContactLookupValue,
	deriveContactDisplayName,
	buildSetupImportPendingContactCompanyKey,
	normaliseContactFormInput,
	resolvePendingContactCompanyLink,
	SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX
} from './contact-normalisation.js';

describe('contact-normalisation', () => {
	describe('formatContactRoleLabel', () => {
		it('should return custom role if available', () => {
			expect(formatContactRoleLabel({ custom_role_label: 'Super Admin' })).toBe('Super Admin');
			expect(formatContactRoleLabel({ roles: ['customer'], custom_role_label: '  Custom ' })).toBe(
				'Custom'
			);
		});

		it('should format standard roles correctly', () => {
			expect(formatContactRoleLabel({ roles: ['customer'] })).toBe('Customer');
			expect(formatContactRoleLabel({ roles: ['subcontractor'] })).toBe('Subcontractor');
			expect(formatContactRoleLabel({ roles: ['supplier'] })).toBe('Supplier');
			expect(formatContactRoleLabel({ roles: ['vendor'] })).toBe('Vendor');
			expect(formatContactRoleLabel({ roles: ['manufacturer'] })).toBe('Manufacturer');
		});

		it('should return "Not set" for unknown or missing roles', () => {
			expect(formatContactRoleLabel({})).toBe('Not set');
			expect(formatContactRoleLabel({ roles: [] })).toBe('Not set');
			expect(
				formatContactRoleLabel({
					roles: [
						'unknown_role' as NonNullable<Parameters<typeof formatContactRoleLabel>[0]['roles']>[0]
					]
				})
			).toBe('Not set');
		});
	});

	describe('normaliseContactLookupValue', () => {
		it('should normalise string value', () => {
			expect(normaliseContactLookupValue(' Test String ')).toBe('test string');
			expect(normaliseContactLookupValue('UPPERCASE')).toBe('uppercase');
		});

		it('should handle null or undefined', () => {
			expect(normaliseContactLookupValue(null)).toBe('');
			expect(normaliseContactLookupValue(undefined)).toBe('');
		});
	});

	describe('deriveContactDisplayName', () => {
		it('should return display_name if present', () => {
			expect(deriveContactDisplayName({ display_name: ' My Display Name ' })).toBe(
				'My Display Name'
			);
		});

		it('should fallback to name if display_name is missing', () => {
			expect(deriveContactDisplayName({ name: ' My Name ' })).toBe('My Name');
		});

		it('should fallback to company_name if name is missing', () => {
			expect(deriveContactDisplayName({ company_name: ' My Company ' })).toBe('My Company');
		});

		it('should fallback to person names if company_name is missing', () => {
			expect(
				deriveContactDisplayName({ person_first_name: ' John ', person_last_name: ' Doe ' })
			).toBe('John Doe');
			expect(deriveContactDisplayName({ person_first_name: 'John' })).toBe('John');
			expect(deriveContactDisplayName({ person_last_name: 'Doe' })).toBe('Doe');
		});

		it('should return empty string if no relevant fields', () => {
			expect(deriveContactDisplayName({})).toBe('');
		});
	});

	describe('buildSetupImportPendingContactCompanyKey', () => {
		it('should build key based on company_name', () => {
			expect(
				buildSetupImportPendingContactCompanyKey({
					company_name: ' My Company ',
					country_code: 'AU'
				})
			).toBe('my_company|au');
		});

		it('should build key based on display_name if company_name is missing', () => {
			expect(
				buildSetupImportPendingContactCompanyKey({
					display_name: ' Display Company ',
					country_code: 'US'
				})
			).toBe('display_company|us');
		});

		it('should build key based on business_id_value if names are missing', () => {
			expect(
				buildSetupImportPendingContactCompanyKey({
					business_id_value: ' ABN 123 ',
					country_code: 'UK'
				})
			).toBe('abn_123|uk');
		});

		it('should handle missing country code', () => {
			expect(buildSetupImportPendingContactCompanyKey({ company_name: 'Company' })).toBe(
				'company|unknown'
			);
		});

		it('should replace special characters and trim underscores', () => {
			expect(
				buildSetupImportPendingContactCompanyKey({ company_name: '!!!Company@@@Name###' })
			).toBe('company_name|unknown');
		});

		it('should fallback to "company" if no relevant fields', () => {
			expect(buildSetupImportPendingContactCompanyKey({})).toBe('company|unknown');
		});

		it('should truncate the company key to 64 characters', () => {
			const longName = 'A'.repeat(100);
			const expectedKey = 'a'.repeat(64);
			expect(buildSetupImportPendingContactCompanyKey({ company_name: longName })).toBe(
				`${expectedKey}|unknown`
			);
		});
	});

	describe('normaliseContactFormInput', () => {
		it('should provide default values for empty input', () => {
			expect(normaliseContactFormInput({})).toEqual({
				kind: 'company',
				country_code: '',
				display_name: '',
				name: '',
				company_name: '',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: '',
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				website: '',
				phone: '',
				phone_country_code: '',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: '',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				logo_file_path: '',
				custom_role_label: '',
				roles: [],
				tags: [],
				is_active: true
			});
		});

		it('should preserve provided values and normalise display fields', () => {
			expect(
				normaliseContactFormInput({
					kind: 'person',
					country_code: 'AU',
					name: 'John Doe',
					roles: ['customer'],
					is_active: false
				})
			).toEqual({
				kind: 'person',
				country_code: 'AU',
				display_name: 'John Doe',
				name: 'John Doe',
				company_name: 'John Doe',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: '',
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				website: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: '',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				logo_file_path: '',
				custom_role_label: '',
				roles: ['customer'],
				tags: [],
				is_active: false
			});
		});
	});

	describe('resolvePendingContactCompanyLink', () => {
		const pendingCompanyIds = new Map<string, string>([['my_company|au', 'resolved-uuid-123']]);

		it('should return original row if kind is not person', () => {
			const row = {
				kind: 'company',
				linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}my_company|au`
			} as Parameters<typeof resolvePendingContactCompanyLink>[0];
			expect(resolvePendingContactCompanyLink(row, pendingCompanyIds)).toBe(row);
		});

		it('should return original row if no linked_company_id', () => {
			const row = { kind: 'person' } as Parameters<typeof resolvePendingContactCompanyLink>[0];
			expect(resolvePendingContactCompanyLink(row, pendingCompanyIds)).toBe(row);
		});

		it('should return original row if linked_company_id does not start with prefix', () => {
			const row = { kind: 'person', linked_company_id: 'some-other-id' } as Parameters<
				typeof resolvePendingContactCompanyLink
			>[0];
			expect(resolvePendingContactCompanyLink(row, pendingCompanyIds)).toBe(row);
		});

		it('should return original row if pending key is not in map', () => {
			const row = {
				kind: 'person',
				linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}unknown_company|au`
			} as Parameters<typeof resolvePendingContactCompanyLink>[0];
			expect(resolvePendingContactCompanyLink(row, pendingCompanyIds)).toBe(row);
		});

		it('should resolve linked_company_id and return new object', () => {
			const row = {
				kind: 'person',
				linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}my_company|au`
			} as Parameters<typeof resolvePendingContactCompanyLink>[0];
			const result = resolvePendingContactCompanyLink(row, pendingCompanyIds);
			expect(result).not.toBe(row);
			expect(result.linked_company_id).toBe('resolved-uuid-123');
		});
	});
});
