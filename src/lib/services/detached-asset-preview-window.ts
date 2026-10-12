import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { createLogger } from '$lib/services/logger.js';
import { isTauri } from '$lib/utils/env.js';

export const DETACHED_ASSET_PREVIEW_WINDOW_LABEL = 'asset-preview';
export const ASSET_PREVIEW_NAVIGATE_EVENT = 'asset-preview:navigate';
export const ASSET_PREVIEW_SYNC_EVENT = 'asset-preview:sync';
export const ASSET_PREVIEW_REQUEST_SYNC_EVENT = 'asset-preview:request-sync';
export const ASSET_PREVIEW_SELECTION_CHANGED_EVENT = 'asset-preview:selection-changed';
export const ASSET_PREVIEW_CLOSED_EVENT = 'asset-preview:closed';
const CLOSE_RETRY_DELAY_MS = 120;
const CLOSE_RETRY_LIMIT = 12;

export interface DetachedAssetPreviewNavigationPayload {
	projectId: string;
	assetId: string;
	assetName: string;
}

export interface DetachedAssetPreviewSyncPayload extends DetachedAssetPreviewNavigationPayload {
	activeFileId: string | null;
	targetPdfPage: number | null;
	targetCadViewLabel: string | null;
}

export type DetachedAssetPreviewRoute = `/preview/asset/${string}/${string}`;
const log = createLogger('detachedPreviewWindow');

export function buildDetachedAssetPreviewRoute(
	projectId: string,
	assetId: string
): DetachedAssetPreviewRoute {
	return `/preview/asset/${projectId}/${assetId}`;
}

function buildDetachedAssetPreviewWindowUrl(
	projectId: string,
	assetId: string
): string | DetachedAssetPreviewRoute {
	const route = buildDetachedAssetPreviewRoute(projectId, assetId);
	if (typeof window === 'undefined' || !window.location?.origin) {
		return route;
	}

	return new URL(route, window.location.origin).toString();
}

class DetachedAssetPreviewWindowService {
	private async waitForWindowToClose(): Promise<boolean> {
		for (let attempt = 0; attempt < CLOSE_RETRY_LIMIT; attempt += 1) {
			const existingWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
			if (!existingWindow) return true;
			await new Promise((resolve) => window.setTimeout(resolve, CLOSE_RETRY_DELAY_MS));
		}

		return false;
	}

	private createWindowErrorMessage(event: unknown): string {
		if (event instanceof Error) return event.message;
		if (
			typeof event === 'object' &&
			event !== null &&
			'payload' in event &&
			typeof event.payload === 'string'
		) {
			return event.payload;
		}

		return 'Detached preview window could not be created.';
	}

	private async restoreWindowVisibility(
		window: {
			show: () => Promise<void>;
			unminimize: () => Promise<void>;
			setFocus: () => Promise<void>;
			center?: () => Promise<void>;
		},
		options: { focus: boolean; center: boolean }
	): Promise<void> {
		try {
			await window.show();
		} catch (error) {
			log.warn('Failed to show detached preview window.', error);
		}

		try {
			await window.unminimize();
		} catch (error) {
			log.warn('Failed to unminimise detached preview window.', error);
		}

		if (options.center && window.center) {
			try {
				await window.center();
			} catch (error) {
				log.warn('Failed to centre detached preview window.', error);
			}
		}

		if (!options.focus) return;

		try {
			await window.setFocus();
		} catch (error) {
			log.warn('Failed to focus detached preview window.', error);
		}
	}

	private async emitNavigate(payload: DetachedAssetPreviewNavigationPayload): Promise<void> {
		log.info('Emitting navigate event to detached preview window.', payload);
		await getCurrentWindow().emitTo(
			DETACHED_ASSET_PREVIEW_WINDOW_LABEL,
			ASSET_PREVIEW_NAVIGATE_EVENT,
			payload
		);
	}

	private async createWindow(
		payload: DetachedAssetPreviewNavigationPayload,
		options: { focus: boolean }
	): Promise<void> {
		log.info('Creating detached preview window.', {
			payload,
			focus: options.focus
		});
		const previewWindow = new WebviewWindow(DETACHED_ASSET_PREVIEW_WINDOW_LABEL, {
			url: buildDetachedAssetPreviewWindowUrl(payload.projectId, payload.assetId),
			title: `Preview • ${payload.assetName}`,
			width: 1280,
			height: 900,
			focus: options.focus,
			resizable: true,
			decorations: true,
			center: options.focus
		});

		let createdCleanup: (() => void) | null = null;
		let errorCleanup: (() => void) | null = null;
		let settled = false;

		const cleanupListeners = () => {
			createdCleanup?.();
			errorCleanup?.();
			createdCleanup = null;
			errorCleanup = null;
		};

		const lifecycleResult = new Promise<void>((resolve, reject) => {
			const handleCreated = async () => {
				if (settled) return;
				settled = true;
				cleanupListeners();
				log.info('Detached preview window emitted tauri://created.', payload);
				await this.restoreWindowVisibility(previewWindow, {
					focus: options.focus,
					center: false
				});
				resolve();
			};

			const handleError = async (event: unknown) => {
				if (settled) return;
				settled = true;
				cleanupListeners();
				log.error('Detached preview window emitted tauri://error.', {
					payload,
					event
				});
				reject(new Error(this.createWindowErrorMessage(event)));
			};

			void previewWindow
				.once('tauri://created', () => {
					void handleCreated();
				})
				.then((unlisten) => {
					createdCleanup = unlisten;
				});

			void previewWindow
				.once('tauri://error', (event) => {
					void handleError(event);
				})
				.then((unlisten) => {
					errorCleanup = unlisten;
				});
		});

		await lifecycleResult;
	}

	private async openOrRetarget(
		payload: DetachedAssetPreviewNavigationPayload,
		options: { focus: boolean; recreateIfExisting?: boolean }
	): Promise<void> {
		if (!isTauri()) return;

		const existingWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
		if (existingWindow) {
			if (options.recreateIfExisting) {
				log.info('Retargeting detached preview window for an explicit detach request.', {
					payload
				});
				try {
					const reusedWindow = await invoke<boolean>('retarget_detached_preview_window', {
						route: buildDetachedAssetPreviewRoute(payload.projectId, payload.assetId),
						title: `Preview • ${payload.assetName}`
					});
					if (reusedWindow) {
						return;
					}
				} catch (error) {
					log.warn('Failed to retarget detached preview window from the native bridge.', error);
				}

				log.info('Falling back to close-and-recreate for the detached preview window.', {
					payload
				});
				try {
					await existingWindow.close();
					const closed = await this.waitForWindowToClose();
					if (!closed) {
						log.warn('Detached preview window did not release its label after close.', payload);
					}
				} catch (error) {
					log.warn('Failed to close the stale detached preview window before recreation.', error);
				}

				const recreatedWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
				if (!recreatedWindow) {
					log.info('Detached preview window label released; creating a fresh window.', payload);
					await this.createWindow(payload, options);
					return;
				}
			}

			log.info('Reusing existing detached preview window.', {
				payload,
				focus: options.focus
			});
			await this.emitNavigate(payload);
			await this.restoreWindowVisibility(existingWindow, {
				focus: options.focus,
				center: false
			});
			return;
		}

		log.info('No existing detached preview window found; creating a new one.');
		await this.createWindow(payload, options);
	}

	async open(payload: DetachedAssetPreviewNavigationPayload): Promise<void> {
		await this.openOrRetarget(payload, { focus: true, recreateIfExisting: true });
	}

	async retarget(payload: DetachedAssetPreviewNavigationPayload): Promise<void> {
		await this.openOrRetarget(payload, { focus: false });
	}

	async sync(payload: DetachedAssetPreviewSyncPayload): Promise<void> {
		if (!isTauri()) return;

		// Skip sync if the window is already gone — emitTo to a dead webview can hang.
		const existingWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
		if (!existingWindow) {
			log.warn('Sync skipped — detached preview window no longer exists.');
			return;
		}

		log.info('Syncing detached preview window selection.', payload);

		// Time-box the emit — if the detached webview process is dead, emitTo can stall.
		await Promise.race([
			getCurrentWindow().emitTo(
				DETACHED_ASSET_PREVIEW_WINDOW_LABEL,
				ASSET_PREVIEW_SYNC_EVENT,
				payload
			),
			new Promise<void>((_, reject) =>
				setTimeout(() => reject(new Error('emitTo timed out')), 3000)
			)
		]);
	}

	async isOpen(): Promise<boolean> {
		if (!isTauri()) return false;
		const existingWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
		return Boolean(existingWindow);
	}

	async close(): Promise<void> {
		if (!isTauri()) return;
		const existingWindow = await WebviewWindow.getByLabel(DETACHED_ASSET_PREVIEW_WINDOW_LABEL);
		if (!existingWindow) {
			log.warn('Close requested but detached preview window was not found.');
			return;
		}
		log.info('Closing detached preview window.');
		await existingWindow.close();
	}
}

export const detachedAssetPreviewWindowService = new DetachedAssetPreviewWindowService();
