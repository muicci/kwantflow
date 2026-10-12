import { describe, expect, it } from 'vitest';
import {
	buildProjectContactLink,
	filterProjectContacts,
	filterProjectRequesters,
	getPrimaryProjectRequester,
	getProjectContactDisplayName,
	getProjectCompanyDisplayName,
	getProjectRequesterDisplayName,
	normaliseContactName,
	resolveProjectContactLink,
	resolveProjectRequesterLink
} from './project-contact';

describe('buildProjectContactLink', () => {
	it('links to an existing contact using normalized name matching', () => {
		const result = buildProjectContactLink(
			[
				{ id: 'contact-acme', name: 'Acme Engineering' },
				{ id: 'contact-boltco', name: 'BoltCo' }
			],
			'  acme engineering  '
		);

		expect(result).toEqual({
			contactId: 'contact-acme',
			contactName: 'Acme Engineering',
			contactNameSnapshot: 'Acme Engineering',
			shouldCreateContact: false
		});
	});

	it('requests inline contact creation when no match exists', () => {
		const result = buildProjectContactLink(
			[{ id: 'contact-acme', name: 'Acme Engineering' }],
			'Walk-In Lead'
		);

		expect(result).toEqual({
			contactId: null,
			contactName: 'Walk-In Lead',
			contactNameSnapshot: 'Walk-In Lead',
			shouldCreateContact: true
		});
	});

	it('filters contact suggestions by company, contact, and email', () => {
		const result = filterProjectContacts(
			[
				{
					id: 'contact-acme',
					name: 'Acme Engineering',
					contact_name: 'Jane Weld',
					email: 'quotes@acme.com'
				},
				{
					id: 'contact-boltco',
					name: 'BoltCo',
					contact_name: 'Sam Turner',
					email: 'ops@boltco.com'
				}
			],
			'jane'
		);

		expect(result).toEqual([
			{
				id: 'contact-acme',
				name: 'Acme Engineering',
				contact_name: 'Jane Weld',
				email: 'quotes@acme.com'
			}
		]);
	});

	it('returns the primary requester when one linked person is marked as primary', () => {
		expect(
			getPrimaryProjectRequester([
				{ id: 'person-1', name: 'Ada Lovelace', is_primary_company_contact: false },
				{ id: 'person-2', name: 'Grace Hopper', is_primary_company_contact: true }
			])
		).toEqual({
			id: 'person-2',
			name: 'Grace Hopper',
			is_primary_company_contact: true
		});
	});

	it('returns null when no linked person is marked as primary', () => {
		expect(
			getPrimaryProjectRequester([
				{ id: 'person-1', name: 'Ada Lovelace', is_primary_company_contact: false }
			])
		).toBeNull();
	});

	it('returns the first primary requester if multiple exist', () => {
		expect(
			getPrimaryProjectRequester([
				{ id: 'person-1', name: 'Ada Lovelace', is_primary_company_contact: false },
				{ id: 'person-2', name: 'Grace Hopper', is_primary_company_contact: true },
				{ id: 'person-3', name: 'Alan Turing', is_primary_company_contact: true }
			])
		).toEqual({
			id: 'person-2',
			name: 'Grace Hopper',
			is_primary_company_contact: true
		});
	});

	it('returns null when the contacts list is empty', () => {
		expect(getPrimaryProjectRequester([])).toBeNull();
	});

	it('normalizes internal whitespace in contact names', () => {
		expect(normaliseContactName('  Acme   Engineering   Pty Ltd  ')).toBe(
			'acme engineering pty ltd'
		);
	});
	it('returns an empty link when the field is blank', () => {
		const result = buildProjectContactLink(
			[{ id: 'contact-acme', name: 'Acme Engineering' }],
			'   '
		);

		expect(result).toEqual({
			contactId: null,
			contactName: '',
			contactNameSnapshot: null,
			shouldCreateContact: false
		});
	});
});

describe('getProjectContactDisplayName', () => {
	it('prefers the stored project snapshot over the live contact name', () => {
		expect(
			getProjectContactDisplayName({
				contact_name_snapshot: 'Acme Engineering',
				contact_name: 'Acme Fabrication'
			})
		).toBe('Acme Engineering');
	});

	it('falls back to the live contact name when no snapshot exists', () => {
		expect(
			getProjectContactDisplayName({
				contact_name_snapshot: null,
				contact_name: 'Acme Fabrication'
			})
		).toBe('Acme Fabrication');
	});

	it('returns null when neither snapshot nor live contact name exists', () => {
		expect(
			getProjectContactDisplayName({
				contact_name_snapshot: null,
				contact_name: null
			})
		).toBeNull();
	});

	it('aliases the company display helper to the RFQ company snapshot contract', () => {
		expect(
			getProjectCompanyDisplayName({
				contact_name_snapshot: 'Acme Engineering',
				contact_name: 'Acme Fabrication'
			})
		).toBe('Acme Engineering');
	});

	it('prefers the stored requester snapshot over the live requester name', () => {
		expect(
			getProjectRequesterDisplayName({
				requester_name_snapshot: 'Harry Potter',
				requester_contact_name: 'Harold Potter'
			})
		).toBe('Harry Potter');
	});

	it('falls back to the live requester name when no requester snapshot exists', () => {
		expect(
			getProjectRequesterDisplayName({
				requester_name_snapshot: null,
				requester_contact_name: 'Harold Potter'
			})
		).toBe('Harold Potter');
	});
});

describe('normaliseContactName', () => {
	it('normalizes internal whitespace in contact names', () => {
		expect(normaliseContactName('  Acme   Engineering   Pty Ltd  ')).toBe(
			'acme engineering pty ltd'
		);
	});

	it('returns an empty string when value is null', () => {
		expect(normaliseContactName(null)).toBe('');
	});

	it('returns an empty string when value is undefined', () => {
		expect(normaliseContactName(undefined)).toBe('');
	});

	it('returns an empty string when value is an empty string', () => {
		expect(normaliseContactName('')).toBe('');
	});

	it('returns an empty string when value contains only whitespace', () => {
		expect(normaliseContactName('   ')).toBe('');
	});

	it('converts strings to lowercase', () => {
		expect(normaliseContactName('UPPERCASE')).toBe('uppercase');
	});
});

describe('resolveProjectContactLink', () => {
	it('creates a new contact when no match exists', async () => {
		const result = await resolveProjectContactLink({
			contacts: [{ id: 'contact-acme', name: 'Acme Engineering' }],
			contactId: null,
			contactName: 'Walk-In Lead',
			findContactByName: async () => null,
			createContact: async (name: string) => ({
				id: 'contact-walk-in',
				name
			})
		});

		expect(result).toEqual({
			createdContact: {
				id: 'contact-walk-in',
				name: 'Walk-In Lead'
			},
			contactId: 'contact-walk-in',
			contactNameSnapshot: 'Walk-In Lead'
		});
	});

	it('propagates inline contact creation failures', async () => {
		await expect(
			resolveProjectContactLink({
				contacts: [{ id: 'contact-acme', name: 'Acme Engineering' }],
				contactId: null,
				contactName: 'Walk-In Lead',
				findContactByName: async () => null,
				createContact: async () => {
					throw new Error('insert failed');
				}
			})
		).rejects.toThrow('insert failed');
	});
});

describe('resolveProjectRequesterLink', () => {
	it('creates a new requester when the typed name is not an exact linked-person match', async () => {
		const result = await resolveProjectRequesterLink({
			requesters: [{ id: 'person-test', name: 'Test Test' }],
			requesterId: null,
			requesterName: 'Test 2',
			findRequesterByName: async () => null,
			createRequester: async (name: string) => ({ id: 'person-test-2', name })
		});

		expect(result).toEqual({
			requesterContactId: 'person-test-2',
			requesterNameSnapshot: 'Test 2',
			createdRequester: { id: 'person-test-2', name: 'Test 2' }
		});
	});

	it('allows a requester name to match the company name because people are company-scoped', async () => {
		const result = await resolveProjectRequesterLink({
			requesters: [],
			requesterId: null,
			requesterName: 'Test Test',
			findRequesterByName: async () => null,
			createRequester: async (name: string) => ({ id: 'person-test', name })
		});

		expect(result.requesterContactId).toBe('person-test');
		expect(result.requesterNameSnapshot).toBe('Test Test');
	});
});

describe('filterProjectRequesters', () => {
	it('filters requesters by name, contact_name, and email', () => {
		const result = filterProjectRequesters(
			[
				{
					id: 'requester-acme',
					name: 'Acme Engineering',
					contact_name: 'Jane Weld',
					email: 'quotes@acme.com'
				},
				{
					id: 'requester-boltco',
					name: 'BoltCo',
					contact_name: 'Sam Turner',
					email: 'ops@boltco.com'
				}
			],
			'jane'
		);

		expect(result).toEqual([
			{
				id: 'requester-acme',
				name: 'Acme Engineering',
				contact_name: 'Jane Weld',
				email: 'quotes@acme.com'
			}
		]);
	});
});
