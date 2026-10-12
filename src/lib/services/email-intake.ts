import { invoke } from '@tauri-apps/api/core';
import { integrationsState, type GmailDetail } from '$lib/state/integrations.svelte.js';
import { contactsState } from '$lib/state/contacts.svelte.js';
import { createLogger } from '$lib/services/logger.js';
import { runStructuredUtilityTask } from '$lib/services/structured-utility.js';
import { EmailRfqIntakeSchema } from '$lib/services/email-ai-contracts.js';
import { normaliseEmailBodyText } from '$lib/services/email-content.js';
import { workspaceState } from '$lib/state/workspace.svelte.js';

const log = createLogger('emailIntake');

/** Check if a company name matches our own host company name */
function isHostCompany(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	if (!normalized) return false;
	const hostNames = [
		workspaceState.businessName?.trim().toLowerCase(),
		workspaceState.displayName?.trim().toLowerCase()
	].filter(Boolean) as string[];
	return hostNames.some((host) => normalized === host || normalized.includes(host));
}

/** Extract a readable company name from an email address domain. */
function extractCompanyFromEmail(email: string): string {
	const senderEmail = email.trim().toLowerCase();
	const match = senderEmail.match(/@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)\.([a-zA-Z]{2,})/);
	if (!match) return '';
	const domain = match[1];
	const tld = match[2];
	const fullDomain = `${domain}.${tld}`;

	const PUBLIC_EMAIL_DOMAINS = new Set([
		'gmail.com',
		'yahoo.com',
		'hotmail.com',
		'outlook.com',
		'live.com',
		'icloud.com',
		'proton.me',
		'protonmail.com',
		'protonmail.ch',
		'aol.com',
		'zoho.com',
		'yandex.com',
		'mail.com',
		'gmx.com',
		'gmx.net',
		'mail.ru'
	]);

	if (PUBLIC_EMAIL_DOMAINS.has(fullDomain)) {
		return '';
	}

	// Convert domain to title case: harborline → Harborline
	return domain.charAt(0).toUpperCase() + domain.slice(1);
}

export type StagedFile = {
	path: string;
	name: string;
	mimeType?: string | null;
};

export type IntakePreparedValues = {
	project_name: string;
	company_name: string;
	company_contact_id: string | null;
	requester_contact_id: string | null;
	requester_name: string;
	contact_person: string;
	contact_email: string;
	contact_phone: string;
	content: string;
	received_date: string;
	source_channel: string;
	source_reference: string | null;
	source_email_message_id: string | null;
	source_email_integration_id: string | null;
	due_date: string;
	submission_deadline_at: string;
	customer_tender_reference: string;
	rfq_number: string;
	estimator_name: string;
	priority: string;
	site_address: string;
	delivery_address: string;
	addendum_label: string;
	addendum_date: string;
	addendum_notes: string;
	note: string;
};

/**
 * Download all attachments from an email and stage them for intake.
 */
async function downloadAttachments(
	detail: GmailDetail,
	connectionId: string
): Promise<StagedFile[]> {
	const staged: StagedFile[] = [];
	for (let i = 0; i < (detail.attachmentIds?.length ?? 0); i++) {
		let lastError: unknown;
		for (let attempt = 1; attempt <= 2; attempt += 1) {
			try {
				const path = await invoke<string>('download_email_attachment', {
					connectionId,
					messageId: detail.id,
					attachmentId: detail.attachmentIds[i],
					filename: detail.attachmentNames[i]
				});
				staged.push({
					path,
					name: detail.attachmentNames[i],
					mimeType: detail.attachmentMimeTypes?.[i] ?? null
				});
				lastError = null;
				break;
			} catch (error) {
				lastError = error;
				log.warn(
					`[intake] Attachment download attempt ${attempt} failed: ${detail.attachmentNames[i]}`
				);
			}
		}
		if (lastError) {
			throw new Error(
				`Could not prepare email attachment “${detail.attachmentNames[i]}”. Retry before opening the RFQ intake.`
			);
		}
	}
	return staged;
}

/**
 * Extract the email address from a "Name <email>" formatted string.
 */
function extractEmail(from: string): string | null {
	const match = from.match(/<?([^\s@]+@[^\s>]+)>?/);
	return match ? match[1].trim().toLowerCase() : null;
}

/**
 * Extract the display name from a "Name <email>" formatted string.
 */
function extractName(from: string): string {
	const match = from.match(/^"?([^"<]+)"?\s*<.*>/);
	if (match) return match[1].trim();
	const emailMatch = from.match(/<?([^\s@]+@[^\s>]+)>?/);
	if (emailMatch) return emailMatch[1].split('@')[0];
	return from;
}

/**
 * Match sender to existing contacts, returning matched IDs and company name.
 */
function resolveContacts(from: string) {
	const senderEmail = extractEmail(from);
	const senderName = extractName(from);
	let companyContactId: string | null = null;
	let requesterContactId: string | null = null;
	let companyName = '';

	if (senderEmail) {
		const matchedPerson = contactsState.findMatchingContact({
			kind: 'person',
			email: senderEmail,
			display_name: senderName
		} as never);
		if (matchedPerson) {
			requesterContactId = matchedPerson.id;
			if (matchedPerson.linked_company_id) {
				companyContactId = matchedPerson.linked_company_id;
				const linkedCompany = contactsState.list.find(
					(c) => c.id === matchedPerson.linked_company_id
				);
				if (linkedCompany) {
					companyName = linkedCompany.display_name || linkedCompany.name;
				}
			}
		}
	}

	return { senderEmail, senderName, companyContactId, requesterContactId, companyName };
}

/**
 * Clean a project name by stripping common RFQ prefixes.
 */
function cleanProjectName(subject: string): string {
	const cleaned = subject
		.replace(
			/^(?:Re\s*:\s*)?(?:RFQ|RFP|ITB|Tender|Quote|Request\s+for\s+(?:Quote|Quotation|Proposal|Tender|Bid|Information))[\s\-–—:]+/i,
			''
		)
		.trim();
	return cleaned || subject;
}

/**
 * Run Kwantflow AI extraction on the email body to populate all intake fields.
 */
async function runAiExtraction(
	bodyText: string,
	subject: string,
	senderEmail: string | null,
	senderName: string,
	from: string,
	to: string,
	cc: string,
	receivedDate: string
): Promise<Partial<IntakePreparedValues> | null> {
	if (bodyText.length < 10) {
		log.info('[email-intake] Email body too short for AI extraction', {
			bodyLength: bodyText.length,
			subjectLength: subject.length
		});
		return null;
	}

	const hostCompanyNames = [
		workspaceState.businessName?.trim(),
		workspaceState.displayName?.trim()
	].filter(Boolean);
	const hostInstruction =
		hostCompanyNames.length > 0
			? ` IMPORTANT: Our company name is "${hostCompanyNames.join('" or "')}". The email is received BY us, so do NOT extract our company name as the requesting company (company_name) or client contact. Leave company_name null or extract the sender's company instead.`
			: '';

	try {
		const aiData = await runStructuredUtilityTask({
			taskName: 'prepare_email_rfq_intake',
			systemInstruction: `Extract only facts stated in the email into an RFQ intake preview. Leave unknown fields null. Do not invent dates, priorities, contacts, references, or addresses.${hostInstruction}`,
			userContent: [
				`From: ${from}`,
				`To: ${to}`,
				`Cc: ${cc}`,
				`Received: ${receivedDate}`,
				`Subject: ${subject}`,
				`Sender identity: ${senderName}${senderEmail ? ` <${senderEmail}>` : ''}`,
				'',
				'Body:',
				bodyText
			].join('\n'),
			outputSchema: EmailRfqIntakeSchema,
			enableThinking: false,
			maxOutputTokens: 1024,
			workloadClass: 'interactive'
		});
		// Extract company name from AI result, or fall back to sender email domain,
		// ensuring we never extract our own host company name.
		const rawExtractedCompany = aiData.company_name || '';
		const extractedCompany = isHostCompany(rawExtractedCompany) ? '' : rawExtractedCompany;
		const domainCompany = extractCompanyFromEmail(senderEmail || '');
		const finalCompanyName =
			extractedCompany || (isHostCompany(domainCompany) ? '' : domainCompany);

		// Fall back to sender name when AI extraction doesn't find a contact person.
		// This handles cold-start cases where the LLM hasn't loaded yet.
		const finalContactPerson = aiData.contact_person || senderName;
		const finalContactEmail = aiData.contact_email || senderEmail || '';

		return {
			company_name: finalCompanyName,
			contact_person: finalContactPerson,
			contact_email: finalContactEmail,
			contact_phone: aiData.contact_phone || '',
			requester_name: aiData.contact_person || senderName,
			project_name: aiData.project_name || '',
			due_date: aiData.due_date || '',
			submission_deadline_at: aiData.submission_deadline_at || aiData.due_date || '',
			customer_tender_reference: aiData.customer_tender_reference || '',
			rfq_number: aiData.rfq_number || '',
			priority: aiData.priority || 'Medium',
			site_address: aiData.site_address || '',
			delivery_address: aiData.delivery_address || '',
			addendum_label: aiData.addendum_label || '',
			addendum_date: aiData.addendum_date || '',
			addendum_notes: aiData.addendum_notes || '',
			content: aiData.internal_notes || '',
			note: aiData.additional_notes || ''
		};
	} catch (error) {
		log.warn('[email-intake] AI extraction failed', {
			error: error instanceof Error ? error.message : String(error),
			bodyLength: bodyText.length
		});
		return null;
	}
}

/**
 * Prepare intake values from a full email detail.
 *
 * Downloads attachments, resolves contacts, runs AI extraction,
 * and creates new contacts if needed. Returns ready-to-use values
 * for an IntakeDialog.
 */
export async function prepareIntakeFromEmail(detail: GmailDetail): Promise<{
	values: IntakePreparedValues;
	files: StagedFile[];
}> {
	// Find correct connection matching this email (Gmail or Outlook)
	const emailConnection =
		integrationsState.getConnectionForMessageId(detail.id) ??
		integrationsState.activeEmailConnection ??
		integrationsState.anyEmailConnection;
	const connectionId = emailConnection?.id ?? '';
	if (!connectionId) {
		throw new Error('No email connection found. Connect Gmail or Outlook in Settings.');
	}

	// Step 1: Download attachments
	const files = await downloadAttachments(detail, connectionId);

	// Step 2: Resolve contacts
	const { senderEmail, senderName, companyContactId, requesterContactId, companyName } =
		resolveContacts(detail.from);

	// Step 3: Build initial values
	// Use full body text (up to 8000 chars) for AI extraction.
	// Modern emails often have no plain-text alternative (HTML-only).
	// Fall back to HTML body with tags stripped, then snippet as last resort.
	const rawBody = normaliseEmailBodyText(detail);
	const bodyText = rawBody.slice(0, 8000);
	const projectName = cleanProjectName(detail.subject || '');

	const values: IntakePreparedValues = {
		project_name: projectName,
		company_name: companyName,
		company_contact_id: companyContactId,
		requester_contact_id: requesterContactId,
		requester_name: senderName,
		contact_person: '',
		contact_email: '',
		contact_phone: '',
		content: bodyText,
		received_date: detail.date ? new Date(detail.date).toISOString().slice(0, 10) : '',
		source_channel: 'email',
		source_reference: detail.from,
		source_email_message_id: detail.id,
		source_email_integration_id: connectionId,
		due_date: '',
		submission_deadline_at: '',
		customer_tender_reference: '',
		rfq_number: '',
		estimator_name: '',
		priority: 'Medium',
		site_address: '',
		delivery_address: '',
		addendum_label: '',
		addendum_date: '',
		addendum_notes: '',
		note: ''
	};

	// Step 4: AI extraction
	const aiResult = await runAiExtraction(
		bodyText,
		detail.subject || '',
		senderEmail,
		senderName,
		detail.from,
		detail.to,
		detail.cc,
		detail.date
	);
	if (aiResult) {
		values.project_name = aiResult.project_name || values.project_name;
		values.company_name = aiResult.company_name || values.company_name;
		values.contact_person = aiResult.contact_person || '';
		values.contact_email = aiResult.contact_email || '';
		values.contact_phone = aiResult.contact_phone || '';
		values.requester_name = aiResult.requester_name || values.requester_name;
		values.due_date = aiResult.due_date ?? '';
		values.submission_deadline_at = aiResult.submission_deadline_at ?? '';
		values.customer_tender_reference = aiResult.customer_tender_reference ?? '';
		values.rfq_number = aiResult.rfq_number ?? '';
		values.estimator_name = aiResult.estimator_name ?? '';
		values.priority = aiResult.priority || 'Medium';
		values.site_address = aiResult.site_address ?? '';
		values.delivery_address = aiResult.delivery_address ?? '';
		values.addendum_label = aiResult.addendum_label ?? '';
		values.addendum_date = aiResult.addendum_date ?? '';
		values.addendum_notes = aiResult.addendum_notes ?? '';
		values.content = aiResult.content || bodyText;
		values.note = aiResult.note ?? '';
	}

	// Step 5: Resolve and link to existing contacts using central matching logic
	const contactEmailTrimmed = (values.contact_email || senderEmail || '').trim().toLowerCase();
	const contactNameTrimmed = (values.contact_person || values.requester_name || senderName).trim();
	const companyNameTrimmed = (values.company_name || '').trim();

	// Resolve Company
	if (companyNameTrimmed && !values.company_contact_id) {
		const matchedCompany = contactsState.findMatchingContact({
			kind: 'company',
			display_name: companyNameTrimmed
		} as never);
		if (matchedCompany) {
			values.company_contact_id = matchedCompany.id;
			values.company_name =
				matchedCompany.display_name || matchedCompany.name || values.company_name;
		}
	}

	// Resolve Requester (Person)
	if (contactNameTrimmed || contactEmailTrimmed) {
		let matchedPerson = contactsState.findMatchingContact({
			kind: 'person',
			email: contactEmailTrimmed,
			display_name: contactNameTrimmed,
			linked_company_id: values.company_contact_id ?? undefined
		} as never);

		// If no company-specific match was found, look up the person globally by email or name
		if (!matchedPerson) {
			matchedPerson =
				contactsState.list.find((contact) => {
					if (contact.kind !== 'person' || contact.is_active === false) return false;
					const personEmail = contactEmailTrimmed;
					const personName = contactNameTrimmed.toLowerCase();
					if (personEmail && contact.email?.toLowerCase().trim() === personEmail) return true;
					return (
						personName.length > 0 &&
						(contact.display_name || contact.name || '').toLowerCase().trim() === personName
					);
				}) ?? null;
		}

		if (matchedPerson) {
			values.requester_contact_id = matchedPerson.id;
			values.requester_name =
				matchedPerson.display_name || matchedPerson.name || values.requester_name;

			// If company is not resolved yet, link via person's company
			if (!values.company_contact_id && matchedPerson.linked_company_id) {
				values.company_contact_id = matchedPerson.linked_company_id;
				const linkedCompany = contactsState.list.find(
					(c) => c.id === matchedPerson.linked_company_id
				);
				if (linkedCompany) {
					values.company_name =
						linkedCompany.display_name || linkedCompany.name || values.company_name;
				}
			}
		}
	}

	return { values, files };
}
