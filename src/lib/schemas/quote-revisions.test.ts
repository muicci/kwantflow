import { describe, expect, it } from 'vitest';

import { QuoteRevisionOptionRowSchema, QuoteRevisionRowSchema } from './index.js';

describe('quote revision schemas', () => {
	it('parses quote revision rows', () => {
		const result = QuoteRevisionRowSchema.safeParse({
			id: 'rev-1',
			project_id: 'proj-1',
			revision_number: 1,
			revision_label: 'Rev 1',
			rfq_number_snapshot: 'RFQ-1001',
			contact_name_snapshot: 'Atlas Structural',
			contact_country_code_snapshot: 'AU',
			contact_business_id_label_snapshot: 'ABN',
			contact_business_id_value_snapshot: '84 921 450 101',
			contact_tax_id_label_snapshot: 'GST',
			contact_tax_id_value_snapshot: '',
			project_name_snapshot: 'Warehouse Mezzanine Package',
			business_name_snapshot: 'Southern Estimating',
			business_abn_snapshot: '51 824 753 556',
			business_id_label_snapshot: 'ABN',
			business_id_value_snapshot: '51 824 753 556',
			tax_id_label_snapshot: 'GST',
			tax_id_value_snapshot: '',
			tax_display_label_snapshot: 'GST',
			tax_rate_percentage_snapshot: 10,
			business_address_snapshot: '14 Foundry Road',
			business_contact_name_snapshot: 'Sam Owner',
			business_email_snapshot: 'estimating@example.test',
			business_contact_phone_snapshot: '0400 000 000',
			currency_code_snapshot: 'AUD',
			currency_symbol_snapshot: '$',
			issued_date: '10/03/2026',
			valid_until_date: '09/04/2026',
			package_attachments_json:
				'[{"file_id":"file-1","file_name":"Drawing A.pdf","status":"appended","reason":null}]',
			created_at: '2026-03-10T10:00:00Z',
			updated_at: '2026-03-10T10:00:00Z'
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.package_attachments_json).toEqual([
			{
				file_id: 'file-1',
				file_name: 'Drawing A.pdf',
				status: 'appended',
				reason: null
			}
		]);
	});

	it('parses quote revision option rows with line item json', () => {
		const result = QuoteRevisionOptionRowSchema.safeParse({
			id: 'rev-opt-1',
			revision_id: 'rev-1',
			source_quote_option_id: 'opt-1',
			label: 'Standard',
			lead_time: '3 weeks',
			markup_percentage: 12.5,
			notes: 'Fabrication and primer only',
			sort_order: 0,
			is_default: 1,
			is_selected: 1,
			line_items_json:
				'[{"file_name":"Column Package","description":"Fabricate support columns","quantity":1,"lead_time":"3 weeks","unit_price":4250,"line_total":4250}]',
			subtotal_amount: 4250,
			gst_amount: 425,
			total_amount: 4675,
			created_at: '2026-03-10T10:00:00Z',
			updated_at: '2026-03-10T10:00:00Z'
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.line_items_json).toHaveLength(1);
		expect(result.data.line_items_json[0]?.file_name).toBe('Column Package');
	});

	it('parses quote revision option rows with negative discount markup', () => {
		const result = QuoteRevisionOptionRowSchema.safeParse({
			id: 'rev-opt-2',
			revision_id: 'rev-1',
			source_quote_option_id: 'opt-2',
			label: 'Discounted',
			lead_time: '3 weeks',
			markup_percentage: -10,
			notes: 'Trade discount applied',
			sort_order: 1,
			is_default: 0,
			is_selected: 0,
			line_items_json: '[]',
			subtotal_amount: 4250,
			gst_amount: 382.5,
			total_amount: 4207.5,
			created_at: '2026-03-10T10:00:00Z',
			updated_at: '2026-03-10T10:00:00Z'
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.markup_percentage).toBe(-10);
	});
});
