import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rfqSchema } from '$lib/schemas/index.js';
import type { GmailDetail } from '$lib/state/integrations.svelte.js';
import { ProjectStatus } from '$lib/constants/index.js';

// Hoist all mocks and shared variables
const {
	invokeMock,
	integrationsStateMock,
	customerStateMock,
	contactsStateMock,
	contactsStateList,
	runStructuredUtilityTaskMock,
	workspaceStateMock
} = vi.hoisted(() => {
	const invokeMock = vi.fn().mockResolvedValue('staged-file-path');
	const runStructuredUtilityTaskMock = vi.fn();
	const workspaceStateMock = {
		businessName: 'Northgate Engineering',
		displayName: 'Northgate Engineering'
	};

	const integrationsStateMock = {
		connectedGoogle: { id: 'conn-google-1' },
		connections: [{ id: 'conn-google-1', provider: 'google_gmail' }],
		get activeEmailConnection() {
			return { id: 'conn-google-1', provider: 'google_gmail' };
		},
		get anyEmailConnection() {
			return { id: 'conn-google-1', provider: 'google_gmail' };
		},
		getConnectionForMessageId(_messageId: string) {
			return { id: 'conn-google-1', provider: 'google_gmail' };
		}
	};

	const customerStateMock = {
		isAiAllowed: true
	};

	const contactsStateList: Array<{
		id?: string;
		kind?: string;
		display_name?: string;
		name?: string;
		email?: string;
	}> = [];
	const contactsStateMock = {
		list: contactsStateList,
		findMatchingContact: vi.fn(
			(row: { kind?: string; display_name?: string; name?: string; email?: string }) => {
				const normName = (row.display_name || '').toLowerCase();
				const normEmail = (row.email || '').toLowerCase();

				return (
					contactsStateList.find((c) => {
						if (row.kind === 'company' && c.kind === 'company') {
							return (
								(c.display_name || '').toLowerCase() === normName ||
								(c.name || '').toLowerCase() === normName
							);
						}
						if (row.kind === 'person' && c.kind === 'person') {
							return (
								(c.display_name || '').toLowerCase() === normName ||
								(c.email || '').toLowerCase() === normEmail
							);
						}
						return false;
					}) || null
				);
			}
		)
	};

	return {
		invokeMock,
		integrationsStateMock,
		customerStateMock,
		contactsStateMock,
		contactsStateList,
		runStructuredUtilityTaskMock,
		workspaceStateMock
	};
});

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('$lib/state/integrations.svelte.js', () => ({
	integrationsState: integrationsStateMock
}));

vi.mock('$lib/state/customer.svelte.js', () => ({
	customerState: customerStateMock
}));

vi.mock('$lib/state/contacts.svelte.js', () => ({
	contactsState: contactsStateMock
}));

vi.mock('$lib/services/structured-utility.js', () => ({
	runStructuredUtilityTask: runStructuredUtilityTaskMock
}));

vi.mock('$lib/state/workspace.svelte.js', () => ({
	workspaceState: workspaceStateMock
}));

import { prepareIntakeFromEmail } from './email-intake.js';

describe('Email Intake Smoke & Concurrency Integration Tests', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		contactsStateList.length = 0; // Clear lists
	});

	it('Scenario 1: Matches existing company and requester person, pre-populating correct database IDs', async () => {
		// Seed database contacts
		const existingCompany = {
			id: 'company-id-123',
			kind: 'company',
			display_name: 'Wayne Enterprises',
			name: 'Wayne Enterprises'
		};
		const existingPerson = {
			id: 'person-id-456',
			kind: 'person',
			display_name: 'John Wayne',
			email: 'john@wayne.com',
			linked_company_id: 'company-id-123'
		};
		contactsStateList.push(existingCompany, existingPerson);

		// Mock Gemma 4 Extraction output
		runStructuredUtilityTaskMock.mockResolvedValue({
			company_name: 'Wayne Enterprises',
			contact_person: 'John Wayne',
			contact_email: 'john@wayne.com',
			contact_phone: '555-0199',
			project_name: 'Wayne Tower Foundation',
			due_date: '2026-07-01',
			submission_deadline_at: '2026-07-01T17:00:00',
			customer_tender_reference: 'WT-2026-09',
			rfq_number: 'RFQ-999',
			priority: 'High',
			site_address: '100 Gotham Road',
			delivery_address: '100 Gotham Road',
			internal_notes: 'Excavate and pour structural concrete foundation.',
			additional_notes: 'ASAP requirement.'
		});

		const mockEmail: GmailDetail = {
			id: 'msg-1',
			threadId: 'thread-1',
			from: 'John Wayne <john@wayne.com>',
			to: 'estimating@example.test',
			cc: '',
			subject: 'Request for Quote: Wayne Tower Foundation',
			snippet: 'Please quote on the attached drawings',
			bodyText: 'Please quote on the drawings... thanks, John Wayne, Wayne Enterprises.',
			bodyHtml: null,
			date: '2026-06-15T10:00:00Z',
			labels: [],
			hasAttachments: true,
			attachmentIds: ['att-1'],
			attachmentNames: ['drawings.pdf'],
			attachmentMimeTypes: ['application/pdf']
		};

		const result = await prepareIntakeFromEmail(mockEmail);

		// Assertions on prefilled values
		expect(result.values.company_name).toBe('Wayne Enterprises');
		expect(result.values.company_contact_id).toBe('company-id-123'); // Properly mapped
		expect(result.values.requester_name).toBe('John Wayne');
		expect(result.values.requester_contact_id).toBe('person-id-456'); // Properly mapped
		expect(result.values.customer_tender_reference).toBe('WT-2026-09');
		expect(result.values.rfq_number).toBe('RFQ-999');
		expect(result.values.priority).toBe('High');
		expect(result.files).toHaveLength(1);
		expect(result.files[0].path).toBe('staged-file-path');
		expect(runStructuredUtilityTaskMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskName: 'prepare_email_rfq_intake',
				workloadClass: 'interactive'
			})
		);

		// Schema compliance validation after dialog hydration
		const parsed = rfqSchema.safeParse({
			...result.values,
			rfq_number: result.values.rfq_number || 'RFQ-TEMP-123',
			status: ProjectStatus.Draft
		});
		expect(parsed.success).toBe(true);
	});

	it('Scenario 2: Prefills new company and person without mutating DB immediately, capturing tender info', async () => {
		// Mock Gemma 4 Extraction output
		runStructuredUtilityTaskMock.mockResolvedValue({
			company_name: 'Gotham Steel',
			contact_person: 'Harvey Dent',
			contact_email: 'harvey@gothamsteel.com',
			contact_phone: '555-0212',
			project_name: 'GPD HQ Precinct',
			due_date: '2026-08-15',
			submission_deadline_at: '2026-08-15T12:00:00',
			customer_tender_reference: 'GPD-992-TENDER',
			rfq_number: '',
			priority: 'Medium',
			site_address: '1 Precinct Plaza, Gotham',
			delivery_address: '',
			internal_notes: 'Supply and fabrication of steel works.',
			additional_notes: 'Provide timeline details.'
		});

		const mockEmail: GmailDetail = {
			id: 'msg-2',
			threadId: 'thread-2',
			from: 'Harvey Dent <harvey@gothamsteel.com>',
			to: 'estimating@example.test',
			cc: '',
			subject: 'RFQ: GPDHQ Precinct (Ref: GPD-992-TENDER)',
			snippet: 'Tender documents for steel works',
			bodyText: 'Tender documents for steel works. Regards, Harvey.',
			bodyHtml: null,
			date: '2026-06-15T11:00:00Z',
			labels: [],
			hasAttachments: false,
			attachmentIds: [],
			attachmentNames: [],
			attachmentMimeTypes: []
		};

		const result = await prepareIntakeFromEmail(mockEmail);

		// Assertions - no database contacts created yet
		expect(result.values.company_name).toBe('Gotham Steel');
		expect(result.values.company_contact_id).toBeNull(); // Read-only safety
		expect(result.values.requester_name).toBe('Harvey Dent');
		expect(result.values.requester_contact_id).toBeNull(); // Read-only safety
		expect(result.values.customer_tender_reference).toBe('GPD-992-TENDER');
		expect(result.values.priority).toBe('Medium');
		expect(result.values.content).toBe('Supply and fabrication of steel works.');
		expect(result.values.note).toBe('Provide timeline details.');

		// Schema compliance validation after dialog hydration
		const parsed = rfqSchema.safeParse({
			...result.values,
			rfq_number: result.values.rfq_number || 'RFQ-TEMP-123',
			status: ProjectStatus.Draft
		});
		expect(parsed.success).toBe(true);
	});

	it('Scenario 3: Extracts Addenda label, date, notes and updates deadline', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			company_name: 'Wayne Enterprises',
			contact_person: 'Bruce Wayne',
			contact_email: 'bruce@wayne.com',
			contact_phone: '',
			project_name: 'Wayne Tower',
			due_date: '2026-09-01',
			submission_deadline_at: '2026-09-01T17:00:00',
			customer_tender_reference: 'WT-2026',
			rfq_number: '',
			priority: 'High',
			site_address: '',
			delivery_address: '',
			addendum_label: 'Addendum 1',
			addendum_date: '2026-06-16',
			addendum_notes: 'Closing date extended to September 1st.'
		});

		const mockEmail: GmailDetail = {
			id: 'msg-3',
			threadId: 'thread-3',
			from: 'Bruce Wayne <bruce@wayne.com>',
			to: 'estimating@example.test',
			cc: '',
			subject: 'Addendum 1 - Wayne Tower tender extension',
			snippet: 'Tender closing date has been extended',
			bodyText: 'Tender closing date has been extended to Sep 1st. Addendum 1 details attached.',
			bodyHtml: null,
			date: '2026-06-16T08:00:00Z',
			labels: [],
			hasAttachments: false,
			attachmentIds: [],
			attachmentNames: [],
			attachmentMimeTypes: []
		};

		const result = await prepareIntakeFromEmail(mockEmail);

		expect(result.values.addendum_label).toBe('Addendum 1');
		expect(result.values.addendum_date).toBe('2026-06-16');
		expect(result.values.addendum_notes).toBe('Closing date extended to September 1st.');
		expect(result.values.due_date).toBe('2026-09-01');

		// Schema compliance validation after dialog hydration
		const parsed = rfqSchema.safeParse({
			...result.values,
			rfq_number: result.values.rfq_number || 'RFQ-TEMP-123',
			status: ProjectStatus.Draft
		});
		expect(parsed.success).toBe(true);
	});

	it('Scenario 4: Prevents using host company name (Northgate Engineering) as the requesting company', async () => {
		// Mock Gemma 4 extracting our company name
		runStructuredUtilityTaskMock.mockResolvedValue({
			company_name: 'Northgate Engineering',
			contact_person: 'Michael',
			contact_email: 'michael@external.com',
			project_name: 'Custom Fabrication'
		});

		const mockEmail: GmailDetail = {
			id: 'msg-4',
			threadId: 'thread-4',
			from: 'Michael <michael@external.com>',
			to: 'estimating@northgate-engineering.example',
			cc: '',
			subject: 'Quote request',
			snippet: 'Attached drawing for quotation',
			bodyText: 'Hi Northgate Engineering team, quote request attached.',
			bodyHtml: null,
			date: '2026-06-16T08:00:00Z',
			labels: [],
			hasAttachments: false,
			attachmentIds: [],
			attachmentNames: [],
			attachmentMimeTypes: []
		};

		const result = await prepareIntakeFromEmail(mockEmail);

		// The host company "Northgate Engineering" should be stripped out
		// and it should fall back to the domain-extracted company or be empty.
		expect(result.values.company_name).toBe('External');
	});

	it('Scenario 5: Skips public email domains (Gmail, Outlook) for company name fallback', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			company_name: '',
			contact_person: 'Sam Rivera',
			contact_email: 'sam.rivera.fab@gmail.com',
			project_name: 'Custom Fabrication'
		});

		const mockEmail: GmailDetail = {
			id: 'msg-5',
			threadId: 'thread-5',
			from: 'Sam Rivera <sam.rivera.fab@gmail.com>',
			to: 'estimating@northgate-engineering.example',
			cc: '',
			subject: 'Quote request',
			snippet: 'Attached drawing for quotation',
			bodyText: 'Hi Northgate Engineering team, quote request attached.',
			bodyHtml: null,
			date: '2026-06-16T08:00:00Z',
			labels: [],
			hasAttachments: false,
			attachmentIds: [],
			attachmentNames: [],
			attachmentMimeTypes: []
		};

		const result = await prepareIntakeFromEmail(mockEmail);

		// "Gmail" should be skipped because it is a known public provider
		expect(result.values.company_name).toBe('');
	});
});
