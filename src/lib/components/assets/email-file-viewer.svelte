<script lang="ts">
	import { readVaultFile } from '$lib/services/assets.js';
	import { createLogger } from '$lib/services/logger.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import MailIcon from '@lucide/svelte/icons/mail';
	import EmailHtmlViewer from '$lib/components/email-html-viewer.svelte';
	import { parseEmailFileBytes } from '$lib/services/email-content.js';
	import { formatDate } from '$lib/utils/format.js';

	interface Props {
		filePath: string;
	}

	let { filePath }: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let htmlBody = $state<string | null>(null);
	let textBody = $state<string | null>(null);
	let subject = $state('');
	let from = $state('');
	let to = $state('');
	let date = $state('');
	let formattedDate = $derived.by(() => {
		if (!date) return '';
		const parsed = new Date(date);
		return Number.isNaN(parsed.getTime()) ? date : formatDate(parsed);
	});
	const log = createLogger('viewer.emailFile');

	$effect(() => {
		const path = filePath;
		let current = true;
		loading = true;
		error = null;
		htmlBody = null;
		textBody = null;
		subject = '';
		from = '';
		to = '';
		date = '';

		(async () => {
			try {
				const bytes = await readVaultFile(path);
				if (!current) return;
				const parsed = await parseEmailFileBytes(bytes, path);
				if (!current) return;
				subject = parsed.subject;
				from = parsed.from;
				to = parsed.to;
				date = parsed.date;
				htmlBody = parsed.htmlBody;
				textBody = parsed.textBody;
			} catch (err) {
				if (!current) return;
				log.error('Email file load failed', { path, error: err });
				error = 'Could not read this email file.';
			} finally {
				if (current) {
					loading = false;
				}
			}
		})();
		return () => {
			current = false;
		};
	});
</script>

<div
	class="surface-faint relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
>
	{#if !loading && !error && (htmlBody || textBody)}
		<div class="surface-strip-row surface-overlay-soft ui-viewer-strip email-file-header z-10">
			<div class="flex min-w-0 flex-col gap-1">
				{#if subject}
					<Text class="shell-label truncate">{subject}</Text>
				{/if}
				<div class="flex flex-wrap gap-x-4 gap-y-0.5">
					{#if from}<Meta>From: {from}</Meta>{/if}
					{#if to}<Meta>To: {to}</Meta>{/if}
					{#if formattedDate}<Meta>{formattedDate}</Meta>{/if}
				</div>
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-auto">
			{#if htmlBody}
				{#key htmlBody}
					<EmailHtmlViewer html={htmlBody} class="h-full" />
				{/key}
			{:else}
				<pre class="code-block p-4 whitespace-pre-wrap">{textBody}</pre>
			{/if}
		</div>
	{:else if loading}
		<div class="flex h-full flex-1 items-center justify-center">
			<Text tone="muted" class="animate-pulse">Loading email...</Text>
		</div>
	{:else}
		<div class="flex h-full flex-1 items-center justify-center">
			<div class="flex flex-col items-center gap-2 opacity-50">
				<MailIcon class="muted size-16 stroke-1" />
				<Text tone="muted">
					{error ?? 'Preview unavailable for this email file.'}
				</Text>
			</div>
		</div>
	{/if}
</div>

<style>
	.email-file-header {
		block-size: auto;
		min-block-size: 3.5rem;
		padding-block: var(--space-2);
	}
</style>
