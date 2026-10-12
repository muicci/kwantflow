import type { PageLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';

import { buildDetachedAssetPreviewRoute } from '$lib/services/detached-asset-preview-window.js';

export const ssr = false;

export const load: PageLoad = ({ params }) => {
	throw redirect(307, buildDetachedAssetPreviewRoute(params.id, params.assetId));
};
