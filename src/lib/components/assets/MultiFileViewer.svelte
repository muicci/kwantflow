<script module lang="ts">
	import { SvelteMap } from 'svelte/reactivity';

	const rememberedActiveFileIds = new SvelteMap<string, string>();
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Meta } from '$lib/components/primitives/index.js';
	import type { Asset } from '$lib/types/index.js';
	import { getFileCategory, getGeneralFilePreviewKind } from '$lib/constants/index.js';
	import {
		resolveEstimateAiFileEligibilities,
		type EstimateAiFileEligibility
	} from '$lib/services/estimate-ai-file-eligibility.js';
	import { appState } from '$lib/state/app.svelte.js';
	import SingleFileViewer from './single-file-viewer.svelte';
	import BoxIcon from '@lucide/svelte/icons/box';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import FileIcon from '@lucide/svelte/icons/file';
	import SheetIcon from '@lucide/svelte/icons/sheet';
	import MonitorUpIcon from '@lucide/svelte/icons/monitor-up';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';

	interface Props {
		asset: Asset | null;
		expanded?: boolean;
		activeFileId?: string | null;
		targetPdfPage?: number | null;
		targetCadViewLabel?: string | null;
		targetLocator?: Record<string, unknown> | null;
		detached?: boolean;
		fullscreen?: boolean;
		onToggleDetached?: (() => void | Promise<void>) | null;
		onToggleFullscreen?: (() => void | Promise<void>) | null;
	}

	let {
		asset,
		expanded = $bindable(false),
		activeFileId = $bindable<string | null>(null),
		targetPdfPage = null,
		targetCadViewLabel = null,
		targetLocator = null,
		detached = false,
		fullscreen = false,
		onToggleDetached = null,
		onToggleFullscreen = null
	}: Props = $props();

	// Primary file determination logic
	const files = $derived(asset?.files ?? []);
	const fileRestoreSignature = $derived(
		asset
			? `${asset.id}:${asset.thumbnail_file_id ?? ''}:${files.map((file) => file.id).join('|')}`
			: ''
	);
	// Restore the last active file for this asset, falling back to thumbnail or first file.
	$effect(() => {
		const restoreSignature = fileRestoreSignature;
		if (!restoreSignature || !asset) return;

		if (files.length === 0) {
			activeFileId = null;
			return;
		}

		const rememberedFileId = rememberedActiveFileIds.get(asset.id);
		const currentActiveFileId =
			activeFileId && files.some((file) => file.id === activeFileId) ? activeFileId : null;
		const nextActiveFileId =
			currentActiveFileId ??
			(rememberedFileId && files.some((file) => file.id === rememberedFileId)
				? rememberedFileId
				: asset.thumbnail_file_id && files.some((file) => file.id === asset.thumbnail_file_id)
					? asset.thumbnail_file_id
					: files[0]?.id) ??
			null;

		activeFileId = nextActiveFileId;
	});

	$effect(() => {
		if (!activeFileId || !asset) return;
		rememberedActiveFileIds.set(asset.id, activeFileId);
	});

	const activeFile = $derived(files.find((f) => f.id === activeFileId));
	const activeFileType = $derived(
		activeFile ? getGeneralFilePreviewKind(activeFile.file_path) : 'none'
	);
	const fileEligibilitySignature = $derived(
		asset
			? `${asset.id}:${files.map((file) => `${file.id}:${file.file_path}:${file.mime_type ?? ''}`).join('|')}`
			: ''
	);
	const showFileStrip = $derived(detached ? files.length > 0 : files.length > 1);
	const showDetachedToggle = $derived(
		typeof onToggleDetached === 'function' &&
			files.some((file) => getGeneralFilePreviewKind(file.file_path) !== 'none')
	);
	const showFullscreenToggle = $derived(
		detached &&
			typeof onToggleFullscreen === 'function' &&
			files.some((file) => getGeneralFilePreviewKind(file.file_path) !== 'none')
	);

	function togglePreviewTheme(): void {
		appState.setPreviewTheme(appState.previewTheme === 'dark' ? 'light' : 'dark');
	}

	let fileEligibilityRequestToken = 0;
	let fileEligibilityById = $state<Record<string, EstimateAiFileEligibility | undefined>>({});

	$effect(() => {
		if (activeFileType === 'none') {
			expanded = false;
		}
	});

	$effect(() => {
		const signature = fileEligibilitySignature;
		const nextFiles = files;
		void signature;
		fileEligibilityRequestToken += 1;
		const requestToken = fileEligibilityRequestToken;
		fileEligibilityById = {};
		if (nextFiles.length === 0) return;
		void resolveEstimateAiFileEligibilities(nextFiles)
			.then((statuses) => {
				if (requestToken !== fileEligibilityRequestToken) return;
				fileEligibilityById = Object.fromEntries(statuses.map((status) => [status.fileId, status]));
			})
			.catch(() => {
				if (requestToken !== fileEligibilityRequestToken) return;
				fileEligibilityById = {};
			});
	});

	function getFileIcon(path: string) {
		const previewKind = getGeneralFilePreviewKind(path);
		if (previewKind === 'cad' || previewKind === 'dxf') {
			return BoxIcon;
		}
		if (previewKind === 'pdf' || previewKind === 'document') return FileTextIcon;
		if (previewKind === 'spreadsheet') return SheetIcon;
		if (previewKind === 'image') return ImageIcon;
		const category = getFileCategory(path);
		if (category === 'cad') return BoxIcon;
		return FileIcon;
	}

	function resolveAiIndicator(fileId: string): {
		tone: string;
		pulse: boolean;
		label: string;
		detail: string;
	} | null {
		const eligibility = fileEligibilityById[fileId];
		if (!eligibility) return null;
		return {
			tone: eligibility.status === 'eligible' ? 'status-dot-success' : 'status-dot-warning',
			pulse: false,
			label: eligibility.tooltipLabel,
			detail: eligibility.tooltipDetail
		};
	}
</script>

<div class="ui-viewer-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden">
	{#if detached || showFileStrip || showDetachedToggle || showFullscreenToggle}
		<div class="ui-viewer-toolbar">
			<div class="ui-preview-file-strip">
				<div class="ui-preview-file-strip-scroll">
					{#if showFileStrip}
						{#each files as file (file.id)}
							{@const Icon = getFileIcon(file.file_path)}
							{@const aiIndicator = resolveAiIndicator(file.id)}
							<Button
								variant="ghost"
								size="sm"
								class={`ui-preview-file-tab ui-preview-file-tab-copy control-height-sm gap-2 ${
									activeFileId === file.id ? 'ui-preview-file-tab-active' : ''
								}`}
								onclick={() => {
									activeFileId = file.id;
									targetPdfPage = null;
									targetCadViewLabel = null;
									targetLocator = null;
								}}
							>
								<Icon class="size-3.5" />
								{file.original_name}
								{#if aiIndicator}
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<span
													{...props}
													class={`${aiIndicator.tone} shrink-0 ${aiIndicator.pulse ? 'animate-pulse' : ''}`}
												></span>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content side="top" align="center">
											<div class="space-y-1">
												<Meta>{aiIndicator.label}</Meta>
												<Meta>{aiIndicator.detail}</Meta>
											</div>
										</Tooltip.Content>
									</Tooltip.Root>
								{/if}
							</Button>
						{/each}
					{/if}
				</div>
			</div>

			{#if showFullscreenToggle}
				<TooltipIconButton
					variant="ghost"
					size="icon"
					class="ui-preview-toolbar-icon-button shrink-0"
					tooltip={fullscreen ? 'Exit full screen' : 'Enter full screen'}
					onclick={() => void onToggleFullscreen?.()}
				>
					{#if fullscreen}
						<Minimize2Icon class="size-3.5" />
					{:else}
						<Maximize2Icon class="size-3.5" />
					{/if}
				</TooltipIconButton>
			{/if}

			{#if showDetachedToggle}
				<TooltipIconButton
					variant="ghost"
					size="icon"
					class="ui-preview-toolbar-icon-button shrink-0"
					tooltip={detached ? 'Return preview' : 'Detach preview'}
					onclick={() => void onToggleDetached?.()}
				>
					{#if detached}
						<PanelRightOpenIcon class="size-3.5" />
					{:else}
						<MonitorUpIcon class="size-3.5" />
					{/if}
				</TooltipIconButton>
			{/if}

			<TooltipIconButton
				variant="ghost"
				size="icon"
				class="ui-preview-toolbar-icon-button shrink-0"
				tooltip={appState.previewTheme === 'dark' ? 'Light box' : 'Dark box'}
				onclick={togglePreviewTheme}
			>
				{#if appState.previewTheme === 'dark'}
					<SunIcon class="size-3.5" />
				{:else}
					<MoonIcon class="size-3.5" />
				{/if}
			</TooltipIconButton>
		</div>
	{/if}

	<!-- Viewer Container -->
	<div
		class={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${appState.previewTheme === 'light' ? 'ui-preview-box-light' : 'ui-preview-box-dark'}`}
	>
		<SingleFileViewer
			file={activeFile ?? null}
			bind:expanded
			{detached}
			{targetPdfPage}
			{targetCadViewLabel}
			{targetLocator}
			emptyTitle="No files associated with this scope item."
			emptyDescription={null}
		/>
	</div>
</div>
