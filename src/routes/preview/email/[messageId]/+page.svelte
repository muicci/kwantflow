<script lang="ts">
	import type { PageProps } from './$types';
	import { tick } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { appState } from '$lib/state/app.svelte.js';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import type { GmailDetail } from '$lib/state/integrations.svelte.js';
	import { integrationsState } from '$lib/state/integrations.svelte.js';
	import { appTabsState } from '$lib/state/app-tabs.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import { prepareIntakeFromEmail, type StagedFile } from '$lib/services/email-intake.js';
	import IntakeDialog from '$lib/components/intake/intake-dialog.svelte';
	import ContactDialog from '$lib/components/contacts/contact-dialog.svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { emailProjectKey, projectsState } from '$lib/state/projects.svelte.js';
	import EmailHtmlViewer from '$lib/components/email-html-viewer.svelte';

	type AppHref = `/project/${string}`;

	function goToProject(projectId: string) {
		goto(resolve(`/project/${encodeURIComponent(projectId)}` as AppHref));
	}
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	let { data }: PageProps = $props();

	let detail = $state<GmailDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	function senderName(from: string): string {
		const match = from.match(/^"?([^"<]+)"?\s*<.*>/);
		if (match) return match[1].trim();
		const emailMatch = from.match(/<?([^\s@]+@[^\s>]+)>?/);
		if (emailMatch) return emailMatch[1];
		return from;
	}

	function senderEmailClean(from: string): string {
		const match = from.match(/<?([^\s@]+@[^>\s]+)>?/);
		return match ? match[1] : from;
	}

	function cleanEmailList(value: string | null): string {
		if (!value) return '—';
		return (
			value
				.replace(/<[^>]+>/g, '')
				.replace(/\s+/g, ' ')
				.trim() || '—'
		);
	}

	let isContactDialogOpen = $state(false);

	function handleContactAction(): void {
		if (!detail) return;
		const email = senderEmailClean(detail.from);
		if (!email) return;
		isContactDialogOpen = true;
	}

	let downloadingAttachments = $state<Record<number, boolean>>({});

	async function downloadAttachment(index: number): Promise<void> {
		if (!detail) return;
		const conn =
			integrationsState.getConnectionForMessageId(detail.id) ??
			integrationsState.activeEmailConnection;
		if (!conn?.id) return;
		downloadingAttachments[index] = true;
		downloadingAttachments = { ...downloadingAttachments };
		try {
			if (!appState.hasInternet) {
				throw new Error('No internet connection — cannot download attachment');
			}
			await invoke<string>('download_email_attachment', {
				connectionId: conn.id,
				messageId: detail.id,
				attachmentId: detail.attachmentIds[index],
				filename: detail.attachmentNames[index],
				openFile: true
			});
			// Open in system default app (Preview for PDF, etc.)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errorState.catchError(msg, 'Download attachment');
		} finally {
			downloadingAttachments[index] = false;
			downloadingAttachments = { ...downloadingAttachments };
		}
	}

	let intakeOpen = $state(false);
	let isCreatingRfq = $state(false);
	let intakeValues = $state<Record<string, string | null>>({});
	let intakeFiles = $state<StagedFile[]>([]);

	/** Projects linked to this email via source_email_integration_id + source_email_message_id. */
	let linkedRfqs = $state<Array<{ id: string; project_name: string }>>([]);

	$effect(() => {
		if (detail) {
			const conn =
				integrationsState.getConnectionForMessageId(detail.id) ??
				integrationsState.activeEmailConnection;
			linkedRfqs =
				projectsState.emailToProjectMap.get(emailProjectKey(conn?.id ?? null, detail.id)) ?? [];
		}
	});

	async function createRfqFromEmail(): Promise<void> {
		if (!detail || isCreatingRfq) return;
		isCreatingRfq = true;
		await tick();
		try {
			const result = await prepareIntakeFromEmail(detail);
			intakeFiles = result.files;
			intakeValues = {
				project_name: result.values.project_name,
				company_name: result.values.company_name,
				company_contact_id: result.values.company_contact_id,
				requester_contact_id: result.values.requester_contact_id,
				requester_name: result.values.requester_name,
				content: result.values.content,
				received_date: result.values.received_date,
				source_channel: result.values.source_channel,
				source_reference: result.values.source_reference,
				contact_person: result.values.contact_person,
				contact_email: result.values.contact_email,
				due_date: result.values.due_date,
				submission_deadline_at: result.values.submission_deadline_at,
				customer_tender_reference: result.values.customer_tender_reference,
				rfq_number: result.values.rfq_number,
				estimator_name: result.values.estimator_name,
				priority: result.values.priority,
				site_address: result.values.site_address,
				delivery_address: result.values.delivery_address,
				addendum_label: result.values.addendum_label,
				addendum_date: result.values.addendum_date,
				addendum_notes: result.values.addendum_notes,
				source_email_message_id: result.values.source_email_message_id,
				source_email_integration_id: result.values.source_email_integration_id,
				note: result.values.note
			} as Record<string, string | null>;
			intakeOpen = true;
		} catch (e) {
			errorState.catchError(e instanceof Error ? e.message : String(e), 'Create RFQ from email');
		} finally {
			isCreatingRfq = false;
		}
	}

	function formatFullDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			return d.toLocaleString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			return dateStr;
		}
	}

	$effect(() => {
		const messageId = data.messageId;
		let current = true;
		detail = null;
		error = null;
		loading = true;

		void integrationsState
			.openEmailMessage(messageId)
			.then((result) => {
				if (!current) return;
				if (!result) {
					error = 'Could not load this email.';
					return;
				}
				detail = result;
				if (result.subject) {
					appTabsState.updateTabTitle(`email-preview:${messageId}`, result.subject);
				}
			})
			.catch((cause) => {
				if (!current) return;
				error = cause instanceof Error ? cause.message : 'Failed to load email.';
				errorState.catchError(error, 'Email preview');
			})
			.finally(() => {
				if (current) loading = false;
			});

		return () => {
			current = false;
		};
	});
</script>

<div class="flex min-h-0 flex-1 flex-col px-4">
	{#if loading}
		<div class="flex flex-1 items-center justify-center gap-2">
			<span class="muted"><RefreshCwIcon class="size-5 animate-spin" /></span>
			<Meta>Loading email…</Meta>
		</div>
	{:else if error || !detail}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
			<span class="muted"><MailIcon class="size-8" /></span>
			<Text>This email is no longer available.</Text>
			<Meta>Select another email from the Mail panel.</Meta>
		</div>
	{:else}
		<!-- Header -->
		<div class="shrink-0 border-b border-border pt-3 pb-3">
			<!-- From -->
			<div class="flex items-center gap-2">
				<span class="caption w-14 shrink-0 select-none">From:</span>
				<div class="min-w-0 flex-1">
					<span class="field-copy">{senderName(detail.from)}</span>
					<span class="muted"> &lt;{senderEmailClean(detail.from)}&gt;</span>
					<button
						type="button"
						class="caption inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
						title="Create company from this contact"
						onclick={handleContactAction}
					>
						<UserPlusIcon class="size-3" />
					</button>
				</div>
			</div>
			<!-- To -->
			<div class="mt-1 flex items-center gap-2">
				<span class="caption w-14 shrink-0 select-none">To:</span>
				<div class="min-w-0 flex-1">
					<span class="field-copy">{cleanEmailList(detail.to)}</span>
					{#if detail.cc}
						<span class="muted ml-2">cc: {cleanEmailList(detail.cc)}</span>
					{/if}
				</div>
			</div>
			<!-- Date -->
			<div class="mt-1 flex items-center gap-2">
				<span class="caption w-14 shrink-0 select-none">Date:</span>
				<span class="field-copy">{formatFullDate(detail.date)}</span>
			</div>
			<!-- Subject -->
			<div class="mt-1 flex items-center gap-2">
				<span class="caption w-14 shrink-0 select-none">Subject:</span>
				<span class="field-copy semibold">{detail.subject || '(no subject)'}</span>
			</div>
			{#if detail.hasAttachments && detail.attachmentNames.length > 0}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each detail.attachmentNames as name, i (i)}
						<button
							type="button"
							class="ui-radius-md shell-meta inline-flex items-center gap-1 border border-border px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground"
							disabled={downloadingAttachments[i]}
							onclick={() => void downloadAttachment(i)}
						>
							<PaperclipIcon class="size-2.5" />
							{downloadingAttachments[i] ? 'Downloading…' : name}
						</button>
					{/each}
				</div>
			{/if}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				{#if detail && integrationsState.getRfqStatus(detail.id) === 'yes'}
					<Badge variant="premium" class="order-last ml-auto gap-1 px-1.5"
						><BadgeCheckIcon class="size-3" />Potential RFQ</Badge
					>
				{/if}
				{#if linkedRfqs.length > 0}
					{#if linkedRfqs.length === 1}
						<Button
							type="button"
							variant="filled"
							size="sm"
							class="gap-1"
							onclick={() => goToProject(linkedRfqs[0].id)}
						>
							<ExternalLinkIcon class="size-3.5" />
							Open RFQ
						</Button>
					{:else}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} type="button" variant="filled" size="sm" class="gap-1">
										<ExternalLinkIcon class="size-3.5" />
										Open RFQ ({linkedRfqs.length})
										<ChevronDownIcon class="size-3" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="ui-menu-anchor-width">
								{#each linkedRfqs as rfq (rfq.id)}
									<DropdownMenu.Item onclick={() => goToProject(rfq.id)}>
										{rfq.project_name}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}

					<button
						type="button"
						class="caption inline-flex items-center gap-1.5 underline-offset-2 hover:underline disabled:opacity-50"
						disabled={isCreatingRfq}
						onclick={() => void createRfqFromEmail()}
					>
						{#if isCreatingRfq}
							<RefreshCwIcon class="size-3.5 animate-spin" />
							Creating…
						{:else}
							Create another RFQ
						{/if}
					</button>
				{:else}
					<Button
						type="button"
						variant="brand"
						size="default"
						class="gap-1.5"
						disabled={isCreatingRfq}
						onclick={() => void createRfqFromEmail()}
					>
						{#if isCreatingRfq}
							<RefreshCwIcon class="size-3.5 animate-spin" />
							Creating…
						{:else}
							<FolderPlusIcon class="size-3.5" />
							Create RFQ
						{/if}
					</Button>
				{/if}
			</div>
		</div>

		<IntakeDialog
			bind:open={intakeOpen}
			initialValues={intakeValues}
			initialFiles={intakeFiles}
			hideTrigger={true}
		/>

		<ContactDialog
			bind:open={isContactDialogOpen}
			contact={null}
			kindMode="company"
			hideTrigger={true}
		/>

		<!-- Body: iframe (HTML) or plain text fallback -->
		{#if detail.bodyHtml}
			{#key data.messageId}
				<EmailHtmlViewer html={detail.bodyHtml} title="Email body" />
			{/key}
		{:else}
			<div class="min-h-0 flex-1 overflow-y-auto">
				<pre class="field-copy font-sans whitespace-pre-wrap">{detail.bodyText}</pre>
			</div>
		{/if}
	{/if}
</div>
