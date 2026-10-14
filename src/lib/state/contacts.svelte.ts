import { SvelteMap } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';

import { dbService } from '../services/db';
import { createLogger } from '../services/logger.js';
import { errorState } from './errors.svelte';
import type { Contact } from '$lib/types/index.js';
import type { ContactFormValues } from '$lib/schemas/index.js';
import { buildDuplicateName } from '$lib/utils/duplicate-records.js';
import { buildMergedManualOrderIds } from '$lib/utils/manual-order.js';
import {
	buildSetupImportPendingContactCompanyKey,
	normaliseContactFormInput,
	normaliseContactLookupValue,
	resolvePendingContactCompanyLink
} from '$lib/services/contact-normalisation.js';
import { type SetupImportDuplicateMode } from '$lib/services/setup-import.js';
import {
	getAppLocalFileUrl as getAssetLocalFileUrl,
	getVaultImagePreviewUrl as getAssetVaultPreviewUrl,
	storeCompanyLogo as storeAssetCompanyLogo,
	removeVaultFile as removeAssetVaultFile
} from '$lib/services/assets.js';
import { formatPhoneDraft as formatPhoneDraftService } from '$lib/services/phone.js';

type ImportSummary = {
	created: number;
	updated: number;
	skipped: number;
};

type ContactInput = ContactFormValues;
type ContactSeed = ContactInput | Contact;

class ContactDeleteBlockedError extends Error {}

const log = createLogger('contactsState');

function normaliseLookupValue(value: string | null | undefined): string {
	return normaliseContactLookupValue(value);
}

function getContactDisplayName(contact: Pick<Contact, 'display_name' | 'name'>): string {
	return contact.display_name?.trim() || contact.name.trim();
}

function getRecordLabel(input: Pick<ContactSeed, 'kind'>): 'Company' | 'Person' {
	return input.kind === 'person' ? 'Person' : 'Company';
}

function getScopedPersonName(
	contact: Pick<ContactSeed, 'display_name' | 'name' | 'person_first_name' | 'person_last_name'>
): string {
	return (
		contact.display_name?.trim() ||
		contact.name?.trim() ||
		[contact.person_first_name?.trim(), contact.person_last_name?.trim()]
			.filter(Boolean)
			.join(' ')
			.trim()
	);
}

function getComparableContactEmail(contact: Pick<ContactSeed, 'email'>): string {
	return normaliseLookupValue(contact.email);
}

function getComparableBusinessId(contact: Pick<ContactSeed, 'business_id_value'>): string {
	return normaliseLookupValue(contact.business_id_value);
}

function normaliseContactInput(row: ContactSeed): ContactFormValues {
	return normaliseContactFormInput(row);
}

function buildImportToast(summary: ImportSummary): string {
	if (summary.updated === 0 && summary.skipped === 0) {
		return `Imported ${summary.created} compan${summary.created === 1 ? 'y/contact record' : 'y/contact records'}`;
	}

	const parts: string[] = [];
	if (summary.created > 0) parts.push(`${summary.created} imported`);
	if (summary.updated > 0) parts.push(`${summary.updated} updated`);
	if (summary.skipped > 0) parts.push(`${summary.skipped} kept existing`);
	return `Company import complete: ${parts.join(' · ')}`;
}

const contactDbService = dbService as typeof dbService & {
	getContacts?: () => Promise<Contact[]>;
	getContactById?: (id: string) => Promise<Contact | null>;
	addContact?: (id: string, data: ContactInput) => Promise<void>;
	updateContact?: (id: string, data: ContactInput) => Promise<void>;
	deleteContact?: (id: string) => Promise<void>;
	getProjects?: () => Promise<Array<{ contact_id: string | null }>>;
};

async function getContactsCompat(): Promise<Contact[]> {
	if (typeof contactDbService.getContacts === 'function') {
		return contactDbService.getContacts();
	}
	throw new Error('dbService.getContacts is required for contactsState');
}

async function getContactByIdCompat(id: string): Promise<Contact | null> {
	if (typeof contactDbService.getContactById === 'function') {
		return contactDbService.getContactById(id);
	}
	throw new Error('dbService.getContactById is required for contactsState');
}

async function addContactCompat(id: string, data: ContactInput): Promise<void> {
	if (typeof contactDbService.addContact === 'function') {
		return contactDbService.addContact(id, data);
	}
	throw new Error('dbService.addContact is required for contactsState');
}

async function updateContactCompat(id: string, data: ContactInput): Promise<void> {
	if (typeof contactDbService.updateContact === 'function') {
		return contactDbService.updateContact(id, data);
	}
	throw new Error('dbService.updateContact is required for contactsState');
}

async function deleteContactCompat(id: string): Promise<void> {
	if (typeof contactDbService.deleteContact === 'function') {
		return contactDbService.deleteContact(id);
	}
	throw new Error('dbService.deleteContact is required for contactsState');
}

async function setContactActiveState(
	id: string,
	nextState: boolean,
	contacts: Contact[],
	onUpsert: (contact: Contact) => void,
	onRefresh: () => Promise<void>
): Promise<Contact | null> {
	const current = contacts.find((contact) => contact.id === id);
	if (!current) {
		throw new Error('Contact not found');
	}

	await updateContactCompat(id, {
		...normaliseContactInput(current),
		is_active: nextState
	});
	const updatedContact = await getContactByIdCompat(id);
	if (updatedContact) {
		onUpsert(updatedContact);
		return updatedContact;
	}
	await onRefresh();
	return null;
}

class ContactsState {
	private upsertContact(nextContact: Contact): void {
		const index = this.list.findIndex((contact) => contact.id === nextContact.id);
		if (index === -1) {
			this.list = [...this.list, nextContact];
			return;
		}

		this.list = this.list.map((contact, currentIndex) =>
			currentIndex === index ? nextContact : contact
		);
	}

	private removeContacts(ids: string[]): void {
		const removedIds = new Set(ids);
		this.list = this.list.filter((contact) => !removedIds.has(contact.id));
	}

	private async getArchivedCompanyDeleteImpact(
		id: string
	): Promise<{ linkedPeopleCount: number; linkedRfqCount: number }> {
		const linkedPeopleCount = this.getLinkedPeople(id, true).length;
		const linkedRfqCount =
			typeof contactDbService.getProjects === 'function'
				? (await contactDbService.getProjects()).filter((project) => project.contact_id === id)
						.length
				: 0;

		return { linkedPeopleCount, linkedRfqCount };
	}

	private async deleteArchivedCompanyInternal(id: string): Promise<Contact> {
		const company = this.list.find((contact) => contact.id === id && contact.kind === 'company');
		if (!company) {
			throw new Error('Company not found');
		}
		if (company.is_active !== false) {
			throw new Error('Archive the company before permanently deleting it.');
		}

		const impact = await this.getArchivedCompanyDeleteImpact(id);
		if (impact.linkedPeopleCount > 0 || impact.linkedRfqCount > 0) {
			const linkedPeopleLabel = `${impact.linkedPeopleCount} linked ${impact.linkedPeopleCount === 1 ? 'person' : 'people'}`;
			const linkedRfqLabel = `${impact.linkedRfqCount} linked RFQ${impact.linkedRfqCount === 1 ? '' : 's'}`;
			const blockers = [
				impact.linkedPeopleCount > 0 ? linkedPeopleLabel : '',
				impact.linkedRfqCount > 0 ? linkedRfqLabel : ''
			]
				.filter(Boolean)
				.join(' and ');
			throw new ContactDeleteBlockedError(
				`Remove or reassign ${blockers} before deleting this archived company.`
			);
		}

		await deleteContactCompat(id);
		this.removeContacts([id]);
		return company;
	}

	private async deletePersonInternal(id: string): Promise<Contact> {
		const person = this.list.find((contact) => contact.id === id && contact.kind === 'person');
		if (!person) {
			throw new Error('Person not found');
		}

		const linkedCompanyId = person.linked_company_id ?? null;
		const replacementPrimaryContact =
			person.is_primary_company_contact && linkedCompanyId
				? (this.getLinkedPeople(linkedCompanyId).find(
						(contact) => contact.id !== id && contact.is_active !== false
					) ?? null)
				: null;

		if (replacementPrimaryContact) {
			await updateContactCompat(replacementPrimaryContact.id, {
				...normaliseContactInput(replacementPrimaryContact),
				is_primary_company_contact: true
			});
			const updatedReplacement = await getContactByIdCompat(replacementPrimaryContact.id);
			if (updatedReplacement) {
				this.upsertContact(updatedReplacement);
			}
		}

		await deleteContactCompat(id);
		this.removeContacts([id]);
		return person;
	}

	findMatchingContact(row: ContactInput, excludeId?: string): Contact | null {
		const normalizedRow = normaliseContactInput(row);
		const candidates = this.list.filter((contact) => contact.id !== excludeId);

		if (normalizedRow.kind === 'person') {
			const linkedCompanyId = normalizedRow.linked_company_id?.trim() ?? '';
			const personEmail = getComparableContactEmail(normalizedRow);
			const personName = normaliseLookupValue(getScopedPersonName(normalizedRow));

			return (
				candidates.find((contact) => {
					if ((contact.kind ?? 'person') !== 'person') return false;
					if ((contact.linked_company_id ?? '') !== linkedCompanyId) return false;
					if (personEmail && getComparableContactEmail(contact) === personEmail) return true;
					return (
						personName.length > 0 &&
						normaliseLookupValue(getScopedPersonName(contact)) === personName
					);
				}) ?? null
			);
		}

		const businessId = getComparableBusinessId(normalizedRow);
		const companyEmail = getComparableContactEmail(normalizedRow);
		const companyName = normaliseLookupValue(getContactDisplayName(normalizedRow));

		return (
			candidates.find((contact) => {
				if ((contact.kind ?? 'company') !== 'company') return false;
				if (businessId && getComparableBusinessId(contact) === businessId) return true;
				if (companyEmail && getComparableContactEmail(contact) === companyEmail) return true;
				return (
					companyName.length > 0 &&
					normaliseLookupValue(getContactDisplayName(contact)) === companyName
				);
			}) ?? null
		);
	}

	list: Contact[] = $state([]);
	searchQuery: string = $state('');
	activeKindFilter: 'all' | 'companies' | 'people' = $state('all');

	filtered: Contact[] = $derived.by(() => {
		const q = this.searchQuery.toLowerCase().trim();
		return this.list.filter((contact) => {
			const matchesKind =
				this.activeKindFilter === 'all' ||
				(this.activeKindFilter === 'companies' && contact.kind === 'company') ||
				(this.activeKindFilter === 'people' && contact.kind === 'person');
			if (!matchesKind) return false;
			if (!q) return true;
			return [
				getContactDisplayName(contact),
				contact.company_name ?? '',
				contact.person_first_name ?? '',
				contact.person_last_name ?? '',
				contact.contact_name ?? '',
				contact.email ?? '',
				contact.role_title ?? '',
				contact.custom_role_label ?? '',
				(contact.roles ?? []).join(' ')
			]
				.map((value) => value.toLowerCase())
				.some((value) => value.includes(q));
		});
	});

	companyContacts: Contact[] = $derived(
		this.list.filter((contact) => contact.kind === 'company' && contact.is_active !== false)
	);

	companies: Contact[] = $derived(this.companyContacts);
	allCompanies: Contact[] = $derived(this.list.filter((contact) => contact.kind === 'company'));
	archivedCompanies: Contact[] = $derived(
		this.allCompanies.filter((contact) => contact.is_active === false)
	);

	names: string[] = $derived(this.list.map((contact) => getContactDisplayName(contact)));

	getLinkedPeople(companyId: string, includeArchived = false): Contact[] {
		return this.list.filter(
			(contact) =>
				contact.kind === 'person' &&
				contact.linked_company_id === companyId &&
				(includeArchived || contact.is_active !== false)
		);
	}

	async hydrate(): Promise<void> {
		try {
			this.list = await getContactsCompat();
		} catch (error) {
			log.error('Failed to hydrate', error);
		}
	}

	reset(): void {
		this.list = [];
		this.searchQuery = '';
		this.activeKindFilter = 'all';
	}

	async refresh(): Promise<void> {
		try {
			this.list = await getContactsCompat();
		} catch (error) {
			log.error('Failed to refresh', error);
		}
	}

	async replaceCompanyCatalogueLinks(input: {
		companyId: string;
		materialIds: string[];
		labourRateIds: string[];
		equipmentRateIds: string[];
		subcontractRateIds: string[];
	}): Promise<void> {
		try {
			await dbService.replaceCompanyCatalogueLinks(input);
		} catch (error) {
			await errorState.catchError(error, 'Update company catalogue relationships');
			throw error;
		}
	}

	async addContact(data: ContactInput): Promise<Contact | null> {
		try {
			const payload = normaliseContactInput(data);
			const linkedCompanyId = payload.linked_company_id?.trim() ?? '';
			const nextPayload =
				payload.kind === 'person' &&
				linkedCompanyId.length > 0 &&
				payload.is_primary_company_contact !== true &&
				this.getLinkedPeople(linkedCompanyId).length === 0
					? {
							...payload,
							linked_company_id: linkedCompanyId,
							is_primary_company_contact: true
						}
					: payload;
			const recordLabel = getRecordLabel(payload);
			const id = crypto.randomUUID();
			await addContactCompat(id, nextPayload);
			const createdContact = await getContactByIdCompat(id);
			if (createdContact) {
				this.upsertContact(createdContact);
			} else {
				await this.refresh();
			}
			toast.success(`${recordLabel} ${nextPayload.display_name || nextPayload.name} created`);
			return createdContact;
		} catch (error) {
			const payload = normaliseContactInput(data);
			await errorState.catchError(
				error,
				`Create ${getRecordLabel(payload)} ${payload.display_name || payload.name}`
			);
			return null;
		}
	}

	async updateContact(id: string, data: ContactInput): Promise<Contact | null> {
		try {
			const payload = normaliseContactInput(data);
			const recordLabel = getRecordLabel(payload);
			await updateContactCompat(id, payload);
			const updatedContact = await getContactByIdCompat(id);
			if (updatedContact) {
				this.upsertContact(updatedContact);
			} else {
				await this.refresh();
			}
			toast.success(`${recordLabel} "${payload.display_name || payload.name}" updated`);
			return updatedContact;
		} catch (error) {
			const payload = normaliseContactInput(data);
			await errorState.catchError(
				error,
				`Update ${getRecordLabel(payload).toLowerCase()} "${payload.display_name || payload.name}"`
			);
			return null;
		}
	}

	async duplicateContact(id: string): Promise<void> {
		try {
			const current = this.list.find((contact) => contact.id === id);
			if (!current) throw new Error('Contact not found');
			const recordLabel = getRecordLabel(current);

			const nextId = crypto.randomUUID();
			const displayName = buildDuplicateName(
				getContactDisplayName(current),
				this.list
					.filter((contact) => contact.id !== id)
					.map((contact) => getContactDisplayName(contact))
			);
			const duplicatePayload: ContactFormValues = {
				kind: current.kind ?? 'company',
				country_code: current.country_code,
				display_name: displayName,
				name: displayName,
				company_name: current.kind === 'company' ? displayName : (current.company_name ?? ''),
				person_first_name: current.person_first_name ?? '',
				person_last_name: current.person_last_name ?? '',
				role_title: current.role_title ?? '',
				linked_company_id: current.linked_company_id ?? '',
				is_primary_company_contact: current.is_primary_company_contact ?? false,
				contact_name: current.contact_name ?? '',
				email: current.email ?? '',
				website: current.website ?? '',
				phone: current.phone ?? '',
				phone_country_code: current.phone_country_code ?? current.country_code,
				phone_e164: '',
				abn: '',
				business_id_label: current.business_id_label ?? 'Business ID',
				business_id_value: '',
				tax_id_label: current.tax_id_label ?? 'Tax ID',
				tax_id_value: current.tax_id_value ?? '',
				address: current.address ?? '',
				notes: current.notes ?? '',
				custom_role_label: current.custom_role_label ?? '',
				roles: current.roles ?? ['customer'],
				tags: current.tags ?? [],
				is_active: current.is_active ?? true
			};
			await addContactCompat(nextId, duplicatePayload);
			const duplicatedContact = await getContactByIdCompat(nextId);
			if (duplicatedContact) {
				this.upsertContact(duplicatedContact);
			} else {
				await this.refresh();
			}
			toast.success(`${recordLabel} "${getContactDisplayName(current)}" duplicated`);
		} catch (error) {
			await errorState.catchError(error, `Duplicate CRM record ${id}`);
		}
	}

	async reorderContacts(visibleOrderedIds: string[]): Promise<void> {
		const previousList = [...this.list];
		try {
			const nextIds = buildMergedManualOrderIds(
				this.list.map((contact) => contact.id),
				visibleOrderedIds
			);
			const byId = new Map(this.list.map((contact) => [contact.id, contact] as const));
			this.list = nextIds.map((contactId) => byId.get(contactId)!).filter(Boolean);
			await dbService.reorderContacts(nextIds);
		} catch (error) {
			this.list = previousList;
			await errorState.catchError(error, 'Reorder contacts');
		}
	}

	async archiveCompany(id: string): Promise<void> {
		const company = this.list.find((contact) => contact.id === id && contact.kind === 'company');
		if (!company) {
			throw new Error('Company not found');
		}

		try {
			await setContactActiveState(id, false, this.list, this.upsertContact.bind(this), () =>
				this.refresh()
			);
			toast.success(`Company "${getContactDisplayName(company)}" archived`);
		} catch (error) {
			await errorState.catchError(error, `Archive company ${getContactDisplayName(company)}`);
		}
	}

	async restoreCompany(id: string): Promise<void> {
		const company = this.list.find((contact) => contact.id === id && contact.kind === 'company');
		if (!company) {
			throw new Error('Company not found');
		}

		try {
			await setContactActiveState(id, true, this.list, this.upsertContact.bind(this), () =>
				this.refresh()
			);
			toast.success(`Company "${getContactDisplayName(company)}" restored`);
		} catch (error) {
			await errorState.catchError(error, `Restore company ${getContactDisplayName(company)}`);
		}
	}

	async deleteArchivedCompany(id: string): Promise<void> {
		const company = this.list.find((contact) => contact.id === id && contact.kind === 'company');
		const companyLabel = company ? getContactDisplayName(company) : id;

		try {
			const deletedCompany = await this.deleteArchivedCompanyInternal(id);
			toast.success(`Company "${getContactDisplayName(deletedCompany)}" deleted`);
		} catch (error) {
			if (error instanceof ContactDeleteBlockedError) {
				toast.warning('Company cannot be deleted', { description: error.message });
				return;
			}
			await errorState.catchError(error, `Delete company ${companyLabel}`, undefined, {
				description: error instanceof Error ? error.message : String(error)
			});
		}
	}

	async archivePerson(id: string): Promise<void> {
		const person = this.list.find((contact) => contact.id === id && contact.kind === 'person');
		if (!person) {
			throw new Error('Person not found');
		}

		try {
			await updateContactCompat(id, {
				...normaliseContactInput(person),
				is_active: false,
				is_primary_company_contact: false
			});
			const updatedPerson = await getContactByIdCompat(id);
			if (updatedPerson) {
				this.upsertContact(updatedPerson);
			} else {
				await this.refresh();
			}
			toast.success(`Person "${getContactDisplayName(person)}" archived`);
		} catch (error) {
			await errorState.catchError(error, `Archive person ${getContactDisplayName(person)}`);
		}
	}

	async restorePerson(id: string): Promise<void> {
		const person = this.list.find((contact) => contact.id === id && contact.kind === 'person');
		if (!person) {
			throw new Error('Person not found');
		}

		try {
			await setContactActiveState(id, true, this.list, this.upsertContact.bind(this), () =>
				this.refresh()
			);
			toast.success(`Person "${getContactDisplayName(person)}" restored`);
		} catch (error) {
			await errorState.catchError(error, `Restore person ${getContactDisplayName(person)}`);
		}
	}

	async deletePerson(id: string): Promise<void> {
		const person = this.list.find((contact) => contact.id === id && contact.kind === 'person');
		const personLabel = person ? getContactDisplayName(person) : id;

		try {
			const deletedPerson = await this.deletePersonInternal(id);
			toast.success(`Person "${getContactDisplayName(deletedPerson)}" deleted`);
		} catch (error) {
			await errorState.catchError(error, `Delete person ${personLabel}`, undefined, {
				description: error instanceof Error ? error.message : String(error)
			});
		}
	}

	async setPrimaryCompanyPerson(companyId: string, personId: string): Promise<void> {
		const linkedPeople = this.getLinkedPeople(companyId, true);
		const targetPerson = linkedPeople.find((contact) => contact.id === personId);
		if (!targetPerson || targetPerson.is_active === false) {
			throw new Error('Active linked person not found');
		}

		try {
			for (const person of linkedPeople) {
				await updateContactCompat(person.id, {
					...normaliseContactInput(person),
					is_primary_company_contact: person.is_active !== false && person.id === personId
				});
				const updatedPerson = await getContactByIdCompat(person.id);
				if (updatedPerson) {
					this.upsertContact(updatedPerson);
				}
			}
			toast.success(`Primary contact set to ${getContactDisplayName(targetPerson)}`);
		} catch (error) {
			await errorState.catchError(error, `Set primary contact for company ${companyId}`);
		}
	}

	async bulkArchiveCompanies(ids: string[]): Promise<void> {
		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const companiesById = new Map();
			for (const contact of this.list) {
				if (contact.kind === 'company') {
					companiesById.set(contact.id, contact);
				}
			}
			await Promise.all(
				ids.map(async (id) => {
					const company = companiesById.get(id);
					if (!company) return;
					await updateContactCompat(id, {
						...normaliseContactInput(company),
						is_active: false
					});
					const updatedCompany = await getContactByIdCompat(id);
					if (updatedCompany) {
						this.upsertContact(updatedCompany);
					}
				})
			);
			toast.success(`Successfully archived ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk archive (${ids.length} companies)`);
		}
	}

	async bulkRestoreCompanies(ids: string[]): Promise<void> {
		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const companiesById = new Map();
			for (const contact of this.list) {
				if (contact.kind === 'company') {
					companiesById.set(contact.id, contact);
				}
			}
			await Promise.all(
				ids.map(async (id) => {
					const company = companiesById.get(id);
					if (!company) return;
					await updateContactCompat(id, {
						...normaliseContactInput(company),
						is_active: true
					});
					const updatedCompany = await getContactByIdCompat(id);
					if (updatedCompany) {
						this.upsertContact(updatedCompany);
					}
				})
			);
			toast.success(`Successfully restored ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`);
		} catch (error) {
			await errorState.catchError(error, `Bulk restore (${ids.length} companies)`);
		}
	}

	async bulkDeleteArchivedCompanies(ids: string[]): Promise<void> {
		try {
			let deletedCount = 0;
			await Promise.all(
				ids.map(async (id) => {
					await this.deleteArchivedCompanyInternal(id);
					deletedCount += 1;
				})
			);
			if (deletedCount > 0) {
				toast.success(
					`Successfully deleted ${deletedCount} compan${deletedCount === 1 ? 'y' : 'ies'}`
				);
			}
		} catch (error) {
			if (error instanceof ContactDeleteBlockedError) {
				toast.warning('Companies cannot be deleted', { description: error.message });
				return;
			}
			await errorState.catchError(error, `Bulk delete (${ids.length} companies)`, undefined, {
				description: error instanceof Error ? error.message : String(error)
			});
		}
	}

	async importContacts(
		rows: ContactInput[],
		mode: SetupImportDuplicateMode = 'keep_existing',
		options: { feedback?: boolean } = {}
	): Promise<ImportSummary> {
		const feedback = options.feedback !== false;
		const summary: ImportSummary = { created: 0, updated: 0, skipped: 0 };
		const pendingCompanyIds = new SvelteMap<string, string>();
		try {
			for (const row of rows) {
				const resolvedRow = resolvePendingContactCompanyLink(
					normaliseContactInput(row),
					pendingCompanyIds
				);
				const payload = resolvedRow;
				const existingContact = this.findMatchingContact(payload);
				if (existingContact) {
					if (payload.kind === 'company') {
						pendingCompanyIds.set(
							buildSetupImportPendingContactCompanyKey(payload),
							existingContact.id
						);
					}
					if (mode === 'keep_existing') {
						summary.skipped += 1;
						continue;
					}

					await updateContactCompat(existingContact.id, payload);
					const updatedContact = await getContactByIdCompat(existingContact.id);
					if (updatedContact) {
						this.upsertContact(updatedContact);
					} else {
						await this.refresh();
					}
					if (payload.kind === 'company') {
						pendingCompanyIds.set(
							buildSetupImportPendingContactCompanyKey(payload),
							existingContact.id
						);
					}
					summary.updated += 1;
					continue;
				}

				const id = crypto.randomUUID();
				await addContactCompat(id, payload);
				const createdContact = await getContactByIdCompat(id);
				if (createdContact) {
					this.upsertContact(createdContact);
				} else {
					await this.refresh();
				}
				if (payload.kind === 'company') {
					pendingCompanyIds.set(buildSetupImportPendingContactCompanyKey(payload), id);
				}
				summary.created += 1;
			}
			if (feedback) {
				toast.success(buildImportToast(summary));
			}
			return summary;
		} catch (error) {
			if (feedback) {
				await errorState.catchError(error, `Import ${rows.length} companies and people`);
			}
			throw error;
		}
	}

	// ── Asset and formatting wrappers (Three-Layer Law compliance) ──

	/** Get a browser-usable URL for a local file path inside the vault. */
	async getAppLocalFileUrl(relativePath: string): Promise<string> {
		return getAssetLocalFileUrl(relativePath);
	}

	/** Get a preview URL for an image stored in the vault. */
	async getVaultImagePreviewUrl(filePath: string): Promise<string> {
		return getAssetVaultPreviewUrl(filePath);
	}

	/** Store a company logo from a staged file path into the vault. */
	async storeCompanyLogo(
		workspaceId: string,
		companyId: string,
		sourcePath: string
	): Promise<string> {
		return storeAssetCompanyLogo(workspaceId, companyId, sourcePath);
	}

	/** Remove a vault file (logo cleanup workflow). */
	async removeVaultFile(filePath: string): Promise<void> {
		return removeAssetVaultFile(filePath);
	}

	/** Format a phone number for display in the dialog. */
	formatPhoneDraft(phone: string, countryCode?: string | null): string {
		return formatPhoneDraftService(phone, countryCode ?? undefined);
	}
}

export const contactsState = new ContactsState();
