import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadWorkspaceReferenceData = vi.fn();

vi.mock('$lib/state/classification-systems.svelte', () => ({
	classificationSystemsState: {
		loadWorkspaceReferenceData
	}
}));

describe('project route loaders', () => {
	beforeEach(() => {
		loadWorkspaceReferenceData.mockReset();
	});

	it('overview load does not fetch estimate editor reference data', async () => {
		const mod = await import('./+page');
		const result = await mod.load();
		expect(result).toEqual({});
		expect(loadWorkspaceReferenceData).not.toHaveBeenCalled();
	});

	it('asset load resolves the asset and fetches reference data for the project', async () => {
		loadWorkspaceReferenceData.mockResolvedValue({
			classificationSystems: [{ id: 'classification-1', name: 'Custom' }],
			costCodes: [],
			wbsNodes: [],
			materialCatalogueItems: [],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: [],
			estimateTemplates: []
		});

		const mod = await import('./asset/[assetId]/+page');
		const result = await mod.load({
			params: { id: 'project-1', assetId: 'asset-1' },
			parent: vi.fn().mockResolvedValue({
				project: { id: 'project-1' },
				assets: [{ id: 'asset-1', display_name: 'Asset One' }]
			})
		} as unknown as Parameters<typeof mod.load>[0]);

		expect(loadWorkspaceReferenceData).toHaveBeenCalledWith('project-1');
		expect(result).toMatchObject({
			assetId: 'asset-1',
			classificationSystems: [{ id: 'classification-1', name: 'Custom' }]
		});
	});
});
