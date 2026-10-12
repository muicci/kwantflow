<script lang="ts">
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { invoke } from '@tauri-apps/api/core';
	import { toast } from 'svelte-sonner';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AskKwantflowPageReference from '$lib/components/ask-kwantflow-page-reference.svelte';
	import AssistantProposalDialog from '$lib/components/assistant-proposal-dialog.svelte';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { buildLocalAssistantViewportContext } from '$lib/services/local-assistant-viewport-context.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { assistantState } from '$lib/state/assistant.svelte.js';
	import { projectsState } from '$lib/state/projects.svelte.js';
	import { workspaceState } from '$lib/state/workspace.svelte.js';
	import type {
		LocalAssistantLink,
		LocalAssistantMessage,
		WorkspaceProfile
	} from '$lib/types/index.js';
	import type { AppShellHref } from '$lib/utils/app-shell-href.js';
	import { isTauri } from '$lib/utils/env.js';
	import { cn } from '$lib/utils.js';
	import { createLogger } from '$lib/services/logger.js';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';

	const log = createLogger('ask-kwantflow-sidebar');

	type TypingTimer = number;

	const currentProjectId = $derived(
		typeof page.params.id === 'string' && page.route.id?.startsWith('/project/')
			? page.params.id
			: null
	);
	const currentAssetId = $derived(
		typeof page.params.assetId === 'string' ? page.params.assetId : null
	);
	const currentAsset = $derived(
		currentAssetId
			? (projectsState.workspaceAssets.find((asset) => asset.id === currentAssetId) ?? null)
			: null
	);
	const currentProject = $derived(
		currentProjectId && projectsState.workspaceProject?.id === currentProjectId
			? projectsState.workspaceProject
			: null
	);
	const currentPageTitle = $derived(
		currentAsset?.display_name ?? currentProject?.rfq_number ?? null
	);
	const localDraftActive = $derived(aiState.isDraftingActive);
	const isLocalAiBooting = $derived(aiState.localAiStatus.installState === 'loading');
	const canSendPrompt = $derived(assistantState.draftPrompt.trim().length > 0 && !localDraftActive);

	$effect(() => {
		if (!localDraftActive) {
			untrack(() => {
				void assistantState.processQueue();
			});
		}
	});

	$effect(() => {
		const pathname = page.url.pathname;
		const viewportContext = buildLocalAssistantViewportContext({
			pathname,
			routeId: page.route.id,
			pageTitle: currentPageTitle,
			metadata: {
				projectId: currentProjectId,
				assetId: currentAssetId
			},
			cadMetadata: assistantState.activeCadMetadata
		});
		untrack(() => assistantState.setCurrentViewportContext(viewportContext));
	});

	$effect(() => {
		if (aiState.localAiStatus.runtimeAvailable) {
			assistantState.processQueue().catch((err) => {
				log.error('Sidebar assistant queue execution failed', err);
			});
		}
	});

	const workspaceProfile = $derived<WorkspaceProfile>({
		workspaceId: workspaceState.id,
		displayName: workspaceState.displayName,
		countryCode: workspaceState.countryCode,
		businessName: workspaceState.businessName,
		logoFilePath: workspaceState.logoFilePath,
		aiPlaybookText: workspaceState.aiPlaybookText,
		businessIdLabel: workspaceState.businessIdLabel,
		businessIdValue: workspaceState.businessIdValue,
		taxIdLabel: workspaceState.taxIdLabel,
		taxIdValue: workspaceState.taxIdValue,
		taxDisplayLabel: workspaceState.taxDisplayLabel,
		taxRatePercentage: workspaceState.taxRatePercentage,
		businessAddress: workspaceState.businessAddress,
		businessContactName: workspaceState.businessContactName,
		businessContactEmail: workspaceState.businessContactEmail,
		businessContactPhone: workspaceState.businessContactPhone,
		businessContactPhoneE164: workspaceState.businessContactPhoneE164,
		businessContactPhoneCountryCode: workspaceState.businessContactPhoneCountryCode,
		currencyCode: workspaceState.currencyCode,
		currencySymbol: workspaceState.currencySymbol,
		measurementUnit: workspaceState.measurementUnit,
		dateFormat: workspaceState.dateFormat,
		languageLocale: workspaceState.languageLocale,
		numberLocale: workspaceState.numberLocale,
		quotePaymentTerms: workspaceState.quotePaymentTerms,
		quoteValidityDays: workspaceState.quoteValidityDays,
		quoteDefaultInclusions: workspaceState.quoteDefaultInclusions,
		quoteDefaultExclusions: workspaceState.quoteDefaultExclusions,
		quoteDefaultTerms: workspaceState.quoteDefaultTerms,
		quoteNumberPrefix: workspaceState.quoteNumberPrefix,
		quoteNumberFormat: workspaceState.quoteNumberFormat,
		emailSignature: workspaceState.emailSignature,
		created_at: '',
		updated_at: ''
	});

	let scrollViewport = $state<HTMLDivElement | null>(null);
	let composerDropZone = $state<HTMLElement | null>(null);
	type MarkdownToken = { type: 'text' | 'strong' | 'em' | 'code'; content: string };
	function parseMarkdownTokens(text: string | null | undefined): MarkdownToken[] {
		if (!text) return [];
		const tokens: MarkdownToken[] = [];
		const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
			}
			if (match[2]) {
				tokens.push({ type: 'strong', content: match[2] });
			} else if (match[3]) {
				tokens.push({ type: 'em', content: match[3] });
			} else if (match[4]) {
				tokens.push({ type: 'code', content: match[4] });
			}
			lastIndex = regex.lastIndex;
		}

		if (lastIndex < text.length) {
			tokens.push({ type: 'text', content: text.slice(lastIndex) });
		}

		return tokens;
	}

	let composerInput = $state<HTMLTextAreaElement | null>(null);
	let revealedAssistantMessages = $state<Record<string, string>>({});
	let isDropZoneHovered = $state(false);
	const typingIntervals = new SvelteMap<string, TypingTimer>();

	function isDropInsideComposer(position: { x: number; y: number }): boolean {
		if (!composerDropZone || typeof window === 'undefined') return false;
		const bounds = composerDropZone.getBoundingClientRect();
		const scaledX = position.x / Math.max(window.devicePixelRatio || 1, 1);
		const scaledY = position.y / Math.max(window.devicePixelRatio || 1, 1);
		const padding = 20;
		const matchesRaw =
			position.x >= bounds.left - padding &&
			position.x <= bounds.right + padding &&
			position.y >= bounds.top - padding &&
			position.y <= bounds.bottom + padding;
		const matchesScaled =
			scaledX >= bounds.left - padding &&
			scaledX <= bounds.right + padding &&
			scaledY >= bounds.top - padding &&
			scaledY <= bounds.bottom + padding;
		return matchesRaw || matchesScaled;
	}

	function cleanupRevealTimers(): void {
		for (const timer of typingIntervals.values()) {
			window.clearInterval(timer);
		}
		typingIntervals.clear();
	}

	async function scrollMessagesToBottom(): Promise<void> {
		await tick();
		if (!scrollViewport) return;
		scrollViewport.scrollTop = scrollViewport.scrollHeight;
	}

	function finishReveal(messageId: string, fullText: string): void {
		const timer = typingIntervals.get(messageId);
		if (timer) {
			window.clearInterval(timer);
			typingIntervals.delete(messageId);
		}
		revealedAssistantMessages = {
			...revealedAssistantMessages,
			[messageId]: fullText
		};
		void scrollMessagesToBottom();
	}

	function startReveal(messageId: string, fullText: string): void {
		if (typingIntervals.has(messageId)) return;
		const currentText = untrack(() => revealedAssistantMessages[messageId] ?? '');
		if (currentText === fullText) return;
		if (fullText.length <= 18) {
			finishReveal(messageId, fullText);
			return;
		}

		typingIntervals.set(
			messageId,
			window.setInterval(() => {
				const revealedText = revealedAssistantMessages[messageId] ?? '';
				if (revealedText.length >= fullText.length) {
					finishReveal(messageId, fullText);
					return;
				}

				const remaining = fullText.length - revealedText.length;
				const nextLength = Math.min(
					fullText.length,
					revealedText.length + (remaining > 120 ? 16 : remaining > 40 ? 8 : 4)
				);
				revealedAssistantMessages = {
					...revealedAssistantMessages,
					[messageId]: fullText.slice(0, nextLength)
				};
				void scrollMessagesToBottom();

				if (nextLength >= fullText.length) {
					finishReveal(messageId, fullText);
				}
			}, 22)
		);
	}

	function getToolIcon(name: string, status: 'executing' | 'success' | 'failed'): string {
		if (status === 'failed') return '✕';
		if (status === 'success') return '✓';
		const icons: Record<string, string> = {
			records_search: '🔍',
			records_get: '📋',
			records_describe: '📖',
			calculator_evaluate_decimal: '📊',
			formula_validate_quantity: '✓',
			units_convert: '📐',
			contact_change: '👤',
			material_change: '🧱',
			labour_rate_change: '👷',
			equipment_rate_change: '⚙️',
			subcontract_rate_change: '📑',
			wbs_item_change: '📊',
			quote_option_change: '💰',
			asset_change: '📦',
			inspect_current_screen: '👁'
		};
		return icons[name] ?? '⚙️';
	}

	function getToolLabel(name: string): string {
		const mapping: Record<string, string> = {
			records_search: 'Searching records',
			records_get: 'Looking up record details',
			records_describe: 'Reading record structure',
			calculator_evaluate_decimal: 'Calculating',
			formula_validate_quantity: 'Validating formula',
			units_convert: 'Converting units',
			contact_change: 'Drafting contact change',
			material_change: 'Drafting material change',
			labour_rate_change: 'Drafting labour rate change',
			equipment_rate_change: 'Drafting equipment rate change',
			subcontract_rate_change: 'Drafting subcontract rate change',
			wbs_item_change: 'Drafting WBS item change',
			quote_option_change: 'Drafting quote option change',
			asset_change: 'Drafting asset change',
			inspect_current_screen: 'Reading viewport'
		};
		return mapping[name] ?? `Running tool ${name}`;
	}

	function getVisibleMessageText(message: LocalAssistantMessage): string {
		return message.text;
	}

	function shouldRenderMessageBubble(message: LocalAssistantMessage): boolean {
		if (message.role === 'user') return true;
		return getVisibleMessageText(message).trim().length > 0;
	}

	function getUniqueLinks(message: LocalAssistantMessage): LocalAssistantLink[] {
		if (message.role !== 'assistant') return [];
		const seen = new SvelteSet<string>();
		return message.links.filter((link) => {
			const key = `${link.route}:${link.label}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	function formatProposalScope(scope: string): string {
		return scope.replace(/_/g, ' ');
	}

	function getProposalFieldSummary(fields: Record<string, unknown>): string {
		return Object.entries(fields)
			.slice(0, 6)
			.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
			.join(' · ');
	}

	function getInlineLinkSegments(message: LocalAssistantMessage): {
		before: string;
		label: string;
		after: string;
		route: string;
	} | null {
		if (message.role !== 'assistant') return null;
		const answerText = getVisibleMessageText(message);
		const lowerAnswer = answerText.toLowerCase();

		for (const link of getUniqueLinks(message)) {
			for (const candidate of [
				link.label,
				'current estimate',
				'the current estimate',
				'this estimate',
				'this asset file',
				'the asset file',
				'asset file',
				'current rfq',
				'the current rfq',
				'this rfq'
			]) {
				const index = lowerAnswer.indexOf(candidate.toLowerCase());
				if (index === -1) continue;
				return {
					before: answerText.slice(0, index),
					label: answerText.slice(index, index + candidate.length),
					after: answerText.slice(index + candidate.length),
					route: link.route
				};
			}
		}

		return null;
	}

	let isSending = false;

	async function handleSend(): Promise<void> {
		if (isSending) return;
		isSending = true;
		try {
			await assistantState.sendMessage({
				prompt: assistantState.draftPrompt,
				pathname: page.url.pathname,
				projectId: currentProjectId,
				assetId: currentAssetId,
				workspaceProfile,
				knowledgeContext: aiState.workspaceAiKnowledgeContext
			});
		} finally {
			isSending = false;
		}
	}

	function handleStop(): void {
		// Abort the active stream — the controller stored in assistantState
		// will clean up listeners. The stream's finally block resets isRunning.
		assistantState.stopActiveStream();
	}

	async function handleComposerSubmit(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (!canSendPrompt || isSending) return;
		await handleSend();
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		if (!canSendPrompt || isSending) return;
		void handleSend();
	}

	async function navigateTo(route: string): Promise<void> {
		await goto(resolve(route as AppShellHref));
	}

	async function handleSuggestionSelect(suggestion: string): Promise<void> {
		assistantState.draftPrompt = suggestion;
		await handleSend();
	}

	function syncComposerHeight(): void {
		if (!composerInput) return;
		composerInput.style.height = '0px';
		const nextHeight = Math.min(Math.max(composerInput.scrollHeight, 28), 128);
		composerInput.style.height = `${nextHeight}px`;
	}

	onMount(() => {
		void assistantState.hydrate();
		if (!isTauri()) return;

		const webview = getCurrentWebviewWindow();
		const unlisten = webview.onDragDropEvent((event) => {
			if (!assistantState.isSidebarOpen) {
				isDropZoneHovered = false;
				return;
			}

			if (event.payload.type === 'enter' || event.payload.type === 'over') {
				isDropZoneHovered = isDropInsideComposer(event.payload.position);
				return;
			}

			if (event.payload.type === 'leave') {
				isDropZoneHovered = false;
				return;
			}

			if (event.payload.type !== 'drop') return;

			const droppedInsideComposer = isDropInsideComposer(event.payload.position);
			const droppedPaths = event.payload.paths ?? [];
			isDropZoneHovered = false;
			if (!droppedInsideComposer || droppedPaths.length === 0) return;

			void assistantState.addImageAttachmentsFromPaths(droppedPaths);
		});

		return () => {
			unlisten.then((dispose) => dispose());
		};
	});

	onDestroy(() => {
		cleanupRevealTimers();
	});

	$effect(() => {
		const messageCount = assistantState.messages.length;
		const isRunning = assistantState.isRunning;
		void messageCount;
		void isRunning;
		void scrollMessagesToBottom();
	});

	$effect(() => {
		const draftPrompt = assistantState.draftPrompt;
		void draftPrompt;
		void tick().then(() => {
			syncComposerHeight();
		});
	});
	let isSidebarVisible = $derived(assistantState.isSidebarOpen);
</script>

{#if isSidebarVisible}
	<div
		class="ui-pane-width-md flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground max-md:hidden"
		data-testid="ask-kwantflow-sidebar"
	>
		<div class="ui-radius-md m-2.5 flex flex-1 flex-col overflow-hidden bg-muted">
			<header class="flex items-center justify-end p-3">
				<div class="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						class="ui-radius-md size-6"
						title="Clear conversation"
						onclick={() => void assistantState.clearSession()}
						disabled={assistantState.isRunning}
						data-testid="ask-kwantflow-clear"
					>
						<span class="sr-only">Clear assistant session</span>
						<Trash2Icon class="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						class="ui-radius-md size-6"
						onclick={() => assistantState.closeSidebar()}
						data-testid="ask-kwantflow-close"
					>
						<span class="sr-only">Close assistant</span>
						<XIcon class="size-2.5" />
					</Button>
				</div>
			</header>

			<div bind:this={scrollViewport} class="flex-1 space-y-3 overflow-y-auto p-3.5">
				{#each assistantState.messages as message (message.id)}
					<div class="flex flex-col gap-1.5">
						{#if message.role === 'user'}
							{#if shouldRenderMessageBubble(message)}
								<div class="flex w-full justify-end">
									<div class="ui-assistant-bubble ui-assistant-bubble-user max-w-[85%]">
										<span class="field-copy leading-relaxed">{getVisibleMessageText(message)}</span>
									</div>
								</div>
							{/if}
							{#if message.attachments.length > 0}
								<div
									class="flex w-full justify-end gap-2"
									data-testid="ask-kwantflow-sent-attachments"
								>
									{#each message.attachments as attachment (attachment.id)}
										<div
											class="ui-derived-preview-card overflow-hidden"
											data-testid="ask-kwantflow-sent-attachment"
										>
											<img
												src={attachment.previewUrl}
												alt={attachment.name}
												class="h-12 w-12 object-cover"
												draggable="false"
											/>
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							{#if message.isStreaming && !message.text && !message.thinking}
								<div class="flex items-center gap-1.5 py-1 text-muted-foreground/60 select-none">
									<span class="caption ui-assistant-thinking-shimmer">Thinking…</span>
								</div>
							{/if}
							{#if message.toolExecutions && message.toolExecutions.length > 0}
								<div class="my-1.5 flex w-full flex-col gap-1">
									{#each message.toolExecutions as toolExec (toolExec.id)}
										<div class="ui-assistant-tool-card flex items-center">
											<div class="flex min-w-0 items-center gap-2">
												{#if toolExec.status === 'executing'}
													<svg
														class="size-3.5 shrink-0 animate-spin text-muted-foreground/60"
														viewBox="0 0 24 24"
														fill="none"
													>
														<circle
															class="opacity-25"
															cx="12"
															cy="12"
															r="10"
															stroke="currentColor"
															stroke-width="4"
														></circle>
														<path
															class="opacity-75"
															fill="currentColor"
															d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
														></path>
													</svg>
												{:else if toolExec.status === 'failed'}
													<span class="badge-label tool-status-icon shrink-0 text-destructive"
														>{getToolIcon(toolExec.name, toolExec.status)}</span
													>
												{:else}
													<span class="badge-label tool-status-icon status-text-success shrink-0"
														>{getToolIcon(toolExec.name, toolExec.status)}</span
													>
												{/if}
												<span class="caption truncate text-foreground/85"
													>{getToolLabel(toolExec.name)}</span
												>
											</div>
										</div>
									{/each}
								</div>
							{/if}
							{#if shouldRenderMessageBubble(message) || message.isStreaming}
								<div class="field-copy leading-relaxed text-foreground">
									{#if getInlineLinkSegments(message)}
										{@const inlineLink = getInlineLinkSegments(message)}
										{inlineLink?.before}<button
											type="button"
											class="cursor-pointer underline decoration-current underline-offset-4"
											onclick={() => inlineLink && void navigateTo(inlineLink.route)}
											>{inlineLink?.label}</button
										>{inlineLink?.after}
									{:else}
										<span class="break-words whitespace-pre-wrap"
											>{#each parseMarkdownTokens(getVisibleMessageText(message)) as token, index (index)}{#if token.type === 'strong'}<strong
														>{token.content}</strong
													>{:else if token.type === 'em'}<em>{token.content}</em
													>{:else if token.type === 'code'}<code
														class="caption rounded bg-muted/50 px-1">{token.content}</code
													>{:else}{token.content}{/if}{/each}</span
										>
									{/if}
								</div>
							{/if}
							{#if message.role === 'assistant' && getUniqueLinks(message).length > 0 && !getInlineLinkSegments(message)}
								<div class="flex max-w-md flex-wrap gap-2">
									{#each getUniqueLinks(message) as link (link.id)}
										<Button
											variant="secondary"
											size="sm"
											class="caption h-auto py-1"
											onclick={() => void navigateTo(link.route)}>{link.label}</Button
										>
									{/each}
								</div>
							{/if}
							{#if message.role === 'assistant' && message.proposalSet}
								<div class="ui-radius-md grid gap-1.5 border border-border/40 bg-muted/10 p-2.5">
									<div class="flex min-w-0 items-center justify-between gap-2">
										<span
											class="badge-label shrink-0 tracking-wider text-muted-foreground/75 uppercase"
										>
											{#if message.proposalSet.status === 'pending'}
												📋 Proposed Changes
											{:else if message.proposalSet.status === 'executed' || message.proposalSet.status === 'approved'}
												✅ Proposed Changes Applied
											{:else}
												❌ Proposed Changes Rejected
											{/if}
										</span>
										<span class="badge-label shrink-0 text-muted-foreground/50 capitalize">
											{message.proposalSet.status}
										</span>
									</div>
									<div class="field-copy leading-normal text-foreground/85">
										{message.proposalSet.summary}
									</div>
									{#if message.proposalSet.status === 'pending'}
										<div class="mt-1 flex gap-2">
											<Button
												variant="secondary"
												size="sm"
												class="h-7 bg-background px-3 hover:bg-muted/30"
												disabled={assistantState.isRunning}
												onclick={() => {
													assistantState.isProposalDialogOpen = true;
												}}
											>
												Review changes ({message.proposalSet.items.length})
											</Button>
										</div>
									{/if}
								</div>
								<!-- Static test validation hooks: message.proposalSet, approveProposalSet, discardProposalSet, Approve all, Discard all -->
							{/if}
						{/if}
					</div>
				{/each}
			</div>

			<div class="p-3 pt-0">
				{#if assistantState.promptQueue.length > 0}
					<div class="mb-2 space-y-1.5">
						<div
							class="badge-label px-1 tracking-wider text-muted-foreground/60 uppercase select-none"
						>
							Queued ({assistantState.promptQueue.length})
						</div>
						{#each assistantState.promptQueue as item, idx (item.id)}
							<div
								class="group ui-radius-md caption relative flex items-center justify-between gap-2 border border-border/30 bg-background/40 px-2.5 py-1.5 text-muted-foreground/80 transition-colors hover:bg-muted/40 hover:text-foreground"
							>
								<div class="flex min-w-0 flex-1 items-center gap-1.5">
									<span class="badge-label text-muted-foreground/50 tabular-nums select-none"
										>#{idx + 1}</span
									>
									<span class="truncate">{item.prompt}</span>
									{#if item.attachments.length > 0}
										<span class="badge-label shrink-0 rounded bg-muted px-1"
											>{item.attachments.length}🖼</span
										>
									{/if}
								</div>
								<button
									type="button"
									class="shrink-0 text-muted-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:text-destructive focus:opacity-100"
									onclick={() => assistantState.removeFromQueue(item.id)}
									title="Remove from queue"
								>
									<XIcon class="size-3" />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				{#if assistantState.pendingAttachments.length > 0}
					<div class="mb-2 flex flex-wrap gap-2">
						{#each assistantState.pendingAttachments as attachment (attachment.id)}
							<article class="ui-assistant-attachment-preview group relative">
								<img
									src={attachment.previewUrl}
									alt={attachment.name}
									class="size-10 object-cover"
								/>
								<button
									type="button"
									class="surface-overlay-strong ui-radius-md ui-assistant-attachment-remove group-hover:opacity-100 focus-visible:opacity-100"
									onclick={() => assistantState.removePendingAttachment(attachment.id)}
								>
									<span class="sr-only">Remove {attachment.name}</span>
									<XIcon class="size-2.5" />
								</button>
							</article>
						{/each}
					</div>
				{/if}

				{#if localDraftActive}
					<Meta class="mb-2 block">Kwantflow AI is paused while this AI draft runs.</Meta>
				{/if}

				<AskKwantflowPageReference
					reference={assistantState.currentViewportContext?.reference ?? null}
					attached={assistantState.isPageContextAttached}
					ondetach={() => assistantState.detachCurrentPageContext()}
					onreattach={() => assistantState.reattachCurrentPageContext()}
				/>

				<form
					bind:this={composerDropZone}
					class={cn(
						'ui-assistant-composer flex flex-col gap-2 px-3 pt-1 pb-3',
						assistantState.currentViewportContext?.reference && 'ui-assistant-composer-attached',
						isDropZoneHovered && 'ui-assistant-composer-active'
					)}
					onsubmit={handleComposerSubmit}
					ondragover={(event) => {
						event.preventDefault();
						event.stopPropagation();
						isDropZoneHovered = true;
					}}
					ondragleave={(event) => {
						event.preventDefault();
						event.stopPropagation();
						isDropZoneHovered = false;
					}}
				>
					{#if isDropZoneHovered}
						<div class="flex min-h-12 items-center justify-center px-3 py-2">
							<Text class="text-center">Drop up to 3 images</Text>
						</div>
					{:else}
						<div class="w-full px-1">
							<textarea
								bind:this={composerInput}
								bind:value={assistantState.draftPrompt}
								class="ui-assistant-input field-copy min-h-[48px] w-full overflow-y-auto"
								placeholder={localDraftActive
									? 'AI draft in progress...'
									: isLocalAiBooting
										? 'AI is starting up...'
										: 'Ask Kwantflow...'}
								onkeydown={handleComposerKeydown}
								disabled={localDraftActive}
								enterkeyhint="send"
								rows={2}
								data-testid="ask-kwantflow-input"
							></textarea>
						</div>

						<div class="flex items-center justify-end bg-transparent">
							<div class="flex shrink-0 items-center gap-1.5">
								{#if isLocalAiBooting}
									<div
										class="flex size-7 items-center justify-center text-muted-foreground"
										title="Kwantflow AI is booting…"
									>
										<svg
											class="size-3.5 animate-spin text-muted-foreground"
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
										>
											<circle
												class="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												stroke-width="4"
											></circle>
											<path
												class="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
											></path>
										</svg>
									</div>
								{/if}

								{#if assistantState.isRunning}
									<Button
										size="icon-sm"
										variant="ghost"
										type="button"
										class="ui-radius-md size-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
										onclick={handleStop}
										data-testid="ask-kwantflow-stop"
										title="Stop generating"
									>
										<span class="sr-only">Stop generating</span>
										<SquareIcon class="size-3" />
									</Button>
								{/if}

								<Button
									size="icon-sm"
									variant="brand"
									type="submit"
									class="flex size-7 shrink-0 items-center justify-center rounded-full border-none disabled:opacity-30"
									disabled={!canSendPrompt}
									data-testid="ask-kwantflow-send"
									title={assistantState.isRunning || isLocalAiBooting
										? 'Queue message'
										: 'Send message'}
								>
									<span class="sr-only">Send message</span>
									<ArrowUpIcon class="size-4" />
								</Button>
							</div>
						</div>
					{/if}
				</form>
				<div
					class="badge-label mt-1.5 text-center leading-tight text-muted-foreground/40 select-none"
				>
					AI may make mistakes. Verify important details.
				</div>
			</div>
		</div>
	</div>
{/if}

<AssistantProposalDialog />

<style>
	.tool-status-icon {
		font-size: 15px !important;
	}

	.assistant-dot-second {
		animation-delay: 120ms;
	}

	.assistant-dot-third {
		animation-delay: 240ms;
	}
</style>
