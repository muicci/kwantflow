/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
	buildQuotePdfPagePlan,
	resolveQuotePdfRenderConfig,
	generateQuotePdfBytes,
	resolveTaxIdentifierCountryCode,
	formatDocumentDate,
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

describe('quote PDF document planning', () => {
	it('falls back to a default asset label when the item file name is empty or missing', async () => {
		const payload = buildPayload({
			line_items: [
				{
					file_name: '',
					description: 'Test description',
					quantity: 1,
					line_total: 1000,
					total_cents: 1000
				},
				{
					description: 'Test description without file_name',
					quantity: 2,
					line_total: 2000,
					total_cents: 2000
				} as any
			]
		});

		const plan = await buildQuotePdfPagePlan(payload);
		const lineItems = plan.pages.flatMap((page) => page.lineItems) as Array<{
			descriptionLines: Array<{ text: string }>;
		}>;

		expect(lineItems[0]!.descriptionLines.map((line) => line.text).join(' ')).toContain(
			'Quoted item'
		);
		expect(lineItems[1]!.descriptionLines.map((line) => line.text).join(' ')).toContain(
			'Quoted item'
		);
	});

	it('keeps the Kwantflow footer mark visually aligned with the prepared-by text', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/services/quote-pdf-document.ts'),
			'utf8'
		);

		expect(source).toContain('const FOOTER_LOGO_SIZE = 7.2;');
		expect(source).toContain('y: baselineY - dimensions.height * 0.18');
	});

	it('builds the first page around the default commercial quote template regions', async () => {
		const payload = buildPayload();

		const plan = await buildQuotePdfPagePlan(payload);
		const firstPage = plan.pages[0] as {
			header?: {
				title: string;
				businessName: string;
				customerNameLines: string[];
				customerDetails: { lines: Array<{ text: string; tone: string }> };
				businessDetails: { lines: Array<{ text: string; tone: string }> };
			};
			pricingTable?: { columns: Array<{ label: string }> };
			paymentTerms?: string;
			sections: Array<{ label: string }>;
		};

		expect(plan.templateId).toBe('default');
		expect(firstPage.header?.title).toBe('QUOTE');
		expect(firstPage.header?.businessName).toBe(payload.business.name);
		expect(firstPage.header?.customerNameLines.join(' ')).toContain(payload.contact_name!);
		expect(firstPage.header?.customerDetails.lines.map((line) => line.text)).toEqual([
			'Quote number: RFQ-1001',
			'Date: 15 Mar 2026',
			'Quote valid until: 14 Apr 2026'
		]);
		expect(firstPage.header?.businessDetails.lines.map((line) => line.text)).toEqual([
			'Sam Owner',
			'hello@example.test',
			'0400 000 000',
			'ABN: 12 345 678 901',
			'123 Harbour Street',
			'Sydney NSW 2000'
		]);
		expect(firstPage.pricingTable?.columns.map((column) => column.label)).toEqual([
			'Description',
			'Price',
			'Quantity',
			'Amount'
		]);
		expect(firstPage.sections.map((section) => section.label)).toEqual([
			'PROJECT / SITE',
			'COMMERCIAL SUMMARY',
			'TERMS & CONDITIONS'
		]);
		expect(firstPage.sections.some((section) => section.label === 'TERMS & CONDITIONS')).toBe(true);
		expect(firstPage.paymentTerms).toBe('Payment Terms: Due on receipt.');
	});

	it('expands the first-page detail tables for long contact and business values before the body starts', async () => {
		const payload = buildPayload({
			contact_name:
				'Northbridge Commercial Interiors and Workplace Delivery Consortium for Stage 4 Occupied Fitout Works',
			business: {
				name: 'Northbridge Commercial Interiors Pty Ltd',
				businessIdLabel: 'ABN',
				businessIdValue: '61 234 567 890',
				taxIdLabel: 'GST',
				taxIdValue: '',
				taxDisplayLabel: 'GST',
				taxRatePercentage: 10,
				address: 'Suite 8, Level 24, 420 Clarence Street, Sydney NSW 2000, Australia',
				contactName: 'Northbridge Estimating',
				contactEmail: 'estimating-team-and-commercial-operations@northbridge.example',
				contactPhone: '02 8000 1234',
				currencyCode: 'AUD',
				dateFormat: 'en-AU',
				languageLocale: 'en-AU',
				numberLocale: 'en-AU'
			}
		});

		const plan = await buildQuotePdfPagePlan(payload);
		const firstPage = plan.pages[0]!;

		expect(firstPage.header?.customerNameLines.length).toBeGreaterThan(1);
		expect(
			firstPage.header?.businessDetails.lines.some((line) =>
				line.text.includes('estimating-team-and-commercial-operations')
			)
		).toBe(true);
		expect(firstPage.header?.bottomY).toBeGreaterThan(firstPage.header?.customerTop ?? 0);
		expect(firstPage.sections[0]?.label).toBe('PROJECT / SITE');
	});

	it('combines asset identity into the description column and keeps tax only in totals', async () => {
		const payload = buildPayload();

		const plan = await buildQuotePdfPagePlan(payload);
		const firstRow = plan.pages.flatMap((page) => page.lineItems)[0] as {
			descriptionLines: Array<string | { text: string }>;
		};

		expect(firstRow).toBeDefined();
		expect(
			firstRow.descriptionLines
				.map((line) => (typeof line === 'string' ? line : line.text))
				.join(' ')
		).toContain('Level 7 office and amenities fitout package');
		expect(
			firstRow.descriptionLines
				.map((line) => (typeof line === 'string' ? line : line.text))
				.join(' ')
		).toContain('fabrication release');
		expect(
			plan.pages
				.flatMap((page) => page.sections)
				.filter((section) => section.label === 'TERMS & CONDITIONS')
				.flatMap((section) => section.lines)
				.join(' ')
		).toContain('glazing scope before production release');
	});

	it('omits empty optional business and tax identifier rows instead of printing N/A', async () => {
		const payload = buildPayload({
			contact: {
				countryCode: 'AU',
				businessIdLabel: 'ABN',
				businessIdValue: null,
				taxIdLabel: 'GST',
				taxIdValue: null
			},
			business: {
				name: 'Kwantflow Pty Ltd',
				businessIdLabel: 'ABN',
				businessIdValue: '',
				taxIdLabel: 'GST',
				taxIdValue: '',
				taxDisplayLabel: 'GST',
				taxRatePercentage: 10,
				address: '',
				contactName: '',
				contactEmail: 'hello@example.test',
				contactPhone: '',
				currencyCode: 'AUD',
				dateFormat: 'en-AU',
				languageLocale: 'en-AU',
				numberLocale: 'en-AU'
			}
		});

		const plan = await buildQuotePdfPagePlan(payload);
		const firstPage = plan.pages[0]!;

		expect(firstPage.header?.customerDetails.lines.map((row) => row.text)).toEqual([
			'Quote number: RFQ-1001',
			'Date: 15 Mar 2026',
			'Quote valid until: 14 Apr 2026'
		]);
		expect(firstPage.header?.businessDetails.lines.map((row) => row.text)).toEqual([
			'hello@example.test'
		]);
	});

	it('suppresses separate GST identifier rows for AU contacts and businesses even when legacy tax ids exist', async () => {
		const payload = buildPayload({
			contact: {
				countryCode: 'AU',
				businessIdLabel: 'ABN',
				businessIdValue: 'CUST-001',
				taxIdLabel: 'GST',
				taxIdValue: '51 123 456 789'
			},
			business: {
				...buildPayload().business,
				countryCode: 'AU',
				taxIdLabel: 'GST',
				taxIdValue: '11 222 333 444'
			}
		});

		const plan = await buildQuotePdfPagePlan(payload);
		const firstPage = plan.pages[0]!;

		expect(firstPage.header?.customerDetails.lines.map((row) => row.text)).toEqual([
			'Quote number: RFQ-1001',
			'Date: 15 Mar 2026',
			'Quote valid until: 14 Apr 2026'
		]);
		expect(firstPage.header?.businessDetails.lines.map((row) => row.text)).toEqual([
			'Sam Owner',
			'hello@example.test',
			'0400 000 000',
			'ABN: 12 345 678 901',
			'123 Harbour Street',
			'Sydney NSW 2000'
		]);
	});

	it('suppresses separate GST identifier rows when the contact country is missing but the business country is AU', async () => {
		const payload = buildPayload({
			contact: {
				countryCode: null,
				businessIdLabel: 'ABN',
				businessIdValue: 'CUST-001',
				taxIdLabel: 'GST',
				taxIdValue: '51 123 456 789'
			},
			business: {
				...buildPayload().business,
				countryCode: 'AU',
				taxIdLabel: 'GST',
				taxIdValue: '11 222 333 444'
			}
		});

		const plan = await buildQuotePdfPagePlan(payload);
		const firstPage = plan.pages[0]!;

		expect(firstPage.header?.customerDetails.lines.map((row) => row.text)).toEqual([
			'Quote number: RFQ-1001',
			'Date: 15 Mar 2026',
			'Quote valid until: 14 Apr 2026'
		]);
		expect(firstPage.header?.businessDetails.lines.map((row) => row.text)).toEqual([
			'Sam Owner',
			'hello@example.test',
			'0400 000 000',
			'ABN: 12 345 678 901',
			'123 Harbour Street',
			'Sydney NSW 2000'
		]);
	});

	it('does not embed external web links in the exported PDF footer', async () => {
		const bytes = await generateQuotePdfBytes(buildPayload());
		const pdfDoc = await PDFDocument.load(bytes);
		const firstPage = pdfDoc.getPages()[0]!;

		expect(firstPage.node.Annots()?.size() ?? 0).toBe(0);
	});
});

describe('resolveTaxIdentifierCountryCode', () => {
	it('returns the primary country code when both are provided', () => {
		expect(resolveTaxIdentifierCountryCode('US', 'AU')).toBe('US');
	});

	it('returns the fallback country code when primary is null', () => {
		expect(resolveTaxIdentifierCountryCode(null, 'AU')).toBe('AU');
	});

	it('returns the fallback country code when primary is undefined', () => {
		expect(resolveTaxIdentifierCountryCode(undefined, 'AU')).toBe('AU');
	});

	it('returns the fallback country code when primary is an empty string', () => {
		expect(resolveTaxIdentifierCountryCode('   ', 'AU')).toBe('AU');
	});

	it('returns null when both are missing', () => {
		expect(resolveTaxIdentifierCountryCode(null, undefined)).toBeNull();
		expect(resolveTaxIdentifierCountryCode('', '  ')).toBeNull();
	});

	it('normalises and trims country codes', () => {
		expect(resolveTaxIdentifierCountryCode(' us ', 'AU')).toBe('us');
		expect(resolveTaxIdentifierCountryCode(null, ' au ')).toBe('au');
	});
});

describe('resolveQuotePdfRenderConfig', () => {
	it('should return default config when undefined is provided', () => {
		const result = resolveQuotePdfRenderConfig(undefined);
		expect(result).toEqual({ templateId: 'default' });
	});

	it('should return default templateId when empty object is provided', () => {
		const result = resolveQuotePdfRenderConfig({});
		expect(result).toEqual({ templateId: 'default' });
	});

	it('should use provided templateId when valid config is passed', () => {
		const result = resolveQuotePdfRenderConfig({ templateId: 'custom-template' as any });
		expect(result).toEqual({ templateId: 'custom-template' });
	});
});

describe('formatDocumentDate', () => {
	it('formats valid date strings correctly with defaults', () => {
		expect(formatDocumentDate('15/03/2026')).toBe('15 Mar 2026');
		// Also works with YYYY-MM-DD
		expect(formatDocumentDate('2026-03-15')).toBe('15 Mar 2026');
		// Full ISO string fails the simple regex in parseDocumentDate and goes to splitting by '/', then falling back to fallback
		expect(formatDocumentDate('2026-03-15T12:00:00Z')).toBe('01 Jan 2000');
	});

	it('handles valid date strings correctly with specific formatting locales', () => {
		// With en-US it assumes MM/DD/YYYY and formats appropriately
		expect(formatDocumentDate('03/15/2026', 'en-US', 'en-US', 'en-US')).toBe('Mar 15, 2026');
	});

	it('falls back to defaults when parameters are null or undefined', () => {
		expect(formatDocumentDate('15/03/2026', null, null, null)).toBe('15 Mar 2026');
		expect(formatDocumentDate('15/03/2026', undefined, undefined, undefined)).toBe('15 Mar 2026');
	});

	it('returns a fallback date if the date cannot be parsed', () => {
		expect(formatDocumentDate('invalid date')).toBe('01 Jan 2000');
		expect(formatDocumentDate('')).toBe('01 Jan 2000');
	});

	it('returns 1970 for null value and throws RangeError for undefined value (typed as string but possible in JS)', () => {
		// Testing robustness for potential bad inputs from JS side
		expect(formatDocumentDate(null as unknown as string)).toBe('01 Jan 1970');
		expect(() => formatDocumentDate(undefined as unknown as string)).toThrow(RangeError);
	});
});
