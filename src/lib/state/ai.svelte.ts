import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'svelte-sonner';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { createLogger } from '$lib/services/logger.js';
import { storeService } from '$lib/services/store.js';
import {
	buildWorkspaceAiKnowledgeContext,
	extractWorkspaceAiKnowledgeText,
	isWorkspaceAiKnowledgeFileAllowed,
	persistWorkspaceAiSkillFile,
	WORKSPACE_AI_FEEDBACK_MAX_CHARS,
	removeWorkspaceAiKnowledgeFile as removeWorkspaceAiKnowledgeStoredFile,
	storeWorkspaceAiKnowledgeFile,
	WORKSPACE_AI_KNOWLEDGE_MAX_FILES,
	WORKSPACE_AI_PLAYBOOK_MAX_CHARS
} from '$lib/services/ai-workspace-knowledge.js';
import { localAiRuntimeManifest } from '$lib/constants/local-ai-runtime-manifest.js';
import {
	AI_PROMPT_CONTRACT,
	AiPreprocessFailure,
	LOCAL_LITERT_LM_RUNTIME_CONTRACT,
	buildAiAssetContext,
	buildAiOutputContract,
	buildAiProjectContext,
	buildAiReferenceContext,
	buildAiWorkflowRules,
	buildAiOverrideEvents,
	buildEstimateApplySignature,
	buildDraftEvidenceCoverage,
	classifyAiFailure,
	draftEstimateToEstimate,
	buildLocalPreparedRun,
	normaliseDraftEstimateStructure,
	normaliseAiFailureMessage,
	normaliseAiTableSnapshot
} from '$lib/services/ai-drafting.js';
import { localAiService, repairDraftRunResultHeuristicOutline } from '$lib/services/local-ai.js';
import {
	resolveEstimateAiFileEligibilities,
	summariseEstimateAiFileEligibilities
} from '$lib/services/estimate-ai-file-eligibility.js';
import {
	buildAiEstimateContextSnapshot,
	buildDraftMatchingFromReconciledEstimate,
	buildEstimateMappingReview
} from '$lib/services/estimate-ai-context.js';
import { hasInternetConnection, isTauri, generateUUID } from '$lib/utils/env.js';
import { dbService } from '$lib/services/db.js';
import { workspaceState } from './workspace.svelte.js';
import { errorState } from './errors.svelte.js';
import type {
	AiEvidenceRef,
	AiEstimateContextSnapshot,
	AiIssue,
	AiProvider,
	AiRunProgressDetail,
	AiRunStatus,
	AiTaskSummary,
	AiWorkspaceKnowledgeContext,
	Asset,
	AssetFile,
	Estimate,
	LocalAiStatus,
	WorkspaceAiFeedbackEntry,
	WorkspaceAiKnowledgeFile
} from '$lib/types/index.js';

function stableAiStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableAiStringify(entry)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableAiStringify(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function mergeAiIssues(primary: AiIssue[], secondary: AiIssue[]): AiIssue[] {
	const seen = new SvelteSet<string>();
	const merged: AiIssue[] = [];
	for (const issue of [...primary, ...secondary]) {
		const key = [
			issue.code,
			issue.severity,
			issue.message,
			issue.fileId ?? '',
			issue.fileName ?? ''
		].join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(issue);
	}
	return merged;
}

async function sha256AiPayload(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(stableAiStringify(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type DraftEstimatePayload = {
	asset: Asset;
	project: {
		id: string;
		projectName: string | null;
		rfqNumber: string | null;
		content: string | null;
		note: string | null;
		receivedDate?: string | null;
		submissionDeadlineAt?: string | null;
		estimatorName?: string | null;
		customerTenderReference?: string | null;
		addendumLabel?: string | null;
		addendumDate?: string | null;
		addendumNotes?: string | null;
		siteAddress?: string | null;
		deliveryAddress?: string | null;
	};
	files: AssetFile[];
	currentEstimate: Estimate;
	savedEstimate?: Estimate | null;
	tableSnapshot: Record<string, unknown>;
};

type DraftedEstimateResult = {
	runId: string;
	modelId: string;
	estimate: Estimate;
	contextSnapshot: AiEstimateContextSnapshot;
	issues: AiIssue[];
	evidenceRefs: AiEvidenceRef[];
	completedAt: string;
};

type AiTaskEntry = {
	runId: string;
	assetId: string;
	assetName: string;
	projectId: string;
	projectLabel: string | null;
	status: AiRunStatus;
	errorMessage: string | null;
	startedAt: string;
	completedAt: string | null;
};

type AssetAiRunState = {
	runId: string | null;
	status: AiRunStatus | 'idle';
	editorApplyState: 'none' | 'pending_manual_apply' | 'applied_to_editor';
	isCancelling: boolean;
	modelId: string | null;
	errorMessage: string | null;
	issues: AiIssue[];
	evidenceRefs: AiEvidenceRef[];
	lastAppliedEstimate: Estimate | null;
	lastSavedApplySignature: string | null;
	completedAt: string | null;
	progressDetail: AiRunProgressDetail;
};

type AiDraftingAvailability = {
	enabled: boolean;
	hasInternet: boolean;
	localAiInstallState: LocalAiStatus['installState'];
	localAiModelReady: boolean;
	hasActiveModel: boolean;
	canDraftEstimate: boolean;
	unavailableReason: string | null;
};

const log = createLogger('aiState');

const ACTIVE_RUN_STATUSES: AiRunStatus[] = ['queued', 'preprocessing', 'extracting', 'drafting'];

const START_BLOCKING_STATUSES: AiRunStatus[] = ['preprocessing', 'extracting', 'drafting'];

const LOCAL_HYDRATION_STALE_AFTER_MS = 15 * 60_000;

function deriveRunFailureStage(state: AssetAiRunState): string {
	if (state.status === 'drafting' && state.progressDetail.draftSubphase) {
		return state.progressDetail.draftSubphase;
	}

	return state.status === 'idle' ? 'preprocessing' : state.status;
}

// Internal recovery-only terminal status. Keep it persisted for hydration compatibility,
// but never expose it as a user-facing task-centre/editor stage.
const DRAFT_RECOVERY_STATUSES: AiRunStatus[] = ['drafted'];

function isDraftRecoveryStatus(status: AiRunStatus): boolean {
	return DRAFT_RECOVERY_STATUSES.includes(status);
}

function isTerminalRecoveryStatus(status: AiRunStatus): boolean {
	return isDraftRecoveryStatus(status) || status === 'failed' || status === 'cancelled';
}

const TASK_VISIBLE_STATUSES: AiRunStatus[] = [
	'queued',
	'preprocessing',
	'extracting',
	'drafting',
	'applied',
	'failed',
	'cancelled'
];

function toAiPayloadRecord(value: object): Record<string, unknown> {
	return value as Record<string, unknown>;
}

function blankAssetRunState(): AssetAiRunState {
	return {
		runId: null,
		status: 'idle',
		editorApplyState: 'none',
		isCancelling: false,
		modelId: null,
		errorMessage: null,
		issues: [],
		evidenceRefs: [],
		lastAppliedEstimate: null,
		lastSavedApplySignature: null,
		completedAt: null,
		progressDetail: blankRunProgressDetail()
	};
}

function blankRunProgressDetail(): AiRunProgressDetail {
	return {
		currentArtifactName: null,
		processedArtifactCount: 0,
		usableArtifactCount: 0,
		artifactIssueCount: 0,
		totalArtifactCount: 0,
		supportedArtifactCount: 0,
		unsupportedArtifactCount: 0,
		failedEvidenceUnitCount: 0,
		omittedEvidenceUnitCount: 0,
		draftSubphase: null
	};
}

function buildHydratedProgressDetail(params: {
	runStatus: AiRunStatus;
	artifactManifestPayload?: Record<string, unknown>;
	preprocessIssuesPayload?: Record<string, unknown>;
	evidenceCoveragePayload?: Record<string, unknown>;
}): AiRunProgressDetail {
	const artifacts = Array.isArray(params.artifactManifestPayload?.artifacts)
		? params.artifactManifestPayload.artifacts
		: [];
	const preprocessIssues = isAiIssueArray(params.preprocessIssuesPayload?.issues)
		? params.preprocessIssuesPayload.issues
		: [];
	const supportedArtifactCount = artifacts.length;
	const unsupportedArtifactCount = preprocessIssues.filter(
		(issue) => issue.code === 'unsupported_file'
	).length;
	const coverage = isRecord(params.evidenceCoveragePayload?.coverage)
		? params.evidenceCoveragePayload.coverage
		: null;
	const failedEvidenceUnitCount =
		typeof coverage?.failedUnits === 'number' ? Math.max(0, coverage.failedUnits) : 0;
	const omittedEvidenceUnitCount =
		typeof coverage?.omittedUnits === 'number' ? Math.max(0, coverage.omittedUnits) : 0;
	const terminalStatus =
		params.runStatus === 'applied' ||
		params.runStatus === 'failed' ||
		params.runStatus === 'cancelled' ||
		params.runStatus === 'drafted';

	return {
		currentArtifactName: null,
		processedArtifactCount: terminalStatus ? supportedArtifactCount : 0,
		// Without persisted extraction/relevance output, zero is the only truthful fallback.
		usableArtifactCount: 0,
		artifactIssueCount: preprocessIssues.length,
		totalArtifactCount: supportedArtifactCount,
		supportedArtifactCount,
		unsupportedArtifactCount,
		failedEvidenceUnitCount,
		omittedEvidenceUnitCount,
		draftSubphase: null
	};
}

function _isLocalRuntimeModelId(modelId: string | null): boolean {
	return modelId === LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId;
}

function isLocalActiveRunStatus(status: AiRunStatus | 'idle'): boolean {
	return status === 'preprocessing' || status === 'extracting' || status === 'drafting';
}

function isHydratedActiveRunStale(
	updatedAt: string | null | undefined,
	staleAfterMs: number
): boolean {
	if (!updatedAt) return true;
	const updatedAtMs = Date.parse(updatedAt);
	if (!Number.isFinite(updatedAtMs)) return true;
	return Date.now() - updatedAtMs > staleAfterMs;
}

function isAiIssueArray(value: unknown): value is AiIssue[] {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) =>
				entry !== null &&
				typeof entry === 'object' &&
				typeof (entry as Record<string, unknown>).code === 'string' &&
				typeof (entry as Record<string, unknown>).message === 'string'
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEstimateValue(value: unknown): value is Estimate {
	return (
		isRecord(value) && typeof value.asset_id === 'string' && Array.isArray(value.takeoff_items)
	);
}

function isContextSnapshotValue(value: unknown): value is AiEstimateContextSnapshot {
	return isRecord(value) && typeof value.version === 'string' && isRecord(value.asset_context);
}

function isPromptContractValue(value: unknown): value is typeof AI_PROMPT_CONTRACT {
	return (
		isRecord(value) &&
		typeof value.systemInstructionVersion === 'string' &&
		typeof value.extractionPromptVersion === 'string' &&
		typeof value.draftPromptVersion === 'string'
	);
}

function isWorkspaceKnowledgeContextValue(value: unknown): value is AiWorkspaceKnowledgeContext {
	return (
		isRecord(value) &&
		(value.compiledMarkdown === null || typeof value.compiledMarkdown === 'string') &&
		(value.skillMarkdown === null ||
			value.skillMarkdown === undefined ||
			typeof value.skillMarkdown === 'string') &&
		(value.skillHash === null ||
			value.skillHash === undefined ||
			typeof value.skillHash === 'string') &&
		isRecord(value.sourceSummary) &&
		Array.isArray(value.files)
	);
}

function isRunExecutionContextValue(value: unknown): value is AiRunExecutionContext {
	return (
		isRecord(value) &&
		typeof value.frontendSessionId === 'string' &&
		typeof value.frontendBootedAt === 'string' &&
		value.provider === 'local_litert_lm' &&
		typeof value.clientRuntimeId === 'string' &&
		(value.runtimeKind === undefined || value.runtimeKind === 'litert_lm')
	);
}

function isLocalAiProvider(provider: AiProvider): boolean {
	return provider === 'local_litert_lm';
}

function isAssetFileValue(value: unknown): value is AssetFile {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.project_id === 'string' &&
		typeof value.file_path === 'string' &&
		typeof value.original_name === 'string'
	);
}

function isAssetFileArray(value: unknown): value is AssetFile[] {
	return Array.isArray(value) && value.every((entry) => isAssetFileValue(entry));
}

type QueuedRunExecutionContext = {
	provider: AiProvider;
	modelId: string;
	projectContext: ReturnType<typeof buildAiProjectContext>;
	assetContext: ReturnType<typeof buildAiAssetContext>;
	workspaceKnowledgeContext: AiWorkspaceKnowledgeContext | null;
	files: AssetFile[];
	normalizedTableSnapshot: Record<string, unknown>;
	referenceContext: ReturnType<typeof buildAiReferenceContext>;
	workflowRules: ReturnType<typeof buildAiWorkflowRules>;
	outputContract: ReturnType<typeof buildAiOutputContract>;
	estimateContextSnapshot: AiEstimateContextSnapshot;
	promptContract: typeof AI_PROMPT_CONTRACT;
};

type AiRunExecutionContext = {
	frontendSessionId: string;
	frontendBootedAt: string;
	provider: AiProvider;
	clientRuntimeId: string;
	runtimeKind?: LocalAiStatus['runtimeKind'];
};

type HydratedActiveRunRecoveryMode =
	'recover_from_provider' | 'keep_active_in_current_session' | 'fail_as_interrupted';

function blankLocalAiStatus(): LocalAiStatus {
	const r = localAiRuntimeManifest.litertLm;
	return {
		runtimeKind: 'litert_lm',
		runtimeVersion: r.runtimeVersion,
		modelRepoId: r.modelRepoId,
		modelArtifactId: r.modelArtifactId,
		modelFileName: r.modelFileName,
		mmprojFileName: null,
		installState: 'not_downloaded',
		runtimeAvailable: false,
		expectedDownloadBytes: r.modelExpectedSizeBytes,
		modelReady: false,
		supportsImageInputs: false,
		supportsNativeToolCalls: false,
		activeDownload: null,
		lastError: null,
		diagnostics: {
			activeLaunchProfile: 'unknown',
			startupElapsedMs: null,
			imageProbeElapsedMs: null,
			lastCompletionElapsedMs: null,
			lastFailureClass: null,
			lastTimeoutStage: null,
			gpuAcceleration: 'unknown',
			contextSizeTokens: null,
			activeStreamCount: 0,
			capabilityProbe: {
				supportsConstrainedToolCalls: false,
				supportsNativeToolCalls: false,
				supportsReasoningSeparation: false,
				supportsVisionInputs: false,
				supportsPersistentConversation: false,
				supportsPersistentConversationWithVision: false,
				checkedElapsedMs: null,
				source: 'unknown'
			}
		}
	};
}

function optimisticLocalAiDownloadStatus(current: LocalAiStatus): LocalAiStatus {
	const r = localAiRuntimeManifest.litertLm;
	return {
		...$state.snapshot(current),
		installState: 'downloading',
		runtimeAvailable: false,
		expectedDownloadBytes: r.modelExpectedSizeBytes,
		modelReady: false,
		activeDownload: {
			stage: 'queued',
			label: 'Starting Kwantflow AI download',
			downloadedBytes: 0,
			totalBytes: r.modelExpectedSizeBytes,
			percent: 0
		},
		lastError: null
	};
}

function extractSavedApplySignature(
	reviewEvents: { event_type: string; event_payload: Record<string, unknown> }[]
): string | null {
	for (let index = reviewEvents.length - 1; index >= 0; index -= 1) {
		const event = reviewEvents[index];
		if (event.event_type !== 'saved_after_ai_apply') continue;
		const signature = event.event_payload.estimateSignature;
		if (typeof signature === 'string' && signature.length > 0) {
			return signature;
		}
	}

	return null;
}

function extractLatestApplyDisposition(
	reviewEvents: { event_type: string; event_payload: Record<string, unknown> }[]
): 'pending' | 'saved' | 'reverted' {
	for (let index = reviewEvents.length - 1; index >= 0; index -= 1) {
		const event = reviewEvents[index];
		if (event.event_type === 'saved_after_ai_apply') {
			return 'saved';
		}
		if (event.event_type === 'reverted_before_save' || event.event_type === 'estimate_reset') {
			return 'reverted';
		}
	}

	return 'pending';
}

function classifyHydratedActiveRunRecovery(params: {
	provider: AiProvider;
	hasRecoveredDraftOutput: boolean;
	executionContext: AiRunExecutionContext | null;
	currentFrontendSessionId: string;
}): HydratedActiveRunRecoveryMode {
	if (params.hasRecoveredDraftOutput) {
		return 'keep_active_in_current_session';
	}

	if (
		params.executionContext &&
		params.executionContext.frontendSessionId !== params.currentFrontendSessionId
	) {
		return 'fail_as_interrupted';
	}

	return 'keep_active_in_current_session';
}

async function generateId(): Promise<string> {
	return isTauri() ? invoke<string>('generate_uuid') : crypto.randomUUID();
}

class AiState {
	isHydrated = $state(false);
	hasInternet = $state(true);
	isAssistantRunning = $state(false);
	localAiStatus: LocalAiStatus = $state(blankLocalAiStatus());
	activeModelId: string | null = $state(LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId);
	activeModelLabel = $state('Kwantflow AI');
	activeModelDescription = $state('Download Kwantflow AI to draft estimates on this device.');
	taskEntries: AiTaskEntry[] = $state([]);
	workspaceAiPlaybookText = $state('');
	workspaceAiKnowledgeFiles: WorkspaceAiKnowledgeFile[] = $state([]);
	workspaceAiFeedbackEntries: WorkspaceAiFeedbackEntry[] = $state([]);
	workspaceAiSkillPreview = $state('');
	workspaceAiSkillFilePath: string | null = $state(null);
	workspaceAiSkillHash: string | null = $state(null);
	workspaceAiSkillUpdatedAt: string | null = $state(null);
	workspaceAiKnowledgeContext: AiWorkspaceKnowledgeContext | null = $state(null);
	isWorkspaceKnowledgeHydrated = $state(false);

	private assetRuns = new SvelteMap<string, AssetAiRunState>();
	private appliedRunIds = new SvelteMap<string, string>();
	private dismissedTaskRunIds = new SvelteSet<string>();
	private estimateBeforeApplySnapshots = new SvelteMap<string, Estimate>();
	private pendingAppliedEstimates = new SvelteMap<string, DraftedEstimateResult>();
	private editorApplyStates = new SvelteMap<
		string,
		'none' | 'pending_manual_apply' | 'applied_to_editor'
	>();
	private queuedRunContexts = new Map<string, QueuedRunExecutionContext>();
	private cancelledLocalRunIds = new SvelteSet<string>();
	private startingAssetIds = new Set<string>();
	private runStartLock: Promise<void> = Promise.resolve();
	private internetListenersRegistered = false;
	private resumeListenersRegistered = false;
	private localAiStatusListenerRegistered = false;
	private readonly frontendSessionId = generateUUID();
	private readonly frontendBootedAt = new Date().toISOString();

	private readonly syncInternetStatus = () => {
		this.hasInternet = hasInternetConnection();
	};

	private readonly handleAppResume = () => {
		this.syncInternetStatus();
	};

	private async withRunStartLock<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.runStartLock;
		let release = () => {};
		this.runStartLock = new Promise<void>((resolve) => {
			release = resolve;
		});

		await previous;

		try {
			return await operation();
		} finally {
			release();
		}
	}

	private applyLocalAiStatus(status: LocalAiStatus | null): void {
		this.localAiStatus = status ? structuredClone(status) : blankLocalAiStatus();
		this.syncActiveModelDisplay();
	}

	private syncActiveModelDisplay(): void {
		this.activeModelId = LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId;
		this.activeModelLabel = 'Kwantflow AI';
		this.activeModelDescription =
			this.localAiStatus.installState === 'ready'
				? 'Kwantflow AI is ready to draft estimates on this device.'
				: ['installed', 'ready'].includes(this.localAiStatus.installState)
					? 'Kwantflow AI is installed and will start when needed.'
					: 'Download Kwantflow AI to draft estimates on this device.';
	}

	private isLocalModelAvailable(): boolean {
		return (
			(this.localAiStatus.installState === 'installed' ||
				this.localAiStatus.installState === 'ready') &&
			this.localAiStatus.runtimeAvailable &&
			!this.localAiStatus.lastError
		);
	}

	private buildRunExecutionContext(params: {
		provider: AiProvider;
		clientRuntimeId: string;
		runtimeKind?: LocalAiStatus['runtimeKind'];
	}): AiRunExecutionContext {
		return {
			frontendSessionId: this.frontendSessionId,
			frontendBootedAt: this.frontendBootedAt,
			provider: params.provider,
			clientRuntimeId: params.clientRuntimeId,
			runtimeKind: params.runtimeKind
		};
	}

	async hydrate(options: { includeWorkspaceState?: boolean } = {}): Promise<void> {
		log.info('Hydrating AI state');
		this.syncInternetStatus();
		if (!this.internetListenersRegistered && typeof window !== 'undefined') {
			window.addEventListener('online', this.syncInternetStatus);
			window.addEventListener('offline', this.syncInternetStatus);
			this.internetListenersRegistered = true;
		}
		if (!this.resumeListenersRegistered && typeof window !== 'undefined') {
			window.addEventListener('focus', this.handleAppResume);
			document.addEventListener('visibilitychange', this.handleAppResume);
			this.resumeListenersRegistered = true;
		}
		if (isTauri() && !this.localAiStatusListenerRegistered) {
			listen<LocalAiStatus>('kwantflow-local-ai-status-changed', (event) => {
				this.applyLocalAiStatus(event.payload);
			}).catch((error) => {
				log.warn('Failed to register local-ai status change listener', { error });
			});
			this.localAiStatusListenerRegistered = true;
		}
		this.dismissedTaskRunIds = new SvelteSet(await storeService.getDismissedAiTaskRunIds());
		await this.refreshLocalAiStatus({ suppressErrors: true });
		this.syncActiveModelDisplay();

		if (options.includeWorkspaceState !== false) {
			await this.hydrateWorkspaceKnowledge();
			await this.hydrateTaskEntries();
			await this.maybeStartNextQueuedRun();
		}
		this.isHydrated = true;
		log.info('Hydrated AI state');
	}

	async refreshLocalAiStatus(options: { suppressErrors?: boolean } = {}): Promise<void> {
		try {
			const status = await localAiService.getStatus();
			this.applyLocalAiStatus(status);
			log.debug('Refreshed Kwantflow AI status', {
				installState: status.installState,
				modelReady: status.modelReady
			});
		} catch (error) {
			this.applyLocalAiStatus(null);
			log.warn('Kwantflow AI status refresh failed', {
				error,
				suppressErrors: options.suppressErrors ?? false
			});
			if (!options.suppressErrors) {
				throw error;
			}
		}
	}

	async downloadLocalAiModel(): Promise<void> {
		try {
			this.applyLocalAiStatus(optimisticLocalAiDownloadStatus(this.localAiStatus));
			const status = await localAiService.downloadModel();
			this.applyLocalAiStatus(status);
			if (['failed', 'repair_needed', 'unsupported'].includes(status.installState)) {
				throw new Error(status.lastError ?? 'Kwantflow AI setup needs attention. Retry Download.');
			}
			if (status.installState === 'ready') {
				toast.success('Kwantflow AI ready');
			} else if (status.installState === 'installed') {
				toast.success('Kwantflow AI installed');
			}
		} catch (error) {
			await this.refreshLocalAiStatus({ suppressErrors: true });
			if (this.localAiStatus.installState === 'not_downloaded') {
				this.applyLocalAiStatus({
					...$state.snapshot(this.localAiStatus),
					installState: 'failed',
					activeDownload: null,
					lastError: error instanceof Error ? error.message : String(error)
				});
			}
			log.error('Failed to download Kwantflow AI model', { error });
			await errorState.catchError(error, 'Download Kwantflow AI', undefined, { silent: true });
			throw error;
		}
	}

	async cancelLocalAiDownload(): Promise<void> {
		try {
			const status = await localAiService.cancelDownload();
			this.applyLocalAiStatus(status);
			toast.success('Cancelling Kwantflow AI download');
		} catch (error) {
			log.error('Failed to cancel Kwantflow AI download', { error });
			await errorState.catchError(error, 'Cancel Kwantflow AI Download', undefined, {
				silent: true
			});
			throw error;
		}
	}

	async verifyLocalAiInstall(): Promise<void> {
		try {
			const status = await localAiService.verifyLocalAiInstall();
			this.applyLocalAiStatus(status);
			toast.success(
				['installed', 'ready'].includes(status.installState)
					? 'Kwantflow AI installed'
					: 'Kwantflow AI checked'
			);
		} catch (error) {
			await this.refreshLocalAiStatus({ suppressErrors: true });
			log.error('Failed to check Kwantflow AI installation', { error });
			await errorState.catchError(error, 'Check Kwantflow AI Install', undefined, { silent: true });
			throw error;
		}
	}

	async ensureLocalAiReady(): Promise<void> {
		try {
			const status = await localAiService.ensureLocalAiReady();
			this.applyLocalAiStatus(status);
			toast.success(
				status.installState === 'ready' ? 'Kwantflow AI ready' : 'Kwantflow AI checked'
			);
		} catch (error) {
			await this.refreshLocalAiStatus({ suppressErrors: true });
			log.error('Failed to verify Kwantflow AI runtime', { error });
			await errorState.catchError(error, 'Verify Kwantflow AI', undefined, { silent: true });
			throw error;
		}
	}

	async removeLocalAiModel(): Promise<void> {
		try {
			const status = await localAiService.removeModel();
			this.applyLocalAiStatus(status);
			toast.success('Kwantflow AI removed');
		} catch (error) {
			log.error('Failed to remove Kwantflow AI model', { error });
			await errorState.catchError(error, 'Remove Kwantflow AI', undefined, { silent: true });
			throw error;
		}
	}

	async hydrateWorkspaceKnowledge(): Promise<void> {
		const [profile, files, feedbackEntries] = await Promise.all([
			dbService.getWorkspaceProfile(),
			dbService.getWorkspaceAiKnowledgeFiles(),
			dbService.getWorkspaceAiFeedbackEntries()
		]);
		this.workspaceAiPlaybookText = profile?.aiPlaybookText ?? '';
		this.workspaceAiKnowledgeFiles = files;
		this.workspaceAiFeedbackEntries = feedbackEntries;
		await this.refreshWorkspaceKnowledgeArtifacts();
		this.isWorkspaceKnowledgeHydrated = true;
	}

	private async refreshWorkspaceKnowledgeArtifacts(): Promise<void> {
		const overrideEvents = await dbService.getWorkspaceAiOverrideEvents();
		const baseContext = buildWorkspaceAiKnowledgeContext({
			playbookText: this.workspaceAiPlaybookText,
			files: this.workspaceAiKnowledgeFiles,
			feedbackEntries: this.workspaceAiFeedbackEntries
				.map((entry) => ({
					...entry,
					feedbackText: entry.feedbackText.trim()
				}))
				.filter((entry) => entry.feedbackText.length > 0),
			overrideEvents,
			skillFilePath: null
		});
		const skillFilePath = await persistWorkspaceAiSkillFile({
			workspaceId: workspaceState.id,
			skillMarkdown: baseContext.skillMarkdown
		});
		const context =
			baseContext.skillMarkdown || baseContext.compiledMarkdown
				? buildWorkspaceAiKnowledgeContext({
						playbookText: this.workspaceAiPlaybookText,
						files: this.workspaceAiKnowledgeFiles,
						feedbackEntries: this.workspaceAiFeedbackEntries,
						overrideEvents,
						skillFilePath
					})
				: null;
		this.workspaceAiKnowledgeContext = context;
		this.workspaceAiSkillPreview = context?.skillMarkdown ?? '';
		this.workspaceAiSkillFilePath = context?.skillFilePath ?? null;
		this.workspaceAiSkillHash = context?.skillHash ?? null;
		this.workspaceAiSkillUpdatedAt = context ? new Date().toISOString() : null;
	}

	async saveWorkspacePlaybook(text: string): Promise<void> {
		const nextText = text.trim();
		if (nextText.length > WORKSPACE_AI_PLAYBOOK_MAX_CHARS) {
			throw new Error(
				`Workspace playbook must stay within ${WORKSPACE_AI_PLAYBOOK_MAX_CHARS} characters.`
			);
		}
		await dbService.updateWorkspaceProfile({ aiPlaybookText: nextText });
		this.workspaceAiPlaybookText = nextText;
		workspaceState.aiPlaybookText = nextText;
		await this.refreshWorkspaceKnowledgeArtifacts();
		toast.success('AI playbook saved');
	}

	async addWorkspaceKnowledgeFiles(sourcePaths: string[]): Promise<void> {
		const dedupedPaths = Array.from(
			new Set(
				sourcePaths
					.map((path) => path.trim())
					.filter((path) => path.length > 0 && isWorkspaceAiKnowledgeFileAllowed(path))
			)
		);
		if (dedupedPaths.length === 0) return;
		const availableSlots = Math.max(
			0,
			WORKSPACE_AI_KNOWLEDGE_MAX_FILES - this.workspaceAiKnowledgeFiles.length
		);
		if (availableSlots <= 0) {
			throw new Error(`You can keep up to ${WORKSPACE_AI_KNOWLEDGE_MAX_FILES} AI knowledge files.`);
		}
		if (dedupedPaths.length > availableSlots) {
			throw new Error(
				`Only ${availableSlots} AI knowledge ${availableSlots === 1 ? 'file is' : 'files are'} still available in this workspace.`
			);
		}

		for (const sourcePath of dedupedPaths) {
			const id = await generateId();
			const stored = await storeWorkspaceAiKnowledgeFile({
				workspaceId: workspaceState.id,
				fileId: id,
				sourcePath
			});
			try {
				const extractedText = await extractWorkspaceAiKnowledgeText(stored.filePath);
				await dbService.addWorkspaceAiKnowledgeFile({
					id,
					filePath: stored.filePath,
					originalName: sourcePath.split(/[/\\]/).pop() ?? 'knowledge-file',
					mimeType: stored.mimeType,
					byteSize: stored.byteSize,
					extractedText
				});
			} catch (error) {
				await removeWorkspaceAiKnowledgeStoredFile(stored.filePath).catch(() => undefined);
				throw error;
			}
		}

		this.workspaceAiKnowledgeFiles = await dbService.getWorkspaceAiKnowledgeFiles();
		await this.refreshWorkspaceKnowledgeArtifacts();
		this.isWorkspaceKnowledgeHydrated = true;
		toast.success(
			dedupedPaths.length === 1 ? 'AI knowledge file added' : 'AI knowledge files added'
		);
	}

	async removeWorkspaceKnowledgeFile(fileId: string): Promise<void> {
		const removed = await dbService.removeWorkspaceAiKnowledgeFile(fileId);
		if (!removed) return;
		await removeWorkspaceAiKnowledgeStoredFile(removed.filePath);
		this.workspaceAiKnowledgeFiles = this.workspaceAiKnowledgeFiles.filter(
			(file) => file.id !== fileId
		);
		await this.refreshWorkspaceKnowledgeArtifacts();
		toast.success('AI knowledge file removed');
	}

	buildWorkspaceKnowledgeContext(): AiWorkspaceKnowledgeContext | null {
		return this.workspaceAiKnowledgeContext;
	}

	getRunFeedbackEntry(runId: string | null | undefined): WorkspaceAiFeedbackEntry | null {
		if (!runId) return null;
		return this.workspaceAiFeedbackEntries.find((entry) => entry.runId === runId) ?? null;
	}

	async submitRunFeedback(params: {
		runId: string;
		assetId: string;
		estimateId?: string | null;
		feedbackText: string;
	}): Promise<void> {
		const feedbackText = params.feedbackText.trim();
		if (!feedbackText) {
			throw new Error('Feedback cannot be empty.');
		}
		if (feedbackText.length > WORKSPACE_AI_FEEDBACK_MAX_CHARS) {
			throw new Error(`Feedback must stay within ${WORKSPACE_AI_FEEDBACK_MAX_CHARS} characters.`);
		}

		const existing = this.getRunFeedbackEntry(params.runId);
		if (existing) {
			await dbService.removeWorkspaceAiFeedbackEntry(existing.id);
			this.workspaceAiFeedbackEntries = this.workspaceAiFeedbackEntries.filter(
				(entry) => entry.id !== existing.id
			);
		}

		const entry: WorkspaceAiFeedbackEntry = {
			id: await generateId(),
			workspaceId: workspaceState.id,
			runId: params.runId,
			assetId: params.assetId,
			estimateId: params.estimateId ?? params.assetId,
			feedbackText,
			created_at: new Date().toISOString()
		};
		await dbService.addWorkspaceAiFeedbackEntry({
			id: entry.id,
			runId: entry.runId,
			assetId: entry.assetId,
			estimateId: entry.estimateId,
			feedbackText: entry.feedbackText,
			createdAt: entry.created_at
		});
		this.workspaceAiFeedbackEntries = [entry, ...this.workspaceAiFeedbackEntries];
		await this.refreshWorkspaceKnowledgeArtifacts();
		toast.success('Feedback saved for future drafts');
	}

	async removeWorkspaceFeedbackEntry(feedbackId: string): Promise<void> {
		await dbService.removeWorkspaceAiFeedbackEntry(feedbackId);
		this.workspaceAiFeedbackEntries = this.workspaceAiFeedbackEntries.filter(
			(entry) => entry.id !== feedbackId
		);
		await this.refreshWorkspaceKnowledgeArtifacts();
		toast.success('Feedback removed');
	}

	async clearWorkspaceFeedbackEntries(): Promise<void> {
		await dbService.clearWorkspaceAiFeedbackEntries();
		this.workspaceAiFeedbackEntries = [];
		await this.refreshWorkspaceKnowledgeArtifacts();
		toast.success('Feedback history cleared');
	}

	getAssetRunState(assetId: string): AssetAiRunState {
		const state = this.assetRuns.get(assetId);
		if (!state) return blankAssetRunState();
		return {
			...state,
			editorApplyState: this.editorApplyStates.get(assetId) ?? state.editorApplyState
		};
	}

	getPendingAppliedEstimate(assetId: string): Estimate | null {
		return this.pendingAppliedEstimates.get(assetId)?.estimate ?? null;
	}

	getEstimateBeforeApply(assetId: string): Estimate | null {
		return this.estimateBeforeApplySnapshots.get(assetId) ?? null;
	}

	hasPendingAppliedEstimate(assetId: string): boolean {
		return this.pendingAppliedEstimates.has(assetId);
	}

	shouldRestoreEstimateBaseline(assetId: string): boolean {
		if (this.hasPendingAppliedEstimate(assetId)) {
			return false;
		}

		const status = this.getAssetRunState(assetId).status;
		return status !== 'idle' && (this.isRunActive(assetId) || isTerminalRecoveryStatus(status));
	}

	isAssetEstimateLocked(assetId: string): boolean {
		return this.isRunActive(assetId);
	}

	get isDraftingActive(): boolean {
		return this.hasBlockingRunInFlight();
	}

	get actionableTaskCount(): number {
		return this.taskEntries.filter(
			(entry) =>
				this.isTaskActive(entry.status) ||
				(entry.status === 'applied' && this.hasPendingAppliedEstimate(entry.assetId))
		).length;
	}

	private isTaskActive(status: AiRunStatus): boolean {
		return ACTIVE_RUN_STATUSES.includes(status);
	}

	private hasBlockingRunInFlight(excludingRunId?: string): boolean {
		for (const state of this.assetRuns.values()) {
			if (!state.runId) continue;
			if (excludingRunId && state.runId === excludingRunId) continue;
			if (START_BLOCKING_STATUSES.includes(state.status as AiRunStatus)) {
				return true;
			}
		}
		for (const entry of this.taskEntries) {
			if (excludingRunId && entry.runId === excludingRunId) continue;
			if (START_BLOCKING_STATUSES.includes(entry.status)) {
				return true;
			}
		}
		return false;
	}

	private queuedTaskEntries(): AiTaskEntry[] {
		return [...this.taskEntries]
			.filter((entry) => entry.status === 'queued')
			.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
	}

	getQueuePosition(assetId: string): number | null {
		const index = this.queuedTaskEntries().findIndex((entry) => entry.assetId === assetId);
		return index >= 0 ? index + 1 : null;
	}

	private sortTaskEntries(entries: AiTaskEntry[]): AiTaskEntry[] {
		const rank = (status: AiRunStatus): number => {
			if (START_BLOCKING_STATUSES.includes(status)) return 0;
			if (status === 'queued') return 1;
			if (status === 'applied') return 2;
			if (status === 'failed') return 3;
			if (status === 'cancelled') return 4;
			return 5;
		};

		return [...entries].sort((left, right) => {
			const rankDiff = rank(left.status) - rank(right.status);
			if (rankDiff !== 0) return rankDiff;
			if (left.status === 'queued' && right.status === 'queued') {
				return left.startedAt.localeCompare(right.startedAt);
			}
			return right.startedAt.localeCompare(left.startedAt);
		});
	}

	private upsertTaskEntry(entry: AiTaskEntry): void {
		if (!TASK_VISIBLE_STATUSES.includes(entry.status)) {
			this.taskEntries = this.taskEntries.filter((current) => current.assetId !== entry.assetId);
			return;
		}
		if (this.dismissedTaskRunIds.has(entry.runId)) {
			return;
		}

		const nextEntries = this.taskEntries.filter((current) => current.assetId !== entry.assetId);
		nextEntries.push(entry);
		this.taskEntries = this.sortTaskEntries(nextEntries);
	}

	private removeTaskEntryByAssetId(assetId: string): void {
		this.taskEntries = this.taskEntries.filter((entry) => entry.assetId !== assetId);
	}

	private removeTaskEntryByRunId(runId: string): void {
		this.taskEntries = this.taskEntries.filter((entry) => entry.runId !== runId);
	}

	async dismissTaskEntry(runId: string): Promise<void> {
		const existing = this.taskEntries.find((entry) => entry.runId === runId);
		if (!existing) return;
		this.dismissedTaskRunIds.add(existing.runId);
		await storeService.setDismissedAiTaskRunIds([...this.dismissedTaskRunIds]);
		this.removeTaskEntryByRunId(runId);
	}

	private syncTaskEntryStatus(
		assetId: string,
		updates: Partial<Pick<AiTaskEntry, 'status' | 'errorMessage' | 'completedAt'>>
	): void {
		const existing = this.taskEntries.find((entry) => entry.assetId === assetId);
		if (!existing) return;
		this.upsertTaskEntry({
			...existing,
			status: updates.status ?? existing.status,
			errorMessage: updates.errorMessage ?? existing.errorMessage,
			completedAt: updates.completedAt ?? existing.completedAt
		});
	}

	private clearRunContext(
		assetId: string,
		options: {
			preserveEstimateBeforeApply?: boolean;
			preservePendingAppliedEstimate?: boolean;
		} = {}
	): void {
		const runId = this.assetRuns.get(assetId)?.runId;
		this.editorApplyStates.delete(assetId);
		if (!options.preservePendingAppliedEstimate) {
			this.pendingAppliedEstimates.delete(assetId);
		}
		if (!options.preserveEstimateBeforeApply) {
			this.estimateBeforeApplySnapshots.delete(assetId);
		}
		if (runId) {
			this.queuedRunContexts.delete(runId);
		}
	}

	private async loadQueuedRunExecutionContext(runId: string): Promise<QueuedRunExecutionContext> {
		const inMemoryContext = this.queuedRunContexts.get(runId);
		if (inMemoryContext) {
			return {
				...inMemoryContext,
				files: structuredClone(inMemoryContext.files)
			};
		}

		const [
			runtimeContractInput,
			projectContextInput,
			assetContextInput,
			workspaceKnowledgeContextInput,
			fileSnapshotInput,
			normalizedTableSnapshotInput,
			referenceContextInput,
			workflowRulesInput,
			outputContractInput,
			estimateContextSnapshotInput,
			promptContractInput
		] = await Promise.all([
			dbService.getAiRunInput(runId, 'runtime_contract'),
			dbService.getAiRunInput(runId, 'project_context'),
			dbService.getAiRunInput(runId, 'asset_execution_context'),
			dbService.getAiRunInput(runId, 'workspace_knowledge_context'),
			dbService.getAiRunInput(runId, 'asset_file_snapshot'),
			dbService.getAiRunInput(runId, 'normalized_table_snapshot'),
			dbService.getAiRunInput(runId, 'reference_context'),
			dbService.getAiRunInput(runId, 'workflow_rules'),
			dbService.getAiRunInput(runId, 'output_contract'),
			dbService.getAiRunInput(runId, 'estimate_context_snapshot'),
			dbService.getAiRunInput(runId, 'prompt_contract')
		]);

		const filePayload = isRecord(fileSnapshotInput?.payload)
			? fileSnapshotInput.payload.files
			: null;
		const runtimePayload = isRecord(runtimeContractInput?.payload)
			? runtimeContractInput.payload
			: null;
		const provider = isLocalAiProvider(runtimePayload?.provider as AiProvider)
			? (runtimePayload?.provider as AiProvider)
			: 'local_litert_lm';
		const modelId =
			typeof runtimePayload?.clientRuntimeId === 'string' &&
			runtimePayload.clientRuntimeId.length > 0
				? runtimePayload.clientRuntimeId
				: LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId;
		const workspaceKnowledgePayload = isRecord(workspaceKnowledgeContextInput?.payload)
			? workspaceKnowledgeContextInput.payload
			: null;
		if (
			!isRecord(projectContextInput?.payload) ||
			!isRecord(assetContextInput?.payload) ||
			!isAssetFileArray(filePayload) ||
			!isRecord(normalizedTableSnapshotInput?.payload) ||
			!isRecord(referenceContextInput?.payload) ||
			!isRecord(workflowRulesInput?.payload) ||
			!isRecord(outputContractInput?.payload) ||
			!isContextSnapshotValue(estimateContextSnapshotInput?.payload) ||
			!isPromptContractValue(promptContractInput?.payload)
		) {
			throw new Error('Queued AI run context is incomplete and cannot be resumed.');
		}

		return {
			provider,
			modelId,
			projectContext: projectContextInput.payload as unknown as ReturnType<
				typeof buildAiProjectContext
			>,
			assetContext: assetContextInput.payload as unknown as ReturnType<typeof buildAiAssetContext>,
			workspaceKnowledgeContext: isWorkspaceKnowledgeContextValue(workspaceKnowledgePayload)
				? workspaceKnowledgePayload
				: null,
			files: structuredClone(filePayload),
			normalizedTableSnapshot: normalizedTableSnapshotInput.payload,
			referenceContext: referenceContextInput.payload as unknown as ReturnType<
				typeof buildAiReferenceContext
			>,
			workflowRules: workflowRulesInput.payload as unknown as ReturnType<
				typeof buildAiWorkflowRules
			>,
			outputContract: outputContractInput.payload as unknown as ReturnType<
				typeof buildAiOutputContract
			>,
			estimateContextSnapshot: estimateContextSnapshotInput.payload,
			promptContract: promptContractInput.payload
		};
	}

	private async startQueuedRun(assetId: string, runId: string): Promise<void> {
		const currentRunState = this.getAssetRunState(assetId);
		const queuedContext = await this.loadQueuedRunExecutionContext(runId);
		const modelId = queuedContext.modelId;

		this.setAssetRunState(assetId, {
			runId,
			status: 'preprocessing',
			isCancelling: false,
			modelId,
			errorMessage: null,
			progressDetail: blankRunProgressDetail()
		});
		this.syncTaskEntryStatus(assetId, {
			status: 'preprocessing',
			errorMessage: null,
			completedAt: null
		});
		await dbService.updateAiRun(runId, {
			status: 'preprocessing',
			error_message: null,
			failed_at: null,
			cancelled_at: null
		});

		const preparedRun = await buildLocalPreparedRun(queuedContext.files);
		const fingerprint = await sha256AiPayload({
			assetId: queuedContext.assetContext.assetId,
			fileIds: queuedContext.files.map((file) => file.id),
			normalizedTableSnapshot: queuedContext.normalizedTableSnapshot,
			promptContract: queuedContext.promptContract
		});
		preparedRun.contextFingerprint = fingerprint;

		await dbService.addAiRunInput(await generateId(), runId, 'artifact_manifest', {
			artifacts: preparedRun.artifactManifest
		});
		await dbService.addAiRunInput(await generateId(), runId, 'artifact_bundle', {
			manifest: preparedRun.artifactManifest,
			progressDetail: preparedRun.progressDetail
		});
		await dbService.addAiRunInput(await generateId(), runId, 'preprocess_profile', {
			...preparedRun.preprocessProfile
		});
		await dbService.addAiRunInput(await generateId(), runId, 'preprocess_issues', {
			issues: preparedRun.issues
		});

		this.setAssetRunState(assetId, {
			runId,
			status: 'extracting',
			isCancelling: false,
			modelId,
			errorMessage: null,
			issues: preparedRun.issues,
			evidenceRefs: [],
			lastAppliedEstimate: currentRunState.lastAppliedEstimate,
			lastSavedApplySignature: currentRunState.lastSavedApplySignature,
			completedAt: currentRunState.completedAt,
			progressDetail: preparedRun.progressDetail
		});
		this.syncTaskEntryStatus(assetId, {
			status: 'extracting',
			errorMessage: null,
			completedAt: null
		});
		await dbService.updateAiRun(runId, {
			status: 'extracting',
			error_message: null,
			failed_at: null,
			cancelled_at: null
		});

		if (isLocalAiProvider(queuedContext.provider)) {
			this.setAssetRunState(assetId, {
				runId,
				status: 'drafting',
				isCancelling: false,
				modelId,
				errorMessage: null,
				issues: preparedRun.issues,
				evidenceRefs: [],
				lastAppliedEstimate: currentRunState.lastAppliedEstimate,
				lastSavedApplySignature: currentRunState.lastSavedApplySignature,
				completedAt: null,
				progressDetail: {
					...preparedRun.progressDetail,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					currentArtifactName: null,
					draftSubphase: 'composition'
				}
			});
			this.syncTaskEntryStatus(assetId, {
				status: 'drafting',
				errorMessage: null,
				completedAt: null
			});
			await dbService.updateAiRun(runId, {
				status: 'drafting'
			});

			let result: any; // eslint-disable-line @typescript-eslint/no-explicit-any
			try {
				result = await localAiService.runDraftRun({
					runId,
					projectContext: queuedContext.projectContext,
					assetContext: queuedContext.assetContext,
					workspaceKnowledgeContext: queuedContext.workspaceKnowledgeContext,
					preparedRun,
					referenceContext: queuedContext.referenceContext,
					workflowRules: queuedContext.workflowRules,
					outputContract: queuedContext.outputContract,
					normalizedTableSnapshot: queuedContext.normalizedTableSnapshot,
					estimateContextSnapshot: queuedContext.estimateContextSnapshot,
					promptContract: queuedContext.promptContract,
					runtimeStatus: this.localAiStatus,
					allowRasterImageCompletions: this.localAiStatus.supportsImageInputs,
					onProgress: (progress) => {
						const existing = this.getAssetRunState(assetId);
						this.setAssetRunState(assetId, {
							runId,
							status: progress.status,
							isCancelling: false,
							modelId,
							errorMessage: null,
							issues: preparedRun.issues,
							evidenceRefs: [],
							lastAppliedEstimate: currentRunState.lastAppliedEstimate,
							lastSavedApplySignature: currentRunState.lastSavedApplySignature,
							completedAt: null,
							progressDetail: {
								...existing.progressDetail,
								currentArtifactName:
									progress.currentArtifactName ?? existing.progressDetail.currentArtifactName,
								processedArtifactCount:
									progress.processedArtifactCount ?? existing.progressDetail.processedArtifactCount,
								usableArtifactCount:
									progress.usableArtifactCount ?? existing.progressDetail.usableArtifactCount,
								totalArtifactCount:
									progress.totalArtifactCount ?? existing.progressDetail.totalArtifactCount,
								supportedArtifactCount:
									progress.supportedArtifactCount ?? existing.progressDetail.supportedArtifactCount,
								unsupportedArtifactCount:
									progress.unsupportedArtifactCount ??
									existing.progressDetail.unsupportedArtifactCount,
								draftSubphase: progress.draftSubphase ?? existing.progressDetail.draftSubphase
							}
						});
						this.syncTaskEntryStatus(assetId, {
							status: progress.status,
							errorMessage: null,
							completedAt: null
						});
					}
				});
			} catch (error) {
				if (this.cancelledLocalRunIds.delete(runId)) {
					log.info('Ignored Kwantflow AI runtime error after cancellation', {
						assetId,
						runId,
						error
					});
					this.queuedRunContexts.delete(runId);
					void this.maybeStartNextQueuedRun();
					return;
				}
				throw error;
			}
			if (this.cancelledLocalRunIds.delete(runId)) {
				log.info('Dropped completed Kwantflow AI result because the run was already cancelled', {
					assetId,
					runId
				});
				this.queuedRunContexts.delete(runId);
				void this.maybeStartNextQueuedRun();
				return;
			}
			const completedAt = new Date().toISOString();
			try {
				await this.persistDraftResult(assetId, runId, result, completedAt);
			} catch (error) {
				await this.handleDraftApplyFailure(assetId, runId, error, completedAt);
				return;
			}
			log.info('Completed AI estimate draft from local runtime', {
				assetId,
				runId,
				modelId
			});
			this.queuedRunContexts.delete(runId);
			void this.maybeStartNextQueuedRun();
			return;
		}
	}

	private async maybeStartNextQueuedRun(): Promise<void> {
		await this.withRunStartLock(async () => {
			if (this.hasBlockingRunInFlight()) {
				return;
			}

			const nextQueued = this.queuedTaskEntries()[0];
			if (!nextQueued) {
				return;
			}

			try {
				await this.startQueuedRun(nextQueued.assetId, nextQueued.runId);
			} catch (error) {
				const message = normaliseAiFailureMessage(error) || 'AI drafting failed.';
				const failureKind = classifyAiFailure(error);
				const failedAt = new Date().toISOString();
				this.clearRunContext(nextQueued.assetId, {
					preserveEstimateBeforeApply: true
				});
				await dbService.addAiRunOutput(await generateId(), nextQueued.runId, 'failure_context', {
					kind: failureKind,
					stage: deriveRunFailureStage(this.getAssetRunState(nextQueued.assetId)),
					message
				});
				await dbService.updateAiRun(nextQueued.runId, {
					status: 'failed',
					failed_at: failedAt,
					error_message: message,
					failure_kind: failureKind,
					failure_stage: deriveRunFailureStage(this.getAssetRunState(nextQueued.assetId))
				});
				this.setAssetRunState(nextQueued.assetId, {
					runId: nextQueued.runId,
					status: 'failed',
					isCancelling: false,
					modelId: this.getAssetRunState(nextQueued.assetId).modelId ?? this.activeModelId,
					errorMessage: message,
					completedAt: failedAt
				});
				this.syncTaskEntryStatus(nextQueued.assetId, {
					status: 'failed',
					errorMessage: message,
					completedAt: failedAt
				});
				log.error('Failed to resume queued AI estimate draft run', {
					assetId: nextQueued.assetId,
					runId: nextQueued.runId,
					failureKind,
					error
				});
				void errorState.catchError(new Error(message), 'Resume queued AI drafting');
			}
		});

		if (!this.hasBlockingRunInFlight() && this.queuedTaskEntries().length > 0) {
			await this.maybeStartNextQueuedRun();
		}
	}

	private async persistDraftResult(
		assetId: string,
		runId: string,
		result: any, // eslint-disable-line @typescript-eslint/no-explicit-any
		completedAt: string
	): Promise<DraftedEstimateResult> {
		const currentRunState = this.getAssetRunState(assetId);
		const modelId =
			currentRunState.modelId ??
			this.activeModelId ??
			LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId;
		const contextSnapshotInput = await dbService.getAiRunInput(runId, 'estimate_context_snapshot');
		const contextSnapshotPayload = isRecord(contextSnapshotInput?.payload)
			? contextSnapshotInput.payload
			: null;
		if (!isContextSnapshotValue(contextSnapshotPayload)) {
			throw new Error('AI draft context could not be restored for auto-apply.');
		}

		const contextSnapshot = contextSnapshotPayload;
		const repairedResult = repairDraftRunResultHeuristicOutline(result);
		const normalisedDraft = normaliseDraftEstimateStructure(repairedResult.draft);
		const hasUsablePreparedEvidence =
			Array.isArray(repairedResult.extractions) &&
			repairedResult.extractions.some((extraction: unknown) => {
				if (!isRecord(extraction)) return false;
				if (
					extraction.extractionSource === 'unavailable' ||
					extraction.extractionSource === 'deterministic_filtered' ||
					extraction.runDisposition === 'irrelevant' ||
					extraction.estimatingUtility === 'none'
				) {
					return false;
				}
				return (
					(typeof extraction.summary === 'string' && extraction.summary.trim().length > 0) ||
					(Array.isArray(extraction.estimatingSignals) &&
						extraction.estimatingSignals.length > 0) ||
					(Array.isArray(extraction.candidateItems) && extraction.candidateItems.length > 0)
				);
			});
		if (hasUsablePreparedEvidence && normalisedDraft.takeoff_items.length === 0) {
			throw new Error(
				'AI drafting produced no takeoff items from usable prepared evidence. Nothing was applied to the editor.'
			);
		}
		const review = buildEstimateMappingReview({
			draft: normalisedDraft,
			contextSnapshot
		});
		review.issues = mergeAiIssues(repairedResult.issues ?? [], review.issues);
		review.reconciledDraft.issues = mergeAiIssues(
			normalisedDraft.issues,
			review.reconciledDraft.issues
		);
		const reconciledMatching = buildDraftMatchingFromReconciledEstimate({
			draft: review.reconciledDraft,
			contextSnapshot,
			issues: review.issues
		});
		const estimate = draftEstimateToEstimate(assetId, review.reconciledDraft);
		const terminalEvidenceFileIds = new Set(
			Array.isArray(repairedResult.evidenceCoverage?.units)
				? repairedResult.evidenceCoverage.units
						.filter((unit: unknown) => isRecord(unit) && typeof unit.fileId === 'string')
						.map((unit: Record<string, unknown>) => unit.fileId as string)
				: []
		);
		const usableEvidenceFileIds = new Set(
			Array.isArray(repairedResult.extractions)
				? repairedResult.extractions
						.filter((extraction: unknown) => {
							if (!isRecord(extraction)) return false;
							if (
								extraction.extractionSource === 'unavailable' ||
								extraction.extractionSource === 'deterministic_filtered' ||
								extraction.runDisposition === 'irrelevant' ||
								extraction.estimatingUtility === 'none'
							) {
								return false;
							}
							return typeof extraction.fileId === 'string';
						})
						.map((extraction: Record<string, unknown>) => extraction.fileId as string)
				: []
		);

		const extractionPromptVersion =
			result.promptContract?.extractionPromptVersion ?? AI_PROMPT_CONTRACT.extractionPromptVersion;

		await dbService.addAiRunOutput(
			await generateId(),
			runId,
			'artifact_extractions',
			{ extractions: repairedResult.extractions },
			{ contractVersion: extractionPromptVersion }
		);
		if (repairedResult.evidenceCoverage) {
			await dbService.addAiRunOutput(await generateId(), runId, 'evidence_coverage', {
				coverage: repairedResult.evidenceCoverage
			});
		}
		if (repairedResult.draftOutline) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_outline', {
				outline: repairedResult.draftOutline
			});
		}
		if (repairedResult.draftMatching || reconciledMatching.takeoff_items.length > 0) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_matching', {
				matching: reconciledMatching
			});
		}
		if ((repairedResult.draftStageMetrics ?? []).length > 0) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_stage_metrics', {
				stages: repairedResult.draftStageMetrics ?? []
			});
		}
		if ((repairedResult.draftAgentSteps ?? []).length > 0) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_agent_steps', {
				steps: repairedResult.draftAgentSteps
			});
		}
		if ((repairedResult.draftToolCalls ?? []).length > 0) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_tool_calls', {
				toolCalls: repairedResult.draftToolCalls
			});
		}
		if (repairedResult.draftAgentFinal) {
			await dbService.addAiRunOutput(await generateId(), runId, 'draft_agent_final', {
				result: repairedResult.draftAgentFinal
			});
		}
		await dbService.addAiRunOutput(await generateId(), runId, 'draft_estimate_raw', {
			draft: normalisedDraft,
			issues: repairedResult.issues
		});
		await dbService.addAiRunOutput(await generateId(), runId, 'draft_estimate', {
			draft: review.reconciledDraft,
			issues: review.issues
		});
		await dbService.addAiRunOutput(await generateId(), runId, 'mapping_validation', {
			review
		});
		await dbService.addAiRunOutput(await generateId(), runId, 'draft_evidence_coverage', {
			coverage: buildDraftEvidenceCoverage(review.reconciledDraft)
		});
		await dbService.addAiRunOutput(await generateId(), runId, 'finalised_draft_estimate', {
			draft: review.reconciledDraft,
			review,
			estimate
		});
		await dbService.addAiRunOutput(
			await generateId(),
			runId,
			'cache_metadata',
			repairedResult.cacheMetadata
		);
		await this.refreshLocalAiStatus({ suppressErrors: true });
		const runtimeExecutionContext = repairedResult.runtimeExecutionContext as unknown as Record<
			string,
			unknown
		>;
		const localRuntime =
			(runtimeExecutionContext.localRuntime as Record<string, unknown> | undefined) ?? null;
		const runtimeExecutionContextWithCurrentDiagnostics = localRuntime
			? {
					...runtimeExecutionContext,
					localRuntime: {
						...localRuntime,
						diagnostics: this.localAiStatus.diagnostics
					}
				}
			: runtimeExecutionContext;
		await dbService.addAiRunOutput(
			await generateId(),
			runId,
			'runtime_execution_context',
			runtimeExecutionContextWithCurrentDiagnostics
		);
		await dbService.replaceAiEvidenceRefs(runId, assetId, repairedResult.evidenceRefs);
		await dbService.addAiReviewEvent({
			id: await generateId(),
			run_id: runId,
			asset_id: assetId,
			event_type: 'draft_ready',
			event_payload: {
				issueCount: review.issues.length,
				takeoffItemCount: estimate.takeoff_items.length
			},
			created_at: completedAt
		});
		await dbService.updateAiRun(runId, {
			status: 'applied',
			completed_at: completedAt,
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: result.usage
		});

		this.setAssetRunState(assetId, {
			runId,
			status: 'applied',
			editorApplyState: 'pending_manual_apply',
			isCancelling: false,
			modelId,
			errorMessage: null,
			issues: review.issues,
			evidenceRefs: repairedResult.evidenceRefs,
			lastAppliedEstimate: structuredClone(estimate),
			lastSavedApplySignature: null,
			completedAt,
			progressDetail: {
				currentArtifactName: null,
				processedArtifactCount: terminalEvidenceFileIds.size,
				usableArtifactCount: usableEvidenceFileIds.size,
				artifactIssueCount: review.issues.length,
				totalArtifactCount:
					currentRunState.progressDetail.totalArtifactCount || result.artifactManifest.length,
				supportedArtifactCount:
					currentRunState.progressDetail.supportedArtifactCount || result.artifactManifest.length,
				unsupportedArtifactCount: currentRunState.progressDetail.unsupportedArtifactCount,
				failedEvidenceUnitCount: repairedResult.evidenceCoverage?.failedUnits ?? 0,
				omittedEvidenceUnitCount: repairedResult.evidenceCoverage?.omittedUnits ?? 0
			}
		});
		this.appliedRunIds.set(assetId, runId);
		this.editorApplyStates.set(assetId, 'pending_manual_apply');
		this.pendingAppliedEstimates.set(assetId, {
			runId,
			modelId,
			estimate,
			contextSnapshot,
			issues: review.issues,
			evidenceRefs: repairedResult.evidenceRefs,
			completedAt
		});
		this.syncTaskEntryStatus(assetId, {
			status: 'applied',
			errorMessage: null,
			completedAt
		});
		toast.success(`AI draft ready for ${contextSnapshot.asset_context.assetName}`);

		return {
			runId,
			modelId,
			estimate,
			contextSnapshot,
			issues: review.issues,
			evidenceRefs: repairedResult.evidenceRefs,
			completedAt
		};
	}

	private async handleDraftApplyFailure(
		assetId: string,
		runId: string,
		error: unknown,
		failedAt: string
	): Promise<void> {
		const currentRunState = this.getAssetRunState(assetId);
		const message = normaliseAiFailureMessage(error) || 'AI drafting failed during local apply.';
		const failureKind = classifyAiFailure(error);

		this.clearRunContext(assetId, {
			preserveEstimateBeforeApply: true
		});
		await dbService.addAiRunOutput(await generateId(), runId, 'failure_context', {
			kind: failureKind,
			stage: 'apply',
			message
		});
		await dbService.updateAiRun(runId, {
			status: 'failed',
			failed_at: failedAt,
			error_message: message,
			failure_kind: failureKind,
			failure_stage: 'apply'
		});
		this.setAssetRunState(assetId, {
			runId,
			status: 'failed',
			isCancelling: false,
			modelId: currentRunState.modelId,
			errorMessage: message,
			issues: currentRunState.issues,
			evidenceRefs: currentRunState.evidenceRefs,
			lastAppliedEstimate: currentRunState.lastAppliedEstimate,
			lastSavedApplySignature: currentRunState.lastSavedApplySignature,
			completedAt: failedAt,
			progressDetail: currentRunState.progressDetail
		});
		this.syncTaskEntryStatus(assetId, {
			status: 'failed',
			errorMessage: message,
			completedAt: failedAt
		});
		await this.hydrateTaskEntries();
		log.error('Failed to auto-apply AI draft locally', {
			assetId,
			runId,
			failureKind,
			error
		});
		void errorState.catchError(new Error(message), 'Draft estimate with AI');
		void this.maybeStartNextQueuedRun();
	}

	async hydrateTaskEntries(): Promise<void> {
		if (!isTauri()) {
			this.taskEntries = [];
			return;
		}

		try {
			const summaries = await dbService.listLatestAiTaskSummaries();
			const visibleRunIds = new Set(summaries.map((summary) => summary.run_id));
			const nextDismissedRunIds = [...this.dismissedTaskRunIds].filter((runId) =>
				visibleRunIds.has(runId)
			);
			if (nextDismissedRunIds.length !== this.dismissedTaskRunIds.size) {
				this.dismissedTaskRunIds = new SvelteSet(nextDismissedRunIds);
				await storeService.setDismissedAiTaskRunIds(nextDismissedRunIds);
			}
			this.taskEntries = this.sortTaskEntries(
				summaries
					.filter(
						(summary) =>
							TASK_VISIBLE_STATUSES.includes(summary.status) &&
							!this.dismissedTaskRunIds.has(summary.run_id)
					)
					.map((summary) => this.mapTaskSummary(summary))
			);
			for (const summary of summaries) {
				if (
					ACTIVE_RUN_STATUSES.includes(summary.status) ||
					summary.status === 'applied' ||
					isDraftRecoveryStatus(summary.status)
				) {
					await this.hydrateLatestRunForAsset(summary.asset_id);
				}
			}
			log.info('Hydrated AI task entries', {
				taskCount: this.taskEntries.length
			});
		} catch (error) {
			log.error('Failed to hydrate AI task entries', { error });
			await errorState.catchError(error, 'Hydrate AI task entries');
		}
	}

	private mapTaskSummary(summary: AiTaskSummary): AiTaskEntry {
		return {
			runId: summary.run_id,
			assetId: summary.asset_id,
			assetName: summary.asset_name,
			projectId: summary.project_id,
			projectLabel: summary.project_rfq_number ?? null,
			status: summary.status,
			errorMessage: summary.error_message ?? null,
			startedAt: summary.started_at,
			completedAt: summary.completed_at ?? summary.failed_at ?? summary.cancelled_at ?? null
		};
	}

	getDraftingAvailability(enabled: boolean): AiDraftingAvailability {
		let unavailableReason: string | null = null;
		const localRuntimeReady = this.isLocalModelAvailable();
		if (!enabled) {
			unavailableReason = 'AI is turned off in Settings.';
		} else if (
			this.localAiStatus.installState === 'repair_needed' ||
			this.localAiStatus.installState === 'failed'
		) {
			unavailableReason = 'Kwantflow AI needs attention in Settings before it can run.';
		} else if (!this.localAiStatus.runtimeAvailable) {
			unavailableReason = 'Kwantflow AI is not available on this device yet.';
		} else if (!['installed', 'ready'].includes(this.localAiStatus.installState)) {
			unavailableReason = 'Download Kwantflow AI in Settings to draft estimates on this device.';
		} else if (!localRuntimeReady) {
			unavailableReason = 'Preparing Kwantflow AI.';
		} else if (this.isAssistantRunning) {
			unavailableReason = 'Kwantflow AI is currently busy with Ask Kwantflow.';
		}

		return {
			enabled,
			hasInternet: this.hasInternet,
			localAiInstallState: this.localAiStatus.installState,
			localAiModelReady: this.localAiStatus.modelReady,
			hasActiveModel: localRuntimeReady,
			canDraftEstimate: unavailableReason === null,
			unavailableReason
		};
	}

	isRunActive(assetId: string): boolean {
		const status = this.getAssetRunState(assetId).status;
		return status !== 'idle' && ACTIVE_RUN_STATUSES.includes(status);
	}

	async cancelRunForAsset(assetId: string): Promise<boolean> {
		const current = this.getAssetRunState(assetId);
		if (!current.runId || !this.isRunActive(assetId) || current.isCancelling) {
			log.debug('Skipped AI run cancellation because no active cancellable run exists', {
				assetId,
				runId: current.runId,
				status: current.status,
				isCancelling: current.isCancelling
			});
			return false;
		}

		if (current.status === 'queued') {
			const cancelledAt = new Date().toISOString();
			await dbService.updateAiRun(current.runId, {
				status: 'cancelled',
				cancelled_at: cancelledAt,
				error_message: null
			});
			this.setAssetRunState(assetId, {
				status: 'cancelled',
				isCancelling: false,
				completedAt: cancelledAt
			});
			this.syncTaskEntryStatus(assetId, {
				status: 'cancelled',
				errorMessage: null,
				completedAt: cancelledAt
			});
			this.clearRunContext(assetId, {
				preserveEstimateBeforeApply: true
			});
			log.info('Cancelled queued AI run for asset', {
				assetId,
				runId: current.runId
			});
			void this.maybeStartNextQueuedRun();
			return true;
		}

		if (current.modelId === LOCAL_LITERT_LM_RUNTIME_CONTRACT.clientRuntimeId) {
			log.info('Cancelling Kwantflow AI run for asset', {
				assetId,
				runId: current.runId,
				status: current.status
			});
			this.cancelledLocalRunIds.add(current.runId);
			this.setAssetRunState(assetId, {
				isCancelling: true,
				errorMessage: null
			});

			try {
				this.localAiStatus = await localAiService.cancelActiveRun();
				const cancelledAt = new Date().toISOString();
				this.clearRunContext(assetId, {
					preserveEstimateBeforeApply: true
				});
				await dbService.updateAiRun(current.runId, {
					status: 'cancelled',
					cancelled_at: cancelledAt,
					error_message: null
				});
				this.setAssetRunState(assetId, {
					runId: current.runId,
					status: 'cancelled',
					isCancelling: false,
					completedAt: cancelledAt
				});
				this.syncTaskEntryStatus(assetId, {
					status: 'cancelled',
					errorMessage: null,
					completedAt: cancelledAt
				});
				log.info('Cancelled Kwantflow AI run for asset', {
					assetId,
					runId: current.runId
				});
				void this.maybeStartNextQueuedRun();
				return true;
			} catch (error) {
				this.cancelledLocalRunIds.delete(current.runId);
				this.setAssetRunState(assetId, {
					isCancelling: false
				});
				log.error('Failed to cancel Kwantflow AI run for asset', {
					assetId,
					runId: current.runId,
					error
				});
				await errorState.catchError(error, 'Cancel AI drafting');
				return false;
			}
		}

		log.warn('Cannot cancel AI run for asset — unsupported model or runtime', {
			assetId,
			runId: current.runId,
			status: current.status,
			modelId: current.modelId
		});
		return false;
	}

	private setAssetRunState(assetId: string, updates: Partial<AssetAiRunState>): void {
		const current = this.getAssetRunState(assetId);
		this.assetRuns.set(assetId, { ...current, ...updates });
	}

	private resetAssetRunState(assetId: string): void {
		this.assetRuns.delete(assetId);
		this.appliedRunIds.delete(assetId);
		this.clearRunContext(assetId);
		this.removeTaskEntryByAssetId(assetId);
	}

	async hydrateLatestRunForAsset(assetId: string): Promise<void> {
		if (!isTauri()) return;

		try {
			const run = await dbService.getLatestAiRunForAsset(assetId);
			if (!run) {
				this.resetAssetRunState(assetId);
				log.info('No persisted AI run found for asset', { assetId });
				return;
			}

			const estimateBeforeApplyInput = await dbService.getAiRunInput(
				run.id,
				'estimate_before_apply'
			);
			const executionContextInput = await dbService.getAiRunInput(run.id, 'execution_context');
			const contextSnapshotInput = await dbService.getAiRunInput(
				run.id,
				'estimate_context_snapshot'
			);
			const artifactManifestInput = await dbService.getAiRunInput(run.id, 'artifact_manifest');
			const preprocessIssuesInput = await dbService.getAiRunInput(run.id, 'preprocess_issues');
			const draftOutput =
				(await dbService.getAiRunOutput(run.id, 'finalised_draft_estimate')) ??
				(await dbService.getAiRunOutput(run.id, 'draft_estimate'));
			const mappingReviewOutput = await dbService.getAiRunOutput(run.id, 'mapping_validation');
			const evidenceCoverageOutput = await dbService.getAiRunOutput(run.id, 'evidence_coverage');
			const evidenceRefs = await dbService.getAiEvidenceRefs(run.id);
			const reviewEvents = await dbService.getAiReviewEvents(run.id);
			const payload = draftOutput?.payload as Record<string, unknown> | undefined;
			const contextSnapshotPayload = isRecord(contextSnapshotInput?.payload)
				? contextSnapshotInput.payload
				: undefined;
			const artifactManifestPayload = isRecord(artifactManifestInput?.payload)
				? artifactManifestInput.payload
				: undefined;
			const preprocessIssuesPayload = isRecord(preprocessIssuesInput?.payload)
				? preprocessIssuesInput.payload
				: undefined;
			const evidenceCoveragePayload = isRecord(evidenceCoverageOutput?.payload)
				? evidenceCoverageOutput.payload
				: undefined;
			const estimateBeforeApplyPayload = isRecord(estimateBeforeApplyInput?.payload)
				? estimateBeforeApplyInput.payload.estimate
				: undefined;
			const executionContextPayload = isRunExecutionContextValue(executionContextInput?.payload)
				? executionContextInput.payload
				: null;
			const mappingReviewPayload = isRecord(mappingReviewOutput?.payload)
				? mappingReviewOutput.payload.review
				: undefined;
			const issues = isAiIssueArray(payload?.issues)
				? payload.issues
				: isRecord(mappingReviewPayload) && isAiIssueArray(mappingReviewPayload.issues)
					? mappingReviewPayload.issues
					: [];
			const estimateBeforeApply = isEstimateValue(estimateBeforeApplyPayload)
				? structuredClone(estimateBeforeApplyPayload)
				: null;
			const baselineEstimate =
				payload?.estimate && typeof payload.estimate === 'object'
					? (payload.estimate as Estimate)
					: payload?.draft && typeof payload.draft === 'object'
						? draftEstimateToEstimate(assetId, payload.draft as never)
						: null;
			const lastSavedApplySignature = extractSavedApplySignature(reviewEvents);
			const latestApplyDisposition = extractLatestApplyDisposition(reviewEvents);
			const contextSnapshot = isContextSnapshotValue(contextSnapshotPayload)
				? contextSnapshotPayload
				: null;
			const isLocalRun = isLocalAiProvider(run.provider);
			if (run.status === 'applied' && baselineEstimate) {
				this.appliedRunIds.set(assetId, run.id);
			} else {
				this.appliedRunIds.delete(assetId);
			}

			const hasPendingAppliedWorkingCopy =
				run.status === 'applied' &&
				latestApplyDisposition === 'pending' &&
				baselineEstimate !== null;
			const hasRecoverableBaseline =
				estimateBeforeApply !== null &&
				(isTerminalRecoveryStatus(run.status) ||
					ACTIVE_RUN_STATUSES.includes(run.status) ||
					hasPendingAppliedWorkingCopy);

			if (hasRecoverableBaseline && estimateBeforeApply) {
				this.estimateBeforeApplySnapshots.set(assetId, estimateBeforeApply);
			} else {
				this.estimateBeforeApplySnapshots.delete(assetId);
			}

			if (hasPendingAppliedWorkingCopy && baselineEstimate && contextSnapshot) {
				this.pendingAppliedEstimates.set(assetId, {
					runId: run.id,
					modelId: run.model_id,
					estimate: structuredClone(baselineEstimate),
					contextSnapshot,
					issues,
					evidenceRefs,
					completedAt: run.completed_at ?? new Date().toISOString()
				});
			} else {
				this.pendingAppliedEstimates.delete(assetId);
			}

			this.setAssetRunState(assetId, {
				runId: run.id,
				status: run.status,
				editorApplyState: hasPendingAppliedWorkingCopy ? 'pending_manual_apply' : 'none',
				isCancelling: false,
				modelId: run.model_id,
				errorMessage: run.error_message,
				issues,
				evidenceRefs,
				lastAppliedEstimate: baselineEstimate,
				lastSavedApplySignature,
				completedAt: run.completed_at,
				progressDetail: buildHydratedProgressDetail({
					runStatus: run.status,
					artifactManifestPayload,
					preprocessIssuesPayload,
					evidenceCoveragePayload
				})
			});
			if (
				run.status === 'applied' &&
				!hasPendingAppliedWorkingCopy &&
				(latestApplyDisposition === 'reverted' || latestApplyDisposition === 'saved')
			) {
				this.resetAssetRunState(assetId);
				log.info('Hydrated settled AI run without pending working copy; clearing UI state', {
					assetId,
					runId: run.id,
					latestApplyDisposition
				});
				return;
			}

			if (isLocalRun && isLocalActiveRunStatus(run.status)) {
				const hasRecoveredDraftOutput = draftOutput !== null;
				const activeRunRecoveryMode = classifyHydratedActiveRunRecovery({
					provider: run.provider,
					hasRecoveredDraftOutput,
					executionContext: executionContextPayload,
					currentFrontendSessionId: this.frontendSessionId
				});
				const localRunHydrationStale = isHydratedActiveRunStale(
					run.updated_at,
					LOCAL_HYDRATION_STALE_AFTER_MS
				);
				if (
					activeRunRecoveryMode === 'fail_as_interrupted' ||
					(!hasRecoveredDraftOutput && localRunHydrationStale)
				) {
					const failedAt = new Date().toISOString();
					const message =
						'This AI draft was interrupted before it finished. Rerun AI or keep estimating manually.';
					this.clearRunContext(assetId, {
						preserveEstimateBeforeApply: true
					});
					try {
						await localAiService.cancelActiveRun();
					} catch (cancelError) {
						log.warn('Failed to stop orphaned Kwantflow AI runtime during hydration recovery', {
							assetId,
							runId: run.id,
							cancelError
						});
					}
					await dbService.addAiRunOutput(await generateId(), run.id, 'failure_context', {
						kind:
							activeRunRecoveryMode === 'fail_as_interrupted'
								? 'reload_interrupted'
								: 'interrupted',
						stage: 'interrupted',
						message,
						runStatus: run.status,
						recoveredDuringHydration: true,
						frontendSessionId: this.frontendSessionId,
						persistedFrontendSessionId: executionContextPayload?.frontendSessionId ?? null
					});
					await dbService.updateAiRun(run.id, {
						status: 'failed',
						failed_at: failedAt,
						error_message: message
					});
					this.setAssetRunState(assetId, {
						runId: run.id,
						status: 'failed',
						isCancelling: false,
						modelId: run.model_id,
						errorMessage: message,
						completedAt: failedAt,
						progressDetail: buildHydratedProgressDetail({
							runStatus: 'failed',
							artifactManifestPayload,
							preprocessIssuesPayload,
							evidenceCoveragePayload
						})
					});
					this.syncTaskEntryStatus(assetId, {
						status: 'failed',
						errorMessage: message,
						completedAt: failedAt
					});
					log.warn('Recovered interrupted Kwantflow AI run during hydration', {
						assetId,
						runId: run.id,
						updatedAt: run.updated_at,
						activeRunRecoveryMode,
						persistedFrontendSessionId: executionContextPayload?.frontendSessionId ?? null,
						currentFrontendSessionId: this.frontendSessionId
					});
					return;
				}
				if (!hasRecoveredDraftOutput) {
					log.info('Kept fresh Kwantflow AI run active during hydration', {
						assetId,
						runId: run.id,
						status: run.status,
						updatedAt: run.updated_at
					});
					return;
				}
			}
			log.info('Hydrated latest AI run for asset', {
				assetId,
				runId: run.id,
				status: run.status
			});
		} catch (error) {
			log.error('Failed to hydrate latest AI run for asset', { assetId, error });
			await errorState.catchError(error, 'Hydrate AI run state');
		}
	}

	async draftEstimateForAsset(
		payload: DraftEstimatePayload
	): Promise<DraftedEstimateResult | null> {
		let runId: string | null = null;
		const runtimeContract = LOCAL_LITERT_LM_RUNTIME_CONTRACT;
		const provider: AiProvider = 'local_litert_lm';
		const modelId = runtimeContract.clientRuntimeId;
		let previousRunState = this.getAssetRunState(payload.asset.id);
		const promptContract = { ...AI_PROMPT_CONTRACT };
		let currentStage: AiRunStatus = 'queued';

		try {
			if (this.startingAssetIds.has(payload.asset.id)) {
				log.info('Skipped duplicate AI draft request during asset run startup', {
					assetId: payload.asset.id
				});
				return null;
			}
			this.startingAssetIds.add(payload.asset.id);
			log.info('Starting AI estimate draft', {
				assetId: payload.asset.id,
				fileCount: payload.files.length,
				frontendSessionId: this.frontendSessionId
			});
			this.syncInternetStatus();
			await this.refreshLocalAiStatus({ suppressErrors: true });

			if (!modelId) {
				throw new Error('Kwantflow AI is not fully configured for this workspace yet.');
			}

			const baseAvailability = this.getDraftingAvailability(true);
			if (!baseAvailability.canDraftEstimate) {
				throw new Error(baseAvailability.unavailableReason ?? 'AI drafting is not available.');
			}

			const fileStatuses = await resolveEstimateAiFileEligibilities(payload.files, {
				supportsImageInputs: isLocalAiProvider(provider)
					? ['installed', 'ready'].includes(this.localAiStatus.installState)
						? this.localAiStatus.supportsImageInputs
						: false
					: true
			});
			const fileSummary = summariseEstimateAiFileEligibilities(fileStatuses);
			if (!fileSummary.hasEligibleFiles) {
				throw new Error(
					payload.files.length === 0
						? 'Add a supported asset file to draft with AI.'
						: 'This asset does not have a supported file for AI drafting yet.'
				);
			}

			await this.withRunStartLock(async () => {
				previousRunState = this.getAssetRunState(payload.asset.id);
				if (previousRunState.isCancelling || this.isRunActive(payload.asset.id)) {
					log.info('Skipped duplicate AI draft request for active asset run', {
						assetId: payload.asset.id,
						runId: previousRunState.runId,
						status: previousRunState.status,
						isCancelling: previousRunState.isCancelling
					});
					return;
				}

				const shouldQueue = this.hasBlockingRunInFlight();

				runId = await generateId();
				log.info('Created AI run context for estimate draft', {
					assetId: payload.asset.id,
					runId
				});
				const startedAt = new Date().toISOString();

				await dbService.createAiRun({
					id: runId,
					asset_id: payload.asset.id,
					provider,
					model_id: modelId,
					status: 'queued',
					trigger_source: 'asset_editor',
					started_at: startedAt,
					completed_at: null,
					failed_at: null,
					cancelled_at: null,
					error_message: null,
					usage: {},
					created_at: startedAt,
					updated_at: startedAt
				});
				this.estimateBeforeApplySnapshots.set(
					payload.asset.id,
					structuredClone(payload.currentEstimate)
				);
				this.pendingAppliedEstimates.delete(payload.asset.id);
				this.setAssetRunState(payload.asset.id, {
					runId,
					status: 'queued',
					isCancelling: false,
					modelId,
					errorMessage: null,
					issues: [],
					evidenceRefs: [],
					lastAppliedEstimate: previousRunState.lastAppliedEstimate,
					lastSavedApplySignature: previousRunState.lastSavedApplySignature,
					completedAt: previousRunState.completedAt
				});
				this.upsertTaskEntry({
					runId,
					assetId: payload.asset.id,
					assetName: payload.asset.display_name,
					projectId: payload.asset.project_id,
					projectLabel: payload.project.rfqNumber ?? payload.project.projectName,
					status: 'queued',
					errorMessage: null,
					startedAt,
					completedAt: null
				});

				const projectContext = buildAiProjectContext({
					projectId: payload.project.id,
					projectName: payload.project.projectName,
					rfqNumber: payload.project.rfqNumber,
					content: payload.project.content,
					note: payload.project.note,
					receivedDate: payload.project.receivedDate,
					submissionDeadlineAt: payload.project.submissionDeadlineAt,
					estimatorName: payload.project.estimatorName,
					customerTenderReference: payload.project.customerTenderReference,
					addendumLabel: payload.project.addendumLabel,
					addendumDate: payload.project.addendumDate,
					addendumNotes: payload.project.addendumNotes,
					siteAddress: payload.project.siteAddress,
					deliveryAddress: payload.project.deliveryAddress
				});
				await dbService.addAiRunInput(await generateId(), runId, 'asset_context', {
					assetId: payload.asset.id,
					assetName: payload.asset.display_name,
					projectId: payload.project.id,
					projectName: payload.project.projectName,
					rfqNumber: payload.project.rfqNumber,
					fileIds: payload.files.map((file) => file.id)
				});
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'project_context',
					toAiPayloadRecord(projectContext)
				);
				await dbService.addAiRunInput(await generateId(), runId, 'asset_file_snapshot', {
					files: payload.files
				});
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'table_snapshot',
					payload.tableSnapshot
				);
				const normalizedTableSnapshot = normaliseAiTableSnapshot(payload.tableSnapshot);
				await dbService.updateAiRun(runId, {
					prompt_contract_version: `${promptContract.systemInstructionVersion}/${promptContract.extractionPromptVersion}/${promptContract.draftPromptVersion}`,
					context_fingerprint: await sha256AiPayload({
						assetId: payload.asset.id,
						fileIds: payload.files.map((file) => file.id),
						normalizedTableSnapshot,
						promptContract
					})
				});
				const contextSnapshot = buildAiEstimateContextSnapshot({
					assetId: payload.asset.id,
					assetName: payload.asset.display_name,
					projectName: payload.project.projectName,
					tableSnapshot: payload.tableSnapshot,
					currentEstimate: payload.currentEstimate,
					savedEstimate: payload.savedEstimate ?? null
				});
				const assetContext = buildAiAssetContext({
					assetId: payload.asset.id,
					assetName: payload.asset.display_name,
					currentEstimate: payload.currentEstimate,
					savedEstimate: payload.savedEstimate ?? null,
					contextSnapshot
				});
				const workspaceKnowledgeContext = this.buildWorkspaceKnowledgeContext();
				await dbService.addAiRunInput(await generateId(), runId, 'prompt_contract', {
					...promptContract
				});
				await dbService.addAiRunInput(await generateId(), runId, 'runtime_contract', {
					provider,
					kernelContractVersion: runtimeContract.version,
					clientRuntimeId: runtimeContract.clientRuntimeId,
					runtimeKind: isLocalAiProvider(provider) ? this.localAiStatus.runtimeKind : undefined
				});
				await dbService.addAiRunInput(await generateId(), runId, 'execution_context', {
					...this.buildRunExecutionContext({
						provider,
						clientRuntimeId: runtimeContract.clientRuntimeId,
						runtimeKind: isLocalAiProvider(provider) ? this.localAiStatus.runtimeKind : undefined
					})
				});
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'asset_execution_context',
					toAiPayloadRecord(assetContext)
				);
				if (workspaceKnowledgeContext) {
					await dbService.addAiRunInput(
						await generateId(),
						runId,
						'workspace_knowledge_context',
						workspaceKnowledgeContext as unknown as Record<string, unknown>
					);
				}
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'normalized_table_snapshot',
					normalizedTableSnapshot
				);
				const referenceContext = buildAiReferenceContext(normalizedTableSnapshot, {
					currentEstimate: payload.currentEstimate,
					savedEstimate: payload.savedEstimate ?? null
				});
				const workflowRules = buildAiWorkflowRules();
				const outputContract = buildAiOutputContract();
				this.queuedRunContexts.set(runId, {
					provider,
					modelId,
					projectContext,
					assetContext,
					workspaceKnowledgeContext,
					files: structuredClone(payload.files),
					normalizedTableSnapshot,
					referenceContext,
					workflowRules,
					outputContract,
					estimateContextSnapshot: contextSnapshot,
					promptContract
				});
				await dbService.addAiRunInput(await generateId(), runId, 'reference_context', {
					...referenceContext
				});
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'workflow_rules',
					toAiPayloadRecord(workflowRules)
				);
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'output_contract',
					toAiPayloadRecord(outputContract)
				);
				await dbService.addAiRunInput(
					await generateId(),
					runId,
					'estimate_context_snapshot',
					contextSnapshot as unknown as Record<string, unknown>
				);
				await dbService.addAiRunInput(await generateId(), runId, 'estimate_before_apply', {
					estimate: payload.currentEstimate
				});
				if (shouldQueue) {
					log.info('Queued AI estimate draft run behind an active workspace run', {
						assetId: payload.asset.id,
						runId
					});
					return;
				}

				currentStage = 'preprocessing';
				await this.startQueuedRun(payload.asset.id, runId);
			});
			return null;
		} catch (error) {
			const message = normaliseAiFailureMessage(error) || 'AI drafting failed.';
			const failureKind = classifyAiFailure(error);
			const activeFailureStage =
				error instanceof AiPreprocessFailure
					? currentStage
					: deriveRunFailureStage(this.getAssetRunState(payload.asset.id));
			const preprocessIssues =
				error instanceof AiPreprocessFailure ? error.issues : previousRunState.issues;
			const preprocessProgressDetail =
				error instanceof AiPreprocessFailure
					? error.progressDetail
					: previousRunState.progressDetail;
			this.clearRunContext(payload.asset.id, {
				preserveEstimateBeforeApply: Boolean(runId)
			});
			if (runId) {
				try {
					if (error instanceof AiPreprocessFailure) {
						await dbService.addAiRunInput(await generateId(), runId, 'artifact_manifest', {
							artifacts: error.artifactManifest
						});
						await dbService.addAiRunInput(await generateId(), runId, 'preprocess_issues', {
							issues: error.issues
						});
					}
					await dbService.addAiRunOutput(await generateId(), runId, 'failure_context', {
						kind: failureKind,
						stage: activeFailureStage,
						message
					});
					await dbService.updateAiRun(runId, {
						status: 'failed',
						failed_at: new Date().toISOString(),
						error_message: message,
						failure_kind: failureKind,
						failure_stage: activeFailureStage
					});
				} catch (cleanupError) {
					log.warn('Cleanup DB write after AI draft failure skipped (run may not exist in DB)', {
						runId,
						assetId: payload.asset.id,
						failureKind,
						cleanupError:
							cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
					});
				}
			}
			this.setAssetRunState(payload.asset.id, {
				runId,
				status: 'failed',
				isCancelling: false,
				modelId,
				errorMessage: message,
				issues: preprocessIssues,
				evidenceRefs: previousRunState.evidenceRefs,
				lastAppliedEstimate: previousRunState.lastAppliedEstimate,
				lastSavedApplySignature: previousRunState.lastSavedApplySignature,
				completedAt: previousRunState.completedAt,
				progressDetail: preprocessProgressDetail
			});
			this.syncTaskEntryStatus(payload.asset.id, {
				status: 'failed',
				errorMessage: message,
				completedAt: new Date().toISOString()
			});
			log.error('AI estimate draft failed', {
				assetId: payload.asset.id,
				runId,
				failureKind,
				message
			});
			await errorState.catchError(
				error instanceof Error ? new Error(message) : new Error(message),
				'Draft estimate with AI'
			);
			return null;
		} finally {
			this.startingAssetIds.delete(payload.asset.id);
		}
	}

	async clearAssetRunForEstimateReset(assetId: string): Promise<void> {
		const runId = this.getAssetRunState(assetId).runId ?? this.appliedRunIds.get(assetId);
		if (!runId) {
			this.resetAssetRunState(assetId);
			return;
		}

		try {
			await dbService.addAiReviewEvent({
				id: await generateId(),
				run_id: runId,
				asset_id: assetId,
				event_type: 'estimate_reset',
				event_payload: {},
				created_at: new Date().toISOString()
			});
			this.resetAssetRunState(assetId);
			log.info('Cleared AI run state after estimate reset', {
				assetId,
				runId
			});
		} catch (error) {
			log.error('Failed to record AI estimate reset event', {
				assetId,
				runId,
				error
			});
			await errorState.catchError(error, 'Reset AI estimate state');
		}
	}

	async revertAutoAppliedEstimate(assetId: string): Promise<void> {
		const runId = this.appliedRunIds.get(assetId);
		if (!runId || !this.hasPendingAppliedEstimate(assetId)) {
			return;
		}

		try {
			await dbService.addAiReviewEvent({
				id: await generateId(),
				run_id: runId,
				asset_id: assetId,
				event_type: 'reverted_before_save',
				event_payload: {},
				created_at: new Date().toISOString()
			});
			this.resetAssetRunState(assetId);
			log.info('Reverted auto-applied AI estimate', {
				assetId,
				runId
			});
		} catch (error) {
			log.error('Failed to record AI estimate revert', {
				assetId,
				runId,
				error
			});
			await errorState.catchError(error, 'Revert AI estimate');
		}
	}

	markPendingEstimateAppliedToEditor(assetId: string): void {
		const current = this.getAssetRunState(assetId);
		if (!current.runId) return;
		this.editorApplyStates.set(assetId, 'applied_to_editor');
		this.setAssetRunState(assetId, {
			...current,
			editorApplyState: 'applied_to_editor'
		});
	}

	markPendingEstimateAwaitingManualApply(assetId: string): void {
		const current = this.getAssetRunState(assetId);
		if (!current.runId) return;
		this.editorApplyStates.set(assetId, 'pending_manual_apply');
		this.setAssetRunState(assetId, {
			...current,
			editorApplyState: 'pending_manual_apply'
		});
	}

	async recordEstimateSaved(assetId: string, estimate: Estimate): Promise<void> {
		const currentRunState = this.getAssetRunState(assetId);
		const baseline = currentRunState.lastAppliedEstimate;
		const runId = this.appliedRunIds.get(assetId);
		const hadPendingAiEstimate = this.hasPendingAppliedEstimate(assetId) || Boolean(runId);
		if (!baseline || !runId) {
			if (hadPendingAiEstimate) {
				this.resetAssetRunState(assetId);
			}
			return;
		}

		const estimateSignature = buildEstimateApplySignature(estimate);
		if (estimateSignature === currentRunState.lastSavedApplySignature) {
			this.resetAssetRunState(assetId);
			return;
		}

		try {
			const overrides = buildAiOverrideEvents({
				runId,
				assetId,
				baseline,
				current: estimate
			});

			await dbService.addAiOverrideEvents(overrides);
			await dbService.addAiReviewEvent({
				id: await generateId(),
				run_id: runId,
				asset_id: assetId,
				event_type: 'saved_after_ai_apply',
				event_payload: {
					overrideCount: overrides.length,
					estimateSignature
				},
				created_at: new Date().toISOString()
			});

			await this.refreshWorkspaceKnowledgeArtifacts();
		} catch (error) {
			await errorState.catchError(error, 'Record AI applied estimate save');
		} finally {
			this.resetAssetRunState(assetId);
		}
	}
}

export const aiState = new AiState();
