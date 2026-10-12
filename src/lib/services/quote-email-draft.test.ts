import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildTemplateEmailDraft,
	buildEmailDataSection,
	buildEmailSystemInstructionForPrompt,
	rewriteQuoteEmailDraft
} from './quote-email-draft';

const { runStructuredUtilityTaskMock } = vi.hoisted(() => ({
	runStructuredUtilityTaskMock: vi.fn()
}));

vi.mock('$lib/services/structured-utility.js', () => ({
	runStructuredUtilityTask: runStructuredUtilityTaskMock
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe('buildTemplateEmailDraft', () => {
	it('produces a basic email with required fields', () => {
		const result = buildTemplateEmailDraft(
			{ rfq_number: 'RFQ-001', project_name: 'Test Project', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$'
		);
		expect(result.subject).toContain('RFQ-001');
		expect(result.body).toContain('Test Project');
		expect(result.body).toContain('John');
		expect(result.body).toContain('$15,000');
		expect(result.body).toContain('Thanks for the opportunity');
		expect(result.body).not.toContain('Please find attached');
		expect(result.body).not.toContain('We look forward');
	});

	it('includes line items when provided', () => {
		const result = buildTemplateEmailDraft(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			null,
			null,
			null,
			'Steel beam — qty 5 @ $1000\nWelding — qty 10 @ $200'
		);
		expect(result.body).toContain('Steel beam');
		expect(result.body).toContain('Welding');
	});

	it('includes notes and lead time when provided', () => {
		const result = buildTemplateEmailDraft(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			null,
			'Excludes GST',
			'4 weeks'
		);
		expect(result.body).toContain('Excludes GST');
		expect(result.body).toContain('Lead time');
		expect(result.body).toContain('4 weeks');
	});

	it('includes workspace knowledge when provided', () => {
		const mockKnowledge = {
			playbookText: 'Standard 12-month warranty applies'
		} as const;
		const result = buildTemplateEmailDraft(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockKnowledge as any,
			null
		);
		expect(result.body).not.toContain('warranty');
	});

	it('appends the deterministic fallback signature exactly once', () => {
		const result = buildTemplateEmailDraft(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			null,
			null,
			null,
			null,
			'Jane\nTest Co'
		);

		expect(result.body.match(/Jane\nTest Co/g)).toHaveLength(1);
		expect(result.body.endsWith('Jane\nTest Co')).toBe(true);
	});
});

describe('buildEmailDataSection', () => {
	it('includes project content when provided', () => {
		const result = buildEmailDataSection(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			'AU',
			null,
			null,
			null,
			null,
			'Fabricate and install 20 steel beams...'
		);
		expect(result).toContain('Original RFQ description');
		expect(result).toContain('20 steel beams');
	});

	it('starts with Customer field', () => {
		const result = buildEmailDataSection(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			'AU'
		);
		expect(result).toMatch(/^Customer: John/);
	});

	it('includes payment terms when provided', () => {
		const result = buildEmailDataSection(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			'AU',
			null,
			null,
			null,
			null,
			null,
			'30 days from invoice'
		);
		expect(result).toContain('Payment terms: 30 days from invoice');
	});

	it('includes inclusions, exclusions, and standard terms when provided', () => {
		const result = buildEmailDataSection(
			{ rfq_number: 'RFQ-001', project_name: 'Test', contact_name: 'John' },
			'Test Co',
			'Option A',
			15000,
			'$',
			'AU',
			null,
			null,
			null,
			null,
			null,
			null,
			'All materials and labour',
			'GST, site survey',
			'30-day validity'
		);
		expect(result).toContain('Inclusions: All materials and labour');
		expect(result).toContain('Exclusions: GST, site survey');
		expect(result).toContain('Standard terms: 30-day validity');
	});

	describe('buildEmailSystemInstructionForPrompt', () => {
		it('uses locale-specific spelling for AU', () => {
			const systemAU = buildEmailSystemInstructionForPrompt('AU', 'Test Co');
			expect(systemAU).toContain('labour');
			expect(systemAU).toContain('metre');
			expect(systemAU).toContain('AUD');
		});

		it('uses locale-specific spelling for US', () => {
			const systemUS = buildEmailSystemInstructionForPrompt('US', 'Test Co');
			expect(systemUS).toContain('labor');
			expect(systemUS).toContain('meter');
			expect(systemUS).toContain('USD');
		});
	});
});

describe('rewriteQuoteEmailDraft', () => {
	it('uses structured utility output without temperature overrides and appends the signature', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			subject: 'Quote #RFQ-001 — Test Project',
			body: 'Hi John,\n\nThe total is $15,000.00.'
		});

		const result = await rewriteQuoteEmailDraft({
			currentDraft: { subject: 'Old subject', body: 'Old body' },
			payload: { rfq_number: 'RFQ-001', project_name: 'Test Project', contact_name: 'John' },
			businessName: 'Test Co',
			optionLabel: 'Option A',
			totalAmount: 15000,
			currencySymbol: '$',
			countryCode: 'AU',
			emailSignature: 'Jane\nTest Co'
		});

		expect(result.subject).toBe('Quote #RFQ-001 — Test Project');
		expect(result.body).toContain('$15,000.00');
		expect(result.body).toContain('Jane\nTest Co');
		expect(runStructuredUtilityTaskMock).toHaveBeenCalledWith(
			expect.objectContaining({
				taskName: 'rewrite_quote_email',
				enableThinking: false,
				maxOutputTokens: 900,
				workloadClass: 'interactive'
			})
		);
		expect(runStructuredUtilityTaskMock.mock.calls[0][0]).not.toHaveProperty('temperature');
	});

	it('appends the application-owned signature exactly once when the model echoes it', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			subject: 'Quote #RFQ-001 — Test Project',
			body: 'Hi John,\n\nThe total is $15,000.00.\n\nJane\nTest Co'
		});

		const result = await rewriteQuoteEmailDraft({
			currentDraft: {
				subject: 'Quote #RFQ-001 — Test Project',
				body: 'Hi John,\n\nThe total is $15,000.00.\n\nJane\nTest Co'
			},
			payload: { rfq_number: 'RFQ-001', project_name: 'Test Project', contact_name: 'John' },
			businessName: 'Test Co',
			optionLabel: 'Option A',
			totalAmount: 15000,
			currencySymbol: '$',
			countryCode: 'AU',
			emailSignature: 'Jane\nTest Co'
		});

		expect(result.body.match(/Jane\nTest Co/g)).toHaveLength(1);
	});

	it('removes repeated model-echoed signatures before appending the application-owned copy', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			subject: 'Quote #RFQ-001 — Test Project',
			body: 'Hi John,\n\nThe total is $15,000.00.\n\nRegards,\n\nJane\nTest Co\n\nJane\nTest Co'
		});

		const result = await rewriteQuoteEmailDraft({
			currentDraft: { subject: 'Old subject', body: 'Old body' },
			payload: { rfq_number: 'RFQ-001', project_name: 'Test Project', contact_name: 'John' },
			businessName: 'Test Co',
			optionLabel: 'Option A',
			totalAmount: 15000,
			currencySymbol: '$',
			countryCode: 'AU',
			emailSignature: 'Jane\nTest Co'
		});

		expect(result.body.match(/Jane\nTest Co/g)).toHaveLength(1);
		expect(result.body.endsWith('Jane\nTest Co')).toBe(true);
		expect(result.body).not.toContain('Regards,');
	});

	it('rejects a rewrite that drops the exact total without adding a feature-level retry', async () => {
		runStructuredUtilityTaskMock.mockResolvedValue({
			subject: 'Quote',
			body: 'Hi John,\n\nThe total is ready.'
		});

		await expect(
			rewriteQuoteEmailDraft({
				currentDraft: { subject: 'Old subject', body: 'Old body' },
				payload: {
					rfq_number: 'RFQ-001',
					project_name: 'Test Project',
					contact_name: 'John'
				},
				businessName: 'Test Co',
				optionLabel: 'Option A',
				totalAmount: 15000,
				currencySymbol: '$',
				countryCode: 'AU'
			})
		).rejects.toThrow('AI rewrite did not preserve the exact quote total $15,000.00.');

		expect(runStructuredUtilityTaskMock).toHaveBeenCalledTimes(1);
		expect(
			runStructuredUtilityTaskMock.mock.calls[0][0].outputSchema.safeParse({
				subject: 'Quote',
				body: 'Hi John,\n\nThe total is ready.'
			}).success
		).toBe(false);
	});
});
