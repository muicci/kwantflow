import { SvelteMap } from 'svelte/reactivity';

import {
	detachedAssetPreviewWindowService,
	type DetachedAssetPreviewNavigationPayload,
	type DetachedAssetPreviewSyncPayload
} from '$lib/services/detached-asset-preview-window.js';
import { createLogger } from '$lib/services/logger.js';

export interface AssetPreviewSelection {
	activeFileId: string | null;
	targetPdfPage: number | null;
	targetCadViewLabel: string | null;
}

const EMPTY_SELECTION: AssetPreviewSelection = {
	activeFileId: null,
	targetPdfPage: null,
	targetCadViewLabel: null
};

interface AssetPreviewRouteAsset {
	id: string;
	project_id: string;
	display_name: string;
}

interface AssetPreviewRouteData {
	assetId?: string | null;
	assets?: AssetPreviewRouteAsset[];
}
const log = createLogger('assetPreviewState');

export function resolveDetachedAssetPreviewTarget(
	routeId: string,
	data: unknown
): DetachedAssetPreviewNavigationPayload | null {
	if (routeId !== '/project/[id]/asset/[assetId]') return null;

	const routeData = data as AssetPreviewRouteData | null;
	if (!routeData?.assetId || !Array.isArray(routeData.assets)) return null;

	const asset = routeData.assets.find((entry) => entry.id === routeData.assetId);
	if (!asset) return null;

	return {
		projectId: asset.project_id,
		assetId: asset.id,
		assetName: asset.display_name
	};
}

class AssetPreviewState {
	private selections = new SvelteMap<string, AssetPreviewSelection>();

	detachedSession: DetachedAssetPreviewNavigationPayload | null = $state(null);

	getSelection(assetId: string): AssetPreviewSelection {
		return this.selections.get(assetId) ?? EMPTY_SELECTION;
	}

	isDetachedActive(): boolean {
		return this.detachedSession !== null;
	}

	isDetachedForAsset(assetId: string): boolean {
		return this.detachedSession?.assetId === assetId;
	}

	finalizeDetachedSession(): boolean {
		if (!this.detachedSession) {
			return false;
		}

		log.info('Finalising detached preview session.', this.detachedSession);
		this.detachedSession = null;
		return true;
	}

	async detach(payload: DetachedAssetPreviewNavigationPayload): Promise<void> {
		log.info('Detach requested.', payload);
		try {
			await detachedAssetPreviewWindowService.open(payload);
			this.detachedSession = payload;
			await this.syncDetached(payload.assetId);
			log.info('Detach request completed.', payload);
		} catch (error) {
			log.warn('Detach request failed.', error);
			this.detachedSession = null;
			throw error;
		}
	}

	async followAsset(payload: DetachedAssetPreviewNavigationPayload): Promise<void> {
		if (!this.detachedSession) return;

		const changed =
			this.detachedSession.projectId !== payload.projectId ||
			this.detachedSession.assetId !== payload.assetId ||
			this.detachedSession.assetName !== payload.assetName;

		if (!changed) return;

		log.info('Following detached preview to a new asset.', {
			from: this.detachedSession,
			to: payload
		});
		this.detachedSession = payload;
		await detachedAssetPreviewWindowService.retarget(payload);
		await this.syncDetached(payload.assetId);
	}

	async reattach(): Promise<void> {
		log.info('Reattach requested.', this.detachedSession);
		this.finalizeDetachedSession();
		await detachedAssetPreviewWindowService.close();
	}

	async syncDetached(assetId?: string): Promise<void> {
		if (!this.detachedSession) return;
		if (assetId && !this.isDetachedForAsset(assetId)) return;

		const payload: DetachedAssetPreviewSyncPayload = {
			...this.detachedSession,
			...this.getSelection(this.detachedSession.assetId)
		};
		log.info('Syncing detached preview session.', payload);
		try {
			await detachedAssetPreviewWindowService.sync(payload);
		} catch (error) {
			// If sync fails (dead webview, timeout), finalise the session so the
			// main window doesn't stay in a detached state with a zombie window.
			log.warn('Detached preview sync failed — finalising session.', error);
			this.finalizeDetachedSession();
		}
	}

	async setSelection(
		assetId: string,
		selection: AssetPreviewSelection,
		options: { syncDetached?: boolean } = {}
	): Promise<void> {
		this.selections.set(assetId, selection);
		log.info('Recorded preview selection.', { assetId, selection, options });

		if (options.syncDetached === false) return;
		if (!this.isDetachedForAsset(assetId)) return;
		await this.syncDetached(assetId);
	}
}

export const assetPreviewState = new AssetPreviewState();
