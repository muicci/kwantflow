import { describe, it, expect } from 'vitest';

describe('material key fix verification', () => {
	it('proves materials flow through normalisation with American spelling key', async () => {
		const { normaliseAiTableSnapshot } = await import('$lib/services/estimate-ai-context.js');

		// This simulates what the editor now produces after the fix:
		// materialCatalogItems (American spelling) → matches normalizer
		const snapshot = normaliseAiTableSnapshot({
			classificationSystems: [
				{ id: 'cs-1', code: 'STEEL', name: 'Steel', type: 'custom', is_default: true }
			],
			costCodes: [],
			wbsNodes: [],
			materialCatalogItems: [
				{
					id: 'mat-1',
					code: 'PL-6',
					name: 'Plate 6mm',
					aliases: [],
					category: 'Plate',
					specification: 'AS/NZS',
					unit: 'ea',
					default_rate: 25,
					metadata: {},
					is_active: true
				}
			],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: []
		});

		// This would have returned [] before the fix
		expect(snapshot.materialCatalogItems).toHaveLength(1);
		expect(snapshot.materialCatalogItems[0].code).toBe('PL-6');
	});
});
