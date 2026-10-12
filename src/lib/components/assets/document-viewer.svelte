<script lang="ts">
	import { createLogger } from '$lib/services/logger.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Meta, SectionLabel, Text } from '$lib/components/primitives/index.js';
	import {
		disposeDerivedPreview,
		getDerivedPreview,
		type DocumentDerivedPreview
	} from '$lib/services/derived-previews.js';

	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';

	interface Props {
		filePath: string;
		expanded?: boolean;
		allowExpand?: boolean;
		detached?: boolean;
	}

	let {
		filePath,
		expanded = $bindable(false),
		allowExpand = true,
		detached = false
	}: Props = $props();

	let loading = $state(true);
	let error = $state(false);
	let preview = $state<DocumentDerivedPreview | null>(null);
	let activePreview: DocumentDerivedPreview | null = null;
	const log = createLogger('viewer.document');

	const fileName = $derived(filePath.split('/').pop() || '');

	$effect(() => {
		const path = filePath;
		loading = true;
		error = false;
		let cancelled = false;

		(async () => {
			try {
				const nextPreview = await getDerivedPreview(path);
				if (cancelled || filePath !== path || nextPreview.kind !== 'document') {
					disposeDerivedPreview(nextPreview);
					return;
				}
				const previousPreview = activePreview;
				activePreview = nextPreview;
				preview = nextPreview;
				disposeDerivedPreview(previousPreview);
				loading = false;
			} catch (loadError) {
				if (cancelled || filePath !== path) return;
				log.error('Load failed', { path, error: loadError });
				const previousPreview = activePreview;
				activePreview = null;
				preview = null;
				disposeDerivedPreview(previousPreview);
				error = true;
				loading = false;
			}
		})();

		return () => {
			cancelled = true;
			const previousPreview = activePreview;
			activePreview = null;
			preview = null;
			disposeDerivedPreview(previousPreview);
		};
	});
</script>

<div
	class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
	style="background: var(--preview-bg, transparent);"
>
	{#if !loading && !error && preview}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<div class="flex min-w-0 items-center gap-2">
				<div title={fileName}>
					<Text as="span" class="shell-label truncate">{fileName}</Text>
				</div>
				{#if preview.messages.length > 0}
					<Meta as="span" class="tabular-nums">{preview.messages.length} warnings</Meta>
				{/if}
			</div>
			{#if allowExpand && !detached}
				<TooltipIconButton
					tooltip={expanded ? 'Collapse' : 'Expand'}
					variant="ghost"
					size="icon-xs"
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<Minimize2Icon class="size-3.5" />
					{:else}
						<Maximize2Icon class="size-3.5" />
					{/if}
				</TooltipIconButton>
			{/if}
		</div>

		<ScrollArea.Root class="min-h-0 flex-1" orientation="both">
			<div class="mx-auto flex max-w-4xl flex-col gap-4 p-4">
				<div
					class="document-preview ui-derived-preview-card p-4"
					style="box-shadow: var(--elevation-flat)"
				>
					<div class="document-preview-content" dir="ltr">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html preview.html}
					</div>
				</div>

				{#if preview.messages.length > 0}
					<div class="ui-derived-preview-note p-3">
						<SectionLabel as="p">Conversion Notes</SectionLabel>
						<ul class="list mt-2 pl-4">
							{#each preview.messages as message (message)}
								<li>{message}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</ScrollArea.Root>
	{/if}

	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<Text as="div" tone="muted" class="animate-pulse">Generating preview…</Text>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<FileTextIcon class="muted size-16 stroke-1" />
				<Text as="p" tone="muted">Could not generate the document preview</Text>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.document-preview-content h1),
	:global(.document-preview-content h2),
	:global(.document-preview-content h3),
	:global(.document-preview-content h4) {
		margin: 0 0 0.75rem;
	}

	:global(.document-preview-content p),
	:global(.document-preview-content ul),
	:global(.document-preview-content ol),
	:global(.document-preview-content table) {
		margin: 0 0 1rem;
	}

	:global(.document-preview-content table) {
		width: 100%;
		border-collapse: collapse;
	}

	:global(.document-preview-content th),
	:global(.document-preview-content td) {
		border: 1px solid currentColor;
		padding: 0.5rem;
		text-align: left;
		vertical-align: top;
	}
	:global(.document-preview-content img) {
		max-width: 100%;
		height: auto;
	}
	:global(.document-preview-content a) {
		text-decoration: underline;
	}
</style>
