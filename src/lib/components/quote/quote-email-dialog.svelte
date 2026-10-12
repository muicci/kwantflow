<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileIcon from '@lucide/svelte/icons/file';
	import XIcon from '@lucide/svelte/icons/x';
	import { isTauri } from '$lib/utils/env.js';
	import { toast } from 'svelte-sonner';

	type ContactEmail = { label: string; email: string };

	type QuoteEmailDraft = {
		subject: string;
		body: string;
	};

	let {
		draft,
		open,
		onclose,
		ongenerate,
		generating = false,
		toEmail = '',
		onToEmailChange,
		isEmailConnected = false,
		onSendViaEmail,
		sending = false,
		sendError = '',
		hasInternet = true,
		contactEmails = [] as ContactEmail[],
		localAiReady = false,
		onRemoveAttachment,
		ccList = [] as string[],
		onCcListChange,
		bccList = [] as string[],
		onBccListChange,
		providerName = 'Gmail'
	}: {
		draft: QuoteEmailDraft | null;
		open: boolean;
		onclose: () => void;
		ongenerate: () => void;
		generating?: boolean;
		toEmail?: string;
		onToEmailChange?: (email: string) => void;
		isEmailConnected?: boolean;
		onSendViaEmail?: () => void;
		sending?: boolean;
		sendError?: string;
		hasInternet?: boolean;
		contactEmails?: ContactEmail[];
		localAiReady?: boolean;
		onRemoveAttachment?: () => void;
		ccList?: string[];
		onCcListChange?: (list: string[]) => void;
		bccList?: string[];
		onBccListChange?: (list: string[]) => void;
		providerName?: string;
	} = $props();

	let subject = $state('');
	let body = $state('');
	let ccInput = $state('');
	let bccInput = $state('');
	let showAttachment = $state(true);
	let showCc = $state(false);
	let showBcc = $state(false);
	let toSuggestions = $state<ContactEmail[]>([]);
	let showToSuggestions = $state(false);
	let ccSuggestions = $state<ContactEmail[]>([]);
	let showCcSuggestions = $state(false);
	let bccSuggestions = $state<ContactEmail[]>([]);
	let showBccSuggestions = $state(false);

	function filterSuggestions(value: string): ContactEmail[] {
		if (!value || value.includes('@')) return [];
		const lower = value.toLowerCase();
		return contactEmails
			.filter((c) => c.label.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower))
			.slice(0, 6);
	}

	function updateToSuggestions(value: string) {
		const result = filterSuggestions(value);
		toSuggestions = result;
		showToSuggestions = result.length > 0;
	}

	function selectToSuggestion(contact: ContactEmail) {
		onToEmailChange?.(contact.email);
		toSuggestions = [];
		showToSuggestions = false;
	}

	function updateCcSuggestions(value: string) {
		const result = filterSuggestions(value);
		ccSuggestions = result;
		showCcSuggestions = result.length > 0;
	}

	function selectCcSuggestion(contact: ContactEmail) {
		const email = contact.email;
		if (!ccList.includes(email)) {
			onCcListChange?.([...ccList, email]);
		}
		ccInput = '';
		ccSuggestions = [];
		showCcSuggestions = false;
	}

	function updateBccSuggestions(value: string) {
		const result = filterSuggestions(value);
		bccSuggestions = result;
		showBccSuggestions = result.length > 0;
	}

	function selectBccSuggestion(contact: ContactEmail) {
		const email = contact.email;
		if (!bccList.includes(email)) {
			onBccListChange?.([...bccList, email]);
		}
		bccInput = '';
		bccSuggestions = [];
		showBccSuggestions = false;
	}

	function addCcTag(e: KeyboardEvent) {
		if (e.key === 'Enter' && ccInput.trim()) {
			e.preventDefault();
			if (!ccList.includes(ccInput.trim())) {
				const next = [...ccList, ccInput.trim()];
				onCcListChange?.(next);
			}
			ccInput = '';
		}
	}

	function removeCcTag(email: string) {
		onCcListChange?.(ccList.filter((e) => e !== email));
	}

	function addBccTag(e: KeyboardEvent) {
		if (e.key === 'Enter' && bccInput.trim()) {
			e.preventDefault();
			if (!bccList.includes(bccInput.trim())) {
				const next = [...bccList, bccInput.trim()];
				onBccListChange?.(next);
			}
			bccInput = '';
		}
	}

	function removeBccTag(email: string) {
		onBccListChange?.(bccList.filter((e) => e !== email));
	}

	$effect(() => {
		if (!open) {
			sendError = '';
			showAttachment = true;
			return;
		}
		// Update form fields whenever draft changes (initial open or after generation).
		if (draft) {
			subject = draft.subject;
			body = draft.body;
		}
	});

	function handleGenerate() {
		ongenerate();
	}

	function isValidEmail(email: string): boolean {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	}

	function validateEmails(): boolean {
		if (toEmail && !isValidEmail(toEmail)) {
			toast.error('Invalid email address in To field');
			return false;
		}
		for (const email of ccList) {
			if (!isValidEmail(email)) {
				toast.error(`Invalid email in CC: ${email}`);
				return false;
			}
		}
		for (const email of bccList) {
			if (!isValidEmail(email)) {
				toast.error(`Invalid email in BCC: ${email}`);
				return false;
			}
		}
		return true;
	}

	function handleRemoveAttachment() {
		showAttachment = false;
		onRemoveAttachment?.();
	}

	function handleSend() {
		if (!validateEmails()) return;
		onSendViaEmail?.();
	}

	async function handleOpenMailApp() {
		if (!validateEmails()) return;
		// Build a minimal mailto: URL with just recipient and subject.
		// The full body is copied to clipboard instead of URL-encoding it into the mailto:
		// link, because mailto: URLs with long bodies are unreliable across macOS email
		// configurations — browsers may intercept the link, and length limits cause truncation.
		const mailtoSubject = encodeURIComponent(subject);
		const mailtoTo = toEmail ? encodeURIComponent(toEmail) : '';
		const mailtoCc = ccList.length ? `&cc=${ccList.map(encodeURIComponent).join(',')}` : '';
		const mailtoBcc = bccList.length ? `&bcc=${bccList.map(encodeURIComponent).join(',')}` : '';
		const mailtoString = mailtoTo
			? `mailto:${mailtoTo}?subject=${mailtoSubject}${mailtoCc}${mailtoBcc}`
			: `mailto:?subject=${mailtoSubject}${mailtoCc}${mailtoBcc}`;

		// Copy the full email body to clipboard so the user can paste it
		try {
			await navigator.clipboard.writeText(body);
		} catch {
			toast.error('Could not copy email body to clipboard');
			return;
		}

		if (isTauri()) {
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(mailtoString);
		} else {
			globalThis.open?.(mailtoString, '_blank', 'noopener,noreferrer');
		}
		toast.success('Email body copied — paste into your email app');
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		if (!next) onclose();
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col sm:max-w-lg">
		<div class="flex max-h-[calc(90vh-4rem)] flex-col overflow-y-auto pr-1">
			<Dialog.Header>
				<Text as="h2" class="title-copy">Send quote by email</Text>
			</Dialog.Header>

			<div class="space-y-3">
				<div class="relative space-y-1">
					<div class="flex items-center gap-2">
						<Meta class="shrink-0">To</Meta>
						{#if !showCc}
							<button
								type="button"
								onclick={() => (showCc = true)}
								class="caption hover:text-foreground">+CC</button
							>
						{/if}
						{#if !showBcc}
							<button
								type="button"
								onclick={() => (showBcc = true)}
								class="caption hover:text-foreground">+BCC</button
							>
						{/if}
					</div>
					<Input
						type="email"
						autocomplete="email"
						value={toEmail}
						placeholder="client@example.com"
						oninput={(e) => {
							onToEmailChange?.(e.currentTarget.value);
							updateToSuggestions(e.currentTarget.value);
						}}
						onblur={() => setTimeout(() => (showToSuggestions = false), 200)}
						onfocus={() => {
							if (toSuggestions.length) showToSuggestions = true;
						}}
					/>
					{#if showToSuggestions}
						<div
							class="ui-radius-lg absolute z-50 mt-1 w-full border bg-background p-1"
							style="box-shadow: var(--elevation-overlay)"
						>
							{#each toSuggestions as contact (contact.email)}
								<button
									type="button"
									onclick={() => selectToSuggestion(contact)}
									class="ui-radius-md field-copy flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted"
								>
									<span class="semibold truncate">{contact.label}</span>
									<span class="caption shrink-0">{contact.email}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if showCc || showBcc}
					<div class="flex gap-3">
						{#if showCc}
							<div class="relative flex-1 space-y-1">
								<Meta>CC</Meta>
								<Input
									type="email"
									autocomplete="email"
									bind:value={ccInput}
									placeholder="cc@example.com"
									onkeydown={addCcTag}
									oninput={(e) => updateCcSuggestions(e.currentTarget.value)}
									onblur={() => setTimeout(() => (showCcSuggestions = false), 200)}
									onfocus={() => {
										if (ccSuggestions.length) showCcSuggestions = true;
									}}
								/>
								{#if showCcSuggestions}
									<div
										class="ui-radius-lg absolute z-50 mt-1 w-full border bg-background p-1"
										style="box-shadow: var(--elevation-overlay)"
									>
										{#each ccSuggestions as contact (contact.email)}
											<button
												type="button"
												onclick={() => selectCcSuggestion(contact)}
												class="ui-radius-md field-copy flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted"
											>
												<span class="semibold truncate">{contact.label}</span>
												<span class="caption shrink-0">{contact.email}</span>
											</button>
										{/each}
									</div>
								{/if}
								<div class="flex flex-wrap gap-1">
									{#each ccList as email (email)}
										<span
											class="ui-radius-md caption inline-flex items-center gap-1 bg-muted px-2 py-0.5"
										>
											{email}
											<button
												type="button"
												onclick={() => removeCcTag(email)}
												class="hover:text-destructive"><XIcon class="size-3" /></button
											>
										</span>
									{/each}
								</div>
							</div>
						{/if}
						{#if showBcc}
							<div class="relative flex-1 space-y-1">
								<Meta>BCC</Meta>
								<Input
									type="email"
									autocomplete="email"
									bind:value={bccInput}
									placeholder="bcc@example.com"
									onkeydown={addBccTag}
									oninput={(e) => updateBccSuggestions(e.currentTarget.value)}
									onblur={() => setTimeout(() => (showBccSuggestions = false), 200)}
									onfocus={() => {
										if (bccSuggestions.length) showBccSuggestions = true;
									}}
								/>
								{#if showBccSuggestions}
									<div
										class="ui-radius-lg absolute z-50 mt-1 w-full border bg-background p-1"
										style="box-shadow: var(--elevation-overlay)"
									>
										{#each bccSuggestions as contact (contact.email)}
											<button
												type="button"
												onclick={() => selectBccSuggestion(contact)}
												class="ui-radius-md field-copy flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted"
											>
												<span class="semibold truncate">{contact.label}</span>
												<span class="caption shrink-0">{contact.email}</span>
											</button>
										{/each}
									</div>
								{/if}
								<div class="flex flex-wrap gap-1">
									{#each bccList as email (email)}
										<span
											class="ui-radius-md caption inline-flex items-center gap-1 bg-muted px-2 py-0.5"
										>
											{email}
											<button
												type="button"
												onclick={() => removeBccTag(email)}
												class="hover:text-destructive"><XIcon class="size-3" /></button
											>
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
				<div class="space-y-1">
					<Meta>Subject</Meta>
					<Input bind:value={subject} placeholder="Quote for..." />
				</div>
				<div class="space-y-1">
					<Meta>Body</Meta>
					<Textarea
						bind:value={body}
						rows={10}
						class="max-h-96 w-full resize-y font-mono"
						placeholder="Dear ...,%0APlease find attached our quotation..."
					/>
				</div>

				{#if showAttachment}
					<div
						class="group ui-radius-md muted flex items-center gap-2 border border-dashed px-3 py-2"
					>
						<FileIcon class="size-4 shrink-0" />
						<span>Kwantflow_quote.pdf</span>
						<button
							type="button"
							class="ui-radius-md ml-auto flex size-5 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted-foreground/10"
							title="Remove attachment"
							onclick={handleRemoveAttachment}
						>
							<XIcon class="size-3" />
						</button>
						<span class="badge-label">attached</span>
					</div>
				{/if}
			</div>

			{#if sendError}
				<div
					class="ui-radius-md caption status-text-destructive border border-destructive/30 bg-destructive/5 px-4 py-2"
				>
					{sendError}
				</div>
			{/if}

			<div class="flex flex-wrap items-center justify-end gap-2 pt-2">
				<Button
					variant="secondary"
					size="sm"
					class="gap-1"
					onclick={handleGenerate}
					disabled={generating || !localAiReady}
					title={!localAiReady ? 'Download Kwantflow AI to use AI drafting' : ''}
				>
					{#if generating}
						<div
							class="mr-1.5 size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
						></div>
						Generating…
					{:else}
						<FileTextIcon class="size-3.5" />
						Generate draft
					{/if}
				</Button>

				{#if isEmailConnected}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="default"
									size="sm"
									class="gap-1"
									disabled={sending || !toEmail || !hasInternet}
								>
									{#if sending}
										<div
											class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
										></div>
										Sending…
									{:else}
										Send email
										<ChevronDownIcon class="size-3.5" />
									{/if}
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="ui-menu-width-sm">
							<DropdownMenu.Item onclick={handleSend}>
								<div class="flex items-center gap-2">
									<ExternalLinkIcon class="size-3.5" />
									Send via {providerName}
								</div>
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={handleOpenMailApp}>
								<div class="flex items-center gap-2">
									<ExternalLinkIcon class="size-3.5" />
									Open in mail app
								</div>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{:else}
					<Button variant="default" size="sm" onclick={handleOpenMailApp}>
						<ExternalLinkIcon class="size-3.5" />
						Open in mail app
					</Button>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
