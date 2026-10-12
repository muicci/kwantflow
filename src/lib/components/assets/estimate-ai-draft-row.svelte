<script lang="ts">
	import FormHelpTooltip from '$lib/components/form-help-tooltip.svelte';
	import { Meta, Text } from '$lib/components/primitives/index.js';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { AiEvidenceRef, AiIssue, AiRunProgressDetail } from '$lib/types/index.js';
	import EstimateAiProgressTerminal from '$lib/components/assets/estimate-ai-progress-terminal.svelte';
	import { formatDisplayedAiIssueMessage } from '$lib/components/assets/estimate-ai-review.js';

	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	type UnsupportedFile = {
		fileId: string;
		fileName: string;
		reason:
			| 'unsupported_file_type'
			| 'image_conversion_required'
			| 'image_evidence_unavailable'
			| 'text_evidence_unavailable'
			| 'cad_evidence_unavailable'
			| 'eligibility_check_failed'
			| 'cad_read_failed';
		detail?: string;
	};

	type PresentedIssueGroup = {
		id: 'file_preparation' | 'wrong_file' | 'rate_review' | 'manual_review' | 'companion_context';
		title: string;
		items: AiIssue[];
	};

	type PresentedEvidenceGroup = {
		key: string;
		label: string;
		reference: AiEvidenceRef;
		summaries: string[];
	};

	let {
		progressValueLabel = null,
		progressDetail,
		errorMessage = null,
		runActive,
		isCancelling,
		status,
		issues,
		evidenceRefs,
		unsupportedFiles,
		openQuestionCount,
		unresolvedMappingCount,
		rateReviewCount = 0,
		pendingDraftTotal = null,
		appliedToEditor = false,
		canApplyPending = false,
		runId = null,
		feedbackSubmitted = false,
		submittedFeedbackText = null,
		localRuntimeReady,
		onEvidenceSelect,
		onSubmitFeedback
	}: {
		progressValueLabel?: string | null;
		progressDetail: AiRunProgressDetail;
		errorMessage?: string | null;
		runActive: boolean;
		isCancelling: boolean;
		status: string;
		issues: AiIssue[];
		evidenceRefs: AiEvidenceRef[];
		unsupportedFiles: UnsupportedFile[];
		openQuestionCount: number;
		unresolvedMappingCount: number;
		rateReviewCount?: number;
		pendingDraftTotal?: string | null;
		appliedToEditor?: boolean;
		canApplyPending?: boolean;
		runId?: string | null;
		feedbackSubmitted?: boolean;
		submittedFeedbackText?: string | null;
		localRuntimeReady: boolean;
		onEvidenceSelect: (ref: AiEvidenceRef) => void;
		onSubmitFeedback: (text: string) => Promise<void> | void;
	} = $props();

	let feedbackText = $state('');
	let feedbackDismissed = $state(false);
	let feedbackSaving = $state(false);
	let detailSectionsOpen = $state.raw<string[]>([]);
	let lastAutoOpenedAttentionKey = $state<string | null>(null);

	function classifyIssue(issue: AiIssue): PresentedIssueGroup['id'] {
		const code = issue.code.toLowerCase();
		const message = issue.message.toLowerCase();
		if (code === 'low_signal_file_skipped') {
			return 'companion_context';
		}
		if (
			code.includes('file_read') ||
			code.includes('unsupported_file') ||
			code.includes('image_evidence') ||
			code.includes('empty_text') ||
			message.includes('could not prepare') ||
			message.includes('did not contain readable text') ||
			message.includes('kept out of this local ai draft')
		) {
			return 'file_preparation';
		}
		if (
			message.includes('uploaded in error') ||
			message.includes('wrong file') ||
			message.includes('contradicts') ||
			message.includes('does not match')
		) {
			return 'wrong_file';
		}
		if (code === 'missing_component_rate' || message.includes('rate review')) {
			return 'rate_review';
		}
		return 'manual_review';
	}

	function issueGroupTitle(groupId: PresentedIssueGroup['id']): string {
		switch (groupId) {
			case 'file_preparation':
				return 'Files not used';
			case 'wrong_file':
				return 'Possible wrong file';
			case 'rate_review':
				return 'Rates need review';
			case 'manual_review':
				return 'Needs manual review';
			case 'companion_context':
				return 'Context skipped';
		}
	}

	function issuePrefix(issue: AiIssue): string {
		return issue.fileName ? `${issue.fileName}: ` : '';
	}

	function issueRenderKey(
		groupId: PresentedIssueGroup['id'],
		issue: AiIssue,
		issueIndex: number
	): string {
		return [
			groupId,
			issue.code,
			issue.fileId ?? '',
			issue.fileName ?? '',
			issue.message,
			issue.severity,
			issueIndex
		].join('|');
	}

	function buildIssueGroups(nextIssues: AiIssue[]): PresentedIssueGroup[] {
		const order: PresentedIssueGroup['id'][] = [
			'file_preparation',
			'wrong_file',
			'rate_review',
			'manual_review',
			'companion_context'
		];
		return order
			.map((groupId) => ({
				id: groupId,
				title: issueGroupTitle(groupId),
				items: nextIssues.filter((issue) => classifyIssue(issue) === groupId)
			}))
			.filter((group) => group.items.length > 0);
	}

	function buildEvidenceGroups(refs: AiEvidenceRef[]): PresentedEvidenceGroup[] {
		const groups: PresentedEvidenceGroup[] = [];
		for (const ref of refs) {
			const key = [ref.file_id ?? ref.file_name, ref.page_number ?? '', ref.view_label ?? ''].join(
				'|'
			);
			const label = [
				ref.file_name,
				ref.page_number ? `Page ${ref.page_number}` : null,
				ref.view_label ?? null
			]
				.filter(Boolean)
				.join(' · ');
			const existing = groups.find((group) => group.key === key);
			if (existing) {
				if (!existing.summaries.includes(ref.summary)) {
					existing.summaries = [...existing.summaries, ref.summary];
				}
				continue;
			}
			groups.push({
				key,
				label,
				reference: ref,
				summaries: ref.summary ? [ref.summary] : []
			});
		}
		return groups;
	}

	function formatPresentedIssueMessage(issue: AiIssue): string {
		return formatDisplayedAiIssueMessage(issue.message);
	}

	function summaryMetaLine(): string {
		const substantiveIssueCount = issues.filter(
			(issue) => classifyIssue(issue) !== 'companion_context'
		).length;
		const parts = [
			`${substantiveIssueCount} issue${substantiveIssueCount === 1 ? '' : 's'}`,
			`${openQuestionCount} review item${openQuestionCount === 1 ? '' : 's'}`,
			`${unresolvedMappingCount} unresolved mapping${unresolvedMappingCount === 1 ? '' : 's'}`,
			`${rateReviewCount} rate review${rateReviewCount === 1 ? '' : 's'}`
		];
		return parts.join(' · ');
	}

	function pendingDraftSummary(): string | null {
		if (!canApplyPending || !pendingDraftTotal) return null;
		return `Draft total: ${pendingDraftTotal}`;
	}

	function shouldShowFeedbackPrompt(): boolean {
		return Boolean(runId) && status === 'applied' && !runActive && !feedbackDismissed;
	}

	function shouldShowFeedbackSection(): boolean {
		return feedbackSubmitted || shouldShowFeedbackPrompt();
	}

	function attentionItemCount(): number {
		return substantiveIssueGroups.reduce((total, group) => total + group.items.length, 0);
	}

	function showProgress(): boolean {
		return status === 'queued' || runActive || isCancelling;
	}

	function shouldShowRunDetails(): boolean {
		return showProgress() || status === 'applied' || status === 'failed' || status === 'cancelled';
	}

	async function handleSubmitFeedback(): Promise<void> {
		const nextText = feedbackText.trim();
		if (!nextText) return;
		feedbackSaving = true;
		try {
			await onSubmitFeedback(nextText);
			feedbackText = '';
		} finally {
			feedbackSaving = false;
		}
	}

	const presentedIssueGroups = $derived(buildIssueGroups(issues));
	const presentedEvidenceGroups = $derived(buildEvidenceGroups(evidenceRefs));
	const substantiveIssueGroups = $derived(
		presentedIssueGroups.filter((group) => group.id !== 'companion_context')
	);
	const contextualIssueGroups = $derived(
		presentedIssueGroups.filter((group) => group.id === 'companion_context')
	);
	const feedbackResetKey = $derived(
		`${runId ?? ''}:${feedbackSubmitted ? '1' : '0'}:${submittedFeedbackText ?? ''}`
	);
	const feedbackSectionValue = 'feedback';
	const detailSectionValues = $derived.by(() => {
		const values: string[] = [];
		if (!shouldShowRunDetails()) return values;
		if (attentionItemCount() > 0 || unsupportedFiles.length > 0 || errorMessage)
			values.push('attention');
		if (presentedEvidenceGroups.length > 0) values.push('evidence');
		if (contextualIssueGroups.length > 0) values.push('context');
		if (shouldShowFeedbackSection()) values.push(feedbackSectionValue);
		return values;
	});

	$effect(() => {
		const nextValues = detailSectionValues;
		const filteredValues = detailSectionsOpen.filter((entry) => nextValues.includes(entry));
		const filteredChanged =
			filteredValues.length !== detailSectionsOpen.length ||
			filteredValues.some((entry, index) => detailSectionsOpen[index] !== entry);
		if (filteredChanged) {
			detailSectionsOpen = filteredValues;
			return;
		}
		const autoOpenAttentionKey = status === 'failed' ? `${runId ?? 'no-run'}:${status}` : null;
		if (
			detailSectionsOpen.length === 0 &&
			status === 'failed' &&
			nextValues.includes('attention') &&
			lastAutoOpenedAttentionKey !== autoOpenAttentionKey
		) {
			detailSectionsOpen = ['attention'];
			lastAutoOpenedAttentionKey = autoOpenAttentionKey;
		}
	});

	$effect(() => {
		if (!feedbackResetKey && feedbackResetKey !== '') return;
		feedbackText = '';
		feedbackDismissed = false;
	});
</script>

<div class="space-y-3">
	{#if !showProgress() && status !== 'applied' && status !== 'failed' && status !== 'cancelled'}
		<div class="ui-ai-empty-prompt">
			<div class="ui-ai-empty-arrow" aria-hidden="true"></div>
			<div class="space-y-1 text-center">
				<Text as="p" class="title-copy">Start draft</Text>
				<Meta>Use the button above to review the files and prepare a first takeoff.</Meta>
			</div>
		</div>
	{/if}

	{#if shouldShowRunDetails()}
		<div class="space-y-2">
			<EstimateAiProgressTerminal
				{status}
				{runActive}
				{isCancelling}
				{progressDetail}
				{progressValueLabel}
				{errorMessage}
				unsupportedFileCount={unsupportedFiles.length}
				issueCount={attentionItemCount()}
				{appliedToEditor}
				{canApplyPending}
				{localRuntimeReady}
			/>
		</div>
	{/if}

	{#if status === 'applied'}
		<Separator />
	{/if}

	{#if status === 'applied'}
		<div class="space-y-2 pt-1">
			<p class="title-copy">
				{#if appliedToEditor}
					Draft applied — review before saving.
				{:else}
					Draft ready — review before applying.
				{/if}
			</p>
			<div class="flex flex-wrap gap-1.5">
				<Badge variant="secondary">{summaryMetaLine()}</Badge>
				{#if pendingDraftSummary()}
					<Badge variant="secondary">{pendingDraftSummary()}</Badge>
				{/if}
			</div>
		</div>
	{/if}

	{#if detailSectionValues.length > 0}
		<Accordion.Root
			type="multiple"
			bind:value={detailSectionsOpen}
			class="ui-radius-md overflow-hidden border"
		>
			{#if shouldShowRunDetails() && (attentionItemCount() > 0 || unsupportedFiles.length > 0 || errorMessage)}
				<Accordion.Item value="attention">
					<Accordion.Header>
						<Accordion.Trigger>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Text as="span" class="shell-label-strong">Attention needed</Text>
								<Meta>
									{attentionItemCount() + unsupportedFiles.length + (errorMessage ? 1 : 0)} item{attentionItemCount() +
										unsupportedFiles.length +
										(errorMessage ? 1 : 0) ===
									1
										? ''
										: 's'}
								</Meta>
							</div>
							<ChevronDownIcon class="muted size-4 shrink-0" data-accordion-chevron />
						</Accordion.Trigger>
					</Accordion.Header>
					<Accordion.Content>
						<div class="space-y-3 px-4 py-3">
							{#if errorMessage}
								<div class="ui-radius-sm border bg-background px-3 py-2.5">
									<Meta>{errorMessage}</Meta>
								</div>
							{/if}
							{#if unsupportedFiles.length > 0}
								<div class="space-y-2">
									<Meta>Files not used</Meta>
									<div class="ui-radius-sm overflow-hidden border bg-background">
										{#each unsupportedFiles as file, fileIndex (file.fileId)}
											<div
												class={`flex items-start gap-2 px-3 py-2.5 ${fileIndex > 0 ? 'border-t' : ''}`}
											>
												<span class="ui-radius-pill status-dot-warning mt-1.5 size-1.5 shrink-0"
												></span>
												<div class="min-w-0 space-y-1">
													<Text>{file.fileName}</Text>
													{#if file.detail}
														<Meta>{file.detail}</Meta>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}
							{#each substantiveIssueGroups as group (group.id)}
								<div class="space-y-2">
									<Meta>{group.title}</Meta>
									<div class="ui-radius-sm overflow-hidden border bg-background">
										{#each group.items as issue, issueIndex (issueRenderKey(group.id, issue, issueIndex))}
											<div
												class={`flex items-start gap-2 px-3 py-2.5 ${issueIndex > 0 ? 'border-t' : ''}`}
											>
												<span class="ui-radius-pill status-dot-warning mt-1.5 size-1.5 shrink-0"
												></span>
												<Meta>
													{issuePrefix(issue)}{formatPresentedIssueMessage(issue)}
												</Meta>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</Accordion.Content>
				</Accordion.Item>
			{/if}

			{#if presentedEvidenceGroups.length > 0}
				<Accordion.Item value="evidence">
					<Accordion.Header>
						<Accordion.Trigger>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Text as="span" class="shell-label-strong">Evidence used</Text>
								<Meta
									>{presentedEvidenceGroups.length} file{presentedEvidenceGroups.length === 1
										? ''
										: 's'}</Meta
								>
							</div>
							<ChevronDownIcon class="muted size-4 shrink-0" data-accordion-chevron />
						</Accordion.Trigger>
					</Accordion.Header>
					<Accordion.Content>
						<div class="space-y-2 px-4 py-3">
							{#each presentedEvidenceGroups as group (group.key)}
								<button class="ui-picker-option" onclick={() => onEvidenceSelect(group.reference)}>
									<Text>{group.label}</Text>
									{#if group.summaries.length > 0}
										<Meta class="pt-1">{group.summaries[0]}</Meta>
									{/if}
								</button>
							{/each}
						</div>
					</Accordion.Content>
				</Accordion.Item>
			{/if}

			{#if contextualIssueGroups.length > 0}
				<Accordion.Item value="context">
					<Accordion.Header>
						<Accordion.Trigger>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Text as="span" class="shell-label-strong">Context skipped</Text>
								<Meta>
									{contextualIssueGroups.reduce((total, group) => total + group.items.length, 0)} item{contextualIssueGroups.reduce(
										(total, group) => total + group.items.length,
										0
									) === 1
										? ''
										: 's'}
								</Meta>
							</div>
							<ChevronDownIcon class="muted size-4 shrink-0" data-accordion-chevron />
						</Accordion.Trigger>
					</Accordion.Header>
					<Accordion.Content>
						<div class="space-y-3 px-4 py-3">
							<Meta>
								These files were skipped because they looked more like project context than direct
								estimating evidence.
							</Meta>
							<div class="ui-radius-sm overflow-hidden border bg-background">
								{#each contextualIssueGroups as group (group.id)}
									{#each group.items as issue, issueIndex (issueRenderKey(group.id, issue, issueIndex))}
										<div
											class={`flex items-start gap-2 px-3 py-2.5 ${issueIndex > 0 ? 'border-t' : ''}`}
										>
											<span class="ui-radius-pill status-dot-warning mt-1.5 size-1.5 shrink-0"
											></span>
											<Meta>{issuePrefix(issue)}{formatPresentedIssueMessage(issue)}</Meta>
										</div>
									{/each}
								{/each}
							</div>
						</div>
					</Accordion.Content>
				</Accordion.Item>
			{/if}

			{#if shouldShowFeedbackSection()}
				<Accordion.Item value={feedbackSectionValue}>
					<Accordion.Header>
						<Accordion.Trigger>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<Text as="span" class="shell-label-strong">Guide future drafts</Text>
								<FormHelpTooltip
									content="Optional note saved locally for this workspace. Use it for estimating preferences you want future drafts to follow."
								/>
							</div>
							<ChevronDownIcon class="muted size-4 shrink-0" data-accordion-chevron />
						</Accordion.Trigger>
					</Accordion.Header>
					<Accordion.Content>
						<div class="space-y-3 px-4 py-3">
							{#if feedbackSubmitted && submittedFeedbackText}
								<Textarea
									readonly
									value={submittedFeedbackText}
									rows={3}
									class="min-h-20 resize-none"
								/>
							{:else}
								<Textarea
									bind:value={feedbackText}
									maxlength={400}
									rows={3}
									class="field-copy max-h-48 min-h-24 resize-y"
									placeholder="Example: Keep canopy fabrication bundled as one material package, and flag rush work as a review note."
								/>
								<div class="flex items-center justify-end gap-3">
									{#if feedbackText.trim().length > 400}
										<Meta>{feedbackText.trim().length} / 400</Meta>
									{/if}
									<div class="flex items-center gap-2">
										<Button
											type="button"
											size="sm"
											variant="ghost"
											class="px-2.5"
											onclick={() => (feedbackDismissed = true)}
										>
											Skip
										</Button>
										<Button
											type="button"
											size="sm"
											disabled={feedbackSaving || feedbackText.trim().length === 0}
											onclick={() => void handleSubmitFeedback()}
										>
											{feedbackSaving ? 'Saving...' : 'Save feedback'}
										</Button>
									</div>
								</div>
							{/if}
						</div>
					</Accordion.Content>
				</Accordion.Item>
			{/if}
		</Accordion.Root>
	{/if}
</div>
