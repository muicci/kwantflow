import { explorerState } from '$lib/state/explorer.svelte.js';

export async function load({ params }: { params: { fileId: string } }) {
	return {
		previewFile: await explorerState.getPreviewFile(params.fileId)
	};
}
