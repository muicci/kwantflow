import type { AiWorkspaceKnowledgeContext } from '$lib/types/index.js';
import { QuoteEmailRewriteSchema } from '$lib/services/email-ai-contracts.js';
import { runStructuredUtilityTask } from '$lib/services/structured-utility.js';

export type QuoteEmailDraft = {
	subject: string;
	body: string;
};

type EmailPayload = {
	rfq_number: string;
	project_name: string | null;
	contact_name: string | null;
};

/**
 * Build a locale-aware system instruction for the AI email draft.
 * Adapts tone, spelling, and conventions based on the user's country and industry.
 */
function buildEmailSystemInstruction(countryCode: string, businessName: string): string {
	const locale = resolveLocale(countryCode);
	const spelling = locale.englishVariant === 'au' ? 'Australian' : 'local';
	const currencyName = locale.currencyName;

	return [
		'You are drafting a professional quote email for a construction/trade business.',
		`The business sending the quote is "${businessName}".`,
		`Use ${spelling} English spelling and conventions (e.g. ${locale.spellingExamples}).`,
		`Currency: ${currencyName}. Format prices accordingly.`,
		'',
		'--- STYLE RULES ---',
		'Be direct and professional. Write as a real estimator or project manager, not a marketing copywriter.',
		'Keep it to 3-4 short paragraphs. Busy people read fast.',
		'',
		'--- FORMAT (MANDATORY) ---',
		'Your response must follow this exact format:',
		'',
		'Hi {first name only — never the full company name},',
		'',
		'{One sentence referencing their RFQ or project. Be brief and specific.}',
		'',
		'{One paragraph stating the total, what the quote option covers, and the lead time.}',
		'',
		'{One line about payment terms if supplied — keep it simple.}',
		'',
		'{Optional: one short sentence about inclusions/exclusions if relevant.}',
		'',
		'{Call to action — e.g. "Let me know if you have any questions." Keep it short. Do NOT include a sign-off, closing, or your name — the email signature will be added separately.}',
		'',
		'--- EXAMPLE OF CORRECT OUTPUT ---',
		'Hi James,',
		'',
		'Thanks for the opportunity to quote on the Queen Street commercial fitout.',
		'',
		'The total for the Standard package comes to $358,800.00, covering structural steel, concrete works, electrical fitout, plumbing, and finishes. Lead time is 8-10 weeks from order.',
		'',
		'Payment terms are 30% deposit, 70% on completion.',
		'',
		'Let me know if you need anything else or want to run through the scope.',
		'',
		'--- NEVER DO ---',
		"Do NOT use the company name in the salutation. Use the person's first name only.",
		'Do NOT start with: "I hope this email finds you well", "I am writing to", "Please find attached", "We are pleased to", "Following up on", "Per our conversation", "This quote addresses".',
		'Do NOT use: "please do not hesitate to", "should you have any questions", "thank you for your time and consideration", "we look forward to the opportunity", "it would be a pleasure", "just a heads-up".',
		'Do NOT explain or comment on the quote structure (e.g. "This covers the key line item"). Just state the price.',
		'Do NOT say "the test" if the supplied data mentions an item called "test" — just state what is included and excluded without repeating the item name oddly.',
		'Never contradict yourself. If an item is listed in both inclusions and exclusions, that is likely bad data — omit it from the email rather than repeating confusingly.',
		'',
		'--- LANGUAGE & TONE ---',
		'Write like a real person — not a marketing brochure or an AI. Imagine you are a senior estimator who has been in the industry for 15 years.',
		'Use plain, direct language. No corporate-speak.',
		'NEVER use: "we are writing to provide", "we are delighted to", "please do not hesitate to", "should you have any questions", "thank you for your time and consideration", "we look forward to the opportunity", "it would be a pleasure", "this quote is for", "this quote addresses".',
		"Use contractions naturally (we'll, we're, you're, don't, I've).",
		'',
		'--- CONTENT ---',
		"Start by acknowledging the recipient's request or project. Sound like you already know them.",
		'State the total price cleanly — one sentence.',
		'Mention the quote option name, what it covers, and the lead time in a natural flow.',
		'Reference payment terms, inclusions, or exclusions ONLY if the data includes them. If present, weave in as one short sentence, not a list.',
		'If the supplied data has contradictory or unclear inclusions/exclusions, just skip them rather than making confusing statements.',
		'Add one sentence that shows you understand their project — reference the RFQ description, site address, or tender reference if available.',
		'',
		'--- CLOSING ---',
		'End with a short, natural call to action: offer to chat, answer questions, or take the next step.',
		'',
		'--- OUTPUT ---',
		'Return the rewritten subject and body through the provided output tool.',
		'The body should be plain text with \\n line breaks between paragraphs.',
		'Do not include a sign-off, closing, sender name, or email signature.'
	].join('\n');
}

type LocaleProfile = {
	englishVariant: 'au' | 'uk' | 'us' | 'other';
	spellingExamples: string;
	currencyName: string;
	dateFormat: string;
};

function resolveLocale(countryCode: string): LocaleProfile {
	const cc = countryCode.toUpperCase();
	if (['AU', 'NZ'].includes(cc)) {
		return {
			englishVariant: 'au',
			spellingExamples: 'labour not labor, metre not meter, organisation not organization',
			currencyName: cc === 'NZ' ? 'NZD' : 'AUD',
			dateFormat: 'dd/mm/yyyy'
		};
	}
	if (['GB', 'IE'].includes(cc)) {
		return {
			englishVariant: 'uk',
			spellingExamples: 'labour, metre, organisation',
			currencyName: 'GBP',
			dateFormat: 'dd/mm/yyyy'
		};
	}
	if (cc === 'US') {
		return {
			englishVariant: 'us',
			spellingExamples: 'labor, meter, organization',
			currencyName: 'USD',
			dateFormat: 'mm/dd/yyyy'
		};
	}
	// Default: AU-style for unknown countries
	return {
		englishVariant: 'other',
		spellingExamples: 'labour, metre, organisation',
		currencyName: 'USD',
		dateFormat: 'dd/mm/yyyy'
	};
}

/**
 * Build the system instruction for Kwantflow AI to generate a quote email.
 */
export function buildEmailSystemInstructionForPrompt(
	countryCode: string,
	businessName: string
): string {
	return buildEmailSystemInstruction(countryCode, businessName);
}

/**
 * Build the data/context section of the prompt (everything after the system instruction).
 */
export function buildEmailDataSection(
	payload: EmailPayload,
	businessName: string,
	optionLabel: string,
	totalAmount: number,
	currencySymbol: string,
	countryCode: string,
	workspaceKnowledge?: AiWorkspaceKnowledgeContext | null,
	quoteNotes?: string | null,
	leadTime?: string | null,
	lineItemSummary?: string | null,
	projectContent?: string | null,
	paymentTerms?: string | null,
	defaultInclusions?: string | null,
	defaultExclusions?: string | null,
	defaultTerms?: string | null
): string {
	const contactName = payload.contact_name?.trim() || 'the client';
	const projectName = payload.project_name?.trim() || '';
	const rfqNumber = payload.rfq_number?.trim() || '';
	const formattedTotal = `${currencySymbol}${Number(totalAmount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const knowledgeBlock = workspaceKnowledge?.playbookText?.trim()
		? `\nWorkspace knowledge (pricing guidelines from the business):\n${workspaceKnowledge.playbookText}`
		: '';

	const itemsBlock = lineItemSummary ? `\nKey line items:\n${lineItemSummary}` : '';

	const notesBlock = quoteNotes?.trim() ? `\nQuote notes: ${quoteNotes}` : '';

	const leadTimeBlock = leadTime?.trim() ? `\nLead time: ${leadTime}` : '';

	const contentBlock = projectContent?.trim()
		? `\nOriginal RFQ description:\n${projectContent.slice(0, 3000)}`
		: '';

	const paymentTermsBlock = paymentTerms?.trim() ? `\nPayment terms: ${paymentTerms}` : '';

	const inclusionsBlock = defaultInclusions?.trim() ? `\nInclusions: ${defaultInclusions}` : '';

	const exclusionsBlock = defaultExclusions?.trim() ? `\nExclusions: ${defaultExclusions}` : '';

	const termsBlock = defaultTerms?.trim() ? `\nStandard terms: ${defaultTerms}` : '';

	const dataSection = [
		`Customer: ${contactName}`,
		projectName ? `Project: ${projectName}` : '',
		`Quote: #${rfqNumber}`,
		`Option: ${optionLabel}`,
		`Total: ${formattedTotal}`,
		leadTimeBlock,
		paymentTermsBlock,
		inclusionsBlock,
		exclusionsBlock,
		termsBlock,
		notesBlock,
		itemsBlock,
		knowledgeBlock,
		contentBlock
	]
		.filter(Boolean)
		.join('\n');

	return dataSection;
}

function stripTrailingSignOff(body: string): string {
	const signOffMatch = body.match(
		/\n+(Best regards|Thanks|Regards|Cheers|Kind regards|Sincerely)[^\n]*$/i
	);
	return signOffMatch ? body.slice(0, signOffMatch.index).trimEnd() : body.trimEnd();
}

function appendSignature(body: string, emailSignature?: string | null): string {
	const cleanBody = stripTrailingSignOff(body);
	const signature = emailSignature?.trim();
	if (!signature) return cleanBody;
	const bodyWithoutEchoedSignature = stripTrailingSignOff(
		cleanBody
			.split(signature)
			.join('')
			.replace(/\n{3,}/g, '\n\n')
			.trimEnd()
	);
	return `${bodyWithoutEchoedSignature}\n\n${signature}`;
}

export type RewriteQuoteEmailDraftParams = {
	currentDraft: QuoteEmailDraft;
	payload: EmailPayload;
	businessName: string;
	optionLabel: string;
	totalAmount: number;
	currencySymbol: string;
	countryCode: string;
	workspaceKnowledge?: AiWorkspaceKnowledgeContext | null;
	quoteNotes?: string | null;
	leadTime?: string | null;
	lineItemSummary?: string | null;
	projectContent?: string | null;
	paymentTerms?: string | null;
	defaultInclusions?: string | null;
	defaultExclusions?: string | null;
	defaultTerms?: string | null;
	emailSignature?: string | null;
};

export async function rewriteQuoteEmailDraft(
	params: RewriteQuoteEmailDraftParams
): Promise<QuoteEmailDraft> {
	const formattedTotal = `${params.currencySymbol}${Number(params.totalAmount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const outputSchema = QuoteEmailRewriteSchema.refine(
		(value) => value.body.includes(formattedTotal),
		{
			path: ['body'],
			message: `Body must include the exact quote total ${formattedTotal}.`
		}
	);
	const systemInstruction = buildEmailSystemInstruction(params.countryCode, params.businessName);
	const facts = buildEmailDataSection(
		params.payload,
		params.businessName,
		params.optionLabel,
		params.totalAmount,
		params.currencySymbol,
		params.countryCode,
		params.workspaceKnowledge,
		params.quoteNotes,
		params.leadTime,
		params.lineItemSummary,
		params.projectContent,
		params.paymentTerms,
		params.defaultInclusions,
		params.defaultExclusions,
		params.defaultTerms
	);

	const draft = await runStructuredUtilityTask({
		taskName: 'rewrite_quote_email',
		systemInstruction,
		userContent: [
			'Rewrite the currently edited quote email using the canonical quote facts.',
			'Preserve exact commercial facts. Do not invent prices, currencies, quote numbers, lead times, payment terms, inclusions, or exclusions.',
			'',
			'Canonical quote facts:',
			facts,
			'',
			'Currently edited subject:',
			params.currentDraft.subject,
			'',
			'Currently edited body:',
			params.currentDraft.body
		].join('\n'),
		outputSchema,
		enableThinking: false,
		maxOutputTokens: 900,
		workloadClass: 'interactive'
	});

	if (!draft.body.includes(formattedTotal)) {
		throw new Error(`AI rewrite did not preserve the exact quote total ${formattedTotal}.`);
	}

	return {
		subject: draft.subject,
		body: appendSignature(draft.body, params.emailSignature)
	};
}

/**
 * Template-based fallback used when Kwantflow AI is not available.
 */
export function buildTemplateEmailDraft(
	payload: EmailPayload,
	businessName: string,
	optionLabel: string,
	totalAmount: number,
	currencySymbol: string,
	workspaceKnowledge?: AiWorkspaceKnowledgeContext | null,
	quoteNotes?: string | null,
	leadTime?: string | null,
	lineItemSummary?: string | null,
	emailSignature?: string | null
): QuoteEmailDraft {
	const contactName = payload.contact_name?.trim() || 'there';
	const projectName = payload.project_name?.trim() || '';
	const rfqNumber = payload.rfq_number?.trim() || '';

	const formattedTotal = `${currencySymbol}${Number(totalAmount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const cleanLeadTime = leadTime?.trim().replace(/\n/g, ' ') || '';

	const firstName = contactName.split(' ')[0] || contactName;
	const subject = projectName ? `Quote #${rfqNumber} — ${projectName}` : `Quote #${rfqNumber}`;

	const scopeItems = lineItemSummary?.trim() ? lineItemSummary.split('\n').slice(0, 5) : [];

	const bodyParts: string[] = [
		`Hi ${firstName},`,
		'',
		projectName
			? `Thanks for the opportunity to quote on ${projectName}.`
			: 'Thanks for the opportunity to provide our pricing.',
		'',
		`We can complete the scope under the ${optionLabel} option for ${formattedTotal}.${cleanLeadTime ? ` Lead time is ${cleanLeadTime.toLowerCase()}.` : ''}`
	];

	if (quoteNotes?.trim()) {
		bodyParts.push('', `Notes: ${quoteNotes.trim()}`);
	}

	if (scopeItems.length > 0) {
		bodyParts.push('', 'Scope of work:', ...scopeItems);
	}

	bodyParts.push(
		'',
		`Quote reference: #${rfqNumber}`,
		'',
		'Let me know if you have any questions, or if you would like to discuss the scope further.'
	);

	const body = appendSignature(bodyParts.join('\n'), emailSignature);

	return { subject, body };
}
