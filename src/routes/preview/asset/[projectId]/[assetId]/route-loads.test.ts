import { describe, expect, it } from 'vitest';

describe('standalone detached asset preview route load', () => {
	it('returns the detached preview route identifiers without requiring route-level DB access', async () => {
		const mod = await import('./+page');

		const result = await mod.load({
			params: { projectId: 'project-1', assetId: 'asset-1' }
		} as never);

		expect(result).toEqual({
			projectId: 'project-1',
			assetId: 'asset-1'
		});
	});
});
