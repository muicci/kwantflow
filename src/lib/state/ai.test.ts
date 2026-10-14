import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Estimate } from '$lib/types/index.js';

const dbServiceMock = {
	createAiRun: vi.fn(),
	updateAiRun: vi.fn(),
	getWorkspaceProfile: vi.fn(),
	updateWorkspaceProfile: vi.fn(),
	getWorkspaceAiKnowledgeFiles: vi.fn(),
	getWorkspaceAiFeedbackEntries: vi.fn(),
	getWorkspaceAiOverrideEvents: vi.fn(),
	addWorkspaceAiKnowledgeFile: vi.fn(),
	addWorkspaceAiFeedbackEntry: vi.fn(),
	removeWorkspaceAiKnowledgeFile: vi.fn(),
	removeWorkspaceAiFeedbackEntry: vi.fn(),
	clearWorkspaceAiFeedbackEntries: vi.fn(),
	addAiRunInput: vi.fn(),
	addAiRunOutput: vi.fn(),
	replaceAiEvidenceRefs: vi.fn(),
	addAiReviewEvent: vi.fn(),
	addAiOverrideEvents: vi.fn(),
	getLatestAiRunForAsset: vi.fn(),
	getAiRunInput: vi.fn(),
	getAiRunOutput: vi.fn(),
	getAiReviewEvents: vi.fn(),
	getAiEvidenceRefs: vi.fn(),
	listLatestAiTaskSummaries: vi.fn()
};

const storeServiceMock = {
	getDismissedAiTaskRunIds: vi.fn(),
	setDismissedAiTaskRunIds: vi.fn()
};

const errorStateMock = {
	catchError: vi.fn()
};

const toastMock = {
	success: vi.fn(),
	error: vi.fn()
};

const envMock = {
	isTauri: vi.fn(),
	requireInternetConnection: vi.fn(),
	hasInternetConnection: vi.fn()
};

const workspaceStateMock = {
	id: 'local-workspace'
};

const invokeMock = vi.fn();
const infoMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();
const traceMock = vi.fn();
const debugMock = vi.fn();
const attachConsoleMock = vi.fn();
const readPdfAssetFileMock = vi.fn();
const buildEstimateAiImageArtifactMock = vi.fn();
const draftingServiceMock = {
	getAccessStatus: vi.fn(),
	prepareDraftRun: vi.fn(),
	startDraftRun: vi.fn(),
	getDraftRunStatus: vi.fn(),
	getDraftRunResult: vi.fn(),
	ackDraftRunResult: vi.fn(),
	cancelRun: vi.fn()
};

const buildLocalPreparedRunMock = vi.fn();
const localAiServiceMock = {
	getStatus: vi.fn(),
	downloadModel: vi.fn(),
	cancelDownload: vi.fn(),
	cancelActiveRun: vi.fn(),
	removeModel: vi.fn(),
	verifyLocalAiInstall: vi.fn(),
	ensureLocalAiReady: vi.fn(),
	runDraftRun: vi.fn()
};

const workspaceKnowledgeServiceMock = {
	buildWorkspaceAiKnowledgeContext: vi.fn(),
	extractWorkspaceAiKnowledgeText: vi.fn(),
	persistWorkspaceAiSkillFile: vi.fn(),
	removeWorkspaceAiKnowledgeFile: vi.fn(),
	storeWorkspaceAiKnowledgeFile: vi.fn()
};

vi.mock('$lib/services/ai-drafting.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/ai-drafting.js')>();
	return {
		...actual,
		buildLocalPreparedRun: buildLocalPreparedRunMock,
		readPdfAssetFile: readPdfAssetFileMock
	};
});

buildLocalPreparedRunMock.mockResolvedValue({
	artifacts: [],
	issues: [],
	artifactManifest: [],
	preprocessProfile: { totalElapsedMs: 0, artifacts: [] },
	progressDetail: {
		currentArtifactName: null,
		processedArtifactCount: 0,
		usableArtifactCount: 0,
		artifactIssueCount: 0,
		totalArtifactCount: 0,
		supportedArtifactCount: 0,
		unsupportedArtifactCount: 0,
		draftSubphase: null
	}
});

vi.mock('$lib/services/local-ai.js', () => ({
	localAiService: localAiServiceMock,
	repairDraftRunResultHeuristicOutline: vi.fn()
}));

vi.mock('$lib/services/ai-file-evidence.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/ai-file-evidence.js')>();
	return {
		...actual,
		buildEstimateAiImageArtifact: buildEstimateAiImageArtifactMock
	};
});

vi.mock('$lib/services/db.js', () => ({
	dbService: dbServiceMock
}));

vi.mock('$lib/services/store.js', () => ({
	storeService: storeServiceMock
}));

vi.mock('./errors.svelte.js', () => ({
	errorState: errorStateMock
}));

vi.mock('./workspace.svelte.js', () => ({
	workspaceState: workspaceStateMock
}));

vi.mock('svelte-sonner', () => ({
	toast: toastMock
}));

vi.mock('$lib/utils/env.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/utils/env.js')>();
	return {
		...actual,
		isTauri: envMock.isTauri,
		requireInternetConnection: envMock.requireInternetConnection,
		hasInternetConnection: envMock.hasInternetConnection
	};
});

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('@tauri-apps/plugin-log', () => ({
	attachConsole: attachConsoleMock,
	trace: traceMock,
	debug: debugMock,
	info: infoMock,
	warn: warnMock,
	error: errorMock
}));

vi.mock('$lib/services/ai-workspace-knowledge.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/ai-workspace-knowledge.js')>();
	return {
		...actual,
		buildWorkspaceAiKnowledgeContext:
			workspaceKnowledgeServiceMock.buildWorkspaceAiKnowledgeContext,
		extractWorkspaceAiKnowledgeText: workspaceKnowledgeServiceMock.extractWorkspaceAiKnowledgeText,
		persistWorkspaceAiSkillFile: workspaceKnowledgeServiceMock.persistWorkspaceAiSkillFile,
		removeWorkspaceAiKnowledgeFile: workspaceKnowledgeServiceMock.removeWorkspaceAiKnowledgeFile,
		storeWorkspaceAiKnowledgeFile: workspaceKnowledgeServiceMock.storeWorkspaceAiKnowledgeFile
	};
});

function createEstimate(scopeSummary: string): Estimate {
	return {
		asset_id: 'asset-1',
		scope_summary: scopeSummary,
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: []
	};
}

function _createProjectPayload() {
	return {
		id: 'project-1',
		projectName: 'Factory upgrade',
		rfqNumber: 'RFQ-1001',
		content: 'Fabricate and install steel stairs.',
		note: 'Prefer workshop labour where possible.'
	};
}

function createDraftedContextSnapshot() {
	return {
		version: 'estimate-context-v1',
		asset_context: {
			assetId: 'asset-1',
			assetName: 'Main package',
			projectName: 'Factory upgrade'
		},
		schema: {
			headerFields: ['scope_summary'],
			takeoffItemFields: [],
			costComponentFields: [],
			allowedCategories: [],
			allowedUnits: [],
			allowedUnitsByCategory: {}
		},
		reference_data: {
			classificationSystems: [
				{
					id: 'classification-1',
					code: 'MF',
					name: 'MasterFormat',
					type: 'cost-code',
					isDefault: true,
					isActive: true
				}
			],
			costCodes: [],
			wbsNodes: [],
			materialCatalogItems: [],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: [],
			estimateTemplates: []
		},
		field_semantics: {
			sections: [],
			fields: {}
		},
		current_estimate_state: {
			currentEstimate: createEstimate('Saved baseline'),
			savedEstimate: null,
			seededHeaderFields: ['scope_summary'],
			hasDraftedStructure: false
		},
		mapping_rules: {
			classificationCostCodeOwnership: 'strict',
			projectStructureOwnership: 'strict',
			sourceLinkedComponents: 'workspace_scoped',
			unresolvedStrategy: 'apply_to_working_copy'
		},
		review_rules: {
			blockingStatuses: [],
			clearableTargets: []
		}
	};
}

describe('aiState', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		Object.defineProperty(window.navigator, 'onLine', {
			configurable: true,
			value: true
		});
		workspaceStateMock.id = 'local-workspace';
		envMock.isTauri.mockReturnValue(true);
		envMock.requireInternetConnection.mockImplementation(() => {});
		envMock.hasInternetConnection.mockReturnValue(true);
		invokeMock.mockResolvedValue('generated-id');
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(
			'generated-id' as `${string}-${string}-${string}-${string}-${string}`
		);
		workspaceKnowledgeServiceMock.storeWorkspaceAiKnowledgeFile.mockResolvedValue({
			filePath: 'workspace-ai-knowledge/local-workspace/generated-id-knowledge.txt',
			byteSize: 256,
			mimeType: 'text/plain'
		});
		workspaceKnowledgeServiceMock.extractWorkspaceAiKnowledgeText.mockResolvedValue(
			'Imported estimator note'
		);
		workspaceKnowledgeServiceMock.persistWorkspaceAiSkillFile.mockResolvedValue(
			'account/workspace-ai-knowledge/local-workspace/workspace-ai-skill.md'
		);
		workspaceKnowledgeServiceMock.removeWorkspaceAiKnowledgeFile.mockResolvedValue(undefined);
		workspaceKnowledgeServiceMock.buildWorkspaceAiKnowledgeContext.mockImplementation(
			(params: {
				playbookText: string;
				files: Array<{ extractedText: string; originalName: string }>;
				feedbackEntries?: Array<{ feedbackText: string; runId: string }>;
				overrideEvents?: Array<{ run_id: string; field_path: string }>;
				skillFilePath?: string | null;
			}) => {
				const sections = [
					params.playbookText?.trim()
						? `# Workspace estimating playbook\n\n${params.playbookText.trim()}`
						: '',
					...params.files.map((file) =>
						file.extractedText?.trim()
							? `## ${file.originalName}\n\n${file.extractedText.trim()}`
							: ''
					),
					...(params.feedbackEntries ?? []).map((entry) =>
						entry.feedbackText?.trim()
							? `## Feedback from ${entry.runId}\n\n${entry.feedbackText.trim()}`
							: ''
					),
					...(params.overrideEvents ?? []).map((entry, index) =>
						entry.field_path?.trim()
							? `## Learned correction ${index + 1}\n\nPrefer the saved estimator choice for ${entry.field_path.trim()}.`
							: ''
					)
				].filter(Boolean);
				const compiledMarkdown = sections.join('\n\n').trim() || null;
				return {
					playbookText: params.playbookText?.trim() || null,
					compiledMarkdown,
					skillMarkdown: compiledMarkdown
						? `# Workspace Estimating Skill\n\n${compiledMarkdown}`
						: null,
					skillHash: compiledMarkdown ? 'skill-hash-1' : null,
					skillFilePath: params.skillFilePath ?? null,
					sourceSummary: {
						hasPlaybook: Boolean(params.playbookText?.trim()),
						fileCount: params.files.length,
						includedFileCount: params.files.filter((file) => file.extractedText?.trim()).length,
						feedbackEntryCount: params.feedbackEntries?.length ?? 0,
						includedFeedbackCount:
							params.feedbackEntries?.filter((entry) => entry.feedbackText.trim().length > 0)
								.length ?? 0,
						learnedCorrectionCount: params.overrideEvents?.length ?? 0,
						hasLearningAppendix:
							(params.feedbackEntries?.length ?? 0) > 0 || (params.overrideEvents?.length ?? 0) > 0,
						truncated: false,
						totalCharacterCount: compiledMarkdown?.length ?? 0
					},
					files: params.files.map((file, index) => ({
						id: `knowledge-${index + 1}`,
						originalName: file.originalName,
						mimeType: 'text/plain',
						byteSize: 256,
						characterCount: file.extractedText.length,
						excerpt: file.extractedText.slice(0, 180)
					}))
				};
			}
		);
		readPdfAssetFileMock.mockResolvedValue({
			pageCount: 1,
			text: 'Prepared PDF text',
			inlineData: null,
			mimeType: 'application/pdf',
			rasterPages: [],
			issues: [],
			cacheHit: false
		});
		buildEstimateAiImageArtifactMock.mockResolvedValue({
			mimeType: 'image/jpeg',
			inlineData: 'normalised-image'
		});
		draftingServiceMock.prepareDraftRun.mockResolvedValue({
			artifacts: [],
			issues: [],
			artifactManifest: [],
			progressDetail: {
				currentArtifactName: null,
				processedArtifactCount: 0,
				totalArtifactCount: 1,
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0
			}
		});
		draftingServiceMock.startDraftRun.mockResolvedValue({
			runId: 'generated-id',
			status: 'extracting',
			pollAfterMs: 1200,
			progressDetail: {
				currentArtifactName: null,
				processedArtifactCount: 0,
				totalArtifactCount: 1,
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0
			},
			startedAt: '2026-03-16T10:00:00.000Z'
		});
		draftingServiceMock.ackDraftRunResult.mockResolvedValue({
			runId: 'generated-id',
			acknowledged: true,
			acknowledgedAt: '2026-03-16T12:00:00.000Z'
		});
		draftingServiceMock.cancelRun.mockResolvedValue({
			runId: 'generated-id',
			status: 'cancelled',
			isCancelling: false,
			progressDetail: {
				currentArtifactName: null,
				processedArtifactCount: 0,
				totalArtifactCount: 1,
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0
			},
			startedAt: '2026-03-16T10:00:00.000Z',
			cancelledAt: '2026-03-16T10:05:00.000Z',
			pollAfterMs: 0
		});
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue(null);
		dbServiceMock.getWorkspaceProfile.mockResolvedValue({ aiPlaybookText: '' });
		dbServiceMock.updateWorkspaceProfile.mockResolvedValue(undefined);
		dbServiceMock.getWorkspaceAiKnowledgeFiles.mockResolvedValue([]);
		dbServiceMock.getWorkspaceAiFeedbackEntries.mockResolvedValue([]);
		dbServiceMock.getWorkspaceAiOverrideEvents.mockResolvedValue([]);
		dbServiceMock.addWorkspaceAiKnowledgeFile.mockResolvedValue(undefined);
		dbServiceMock.addWorkspaceAiFeedbackEntry.mockResolvedValue(undefined);
		dbServiceMock.removeWorkspaceAiKnowledgeFile.mockResolvedValue(null);
		dbServiceMock.removeWorkspaceAiFeedbackEntry.mockResolvedValue(undefined);
		dbServiceMock.clearWorkspaceAiFeedbackEntries.mockResolvedValue(undefined);
		dbServiceMock.getAiRunInput.mockResolvedValue(null);
		dbServiceMock.getAiRunOutput.mockResolvedValue(null);
		dbServiceMock.getAiReviewEvents.mockResolvedValue([]);
		dbServiceMock.getAiEvidenceRefs.mockResolvedValue([]);
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([]);
		storeServiceMock.getDismissedAiTaskRunIds.mockResolvedValue([]);
		storeServiceMock.setDismissedAiTaskRunIds.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('hydrates the Local AI runtime status', async () => {
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.activeModelId).toBe('kwantflow-ai.litertlm');
		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			localAiInstallState: expect.any(String),
			hasInternet: true
		});
	}, 10_000);

	it('rehydrates an auto-applied AI estimate into a pending working copy state', async () => {
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-2',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'applied',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: '2026-03-16T12:00:00.000Z',
				failed_at: null,
				cancelled_at: null,
				error_message: null
			}
		]);
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-2',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'applied',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: '2026-03-16T12:00:00.000Z',
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T12:00:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Saved baseline')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'estimate_context_snapshot') {
				return {
					id: 'input-2',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: createDraftedContextSnapshot(),
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'artifact_manifest') {
				return {
					id: 'input-3',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: {
						artifacts: [
							{
								fileId: 'file-1',
								fileName: 'sample-readme.md'
							}
						]
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'preprocess_issues') {
				return {
					id: 'input-4',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: {
						issues: [
							{
								code: 'low_signal_file_skipped',
								message: 'README.md was skipped.',
								severity: 'warning',
								fileName: 'README.md'
							}
						]
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockImplementation(async (_runId: string, outputKind: string) => {
			if (outputKind === 'finalised_draft_estimate') {
				return {
					id: 'output-1',
					run_id: 'run-2',
					output_kind: outputKind,
					payload: {
						draft: {
							scope_summary: 'AI scope',
							notes: '',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: []
						},
						estimate: createEstimate('AI scope'),
						issues: []
					},
					created_at: '2026-03-16T12:00:00.000Z'
				};
			}
			if (outputKind === 'mapping_validation') {
				return {
					id: 'output-2',
					run_id: 'run-2',
					output_kind: outputKind,
					payload: {
						review: {
							headerFields: [],
							items: [],
							issues: [],
							reconciledDraft: {
								scope_summary: 'AI scope',
								notes: '',
								classification_system_id: null,
								wbs_root_node_id: null,
								takeoff_items: []
							},
							preflight: {
								canFinalize: true,
								blockerCount: 0,
								warningCount: 0,
								reviewCount: 0
							}
						}
					},
					created_at: '2026-03-16T12:00:00.000Z'
				};
			}
			return null;
		});

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.actionableTaskCount).toBe(1);
		expect(aiState.getEstimateBeforeApply('asset-1')).toMatchObject({
			scope_summary: 'Saved baseline'
		});
		expect(aiState.getPendingAppliedEstimate('asset-1')).toMatchObject({
			scope_summary: 'AI scope'
		});
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-2',
			status: 'applied',
			editorApplyState: 'pending_manual_apply',
			progressDetail: expect.objectContaining({
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0,
				processedArtifactCount: 1
			})
		});
	});

	it('does not rehydrate a reverted applied AI estimate into a pending working copy state', async () => {
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-2',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'applied',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: '2026-03-16T12:00:00.000Z',
				failed_at: null,
				cancelled_at: null,
				error_message: null
			}
		]);
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-2',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'applied',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: '2026-03-16T12:00:00.000Z',
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T12:00:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Saved baseline')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'estimate_context_snapshot') {
				return {
					id: 'input-2',
					run_id: 'run-2',
					input_kind: inputKind,
					payload: createDraftedContextSnapshot(),
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockImplementation(async (_runId: string, outputKind: string) => {
			if (outputKind === 'finalised_draft_estimate') {
				return {
					id: 'output-1',
					run_id: 'run-2',
					output_kind: outputKind,
					payload: {
						draft: {
							scope_summary: 'AI scope',
							notes: '',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: []
						},
						estimate: createEstimate('AI scope'),
						issues: []
					},
					created_at: '2026-03-16T12:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiReviewEvents.mockResolvedValue([
			{
				event_type: 'draft_ready',
				event_payload: {}
			},
			{
				event_type: 'reverted_before_save',
				event_payload: {}
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.actionableTaskCount).toBe(0);
		expect(aiState.getEstimateBeforeApply('asset-1')).toBeNull();
		expect(aiState.getPendingAppliedEstimate('asset-1')).toBeNull();
		expect(aiState.getAssetRunState('asset-1').status).toBe('idle');
	});

	it('clears a saved applied AI run after an estimate reset event', async () => {
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-reset',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'applied',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: '2026-03-16T12:00:00.000Z',
				failed_at: null,
				cancelled_at: null,
				error_message: null
			}
		]);
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-reset',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'applied',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: '2026-03-16T12:00:00.000Z',
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T12:00:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-reset',
					input_kind: inputKind,
					payload: { estimate: createEstimate('Saved baseline') },
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'estimate_context_snapshot') {
				return {
					id: 'input-2',
					run_id: 'run-reset',
					input_kind: inputKind,
					payload: createDraftedContextSnapshot(),
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockResolvedValue(null);
		dbServiceMock.getAiReviewEvents.mockResolvedValue([
			{ event_type: 'saved_after_ai_apply', event_payload: { estimateSignature: 'saved' } },
			{ event_type: 'estimate_reset', event_payload: {} }
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateTaskEntries();
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.getPendingAppliedEstimate('asset-1')).toBeNull();
		expect(aiState.getAssetRunState('asset-1').status).toBe('idle');
		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([]);
	});

	it('clears a saved applied AI run after hydration without restoring a pending working copy', async () => {
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-saved',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'applied',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: '2026-03-16T12:00:00.000Z',
				failed_at: null,
				cancelled_at: null,
				error_message: null
			}
		]);
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-saved',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'applied',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: '2026-03-16T12:00:00.000Z',
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T12:00:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-saved',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Saved baseline')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'estimate_context_snapshot') {
				return {
					id: 'input-2',
					run_id: 'run-saved',
					input_kind: inputKind,
					payload: createDraftedContextSnapshot(),
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockImplementation(async (_runId: string, outputKind: string) => {
			if (outputKind === 'finalised_draft_estimate') {
				return {
					id: 'output-1',
					run_id: 'run-saved',
					output_kind: outputKind,
					payload: {
						draft: {
							scope_summary: 'AI scope',
							notes: '',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: []
						},
						estimate: createEstimate('AI scope'),
						issues: []
					},
					created_at: '2026-03-16T12:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiReviewEvents.mockResolvedValue([
			{
				event_type: 'draft_ready',
				event_payload: {}
			},
			{
				event_type: 'saved_after_ai_apply',
				event_payload: { estimateSignature: 'saved-signature' }
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateTaskEntries();
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.getPendingAppliedEstimate('asset-1')).toBeNull();
		expect(aiState.getEstimateBeforeApply('asset-1')).toBeNull();
		expect(aiState.getAssetRunState('asset-1').status).toBe('idle');
		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([]);
	});

	it('tracks whether a completed AI draft is still pending manual apply or already inserted into the editor', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-apply',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'applied',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: '2026-03-16T12:00:00.000Z',
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T12:00:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-apply',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Saved baseline')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			if (inputKind === 'estimate_context_snapshot') {
				return {
					id: 'input-2',
					run_id: 'run-apply',
					input_kind: inputKind,
					payload: createDraftedContextSnapshot(),
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockImplementation(async (_runId: string, outputKind: string) => {
			if (outputKind === 'finalised_draft_estimate') {
				return {
					id: 'output-1',
					run_id: 'run-apply',
					output_kind: outputKind,
					payload: {
						draft: {
							scope_summary: 'AI scope',
							notes: '',
							classification_system_id: null,
							wbs_root_node_id: null,
							takeoff_items: []
						},
						estimate: createEstimate('AI scope'),
						issues: []
					},
					created_at: '2026-03-16T12:00:00.000Z'
				};
			}
			return null;
		});

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.getAssetRunState('asset-1').editorApplyState).toBe('pending_manual_apply');

		aiState.markPendingEstimateAppliedToEditor('asset-1');
		expect(aiState.getAssetRunState('asset-1').editorApplyState).toBe('applied_to_editor');

		aiState.markPendingEstimateAwaitingManualApply('asset-1');
		expect(aiState.getAssetRunState('asset-1').editorApplyState).toBe('pending_manual_apply');
	});

	it('dismisses a completed task entry for the current run without blocking a newer run on the same asset', async () => {
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-old',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'failed',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: null,
				failed_at: '2026-03-16T10:05:00.000Z',
				cancelled_at: null,
				error_message: 'Invalid PDF'
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateTaskEntries();
		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([expect.objectContaining({ runId: 'run-old', assetId: 'asset-1' })]);

		await aiState.dismissTaskEntry('run-old');
		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([]);
		expect(storeServiceMock.setDismissedAiTaskRunIds).toHaveBeenCalledWith(['run-old']);

		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-old',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'failed',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: null,
				failed_at: '2026-03-16T10:05:00.000Z',
				cancelled_at: null,
				error_message: 'Invalid PDF'
			},
			{
				run_id: 'run-new',
				asset_id: 'asset-1',
				asset_name: 'Main package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'failed',
				started_at: '2026-03-16T12:00:00.000Z',
				completed_at: null,
				failed_at: '2026-03-16T12:05:00.000Z',
				cancelled_at: null,
				error_message: 'Mapping failed'
			}
		]);
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-new',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'failed',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T12:00:00.000Z',
			completed_at: null,
			failed_at: '2026-03-16T12:05:00.000Z',
			cancelled_at: null,
			error_message: 'Mapping failed',
			usage: {},
			created_at: '2026-03-16T12:00:00.000Z',
			updated_at: '2026-03-16T12:05:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockResolvedValue(null);
		dbServiceMock.getAiRunOutput.mockResolvedValue(null);
		dbServiceMock.getAiReviewEvents.mockResolvedValue([]);
		dbServiceMock.getAiEvidenceRefs.mockResolvedValue([]);

		await aiState.hydrateTaskEntries();
		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([expect.objectContaining({ runId: 'run-new', assetId: 'asset-1' })]);
	});

	it('rehydrates dismissed run ids from store and prunes stale dismissed entries', async () => {
		storeServiceMock.getDismissedAiTaskRunIds.mockResolvedValue(['run-stale', 'run-keep']);
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([
			{
				run_id: 'run-keep',
				asset_id: 'asset-2',
				asset_name: 'Secondary package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'failed',
				started_at: '2026-03-16T10:00:00.000Z',
				completed_at: null,
				failed_at: '2026-03-16T10:05:00.000Z',
				cancelled_at: null,
				error_message: 'CAD failed'
			},
			{
				run_id: 'run-visible',
				asset_id: 'asset-3',
				asset_name: 'Visible package',
				project_id: 'project-1',
				project_rfq_number: 'RFQ-001',
				status: 'failed',
				started_at: '2026-03-16T11:00:00.000Z',
				completed_at: null,
				failed_at: '2026-03-16T11:05:00.000Z',
				cancelled_at: null,
				error_message: 'PDF failed'
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		expect(
			(aiState as unknown as { taskEntries: Array<{ runId: string; assetId: string }> }).taskEntries
		).toEqual([expect.objectContaining({ runId: 'run-visible', assetId: 'asset-3' })]);
		expect(storeServiceMock.setDismissedAiTaskRunIds).toHaveBeenCalledWith(['run-keep']);
	});

	it('rejects workspace playbooks that exceed the compact settings limit', async () => {
		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		await expect(aiState.saveWorkspacePlaybook('x'.repeat(1201))).rejects.toThrow(
			'Workspace playbook must stay within 1200 characters.'
		);
		expect(dbServiceMock.updateWorkspaceProfile).not.toHaveBeenCalled();
	});

	it('adds workspace knowledge files through the shared storage and DB contracts', async () => {
		dbServiceMock.getWorkspaceAiKnowledgeFiles.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				id: 'generated-id',
				workspaceId: 'workspace-1',
				filePath: 'workspace-ai-knowledge/local-workspace/generated-id-knowledge.txt',
				originalName: 'knowledge-note.txt',
				mimeType: 'text/plain',
				byteSize: 256,
				extractedText: 'Imported estimator note',
				created_at: '2026-04-10T08:00:00.000Z',
				updated_at: '2026-04-10T08:00:00.000Z'
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();
		await aiState.addWorkspaceKnowledgeFiles(['/tmp/knowledge-note.txt']);

		expect(workspaceKnowledgeServiceMock.storeWorkspaceAiKnowledgeFile).toHaveBeenCalledWith({
			workspaceId: 'local-workspace',
			fileId: 'generated-id',
			sourcePath: '/tmp/knowledge-note.txt'
		});
		expect(workspaceKnowledgeServiceMock.extractWorkspaceAiKnowledgeText).toHaveBeenCalledWith(
			'workspace-ai-knowledge/local-workspace/generated-id-knowledge.txt'
		);
		expect(dbServiceMock.addWorkspaceAiKnowledgeFile).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'generated-id',
				originalName: 'knowledge-note.txt',
				filePath: 'workspace-ai-knowledge/local-workspace/generated-id-knowledge.txt',
				extractedText: 'Imported estimator note'
			})
		);
		expect(aiState.workspaceAiKnowledgeFiles).toHaveLength(1);
		expect(toastMock.success).toHaveBeenCalledWith('AI knowledge file added');
	});

	it('removes workspace knowledge files from both DB metadata and stored files', async () => {
		dbServiceMock.getWorkspaceAiKnowledgeFiles.mockResolvedValueOnce([
			{
				id: 'knowledge-1',
				workspaceId: 'workspace-1',
				filePath: 'workspace-ai-knowledge/local-workspace/knowledge-1-note.txt',
				originalName: 'Estimator note.txt',
				mimeType: 'text/plain',
				byteSize: 256,
				extractedText: 'Imported estimator note',
				created_at: '2026-04-10T08:00:00.000Z',
				updated_at: '2026-04-10T08:00:00.000Z'
			}
		]);
		dbServiceMock.removeWorkspaceAiKnowledgeFile.mockResolvedValue({
			id: 'knowledge-1',
			workspaceId: 'workspace-1',
			filePath: 'workspace-ai-knowledge/local-workspace/knowledge-1-note.txt',
			originalName: 'Estimator note.txt',
			mimeType: 'text/plain',
			byteSize: 256,
			extractedText: 'Imported estimator note',
			created_at: '2026-04-10T08:00:00.000Z',
			updated_at: '2026-04-10T08:00:00.000Z'
		});

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();
		await aiState.removeWorkspaceKnowledgeFile('knowledge-1');

		expect(dbServiceMock.removeWorkspaceAiKnowledgeFile).toHaveBeenCalledWith('knowledge-1');
		expect(workspaceKnowledgeServiceMock.removeWorkspaceAiKnowledgeFile).toHaveBeenCalledWith(
			'workspace-ai-knowledge/local-workspace/knowledge-1-note.txt'
		);
		expect(aiState.workspaceAiKnowledgeFiles).toHaveLength(0);
		expect(toastMock.success).toHaveBeenCalledWith('AI knowledge file removed');
	});

	it('stores per-run feedback and regenerates the workspace skill preview', async () => {
		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		await aiState.submitRunFeedback({
			runId: 'run-1',
			assetId: 'asset-1',
			estimateId: 'estimate-1',
			feedbackText: 'Halve install labour when the drawing already shows preassembled canopies.'
		});

		expect(dbServiceMock.addWorkspaceAiFeedbackEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'run-1',
				assetId: 'asset-1',
				estimateId: 'estimate-1',
				feedbackText: 'Halve install labour when the drawing already shows preassembled canopies.'
			})
		);
		expect(aiState.workspaceAiFeedbackEntries).toHaveLength(1);
		expect(aiState.workspaceAiSkillPreview).toContain('# Workspace Estimating Skill');
		expect(aiState.workspaceAiSkillPreview).toContain(
			'Halve install labour when the drawing already shows preassembled canopies.'
		);
		expect(workspaceKnowledgeServiceMock.persistWorkspaceAiSkillFile).toHaveBeenLastCalledWith({
			workspaceId: 'local-workspace',
			skillMarkdown: expect.stringContaining(
				'Halve install labour when the drawing already shows preassembled canopies.'
			)
		});
		expect(toastMock.success).toHaveBeenCalledWith('Feedback saved for future drafts');
	});

	it('clears stored workspace feedback and regenerates the skill preview without the learning appendix', async () => {
		dbServiceMock.getWorkspaceAiFeedbackEntries.mockResolvedValueOnce([
			{
				id: 'feedback-1',
				workspaceId: 'local-workspace',
				runId: 'run-1',
				assetId: 'asset-1',
				estimateId: 'estimate-1',
				feedbackText: 'Keep bundled canopy labour under one install row.',
				created_at: '2026-04-10T08:00:00.000Z'
			}
		]);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();
		expect(aiState.workspaceAiFeedbackEntries).toHaveLength(1);

		await aiState.clearWorkspaceFeedbackEntries();

		expect(dbServiceMock.clearWorkspaceAiFeedbackEntries).toHaveBeenCalledTimes(1);
		expect(aiState.workspaceAiFeedbackEntries).toHaveLength(0);
		expect(aiState.workspaceAiSkillPreview).not.toContain('Keep bundled canopy labour');
		expect(toastMock.success).toHaveBeenCalledWith('Feedback history cleared');
	});

	it('refreshes workspace skill artifacts after saving edits to an AI-applied estimate', async () => {
		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		const baselineEstimate = createEstimate('Original AI scope');
		const savedEstimate = createEstimate('Estimator corrected scope');
		const aiStateInternals = aiState as unknown as {
			appliedRunIds: Map<string, string>;
			assetRuns: Map<string, unknown>;
		};

		aiStateInternals.appliedRunIds.set('asset-1', 'run-1');
		aiStateInternals.assetRuns.set('asset-1', {
			runId: 'run-1',
			status: 'applied',
			editorApplyState: 'applied_to_editor',
			isCancelling: false,
			modelId: 'local-litert-lm',
			errorMessage: null,
			issues: [],
			evidenceRefs: [],
			lastAppliedEstimate: baselineEstimate,
			lastSavedApplySignature: null,
			completedAt: '2026-04-10T10:00:00.000Z'
		});

		await aiState.recordEstimateSaved('asset-1', savedEstimate);

		expect(dbServiceMock.addAiOverrideEvents).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.addAiOverrideEvents).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					run_id: 'run-1',
					asset_id: 'asset-1'
				})
			])
		);
		expect(dbServiceMock.addAiReviewEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				run_id: 'run-1',
				asset_id: 'asset-1',
				event_type: 'saved_after_ai_apply'
			})
		);
		expect(dbServiceMock.getWorkspaceAiOverrideEvents).toHaveBeenCalled();
		expect(workspaceKnowledgeServiceMock.persistWorkspaceAiSkillFile).toHaveBeenCalled();
	});

	it('keeps the pre-AI estimate snapshot available when hydrating failed runs', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-failed',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'failed',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: null,
			failed_at: '2026-03-16T10:05:00.000Z',
			cancelled_at: null,
			error_message: 'Invalid PDF',
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T10:05:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-failed',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Unsaved before AI')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});
		dbServiceMock.getAiRunOutput.mockResolvedValue(null);

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.getEstimateBeforeApply('asset-1')).toMatchObject({
			scope_summary: 'Unsaved before AI'
		});
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-failed',
			status: 'failed',
			errorMessage: 'Invalid PDF'
		});
	});

	it('preserves the pre-AI estimate baseline when hydrating a cancelled run', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-cancelled',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'local-litert-lm',
			status: 'cancelled',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: null,
			failed_at: null,
			cancelled_at: '2026-03-16T10:05:00.000Z',
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T10:05:00.000Z'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'estimate_before_apply') {
				return {
					id: 'input-1',
					run_id: 'run-cancelled',
					input_kind: inputKind,
					payload: {
						estimate: createEstimate('Unsaved baseline before AI')
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}
			return null;
		});

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(aiState.getEstimateBeforeApply('asset-1')).toMatchObject({
			scope_summary: 'Unsaved baseline before AI'
		});
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-cancelled',
			status: 'cancelled'
		});
	});
});
