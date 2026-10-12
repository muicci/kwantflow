<script lang="ts">
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { stat } from '@tauri-apps/plugin-fs';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		FieldError,
		FieldLabelRow,
		FieldShell,
		Meta,
		Text
	} from '$lib/components/primitives/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { getFileSupportProfile } from '$lib/constants/index.js';
	import { aiState } from '$lib/state/ai.svelte.js';
	import { errorState } from '$lib/state/errors.svelte.js';
	import {
		WORKSPACE_AI_FEEDBACK_MAX_CHARS,
		getWorkspaceAiKnowledgeUploadExtensions,
		getWorkspaceAiKnowledgeUploadSummary,
		isWorkspaceAiKnowledgeFileAllowed,
		WORKSPACE_AI_KNOWLEDGE_MAX_FILES,
		WORKSPACE_AI_PLAYBOOK_MAX_CHARS
	} from '$lib/services/ai-workspace-knowledge.js';
	import { isTauri } from '$lib/utils/env.js';

	type SkippedKnowledgePathReason =
		'directory' | 'limit' | 'missing_extension' | 'unsupported_extension';

	type SkippedKnowledgePath = {
		name: string;
		reason: SkippedKnowledgePathReason;
	};

	type KnowledgePanelState = {
		hasUnsavedChanges: boolean;
		canSave: boolean;
		isSaving: boolean;
	};

	let {
		onStateChange = () => {}
	}: {
		onStateChange?: (state: KnowledgePanelState) => void;
	} = $props();

	let stagedPlaybookText = $state(aiState.workspaceAiPlaybookText);
	let savingPlaybook = $state(false);
	let uploadingKnowledgeFiles = $state(false);
	let removingKnowledgeFileId = $state<string | null>(null);
	let removingFeedbackId = $state<string | null>(null);
	let isDraggingOver = $state(false);
	let knowledgeFilesOpen = $state(false);
	let expandedFeedbackIds = $state<string[]>([]);
	let visibleFeedbackLimit = $state(5);

	const knowledgeFiles = $derived(aiState.workspaceAiKnowledgeFiles);
	const feedbackEntries = $derived(aiState.workspaceAiFeedbackEntries);
	const visibleFeedbackEntries = $derived(feedbackEntries.slice(0, visibleFeedbackLimit));
	const hasMoreFeedbackEntries = $derived(feedbackEntries.length > visibleFeedbackLimit);
	const playbookCharacterCount = $derived(stagedPlaybookText.trim().length);
	const hasPlaybookChanges = $derived(
		stagedPlaybookText.trim() !== aiState.workspaceAiPlaybookText.trim()
	);
	const canSavePlaybook = $derived(
		hasPlaybookChanges &&
			!savingPlaybook &&
			playbookCharacterCount <= WORKSPACE_AI_PLAYBOOK_MAX_CHARS
	);
	const availableSlots = $derived(
		Math.max(0, WORKSPACE_AI_KNOWLEDGE_MAX_FILES - knowledgeFiles.length)
	);
	const uploadSummary = $derived(getWorkspaceAiKnowledgeUploadSummary());
	const uploadExtensions = $derived(getWorkspaceAiKnowledgeUploadExtensions());
	const playbookErrors = $derived.by(() =>
		playbookCharacterCount > WORKSPACE_AI_PLAYBOOK_MAX_CHARS
			? [`Workspace playbook must stay within ${WORKSPACE_AI_PLAYBOOK_MAX_CHARS} characters.`]
			: null
	);

	function fileNameFromPath(path: string): string {
		return path.split(/[/\\]/).pop() || path;
	}

	function describeSkippedPath(entry: SkippedKnowledgePath): string {
		if (entry.reason === 'directory') return `${entry.name} (folder)`;
		if (entry.reason === 'missing_extension') return `${entry.name} (no supported extension)`;
		if (entry.reason === 'limit') return `${entry.name} (limit reached)`;
		return `${entry.name} (unsupported type)`;
	}

	function formatByteSize(value: number): string {
		if (!Number.isFinite(value) || value <= 0) return '0 KB';
		if (value < 1024 * 1024) {
			return `${Math.max(1, Math.round(value / 1024))} KB`;
		}
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatFeedbackTimestamp(value: string): string {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;

		return new Intl.DateTimeFormat(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(parsed);
	}

	function isFeedbackExpanded(feedbackId: string): boolean {
		return expandedFeedbackIds.includes(feedbackId);
	}

	function toggleFeedbackExpanded(feedbackId: string): void {
		expandedFeedbackIds = isFeedbackExpanded(feedbackId)
			? expandedFeedbackIds.filter((id) => id !== feedbackId)
			: [...expandedFeedbackIds, feedbackId];
	}

	function feedbackNeedsExpansion(value: string): boolean {
		const trimmed = value.trim();
		if (trimmed.length > 180) return true;
		return trimmed.split(/\r?\n/).length > 2;
	}

	function notifySkippedFiles(skippedPaths: SkippedKnowledgePath[]): void {
		if (skippedPaths.length === 0) return;
		const visibleEntries = skippedPaths.slice(0, 4).map(describeSkippedPath);
		const remainingCount = skippedPaths.length - visibleEntries.length;
		const summary =
			remainingCount > 0
				? `${visibleEntries.join(', ')} +${remainingCount} more`
				: visibleEntries.join(', ');
		toast.error(`Some knowledge files were skipped: ${summary}`);
	}

	async function classifyKnowledgePath(
		path: string
	): Promise<
		{ type: 'accepted'; path: string } | { type: 'skipped'; entry: SkippedKnowledgePath }
	> {
		try {
			const info = await stat(path);
			if (info.isDirectory) {
				return {
					type: 'skipped',
					entry: {
						name: fileNameFromPath(path),
						reason: 'directory'
					}
				};
			}
		} catch {
			// Fall back to extension-based checks.
		}

		const profile = getFileSupportProfile(path);
		if (!profile.id) {
			return {
				type: 'skipped',
				entry: {
					name: fileNameFromPath(path),
					reason: 'missing_extension'
				}
			};
		}

		if (!isWorkspaceAiKnowledgeFileAllowed(path)) {
			return {
				type: 'skipped',
				entry: {
					name: fileNameFromPath(path),
					reason: 'unsupported_extension'
				}
			};
		}

		return { type: 'accepted', path };
	}

	async function partitionKnowledgePaths(
		paths: string[]
	): Promise<{ acceptedPaths: string[]; skippedPaths: SkippedKnowledgePath[] }> {
		const results = await Promise.all(paths.map((path) => classifyKnowledgePath(path)));
		const acceptedPaths = results
			.filter((result): result is { type: 'accepted'; path: string } => result.type === 'accepted')
			.map((result) => result.path);
		const skippedPaths = results
			.filter(
				(result): result is { type: 'skipped'; entry: SkippedKnowledgePath } =>
					result.type === 'skipped'
			)
			.map((result) => result.entry);

		if (acceptedPaths.length <= availableSlots) {
			return { acceptedPaths, skippedPaths };
		}

		const allowedPaths = acceptedPaths.slice(0, availableSlots);
		const overflow = acceptedPaths.slice(availableSlots).map((path) => ({
			name: fileNameFromPath(path),
			reason: 'limit' as const
		}));
		return {
			acceptedPaths: allowedPaths,
			skippedPaths: [...skippedPaths, ...overflow]
		};
	}

	async function addKnowledgeFilesFromPaths(paths: string[]): Promise<void> {
		if (availableSlots <= 0) {
			toast.error(`You can keep up to ${WORKSPACE_AI_KNOWLEDGE_MAX_FILES} knowledge files.`);
			return;
		}

		const { acceptedPaths, skippedPaths } = await partitionKnowledgePaths(paths);
		notifySkippedFiles(skippedPaths);
		if (acceptedPaths.length === 0) return;

		try {
			await aiState.addWorkspaceKnowledgeFiles(acceptedPaths);
		} catch (error) {
			await errorState.catchError(error, 'Add AI knowledge files');
		}
	}

	async function handleBrowseKnowledgeFiles(): Promise<void> {
		if (!isTauri()) return;
		uploadingKnowledgeFiles = true;
		try {
			const selected = await openDialog({
				multiple: true,
				filters: [
					{
						name: 'Knowledge files',
						extensions: [...uploadExtensions]
					}
				]
			});
			const paths = Array.isArray(selected)
				? selected
				: typeof selected === 'string'
					? [selected]
					: [];
			if (paths.length === 0) return;
			await addKnowledgeFilesFromPaths(paths);
		} finally {
			uploadingKnowledgeFiles = false;
		}
	}

	async function handleSavePlaybook(): Promise<void> {
		if (playbookCharacterCount > WORKSPACE_AI_PLAYBOOK_MAX_CHARS) {
			toast.error(
				`Workspace playbook must stay within ${WORKSPACE_AI_PLAYBOOK_MAX_CHARS} characters.`
			);
			return;
		}
		savingPlaybook = true;
		try {
			await aiState.saveWorkspacePlaybook(stagedPlaybookText);
		} catch (error) {
			await errorState.catchError(error, 'Save workspace playbook');
		} finally {
			savingPlaybook = false;
		}
	}

	export async function savePlaybook(): Promise<void> {
		await handleSavePlaybook();
	}

	async function handleRemoveKnowledgeFile(fileId: string): Promise<void> {
		removingKnowledgeFileId = fileId;
		try {
			await aiState.removeWorkspaceKnowledgeFile(fileId);
		} catch (error) {
			await errorState.catchError(error, 'Remove AI knowledge file');
		} finally {
			removingKnowledgeFileId = null;
		}
	}

	async function handleRemoveFeedback(feedbackId: string): Promise<void> {
		removingFeedbackId = feedbackId;
		try {
			await aiState.removeWorkspaceFeedbackEntry(feedbackId);
		} catch (error) {
			await errorState.catchError(error, 'Remove AI feedback');
		} finally {
			removingFeedbackId = null;
		}
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	function handleDragLeave(event: DragEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	onMount(() => {
		if (!isTauri()) return;
		const webview = getCurrentWebviewWindow();
		const unlisten = webview.onDragDropEvent(async (event) => {
			if (event.payload.type === 'over') {
				isDraggingOver = true;
				return;
			}
			if (event.payload.type === 'leave') {
				isDraggingOver = false;
				return;
			}
			if (event.payload.type !== 'drop') return;
			isDraggingOver = false;
			uploadingKnowledgeFiles = true;
			try {
				await addKnowledgeFilesFromPaths(event.payload.paths);
			} finally {
				uploadingKnowledgeFiles = false;
			}
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	});

	$effect(() => {
		onStateChange({
			hasUnsavedChanges: hasPlaybookChanges,
			canSave: canSavePlaybook,
			isSaving: savingPlaybook
		});
	});
</script>

<div class="flex flex-col gap-5">
	<div class="grid gap-3">
		<FieldShell invalidTone={playbookErrors ? 'destructive' : undefined}>
			<FieldLabelRow
				for="workspace-ai-playbook"
				tooltip="Short workspace-wide estimating guidance for AI. Use it for pricing habits, labour assumptions, exclusions, markup notes, and customer-specific rules that are not already in your structured records."
			>
				Workspace Playbook
				{#snippet aside()}
					<Meta
						class={playbookCharacterCount > WORKSPACE_AI_PLAYBOOK_MAX_CHARS
							? 'status-text-destructive'
							: undefined}
					>
						{playbookCharacterCount} / {WORKSPACE_AI_PLAYBOOK_MAX_CHARS}
					</Meta>
				{/snippet}
			</FieldLabelRow>
			<Textarea
				id="workspace-ai-playbook"
				size="sm"
				bind:value={stagedPlaybookText}
				maxlength={WORKSPACE_AI_PLAYBOOK_MAX_CHARS}
				rows={7}
				class="max-h-96 min-h-36 resize-y"
				placeholder="Keep this concise: pricing rules, labour assumptions, exclusions, surcharge logic, and customer-specific estimating instructions."
			/>
			<FieldError errors={playbookErrors} />
		</FieldShell>
	</div>

	<div class="space-y-3">
		<button
			type="button"
			class="ui-file-row w-full justify-between text-left"
			onclick={() => {
				knowledgeFilesOpen = !knowledgeFilesOpen;
			}}
		>
			<FieldLabelRow
				tooltip="Attach up to five workspace-specific PDFs, DOCX, XLSX, or text files. Kwantflow extracts their text locally, keeps each file under 10 MB, and folds the result into one bounded workspace skill for future drafts."
				class="w-full"
			>
				Knowledge Files
				{#snippet aside()}
					<div class="flex items-center gap-2">
						<Meta>{knowledgeFiles.length} / {WORKSPACE_AI_KNOWLEDGE_MAX_FILES}</Meta>
						{#if knowledgeFilesOpen}
							<ChevronDownIcon class="muted size-4" />
						{:else}
							<ChevronRightIcon class="muted size-4" />
						{/if}
					</div>
				{/snippet}
			</FieldLabelRow>
		</button>

		{#if knowledgeFilesOpen}
			<div class="space-y-3">
				<button
					type="button"
					disabled={uploadingKnowledgeFiles || availableSlots <= 0}
					class={`ui-upload-dropzone text-center disabled:cursor-not-allowed disabled:opacity-60 ${
						isDraggingOver ? 'ui-upload-dropzone-active' : ''
					}`}
					onclick={() => void handleBrowseKnowledgeFiles()}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
				>
					<UploadIcon class="muted size-8" />
					<div class="flex max-w-3xl flex-col items-center gap-2 text-center">
						<Text as="span">
							{#if availableSlots <= 0}
								Knowledge file limit reached
							{:else if isDraggingOver}
								Drop files now
							{:else}
								Drop knowledge files here or click to browse
							{/if}
						</Text>
						<Meta>{uploadSummary}</Meta>
					</div>
				</button>

				{#if knowledgeFiles.length > 0}
					<div class="grid gap-1.5">
						{#each knowledgeFiles as file (file.id)}
							<div class="ui-file-row group">
								<div class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
									<HardDriveIcon class="size-3.5 shrink-0" />
									<div title={file.originalName} class="min-w-0 flex-1">
										<Text as="span" class="shell-label min-w-0 truncate">
											{file.originalName}
										</Text>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<Meta as="span" class="hidden opacity-60 sm:inline">
										{formatByteSize(file.byteSize)}
									</Meta>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										class="shrink-0 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
										disabled={removingKnowledgeFileId === file.id}
										onclick={() => void handleRemoveKnowledgeFile(file.id)}
									>
										<span class="sr-only">Remove {file.originalName}</span>
										<XIcon class="size-3.5" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="space-y-3">
		<div class="flex items-center justify-between gap-3">
			<FieldLabelRow
				tooltip={`Saved local notes from AI draft reviews. Each note stays under ${WORKSPACE_AI_FEEDBACK_MAX_CHARS} characters. Use them to guide future drafts and remove notes that no longer match how you estimate.`}
			>
				AI feedback history
			</FieldLabelRow>
		</div>

		{#if feedbackEntries.length === 0}
			<Meta>
				No feedback saved yet. After an AI draft, add a short note about what to repeat or avoid
				next time.
			</Meta>
		{:else}
			<div class="space-y-2">
				{#each visibleFeedbackEntries as entry (entry.id)}
					<div class="ui-file-row group items-start">
						<div class="min-w-0 flex-1 space-y-2">
							<Text
								class={`break-words whitespace-pre-wrap ${
									isFeedbackExpanded(entry.id) ? '' : 'line-clamp-2'
								}`}
							>
								{entry.feedbackText}
							</Text>
							<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<Meta class="opacity-60">
									{formatFeedbackTimestamp(entry.created_at)}
								</Meta>
								{#if feedbackNeedsExpansion(entry.feedbackText)}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										class="px-0"
										onclick={() => toggleFeedbackExpanded(entry.id)}
									>
										{isFeedbackExpanded(entry.id) ? 'Show less' : 'Read more'}
									</Button>
								{/if}
							</div>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							class="shrink-0 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
							disabled={removingFeedbackId === entry.id}
							onclick={() => void handleRemoveFeedback(entry.id)}
						>
							<span class="sr-only">Remove feedback</span>
							<Trash2Icon class="size-3.5" />
						</Button>
					</div>
				{/each}
				{#if hasMoreFeedbackEntries}
					<div class="flex justify-center pt-1">
						<Button
							variant="secondary"
							size="sm"
							onclick={() => {
								visibleFeedbackLimit += 5;
							}}
						>
							Load more feedback
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
