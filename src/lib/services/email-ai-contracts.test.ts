import { describe, expect, it } from 'vitest';
import {
	EMAIL_AI_CONTRACT_VERSION,
	EmailRfqClassificationSchema,
	EmailRfqIntakeSchema,
	QuoteEmailRewriteSchema
} from './email-ai-contracts.js';

describe('email AI contracts', () => {
	it('uses one explicit version for durable classification results', () => {
		expect(EMAIL_AI_CONTRACT_VERSION).toBe('email-ai-v2');
	});

	it('keeps classification binary', () => {
		expect(EmailRfqClassificationSchema.parse({ verdict: 'rfq' })).toEqual({ verdict: 'rfq' });
		expect(() => EmailRfqClassificationSchema.parse({ verdict: 'unknown' })).toThrow();
	});

	it('does not include attachment evidence in the intake output contract', () => {
		expect('attachments' in EmailRfqIntakeSchema.shape).toBe(false);
	});

	it('requires both editable quote fields', () => {
		expect(QuoteEmailRewriteSchema.parse({ subject: 'Quote', body: 'Hello' })).toEqual({
			subject: 'Quote',
			body: 'Hello'
		});
	});
});
