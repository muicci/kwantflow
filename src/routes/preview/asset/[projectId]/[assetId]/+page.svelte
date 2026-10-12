<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';

	import MultiFileViewer from '$lib/components/assets/MultiFileViewer.svelte';
	import { Text } from '$lib/components/primitives/index.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import {
		ASSET_PREVIEW_CLOSED_EVENT,
		ASSET_PREVIEW_NAVIGATE_EVENT,
		ASSET_PREVIEW_REQUEST_SYNC_EVENT,
		ASSET_PREVIEW_SELECTION_CHANGED_EVENT,
		ASSET_PREVIEW_SYNC_EVENT,
		buildDetachedAssetPreviewRoute
	} from '$lib/services/detached-asset-preview-window.js';
	import { isTauri } from '$lib/utils/env.js';
	import { createLogger } from '$lib/services/logger.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const log = createLogger('detachedPreviewRoute');
	let asset = $state<Awaited<ReturnType<typeof projectsState.loadDetachedPreviewAsset>>>(null);
	let isLoading = $state(true);
	let activeFileId = $state<string | null>(null);
	let targetPdfPage = $state<number | null>(null);
	let targetCadViewLabel = $state<string | null>(null);
	let fullscreen = $state(false);
	let isClosing = $state(false);
	let lastSelectionSignature = '';
	let lastRequestedAssetId = '';
	let lastLoadedKey = '';

	function setDocumentTitle(title: string): void {
		if (typeof document === 'undefined') return;
		document.title = title;
	}

	async function setPreviewWindowTitle(title: string): Promise<void> {
		setDocumentTitle(title);
		if (!isTauri()) return;
		try {
			await getCurrentWindow().setTitle(title);
		} catch (error) {
			log.warn('Detached preview route could not update the preview window title.', {
				title,
				error
			});
		}
	}

	async function loadAsset(projectId: string, assetId: string) {
		isLoading = true;
		try {
			// Restore the saved preview theme so the viewer background matches
			// the user's preference across main and detached windows.
			await appState.restorePreviewTheme();

			const nextAsset = await projectsState.loadDetachedPreviewAsset(projectId, assetId);
			asset = nextAsset;
			if (!nextAsset) {
				log.warn('Detached preview route could not load the selected asset.', {
					projectId,
					assetId
				});
			}
		} catch (error) {
			log.error('Detached preview route failed to load the selected asset.', {
				projectId,
				assetId,
				error
			});
			asset = null;
		} finally {
			isLoading = false;
		}
	}

	function selectionSignature(selection: {
		activeFileId: string | null;
		targetPdfPage: number | null;
		targetCadViewLabel: string | null;
	}): string {
		return [
			selection.activeFileId ?? '',
			String(selection.targetPdfPage ?? ''),
			selection.targetCadViewLabel ?? ''
		].join('|');
	}

	async function requestSync(assetId: string) {
		if (!isTauri()) return;
		await getCurrentWindow().emitTo('main', ASSET_PREVIEW_REQUEST_SYNC_EVENT, { assetId });
	}

	async function notifyMainWindowPreviewClosed() {
		if (!isTauri() || !asset) return;
		const currentAsset = asset;
		await getCurrentWindow().emitTo('main', ASSET_PREVIEW_CLOSED_EVENT, {
			assetId: currentAsset.id
		});
	}

	async function returnPreviewToMain() {
		if (!isTauri() || isClosing) return;
		const currentWindow = getCurrentWindow();
		isClosing = true;
		try {
			await notifyMainWindowPreviewClosed();
			await currentWindow.close();
		} catch (error) {
			isClosing = false;
			throw error;
		}
	}

	async function toggleFullscreen() {
		if (!isTauri()) return;
		const currentWindow = getCurrentWindow();
		await currentWindow.setFullscreen(!fullscreen);
		fullscreen = await currentWindow.isFullscreen();
	}

	onMount(() => {
		if (!isTauri()) return;

		const currentWindow = getCurrentWindow();
		let cleanup = () => {};

		void (async () => {
			await setPreviewWindowTitle(`Preview • ${asset?.display_name ?? 'Preview'}`);
			fullscreen = await currentWindow.isFullscreen();
			const unlisteners = await Promise.all([
				currentWindow.listen<{
					projectId: string;
					assetId: string;
					assetName: string;
				}>(ASSET_PREVIEW_NAVIGATE_EVENT, async (event) => {
					await goto(
						resolve(buildDetachedAssetPreviewRoute(event.payload.projectId, event.payload.assetId))
					);
					await setPreviewWindowTitle(`Preview • ${event.payload.assetName}`);
					await loadAsset(event.payload.projectId, event.payload.assetId);
					await requestSync(event.payload.assetId);
				}),
				currentWindow.listen<{
					projectId: string;
					assetId: string;
					assetName: string;
					activeFileId: string | null;
					targetPdfPage: number | null;
					targetCadViewLabel: string | null;
				}>(ASSET_PREVIEW_SYNC_EVENT, async (event) => {
					activeFileId = event.payload.activeFileId;
					targetPdfPage = event.payload.targetPdfPage;
					targetCadViewLabel = event.payload.targetCadViewLabel;
					lastSelectionSignature = selectionSignature({
						activeFileId,
						targetPdfPage,
						targetCadViewLabel
					});
					await setPreviewWindowTitle(`Preview • ${event.payload.assetName}`);
				}),
				currentWindow.onCloseRequested(async (event) => {
					if (isClosing) return;
					event.preventDefault();
					isClosing = true;
					try {
						await notifyMainWindowPreviewClosed();
						await currentWindow.close();
					} catch (error) {
						isClosing = false;
						throw error;
					}
				})
			]);

			cleanup = () => {
				for (const unlisten of unlisteners) {
					unlisten();
				}
			};
		})();

		return () => {
			cleanup();
		};
	});

	$effect(() => {
		const routeKey = `${data.projectId}:${data.assetId}`;
		if (routeKey === lastLoadedKey) return;
		lastLoadedKey = routeKey;
		void loadAsset(data.projectId, data.assetId);
	});

	$effect(() => {
		const previewTitle = `Preview • ${asset?.display_name ?? 'Preview'}`;
		void setPreviewWindowTitle(previewTitle);
	});

	$effect(() => {
		if (!isTauri() || !asset || asset.id === lastRequestedAssetId) return;
		lastRequestedAssetId = asset.id;
		void requestSync(asset.id);
	});

	$effect(() => {
		const signature = selectionSignature({
			activeFileId,
			targetPdfPage,
			targetCadViewLabel
		});

		if (signature === lastSelectionSignature || !activeFileId || !isTauri() || !asset) return;
		lastSelectionSignature = signature;
		void getCurrentWindow().emitTo('main', ASSET_PREVIEW_SELECTION_CHANGED_EVENT, {
			assetId: asset.id,
			activeFileId,
			targetPdfPage,
			targetCadViewLabel
		});
	});
</script>

{#if asset}
	<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
		<MultiFileViewer
			{asset}
			bind:activeFileId
			{targetPdfPage}
			{targetCadViewLabel}
			detached
			{fullscreen}
			onToggleDetached={returnPreviewToMain}
			onToggleFullscreen={toggleFullscreen}
		/>
	</div>
{:else if isLoading}
	<div class="ui-viewer-shell flex h-full min-h-full items-center justify-center px-6">
		<div class="flex max-w-sm flex-col items-center gap-2 text-center">
			<p class="eyebrow">Opening preview</p>
			<Text as="p" tone="muted">Loading the selected asset from the local workspace.</Text>
		</div>
	</div>
{:else}
	<div class="ui-viewer-shell flex h-full min-h-full items-center justify-center px-6">
		<div class="flex max-w-sm flex-col items-center gap-2 text-center">
			<p class="h4">Preview unavailable</p>
			<Text as="p" tone="muted"
				>The selected asset could not be loaded from the local workspace.</Text
			>
		</div>
	</div>
{/if}
