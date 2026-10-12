type ContactLookup = {
	id: string;
	display_name?: string;
	name: string;
	contact_name?: string | null;
	email?: string | null;
	is_primary_company_contact?: boolean | null;
};

function getLookupDisplayName(contact: ContactLookup): string {
	return contact.display_name?.trim() || contact.name;
}

function buildLookupLink(contacts: ContactLookup[], value: string) {
	const trimmedName = value.trim().replace(/\s+/g, ' ');
	if (!trimmedName) {
		return {
			contactId: null,
			contactName: '',
			contactNameSnapshot: null,
			shouldCreateContact: false
		};
	}

	const normalizedName = normaliseContactName(trimmedName);
	const match = contacts.find(
		(contact) => normaliseContactName(getLookupDisplayName(contact)) === normalizedName
	);
	if (match) {
		return {
			contactId: match.id,
			contactName: getLookupDisplayName(match),
			contactNameSnapshot: getLookupDisplayName(match),
			shouldCreateContact: false
		};
	}

	return {
		contactId: null,
		contactName: trimmedName,
		contactNameSnapshot: trimmedName,
		shouldCreateContact: true
	};
}

function filterLookupContacts(contacts: ContactLookup[], query: string): ContactLookup[] {
	const normalizedQuery = normaliseContactName(query);
	if (!normalizedQuery) return contacts;

	return contacts.filter((contact) =>
		[getLookupDisplayName(contact), contact.contact_name ?? '', contact.email ?? '']
			.map((value) => normaliseContactName(value))
			.some((value) => value.includes(normalizedQuery))
	);
}

export function normaliseContactName(value: string | null | undefined): string {
	return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildProjectContactLink(contacts: ContactLookup[], contactName: string) {
	return buildLookupLink(contacts, contactName);
}

export function filterProjectContacts(contacts: ContactLookup[], query: string): ContactLookup[] {
	return filterLookupContacts(contacts, query);
}

export function buildProjectRequesterLink(contacts: ContactLookup[], requesterName: string) {
	return buildLookupLink(contacts, requesterName);
}

export function filterProjectRequesters(contacts: ContactLookup[], query: string): ContactLookup[] {
	return filterLookupContacts(contacts, query);
}

export function getPrimaryProjectRequester(contacts: ContactLookup[]) {
	return contacts.find((contact) => contact.is_primary_company_contact === true) ?? null;
}

export function getProjectContactDisplayName(project: {
	contact_name_snapshot?: string | null;
	contact_name?: string | null;
}) {
	return project.contact_name_snapshot ?? project.contact_name ?? null;
}

export function getProjectCompanyDisplayName(project: {
	contact_name_snapshot?: string | null;
	contact_name?: string | null;
}) {
	return getProjectContactDisplayName(project);
}

export function getProjectRequesterDisplayName(project: {
	requester_name_snapshot?: string | null;
	requester_contact_name?: string | null;
}) {
	return project.requester_name_snapshot ?? project.requester_contact_name ?? null;
}

export async function resolveProjectContactLink({
	contacts,
	contactId,
	contactName,
	findContactByName,
	createContact
}: {
	contacts: ContactLookup[];
	contactId?: string | null;
	contactName?: string | null;
	findContactByName: (name: string) => Promise<ContactLookup | null>;
	createContact: (name: string) => Promise<ContactLookup>;
}) {
	if (contactId) {
		const selectedContact = contacts.find((contact) => contact.id === contactId);
		if (selectedContact) {
			return {
				contactId: selectedContact.id,
				contactNameSnapshot: getLookupDisplayName(selectedContact),
				createdContact: null
			};
		}
	}

	const link = buildProjectContactLink(contacts, contactName ?? '');
	if (!link.shouldCreateContact) {
		return {
			contactId: link.contactId,
			contactNameSnapshot: link.contactNameSnapshot,
			createdContact: null
		};
	}

	const existingContact = await findContactByName(link.contactName);
	if (existingContact) {
		return {
			contactId: existingContact.id,
			contactNameSnapshot: getLookupDisplayName(existingContact),
			createdContact: null
		};
	}

	const createdContact = await createContact(link.contactName);
	return {
		contactId: createdContact.id,
		contactNameSnapshot: getLookupDisplayName(createdContact),
		createdContact
	};
}

export async function resolveProjectRequesterLink({
	requesters,
	requesterId,
	requesterName,
	findRequesterByName,
	createRequester
}: {
	requesters: ContactLookup[];
	requesterId?: string | null;
	requesterName?: string | null;
	findRequesterByName: (name: string) => Promise<ContactLookup | null>;
	createRequester: (name: string) => Promise<ContactLookup>;
}) {
	if (requesterId) {
		const selectedRequester = requesters.find((contact) => contact.id === requesterId);
		if (selectedRequester) {
			return {
				requesterContactId: selectedRequester.id,
				requesterNameSnapshot: getLookupDisplayName(selectedRequester),
				createdRequester: null
			};
		}
	}

	const link = buildProjectRequesterLink(requesters, requesterName ?? '');
	if (!link.shouldCreateContact) {
		return {
			requesterContactId: link.contactId,
			requesterNameSnapshot: link.contactNameSnapshot,
			createdRequester: null
		};
	}

	const existingRequester = await findRequesterByName(link.contactName);
	if (existingRequester) {
		return {
			requesterContactId: existingRequester.id,
			requesterNameSnapshot: getLookupDisplayName(existingRequester),
			createdRequester: null
		};
	}

	const createdRequester = await createRequester(link.contactName);
	return {
		requesterContactId: createdRequester.id,
		requesterNameSnapshot: getLookupDisplayName(createdRequester),
		createdRequester
	};
}
