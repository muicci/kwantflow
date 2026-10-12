import { describe, expect, it } from 'vitest';

import type { Estimate } from '$lib/types/index.js';
import { cloneEstimateSnapshot } from '$lib/utils/estimate-snapshot.js';

function proxifyDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return new Proxy(value.map((entry) => proxifyDeep(entry)) as T & object, {});
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			proxifyDeep(entry)
		]);
		return new Proxy(Object.fromEntries(entries) as T & object, {});
	}
	return value;
}

describe('cloneEstimateSnapshot', () => {
	it('produces a structured-clone-safe estimate from proxied estimate state', () => {
		const estimate: Estimate = {
			asset_id: 'asset-1',
			scope_summary: 'Canopy package',
			notes: 'Needs review',
			classification_system_id: 'class-1',
			wbs_root_node_id: null,
			applied_template_id: 'template-1',
			applied_template_name: 'QA Template',
			currency_code: null,
			takeoff_items: [
				{
					id: 'item-1',
					estimate_asset_id: 'asset-1',
					parent_id: null,
					wbs_node_id: null,
					cost_code_id: 'cost-1',
					applied_preset_id: 'preset-1',
					applied_preset_name: 'QA Preset',
					name: 'Canopy core',
					description: 'Main scaffold',
					quantity: 1,
					unit: 'ea',
					properties: { ai_open_questions: ['Confirm fixing details'] },
					sort_order: 0,
					cost_components: [
						{
							id: 'component-1',
							takeoff_item_id: 'item-1',
							category: 'labour',
							source_type: 'labour_rate_card',
							source_id: 'labour-1',
							name: 'Installer crew',
							description: 'Install',
							quantity: 8,
							unit: 'hr',
							unit_rate: 95,
							source_unit_rate_decimal: null,
							source_currency_code: null,
							fx_rate_snapshot_id: null,
							formula: { mode: 'fixed' },
							metadata: { ai_mapping_status: 'linked' },
							sort_order: 0
						}
					]
				}
			]
		};

		const proxiedEstimate = proxifyDeep(estimate);
		const snapshot = cloneEstimateSnapshot(proxiedEstimate);

		expect(snapshot).toEqual(estimate);
		expect(() => structuredClone(snapshot)).not.toThrow();
	});
});
