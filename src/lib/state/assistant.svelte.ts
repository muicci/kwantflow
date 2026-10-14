import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { toast } from 'svelte-sonner';
import { workspaceState } from '$lib/state/workspace.svelte.js';
import {
	FILE_EXTENSIONS,
	getEstimateAiPreparedArtifactKind,
	inferGeneralFileMimeType
} from '$lib/constants/file-support.js';
import { getAppLocalFileUrl } from '$lib/services/assets.js';
import { buildAssistantImageAttachment } from '$lib/services/ai-file-evidence.js';
import { allowExternalFileRead } from '$lib/services/external-file-access.js';
import { createLogger } from '$lib/services/logger.js';
import { localAssistantService } from '$lib/services/local-assistant.js';
import { aiState } from '$lib/state/ai.svelte.js';
import type { LocalAssistantViewportContext } from '$lib/services/local-assistant-viewport-context.js';
import { storeService } from '$lib/services/store.js';
import { dbService } from '$lib/services/db.js';
import { errorState } from '$lib/state/errors.svelte.js';
import { contactsState } from '$lib/state/contacts.svelte.js';
import { materialsState } from '$lib/state/materials.svelte.js';
import { labourRatesState } from '$lib/state/labour-rates.svelte.js';
import { equipmentRatesState } from '$lib/state/equipment-rates.svelte.js';
import { subcontractRatesState } from '$lib/state/subcontract-rates.svelte.js';
import { projectsState } from '$lib/state/projects.svelte.js';
import type {
	AiWorkspaceKnowledgeContext,
	LocalAssistantEstimateContext,
	LocalAssistantImageAttachment,
	LocalAssistantMessage,
	LocalAssistantProposalSet,
	LocalAssistantSourceRecordProposal,
	LocalAssistantToolExecution,
	WorkspaceProfile
} from '$lib/types/index.js';

const log = createLogger('assistantState');
const SUPPORTED_ASSISTANT_IMAGE_EXTENSIONS = [...FILE_EXTENSIONS.image];
const MAX_ATTACHMENTS = 3;
const SCREEN_VISIBLE_RECORD_LIMIT = 5;

function inferImageMimeType(path: string): string {
	return inferGeneralFileMimeType(path) ?? 'image/png';
}

function hasSupportedImageExtension(path: string): boolean {
	return getEstimateAiPreparedArtifactKind(path, inferImageMimeType(path)) === 'image';
}

function createId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

function enrichViewportContextWithEstimate(
	context: LocalAssistantViewportContext | null,
	estimateContext: LocalAssistantEstimateContext | null
): LocalAssistantViewportContext | null {
	if (!context || !estimateContext) return context;
	const takeoffItems = Array.isArray(estimateContext.takeoffItems)
		? estimateContext.takeoffItems.slice(0, SCREEN_VISIBLE_RECORD_LIMIT)
		: [];
	return {
		...context,
		screen: {
			...context.screen,
			visibleRecords:
				context.screen?.visibleRecords ??
				takeoffItems.map((item, index) => {
					const record = item as unknown as Record<string, unknown>;
					return {
						id: typeof record.id === 'string' ? record.id : null,
						label:
							typeof record.label === 'string'
								? record.label
								: typeof record.name === 'string'
									? record.name
									: `Takeoff item ${index + 1}`,
						summary:
							typeof record.description === 'string'
								? record.description
								: typeof record.scope === 'string'
									? record.scope
									: null
					};
				}),
			draftSummary:
				context.screen?.draftSummary ??
				[
					estimateContext.scopeSummary,
					`${estimateContext.takeoffItemCount} takeoff item${estimateContext.takeoffItemCount === 1 ? '' : 's'}`,
					typeof estimateContext.totalCost === 'number'
						? `total cost ${estimateContext.totalCost}`
						: null
				]
					.filter(Boolean)
					.join('; ')
		}
	};
}

class AssistantState {
	private hydrationPromise: Promise<void> | null = null;

	isAssistantEnabled = $state(true);
	isSidebarOpen = $state(false);
	get isRunning(): boolean {
		return aiState.isAssistantRunning;
	}
	set isRunning(value: boolean) {
		aiState.isAssistantRunning = value;
	}
	get pendingProposalSet(): LocalAssistantProposalSet | null {
		for (const message of this.messages) {
			if (message.proposalSet && message.proposalSet.status === 'pending') {
				return message.proposalSet;
			}
		}
		return null;
	}
	isProposalDialogOpen = $state(false);
	lastError: string | null = $state(null);
	draftPrompt = $state('');
	messages: LocalAssistantMessage[] = $state.raw([]);
	pendingAttachments: LocalAssistantImageAttachment[] = $state([]);
	promptQueue: Array<{
		id: string;
		prompt: string;
		attachments: LocalAssistantImageAttachment[];
		pathname: string;
		projectId: string | null;
		assetId: string | null;
		workspaceProfile: WorkspaceProfile | null;
		knowledgeContext: AiWorkspaceKnowledgeContext | null;
	}> = $state([]);
	currentEstimateContext: LocalAssistantEstimateContext | null = $state(null);
	currentViewportContext: LocalAssistantViewportContext | null = $state(null);
	activeCadMetadata: import('$lib/services/cad-loader.js').CadMetadata | null = $state(null);
	isPageContextAttached = $state(false);

	async hydrate(): Promise<void> {
		if (this.hydrationPromise) {
			await this.hydrationPromise;
			return;
		}

		this.hydrationPromise = (async () => {
			this.isAssistantEnabled = await storeService.getAssistantEnabled();
		})();

		try {
			await this.hydrationPromise;
		} finally {
			this.hydrationPromise = null;
		}
	}
	async setAssistantEnabled(enabled: boolean): Promise<void> {
		await storeService.setAssistantEnabled(enabled);
		this.isAssistantEnabled = enabled;
		toast.success(
			enabled ? 'Ask Kwantflow added to toolbar' : 'Ask Kwantflow removed from toolbar'
		);
	}

	openSidebar(): void {
		if (this.messages.length === 0) {
			this.seedWelcomeMessage();
		}
		this.isSidebarOpen = true;
	}

	closeSidebar(): void {
		this.isSidebarOpen = false;
	}

	toggleSidebar(): void {
		if (!this.isSidebarOpen && this.messages.length === 0) {
			this.seedWelcomeMessage();
		}
		this.isSidebarOpen = !this.isSidebarOpen;
	}

	async addImageAttachment(): Promise<void> {
		const selection = await openDialog({
			multiple: false,
			filters: [
				{
					name: 'Image',
					extensions: SUPPORTED_ASSISTANT_IMAGE_EXTENSIONS
				}
			]
		});

		if (!selection || Array.isArray(selection)) return;

		await this.addImageAttachmentsFromPaths([selection]);
	}

	async addImageAttachmentsFromPaths(paths: string[]): Promise<void> {
		if (paths.length === 0) return;

		let availableSlots = MAX_ATTACHMENTS - this.pendingAttachments.length;
		if (availableSlots <= 0) {
			toast.error('You can attach up to 3 images');
			return;
		}

		for (const path of paths) {
			if (availableSlots <= 0) {
				toast.error('You can attach up to 3 images');
				break;
			}

			if (!hasSupportedImageExtension(path)) {
				toast.error('Only image files can be attached here');
				log.warn('Rejected assistant attachment with unsupported extension', { path });
				continue;
			}

			if (
				this.pendingAttachments.some((attachment) => attachment.name === path.split(/[/\\]/).pop())
			) {
				log.info('Skipped duplicate assistant attachment', { path });
				continue;
			}

			try {
				const readablePath = await allowExternalFileRead(path);
				const bytes = await readFile(readablePath);
				const previewUrl = await getAppLocalFileUrl(readablePath);
				const normalizedAttachment = await buildAssistantImageAttachment({
					bytes,
					mimeType: inferImageMimeType(path),
					fileName: path.split(/[/\\]/).pop() ?? 'image'
				});

				this.pendingAttachments = [
					...this.pendingAttachments,
					{
						id: createId('assistant-attachment'),
						name: path.split(/[/\\]/).pop() ?? 'image',
						mimeType: normalizedAttachment.mimeType,
						base64Data: normalizedAttachment.inlineData,
						previewUrl,
						sizeBytes: bytes.byteLength
					}
				];
				availableSlots -= 1;
				log.info('Added assistant image attachment', { path });
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : String(e);
				log.error('Failed to add assistant image attachment', { path, error: errMsg });
				toast.error(
					errMsg.includes('2KB')
						? 'Image must exceed 2KB to prevent preprocessor crashes.'
						: 'Failed to process image attachment.'
				);
			}
		}
	}

	private seedWelcomeMessage(): void {
		this.messages = [];
	}

	removePendingAttachment(attachmentId: string): void {
		const attachment = this.pendingAttachments.find((entry) => entry.id === attachmentId);
		if (attachment) {
			URL.revokeObjectURL(attachment.previewUrl);
		}
		this.pendingAttachments = this.pendingAttachments.filter((entry) => entry.id !== attachmentId);
	}

	private revokeAttachmentUrls(attachments: LocalAssistantImageAttachment[]): void {
		for (const attachment of attachments) {
			if (attachment.previewUrl && attachment.previewUrl.startsWith('blob:')) {
				URL.revokeObjectURL(attachment.previewUrl);
			}
		}
	}

	private clearSessionState(): void {
		localAssistantService.activeStreamAbort?.();
		localAssistantService.activeStreamAbort = null;
		this.isRunning = false;
		for (const message of this.messages) {
			this.revokeAttachmentUrls(message.attachments);
		}
		this.revokeAttachmentUrls(this.pendingAttachments);
		for (const item of this.promptQueue) {
			this.revokeAttachmentUrls(item.attachments);
		}
		this.messages = [];
		this.pendingAttachments = [];
		this.promptQueue = [];
		this.draftPrompt = '';
		this.lastError = null;
	}

	async clearSession(): Promise<void> {
		this.isRunning = true;
		try {
			await localAssistantService.resetConversation();
		} finally {
			this.clearSessionState();
		}
	}

	async resetForWorkspaceChange(): Promise<void> {
		await localAssistantService.resetConversation();
		this.clearSessionState();
	}

	setCurrentEstimateContext(context: LocalAssistantEstimateContext | null): void {
		this.currentEstimateContext = context;
	}

	clearCurrentEstimateContext(assetId?: string | null): void {
		if (!this.currentEstimateContext) return;
		if (assetId && this.currentEstimateContext.assetId !== assetId) return;
		this.currentEstimateContext = null;
	}

	setCurrentViewportContext(context: LocalAssistantViewportContext): void {
		this.currentViewportContext = context;
	}

	detachCurrentPageContext(): void {
		this.isPageContextAttached = false;
	}

	reattachCurrentPageContext(): void {
		if (!this.currentViewportContext) return;
		this.isPageContextAttached = true;
	}

	/** Abort the active streaming completion and clean up listeners. */
	stopActiveStream(): void {
		localAssistantService.activeStreamAbort?.();
		localAssistantService.activeStreamAbort = null;
		this.isRunning = false;
	}

	private updateProposalSetStatus(
		proposalSetId: string,
		status: LocalAssistantProposalSet['status']
	): void {
		this.messages = this.messages.map((message) => ({
			...message,
			proposalSet:
				message.proposalSet?.id === proposalSetId
					? { ...message.proposalSet, status }
					: message.proposalSet
		}));
	}

	private findProposalSet(proposalSetId: string): LocalAssistantProposalSet | null {
		for (const message of this.messages) {
			if (message.proposalSet?.id === proposalSetId) return message.proposalSet;
		}
		return null;
	}

	private async refreshAfterProposal(
		scope: LocalAssistantSourceRecordProposal['scope']
	): Promise<void> {
		switch (scope) {
			case 'contacts':
				await contactsState.refresh();
				break;
			case 'materials':
				await materialsState.refresh();
				break;
			case 'labour_rates':
				await labourRatesState.refresh();
				break;
			case 'equipment_rates':
				await equipmentRatesState.refresh();
				break;
			case 'subcontract_rates':
				await subcontractRatesState.refresh();
				break;
			case 'assets':
			case 'quote_options':
			case 'wbs_nodes':
				await projectsState.refresh();
				break;
		}
	}

	private proposalFieldValue(value: unknown): string {
		if (value === undefined || value === null) return '';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	private async verifyApprovedProposalSet(proposalSet: LocalAssistantProposalSet): Promise<void> {
		for (const proposal of proposalSet.items) {
			const recordId = proposal.recordId ?? proposal.id;
			const record = await dbService.getWorkspaceRecord({
				scope: proposal.scope,
				recordId,
				workspaceId: workspaceState.id
			});
			if (!record) {
				throw new Error('Proposal approval could not be verified because a record was not found.');
			}
			for (const [field, expected] of Object.entries(proposal.fields)) {
				if (expected === undefined) continue;
				const actual = record.fields[field];
				if (this.proposalFieldValue(actual) !== this.proposalFieldValue(expected)) {
					throw new Error(`Proposal approval verification failed for ${field}.`);
				}
			}
		}
	}

	async approveProposalSet(proposalSetId: string): Promise<void> {
		const proposalSet = this.findProposalSet(proposalSetId);
		if (!proposalSet || proposalSet.status !== 'pending') return;
		this.updateProposalSetStatus(proposalSetId, 'approved');
		try {
			const result = await dbService.executeApprovedRecordProposalSet({
				proposalSetId: proposalSet.id,
				turnId: proposalSet.turnId,
				items: proposalSet.items.map((proposal) => ({
					proposalId: proposal.id,
					scope: proposal.scope,
					action: proposal.action,
					recordId: proposal.recordId,
					fields: proposal.fields
				}))
			});
			if (result.status !== 'succeeded') {
				throw new Error(result.errors.join('; ') || 'Proposal-set approval failed');
			}
			await this.verifyApprovedProposalSet(proposalSet);
			this.updateProposalSetStatus(proposalSetId, 'executed');
			this.isProposalDialogOpen = false;
			for (const scope of new Set(proposalSet.items.map((proposal) => proposal.scope))) {
				await this.refreshAfterProposal(scope);
			}
			toast.success('Assistant proposal set approved');
		} catch (error) {
			this.updateProposalSetStatus(proposalSetId, 'failed');
			await errorState.catchError(error, 'Approve assistant proposal set');
		}
	}

	discardProposalSet(proposalSetId: string): void {
		const proposalSet = this.findProposalSet(proposalSetId);
		if (!proposalSet || proposalSet.status !== 'pending') return;
		this.updateProposalSetStatus(proposalSetId, 'discarded');
		this.isProposalDialogOpen = false;
		toast.success('Assistant proposal set discarded');
	}

	async approveProposalItem(proposalSetId: string, itemId: string): Promise<void> {
		const proposalSet = this.findProposalSet(proposalSetId);
		if (!proposalSet || proposalSet.status !== 'pending') return;

		const item = proposalSet.items.find((i) => i.id === itemId);
		if (!item) return;

		try {
			const result = await dbService.executeApprovedRecordProposalSet({
				proposalSetId: proposalSet.id,
				turnId: proposalSet.turnId,
				items: [
					{
						proposalId: item.id,
						scope: item.scope,
						action: item.action,
						recordId: item.recordId,
						fields: item.fields
					}
				]
			});
			if (result.status !== 'succeeded') {
				throw new Error(result.errors.join('; ') || 'Proposal item approval failed');
			}

			// Verify the approved item
			await this.verifyApprovedProposalSet({
				...proposalSet,
				items: [item]
			});

			// Reactively update the items list in the message store
			this.messages = this.messages.map((message) => {
				if (message.proposalSet?.id === proposalSetId) {
					const nextItems = message.proposalSet.items.filter((i) => i.id !== itemId);
					if (nextItems.length === 0) {
						this.isProposalDialogOpen = false;
					}
					return {
						...message,
						proposalSet: {
							...message.proposalSet,
							items: nextItems,
							status: nextItems.length === 0 ? 'executed' : 'pending'
						}
					};
				}
				return message;
			});

			await this.refreshAfterProposal(item.scope);
			toast.success(`Proposed change approved`);
		} catch (error) {
			await errorState.catchError(error, 'Approve assistant proposal item');
		}
	}

	discardProposalItem(proposalSetId: string, itemId: string): void {
		const proposalSet = this.findProposalSet(proposalSetId);
		if (!proposalSet || proposalSet.status !== 'pending') return;

		const item = proposalSet.items.find((i) => i.id === itemId);
		if (!item) return;

		this.messages = this.messages.map((message) => {
			if (message.proposalSet?.id === proposalSetId) {
				const nextItems = message.proposalSet.items.filter((i) => i.id !== itemId);
				if (nextItems.length === 0) {
					this.isProposalDialogOpen = false;
				}
				return {
					...message,
					proposalSet: {
						...message.proposalSet,
						items: nextItems,
						status: nextItems.length === 0 ? 'discarded' : 'pending'
					}
				};
			}
			return message;
		});

		toast.success(`Proposed change discarded`);
	}

	async sendMessage(params: {
		prompt: string;
		pathname: string;
		projectId: string | null;
		assetId: string | null;
		workspaceProfile: WorkspaceProfile | null;
		knowledgeContext: AiWorkspaceKnowledgeContext | null;
	}): Promise<void> {
		if (!params || typeof params.prompt !== 'string') {
			log.warn('Ignoring invalid assistant sendMessage call', {
				hasParams: Boolean(params),
				promptType: typeof params?.prompt
			});
			return;
		}
		const prompt = params.prompt.trim();
		if (!prompt) return;
		const attachments = this.pendingAttachments.map((attachment) => ({ ...attachment }));

		// Deduplicate: check if a prompt with the exact same content is already queued
		const isAlreadyQueued = this.promptQueue.some(
			(item) => item.prompt === prompt && item.pathname === params.pathname
		);
		if (isAlreadyQueued) {
			log.info('Deduplicating duplicate prompt enqueue request', { promptLength: prompt.length });
			return;
		}

		this.draftPrompt = '';
		this.pendingAttachments = [];

		// Push to the reactive prompt queue instead of executing directly
		this.promptQueue = [
			...this.promptQueue,
			{
				id: createId('queued-prompt'),
				prompt,
				attachments,
				pathname: params.pathname,
				projectId: params.projectId,
				assetId: params.assetId,
				workspaceProfile: params.workspaceProfile,
				knowledgeContext: params.knowledgeContext
			}
		];

		// Trigger queue processing
		void this.processQueue();
	}

	private isProcessingQueue = false;

	removeFromQueue(id: string): void {
		const item = this.promptQueue.find((entry) => entry.id === id);
		if (item) {
			this.revokeAttachmentUrls(item.attachments);
		}
		this.promptQueue = this.promptQueue.filter((entry) => entry.id !== id);
	}

	async processQueue(): Promise<void> {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		try {
			while (this.promptQueue.length > 0) {
				// Wait if the assistant is currently running a completion or drafting is active
				if (this.isRunning || aiState.isDraftingActive) {
					break;
				}

				const next = this.promptQueue[0];

				// Wait if the local AI runtime is booting up (model ready but server not available yet)
				const isBooting =
					!aiState.localAiStatus.runtimeAvailable ||
					aiState.localAiStatus.installState === 'loading';
				if (isBooting) {
					break;
				}

				// If model is not downloaded/ready at all, we can't run Gemma
				if (!['installed', 'ready'].includes(aiState.localAiStatus.installState)) {
					break;
				}

				// Dequeue
				this.promptQueue = this.promptQueue.slice(1);

				// Process the message through the full assistant pipeline
				await this.executeQueuedMessage(next);
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}

	private async executeQueuedMessage(item: {
		prompt: string;
		attachments: LocalAssistantImageAttachment[];
		pathname: string;
		projectId: string | null;
		assetId: string | null;
		workspaceProfile: WorkspaceProfile | null;
		knowledgeContext: AiWorkspaceKnowledgeContext | null;
	}): Promise<void> {
		const { prompt, attachments } = item;
		const userMessage: LocalAssistantMessage = {
			id: createId('assistant-message'),
			role: 'user',
			text: prompt,
			thinking: '',
			isStreaming: false,
			createdAt: new Date().toISOString(),
			citations: [],
			links: [],
			followUpSuggestions: [],
			attachments
		};

		this.messages = [...this.messages, userMessage];
		this.isRunning = true;
		this.lastError = null;

		let placeholderId: string | null = null;

		try {
			// Create a streaming placeholder that the UI updates progressively
			placeholderId = createId('assistant-message');
			this.messages = [
				...this.messages,
				{
					id: placeholderId,
					role: 'assistant' as const,
					text: '',
					thinking: '',
					thinkingOpen: false,
					isStreaming: true,
					createdAt: new Date().toISOString(),
					citations: [],
					links: [],
					followUpSuggestions: [],
					attachments: [],
					toolExecutions: []
				}
			];

			// Accumulate streaming chunks separately to avoid mutating the
			// orphan placeholder object after array spreads.
			let accumulatedText = '';
			let toolExecutions: LocalAssistantToolExecution[] = [];
			let lastUiUpdate = 0;
			let updateTimeoutId: ReturnType<typeof setTimeout> | undefined;

			const triggerUiUpdate = (force = false) => {
				const now = Date.now();
				if (force || now - lastUiUpdate > 80) {
					if (updateTimeoutId !== undefined) {
						clearTimeout(updateTimeoutId);
						updateTimeoutId = undefined;
					}
					const idx = this.messages.findIndex((m) => m.id === placeholderId);
					if (idx !== -1) {
						const updated = [...this.messages];
						updated[idx] = {
							...updated[idx],
							thinking: '',
							text: accumulatedText,
							toolExecutions: [...toolExecutions],
							thinkingOpen: false
						};
						this.messages = updated;
					}
					lastUiUpdate = now;
				} else if (updateTimeoutId === undefined) {
					updateTimeoutId = setTimeout(() => {
						triggerUiUpdate(true);
					}, 80);
				}
			};

			const controller = localAssistantService.answerTurn(
				{
					prompt,
					pathname: item.pathname,
					projectId: item.projectId,
					workspaceId: workspaceState.id ?? '',
					assetId: item.assetId,
					workspaceProfile: item.workspaceProfile,
					knowledgeContext: item.knowledgeContext,
					currentEstimateContext: this.currentEstimateContext,
					viewportContext: this.isPageContextAttached
						? enrichViewportContextWithEstimate(
								this.currentViewportContext,
								this.currentEstimateContext
							)
						: null,
					conversation: this.messages.slice(0, -2),
					attachments,
					currencyCode: workspaceState.currencyCode,
					currencySymbol: workspaceState.currencySymbol
				},
				{
					onContent: (chunk) => {
						accumulatedText += chunk;
						triggerUiUpdate();
					},
					onToolCall: (event) => {
						const existingIdx = toolExecutions.findIndex((te) => te.id === event.id);
						if (existingIdx !== -1) {
							toolExecutions = toolExecutions.map((te, i) =>
								i === existingIdx ? { ...te, status: event.status } : te
							);
						} else {
							toolExecutions = [
								...toolExecutions,
								{
									id: event.id,
									name: event.name,
									status: event.status,
									arguments: event.arguments
								}
							];
						}
						triggerUiUpdate(true);
					}
				}
			);

			const answer = await controller;
			if (updateTimeoutId !== undefined) {
				clearTimeout(updateTimeoutId);
			}

			// Replace the placeholder with the finalised message
			this.messages = this.messages.map((msg) =>
				msg.id === placeholderId
					? {
							...msg,
							text: answer.answer,
							thinking: '',
							isStreaming: false,
							citations: answer.citations,
							links: answer.links,
							followUpSuggestions: answer.followUpSuggestions,
							toolCalls: answer.toolCalls,
							proposalSet: answer.proposalSet,
							toolExecutions: [...toolExecutions]
						}
					: msg
			);

			if (answer.proposalSet && answer.proposalSet.status === 'pending') {
				this.isProposalDialogOpen = true;
			}
		} catch (error) {
			// Finalise the streaming placeholder so it doesn't stay stuck
			if (placeholderId) {
				this.messages = this.messages.map((msg) =>
					msg.id === placeholderId ? { ...msg, isStreaming: false } : msg
				);
			}

			// Gracefully handle manual cancellations without displaying error alerts
			const isStopped = error instanceof Error && error.message.includes('stream was stopped');
			if (isStopped) {
				log.info('Assistant turn aborted by user');
				return;
			}

			const message =
				error instanceof Error ? error.message : "Kwantflow AI couldn't find an answer.";
			this.lastError = message;
			log.error('Assistant turn failed', { error });
			toast.error("Kwantflow AI couldn't answer that");
			if (placeholderId) {
				this.messages = this.messages.map((msg) =>
					msg.id === placeholderId
						? {
								...msg,
								text: "Kwantflow AI couldn't complete that turn safely. Nothing was changed.",
								isStreaming: false
							}
						: msg
				);
			}
		} finally {
			this.isRunning = false;
			// Process next item in the queue when this message completes
			void this.processQueue();
		}
	}
}

export const assistantState = new AssistantState();
