import { describe, expect, it } from 'vitest';

import {
	buildQuotePdfPagePlan,
	createQuotePdfPackageCacheKey,
	generateQuotePdfBytes,
	type QuotePdfPayload
} from './quote-pdf-document';

function buildPayload(overrides: Partial<QuotePdfPayload> = {}): QuotePdfPayload {
	return {
		rfq_number: 'RFQ-1001',
		contact_name: 'Arcwell Property Group',
		contact: {
			countryCode: 'AU',
			businessIdLabel: 'ABN',
			businessIdValue: '41 234 567 890',
			taxIdLabel: 'GST',
			taxIdValue: ''
		},
		project_name: 'L7 Tenancy Refresh — 155 York St Sydney',
		business: {
			name: 'Kwantflow Pty Ltd',
			businessIdLabel: 'ABN',
			businessIdValue: '12 345 678 901',
			taxIdLabel: 'GST',
			taxIdValue: '',
			taxDisplayLabel: 'GST',
			taxRatePercentage: 10,
			address: '123 Harbour Street\nSydney NSW 2000',
			contactName: 'Sam Owner',
			contactEmail: 'hello@example.test',
			contactPhone: '0400 000 000',
			currencyCode: 'AUD',
			dateFormat: 'en-AU',
			languageLocale: 'en-AU',
			numberLocale: 'en-AU'
		},
		option_label: 'Base scope',
		lead_time: '4 to 6 weeks',
		notes:
			'Occupied tenancy. After-hours access constraints apply. Confirm final joinery and glazing scope before production release.',
		line_items: [
			{
				file_name:
					'Level 7 office and amenities fitout package with after-hours staging constraints and feature wall alternate',
				description:
					'Base scope plus one alternate feature wall required for tender submission. Existing services coordination and occupied-floor access sequencing must be confirmed before fabrication release.',
				quantity: 1,
				lead_time: '4 to 6 weeks from approved shop drawings',
				unit_price: 18550,
				line_total: 18550
			}
		],
		subtotal: 18550,
		gst: 1855,
		total: 20405,
		issued_date: '15/03/2026',
		valid_until_date: '14/04/2026',
		...overrides
	};
}

describe('quote PDF pagination and byte generation', () => {
	it('adds breathing room before the first after-table terms block', async () => {
		const payload = buildPayload();

		const plan = await buildQuotePdfPagePlan(payload);
		const termsSection = plan.pages
			.flatMap((page) => page.sections)
			.find((section) => section.label === 'TERMS & CONDITIONS');

		expect(termsSection?.placement).toBe('postSummary');
		expect(termsSection?.topGap).toBe(10);
	});

	it('keeps totals and payment terms on the final page after long wrapped copy and multipage rows', async () => {
		const payload = buildPayload({
			project_name:
				'Level 7 office and amenities fitout for occupied tenancy with alternate design-development stream, after-hours staging, and base-build services coordination across multiple tenancy zones.',
			notes: Array.from(
				{ length: 18 },
				(_, index) =>
					`Commercial note ${index + 1}: final joinery, glazing, access sequencing, and live-site assumptions remain subject to confirmation before fabrication release.`
			).join('\n'),
			line_items: Array.from({ length: 26 }, (_, index) => ({
				file_name: `Asset ${index + 1} — Occupied tenancy fitout package with staged access planning`,
				description:
					'Demolition allowances, new joinery, glazed meeting rooms, feature wall alternate, and staged after-hours install scope for an occupied commercial floor.',
				quantity: 1,
				lead_time: '6 to 8 weeks from approved shop drawings',
				unit_price: 4250 + index * 115,
				line_total: 4250 + index * 115
			}))
		});

		const subtotal = payload.line_items.reduce((sum, item) => sum + item.line_total, 0);
		payload.subtotal = subtotal;
		payload.gst = subtotal * 0.1;
		payload.total = payload.subtotal + payload.gst;

		const plan = await buildQuotePdfPagePlan(payload);
		const lastPage = plan.pages.at(-1)!;

		expect(plan.pages.length).toBeGreaterThan(1);
		expect(lastPage.summary).toBeDefined();
		expect(lastPage.paymentTerms).toBe('Payment Terms: Due on receipt.');
		expect(plan.pages.slice(0, -1).every((page) => !page.summary)).toBe(true);
		expect(plan.pages.slice(0, -1).every((page) => !page.paymentTerms)).toBe(true);
	});

	it('creates additional pages when the line-item table overflows and repeats the table header', async () => {
		const payload = buildPayload({
			line_items: Array.from({ length: 40 }, (_, index) => ({
				file_name: `Asset ${index + 1} — Level 7 amenities and office fitout package`,
				description:
					'Occupied-floor staging, feature wall alternate, and service coordination scope requiring wrapped copy across multiple lines.',
				quantity: (index % 3) + 1,
				lead_time: '4 to 6 weeks from approved shop drawings',
				unit_price: 1500 + index * 37,
				line_total: (1500 + index * 37) * ((index % 3) + 1)
			})),
			subtotal: 0,
			gst: 0,
			total: 0
		});

		const subtotal = payload.line_items.reduce((sum, item) => sum + item.line_total, 0);
		payload.subtotal = subtotal;
		payload.gst = subtotal * 0.1;
		payload.total = payload.subtotal + payload.gst;

		const plan = await buildQuotePdfPagePlan(payload);

		expect(plan.pages.length).toBeGreaterThan(1);
		expect(
			plan.pages.every(
				(page) =>
					page.lineItems.length === 0 ||
					(page as { pricingTable?: { showsHeader: boolean } }).pricingTable?.showsHeader
			)
		).toBe(true);
		expect(plan.pages.at(-1)?.summary).toBeDefined();
		expect(plan.pages.slice(0, -1).every((page) => !page.summary)).toBe(true);
	});

	it('generates bytes successfully for long AU header values and wide currency amounts', async () => {
		const payload = buildPayload({
			option_label:
				'Base scope with after-hours access staging, feature wall alternate, and client-supplied joinery coordination allowance',
			lead_time: '10 to 12 weeks from approved shop drawings and final commercial sign-off',
			line_items: [
				{
					file_name: 'Main fitout package',
					description:
						'Primary office, reception, amenities, and glazed meeting-room works with coordination and staged access constraints.',
					quantity: 1,
					lead_time: '10 to 12 weeks from approved shop drawings',
					unit_price: 1234567.89,
					line_total: 1234567.89
				}
			],
			subtotal: 1234567.89,
			gst: 123456.789,
			total: 1358024.679
		});

		const bytes = await generateQuotePdfBytes(payload);

		expect(bytes.byteLength).toBeGreaterThan(1000);
	});

	it('uses a stable cache key for the same payload and attachment list', () => {
		const payload = buildPayload();
		const drawings = ['workspace/project-1/drawing-a.pdf', 'workspace/project-1/drawing-b.pdf'];

		expect(createQuotePdfPackageCacheKey(payload, drawings)).toBe(
			createQuotePdfPackageCacheKey(buildPayload(), drawings)
		);
	});
});
