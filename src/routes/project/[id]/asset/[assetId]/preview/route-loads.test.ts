import { describe, expect, it } from 'vitest';

describe('asset preview route load', () => {
	it('redirects legacy project-scoped preview routes to the standalone detached preview surface', async () => {
		const mod = await import('./+page');
		try {
			mod.load({
				params: { id: 'project-1', assetId: 'asset-1' }
			} as never);
			throw new Error('Expected load to redirect.');
		} catch (error) {
			expect(error).toMatchObject({
				status: 307,
				location: '/preview/asset/project-1/asset-1'
			});
		}
	});
});
