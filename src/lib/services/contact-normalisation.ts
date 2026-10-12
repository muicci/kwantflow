import type { ContactFormValues } from '$lib/schemas/index.js';
import type { Contact, ContactRole } from '$lib/types/index.js';

export const SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX = '__setup_import_company__:';

export const CONTACT_ROLE_OPTIONS = [
	{ value: 'customer', label: 'Customer' },
	{ value: 'subcontractor', label: 'Subcontractor' },
	{ value: 'supplier', label: 'Supplier' },
	{ value: 'vendor', label: 'Vendor' },
	{ value: 'manufacturer', label: 'Manufacturer' }
] as const satisfies readonly { value: ContactRole; label: string }[];

export function formatContactRoleLabel(
	contact: Pick<Contact, 'roles' | 'custom_role_label'>
): string {
	const customRole = contact.custom_role_label?.trim();
	if (customRole) return customRole;
	const primaryRole = contact.roles?.[0];
	return CONTACT_ROLE_OPTIONS.find((option) => option.value === primaryRole)?.label ?? 'Not set';
}

export type ContactIdentityInput = {
	[P in keyof ContactFormValues]?: ContactFormValues[P] | null;
} & {
	kind?: ContactFormValues['kind'] | null;
};

export function normaliseContactLookupValue(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

export function deriveContactDisplayName(row: ContactIdentityInput): string {
	return (
		row.display_name?.trim() ||
		row.name?.trim() ||
		row.company_name?.trim() ||
		[row.person_first_name?.trim(), row.person_last_name?.trim()].filter(Boolean).join(' ').trim()
	);
}

export function buildSetupImportPendingContactCompanyKey(input: {
	country_code?: string;
	business_id_value?: string;
	company_name?: string;
	display_name?: string;
	name?: string;
	email?: string;
}): string {
	const companySeed =
		input.company_name?.trim() ||
		input.display_name?.trim() ||
		input.name?.trim() ||
		input.business_id_value?.trim() ||
		input.email?.trim() ||
		'company';
	const companyKey =
		normaliseContactLookupValue(companySeed)
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 64) || 'company';
	const countryKey = normaliseContactLookupValue(input.country_code ?? '') || 'unknown';
	return `${companyKey}|${countryKey}`;
}

export function normaliseContactFormInput(row: ContactIdentityInput): ContactFormValues {
	const displayName = deriveContactDisplayName(row);
	return {
		kind: row.kind ?? 'company',
		country_code: row.country_code ?? '',
		display_name: displayName,
		name: displayName,
		company_name: row.company_name ?? row.name ?? '',
		person_first_name: row.person_first_name ?? '',
		person_last_name: row.person_last_name ?? '',
		role_title: row.role_title ?? '',
		linked_company_id: row.linked_company_id ?? '',
		is_primary_company_contact: row.is_primary_company_contact ?? false,
		contact_name: row.contact_name ?? '',
		email: row.email ?? '',
		website: row.website ?? '',
		phone: row.phone ?? '',
		phone_country_code: row.phone_country_code ?? row.country_code ?? '',
		phone_e164: row.phone_e164 ?? '',
		abn: row.abn ?? '',
		business_id_label: row.business_id_label ?? 'Business ID',
		business_id_value: row.business_id_value ?? '',
		tax_id_label: row.tax_id_label ?? 'Tax ID',
		tax_id_value: row.tax_id_value ?? '',
		address: row.address ?? '',
		notes: row.notes ?? '',
		logo_file_path: row.logo_file_path ?? '',
		custom_role_label: row.custom_role_label ?? '',
		roles: row.roles ?? [],
		tags: row.tags ?? [],
		is_active: row.is_active ?? true
	};
}

export function resolvePendingContactCompanyLink<T extends ContactFormValues>(
	row: T,
	pendingCompanyIds: Pick<Map<string, string>, 'get'>
): T {
	if (
		row.kind !== 'person' ||
		!row.linked_company_id ||
		!row.linked_company_id.startsWith(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX)
	) {
		return row;
	}

	const pendingKey = row.linked_company_id.slice(
		SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX.length
	);
	const resolvedCompanyId = pendingCompanyIds.get(pendingKey);
	if (!resolvedCompanyId) return row;

	return {
		...row,
		linked_company_id: resolvedCompanyId
	};
}
