import { z } from 'zod';

export const EMAIL_AI_CONTRACT_VERSION = 'email-ai-v2';

export const EmailRfqClassificationSchema = z.object({
	verdict: z.enum(['rfq', 'not_rfq'])
});

const optionalText = z.string().trim().nullable().optional();

export const EmailRfqIntakeSchema = z.object({
	company_name: optionalText,
	contact_person: optionalText,
	contact_email: optionalText,
	contact_phone: optionalText,
	project_name: optionalText,
	due_date: optionalText,
	submission_deadline_at: optionalText,
	customer_tender_reference: optionalText,
	rfq_number: optionalText,
	priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).nullable().optional(),
	site_address: optionalText,
	delivery_address: optionalText,
	addendum_label: optionalText,
	addendum_date: optionalText,
	addendum_notes: optionalText,
	internal_notes: optionalText,
	additional_notes: optionalText
});

export const QuoteEmailRewriteSchema = z.object({
	subject: z.string().trim().min(1),
	body: z.string().trim().min(1)
});

export type EmailRfqClassification = z.infer<typeof EmailRfqClassificationSchema>;
export type EmailRfqIntake = z.infer<typeof EmailRfqIntakeSchema>;
export type QuoteEmailRewrite = z.infer<typeof QuoteEmailRewriteSchema>;
