import type { PageLoad } from './$types.js';

export const ssr = false;

export const load: PageLoad = ({ params }) => {
	return {
		projectId: params.projectId,
		assetId: params.assetId
	};
};
