import { describe, expect, it } from 'vitest';
import { MaterialCatalogueItemRowSchema } from './index.js';

describe('MaterialCatalogueItemRowSchema aliases_json', () => {
	it('handles invalid aliases_json gracefully', () => {
		const result = MaterialCatalogueItemRowSchema.safeParse({
			id: '123',
			workspace_id: 'ws_1',
			code: 'M-001',
			name: 'Test Material',
			category: null,
			specification: null,
			unit: 'ea',
			default_rate: 10,
			currency_code: 'USD',
			aliases_json: '[invalid',
			metadata_json: '{}',
			effective_date: null,
			verified_date: null,
			rate_basis: 'cost',
			lead_time: '',
			availability: '',
			reference: '',
			is_active: 1,
			created_at: '2023-01-01T00:00:00Z',
			updated_at: '2023-01-01T00:00:00Z'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.aliases_json).toEqual([]);
		}
	});

	it('parses valid aliases_json correctly', () => {
		const result = MaterialCatalogueItemRowSchema.safeParse({
			id: '123',
			workspace_id: 'ws_1',
			code: 'M-001',
			name: 'Test Material',
			category: null,
			specification: null,
			unit: 'ea',
			default_rate: 10,
			currency_code: 'USD',
			aliases_json: '["alias1", "alias2"]',
			metadata_json: '{}',
			effective_date: null,
			verified_date: null,
			rate_basis: 'cost',
			lead_time: '',
			availability: '',
			reference: '',
			is_active: 1,
			created_at: '2023-01-01T00:00:00Z',
			updated_at: '2023-01-01T00:00:00Z'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.aliases_json).toEqual(['alias1', 'alias2']);
		}
	});

	it('handles non-string aliases_json gracefully', () => {
		const result = MaterialCatalogueItemRowSchema.safeParse({
			id: '123',
			workspace_id: 'ws_1',
			code: 'M-001',
			name: 'Test Material',
			category: null,
			specification: null,
			unit: 'ea',
			default_rate: 10,
			currency_code: 'USD',
			aliases_json: ['alias1', 'alias2'],
			metadata_json: '{}',
			effective_date: null,
			verified_date: null,
			rate_basis: 'cost',
			lead_time: '',
			availability: '',
			reference: '',
			is_active: 1,
			created_at: '2023-01-01T00:00:00Z',
			updated_at: '2023-01-01T00:00:00Z'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.aliases_json).toEqual(['alias1', 'alias2']);
		}
	});
});
