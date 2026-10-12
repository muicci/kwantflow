import type { PageLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { classificationSystemsState } from '$lib/state/classification-systems.svelte.js';

export const load: PageLoad = async ({ params, parent }) => {
	const data = await parent();
	const asset = data.assets.find((entry) => entry.id === params.assetId);

	if (!asset) {
		throw error(404, 'Asset not found');
	}

	return {
		assetId: params.assetId,
		...(await classificationSystemsState.loadWorkspaceReferenceData(data.project.id))
	};
};
