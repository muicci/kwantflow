<script lang="ts">
	import { readVaultFile } from '$lib/services/assets';
	import { createLogger } from '$lib/services/logger.js';
	import TooltipIconButton from '$lib/components/tooltip-icon-button.svelte';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';

	import WrapTextIcon from '@lucide/svelte/icons/wrap-text';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import FileIcon from '@lucide/svelte/icons/file';

	import { toast } from 'svelte-sonner';

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
	let content = $state('');
	const log = createLogger('viewer.text');
	let wordWrap = $state(true);

	const fileName = $derived(filePath.split('/').pop() || '');
	const lineCount = $derived(content ? content.split('\n').length : 0);

	// ── Load file content (reactive on filePath) ─────────────────────
	$effect(() => {
		const path = filePath;
		loading = true;
		error = false;
		content = '';

		(async () => {
			try {
				const bytes = await readVaultFile(path);
				if (filePath !== path) return; // stale
				content = new TextDecoder('utf-8').decode(bytes);
				loading = false;
			} catch (e) {
				if (filePath !== path) return;
				log.error('Load failed', { path, error: e });
				error = true;
				loading = false;
			}
		})();
	});

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(content);
			toast.success('Copied to clipboard');
		} catch {
			toast.error('Failed to copy');
		}
	}

	function toggleWordWrap() {
		wordWrap = !wordWrap;
		toast.success(wordWrap ? 'Line wrap enabled' : 'Line wrap disabled');
	}

	function toggleExpand() {
		expanded = !expanded;
	}
</script>

<div
	class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
	style="background: var(--preview-bg, transparent);"
>
	<!-- Toolbar -->
	{#if !loading && !error}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip z-10">
			<!-- File info -->
			<div class="flex items-center gap-2">
				<div title={fileName}>
					<Text as="span" class="shell-label max-w-48 truncate">{fileName}</Text>
				</div>
				<Meta as="span" class="tabular-nums">{lineCount} lines</Meta>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-1">
				<TooltipIconButton
					tooltip={wordWrap ? 'Disable line wrap' : 'Wrap lines'}
					variant={wordWrap ? 'secondary' : 'ghost'}
					size="icon-xs"
					onclick={toggleWordWrap}
				>
					<WrapTextIcon class="size-3.5" />
				</TooltipIconButton>
				<TooltipIconButton
					tooltip="Copy to clipboard"
					variant="ghost"
					size="icon-xs"
					onclick={copyToClipboard}
				>
					<CopyIcon class="size-3.5" />
				</TooltipIconButton>
				{#if allowExpand && !detached}
					<TooltipIconButton
						tooltip={expanded ? 'Collapse' : 'Expand'}
						variant="ghost"
						size="icon-xs"
						onclick={toggleExpand}
					>
						{#if expanded}
							<Minimize2Icon class="size-3.5" />
						{:else}
							<Maximize2Icon class="size-3.5" />
						{/if}
					</TooltipIconButton>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content -->
	{#if !loading && !error}
		<ScrollArea.Root class="min-h-0 flex-1" orientation="both">
			<pre
				class="code-block p-4 {wordWrap
					? 'wrap-break-word whitespace-pre-wrap'
					: 'whitespace-pre'}">{content}</pre>
		</ScrollArea.Root>
	{/if}

	<!-- Loading / Error overlays -->
	{#if loading}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<Text as="div" tone="muted" class="animate-pulse">Loading file...</Text>
		</div>
	{:else if error}
		<div class="surface-faint absolute inset-0 flex items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<FileIcon class="muted size-16 stroke-1" />
				<Text as="p" tone="muted">Could not load text file</Text>
			</div>
		</div>
	{/if}
</div>
