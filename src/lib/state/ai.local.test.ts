import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Estimate, LocalAiStatus } from '$lib/types/index.js';

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

const dbServiceMock = {
	createAiRun: vi.fn(),
	updateAiRun: vi.fn(),
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
	listLatestAiTaskSummaries: vi.fn(),
	getWorkspaceProfile: vi.fn(),
	getWorkspaceAiKnowledgeFiles: vi.fn(),
	getWorkspaceAiFeedbackEntries: vi.fn(),
	getWorkspaceAiOverrideEvents: vi.fn(),
	addWorkspaceAiKnowledgeFile: vi.fn(),
	removeWorkspaceAiKnowledgeFile: vi.fn(),
	addWorkspaceAiFeedbackEntry: vi.fn(),
	removeWorkspaceAiFeedbackEntry: vi.fn(),
	clearWorkspaceAiFeedbackEntries: vi.fn()
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

vi.mock('$lib/services/ai-drafting.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/ai-drafting.js')>();
	return {
		...actual,
		buildLocalPreparedRun: buildLocalPreparedRunMock,
		readPdfAssetFile: readPdfAssetFileMock
	};
});

buildLocalPreparedRunMock
	.mockResolvedValue({
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
	})
	.mockName('buildLocalPreparedRun');

vi.mock('$lib/services/ai-file-evidence.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/ai-file-evidence.js')>();
	return {
		...actual,
		buildEstimateAiImageArtifact: buildEstimateAiImageArtifactMock
	};
});

vi.mock('$lib/services/local-ai.js', () => ({
	localAiService: localAiServiceMock,
	repairDraftRunResultHeuristicOutline: (result: unknown) => result
}));

vi.mock('$lib/services/db.js', () => ({
	dbService: dbServiceMock
}));

vi.mock('$lib/services/ai-workspace-knowledge.js', () => ({
	buildWorkspaceAiKnowledgeContext: vi.fn(
		({ playbookText, files, feedbackEntries = [], skillFilePath }) => {
			const hasContent = Boolean(playbookText) || files.length > 0 || feedbackEntries.length > 0;
			const compiledMarkdown = hasContent ? `Workspace playbook:\n${playbookText || ''}` : null;
			return {
				playbookText: playbookText || null,
				compiledMarkdown,
				skillMarkdown: compiledMarkdown
					? `# Workspace Estimating Skill\n\n${compiledMarkdown}`
					: null,
				skillHash: compiledMarkdown ? 'local-skill-hash-1' : null,
				skillFilePath: skillFilePath ?? null,
				sourceSummary: {
					hasPlaybook: Boolean(playbookText),
					fileCount: files.length,
					includedFileCount: files.length,
					feedbackEntryCount: feedbackEntries.length,
					includedFeedbackCount: feedbackEntries.length,
					learnedCorrectionCount: 0,
					hasLearningAppendix: feedbackEntries.length > 0,
					truncated: false,
					totalCharacterCount: compiledMarkdown?.length ?? 0
				},
				files: []
			};
		}
	),
	extractWorkspaceAiKnowledgeText: vi.fn(),
	isWorkspaceAiKnowledgeFileAllowed: vi.fn(() => true),
	persistWorkspaceAiSkillFile: vi.fn().mockResolvedValue(null),
	removeWorkspaceAiKnowledgeFile: vi.fn().mockResolvedValue(undefined),
	storeWorkspaceAiKnowledgeFile: vi.fn(),
	WORKSPACE_AI_FEEDBACK_MAX_CHARS: 400,
	WORKSPACE_AI_KNOWLEDGE_MAX_FILES: 5,
	WORKSPACE_AI_PLAYBOOK_MAX_CHARS: 1200
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
			classificationSystems: [],
			costCodes: [],
			wbsNodes: [],
			materialCatalogItems: [],
			labourRateCards: [],
			equipmentRateCards: [],
			subcontractRateCards: [],
			costComponentPresets: [],
			estimateTemplates: []
		},
		field_semantics: { sections: [], fields: {} },
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
		review_rules: { blockingStatuses: [], clearableTargets: [] }
	};
}

function createLocalStatus(overrides: Partial<LocalAiStatus> = {}): LocalAiStatus {
	return {
		expectedDownloadBytes: 3659530240,
		runtimeKind: 'litert_lm',
		runtimeVersion: 'litert-lm-v0.16.0',
		modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
		modelArtifactId: 'kwantflow-ai.litertlm',
		modelFileName: 'gemma-4-e4b/model.litertlm',
		mmprojFileName: null,
		installState: 'ready',
		runtimeAvailable: true,
		modelReady: true,
		supportsImageInputs: false,
		supportsNativeToolCalls: true,
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
			contextSizeTokens: 32003,
			activeStreamCount: 0,
			capabilityProbe: {
				supportsConstrainedToolCalls: true,
				supportsNativeToolCalls: true,
				supportsReasoningSeparation: true,
				supportsVisionInputs: false,
				supportsPersistentConversation: false,
				supportsPersistentConversationWithVision: false,
				checkedElapsedMs: null,
				source: 'native_probe'
			}
		},
		...overrides
	};
}

describe('aiState local AI', () => {
	beforeAll(() => {
		vi.setConfig({ testTimeout: 10000 });
	});
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		Object.defineProperty(window.navigator, 'onLine', {
			configurable: true,
			value: false
		});
		envMock.isTauri.mockReturnValue(true);
		envMock.hasInternetConnection.mockReturnValue(false);
		envMock.requireInternetConnection.mockImplementation(() => {});
		storeServiceMock.getDismissedAiTaskRunIds.mockResolvedValue([]);
		storeServiceMock.setDismissedAiTaskRunIds.mockResolvedValue(undefined);
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
			preprocessProfile: {
				totalElapsedMs: 12,
				artifacts: []
			},
			progressDetail: {
				currentArtifactName: null,
				processedArtifactCount: 0,
				totalArtifactCount: 1,
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0
			}
		});
		localAiServiceMock.getStatus.mockResolvedValue(createLocalStatus());
		localAiServiceMock.downloadModel.mockResolvedValue(createLocalStatus());
		localAiServiceMock.cancelDownload.mockResolvedValue(
			createLocalStatus({
				installState: 'downloading',
				modelReady: false,
				activeDownload: {
					stage: 'downloading_model',
					label: 'Cancelling Kwantflow AI download',
					downloadedBytes: 512_000_000,
					totalBytes: 5_000_000_000,
					percent: 10.24
				}
			})
		);
		localAiServiceMock.cancelActiveRun.mockResolvedValue(createLocalStatus());
		localAiServiceMock.removeModel.mockResolvedValue(
			createLocalStatus({
				installState: 'not_downloaded',
				modelReady: false
			})
		);
		localAiServiceMock.verifyLocalAiInstall.mockResolvedValue(createLocalStatus());
		localAiServiceMock.ensureLocalAiReady.mockResolvedValue(createLocalStatus());
		localAiServiceMock.runDraftRun.mockResolvedValue({
			draft: {
				scope_summary: 'Local AI scope',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				applied_template_id: null,
				applied_template_name: null,
				takeoff_items: [],
				issues: []
			},
			draftAgentSteps: [{ turn: 1, toolCallCount: 0 }],
			draftToolCalls: [
				{ turn: 1, name: 'records_search', arguments: { query: 'steel' }, status: 'ok' }
			],
			draftAgentFinal: { status: 'complete', draft: { scope_summary: 'Local AI scope' } },
			evidenceRefs: [],
			issues: [
				{
					code: 'local_draft_agent_skipped_device_budget',
					message:
						'Local AI draft refinement was skipped because the native tool-turn benchmark is not reliable.',
					severity: 'info'
				}
			],
			artifactManifest: [],
			extractions: [],
			usage: {},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			normalizedTableSnapshot: {},
			cacheMetadata: {
				strategy: 'telemetry',
				normalizedTableSnapshotFingerprint: 'local-normalized',
				estimateContextSnapshotFingerprint: 'local-estimate',
				extractionContextFingerprint: 'local-extraction',
				draftContextFingerprint: 'local-draft'
			},
			runtimeExecutionContext: {
				runtimeContractVersion: 'local-litert-lm-v1',
				kernelContractVersion: 'local-ai-kernel-v3',
				localRuntime: {
					runtimeKind: 'litert_lm',
					runtimeVersion: 'litert-lm-v0.16.0',
					modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
					modelArtifactId: 'kwantflow-ai.litertlm',
					modelFileName: 'model.litertlm',
					mmprojFileName: null,
					supportsImageInputs: true
				},
				evidenceArtifacts: []
			}
		});
		dbServiceMock.createAiRun.mockResolvedValue(undefined);
		dbServiceMock.updateAiRun.mockResolvedValue(undefined);
		dbServiceMock.addAiRunInput.mockResolvedValue(undefined);
		dbServiceMock.addAiRunOutput.mockResolvedValue(undefined);
		dbServiceMock.replaceAiEvidenceRefs.mockResolvedValue(undefined);
		dbServiceMock.addAiReviewEvent.mockResolvedValue(undefined);
		dbServiceMock.addAiOverrideEvents.mockResolvedValue(undefined);
		dbServiceMock.listLatestAiTaskSummaries.mockResolvedValue([]);
		dbServiceMock.getWorkspaceProfile.mockResolvedValue({
			aiPlaybookText: ''
		});
		dbServiceMock.getAiRunInput.mockResolvedValue(null);
		dbServiceMock.getAiRunOutput.mockResolvedValue(null);
		dbServiceMock.getAiReviewEvents.mockResolvedValue([]);
		dbServiceMock.getAiEvidenceRefs.mockResolvedValue([]);
		dbServiceMock.getWorkspaceAiKnowledgeFiles.mockResolvedValue([]);
		dbServiceMock.getWorkspaceAiFeedbackEntries.mockResolvedValue([]);
		dbServiceMock.getWorkspaceAiOverrideEvents.mockResolvedValue([]);
		dbServiceMock.addWorkspaceAiKnowledgeFile.mockResolvedValue(undefined);
		dbServiceMock.removeWorkspaceAiKnowledgeFile.mockResolvedValue(null);
		dbServiceMock.addWorkspaceAiFeedbackEntry.mockResolvedValue(undefined);
		dbServiceMock.removeWorkspaceAiFeedbackEntry.mockResolvedValue(undefined);
		dbServiceMock.clearWorkspaceAiFeedbackEntries.mockResolvedValue(undefined);
		invokeMock.mockResolvedValue('generated-id');
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(
			'generated-id' as `${string}-${string}-${string}-${string}-${string}`
		);
	});

	it('hydrates the local AI runtime status from device state', async () => {
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(localAiServiceMock.getStatus).toHaveBeenCalledTimes(1);
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'ready',
			modelReady: true
		});
		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			canDraftEstimate: true,
			hasInternet: false,
			localAiInstallState: expect.any(String)
		});
	});

	it('does not load the engine during hydration when an installed model is detected', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'installed',
				modelReady: false
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await expect(aiState.hydrate()).resolves.toBeUndefined();

		expect(localAiServiceMock.ensureLocalAiReady).not.toHaveBeenCalled();
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'installed',
			modelReady: false
		});
	});

	it('blocks drafting when the local runtime is not ready', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'not_downloaded',
				modelReady: false
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			canDraftEstimate: false,
			localAiInstallState: expect.any(String),
			hasActiveModel: false,
			unavailableReason: 'Download Kwantflow AI in Settings to draft estimates on this device.'
		});
	});

	it('prioritises Local AI repair state over generic download messaging', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'repair_needed',
				modelReady: false,
				runtimeAvailable: false,
				lastError: 'Runtime files need repair.'
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			canDraftEstimate: false,
			localAiInstallState: expect.any(String),
			hasActiveModel: false,
			unavailableReason: 'Kwantflow AI needs attention in Settings before it can run.'
		});
	});

	it('hydrates live Local AI runtime status without a provider preference', async () => {
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(localAiServiceMock.getStatus).toHaveBeenCalledTimes(1);
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'ready',
			modelReady: true,
			runtimeAvailable: true,
			lastError: null
		});
	});

	it('does not introduce a second runtime when the local model is not downloaded', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'not_downloaded',
				modelReady: false
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.localAiStatus.modelReady).toBe(false);
	});

	it('blocks local drafting when the bundled model is installed but the runtime needs repair', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'repair_needed',
				modelReady: false,
				lastError: 'Runtime failed to start.'
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.localAiStatus).toMatchObject({
			installState: 'repair_needed',
			modelReady: false,
			lastError: 'Runtime failed to start.'
		});
		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			canDraftEstimate: false,
			localAiInstallState: expect.any(String),
			hasActiveModel: false
		});
	});

	it('allows local drafting when the model is installed and the engine can warm on demand', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'installed',
				runtimeAvailable: true,
				modelReady: false
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();

		expect(aiState.getDraftingAvailability(true)).toMatchObject({
			canDraftEstimate: true,
			localAiInstallState: 'installed',
			hasActiveModel: true
		});
	});

	it('runs the first local draft offline when the model is downloaded and the engine is unloaded', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({ installState: 'installed', modelReady: false })
		);
		dbServiceMock.getWorkspaceProfile.mockResolvedValue({
			aiPlaybookText: 'Keep bundled canopy pricing as two rows.'
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) =>
			inputKind === 'estimate_context_snapshot'
				? {
						id: 'input-context',
						run_id: 'generated-id',
						input_kind: inputKind,
						payload: createDraftedContextSnapshot(),
						created_at: '2026-03-16T10:00:00.000Z'
					}
				: null
		);
		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		await aiState.draftEstimateForAsset({
			asset: {
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Main package',
				thumbnail_file_id: null,
				is_selected: true,
				created_at: '2026-03-16T00:00:00Z'
			},
			project: {
				id: 'project-1',
				projectName: 'Factory upgrade',
				rfqNumber: 'RFQ-1001',
				content: 'Fabricate and install steel stairs.',
				note: 'Prefer workshop labour where possible.'
			},
			files: [
				{
					id: 'file-1',
					project_id: 'project-1',
					file_path: '/vault/project-1/rfq.pdf',
					original_name: 'rfq.pdf',
					mime_type: 'application/pdf',
					created_at: '2026-03-16T00:00:00Z'
				}
			],
			currentEstimate: createEstimate('Saved baseline'),
			savedEstimate: null,
			tableSnapshot: {}
		});

		expect(localAiServiceMock.runDraftRun).toHaveBeenCalledTimes(1);
		expect(localAiServiceMock.runDraftRun).toHaveBeenCalledWith(
			expect.objectContaining({
				runtimeStatus: expect.objectContaining({
					installState: 'installed',
					modelReady: false,
					expectedDownloadBytes: 3659530240,
					runtimeKind: 'litert_lm',
					modelArtifactId: 'kwantflow-ai.litertlm'
				}),
				workspaceKnowledgeContext: expect.objectContaining({
					playbookText: 'Keep bundled canopy pricing as two rows.',
					sourceSummary: expect.objectContaining({
						hasPlaybook: true
					})
				})
			})
		);
		expect(envMock.requireInternetConnection).not.toHaveBeenCalled();
		expect(dbServiceMock.createAiRun).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'local_litert_lm',
				model_id: 'kwantflow-ai.litertlm'
			})
		);
		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			expect.any(String),
			'draft_agent_steps',
			{ steps: [{ turn: 1, toolCallCount: 0 }] }
		);
		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			expect.any(String),
			'draft_tool_calls',
			expect.objectContaining({ toolCalls: [expect.objectContaining({ name: 'records_search' })] })
		);
		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			expect.any(String),
			'draft_evidence_coverage',
			expect.objectContaining({
				coverage: expect.objectContaining({ takeoffItemCount: 0 })
			})
		);
		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			expect.any(String),
			'draft_estimate',
			expect.objectContaining({
				issues: expect.arrayContaining([
					expect.objectContaining({ code: 'local_draft_agent_skipped_device_budget' })
				])
			})
		);
	});

	it('records the local drafting subphase when a progressed local run fails', async () => {
		dbServiceMock.getWorkspaceProfile.mockResolvedValue({
			aiPlaybookText: 'Keep bundled canopy pricing as two rows.'
		});
		localAiServiceMock.runDraftRun.mockImplementationOnce(async (request) => {
			request.onProgress?.({
				status: 'drafting',
				draftSubphase: 'composition',
				processedArtifactCount: 1,
				usableArtifactCount: 1,
				totalArtifactCount: 1,
				supportedArtifactCount: 1,
				unsupportedArtifactCount: 0,
				currentArtifactName: null
			});
			throw new Error(
				'ai_failure_kind=timeout; Kwantflow AI drafting exceeded the on-device runtime timeout. Rerun AI or reduce attached evidence for this asset.'
			);
		});

		const { aiState } = await import('./ai.svelte.js');
		await aiState.hydrate();

		await aiState.draftEstimateForAsset({
			asset: {
				id: 'asset-1',
				project_id: 'project-1',
				display_name: 'Main package',
				thumbnail_file_id: null,
				is_selected: true,
				created_at: '2026-03-16T00:00:00Z'
			},
			project: {
				id: 'project-1',
				projectName: 'Factory upgrade',
				rfqNumber: 'RFQ-1001',
				content: 'Fabricate and install steel stairs.',
				note: 'Prefer workshop labour where possible.'
			},
			files: [
				{
					id: 'file-1',
					project_id: 'project-1',
					file_path: '/vault/project-1/rfq.pdf',
					original_name: 'rfq.pdf',
					mime_type: 'application/pdf',
					created_at: '2026-03-16T00:00:00Z'
				}
			],
			currentEstimate: createEstimate('Saved baseline'),
			savedEstimate: null,
			tableSnapshot: {}
		});

		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			expect.any(String),
			'failure_context',
			expect.objectContaining({
				stage: 'composition',
				kind: 'timeout',
				message:
					'Kwantflow AI drafting exceeded the on-device runtime timeout. Rerun AI or reduce attached evidence for this asset.'
			})
		);
	});

	it('recovers from a rejected download without leaving optimistic progress active', async () => {
		const failure = new Error('Download command rejected');
		localAiServiceMock.downloadModel.mockRejectedValue(failure);
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({ installState: 'not_downloaded', modelReady: false })
		);
		const { aiState } = await import('./ai.svelte.js');

		await expect(aiState.downloadLocalAiModel()).rejects.toBe(failure);

		expect(localAiServiceMock.getStatus).toHaveBeenCalledOnce();
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'failed',
			activeDownload: null,
			lastError: failure.message
		});
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it('clears optimistic download state even when the recovery status request also fails', async () => {
		const failure = new Error('Download status was invalid');
		localAiServiceMock.downloadModel.mockRejectedValue(failure);
		localAiServiceMock.getStatus.mockRejectedValue(new Error('Status unavailable'));
		const { aiState } = await import('./ai.svelte.js');

		await expect(aiState.downloadLocalAiModel()).rejects.toBe(failure);

		expect(aiState.localAiStatus).toMatchObject({
			installState: 'failed',
			activeDownload: null,
			lastError: failure.message
		});
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it.each(['failed', 'repair_needed', 'unsupported'] as const)(
		'reports a terminal %s download result as an error without a success toast',
		async (installState) => {
			const status = createLocalStatus({
				installState,
				modelReady: false,
				lastError: 'Local AI setup needs attention'
			});
			localAiServiceMock.downloadModel.mockResolvedValue(status);
			localAiServiceMock.getStatus.mockResolvedValue(status);
			const { aiState } = await import('./ai.svelte.js');

			await expect(aiState.downloadLocalAiModel()).rejects.toThrow(status.lastError!);

			expect(aiState.localAiStatus.installState).toBe(installState);
			expect(toastMock.success).not.toHaveBeenCalled();
		}
	);

	it('keeps real native download progress when a failed invocation is reconciled', async () => {
		const status = createLocalStatus({
			installState: 'downloading',
			modelReady: false,
			activeDownload: {
				stage: 'downloading_model',
				label: 'Downloading Kwantflow AI',
				downloadedBytes: 256_000_000,
				totalBytes: 3_659_530_240,
				percent: 7
			}
		});
		localAiServiceMock.downloadModel.mockRejectedValue(new Error('IPC response interrupted'));
		localAiServiceMock.getStatus.mockResolvedValue(status);
		const { aiState } = await import('./ai.svelte.js');

		await expect(aiState.downloadLocalAiModel()).rejects.toThrow('IPC response interrupted');

		expect(aiState.localAiStatus).toEqual(status);
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it('reports a completed model download as installed', async () => {
		const status = createLocalStatus({ installState: 'installed', modelReady: false });
		localAiServiceMock.downloadModel.mockResolvedValue(status);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.downloadLocalAiModel();

		expect(aiState.localAiStatus).toEqual(status);
		expect(toastMock.success).toHaveBeenCalledWith('Kwantflow AI installed');
	});

	it('cancels an in-progress local model download', async () => {
		localAiServiceMock.getStatus.mockResolvedValue(
			createLocalStatus({
				installState: 'downloading',
				modelReady: false,
				activeDownload: {
					stage: 'downloading_model',
					label: 'Downloading Kwantflow AI',
					downloadedBytes: 256_000_000,
					totalBytes: 5_000_000_000,
					percent: 5.12
				}
			})
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrate();
		await aiState.cancelLocalAiDownload();

		expect(localAiServiceMock.cancelDownload).toHaveBeenCalledTimes(1);
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'downloading',
			modelReady: false,
			activeDownload: expect.objectContaining({
				label: 'Cancelling Kwantflow AI download'
			})
		});
		expect(toastMock.success).toHaveBeenCalledWith('Cancelling Kwantflow AI download');
	});

	it('checks an installed local model without starting the LiteRT engine', async () => {
		localAiServiceMock.verifyLocalAiInstall.mockResolvedValue(
			createLocalStatus({ installState: 'installed', modelReady: false })
		);
		const { aiState } = await import('./ai.svelte.js');

		await aiState.verifyLocalAiInstall();

		expect(localAiServiceMock.verifyLocalAiInstall).toHaveBeenCalledTimes(1);
		expect(localAiServiceMock.ensureLocalAiReady).not.toHaveBeenCalled();
		expect(aiState.localAiStatus).toMatchObject({
			installState: 'installed',
			modelReady: false
		});
		expect(toastMock.success).toHaveBeenCalledWith('Kwantflow AI installed');
	});

	it('cancels an active local drafting run', async () => {
		const { aiState } = await import('./ai.svelte.js');
		aiState['setAssetRunState']('asset-1', {
			runId: 'run-local-active',
			status: 'drafting',
			modelId: 'kwantflow-ai.litertlm',
			isCancelling: false,
			errorMessage: null
		});

		const cancelled = await aiState.cancelRunForAsset('asset-1');

		expect(cancelled).toBe(true);
		expect(localAiServiceMock.cancelActiveRun).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.updateAiRun).toHaveBeenCalledWith(
			'run-local-active',
			expect.objectContaining({
				status: 'cancelled',
				error_message: null
			})
		);
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-local-active',
			status: 'cancelled',
			isCancelling: false
		});
	});

	it('fails a stale interrupted local drafting run during hydration when no draft outputs were persisted', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-local-stale',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'kwantflow-ai.litertlm',
			status: 'drafting',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: null,
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: '2026-03-16T10:00:00.000Z'
		});
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			'run-local-stale',
			'failure_context',
			expect.objectContaining({
				stage: 'interrupted',
				recoveredDuringHydration: true
			})
		);
		expect(dbServiceMock.updateAiRun).toHaveBeenCalledWith(
			'run-local-stale',
			expect.objectContaining({
				status: 'failed'
			})
		);
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-local-stale',
			status: 'failed',
			errorMessage:
				'This AI draft was interrupted before it finished. Rerun AI or keep estimating manually.'
		});
	});

	it('keeps a same-session local drafting run active during hydration when no draft outputs were persisted yet', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-local-fresh',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'kwantflow-ai.litertlm',
			status: 'drafting',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: null,
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: new Date().toISOString()
		});
		const { aiState } = await import('./ai.svelte.js');
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'execution_context') {
				return {
					id: 'input-execution',
					run_id: 'run-local-fresh',
					input_kind: 'execution_context',
					payload: {
						frontendSessionId: aiState['frontendSessionId'],
						frontendBootedAt: '2026-03-16T10:00:00.000Z',
						provider: 'local_litert_lm',
						clientRuntimeId: 'kwantflow-ai.litertlm'
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}

			return null;
		});

		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(dbServiceMock.addAiRunOutput).not.toHaveBeenCalledWith(
			'generated-id',
			'run-local-fresh',
			'failure_context',
			expect.anything()
		);
		expect(dbServiceMock.updateAiRun).not.toHaveBeenCalledWith(
			'run-local-fresh',
			expect.objectContaining({
				status: 'failed'
			})
		);
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-local-fresh',
			status: 'drafting',
			errorMessage: null
		});
	});

	it('fails a reload-orphaned local drafting run immediately when the persisted execution context belongs to an older frontend session', async () => {
		dbServiceMock.getLatestAiRunForAsset.mockResolvedValue({
			id: 'run-local-orphaned',
			asset_id: 'asset-1',
			provider: 'local_litert_lm',
			model_id: 'kwantflow-ai.litertlm',
			status: 'drafting',
			trigger_source: 'asset_editor',
			started_at: '2026-03-16T10:00:00.000Z',
			completed_at: null,
			failed_at: null,
			cancelled_at: null,
			error_message: null,
			usage: {},
			created_at: '2026-03-16T10:00:00.000Z',
			updated_at: new Date().toISOString()
		});
		dbServiceMock.getAiRunInput.mockImplementation(async (_runId: string, inputKind: string) => {
			if (inputKind === 'execution_context') {
				return {
					id: 'input-execution',
					run_id: 'run-local-orphaned',
					input_kind: 'execution_context',
					payload: {
						frontendSessionId: 'older-frontend-session',
						frontendBootedAt: '2026-03-16T10:00:00.000Z',
						provider: 'local_litert_lm',
						clientRuntimeId: 'kwantflow-ai.litertlm'
					},
					created_at: '2026-03-16T10:00:00.000Z'
				};
			}

			return null;
		});
		const { aiState } = await import('./ai.svelte.js');

		await aiState.hydrateLatestRunForAsset('asset-1');

		expect(localAiServiceMock.cancelActiveRun).toHaveBeenCalledTimes(1);
		expect(dbServiceMock.addAiRunOutput).toHaveBeenCalledWith(
			'generated-id',
			'run-local-orphaned',
			'failure_context',
			expect.objectContaining({
				kind: 'reload_interrupted',
				stage: 'interrupted',
				recoveredDuringHydration: true,
				persistedFrontendSessionId: 'older-frontend-session'
			})
		);
		expect(aiState.getAssetRunState('asset-1')).toMatchObject({
			runId: 'run-local-orphaned',
			status: 'failed',
			errorMessage:
				'This AI draft was interrupted before it finished. Rerun AI or keep estimating manually.'
		});
	});
});
