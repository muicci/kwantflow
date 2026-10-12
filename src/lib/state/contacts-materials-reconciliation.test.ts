import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactFormValues } from '$lib/schemas/index.js';

function buildContactFormValues(
	overrides: Partial<ContactFormValues> & Pick<ContactFormValues, 'name'>
): ContactFormValues {
	return {
		country_code: overrides.country_code ?? 'AU',
		name: overrides.name,
		kind: overrides.kind ?? 'company',
		display_name: overrides.display_name ?? overrides.name,
		company_name: overrides.company_name ?? overrides.name,
		person_first_name: overrides.person_first_name ?? '',
		person_last_name: overrides.person_last_name ?? '',
		role_title: overrides.role_title ?? '',
		linked_company_id: overrides.linked_company_id ?? '',
		is_primary_company_contact: overrides.is_primary_company_contact ?? false,
		contact_name: overrides.contact_name ?? '',
		email: overrides.email ?? '',
		website: overrides.website ?? '',
		phone: overrides.phone ?? '',
		phone_country_code: overrides.phone_country_code ?? 'AU',
		phone_e164: overrides.phone_e164 ?? '',
		abn: overrides.abn ?? '',
		business_id_label: overrides.business_id_label ?? 'ABN',
		business_id_value: overrides.business_id_value ?? '',
		tax_id_label: overrides.tax_id_label ?? 'GST',
		tax_id_value: overrides.tax_id_value ?? '',
		address: overrides.address ?? '',
		notes: overrides.notes ?? '',
		custom_role_label: overrides.custom_role_label ?? '',
		roles: overrides.roles ?? ['customer'],
		tags: overrides.tags ?? [],
		is_active: overrides.is_active ?? true
	};
}

const dbServiceMock = {
	getContactById: vi.fn(),
	addContact: vi.fn(),
	updateContact: vi.fn(),
	deleteContact: vi.fn(),
	reorderContacts: vi.fn(),
	getProjects: vi.fn(),
	getContacts: vi.fn(),
	replaceCompanyCatalogueLinks: vi.fn(),
	getMaterialCatalogueItemById: vi.fn(),
	addMaterialCatalogueItem: vi.fn(),
	updateMaterialCatalogueItem: vi.fn(),
	deleteMaterialCatalogueItem: vi.fn(),
	getMaterialCatalogueItems: vi.fn(),
	replaceCatalogueRecordCompanyLinks: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const toastMock = {
	success: vi.fn(),
	warning: vi.fn()
};

vi.mock('../services/db', () => ({
	dbService: dbServiceMock
}));

vi.mock('./errors.svelte', () => ({
	errorState: errorStateMock
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('../utils/env', () => ({
	isTauri: () => false
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

describe('contact and material reconciliation', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('patches contacts in place after add, update, archive, and restore without refreshing the full list', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'customer-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				country_code: 'AU',
				name: 'Acme',
				contact_name: 'Alex',
				email: 'alex@acme.test',
				phone: null,
				phone_country_code: 'AU',
				phone_e164: null,
				abn: null,
				business_id_label: 'ABN',
				business_id_value: null,
				tax_id_label: 'GST',
				tax_id_value: null,
				address: null,
				notes: null,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'person-1',
				workspace_id: 'owner-1',
				sort_order: 1,
				kind: 'person',
				display_name: 'Alex Buyer',
				country_code: 'AU',
				name: 'Alex Buyer',
				company_name: '',
				person_first_name: 'Alex',
				person_last_name: 'Buyer',
				role_title: 'Buyer',
				linked_company_id: 'customer-1',
				is_primary_company_contact: true,
				contact_name: '',
				email: 'alex@acme.test',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'customer-2',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'company',
			display_name: 'Bravo',
			country_code: 'AU',
			name: 'Bravo',
			company_name: 'Bravo',
			person_first_name: '',
			person_last_name: '',
			role_title: '',
			linked_company_id: null,
			is_primary_company_contact: false,
			contact_name: '',
			email: '',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'ABN',
			business_id_value: '',
			tax_id_label: 'GST',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z'
		});
		await contactsState.addContact(
			buildContactFormValues({
				name: 'Bravo',
				business_id_label: 'ABN',
				tax_id_label: 'GST'
			})
		);

		expect(contactsState.list.map((contact) => contact.id)).toEqual([
			'customer-1',
			'person-1',
			'customer-2'
		]);
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'customer-1',
			workspace_id: 'owner-1',
			sort_order: 0,
			kind: 'company',
			display_name: 'Acme Updated',
			country_code: 'AU',
			name: 'Acme Updated',
			company_name: 'Acme Updated',
			person_first_name: '',
			person_last_name: '',
			role_title: '',
			linked_company_id: null,
			is_primary_company_contact: false,
			contact_name: 'Alex',
			email: 'alex@acme.test',
			phone: null,
			phone_country_code: 'AU',
			phone_e164: null,
			abn: null,
			business_id_label: 'ABN',
			business_id_value: null,
			tax_id_label: 'GST',
			tax_id_value: null,
			address: null,
			notes: null,
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await contactsState.updateContact(
			'customer-1',
			buildContactFormValues({
				name: 'Acme Updated',
				contact_name: 'Alex',
				email: 'alex@acme.test',
				business_id_label: 'ABN',
				tax_id_label: 'GST'
			})
		);

		expect(contactsState.list[0]?.name).toBe('Acme Updated');
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'customer-2',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'company',
			display_name: 'Bravo',
			country_code: 'AU',
			name: 'Bravo',
			company_name: 'Bravo',
			person_first_name: '',
			person_last_name: '',
			role_title: '',
			linked_company_id: null,
			is_primary_company_contact: false,
			contact_name: '',
			email: '',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'ABN',
			business_id_value: '',
			tax_id_label: 'GST',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: false,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:03:00.000Z'
		});
		await contactsState.archiveCompany('customer-2');

		expect(contactsState.list.find((contact) => contact.id === 'customer-2')?.is_active).toBe(
			false
		);
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'customer-2',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'company',
			display_name: 'Bravo',
			country_code: 'AU',
			name: 'Bravo',
			company_name: 'Bravo',
			person_first_name: '',
			person_last_name: '',
			role_title: '',
			linked_company_id: null,
			is_primary_company_contact: false,
			contact_name: '',
			email: '',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'ABN',
			business_id_value: '',
			tax_id_label: 'GST',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:04:00.000Z'
		});
		await contactsState.restoreCompany('customer-2');

		expect(contactsState.list.find((contact) => contact.id === 'customer-2')?.is_active).toBe(true);
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'person-1',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'person',
			display_name: 'Alex Buyer',
			country_code: 'AU',
			name: 'Alex Buyer',
			company_name: '',
			person_first_name: 'Alex',
			person_last_name: 'Buyer',
			role_title: 'Buyer',
			linked_company_id: 'customer-1',
			is_primary_company_contact: false,
			contact_name: '',
			email: 'alex@acme.test',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'ABN',
			business_id_value: '',
			tax_id_label: 'GST',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: false,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:05:00.000Z'
		});
		await contactsState.archivePerson('person-1');

		expect(contactsState.list.find((contact) => contact.id === 'person-1')).toMatchObject({
			is_active: false,
			is_primary_company_contact: false
		});
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'person-1',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'person',
			display_name: 'Alex Buyer',
			country_code: 'AU',
			name: 'Alex Buyer',
			company_name: '',
			person_first_name: 'Alex',
			person_last_name: 'Buyer',
			role_title: 'Buyer',
			linked_company_id: 'customer-1',
			is_primary_company_contact: false,
			contact_name: '',
			email: 'alex@acme.test',
			phone: '',
			phone_country_code: 'AU',
			phone_e164: '',
			abn: '',
			business_id_label: 'ABN',
			business_id_value: '',
			tax_id_label: 'GST',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:06:00.000Z'
		});
		await contactsState.restorePerson('person-1');

		expect(contactsState.list.find((contact) => contact.id === 'person-1')?.is_active).toBe(true);
		expect(dbServiceMock.getContacts).not.toHaveBeenCalled();
	});

	it('routes relationship write failures through the shared error state', async () => {
		const { contactsState } = await import('./contacts.svelte');
		const { materialsState } = await import('./materials.svelte');
		dbServiceMock.replaceCompanyCatalogueLinks.mockRejectedValueOnce(
			new Error('company links failed')
		);
		dbServiceMock.replaceCatalogueRecordCompanyLinks.mockRejectedValueOnce(
			new Error('material links failed')
		);

		await expect(
			contactsState.replaceCompanyCatalogueLinks({
				companyId: 'company-1',
				materialIds: ['material-1'],
				labourRateIds: [],
				equipmentRateIds: [],
				subcontractRateIds: []
			})
		).rejects.toThrow('company links failed');
		await expect(
			materialsState.replaceLinkedCompanies('material-1', ['company-1'])
		).rejects.toThrow('material links failed');

		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Update company catalogue relationships'
		);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Update material company relationships'
		);
	});

	it('deletes people directly and promotes the next active linked person to primary when needed', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'company-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Acme',
				country_code: 'AU',
				name: 'Acme',
				company_name: 'Acme',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'person-primary',
				workspace_id: 'owner-1',
				sort_order: 1,
				kind: 'person',
				display_name: 'Alex Buyer',
				country_code: 'AU',
				name: 'Alex Buyer',
				company_name: '',
				person_first_name: 'Alex',
				person_last_name: 'Buyer',
				role_title: 'Buyer',
				linked_company_id: 'company-1',
				is_primary_company_contact: true,
				contact_name: '',
				email: 'alex@acme.test',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'person-secondary',
				workspace_id: 'owner-1',
				sort_order: 2,
				kind: 'person',
				display_name: 'Jamie Estimator',
				country_code: 'AU',
				name: 'Jamie Estimator',
				company_name: '',
				person_first_name: 'Jamie',
				person_last_name: 'Estimator',
				role_title: 'Estimator',
				linked_company_id: 'company-1',
				is_primary_company_contact: false,
				contact_name: '',
				email: 'jamie@acme.test',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:01:00.000Z',
				updated_at: '2026-03-09T00:01:00.000Z'
			}
		];

		dbServiceMock.getContactById.mockResolvedValueOnce({
			...contactsState.list[2],
			is_primary_company_contact: true,
			updated_at: '2026-03-09T00:02:00.000Z'
		});

		await contactsState.deletePerson('person-primary');

		expect(dbServiceMock.updateContact).toHaveBeenCalledWith(
			'person-secondary',
			expect.objectContaining({
				is_primary_company_contact: true
			})
		);
		expect(dbServiceMock.deleteContact).toHaveBeenCalledWith('person-primary');
		expect(contactsState.list.find((contact) => contact.id === 'person-primary')).toBeUndefined();
		expect(contactsState.list.find((contact) => contact.id === 'person-secondary')).toMatchObject({
			is_primary_company_contact: true
		});
		expect(toastMock.success).toHaveBeenCalledWith('Person "Alex Buyer" deleted');
	});

	it('captures archive-company failures without rethrowing into fire-and-forget UI actions', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'customer-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Acme',
				country_code: 'AU',
				name: 'Acme',
				company_name: 'Acme',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: 'Alex',
				email: 'alex@acme.test',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		const lockError = new Error('database is locked');
		dbServiceMock.updateContact.mockRejectedValueOnce(lockError);

		await expect(contactsState.archiveCompany('customer-1')).resolves.toBeUndefined();

		expect(errorStateMock.catchError).toHaveBeenCalledWith(lockError, 'Archive company Acme');
		expect(contactsState.list.find((contact) => contact.id === 'customer-1')?.is_active).toBe(true);
	});

	it('swallows duplicate contact and material failures after routing them through errorState', async () => {
		const { contactsState } = await import('./contacts.svelte');
		const { materialsState } = await import('./materials.svelte');

		contactsState.list = [
			{
				id: 'contact-duplicate',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Duplicate Co',
				country_code: 'AU',
				name: 'Duplicate Co',
				company_name: 'Duplicate Co',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];
		materialsState.list = [
			{
				id: 'material-duplicate',
				workspace_id: 'owner-1',
				code: 'MAT-001',
				name: 'Duplicate Plate',
				category: 'Plate',
				specification: '',
				unit: 'm2',
				default_rate: 42,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.addContact.mockRejectedValueOnce(new Error('contact duplicate failed'));
		await expect(contactsState.duplicateContact('contact-duplicate')).resolves.toBeUndefined();
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate CRM record contact-duplicate'
		);

		dbServiceMock.addMaterialCatalogueItem.mockRejectedValueOnce(
			new Error('material duplicate failed')
		);
		await expect(materialsState.duplicateMaterial('material-duplicate')).resolves.toBeUndefined();
		expect(errorStateMock.catchError).toHaveBeenCalledWith(
			expect.any(Error),
			'Duplicate material material-duplicate'
		);
	});

	it('only permanently deletes archived companies when they have no linked people or RFQs', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'company-archived',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Archive Ready',
				country_code: 'AU',
				name: 'Archive Ready',
				company_name: 'Archive Ready',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: false,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'company-blocked',
				workspace_id: 'owner-1',
				sort_order: 1,
				kind: 'company',
				display_name: 'Still Blocked',
				country_code: 'AU',
				name: 'Still Blocked',
				company_name: 'Still Blocked',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: false,
				created_at: '2026-03-09T00:01:00.000Z',
				updated_at: '2026-03-09T00:01:00.000Z'
			},
			{
				id: 'person-1',
				workspace_id: 'owner-1',
				sort_order: 2,
				kind: 'person',
				display_name: 'Mia Collins',
				country_code: 'AU',
				name: 'Mia Collins',
				company_name: '',
				person_first_name: 'Mia',
				person_last_name: 'Collins',
				role_title: 'Estimator',
				linked_company_id: 'company-blocked',
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: false,
				created_at: '2026-03-09T00:01:30.000Z',
				updated_at: '2026-03-09T00:01:30.000Z'
			}
		];

		dbServiceMock.getProjects.mockResolvedValueOnce([]);
		await contactsState.deleteArchivedCompany('company-archived');

		expect(dbServiceMock.deleteContact).toHaveBeenCalledWith('company-archived');
		expect(contactsState.list.find((contact) => contact.id === 'company-archived')).toBeUndefined();
		expect(toastMock.success).toHaveBeenCalledWith('Company "Archive Ready" deleted');

		dbServiceMock.getProjects.mockResolvedValueOnce([]);
		await contactsState.deleteArchivedCompany('company-blocked');

		expect(dbServiceMock.deleteContact).toHaveBeenCalledTimes(1);
		expect(errorStateMock.catchError).not.toHaveBeenCalled();
		expect(toastMock.warning).toHaveBeenCalledWith(
			'Company cannot be deleted',
			expect.objectContaining({
				description: expect.stringContaining('linked person')
			})
		);
		expect(contactsState.list.find((contact) => contact.id === 'company-blocked')).toBeDefined();
	});

	it('makes the first active person for a company primary by default and leaves later people non-primary', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'company-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Bangkok Pty Ltd',
				country_code: 'TH',
				name: 'Bangkok Pty Ltd',
				company_name: 'Bangkok Pty Ltd',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'TH',
				phone_e164: '',
				abn: '',
				business_id_label: 'Business ID',
				business_id_value: '',
				tax_id_label: 'Tax ID',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'person-new-1',
			workspace_id: 'owner-1',
			sort_order: 1,
			kind: 'person',
			display_name: 'Harry Potter',
			country_code: 'TH',
			name: 'Harry Potter',
			company_name: '',
			person_first_name: 'Harry',
			person_last_name: 'Potter',
			role_title: 'Estimator',
			linked_company_id: 'company-1',
			is_primary_company_contact: true,
			contact_name: '',
			email: 'harry@bangkok.test',
			phone: '',
			phone_country_code: 'TH',
			phone_e164: '',
			abn: '',
			business_id_label: 'Business ID',
			business_id_value: '',
			tax_id_label: 'Tax ID',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z'
		});

		await contactsState.addContact(
			buildContactFormValues({
				name: 'Harry Potter',
				kind: 'person',
				display_name: 'Harry Potter',
				company_name: '',
				person_first_name: 'Harry',
				person_last_name: 'Potter',
				role_title: 'Estimator',
				linked_company_id: 'company-1',
				country_code: 'TH',
				phone_country_code: 'TH',
				business_id_label: 'Business ID',
				tax_id_label: 'Tax ID',
				is_primary_company_contact: false
			})
		);

		expect(dbServiceMock.addContact).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				linked_company_id: 'company-1',
				is_primary_company_contact: true
			})
		);

		dbServiceMock.getContactById.mockResolvedValueOnce({
			id: 'person-new-2',
			workspace_id: 'owner-1',
			sort_order: 2,
			kind: 'person',
			display_name: 'Hermione Granger',
			country_code: 'TH',
			name: 'Hermione Granger',
			company_name: '',
			person_first_name: 'Hermione',
			person_last_name: 'Granger',
			role_title: 'Buyer',
			linked_company_id: 'company-1',
			is_primary_company_contact: false,
			contact_name: '',
			email: 'hermione@bangkok.test',
			phone: '',
			phone_country_code: 'TH',
			phone_e164: '',
			abn: '',
			business_id_label: 'Business ID',
			business_id_value: '',
			tax_id_label: 'Tax ID',
			tax_id_value: '',
			address: '',
			notes: '',
			roles: ['customer'],
			tags: [],
			is_active: true,
			created_at: '2026-03-09T00:02:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});

		await contactsState.addContact(
			buildContactFormValues({
				name: 'Hermione Granger',
				kind: 'person',
				display_name: 'Hermione Granger',
				company_name: '',
				person_first_name: 'Hermione',
				person_last_name: 'Granger',
				role_title: 'Buyer',
				linked_company_id: 'company-1',
				country_code: 'TH',
				phone_country_code: 'TH',
				business_id_label: 'Business ID',
				tax_id_label: 'Tax ID',
				is_primary_company_contact: false
			})
		);

		expect(dbServiceMock.addContact).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.objectContaining({
				linked_company_id: 'company-1',
				is_primary_company_contact: false
			})
		);
	});

	it('restores contact order locally and swallows the persistence error when manual reorder fails', async () => {
		const { contactsState } = await import('./contacts.svelte');

		contactsState.list = [
			{
				id: 'company-1',
				workspace_id: 'owner-1',
				sort_order: 0,
				kind: 'company',
				display_name: 'Acme Steel',
				country_code: 'AU',
				name: 'Acme Steel',
				company_name: 'Acme Steel',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			},
			{
				id: 'company-2',
				workspace_id: 'owner-1',
				sort_order: 1,
				kind: 'company',
				display_name: 'Beta Fabrication',
				country_code: 'AU',
				name: 'Beta Fabrication',
				company_name: 'Beta Fabrication',
				person_first_name: '',
				person_last_name: '',
				role_title: '',
				linked_company_id: null,
				is_primary_company_contact: false,
				contact_name: '',
				email: '',
				phone: '',
				phone_country_code: 'AU',
				phone_e164: '',
				abn: '',
				business_id_label: 'ABN',
				business_id_value: '',
				tax_id_label: 'GST',
				tax_id_value: '',
				address: '',
				notes: '',
				roles: ['customer'],
				tags: [],
				is_active: true,
				created_at: '2026-03-09T00:01:00.000Z',
				updated_at: '2026-03-09T00:01:00.000Z'
			}
		];

		dbServiceMock.reorderContacts.mockRejectedValueOnce(new Error('reorder failed'));

		await expect(
			contactsState.reorderContacts(['company-2', 'company-1'])
		).resolves.toBeUndefined();

		expect(contactsState.list.map((contact) => contact.id)).toEqual(['company-1', 'company-2']);
		expect(errorStateMock.catchError).toHaveBeenCalledWith(expect.any(Error), 'Reorder contacts');
	});

	it('patches materials in place after add, update, and delete without refreshing the full list', async () => {
		const { materialsState } = await import('./materials.svelte');

		materialsState.list = [
			{
				id: 'material-1',
				workspace_id: 'owner-1',
				code: 'MAT-001',
				name: 'Plate',
				category: 'Steel',
				specification: 'Mild',
				unit: 'ea',
				default_rate: 12,
				metadata: {},
				is_active: true,
				created_at: '2026-03-09T00:00:00.000Z',
				updated_at: '2026-03-09T00:00:00.000Z'
			}
		];

		dbServiceMock.getMaterialCatalogueItemById.mockResolvedValueOnce({
			id: 'material-2',
			workspace_id: 'owner-1',
			code: 'MAT-002',
			name: 'Angle',
			category: 'Steel',
			specification: 'Galv',
			unit: 'ea',
			default_rate: 18,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:01:00.000Z',
			updated_at: '2026-03-09T00:01:00.000Z'
		});
		await materialsState.addMaterial({
			code: 'MAT-002',
			name: 'Angle',
			aliases: [],
			category: 'Steel',
			specification: 'Galv',
			unit: 'ea',
			default_rate: 18,
			is_active: true
		});

		expect(materialsState.list.map((item) => item.id)).toEqual(['material-2', 'material-1']);
		expect(dbServiceMock.getMaterialCatalogueItems).not.toHaveBeenCalled();

		dbServiceMock.getMaterialCatalogueItemById.mockResolvedValueOnce({
			id: 'material-1',
			workspace_id: 'owner-1',
			code: 'MAT-001',
			name: 'Plate Updated',
			category: 'Steel',
			specification: 'Mild',
			unit: 'ea',
			default_rate: 15,
			metadata: {},
			is_active: true,
			created_at: '2026-03-09T00:00:00.000Z',
			updated_at: '2026-03-09T00:02:00.000Z'
		});
		await materialsState.updateMaterial('material-1', {
			code: 'MAT-001',
			name: 'Plate Updated',
			aliases: [],
			category: 'Steel',
			specification: 'Mild',
			unit: 'ea',
			default_rate: 15,
			is_active: true
		});

		expect(materialsState.list.find((item) => item.id === 'material-1')?.name).toBe(
			'Plate Updated'
		);
		expect(dbServiceMock.getMaterialCatalogueItems).not.toHaveBeenCalled();

		await materialsState.deleteMaterial('material-2');

		expect(materialsState.list.map((item) => item.id)).toEqual(['material-1']);
		expect(dbServiceMock.getMaterialCatalogueItems).not.toHaveBeenCalled();
	});
});
