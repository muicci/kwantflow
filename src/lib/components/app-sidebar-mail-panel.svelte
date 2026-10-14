<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Meta } from '$lib/components/primitives/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { integrationsState, type GmailSummary } from '$lib/state/integrations.svelte.js';
	import { emailProjectKey, projectsState } from '$lib/state/projects.svelte.js';
	import { appState } from '$lib/state/app.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { createLogger } from '$lib/services/logger.js';
	import { toast } from 'svelte-sonner';
	import { prepareIntakeFromEmail } from '$lib/services/email-intake.js';
	import type { StagedFile } from '$lib/services/email-intake.js';
	import IntakeDialog from '$lib/components/intake/intake-dialog.svelte';

	const log = createLogger('mailPanel');

	let searchQuery = $state('');
	let selectedId = $state<string | null>(null);

	const messages = $derived(integrationsState.emailMessages);
	const isLoading = $derived(integrationsState.emailLoading);
	const isRefreshing = $derived(integrationsState.emailRefreshing);

	const filteredMessages = $derived(
		searchQuery
			? messages.filter(
					(m) =>
						m.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
						m.subject.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: messages
	);
	function linkedEmailKey(messageId: string): string {
		return emailProjectKey(integrationsState.activeEmailConnection?.id ?? null, messageId);
	}

	// ---------------------------------------------------------------
	// Context menu state
	// ---------------------------------------------------------------
	let contextMenuMsg: GmailSummary | null = $state(null);
	let contextMenuX = $state(0);
	let contextMenuY = $state(0);
	let isCreatingRfq = $state(false);

	// Intake dialog state
	let intakeOpen = $state(false);
	let intakeValues = $state<Record<string, string | null>>({});
	let intakeFiles = $state<StagedFile[]>([]);

	function onContextMenu(e: MouseEvent, msg: GmailSummary): void {
		e.preventDefault();
		contextMenuMsg = msg;
		contextMenuX = e.clientX;
		contextMenuY = e.clientY;
	}

	function closeContextMenu(): void {
		contextMenuMsg = null;
	}

	function openMessageFromMenu(): void {
		if (!contextMenuMsg) return;
		const msg = contextMenuMsg;
		closeContextMenu();
		selectedId = msg.id;
		const title = (msg.subject || 'Email').slice(0, 50);
		void goto(`/preview/email/${encodeURIComponent(msg.id)}?title=${encodeURIComponent(title)}`);
	}

	async function createRfqFromContextMenu(): Promise<void> {
		const msg = contextMenuMsg;
		closeContextMenu();
		if (!msg || isCreatingRfq) return;

		isCreatingRfq = true;
		await tick();
		try {
			// We need the full email detail for AI extraction
			const detail = await integrationsState.openEmailMessage(msg.id);
			if (!detail) throw new Error('Could not retrieve email details');

			const result = await prepareIntakeFromEmail(detail);
			intakeFiles = result.files;
			intakeValues = result.values as unknown as Record<string, string | null>;
			intakeOpen = true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error(`[mail] Create RFQ from context menu failed: ${msg}`);
			errorState.catchError(msg, 'Create RFQ from email');
		} finally {
			isCreatingRfq = false;
		}
	}

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			const now = new Date();
			const diffMs = now.getTime() - d.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			if (diffMins < 1) return 'Just now';
			if (diffMins < 60) return `${diffMins}m`;
			if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		} catch {
			return dateStr;
		}
	}

	function senderName(from: string): string {
		const match = from.match(/^"?([^"<]+)"?\s*<.*>/);
		if (match) return match[1].trim();
		const emailMatch = from.match(/<?([^\s@]+@[^\s>]+)>?/);
		if (emailMatch) return emailMatch[1].split('@')[0];
		return from;
	}

	function openMessage(messageId: string, subject: string): void {
		selectedId = messageId;
		const title = (subject || 'Email').slice(0, 50);
		void goto(`/preview/email/${encodeURIComponent(messageId)}?title=${encodeURIComponent(title)}`);
	}

	// Initial fetch when Mail panel becomes active AND messages is empty
	$effect(() => {
		if (
			appState.activeSidebarPanel === 'mail' &&
			integrationsState.isEmailConnected &&
			messages.length === 0 &&
			!isLoading
		) {
			if (appState.hasInternet) {
				void integrationsState.fetchEmailMessages();
			}
		}
	});
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!-- Search -->
	<div class="shrink-0 px-2 pb-1">
		<Sidebar.Input
			bind:value={searchQuery}
			placeholder="Search emails..."
			aria-label="Search emails"
		/>
	</div>

	<!-- Refresh + count -->
	<div class="flex shrink-0 items-center justify-between px-3 py-1">
		<Meta>
			{#if messages.length > 0}
				{messages.length} message{messages.length !== 1 ? 's' : ''}
			{/if}
		</Meta>
		<button
			type="button"
			class="ui-radius-sm inline-flex size-6 items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground"
			aria-label="Refresh emails"
			onclick={() => {
				if (!appState.hasInternet) return;
				void integrationsState.fetchEmailMessages();
				toast.success('Inbox refreshed');
			}}
		>
			<RefreshCwIcon class={cn('size-3.5', (isLoading || isRefreshing) && 'animate-spin')} />
		</button>
	</div>

	<!-- Message list (scrollable) -->
	<div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
		{#if isLoading && messages.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<RefreshCwIcon class="size-5 animate-spin text-muted-foreground" />
				<Meta>Loading emails…</Meta>
			</div>
		{:else if isRefreshing}
			<div class="flex items-center gap-1 px-3 py-0.5">
				<RefreshCwIcon class="size-3 animate-spin text-muted-foreground" />
				<span class="caption text-muted-foreground">Refreshing…</span>
			</div>
		{:else if filteredMessages.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<MailIcon class="size-5 text-muted-foreground" />
				{#if searchQuery}
					<Meta>No emails match your search.</Meta>
				{:else}
					<Meta>No emails yet.</Meta>
				{/if}
			</div>
		{:else}
			<Sidebar.Menu>
				{#each filteredMessages as msg (msg.id)}
					{@const isSelected = selectedId === msg.id}
					<Sidebar.MenuItem>
						<button
							type="button"
							class="ui-radius-md flex h-auto w-full flex-col items-start gap-0.5 overflow-hidden px-3 py-2 text-start"
							class:hover-surface-sidebar-accent={!isSelected}
							class:bg-sidebar-accent={isSelected}
							class:opacity-65={!msg.isUnread && !isSelected}
							onclick={() => {
								openMessage(msg.id, msg.subject);
							}}
							oncontextmenu={(e) => onContextMenu(e, msg)}
						>
							<div class="flex w-full min-w-0 items-start justify-between gap-1">
								<div class="flex min-w-0 items-center gap-1">
									<span class="shell-meta truncate" class:semibold={msg.isUnread}>
										{senderName(msg.from)}
									</span>
									{#if msg.hasAttachments}
										<PaperclipIcon class="size-3 shrink-0 text-muted-foreground" />
									{/if}
								</div>
								<span class="shell-meta flex shrink-0 items-center gap-1 whitespace-nowrap">
									{#if projectsState.emailToProjectMap.has(linkedEmailKey(msg.id))}
										<MailIcon class="size-3 text-sidebar-accent-foreground" />
									{/if}
									{formatDate(msg.date)}
								</span>
							</div>
							<span class="shell-label line-clamp-2 min-w-0" class:semibold={msg.isUnread}>
								{msg.subject || '(no subject)'}
							</span>
							{#if integrationsState.getRfqStatus(msg.id) === 'processing'}
								<span class="caption mt-0.5 animate-pulse">Analysing…</span>
							{:else if integrationsState.getRfqStatus(msg.id) === 'yes'}
								<div class="mt-0.5"><Badge variant="premium" class="px-1.5 py-0">RFQ</Badge></div>
							{/if}
						</button>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>

			<!-- Load More -->
			{#if integrationsState.emailNextPageToken}
				<div class="flex justify-center pt-1">
					<Button
						variant="ghost"
						size="sm"
						class="h-7 w-full gap-1"
						disabled={isLoading}
						onclick={() => {
							if (!appState.hasInternet) return;
							void integrationsState.loadMoreEmailMessages();
						}}
					>
						{#if isLoading}
							<RefreshCwIcon class="size-3 animate-spin" />
							Loading…
						{:else}
							<ChevronDownIcon class="size-3" />
							Load older emails
						{/if}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Right-click context menu -->
{#if contextMenuMsg}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50"
		onclick={closeContextMenu}
		oncontextmenu={(e) => e.preventDefault()}
	></div>
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="ui-radius-md fixed z-50 min-w-[180px] border bg-background p-1"
		style="left: {contextMenuX}px; top: {contextMenuY}px; box-shadow: var(--elevation-overlay)"
		onclick={closeContextMenu}
	>
		<button
			type="button"
			class="ui-radius-md field-copy flex w-full items-center px-3 py-1.5 text-start hover:bg-muted"
			onclick={openMessageFromMenu}
		>
			Open email
		</button>
		<button
			type="button"
			class="ui-radius-md field-copy flex w-full items-center px-3 py-1.5 text-start hover:bg-muted"
			onclick={() => {
				const msg = contextMenuMsg;
				closeContextMenu();
				if (msg) {
					void integrationsState.toggleMessageReadStatus(msg.id, !msg.isUnread);
				}
			}}
		>
			{#if contextMenuMsg?.isUnread}
				Mark as read
			{:else}
				Mark as unread
			{/if}
		</button>
		{#if contextMenuMsg && projectsState.emailToProjectMap.has(linkedEmailKey(contextMenuMsg.id))}
			<button
				type="button"
				class="ui-radius-md field-copy flex w-full items-center px-3 py-1.5 text-start hover:bg-muted"
				onclick={() => {
					const msg = contextMenuMsg;
					if (!msg) return;
					const rfqs = projectsState.emailToProjectMap.get(linkedEmailKey(msg.id));
					if (rfqs && rfqs.length > 0) {
						closeContextMenu();
						void goto('/project/' + encodeURIComponent(rfqs[rfqs.length - 1].id));
					}
				}}
			>
				<ExternalLinkIcon class="mr-1.5 size-3.5" />
				Open RFQ
			</button>
		{:else}
			<button
				type="button"
				class="ui-radius-md field-copy flex w-full items-center px-3 py-1.5 text-start hover:bg-muted"
				disabled={isCreatingRfq}
				onclick={() => void createRfqFromContextMenu()}
			>
				{#if isCreatingRfq}
					<svg class="mr-1.5 size-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
						<path
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
							opacity="0.75"
						/>
					</svg>
					Creating RFQ...
				{:else}
					Create RFQ from email
				{/if}
			</button>
		{/if}
	</div>
{/if}

<!-- Intake dialog for creating RFQ from context menu -->
<IntakeDialog
	bind:open={intakeOpen}
	initialValues={intakeValues}
	initialFiles={intakeFiles}
	hideTrigger={true}
/>
