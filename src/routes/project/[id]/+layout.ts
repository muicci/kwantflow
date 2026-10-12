import type { LayoutLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { projectsState } from '$lib/state/projects.svelte';
import { loadProjectRouteWithRecovery } from '$lib/utils/project-route-recovery.js';

export const ssr = false;

export const load: LayoutLoad = async ({ params, url }) => {
	const projectId = params.id;
	const assetId = params.assetId;
	const isDetachedPreview = /^\/project\/[^/]+\/asset\/[^/]+\/preview\/?$/.test(url.pathname);

	if (isDetachedPreview) {
		try {
			return await loadProjectRouteWithRecovery(() =>
				projectsState.loadDetachedPreviewShell(projectId)
			);
		} catch {
			throw error(404, 'RFQ not found');
		}
	}

	try {
		return await loadProjectRouteWithRecovery(async () => {
			const shell = await projectsState.loadWorkspaceShell(projectId);
			if (assetId && !shell.assets.some((asset) => asset.id === assetId)) {
				throw new Error('Asset not found in RFQ workspace shell');
			}
			return shell;
		});
	} catch {
		throw error(404, 'RFQ not found');
	}
};
