/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const {
	invokeMock,
	invokeTransport,
	listenMock,
	simulateEvent,
	clearEventHandlers,
	mockChannels,
	mockCapabilities
} = vi.hoisted(() => {
	const eventHandlers = new Map<string, Array<({ payload }: { payload: unknown }) => void>>();
	const mockCapabilities = {
		supportsNativeToolCalls: true
	};
	const invokeMock = vi.fn();
	const invokeTransport = async (command: string, args?: Record<string, unknown>) => {
		const result = await (args === undefined ? invokeMock(command) : invokeMock(command, args));
		if (
			(command === 'run_local_ai_completion' || command === 'run_local_ai_completion_stream') &&
			result &&
			typeof result === 'object' &&
			!Array.isArray(result)
		) {
			const request = args?.request as
				{ tools?: Array<{ function?: { name?: string } }> } | undefined;
			const structuredTool = request?.tools?.find((tool) =>
				tool.function?.name?.startsWith('kwantflow_return_')
			);
			const response = result as {
				content?: unknown;
				toolCalls?: unknown[];
				[key: string]: unknown;
			};
			if (
				structuredTool?.function?.name &&
				response.content !== null &&
				typeof response.content === 'object' &&
				(response.toolCalls?.length ?? 0) === 0
			) {
				return {
					...response,
					content: null,
					toolCalls: [
						{
							id: 'mock-structured-call',
							type: 'function',
							function: {
								name: structuredTool.function.name,
								arguments: JSON.stringify(response.content)
							}
						}
					]
				};
			}
		}
		return result;
	};
	return {
		invokeMock,
		invokeTransport,
		listenMock: vi.fn((event: string, handler: ({ payload }: { payload: unknown }) => void) => {
			if (!eventHandlers.has(event)) eventHandlers.set(event, []);
			eventHandlers.get(event)!.push(handler);
			return Promise.resolve(() => {
				const handlers = eventHandlers.get(event);
				if (handlers) {
					const idx = handlers.indexOf(handler);
					if (idx !== -1) handlers.splice(idx, 1);
				}
			});
		}),
		simulateEvent: (event: string, payload: unknown) => {
			const handlers = eventHandlers.get(event);
			if (handlers) {
				for (const handler of handlers) {
					handler({ payload });
				}
			}
		},
		clearEventHandlers: () => {
			eventHandlers.clear();
		},
		mockChannels: [] as Array<{ onmessage?: (message: unknown) => void }>,
		mockCapabilities
	};
});

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeTransport,
	Channel: class {
		onmessage?: (message: unknown) => void;

		constructor() {
			mockChannels.push(this);
		}
	}
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: listenMock
}));

vi.mock('$lib/constants/local-ai-runtime-manifest.js', () => ({
	LocalAiRuntimeCapabilitySchema: { parse: (x: unknown) => x },
	getLocalAiRuntimeCapabilities: () => ({
		supportsConstrainedToolCalls: true,
		supportsNativeToolCalls: mockCapabilities.supportsNativeToolCalls,
		supportsReasoningSeparation: true,
		supportsVisionInputs: false,
		supportsPersistentConversation: false,
		supportsPersistentConversationWithVision: false
	}),
	getEffectiveLocalAiRuntimeCapabilities: () => ({
		supportsConstrainedToolCalls: true,
		supportsNativeToolCalls: mockCapabilities.supportsNativeToolCalls,
		supportsReasoningSeparation: true,
		supportsVisionInputs: false,
		supportsPersistentConversation: false,
		supportsPersistentConversationWithVision: false
	}),
	getLocalAiRuntimeClientId: () => 'kwantflow-ai.litertlm',
	getLocalAiRemoteArtifactFilename: () => 'gemma-4-E4B-it.litertlm',
	localAiRuntimeManifest: {
		version: 2,
		clientRuntimeId: 'kwantflow-ai.litertlm',
		litertLm: {
			capabilities: {
				supportsConstrainedToolCalls: true,
				supportsNativeToolCalls: mockCapabilities.supportsNativeToolCalls,
				supportsReasoningSeparation: true,
				supportsVisionInputs: false,
				supportsPersistentConversation: false,
				supportsPersistentConversationWithVision: false
			}
		}
	}
}));

import {
	buildLocalRuntimeExecutionContext,
	localAiService,
	NATIVE_TOOL_CALLS_DISABLED_MESSAGE,
	repairDraftRunResultHeuristicOutline,
	stripLocalModelIssueNoise,
	buildCompletionArtifacts,
	buildEvidenceBatchExtractionSchema,
	buildLiteRtEvidenceUnitExtractionSchema,
	buildAssetEvidenceRelevanceSchema,
	buildEvidenceInferenceBatches,
	getEvidenceBatchMaxOutputTokens,
	buildSequentialCadBatches,
	buildSequentialEvidenceUnits,
	mergeSequentialEvidenceExtractions,
	buildFileSynthesisCacheKey,
	hasCompleteEvidenceUnitCoverage,
	isExactEvidenceBatchExtraction,
	parseReusableEvidenceCachePayload,
	isLocalAiContextCapacityError,
	shouldOmitDeterministicCadRenderUnit,
	normaliseTakeoffUnitHint
} from './local-ai.js';
import { buildStructuredToolParameters } from './structured-schema.js';
import {
	buildAiAssetContext,
	buildAiOutputContract,
	buildAiProjectContext,
	buildAiReferenceContext,
	buildAiWorkflowRules,
	buildArtifactManifest,
	type AiPreparedArtifact
} from './ai-drafting.js';
import { buildAiEstimateContextSnapshot } from './estimate-ai-context.js';
import { dbService } from './db.js';
import {
	AiDraftRunEstimateSchema,
	AiDraftMatchingSchema,
	AiDraftOutlineSchema
} from '$lib/schemas/index.js';
import type { AiDraftEstimate, LocalAiStatus } from '$lib/types/index.js';

function evidenceBatchContent(
	unitKey: string,
	extraction: {
		summary: string;
		estimatingSignals?: string[];
		candidateItems?: Array<{
			label: string;
			quantityHint?: string | null;
			unitHint?: string | null;
			notes?: string | null;
			evidenceRefs?: unknown[];
		}>;
		issues?: Array<Record<string, unknown>>;
	}
) {
	return {
		units: [
			{
				unitKey,
				contentClass: 'technical_drawing',
				estimatingUtility: 'high',
				summary: extraction.summary,
				estimatingSignals: extraction.estimatingSignals ?? [],
				candidateItems: (extraction.candidateItems ?? []).map((candidate) => ({
					label: candidate.label,
					quantityHint: candidate.quantityHint ?? null,
					unitHint: candidate.unitHint ?? null,
					notes: candidate.notes ?? ''
				})),
				issues: extraction.issues ?? []
			}
		]
	};
}

function createDraft(overrides: Partial<AiDraftEstimate> = {}): AiDraftEstimate {
	return {
		scope_summary: 'Scope',
		notes: '',
		classification_system_id: null,
		wbs_root_node_id: null,
		applied_template_id: null,
		applied_template_name: null,
		takeoff_items: [],
		issues: [],
		...overrides
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
		activeDownload: null,
		lastError: null,
		diagnostics: {
			activeLaunchProfile: 'gpu_preferred',
			startupElapsedMs: 320,
			imageProbeElapsedMs: 42,
			lastCompletionElapsedMs: 810,
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
		...overrides,
		supportsNativeToolCalls: overrides.supportsNativeToolCalls ?? true
	};
}

function makeNativeToolRequest() {
	return {
		type: 'function',
		function: {
			name: 'records_search',
			description: 'Lookup records.',
			parameters: { type: 'object', properties: {} }
		}
	};
}

describe('local AI service', () => {
	it('classifies native context-capacity errors without treating ordinary failures as overflow', () => {
		expect(
			isLocalAiContextCapacityError(new Error('Prompt context length exceeds the limit'))
		).toBe(true);
		expect(isLocalAiContextCapacityError(new Error('RESOURCE_EXHAUSTED: too many tokens'))).toBe(
			true
		);
		expect(isLocalAiContextCapacityError(new Error('Parser returned malformed JSON'))).toBe(false);
	});
	it('builds constrained Draft 7 tool schemas with real Zod 4 limits', () => {
		const parameters = buildStructuredToolParameters(
			z.object({
				mode: z.enum(['strict', 'review']),
				summary: z.string().max(240),
				signals: z.array(z.string()).max(4)
			})
		);
		expect(parameters).toMatchObject({
			type: 'object',
			required: ['mode', 'summary', 'signals'],
			properties: {
				mode: { enum: ['strict', 'review'] },
				summary: { maxLength: 240 },
				signals: { maxItems: 4 }
			}
		});
	});
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(dbService, 'searchPageChunks').mockResolvedValue([]);
		mockCapabilities.supportsNativeToolCalls = true;
	});

	it('builds runtime execution metadata for local runs', () => {
		const litertlmContext = buildLocalRuntimeExecutionContext({
			runtimeStatus: createLocalStatus({
				expectedDownloadBytes: 3659530240,
				runtimeKind: 'litert_lm',
				runtimeVersion: 'litert-lm-v0.16.0',
				modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
				modelArtifactId: 'kwantflow-ai.litertlm',
				modelFileName: 'gemma-4-e4b/model.litertlm',
				mmprojFileName: null
			}),
			evidenceArtifacts: [],
			draftStageMetrics: [
				{
					stage: 'outline',
					elapsedMs: 810,
					timeoutMs: 120_000,
					attemptCount: 1,
					status: 'completed',
					modelId: 'kwantflow-ai.litertlm',
					usage: { totalTokenCount: 48 }
				}
			]
		});

		expect(litertlmContext).toMatchObject({
			runtimeContractVersion: 'local-litert-lm-v1',
			kernelContractVersion: 'local-ai-kernel-v3',
			draftStageMetrics: [
				{
					stage: 'outline',
					elapsedMs: 810,
					timeoutMs: 120_000,
					attemptCount: 1,
					status: 'completed',
					modelId: 'kwantflow-ai.litertlm',
					usage: { totalTokenCount: 48 }
				}
			],
			localRuntime: {
				runtimeKind: 'litert_lm',
				runtimeVersion: 'litert-lm-v0.16.0',
				modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
				modelArtifactId: 'kwantflow-ai.litertlm',
				modelFileName: 'gemma-4-e4b/model.litertlm',
				mmprojFileName: null,
				supportsImageInputs: false
			}
		});
	});

	describe('AI evidence cache build identity', () => {
		function requestFor(
			runtimeStatus?: LocalAiStatus
		): Parameters<typeof localAiService.runDraftRun>[0] {
			const currentEstimate = {
				asset_id: 'cache-asset',
				scope_summary: '',
				notes: '',
				takeoff_items: []
			};
			const contextSnapshot = buildAiEstimateContextSnapshot({
				assetId: 'cache-asset',
				assetName: 'Shaft',
				tableSnapshot: {},
				currentEstimate
			});
			const artifact: AiPreparedArtifact = {
				kind: 'text',
				fileId: 'cache-file',
				fileName: 'scope.txt',
				filePath: '/tmp/scope.txt',
				contentHash: 'unchanged-source-hash',
				textContent: 'Machine one steel shaft.',
				sourceFormat: 'plain_text',
				structureHints: null
			};
			return {
				runId: crypto.randomUUID(),
				runtimeStatus,
				projectContext: buildAiProjectContext({
					projectId: 'cache-project',
					content: artifact.textContent
				}),
				assetContext: buildAiAssetContext({
					assetId: 'cache-asset',
					assetName: 'Shaft',
					currentEstimate,
					contextSnapshot
				}),
				preparedRun: {
					artifacts: [artifact],
					issues: [],
					artifactManifest: buildArtifactManifest([artifact]),
					preprocessProfile: { totalElapsedMs: 0, artifacts: [] },
					progressDetail: {
						currentArtifactName: null,
						processedArtifactCount: 0,
						totalArtifactCount: 1,
						supportedArtifactCount: 1,
						unsupportedArtifactCount: 0
					}
				},
				referenceContext: buildAiReferenceContext({}),
				workflowRules: buildAiWorkflowRules(),
				outputContract: buildAiOutputContract(),
				normalizedTableSnapshot: {},
				estimateContextSnapshot: contextSnapshot,
				promptContract: {
					systemInstructionVersion: 'cache-system',
					extractionPromptVersion: 'cache-extraction',
					draftPromptVersion: 'cache-draft'
				},
				workspaceKnowledgeContext: null
			};
		}

		function respondToModel() {
			invokeMock.mockImplementation(async (_command, args) => ({
				content:
					args?.request?.stage === 'asset_file_relevance'
						? { disposition: 'relevant', reason: 'The shaft is the requested scope.' }
						: {
								unitKey: 'text:plain_text:chunk:1',
								contentClass: 'specification',
								estimatingUtility: 'high',
								summary: 'Machine one steel shaft.',
								estimatingSignalsText: 'Machined steel shaft',
								candidateLabel: 'Machined steel shaft',
								candidateQuantityHint: '1',
								candidateUnitHint: 'ea'
							},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			}));
		}

		it('misses legacy, changed native, changed weights, and changed revision caches while reusing exact identities', async () => {
			const legacyId = 'litert-lm-v0.16.0:kwantflow-ai.litertlm';
			const legacyPayload = JSON.stringify({
				fileId: 'cache-file',
				fileName: 'scope.txt',
				artifactKind: 'text',
				extractionSource: 'model_structured',
				evidenceIdentifiers: ['text:plain_text:chunk:1'],
				summary: 'Legacy shaft interpretation.',
				estimatingSignals: ['Steel shaft'],
				candidateItems: [],
				issues: []
			});
			const files = new Map([[legacyId, legacyPayload]]);
			const units = new Map<string, string>();
			const fileLookup = vi
				.spyOn(dbService, 'lookupCachedExtraction')
				.mockImplementation(
					async (_hash, _file, _contract, identity) => files.get(identity ?? '') ?? null
				);
			const unitLookup = vi
				.spyOn(dbService, 'getCachedEvidenceUnit')
				.mockImplementation(async (input) => units.get(input.modelRuntimeId) ?? null);
			const cacheWrite = vi
				.spyOn(dbService, 'putCachedExtraction')
				.mockImplementation(async (input) => {
					(input.cacheKind === 'file_synthesis' ? files : units).set(
						input.modelRuntimeId,
						JSON.stringify(input.payload)
					);
				});
			respondToModel();
			const status = createLocalStatus({
				runtimeVersion: `litert-lm-v0.16.0+native-sha256:${'a'.repeat(64)}`,
				modelArtifactId: `kwantflow-ai.litertlm@${'b'.repeat(40)}+sha256:${'c'.repeat(64)}`
			});
			try {
				const fresh = await localAiService.runDraftRun(requestFor(status));
				expect(fresh.evidenceCoverage.cachedUnits).toBe(0);
				expect(cacheWrite).toHaveBeenCalledWith(
					expect.objectContaining({
						modelRuntimeId: `${status.runtimeVersion}:${status.modelArtifactId}`
					})
				);
				const unchanged = await localAiService.runDraftRun(requestFor(status));
				expect(unchanged.evidenceCoverage.cachedUnits).toBe(1);
				const nativeChanged = {
					...status,
					runtimeVersion: `litert-lm-v0.16.0+native-sha256:${'d'.repeat(64)}`
				};
				const weightChanged = {
					...nativeChanged,
					modelArtifactId: `kwantflow-ai.litertlm@${'b'.repeat(40)}+sha256:${'e'.repeat(64)}`
				};
				const revisionChanged = {
					...weightChanged,
					modelArtifactId: `kwantflow-ai.litertlm@${'f'.repeat(40)}+sha256:${'e'.repeat(64)}`
				};
				for (const changed of [nativeChanged, weightChanged, revisionChanged]) {
					const regenerated = await localAiService.runDraftRun(requestFor(changed));
					expect(regenerated.evidenceCoverage.cachedUnits).toBe(0);
					expect(fileLookup).toHaveBeenLastCalledWith(
						expect.any(String),
						'cache-file',
						'cache-extraction',
						`${changed.runtimeVersion}:${changed.modelArtifactId}`,
						expect.any(String),
						expect.any(String),
						expect.any(String)
					);
				}
			} finally {
				fileLookup.mockRestore();
				unitLookup.mockRestore();
				cacheWrite.mockRestore();
				invokeMock.mockReset();
			}
		});

		it('does not read or write reusable evidence with an unknown or incomplete runtime identity', async () => {
			const fileLookup = vi.spyOn(dbService, 'lookupCachedExtraction').mockResolvedValue('stale');
			const unitLookup = vi.spyOn(dbService, 'getCachedEvidenceUnit').mockResolvedValue('stale');
			const cacheWrite = vi.spyOn(dbService, 'putCachedExtraction').mockResolvedValue();
			respondToModel();
			try {
				for (const status of [
					undefined,
					createLocalStatus(),
					createLocalStatus({
						runtimeVersion: `litert-lm-v0.16.0+native-sha256:${'a'.repeat(64)}`
					}),
					createLocalStatus({
						runtimeVersion: 'litert-lm-v0.16.0+native-sha256:unknown',
						modelArtifactId: `kwantflow-ai.litertlm@${'b'.repeat(40)}+sha256:${'c'.repeat(64)}`
					})
				]) {
					const result = await localAiService.runDraftRun(requestFor(status));
					expect(result.evidenceCoverage.cachedUnits).toBe(0);
				}
				expect(fileLookup).not.toHaveBeenCalled();
				expect(unitLookup).not.toHaveBeenCalled();
				expect(cacheWrite).not.toHaveBeenCalled();
			} finally {
				fileLookup.mockRestore();
				unitLookup.mockRestore();
				cacheWrite.mockRestore();
				invokeMock.mockReset();
			}
		});
	});

	it('accepts non-streaming tool-call completions with null content', async () => {
		invokeMock.mockResolvedValueOnce({
			content: null,
			modelId: 'kwantflow-ai.litertlm',
			usage: {},
			toolCalls: [
				{
					id: 'call-1',
					type: 'function',
					function: {
						name: 'plan_record_goal',
						arguments: '{"actions":[]}'
					}
				}
			]
		});

		const result = await localAiService.runGroundedCompletion({
			systemInstruction: 'Return a tool call.',
			prompt: 'Plan the next action.'
		});

		expect(result.content).toBeNull();
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].function.name).toBe('plan_record_goal');
	});

	it('accepts ordinary non-streaming text completions', async () => {
		invokeMock.mockResolvedValueOnce({
			content: 'Complete.',
			modelId: 'kwantflow-ai.litertlm',
			usage: {}
		});

		const result = await localAiService.runGroundedCompletion({
			systemInstruction: 'Return a short answer.',
			prompt: 'Say complete.'
		});

		expect(result.content).toBe('Complete.');
		expect(result.toolCalls).toEqual([]);
	});

	it('does not retry a structured task after a native timeout', async () => {
		invokeMock.mockRejectedValue(new Error('LiteRT-LM completion timed out after 90000 ms.'));

		await expect(
			localAiService.runStructuredTask({
				schemaName: 'timeout_contract',
				schema: z.object({ verdict: z.enum(['ok']) }),
				systemInstruction: 'Return the result.',
				messages: [{ role: 'user', content: [{ type: 'text', text: 'Run once.' }] }],
				allowCorrection: true
			})
		).rejects.toThrow('timed out');
		expect(invokeMock).toHaveBeenCalledTimes(1);
	});

	it('accepts Zod-valid direct JSON when Gemma 4 TextAndOr chooses text output', async () => {
		invokeMock.mockResolvedValueOnce({
			content: '{"verdict":"ok"}',
			modelId: 'kwantflow-ai.litertlm',
			usage: {},
			toolCalls: []
		});

		const result = await localAiService.runStructuredTask({
			schemaName: 'text_and_or_contract',
			schema: z.object({ verdict: z.enum(['ok']) }),
			systemInstruction: 'Return the result.',
			messages: [{ role: 'user', content: [{ type: 'text', text: 'Run once.' }] }],
			allowCorrection: false
		});

		expect(result.value).toEqual({ verdict: 'ok' });
		expect(invokeMock).toHaveBeenCalledTimes(1);
	});

	it('rejects direct JSON that fails the same Zod structured contract', async () => {
		invokeMock.mockResolvedValueOnce({
			content: '{"verdict":"invalid"}',
			modelId: 'kwantflow-ai.litertlm',
			usage: {},
			toolCalls: []
		});

		await expect(
			localAiService.runStructuredTask({
				schemaName: 'invalid_text_and_or_contract',
				schema: z.object({ verdict: z.enum(['ok']) }),
				systemInstruction: 'Return the result.',
				messages: [{ role: 'user', content: [{ type: 'text', text: 'Run once.' }] }],
				allowCorrection: false
			})
		).rejects.toThrow('structured output that failed validation');
	});

	it('uses the single correction turn only for invalid structured output', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: null,
				modelId: 'kwantflow-ai.litertlm',
				usage: {},
				toolCalls: [
					{
						id: 'call-invalid',
						type: 'function',
						function: {
							name: 'kwantflow_return_validation_contract',
							arguments: '{"verdict":"invalid"}'
						}
					}
				]
			})
			.mockResolvedValueOnce({
				content: null,
				modelId: 'kwantflow-ai.litertlm',
				usage: {},
				toolCalls: [
					{
						id: 'call-corrected',
						type: 'function',
						function: {
							name: 'kwantflow_return_validation_contract',
							arguments: '{"verdict":"ok"}'
						}
					}
				]
			});

		const result = await localAiService.runStructuredTask({
			schemaName: 'validation_contract',
			schema: z.object({ verdict: z.enum(['ok']) }),
			systemInstruction: 'Return the result.',
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'Correct invalid output once.' }] }
			],
			allowCorrection: true
		});

		expect(result.value).toEqual({ verdict: 'ok' });
		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(invokeMock.mock.calls[1]?.[1]?.request.messages).toHaveLength(2);
	});

	it('fetches local AI capabilities dynamically from Rust', async () => {
		const mockCapabilities = {
			supportsConstrainedToolCalls: true,
			supportsNativeToolCalls: true,
			supportsReasoningSeparation: true,
			supportsVisionInputs: false,
			supportsPersistentConversation: false,
			supportsPersistentConversationWithVision: false
		};

		invokeMock.mockResolvedValueOnce(mockCapabilities);

		const result = await localAiService.getCapabilities();

		expect(invokeMock).toHaveBeenCalledWith('get_local_ai_capabilities_command');
		expect(result).toEqual(mockCapabilities);
	});

	it('rejects non-streaming native tool requests when runtime capability disables them', async () => {
		mockCapabilities.supportsNativeToolCalls = false;
		await expect(
			localAiService.runCompletion({
				systemInstruction: 'Use a tool.',
				messages: [{ role: 'user', content: 'lookup Hogwards' }],
				tools: [makeNativeToolRequest()],
				parseToolCalls: true
			})
		).rejects.toThrow(NATIVE_TOOL_CALLS_DISABLED_MESSAGE);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('rejects streaming native tool requests when runtime capability disables them', () => {
		mockCapabilities.supportsNativeToolCalls = false;
		expect(() =>
			localAiService.runGroundedCompletionStream({
				systemInstruction: 'Use a tool.',
				messages: [{ role: 'user', content: 'lookup Hogwards' }],
				tools: [makeNativeToolRequest()],
				parseToolCalls: true
			})
		).toThrow(NATIVE_TOOL_CALLS_DISABLED_MESSAGE);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('rejects persistent tool conversations when runtime capability is unverified', async () => {
		mockCapabilities.supportsNativeToolCalls = false;
		await expect(
			localAiService.startConversation({
				systemInstruction: 'Use verified tools only.',
				tools: [makeNativeToolRequest()],
				messages: []
			})
		).rejects.toThrow(NATIVE_TOOL_CALLS_DISABLED_MESSAGE);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('rejects native tool requests that use the obsolete prompt transport', async () => {
		await expect(
			localAiService.runCompletion({
				systemInstruction: 'Use a tool.',
				prompt: 'lookup Hogwards',
				tools: [makeNativeToolRequest()],
				parseToolCalls: true
			})
		).rejects.toThrow(
			'Native tool requests must use the canonical messages transport without prompt.'
		);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('rejects malformed non-streaming completion content', async () => {
		invokeMock.mockResolvedValueOnce({
			content: ['not', 'a', 'valid', 'completion', 'content'],
			modelId: 'kwantflow-ai.litertlm',
			usage: {}
		});

		await expect(
			localAiService.runGroundedCompletion({
				systemInstruction: 'Return a short answer.',
				prompt: 'Say complete.'
			})
		).rejects.toThrow();
	});

	it('strips generic placeholder issue entries while keeping meaningful local warnings', () => {
		const filtered = stripLocalModelIssueNoise(
			createDraft({
				issues: [
					{
						code: 'local_model_issue',
						message: 'Local AI flagged a review item at position 1.',
						severity: 'warning',
						fileId: null,
						fileName: null
					},
					{
						code: 'local_model_issue',
						message: 'Review canopy labour quantity before finalising.',
						severity: 'warning',
						fileId: null,
						fileName: null
					},
					{
						code: 'semantic_takeoff_component_seed',
						message: 'A linked labour row was seeded from the takeoff item.',
						severity: 'info',
						fileId: null,
						fileName: null
					}
				]
			})
		);

		expect(filtered.issues).toEqual([
			expect.objectContaining({
				code: 'local_model_issue',
				message: 'Review canopy labour quantity before finalising.'
			}),
			expect.objectContaining({
				code: 'semantic_takeoff_component_seed'
			})
		]);
	});

	it('drops contradictory quantity and rate-validation warnings when the structured draft already resolves them', () => {
		const filtered = stripLocalModelIssueNoise(
			createDraft({
				takeoff_items: [
					{
						name: 'Structural Steel Canopy Fabrication Package',
						description: 'Bundled fabrication supply package for the structural steel canopy.',
						quantity: 1,
						unit: 'lot',
						sort_order: 0,
						cost_code_id: null,
						wbs_node_id: null,
						applied_preset_id: null,
						applied_preset_name: null,
						properties: {},
						cost_components: [],
						evidence_refs: [],
						confidence: { overall: 0.4, extraction: 0.4, mapping: 0.1, quantity: 0.8 },
						open_questions: []
					}
				],
				issues: [
					{
						code: 'local_model_issue',
						message:
							"Quantities for takeoff items were not provided in the evidence. Please provide measurable quantities for 'Structural Steel Canopy Fabrication Package'.",
						severity: 'warning',
						fileId: null,
						fileName: null
					},
					{
						code: 'local_model_issue',
						message:
							"The unit rate for the 'Site installation crew' (LAB-INSTALL-001) is available but requires commercial validation.",
						severity: 'warning',
						fileId: null,
						fileName: null
					},
					{
						code: 'local_model_issue',
						message: 'Review canopy labour quantity before finalising.',
						severity: 'warning',
						fileId: null,
						fileName: null
					}
				]
			})
		);

		expect(filtered.issues).toEqual([
			expect.objectContaining({
				code: 'local_model_issue',
				message: 'Review canopy labour quantity before finalising.'
			})
		]);
	});

	it('drops PDF inline-image reference noise that no longer reflects the prepared local evidence path', () => {
		const filtered = stripLocalModelIssueNoise(
			createDraft({
				issues: [
					{
						code: 'Q002',
						message: 'The attached image [img-1] was mentioned but not provided for extraction.',
						severity: 'info',
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf'
					},
					{
						code: 'Q001',
						message: 'Installer count is present but duration needs clarification.',
						severity: 'warning',
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf'
					}
				]
			})
		);

		expect(filtered.issues).toEqual([
			expect.objectContaining({
				code: 'Q001',
				message: 'Installer count is present but duration needs clarification.'
			})
		]);
	});

	it('drops PDF inline-image reference noise from persisted local artifact extractions as well', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('pdf:text:1', {
					summary: 'Canopy notes extracted.',
					estimatingSignals: ['bundled canopy package'],
					candidateItems: [],
					issues: [
						{
							code: 'Q002',
							message: 'The attached image [img-1] was mentioned but not provided for extraction.',
							severity: 'info',
							fileId: 'file-pdf',
							fileName: 'spec-sheet.pdf'
						},
						{
							code: 'Q001',
							message: 'Installer count is present but duration needs clarification.',
							severity: 'warning',
							fileId: 'file-pdf',
							fileName: 'spec-sheet.pdf'
						}
					]
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabricate and install the canopy package.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {},
				diagnostics: {
					elapsedMs: 880,
					expectedDownloadBytes: 3659530240,
					runtimeKind: 'litert_lm',
					timeoutSeconds: 180,
					requestArtifactCount: 0,
					requestImageCount: 0,
					promptCharacterCount: 1200,
					timings: {
						promptTokenCount: 100,
						predictedTokenCount: 40,
						cacheTokenCount: 12,
						promptMs: 125,
						predictedMs: 450,
						promptPerSecond: 80,
						predictedPerSecond: 88.8
					}
				}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-extraction-noise',
			projectContext: {
				projectName: 'Extraction Noise Project',
				rfqNumber: 'RFQ-EXTRACTION-NOISE',
				rfqBrief: 'PDF extraction cleanup scope.'
			},
			assetContext: {
				assetId: 'asset-extraction-noise',
				assetName: 'Extraction Noise Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'pdf',
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf',
						filePath: '/tmp/spec-sheet.pdf',
						mimeType: 'application/pdf',
						textContent: 'Installer count is present but duration needs clarification.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf',
						filePath: '/tmp/spec-sheet.pdf',
						kind: 'pdf',
						mimeType: 'application/pdf',
						bytes: 1024
					}
				]
			},
			referenceContext: {
				classificationSystems: [],
				costCodes: [],
				materials: [],
				labourRates: [],
				equipmentRates: [],
				subcontractRates: [],
				costComponentPresets: [],
				estimateTemplates: [],
				projectStructureTemplates: [],
				projectStructureNodes: []
			},
			workflowRules: {
				unresolvedMappingPolicy: 'issue',
				quoteMathAuthority: 'local_quote_engine',
				confidenceScale: ['low', 'medium', 'high']
			},
			outputContract: {
				estimateDraftVersion: 'kwantflow_estimate_draft_v1',
				supportedComponentCategories: ['material', 'labour', 'equipment', 'subcontract', 'other'],
				confidenceFields: ['overall', 'extraction', 'mapping', 'quantity']
			},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				project_context: {
					projectId: 'project-extraction-noise',
					projectName: 'Extraction Noise Project',
					rfqNumber: 'RFQ-EXTRACTION-NOISE',
					rfqBrief: 'PDF extraction cleanup scope.'
				},
				asset_context: {
					assetId: 'asset-extraction-noise',
					assetName: 'Extraction Noise Asset',
					quoteQuantity: 1,
					isPdfIncluded: true
				},
				reference_context: {
					classification_systems: [],
					cost_codes: [],
					materials: [],
					labour_rates: [],
					equipment_rates: [],
					subcontract_rates: [],
					cost_component_presets: [],
					estimate_templates: [],
					project_structure_templates: [],
					project_structure_nodes: []
				},
				workspace_knowledge_context: null
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2',
				draftSchemaVersion: 'kwantflow_estimate_draft_v1',
				artifactExtractionPromptVersion: 'artifact-extraction-v1'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.extractions[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'Q001',
					message: 'Installer count is present but duration needs clarification.'
				}),
				expect.objectContaining({ code: 'deterministic_candidate_recovery' })
			])
		);
		expect(result.extractions[0]?.issues).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'Q002' })])
		);
		expect(result.draftStageMetrics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: 'outline',
					status: 'completed',
					elapsedMs: 880,
					timings: expect.objectContaining({
						promptTokenCount: 100,
						predictedTokenCount: 40,
						cacheTokenCount: 12,
						predictedPerSecond: 88.8
					})
				}),
				expect.objectContaining({ stage: 'matching', modelId: 'deterministic_local' }),
				expect.objectContaining({ stage: 'composition', modelId: 'deterministic_local' }),
				expect.objectContaining({ stage: 'validation', modelId: 'deterministic_local' })
			])
		);
	});

	it('normalises loose local outline unit strings before deterministic composition', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					summary: 'Canopy package.',
					estimatingSignals: ['bundled canopy package'],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled fabrication and install package.',
							evidenceRefs: []
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabricate and install the structural steel canopy package.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [
						{
							name: 'Structural steel canopy package',
							description: 'Bundled canopy package.',
							quantity: 1,
							unit: 'lump sum',
							sort_order: 0,
							cost_components: [
								{
									category: 'material',
									name: 'Structural steel canopy package',
									description: 'Bundled canopy fabrication supply package.',
									quantity: 1,
									unit: 'lump sum',
									rate_hint: 12500,
									sort_order: 0,
									evidence_refs: [],
									confidence: {
										overall: 0.6,
										extraction: 0.6,
										mapping: 0.2,
										quantity: 0.8
									}
								},
								{
									category: 'labour',
									name: 'Site installation crew',
									description: 'Two installers for canopy installation.',
									quantity: 14,
									unit: 'days.',
									rate_hint: 0,
									sort_order: 1,
									evidence_refs: [],
									confidence: {
										overall: 0.6,
										extraction: 0.6,
										mapping: 0.2,
										quantity: 0.8
									}
								}
							],
							evidence_refs: [],
							confidence: {
								overall: 0.6,
								extraction: 0.6,
								mapping: 0.2,
								quantity: 0.8
							},
							open_questions: []
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-units',
			projectContext: {
				projectName: 'Henderson Logistics Canopy',
				rfqNumber: 'RFQ-1',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-1',
				assetName: 'Henderson Logistics Canopy Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Fabricate and install a structural steel canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateItems: { totalAvailableCount: 0, items: [] },
				equipmentRateItems: { totalAvailableCount: 0, items: [] },
				costComponentPresets: { totalAvailableCount: 0, items: [] },
				estimateTemplates: { totalAvailableCount: 0, items: [] }
			},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draft.takeoff_items[0]?.unit).toBe('fixed');
		expect(result.draft.takeoff_items[0]?.cost_components[0]?.unit).toBe('fixed');
		expect(result.draft.takeoff_items[0]?.cost_components[1]?.unit).toBe('day');
	});

	it('normalises weak labour candidate unit hints from local extraction before outlining', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('text:plain_text:chunk:1', {
					summary: 'Canopy package.',
					estimatingSignals: ['bundled canopy package'],
					candidateItems: [
						{
							label: 'Structural steel entry canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled fabrication and install package.',
							evidenceRefs: []
						},
						{
							label: 'Site installation crew',
							quantityHint: '2',
							unitHint: 'installers for 7 days',
							notes: 'For site installation.',
							evidenceRefs: []
						},
						{
							label: 'Installers',
							quantityHint: '2',
							unitHint: 'person/day',
							notes: 'Site installation crew for 7 days.',
							evidenceRefs: []
						}
					],
					issues: []
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabricate and install the structural steel canopy package.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-labour-candidate-normalisation',
			projectContext: {
				projectName: 'Henderson Logistics Canopy',
				rfqNumber: 'RFQ-1',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-1',
				assetName: 'Henderson Logistics Canopy Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Fabricate and install a structural steel canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateItems: { totalAvailableCount: 0, items: [] },
				equipmentRateItems: { totalAvailableCount: 0, items: [] },
				costComponentPresets: { totalAvailableCount: 0, items: [] },
				estimateTemplates: { totalAvailableCount: 0, items: [] }
			},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.extractions[0]?.candidateItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'Site installation crew',
					quantityHint: '14',
					unitHint: 'day'
				}),
				expect.objectContaining({
					label: 'Installers',
					quantityHint: '14',
					unitHint: 'day'
				})
			])
		);
	});

	it('uses the staged outline prompt and deterministic local matching/composition flow', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					units: [
						{
							unitKey: 'text:plain_text:chunk:1',
							contentClass: 'specification',
							estimatingUtility: 'high',
							summary: 'Canopy fabrication package.',
							estimatingSignals: ['fabricate canopy package'],
							candidateItems: [
								{
									label: 'Structural steel canopy package',
									quantityHint: '1',
									unitHint: 'lot',
									notes: 'Bundled fabrication package.'
								}
							],
							issues: []
						}
					]
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabricate and install the structural steel canopy package.',
					notes: 'Review labour split before final save.',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [
						{
							name: 'Structural steel canopy package',
							description: 'Bundled canopy fabrication and installation package.',
							quantity: 1,
							unit: 'lot',
							sort_order: 0,
							cost_components: [
								{
									category: 'material',
									name: 'Structural steel canopy package',
									description: 'Bundled canopy fabrication supply package.',
									quantity: 1,
									unit: 'lot',
									rate_hint: 1000,
									sort_order: 0,
									evidence_refs: [],
									confidence: {
										overall: 0.6,
										extraction: 0.6,
										mapping: 0.2,
										quantity: 0.8
									}
								}
							],
							evidence_refs: [],
							confidence: {
								overall: 0.6,
								extraction: 0.6,
								mapping: 0.2,
								quantity: 0.8
							},
							open_questions: []
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const onProgress = vi.fn();
		const result = await localAiService.runDraftRun({
			runId: 'run-local-1',
			projectContext: {
				projectName: 'Henderson Logistics Canopy',
				rfqNumber: 'RFQ-1',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-1',
				assetName: 'Henderson Logistics Canopy Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Fabricate and install a structural steel canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.',
						evidenceIdentifiers: ['text:plain_text:chunk:1']
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null,
			onProgress
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(3);
		expect(invokeMock.mock.calls[1]?.[1]?.request?.messages).toEqual([
			expect.objectContaining({
				role: 'user',
				content: expect.arrayContaining([
					expect.objectContaining({
						type: 'text',
						text: expect.stringContaining('Stage: draft_outline.')
					})
				])
			})
		]);
		expect(invokeMock.mock.calls[1]?.[1]?.request?.messages?.[0]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					text: expect.stringContaining('call kwantflow_return_draft_outline exactly once')
				})
			])
		);
		expect(invokeMock.mock.calls[1]?.[1]?.request?.messages?.[0]?.content?.[0]?.text).toContain(
			'"evidenceIdentifiers":["text:plain_text:chunk:1"]'
		);
		expect(invokeMock.mock.calls[1]?.[1]?.request?.prompt).toBeNull();
		expect(invokeMock.mock.calls[0]?.[1]?.request).toMatchObject({ parseToolCalls: true });
		expect(invokeMock.mock.calls[0]?.[1]?.request).not.toHaveProperty('toolChoice');
		expect(invokeMock.mock.calls[0]?.[1]?.request?.tools?.[0]?.function?.parameters).toBeDefined();
		expect(invokeMock.mock.calls[0]?.[1]?.request?.tools?.[0]?.function?.parameters).toMatchObject({
			type: 'object',
			required: ['units'],
			properties: {
				units: expect.objectContaining({
					minItems: 1,
					maxItems: 1,
					items: expect.objectContaining({
						properties: expect.objectContaining({
							unitKey: { type: 'string', enum: ['text:plain_text:chunk:1'] }
						})
					})
				})
			}
		});
		expect(result.draftOutline).toMatchObject({
			scope_summary: 'Fabricate and install the structural steel canopy package.'
		});
		expect(result.draftMatching).toMatchObject({
			takeoff_items: [
				expect.objectContaining({
					cost_components: [
						expect.objectContaining({
							source_type: 'manual',
							match_strategy: 'local_outline_seed'
						})
					]
				})
			]
		});
		expect(result.draft.takeoff_items[0]?.cost_components[0]?.metadata).toMatchObject({
			ai_match_strategy: 'local_outline_seed'
		});
		expect(result.runtimeExecutionContext.evidenceArtifacts[0]).toMatchObject({
			fileId: 'file-1',
			evidenceIdentifiers: ['text:plain_text:chunk:1']
		});
		expect(result.draft.takeoff_items[0]).toMatchObject({
			confidence: expect.objectContaining({
				overall: 0.25,
				extraction: 0.2,
				quantity: 0.2
			}),
			open_questions: expect.arrayContaining([
				'Confirm source evidence before using this Local AI draft item.'
			])
		});
		expect(result.draft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			mapping_status: 'unresolved',
			confidence: expect.objectContaining({
				overall: 0.25,
				extraction: 0.2,
				quantity: 0.2
			})
		});
		expect(result.draft.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_draft_missing_evidence_ref'
				})
			])
		);
		expect(result.extractions[0]).toMatchObject({
			extractionSource: 'model_structured',
			candidateItems: [
				expect.objectContaining({
					evidenceState: {
						hasEvidenceRefs: true,
						unresolvedReasons: []
					}
				})
			]
		});
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'extracting',
				currentArtifactName: 'scope.txt',
				processedArtifactCount: 0
			})
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'drafting',
				draftSubphase: 'outline'
			})
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'drafting',
				draftSubphase: 'matching'
			})
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'drafting',
				draftSubphase: 'composition'
			})
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'drafting',
				draftSubphase: 'validation'
			})
		);
	});

	it('seeds mechanical CAD fallback candidates as material rows with filename quantities', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: JSON.stringify({ disposition: 'irrelevant', reason: 'Fixture is unrelated.' }),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: JSON.stringify({ disposition: 'irrelevant', reason: 'Fixture is unrelated.' }),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-cad-material-fallback',
			projectContext: {
				projectName: 'Mechanical RFQ',
				rfqNumber: 'RFQ-CAD',
				rfqBrief: 'Estimate supplied STEP components.'
			},
			assetContext: {
				assetId: 'asset-cad',
				assetName: 'CAD components',
				quoteQuantity: 1,
				isPdfIncluded: false
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'cad',
						fileId: 'cad-1',
						fileName: 'MS WASHER X 2.STEP',
						filePath: '/tmp/MS WASHER X 2.STEP',
						metadata: {},
						renders: [],
						summaryText:
							'Prepared CAD mesh evidence for a mild steel washer. Extents and geometry should be reviewed before final save.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'cad-1',
						fileName: 'MS WASHER X 2.STEP',
						filePath: '/tmp/MS WASHER X 2.STEP',
						artifactKind: 'cad',
						aiRole: 'cad_evidence',
						extractionMode: 'cad_renders',
						inclusionReason: 'Included as CAD evidence.',
						evidenceIdentifiers: ['cad:metadata']
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline?.takeoff_items[0]).toMatchObject({
			name: 'MS WASHER',
			quantity: 2,
			unit: 'ea',
			cost_components: [
				expect.objectContaining({
					category: 'material',
					name: 'MS WASHER',
					evidence_refs: [
						expect.objectContaining({
							file_id: 'cad-1',
							evidence_identifier: 'cad:metadata'
						})
					]
				})
			]
		});
	});

	it('skips the native Draft refinement agent for local LiteRT runs until the tool-turn benchmark is reliable', async () => {
		invokeMock.mockResolvedValueOnce({
			content: null,
			modelId: 'kwantflow-ai.litertlm',
			usage: {},
			toolCalls: [
				{
					id: 'call-evidence-relevance',
					type: 'function',
					function: {
						name: 'kwantflow_return_asset_file_relevance',
						arguments: JSON.stringify({
							disposition: 'irrelevant',
							reason: 'This drawing belongs to a different asset.'
						})
					}
				}
			]
		});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-draft-agent-device-budget',
			projectContext: {
				projectName: 'Mechanical RFQ',
				rfqNumber: 'RFQ-DWG',
				rfqBrief: 'Estimate supplied DWG component.'
			},
			assetContext: {
				assetId: 'asset-dwg',
				assetName: 'DWG component',
				quoteQuantity: 1,
				isPdfIncluded: false
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'cad',
						fileId: 'dwg-1',
						fileName: 'playseat.dwg',
						filePath: '/tmp/playseat.dwg',
						metadata: { format: 'dwg', entityCount: 9, edgeCount: 9 },
						renders: [{ viewLabel: 'drawing', mimeType: 'image/jpeg', data: 'base64-drawing' }],
						summaryText:
							'DWG CAD evidence prepared for AI drafting. Rendered 1 drawing views from wire or line geometry. Edge count: 9. Detected drawing entities: 9.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'dwg-1',
						fileName: 'playseat.dwg',
						filePath: '/tmp/playseat.dwg',
						artifactKind: 'cad',
						aiRole: 'cad_evidence',
						extractionMode: 'cad_renders',
						inclusionReason: 'Included as CAD evidence.',
						evidenceIdentifiers: ['cad:metadata', 'cad:render:drawing']
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				mappingTargets: {
					classificationSystems: { records: [] },
					costCodes: { records: [] },
					wbsNodes: { records: [] }
				},
				catalogueSources: {
					materials: {
						records: [{ id: 'mat-1', code: 'PLAYSEAT', name: 'Playseat', unit: 'ea' }]
					}
				},
				rateSources: {
					labourRates: { records: [] },
					equipmentRates: { records: [] },
					subcontractRates: { records: [] }
				},
				draftingPatterns: {
					estimateTemplates: { records: [] },
					costComponentPresets: { records: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			runtimeStatus: createLocalStatus({ supportsNativeToolCalls: true }),
			workspaceKnowledgeContext: null
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(1);
		expect(invokeMock.mock.calls[0]?.[1]?.request).toMatchObject({
			stage: 'asset_file_relevance',
			enableThinking: false,
			workloadClass: 'user_batch'
		});
		expect(invokeMock.mock.calls[0]?.[1]?.request.systemInstruction).toContain(
			'local evidence-relevance utility'
		);
		expect(invokeMock.mock.calls[0]?.[1]?.request.systemInstruction).not.toContain('<|think|>');
		expect(result.extractions[0]).toMatchObject({
			fileId: 'dwg-1',
			runDisposition: 'irrelevant',
			evidenceIdentifiers: ['cad:metadata'],
			candidateItems: [
				expect.objectContaining({
					evidenceRefs: [
						expect.objectContaining({ evidence_identifier: 'cad:metadata', view_label: null })
					]
				})
			]
		});
		expect(result.draft.takeoff_items).toEqual([]);
		expect(result.draftAgentSteps).toEqual([]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'local_draft_agent_skipped_device_budget' })
			])
		);
	});

	it('keeps a DWG or DXF render required when deterministic metadata reports no entities', () => {
		const renderUnit = {
			key: 'cad:render:drawing',
			artifacts: [
				{ kind: 'image' as const, mimeType: 'image/jpeg', base64Data: 'drawing' },
				{ kind: 'text' as const, textContent: 'drawing' }
			]
		};
		const artifact = {
			kind: 'cad' as const,
			fileId: 'dwg-empty-metadata',
			fileName: 'drawing.dwg',
			filePath: '/tmp/drawing.dwg',
			metadata: { format: 'dwg' as const, entityCount: 0, edgeCount: 0 },
			renders: [{ viewLabel: 'drawing', mimeType: 'image/jpeg', data: 'drawing' }],
			summaryText:
				'DWG CAD evidence prepared for AI drafting. Rendered 1 drawing view. Entities: 0, layers: 0.'
		};

		expect(
			shouldOmitDeterministicCadRenderUnit({
				artifact: artifact as never,
				evidenceUnit: renderUnit
			})
		).toBe(false);
		expect(
			shouldOmitDeterministicCadRenderUnit({
				artifact: {
					...artifact,
					metadata: { ...artifact.metadata, entityCount: 17, edgeCount: 17 }
				} as never,
				evidenceUnit: renderUnit
			})
		).toBe(true);
	});

	it('keeps the native LiteRT Draft refinement gate disabled', () => {
		const source = readFileSync('src/lib/services/local-ai.ts', 'utf8');

		expect(source).toContain('const LOCAL_AI_ENABLE_LITERT_DRAFT_REFINEMENT = false;');
	});

	it('uses deterministic prepared-text extraction when the model returns an empty extraction payload', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					summary: '',
					estimatingSignals: [],
					candidateItems: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Heuristic canopy scope.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-heuristic-extraction',
			projectContext: {
				projectName: 'Heuristic Project',
				rfqNumber: 'RFQ-H1',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-h1',
				assetName: 'Heuristic Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-h1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: `# Henderson Logistics canopy package

- Fabricate and install one structural steel canopy package for the warehouse expansion.
- Structural steel canopy package: 1 lot
- Site installation crew: 2 installers for 7 days`
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-h1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.extractions[0]).toMatchObject({
			extractionSource: 'deterministic_extraction',
			summary:
				'Fabricate and install one structural steel canopy package for the warehouse expansion.',
			estimatingSignals: expect.arrayContaining([
				'Fabricate and install one structural steel canopy package for the warehouse expansion.',
				'Structural steel canopy package: 1 lot'
			]),
			candidateItems: expect.arrayContaining([
				expect.objectContaining({
					label: 'Structural steel canopy package',
					quantityHint: '1',
					unitHint: 'lot'
				})
			]),
			issues: expect.arrayContaining([
				expect.objectContaining({ code: 'deterministic_text_extraction' })
			])
		});
		const draftOutline = result.draftOutline!;
		expect(draftOutline.takeoff_items).toHaveLength(1);
		expect(draftOutline.takeoff_items[0]).toMatchObject({
			name: 'Structural steel canopy package',
			quantity: 1,
			unit: 'lot'
		});
		expect(draftOutline.takeoff_items[0]?.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Structural steel canopy package',
					category: 'material'
				}),
				expect.objectContaining({
					name: 'Site installation crew',
					category: 'labour',
					quantity: 14,
					unit: 'day'
				})
			])
		);
	});

	it('uses deterministic prepared-text extraction when the model returns prose instead of extraction json', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content:
					'This appears to be a model identifier, likely for a specific version of the Gemma model family.',
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Heuristic canopy scope.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-heuristic-prose-extraction',
			projectContext: {
				projectName: 'Heuristic Project',
				rfqNumber: 'RFQ-H2',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-h2',
				assetName: 'Heuristic Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-h2',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: `# Henderson Logistics canopy package

- Fabricate and install one structural steel canopy package for the warehouse expansion.
- Structural steel canopy package: 1 lot
- Site installation crew: 2 installers for 7 days`
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-h2',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.',
						evidenceIdentifiers: ['text:plain_text:chunk:1']
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.extractions[0]).toMatchObject({
			evidenceIdentifiers: ['text:plain_text:chunk:1'],
			summary:
				'Fabricate and install one structural steel canopy package for the warehouse expansion.',
			issues: [expect.objectContaining({ code: 'deterministic_text_extraction' })]
		});
		const outlinePromptRequest = JSON.stringify(invokeMock.mock.calls[1]?.[1]?.request);
		expect(outlinePromptRequest).toContain('evidenceIdentifiers');
		expect(outlinePromptRequest).toContain('text:plain_text:chunk:1');
	});

	it('rejects alternative extraction shapes outside the canonical batch contract', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					projectContext: {
						projectName: 'Heuristic Project',
						rfqNumber: 'RFQ-H1',
						rfqBrief: 'Fabricate and install a structural steel canopy.'
					},
					assetContext: {
						assetName: 'Heuristic Asset'
					},
					extractedEvidence: {
						scopeFacts: [
							'Fabricate and install one structural steel canopy package for the warehouse expansion.'
						],
						candidateLineItems: ['Structural steel canopy package'],
						quantities: [
							{
								description: 'Structural steel canopy package',
								quantity: 1,
								unit: 'lot'
							}
						],
						labourHints: [
							{
								description: 'Site installation crew',
								quantity: 2,
								duration: '7 days'
							}
						],
						conditionsAndNotes: ['Apply after-hours premium only when site access requires it.'],
						unresolvedQuestions: ['Confirm whether after-hours access is required.']
					}
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Normalised canopy scope.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-shape-normalisation',
			projectContext: {
				projectName: 'Heuristic Project',
				rfqNumber: 'RFQ-H1',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-h1',
				assetName: 'Heuristic Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-h1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'placeholder'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-h1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.extractions[0]).toMatchObject({
			extractionSource: 'deterministic_extraction',
			candidateItems: [],
			issues: [expect.objectContaining({ code: 'deterministic_text_extraction' })]
		});
	});

	it('falls back to a seeded outline when the outline stage returns prose instead of json', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('text:plain_text:chunk:1', {
					summary: 'Fabricate and install one structural steel canopy package.',
					estimatingSignals: [
						'Fabricate and install one structural steel canopy package.',
						'Structural steel canopy package: 1 lot',
						'Site installation crew: 2 installers for 7 days'
					],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled fabrication package.',
							evidenceRefs: []
						},
						{
							label: 'Site installation crew',
							quantityHint: '14',
							unitHint: 'day',
							notes: '2 installers for 7 days',
							evidenceRefs: []
						}
					],
					issues: []
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content:
					'This appears to be a model identifier, likely for a specific version of the Gemma model family.',
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-outline-prose-fallback',
			projectContext: {
				projectName: 'Fallback Project',
				rfqNumber: 'RFQ-FALLBACK',
				rfqBrief: 'Fabricate and install a structural steel canopy.'
			},
			assetContext: {
				assetId: 'asset-fallback',
				assetName: 'Fallback Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-fallback',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Fabricate and install one structural steel canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-fallback',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline).toBeTruthy();
		const draftOutline = result.draftOutline!;
		expect(draftOutline.takeoff_items).toHaveLength(1);
		expect(draftOutline.takeoff_items[0]).toMatchObject({
			name: 'Structural steel canopy package',
			quantity: 1,
			unit: 'lot'
		});
		expect(draftOutline.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_outline_shape_repaired',
					message: expect.stringContaining('failed validation')
				})
			])
		);
	});

	it('uses deterministic outline fallback when the primary local outline request fails', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('text:plain_text:chunk:1', {
					summary: 'Canopy package.',
					estimatingSignals: [],
					candidateItems: [],
					issues: []
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockRejectedValueOnce(
				new Error('Local AI request returned an error: HTTP 400 — context size exceeded')
			);

		const result = await localAiService.runDraftRun({
			runId: 'run-local-2',
			projectContext: {
				projectName: 'Fallback Project',
				rfqNumber: 'RFQ-2',
				rfqBrief: 'Fallback canopy scope.'
			},
			assetContext: {
				assetId: 'asset-2',
				assetName: 'Fallback Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-2',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Fallback canopy scope.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-2',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(3);
		expect(invokeMock.mock.calls[2]?.[1]?.request?.messages?.[0]?.content).not.toContain(
			'Stage: draft_outline_fallback.'
		);
		expect(result.draft.scope_summary).toBe('Canopy package.');
		expect(result.draft.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_outline_shape_repaired',
					message: expect.stringContaining('context size exceeded')
				})
			])
		);
	});

	it('repairs partial local outline payloads so drafting still completes', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					summary: 'Canopy evidence extracted.',
					estimatingSignals: ['canopy package'],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled canopy fabrication package.',
							evidenceRefs: []
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scopeSummary: 'Install canopy package.',
					takeoffItems: [
						{
							name: 'Structural steel canopy package',
							quantity: '1',
							unit: 'lot',
							components: [
								{
									name: 'Canopy package',
									quantity: '1',
									unit: 'lot',
									category: 'material'
								}
							]
						}
					]
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-repair-shape',
			projectContext: {
				projectName: 'Repair Shape Project',
				rfqNumber: 'RFQ-3',
				rfqBrief: 'Repair local outline shape.'
			},
			assetContext: {
				assetId: 'asset-3',
				assetName: 'Repair Shape Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-3',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Install canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-3',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draft.scope_summary).toContain('Install canopy package');
		expect(result.draft.takeoff_items.length).toBeGreaterThan(0);
		expect(result.draft.takeoff_items[0]?.cost_components.length).toBeGreaterThan(0);
	});

	it('replaces semantically empty local outline items with seeded extraction structure', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('text:plain_text:chunk:1', {
					summary: 'Canopy evidence extracted.',
					estimatingSignals: [
						'Structural steel canopy package: 1 lot',
						'Site installation crew: 2 installers for 7 days'
					],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled canopy fabrication package.',
							evidenceRefs: []
						},
						{
							label: 'Site installation crew',
							quantityHint: '14',
							unitHint: 'day',
							notes: '2 installers for 7 days',
							evidenceRefs: []
						}
					],
					issues: []
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scopeSummary: 'Install canopy package.',
					notes: 'Model outline was vague.',
					takeoffItems: [
						{
							name: 'Bundled Canopy Fabrication Package (Materials & Shop Work)',
							quantity: 0,
							unit: 'lot',
							confidence: 'medium',
							components: [],
							evidenceRefs: [],
							openQuestions: []
						},
						{
							name: 'Canopy Installation & Site Erection',
							quantity: 0,
							unit: 'job',
							confidence: 'medium',
							components: [],
							evidenceRefs: [],
							openQuestions: []
						}
					]
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-weak-outline',
			projectContext: {
				projectName: 'Weak Outline Project',
				rfqNumber: 'RFQ-W1',
				rfqBrief: 'Weak outline canopy scope.'
			},
			assetContext: {
				assetId: 'asset-w1',
				assetName: 'Weak Outline Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-w1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Weak outline canopy scope.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-w1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline).toBeDefined();
		const draftOutline = result.draftOutline!;
		expect(draftOutline.takeoff_items).toHaveLength(1);
		expect(draftOutline.takeoff_items[0]).toMatchObject({
			name: 'Structural steel canopy package',
			quantity: 1,
			unit: 'lot'
		});
		expect(draftOutline.takeoff_items[0]?.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Structural steel canopy package',
					category: 'material'
				}),
				expect.objectContaining({
					name: 'Site installation crew',
					category: 'labour',
					quantity: 14,
					unit: 'day'
				})
			])
		);
		expect(result.draft.issues.some((issue) => issue.code === 'local_outline_shape_repaired')).toBe(
			true
		);
	});

	it('normalises invalid outline confidence values instead of forcing a repair warning', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					summary: 'Canopy evidence extracted.',
					estimatingSignals: ['canopy package'],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled canopy fabrication package.',
							evidenceRefs: [
								{
									file_id: 'file-c1',
									file_name: 'scope.txt',
									artifact_kind: 'text',
									quote_path: 'text:1',
									summary: 'Confidence canopy scope.'
								}
							]
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scopeSummary: 'Install canopy package.',
					takeoffItems: [
						{
							name: 'Structural steel canopy package',
							quantity: '1',
							unit: 'lot',
							confidence: 'medium',
							evidence_refs: [
								{
									file_id: 'file-c1',
									file_name: 'scope.txt',
									artifact_kind: 'text',
									quote_path: 'text:1',
									summary: 'Confidence canopy scope.'
								}
							],
							components: [
								{
									name: 'Canopy package',
									quantity: '1',
									unit: 'lot',
									category: 'material',
									confidence: 'medium',
									evidence_refs: [
										{
											file_id: 'file-c1',
											file_name: 'scope.txt',
											artifact_kind: 'text',
											quote_path: 'text:1',
											summary: 'Confidence canopy scope.'
										}
									]
								}
							]
						}
					]
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-confidence-normalisation',
			projectContext: {
				projectName: 'Confidence Project',
				rfqNumber: 'RFQ-C1',
				rfqBrief: 'Confidence canopy scope.'
			},
			assetContext: {
				assetId: 'asset-c1',
				assetName: 'Confidence Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-c1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Confidence canopy scope.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-c1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline?.issues).toEqual([]);
		expect(result.draft.takeoff_items[0]?.confidence).toEqual({
			overall: 0.5,
			extraction: 0.5,
			mapping: 0.2,
			quantity: 0.5
		});
	});

	it('downgrades unevidenced local draft components even when the takeoff item has evidence', async () => {
		const evidenceRef = {
			file_id: 'file-mixed',
			file_name: 'scope.txt',
			artifact_kind: 'text' as const,
			quote_path: 'text:1',
			summary: 'Supply canopy package and confirm installation labour separately.'
		};

		invokeMock
			.mockResolvedValueOnce({
				content: {
					summary: 'Canopy evidence extracted.',
					estimatingSignals: ['canopy package'],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled canopy fabrication package.',
							evidenceRefs: [evidenceRef]
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Install canopy package.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [
						{
							name: 'Structural steel canopy package',
							description: 'Bundled canopy package.',
							quantity: 1,
							unit: 'lot',
							sort_order: 0,
							evidence_refs: [evidenceRef],
							confidence: {
								overall: 0.7,
								extraction: 0.7,
								mapping: 0.3,
								quantity: 0.7
							},
							open_questions: [],
							cost_components: [
								{
									category: 'material',
									name: 'Canopy package',
									description: 'Supply canopy package.',
									quantity: 1,
									unit: 'lot',
									rate_hint: null,
									sort_order: 0,
									evidence_refs: [evidenceRef],
									confidence: {
										overall: 0.7,
										extraction: 0.7,
										mapping: 0.3,
										quantity: 0.7
									}
								},
								{
									category: 'labour',
									name: 'Installation labour',
									description: 'Install canopy package.',
									quantity: 2,
									unit: 'day',
									rate_hint: null,
									sort_order: 1,
									evidence_refs: [],
									confidence: {
										overall: 0.7,
										extraction: 0.7,
										mapping: 0.3,
										quantity: 0.7
									}
								}
							]
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-mixed-evidence',
			projectContext: {
				projectName: 'Mixed Evidence Project',
				rfqNumber: 'RFQ-M1',
				rfqBrief: 'Canopy package.'
			},
			assetContext: {
				assetId: 'asset-mixed',
				assetName: 'Mixed Evidence Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-mixed',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Supply canopy package and confirm installation labour separately.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-mixed',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draft.takeoff_items[0]?.confidence).toMatchObject({
			overall: 0.7,
			extraction: 0.7,
			quantity: 0.7
		});
		expect(result.draft.takeoff_items[0]?.open_questions).toContain(
			'Confirm source evidence before using this Local AI draft item.'
		);
		expect(result.draft.takeoff_items[0]?.cost_components[0]).toMatchObject({
			name: 'Canopy package',
			mapping_status: 'manual',
			confidence: expect.objectContaining({ overall: 0.7 })
		});
		expect(result.draft.takeoff_items[0]?.cost_components[1]).toMatchObject({
			name: 'Installation labour',
			mapping_status: 'unresolved',
			confidence: expect.objectContaining({
				overall: 0.25,
				extraction: 0.2,
				quantity: 0.2
			})
		});
		expect(result.draft.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_draft_missing_evidence_ref',
					message: expect.stringContaining('component(s)')
				})
			])
		);
	});

	it('seeds takeoff items from extracted candidates when local outline returns empty takeoff_items', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: evidenceBatchContent('text:plain_text:chunk:1', {
					summary: 'Canopy evidence extracted.',
					estimatingSignals: ['canopy package'],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Bundled canopy fabrication package.',
							evidenceRefs: []
						}
					],
					issues: []
				}),
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Install canopy package.',
					notes: '',
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-seed-empty',
			projectContext: {
				projectName: 'Seed Empty Outline Project',
				rfqNumber: 'RFQ-5',
				rfqBrief: 'Seed empty local outline.'
			},
			assetContext: {
				assetId: 'asset-5',
				assetName: 'Seed Empty Outline Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-5',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Install canopy package.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-5',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draft.takeoff_items.length).toBe(1);
		expect(result.draft.takeoff_items[0]?.name).toContain('Structural steel canopy package');
		expect(result.draft.issues.some((issue) => issue.code === 'local_outline_shape_repaired')).toBe(
			true
		);
	});

	it('replaces a weak split local outline with deterministic bundled seeding when extraction evidence is stronger', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content:
					'This appears to be a model identifier, likely for a specific version of the Gemma model family.',
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabrication and installation of the canopy package.',
					notes: 'Weak split outline returned by local model.',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [
						{
							name: 'Structural Steel Canopy Fabrication Package',
							description: 'Fabrication split from installation.',
							quantity: 1,
							unit: 'lot',
							sort_order: 0,
							cost_components: [
								{
									category: 'material',
									name: 'Structural Steel & Hardware',
									description: 'Manual fabrication material row.',
									quantity: 1,
									unit: 'lot',
									sort_order: 0,
									evidence_refs: [],
									confidence: {
										overall: 0.5,
										extraction: 0.5,
										mapping: 0.2,
										quantity: 0.5
									}
								}
							],
							evidence_refs: [],
							confidence: {
								overall: 0.5,
								extraction: 0.5,
								mapping: 0.2,
								quantity: 0.5
							},
							open_questions: []
						},
						{
							name: 'Canopy Installation Labour',
							description: 'Labour split from fabrication.',
							quantity: 1,
							unit: 'day',
							sort_order: 1,
							cost_components: [
								{
									category: 'labour',
									name: 'Installation Labour',
									description: 'Manual labour row.',
									quantity: 1,
									unit: 'day',
									sort_order: 0,
									evidence_refs: [],
									confidence: {
										overall: 0.5,
										extraction: 0.5,
										mapping: 0.2,
										quantity: 0.5
									}
								}
							],
							evidence_refs: [],
							confidence: {
								overall: 0.5,
								extraction: 0.5,
								mapping: 0.2,
								quantity: 0.5
							},
							open_questions: []
						}
					],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-outline-bundle-repair',
			projectContext: {
				projectName: 'Bundle Repair Project',
				rfqNumber: 'RFQ-B1',
				rfqBrief: 'Bundled canopy package.'
			},
			assetContext: {
				assetId: 'asset-b1',
				assetName: 'Bundle Repair Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-b1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: `# Henderson Logistics canopy package

- Structural steel canopy package: 1 lot
- Site installation crew: 2 installers for 7 days`
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-b1',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline).toBeDefined();
		const draftOutline = result.draftOutline!;
		expect(draftOutline.takeoff_items).toHaveLength(1);
		expect(draftOutline.takeoff_items[0]).toMatchObject({
			name: 'Structural steel canopy package',
			quantity: 1,
			unit: 'lot'
		});
		expect(draftOutline.takeoff_items[0]?.cost_components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'Structural steel canopy package',
					category: 'material'
				}),
				expect.objectContaining({
					name: 'Site installation crew',
					category: 'labour',
					quantity: 14,
					unit: 'day'
				})
			])
		);
		expect(result.draft.issues.some((issue) => issue.code === 'local_outline_shape_repaired')).toBe(
			true
		);
	});

	it('repairs weak draft results with the same heuristic outline guard', () => {
		const mediumConfidence = { overall: 0.6, extraction: 0.6, mapping: 0.4, quantity: 0.6 };
		const repaired = repairDraftRunResultHeuristicOutline({
			draft: AiDraftRunEstimateSchema.parse({
				scope_summary: 'Canopy package',
				notes: '',
				takeoff_items: [
					{
						name: 'Structural steel canopy package',
						description: '',
						quantity: 1,
						unit: 'lot',
						sort_order: 0,
						cost_code_id: null,
						wbs_node_id: null,
						applied_preset_id: null,
						applied_preset_name: null,
						properties: {},
						cost_components: [
							{
								category: 'material',
								source_type: 'manual',
								source_id: null,
								name: 'Structural steel canopy package',
								description: '',
								quantity: 1,
								unit: 'lot',
								unit_rate: 12500,
								formula: {},
								metadata: {},
								sort_order: 0,
								evidence_refs: [],
								confidence: mediumConfidence,
								mapping_status: 'manual'
							}
						],
						evidence_refs: [],
						confidence: mediumConfidence,
						open_questions: []
					},
					{
						name: 'Canopy installation labour',
						description: '',
						quantity: 2,
						unit: 'day',
						sort_order: 1,
						cost_code_id: null,
						wbs_node_id: null,
						applied_preset_id: null,
						applied_preset_name: null,
						properties: {},
						cost_components: [
							{
								category: 'labour',
								source_type: 'manual',
								source_id: null,
								name: 'Canopy installation labour',
								description: '',
								quantity: 2,
								unit: 'day',
								unit_rate: 0,
								formula: {},
								metadata: {},
								sort_order: 0,
								evidence_refs: [],
								confidence: mediumConfidence,
								mapping_status: 'manual'
							}
						],
						evidence_refs: [],
						confidence: mediumConfidence,
						open_questions: []
					}
				],
				issues: []
			}),
			draftOutline: AiDraftOutlineSchema.parse({
				scope_summary: 'Canopy package',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [
					{
						name: 'Structural steel canopy package',
						description: '',
						quantity: 1,
						unit: 'lot',
						sort_order: 0,
						cost_components: [
							{
								category: 'material',
								name: 'Structural steel canopy package',
								description: '',
								quantity: 1,
								unit: 'lot',
								rate_hint: 12500,
								sort_order: 0,
								evidence_refs: [],
								confidence: mediumConfidence
							}
						],
						evidence_refs: [],
						confidence: mediumConfidence,
						open_questions: []
					},
					{
						name: 'Canopy installation labour',
						description: '',
						quantity: 2,
						unit: 'day',
						sort_order: 1,
						cost_components: [
							{
								category: 'labour',
								name: 'Canopy installation labour',
								description: '',
								quantity: 2,
								unit: 'day',
								rate_hint: 0,
								sort_order: 0,
								evidence_refs: [],
								confidence: mediumConfidence
							}
						],
						evidence_refs: [],
						confidence: mediumConfidence,
						open_questions: []
					}
				],
				issues: []
			}),
			draftMatching: AiDraftMatchingSchema.parse({
				applied_template_id: null,
				applied_template_name: null,
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [],
				issues: []
			}),
			draftStageMetrics: [],
			evidenceRefs: [],
			issues: [],
			artifactManifest: [],
			extractions: [
				{
					fileId: 'artifact-1',
					fileName: 'qa-rfq-canopy.md',
					artifactKind: 'text',
					summary: 'Canopy package',
					estimatingSignals: [],
					candidateItems: [
						{
							label: 'Structural steel canopy package',
							quantityHint: '1',
							unitHint: 'lot',
							notes: 'Supply and install as one canopy package.',
							evidenceRefs: [
								{
									file_name: 'qa-rfq-canopy.md',
									summary: 'Structural steel canopy package: 1 lot'
								}
							]
						},
						{
							label: 'Site installation crew',
							quantityHint: '14',
							unitHint: 'day',
							notes: '2 installers for 7 days.',
							evidenceRefs: [
								{
									file_name: 'qa-rfq-canopy.md',
									summary: 'Site installation crew: 2 installers for 7 days'
								}
							]
						}
					],
					issues: []
				}
			],
			usage: {},
			promptContract: {
				systemInstructionVersion: 'test',
				extractionPromptVersion: 'test',
				draftPromptVersion: 'test'
			},
			normalizedTableSnapshot: {},
			cacheMetadata: {
				strategy: 'telemetry',
				normalizedTableSnapshotFingerprint: 'nf',
				estimateContextSnapshotFingerprint: 'cf',
				extractionContextFingerprint: 'ef',
				draftContextFingerprint: 'df'
			},
			evidenceCoverage: {
				totalUnits: 0,
				cachedUnits: 0,
				completedUnits: 0,
				failedUnits: 0,
				omittedUnits: 0,
				units: []
			},
			runtimeExecutionContext: {
				runtimeContractVersion: 'litert-lm-v0.16.0',
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
				evidenceArtifacts: [],
				draftStageMetrics: []
			}
		});

		expect(repaired.draft.takeoff_items).toHaveLength(1);
		expect(repaired.draft.takeoff_items[0]?.cost_components).toHaveLength(2);
		expect(
			repaired.draft.takeoff_items[0]?.cost_components.find(
				(component) => component.category === 'labour'
			)?.quantity
		).toBe(14);
		expect(repaired.draft.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_outline_shape_repaired'
				})
			])
		);
	});

	it('does not overwrite a validated Draft agent final with legacy outline repair', () => {
		const result = {
			draft: { scope_summary: 'Agent final', takeoff_items: [{ name: 'Agent item' }] },
			draftAgentFinal: { status: 'complete', draft: { scope_summary: 'Agent final' } },
			draftOutline: {
				scope_summary: 'Weak outline',
				notes: '',
				classification_system_id: null,
				wbs_root_node_id: null,
				takeoff_items: [],
				issues: []
			},
			extractions: [
				{
					fileId: 'file-1',
					fileName: 'scope.txt',
					artifactKind: 'text',
					summary: 'Legacy candidate',
					estimatingSignals: [],
					candidateItems: [
						{
							label: 'Legacy item',
							quantityHint: '1',
							unitHint: 'ea',
							notes: '',
							evidenceRefs: []
						}
					],
					issues: []
				}
			]
		} as never;

		expect(repairDraftRunResultHeuristicOutline(result)).toBe(result);
	});

	it('continues the local staged run when a single artifact extraction fails', async () => {
		invokeMock
			.mockRejectedValueOnce(
				new Error(
					'Local AI request returned an error: HTTP 400 — {"error":{"message":"Outline extraction request rejected"}}'
				)
			)
			.mockResolvedValueOnce({
				content: {
					scope_summary: 'Fabricate and install the canopy package.',
					notes: '',
					classification_system_id: null,
					wbs_root_node_id: null,
					takeoff_items: [],
					issues: []
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-artifact-failure',
			projectContext: {
				projectName: 'Local Artifact Failure Project',
				rfqNumber: 'RFQ-4',
				rfqBrief: 'Artifact failure degradation scope.'
			},
			assetContext: {
				assetId: 'asset-4',
				assetName: 'Local Artifact Failure Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'pdf',
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf',
						filePath: '/tmp/spec-sheet.pdf',
						mimeType: 'application/pdf',
						textContent: 'Canopy package specification notes.',
						pageCount: 1,
						inlineData: 'aGVsbG8=',
						issues: []
					},
					{
						kind: 'text',
						fileId: 'file-text',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Bundled canopy package scope.'
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-pdf',
						fileName: 'spec-sheet.pdf',
						filePath: '/tmp/spec-sheet.pdf',
						artifactKind: 'pdf',
						aiRole: 'spec_sheet',
						extractionMode: 'native_document',
						inclusionReason: 'Included as specification evidence.'
					},
					{
						fileId: 'file-text',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 2,
					supportedArtifactCount: 2,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(3);
		expect(result.extractions).toHaveLength(2);
		expect(result.extractions[0]).toMatchObject({
			fileId: 'file-text',
			fileName: 'scope.txt',
			issues: [expect.objectContaining({ code: 'deterministic_text_extraction' })]
		});
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'evidence_relevance_uncertain',
					fileName: 'scope.txt'
				})
			])
		);
		expect(result.draft.scope_summary).toBe('Fabricate and install the canopy package.');
	});

	it('retains source identity when every sequential evidence unit fails', () => {
		const extraction = mergeSequentialEvidenceExtractions({
			artifact: {
				kind: 'image',
				fileId: 'file-image',
				fileName: 'drawing.png',
				filePath: '/tmp/drawing.png',
				mimeType: 'image/png',
				inlineData: 'aGVsbG8='
			},
			evidenceIdentifiers: ['image:raster:1'],
			extractions: []
		});

		expect(extraction).toMatchObject({
			fileId: 'file-image',
			fileName: 'drawing.png',
			artifactKind: 'image',
			evidenceIdentifiers: ['image:raster:1'],
			extractionSource: 'unavailable',
			issues: [expect.objectContaining({ fileId: 'file-image', fileName: 'drawing.png' })]
		});
	});

	it('uses raster image evidence locally when runtime support is enabled', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					unitKey: 'image:raster:1',
					contentClass: 'technical_drawing',
					estimatingUtility: 'high',
					summary: 'The site photo shows the canopy area and slab edge.',
					estimatingSignalsText: 'Canopy fixes into an existing slab edge.',
					candidateLabel: 'Structural steel canopy package',
					candidateQuantityHint: '1',
					candidateUnitHint: 'lot',
					candidateNotes: 'Photo shows one canopy zone.'
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			})
			.mockResolvedValueOnce({
				content: {
					disposition: 'relevant',
					reason: 'The image directly shows the canopy scope.'
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-image-enabled',
			projectContext: {
				projectName: 'Local Image Enabled Project',
				rfqNumber: 'RFQ-5',
				rfqBrief: 'Image evidence scope.'
			},
			assetContext: {
				assetId: 'asset-5',
				assetName: 'Local Image Enabled Asset',
				quoteQuantity: 1,
				isPdfIncluded: false
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'image',
						fileId: 'file-image',
						fileName: 'site-photo.png',
						filePath: '/tmp/site-photo.png',
						mimeType: 'image/png',
						inlineData: 'aGVsbG8='
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-image',
						fileName: 'site-photo.png',
						filePath: '/tmp/site-photo.png',
						artifactKind: 'image',
						aiRole: 'site_photo',
						extractionMode: 'image',
						inclusionReason: 'Included as site condition evidence.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null,
			allowRasterImageCompletions: true,
			runtimeStatus: {
				...createLocalStatus({
					supportsNativeToolCalls: true,
					supportsImageInputs: true
				})
			}
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
			request: {
				tools: [expect.objectContaining({ type: 'function' })],
				temperature: 0,
				visualTokenBudget: 140,
				artifacts: [
					expect.objectContaining({
						kind: 'image',
						mimeType: 'image/png'
					}),
					expect.objectContaining({
						kind: 'text',
						textContent: expect.stringContaining(
							'Normalised raster image evidence from site-photo.png'
						)
					})
				]
			}
		});
		expect(invokeMock.mock.calls[0]?.[1]?.request?.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					content: expect.arrayContaining([
						expect.objectContaining({
							text: expect.stringContaining('not a units array')
						})
					])
				})
			])
		);
		expect(result.extractions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fileId: 'file-image',
					fileName: 'site-photo.png',
					summary: 'The site photo shows the canopy area and slab edge.'
				})
			])
		);
		expect(result.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_image_evidence_unsupported',
					fileName: 'site-photo.png'
				})
			])
		);
		expect(result.draft.scope_summary).toBe('The site photo shows the canopy area and slab edge.');
	});

	it('accepts null usage counts from the native LiteRT-LM runtime without forcing heuristic fallback', async () => {
		invokeMock
			.mockResolvedValueOnce({
				content: {
					unitKey: 'image:raster:1',
					contentClass: 'technical_drawing',
					estimatingUtility: 'high',
					summary: 'The site photo shows the canopy area and slab edge.',
					estimatingSignalsText: 'Canopy fixes into an existing slab edge.',
					candidateLabel: 'Structural steel canopy package',
					candidateQuantityHint: '1',
					candidateUnitHint: 'lot'
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {
					promptTokenCount: null,
					candidatesTokenCount: null,
					totalTokenCount: null
				}
			})
			.mockResolvedValueOnce({
				content: {
					disposition: 'relevant',
					reason: 'The image directly shows the canopy scope.'
				},
				modelId: 'kwantflow-ai.litertlm',
				usage: {
					promptTokenCount: null,
					candidatesTokenCount: null,
					totalTokenCount: null
				}
			});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-litert-null-usage',
			projectContext: {
				projectName: 'Local Native Null Usage Project',
				rfqNumber: 'RFQ-NATIVE-NULL-USAGE',
				rfqBrief: 'Null usage response compatibility scope.'
			},
			assetContext: {
				assetId: 'asset-local-litert-null-usage',
				assetName: 'Local Native Null Usage Asset',
				quoteQuantity: 1,
				isPdfIncluded: false
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'image',
						fileId: 'file-image',
						fileName: 'site-photo.png',
						filePath: '/tmp/site-photo.png',
						mimeType: 'image/png',
						inlineData: 'aGVsbG8='
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-image',
						fileName: 'site-photo.png',
						filePath: '/tmp/site-photo.png',
						artifactKind: 'image',
						aiRole: 'site_photo',
						extractionMode: 'image',
						inclusionReason: 'Included as site condition evidence.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null,
			allowRasterImageCompletions: true,
			runtimeStatus: createLocalStatus({
				supportsNativeToolCalls: true,
				supportsImageInputs: true
			})
		} as never);

		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(result.issues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'local_extraction_heuristic_fallback'
				})
			])
		);
		expect(result.extractions[0]).toMatchObject({
			candidateItems: [expect.objectContaining({ notes: '' })]
		});
		expect(result.usage).toEqual({
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0
		});
		expect(result.draft.scope_summary).toBe('The site photo shows the canopy area and slab edge.');
	});

	it('keeps the legacy outline path inactive without an explicitly enabled native refinement run', async () => {
		invokeMock.mockResolvedValueOnce({
			content: {
				units: [
					{
						unitKey: 'text:plain_text:chunk:1',
						contentClass: 'specification',
						estimatingUtility: 'low',
						summary: 'Canopy package.',
						estimatingSignals: [],
						candidateItems: [],
						issues: []
					}
				]
			},
			modelId: 'kwantflow-ai.litertlm',
			usage: {}
		});

		const result = await localAiService.runDraftRun({
			runId: 'run-local-3',
			projectContext: {
				projectName: 'Issue Normalisation Project',
				rfqNumber: 'RFQ-3',
				rfqBrief: 'Issue normalisation scope.'
			},
			assetContext: {
				assetId: 'asset-3',
				assetName: 'Issue Normalisation Asset',
				quoteQuantity: 1,
				isPdfIncluded: true
			},
			preparedRun: {
				artifacts: [
					{
						kind: 'text',
						fileId: 'file-3',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						textContent: 'Issue normalisation scope.',
						sourceFormat: 'plain_text',
						structureHints: null
					}
				],
				issues: [],
				artifactManifest: [
					{
						fileId: 'file-3',
						fileName: 'scope.txt',
						filePath: '/tmp/scope.txt',
						artifactKind: 'text',
						aiRole: 'plain_text_note',
						extractionMode: 'text_only',
						inclusionReason: 'Included as plain text asset context.'
					}
				],
				preprocessProfile: {
					totalElapsedMs: 10,
					artifacts: []
				},
				progressDetail: {
					currentArtifactName: null,
					processedArtifactCount: 0,
					usableArtifactCount: 0,
					artifactIssueCount: 0,
					totalArtifactCount: 1,
					supportedArtifactCount: 1,
					unsupportedArtifactCount: 0
				}
			},
			referenceContext: {
				classificationSystems: { totalAvailableCount: 0, items: [] },
				costCodes: { totalAvailableCount: 0, items: [] },
				wbsNodes: { totalAvailableCount: 0, items: [] },
				materialCatalogItems: { totalAvailableCount: 0, items: [] },
				labourRateCards: { totalAvailableCount: 0, items: [] },
				equipmentRateCards: { totalAvailableCount: 0, items: [] },
				subcontractRateCards: { totalAvailableCount: 0, items: [] },
				draftingPatterns: {
					estimateTemplates: { totalAvailableCount: 0, items: [] },
					costComponentPresets: { totalAvailableCount: 0, items: [] }
				}
			},
			workflowRules: {},
			outputContract: {},
			normalizedTableSnapshot: {},
			estimateContextSnapshot: {
				schema: {},
				field_semantics: {},
				current_estimate_state: {
					currentEstimate: {
						scope_summary: '',
						notes: '',
						takeoff_items: []
					},
					seededHeaderFields: [],
					hasDraftedStructure: false
				}
			},
			promptContract: {
				systemInstructionVersion: 'local-system-v2',
				extractionPromptVersion: 'local-extraction-v2',
				draftPromptVersion: 'local-draft-v2'
			},
			workspaceKnowledgeContext: null
		} as never);

		expect(result.draftOutline?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'local_outline_shape_repaired' })])
		);
		expect(result.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'evidence_relevance_uncertain' })])
		);
		expect(result.issues).toHaveLength(2);
	});

	it('forwards active-run cancellation to the local runtime command', async () => {
		invokeMock.mockResolvedValueOnce({
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
			lastError: null
		});

		const status = await localAiService.cancelActiveRun();

		expect(invokeMock).toHaveBeenCalledWith('cancel_local_ai_runtime');
		expect(status).toMatchObject({
			installState: 'ready',
			modelReady: true
		});
	});

	it('forwards runtime unloading to the local runtime command', async () => {
		invokeMock.mockResolvedValueOnce({
			expectedDownloadBytes: 3659530240,
			runtimeKind: 'litert_lm',
			runtimeVersion: 'litert-lm-v0.16.0',
			modelRepoId: 'litert-community/gemma-4-E4B-it-litert-lm',
			modelArtifactId: 'kwantflow-ai.litertlm',
			modelFileName: 'gemma-4-e4b/model.litertlm',
			mmprojFileName: null,
			installState: 'ready',
			runtimeAvailable: true,
			modelReady: false,
			supportsImageInputs: false,
			activeDownload: null,
			lastError: null
		});

		const status = await localAiService.unloadRuntime();

		expect(invokeMock).toHaveBeenCalledWith('unload_local_ai_runtime');
		expect(status).toMatchObject({
			installState: 'ready',
			modelReady: false
		});
	});

	describe('request-scoped Channel streaming contract', () => {
		beforeEach(() => {
			invokeMock.mockReset();
			mockChannels.length = 0;
			mockCapabilities.supportsNativeToolCalls = true;
		});

		it('rejects a disposed stream before starting native work', async () => {
			invokeMock.mockResolvedValue({
				content: 'late',
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});
			const controller = localAiService.runGroundedCompletionStream({});
			controller.dispose();
			const result = controller.start();
			const rejected = result.catch((error: unknown) => error);

			expect(invokeMock).not.toHaveBeenCalled();
			await expect(rejected).resolves.toBeInstanceOf(Error);
			await expect(result).rejects.toThrow('Kwantflow AI stream was stopped.');
		});

		it('rejects duplicate stream starts while keeping the original request cancellable', async () => {
			invokeMock.mockImplementation((command: string) =>
				command === 'run_local_ai_completion_stream' ? new Promise(() => {}) : Promise.resolve()
			);
			const controller = localAiService.runGroundedCompletionStream({});
			const first = controller.start();
			void first.catch(() => {});
			const second = controller.start();
			void second.catch(() => {});

			expect(invokeMock).toHaveBeenCalledTimes(1);
			await expect(second).rejects.toThrow('Kwantflow AI stream was already started.');
			controller.dispose();
			await expect(first).rejects.toThrow('Kwantflow AI stream was stopped.');
		});

		it('streams thinking and content through the command Channel and resolves from invoke', async () => {
			invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
				if (command === 'run_local_ai_completion_stream') {
					const channel = args?.onEvent as { onmessage?: (message: unknown) => void };
					channel.onmessage?.({ event: 'thinking', data: { text: 'reasoning' } });
					channel.onmessage?.({ event: 'content', data: { text: 'answer' } });
					return {
						content: 'answer',
						thinking: 'reasoning',
						modelId: 'litert-lm-v1',
						usage: {},
						toolCalls: []
					};
				}
				return undefined;
			});
			const thinking: string[] = [];
			const content: string[] = [];
			const controller = localAiService.runGroundedCompletionStream({
				onThinking: (chunk) => thinking.push(chunk),
				onContent: (chunk) => content.push(chunk)
			});

			const result = await controller.start();

			expect(thinking).toEqual(['reasoning']);
			expect(content).toEqual(['answer']);
			expect(result).toMatchObject({ content: 'answer', thinking: 'reasoning' });
			expect(invokeMock).toHaveBeenCalledWith(
				'run_local_ai_completion_stream',
				expect.objectContaining({
					onEvent: expect.anything(),
					request: expect.objectContaining({ requestId: expect.any(String) })
				})
			);
			expect(invokeMock).not.toHaveBeenCalledWith('abort_active_local_ai_completion');
		});

		it('aborts only when an unsettled request is explicitly disposed', async () => {
			invokeMock.mockImplementation((command: string) =>
				command === 'run_local_ai_completion_stream'
					? new Promise(() => {})
					: Promise.resolve(undefined)
			);
			const controller = localAiService.runGroundedCompletionStream({});
			const promise = controller.start();
			await vi.waitFor(() =>
				expect(invokeMock).toHaveBeenCalledWith('run_local_ai_completion_stream', expect.anything())
			);
			const streamCall = invokeMock.mock.calls.find(
				([command]) => command === 'run_local_ai_completion_stream'
			);
			const requestId = (streamCall?.[1] as { request?: { requestId?: string } })?.request
				?.requestId;
			expect(requestId).toEqual(expect.any(String));

			controller.dispose();

			await expect(promise).rejects.toThrow('Kwantflow AI stream was stopped.');
			expect(invokeMock).toHaveBeenCalledWith('abort_active_local_ai_completion', { requestId });
		});

		it('leaves the total completion deadline to Rust instead of starting a browser timer', async () => {
			vi.useFakeTimers();
			try {
				invokeMock.mockImplementation((command: string) =>
					command === 'run_local_ai_completion_stream'
						? new Promise(() => {})
						: Promise.resolve(undefined)
				);
				const controller = localAiService.runGroundedCompletionStream({ timeoutMs: 5_000 });
				const promise = controller.start();
				await Promise.resolve();

				await vi.advanceTimersByTimeAsync(30_000);

				expect(invokeMock).not.toHaveBeenCalledWith(
					'abort_active_local_ai_completion',
					expect.anything()
				);
				controller.dispose();
				await expect(promise).rejects.toThrow('Kwantflow AI stream was stopped.');
			} finally {
				vi.useRealTimers();
			}
		});

		it('uses the same Channel transport for persistent conversation messages', async () => {
			invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
				if (command === 'send_local_ai_message') {
					const channel = args?.onEvent as { onmessage?: (message: unknown) => void };
					channel.onmessage?.({ event: 'content', data: { text: 'continued' } });
					return {
						content: 'continued',
						thinking: '',
						modelId: 'litert-lm-v1',
						usage: {},
						toolCalls: []
					};
				}
				return undefined;
			});
			const chunks: string[] = [];
			const controller = localAiService.sendMessageStream({
				message: { role: 'user', content: 'continue' },
				parseToolCalls: true,
				onContent: (chunk) => chunks.push(chunk)
			});

			const result = await controller.start();

			expect(chunks).toEqual(['continued']);
			expect(result.content).toBe('continued');
			expect(invokeMock).toHaveBeenCalledWith(
				'send_local_ai_message',
				expect.objectContaining({
					onEvent: expect.anything(),
					request: expect.objectContaining({
						stage: 'ask_kwantflow_turn',
						parseToolCalls: true,
						requestId: expect.any(String),
						maxOutputTokens: 2048,
						timeoutMs: 120_000,
						workloadClass: 'interactive'
					})
				})
			);
		});
	});

	describe('persistent conversation ownership', () => {
		it('cancels the replacement stream after native ownership recovery and ignores late output', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockReset();
			let sendAttempts = 0;
			let finishRetry!: (value: unknown) => void;
			invokeMock.mockImplementation((command: string) => {
				if (command === 'send_local_ai_message') {
					sendAttempts += 1;
					if (sendAttempts === 1)
						return Promise.reject(new Error('No persistent conversation exists'));
					return new Promise((resolve) => {
						finishRetry = resolve;
					});
				}
				if (command === 'get_local_ai_conversation_tokens') return Promise.resolve(100);
				if (command === 'get_local_ai_status') return Promise.resolve(createLocalStatus());
				return Promise.resolve(undefined);
			});
			await localAiService.startConversation({ systemInstruction: 'Local help', tools: [] });
			const onContent = vi.fn();
			const controller = localAiService.sendMessageStream({
				message: { role: 'user', content: 'Continue' },
				onContent
			});
			const result = controller.start();
			void result.catch(() => {});
			await vi.waitFor(() => expect(sendAttempts).toBe(2));
			const retryCall = invokeMock.mock.calls.filter(
				([command]) => command === 'send_local_ai_message'
			)[1];
			const retryRequestId = retryCall?.[1]?.request?.requestId;
			const retryChannel = retryCall?.[1]?.onEvent as { onmessage?: (message: unknown) => void };

			controller.dispose();
			retryChannel.onmessage?.({ event: 'content', data: { text: 'Late cancelled output' } });
			finishRetry({
				content: 'Late cancelled output',
				modelId: 'kwantflow-ai.litertlm',
				usage: {}
			});

			await expect(result).rejects.toThrow('Kwantflow AI stream was stopped.');
			expect(invokeMock).toHaveBeenCalledWith('abort_active_local_ai_completion', {
				requestId: retryRequestId
			});
			expect(onContent).not.toHaveBeenCalled();
		});

		it('does not replay a cancelled message after rebuilding native conversation ownership', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockReset();
			let sendAttempts = 0;
			let startAttempts = 0;
			let finishRebuild!: () => void;
			invokeMock.mockImplementation((command: string) => {
				if (command === 'start_local_ai_conversation') {
					startAttempts += 1;
					if (startAttempts === 2)
						return new Promise<void>((resolve) => {
							finishRebuild = resolve;
						});
				}
				if (command === 'send_local_ai_message') {
					sendAttempts += 1;
					if (sendAttempts === 1)
						return Promise.reject(new Error('No persistent conversation exists'));
					return Promise.resolve({
						content: 'Unwanted replay',
						modelId: 'kwantflow-ai.litertlm',
						usage: {}
					});
				}
				if (command === 'get_local_ai_conversation_tokens') return Promise.resolve(100);
				if (command === 'get_local_ai_status') return Promise.resolve(createLocalStatus());
				return Promise.resolve(undefined);
			});
			await localAiService.startConversation({ systemInstruction: 'Local help', tools: [] });
			const controller = localAiService.sendMessageStream({
				message: { role: 'user', content: 'Continue' }
			});
			const result = controller.start();
			void result.catch(() => {});
			await vi.waitFor(() => expect(startAttempts).toBe(2));

			controller.dispose();
			finishRebuild();

			await expect(result).rejects.toThrow('Kwantflow AI stream was stopped.');
			expect(sendAttempts).toBe(1);
		});

		it('starts the native conversation only once for repeated ensure calls', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockClear();

			const params = {
				systemInstruction: 'You are Kwantflow AI.',
				tools: [],
				messages: [],
				enableThinking: true
			};
			await localAiService.ensureConversation(params);
			await localAiService.ensureConversation(params);

			expect(invokeMock).toHaveBeenCalledTimes(1);
			expect(invokeMock).toHaveBeenCalledWith('start_local_ai_conversation', {
				request: expect.objectContaining({
					systemInstruction: 'You are Kwantflow AI.',
					enableThinking: true
				})
			});
		});

		it('rolls the native conversation over from app-owned history at 75 percent occupancy', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockReset();
			invokeMock.mockImplementation(async (command: string) => {
				if (command === 'send_local_ai_message') {
					return {
						content: 'Use the selected material record.',
						thinking: 'private thought',
						modelId: 'kwantflow-ai.litertlm',
						usage: {},
						toolCalls: []
					};
				}
				if (command === 'get_local_ai_conversation_tokens') return 24_500;
				if (command === 'get_local_ai_status') {
					return createLocalStatus({
						diagnostics: {
							...createLocalStatus().diagnostics,
							contextSizeTokens: 32_003
						}
					});
				}
				return undefined;
			});

			await localAiService.startConversation({
				systemInstruction: 'You are Kwantflow AI.',
				tools: [],
				messages: [{ role: 'user', content: 'Earlier question' }],
				enableThinking: true
			});
			const result = await localAiService
				.sendMessageStream({ message: { role: 'user', content: 'Current question' } })
				.start();

			expect(result.content).toBe('Use the selected material record.');
			const startCalls = invokeMock.mock.calls.filter(
				([command]) => command === 'start_local_ai_conversation'
			);
			expect(startCalls).toHaveLength(2);
			expect(invokeMock).toHaveBeenCalledWith('end_local_ai_conversation');
			expect(startCalls[1]?.[1]?.request?.messages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ role: 'user', content: 'Current question' }),
					expect.objectContaining({
						role: 'assistant',
						content: 'Use the selected material record.'
					})
				])
			);
			expect(JSON.stringify(startCalls[1]?.[1]?.request?.messages)).not.toContain(
				'private thought'
			);
		});

		it('returns a completed turn when the proactive context rollover fails', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockReset();
			let startAttempts = 0;
			invokeMock.mockImplementation(async (command: string) => {
				if (command === 'start_local_ai_conversation') {
					startAttempts += 1;
					if (startAttempts === 2) throw new Error('rebuild failed');
					return undefined;
				}
				if (command === 'send_local_ai_message') {
					return {
						content: 'Completed answer',
						thinking: '',
						modelId: 'kwantflow-ai.litertlm',
						usage: {},
						toolCalls: []
					};
				}
				if (command === 'get_local_ai_conversation_tokens') return 24_500;
				if (command === 'get_local_ai_status') {
					return createLocalStatus({
						diagnostics: {
							...createLocalStatus().diagnostics,
							contextSizeTokens: 32_003
						}
					});
				}
				return undefined;
			});

			await localAiService.startConversation({
				systemInstruction: 'You are Kwantflow AI.',
				tools: [],
				messages: []
			});

			await expect(
				localAiService
					.sendMessageStream({ message: { role: 'user', content: 'Current question' } })
					.start()
			).resolves.toMatchObject({ content: 'Completed answer' });

			await localAiService.ensureConversation({
				systemInstruction: 'You are Kwantflow AI.',
				tools: [],
				messages: []
			});
			expect(startAttempts).toBe(3);
		});

		it('rebuilds once from app-owned history when native conversation ownership is lost', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockReset();
			let sendAttempts = 0;
			invokeMock.mockImplementation(async (command: string) => {
				if (command === 'send_local_ai_message') {
					sendAttempts += 1;
					if (sendAttempts === 1) throw new Error('No persistent conversation exists');
					return {
						content: 'Recovered answer',
						thinking: '',
						modelId: 'kwantflow-ai.litertlm',
						usage: {},
						toolCalls: []
					};
				}
				if (command === 'get_local_ai_conversation_tokens') return 100;
				if (command === 'get_local_ai_status') return createLocalStatus();
				return undefined;
			});

			await localAiService.startConversation({
				systemInstruction: 'You are Kwantflow AI.',
				tools: [],
				messages: [{ role: 'user', content: 'Earlier question' }]
			});
			const result = await localAiService
				.sendMessageStream({ message: { role: 'user', content: 'Continue' } })
				.start();

			expect(result.content).toBe('Recovered answer');
			expect(sendAttempts).toBe(2);
			expect(
				invokeMock.mock.calls.filter(([command]) => command === 'start_local_ai_conversation')
			).toHaveLength(2);
		});

		it('defaults persistent conversation thinking to false for utility callers', async () => {
			invokeMock.mockResolvedValue(undefined);
			await localAiService.endConversation();
			invokeMock.mockClear();

			await localAiService.ensureConversation({
				systemInstruction: 'Utility conversation.',
				tools: [],
				messages: []
			});

			expect(invokeMock).toHaveBeenCalledWith('start_local_ai_conversation', {
				request: expect.objectContaining({
					systemInstruction: 'Utility conversation.',
					enableThinking: false
				})
			});
		});

		it('restarts a stale native conversation when frontend ownership was lost', async () => {
			await localAiService.endConversation();
			invokeMock.mockClear();
			invokeMock
				.mockRejectedValueOnce('A persistent conversation already exists')
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined);

			await localAiService.ensureConversation({
				systemInstruction: 'Fresh Ask conversation.',
				tools: [],
				messages: [],
				enableThinking: true
			});

			expect(invokeMock).toHaveBeenNthCalledWith(1, 'start_local_ai_conversation', {
				request: expect.objectContaining({
					systemInstruction: 'Fresh Ask conversation.',
					enableThinking: true
				})
			});
			expect(invokeMock).toHaveBeenNthCalledWith(2, 'end_local_ai_conversation');
			expect(invokeMock).toHaveBeenNthCalledWith(3, 'start_local_ai_conversation', {
				request: expect.objectContaining({
					systemInstruction: 'Fresh Ask conversation.',
					enableThinking: true
				})
			});
		});
	});

	describe('buildCompletionArtifacts coordinate metadata extraction', () => {
		it('uses distinct canonical keys for prepared text parts and image tiles from one file', () => {
			const textPartOne = buildSequentialEvidenceUnits(
				{
					kind: 'text',
					fileId: 'text-file',
					fileName: 'scope.txt (Part 1 of 2)',
					filePath: 'workspace/scope.txt',
					textContent: 'First prepared part',
					sourceFormat: 'plain_text',
					structureHints: null,
					sourceMetadata: { textChunk: { index: 1, total: 2 } }
				},
				false
			);
			const textPartTwo = buildSequentialEvidenceUnits(
				{
					kind: 'text',
					fileId: 'text-file',
					fileName: 'scope.txt (Part 2 of 2)',
					filePath: 'workspace/scope.txt',
					textContent: 'Second prepared part',
					sourceFormat: 'plain_text',
					structureHints: null,
					sourceMetadata: { textChunk: { index: 2, total: 2 } }
				},
				false
			);
			const tileA1 = buildSequentialEvidenceUnits(
				{
					kind: 'image',
					fileId: 'image-file',
					fileName: 'drawing.png [A1]',
					filePath: 'workspace/drawing.png',
					mimeType: 'image/jpeg',
					inlineData: 'tile-a1',
					sourceMetadata: { tileGrid: { rowIndex: 0, colIndex: 0 } }
				},
				true
			);
			const tileB1 = buildSequentialEvidenceUnits(
				{
					kind: 'image',
					fileId: 'image-file',
					fileName: 'drawing.png [B1]',
					filePath: 'workspace/drawing.png',
					mimeType: 'image/jpeg',
					inlineData: 'tile-b1',
					sourceMetadata: { tileGrid: { rowIndex: 0, colIndex: 1 } }
				},
				true
			);

			expect(textPartOne[0]?.key).toBe('text:plain_text:chunk:1');
			expect(textPartTwo[0]?.key).toBe('text:plain_text:chunk:2');
			expect(tileA1[0]?.key).toBe('image:raster:tile:r1:c1');
			expect(tileB1[0]?.key).toBe('image:raster:tile:r1:c2');
			expect(buildFileSynthesisCacheKey(textPartOne)).not.toBe(
				buildFileSynthesisCacheKey(textPartTwo)
			);
		});

		it('creates independently cacheable PDF text and page-vision units', () => {
			const units = buildSequentialEvidenceUnits(
				{
					kind: 'pdf',
					fileId: 'pdf-1',
					fileName: 'drawing.pdf',
					filePath: 'workspace/drawing.pdf',
					pageCount: 2,
					textContent: 'Page\u0002 text\r\nwith control noise',
					inlineData: null,
					mimeType: 'application/pdf',
					rasterPages: [
						{ pageNumber: 1, mimeType: 'image/jpeg', inlineData: 'page-1' },
						{ pageNumber: 2, mimeType: 'image/jpeg', inlineData: 'page-2' }
					]
				},
				true
			);

			expect(units.map((unit) => unit.key)).toEqual([
				'pdf:text:1',
				'pdf:raster:page:1',
				'pdf:raster:page:2'
			]);
			expect(units[0]?.artifacts[0]).toMatchObject({
				kind: 'text',
				textContent: expect.not.stringContaining('\u0002')
			});
			expect(units[0]?.artifacts[0]).toMatchObject({
				textContent: expect.stringContaining('Page  text\nwith control noise')
			});
			expect(units.every((unit) => unit.artifacts.length <= 2)).toBe(true);
		});

		it('pairs each CAD image with its following evidence label', () => {
			const summary = { kind: 'text' as const, textContent: 'summary' };
			const iso = { kind: 'image' as const, mimeType: 'image/png', base64Data: 'iso' };
			const isoLabel = { kind: 'text' as const, textContent: 'iso label' };
			const front = { kind: 'image' as const, mimeType: 'image/png', base64Data: 'front' };
			const frontLabel = { kind: 'text' as const, textContent: 'front label' };

			expect(buildSequentialCadBatches([summary, iso, isoLabel, front, frontLabel])).toEqual([
				[summary, iso, isoLabel],
				[summary, front, frontLabel]
			]);
		});

		it('should append structured JSON coordinates metadata to text sibling when tileGrid is present', () => {
			const artifact = {
				kind: 'image' as const,
				fileId: 'f1',
				fileName: 'drawing.png [Tile A1]',
				filePath: 'workspace/rfq/drawing.png',
				mimeType: 'image/jpeg',
				inlineData: 'base64-image-data',
				sourceMetadata: {
					tileGrid: {
						colIndex: 0,
						rowIndex: 0,
						displayName: 'A1',
						x: 0,
						y: 0,
						width: 100,
						height: 100
					}
				}
			};

			const result = buildCompletionArtifacts(artifact, true);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				kind: 'image',
				mimeType: 'image/jpeg',
				base64Data: 'base64-image-data'
			});
			const textPart = result[1];
			if (textPart.kind === 'text') {
				expect(textPart.textContent).toContain('drawing.png [Tile A1]');
				expect(textPart.textContent).toContain('Image coordinate grid metadata');
				expect(textPart.textContent).toContain('"displayName": "A1"');
				expect(textPart.textContent).toContain('"x": 0');
				expect(textPart.textContent).toContain('"width": 100');
			} else {
				expect.fail('Expected second part to be a text artifact');
			}
		});

		it('should behave normally when tileGrid metadata is absent', () => {
			const artifact = {
				kind: 'image' as const,
				fileId: 'f1',
				fileName: 'drawing.png',
				filePath: 'workspace/rfq/drawing.png',
				mimeType: 'image/jpeg',
				inlineData: 'base64-image-data'
			};

			const result = buildCompletionArtifacts(artifact, true);
			expect(result).toHaveLength(2);
			const textPart = result[1];
			if (textPart.kind === 'text') {
				expect(textPart.textContent).not.toContain('Image coordinate grid metadata');
			} else {
				expect.fail('Expected second part to be a text artifact');
			}
		});

		it('should return empty list when allowRasterImageCompletions is false', () => {
			const artifact = {
				kind: 'image' as const,
				fileId: 'f1',
				fileName: 'drawing.png',
				filePath: 'workspace/rfq/drawing.png',
				mimeType: 'image/jpeg',
				inlineData: 'base64-image-data'
			};

			const result = buildCompletionArtifacts(artifact, false);
			expect(result).toEqual([]);
		});
	});

	it('fingerprints the exact evidence-unit set so partial CAD coverage cannot reuse a complete file synthesis', async () => {
		const { buildEvidenceUnitSetHash } = await import('./local-ai.js');
		const complete = await buildEvidenceUnitSetHash([
			{ key: 'cad:render:front', artifacts: [{ kind: 'text', textContent: 'front' }] },
			{ key: 'cad:render:side', artifacts: [{ kind: 'text', textContent: 'side' }] }
		]);
		const reordered = await buildEvidenceUnitSetHash([
			{ key: 'cad:render:side', artifacts: [{ kind: 'text', textContent: 'side' }] },
			{ key: 'cad:render:front', artifacts: [{ kind: 'text', textContent: 'front' }] }
		]);
		const partial = await buildEvidenceUnitSetHash([
			{ key: 'cad:render:front', artifacts: [{ kind: 'text', textContent: 'front' }] }
		]);

		expect(reordered).toBe(complete);
		expect(partial).not.toBe(complete);
	});

	it('requires the exact unit hash before coverage is considered complete', () => {
		const required = [{ key: 'cad:render:front', unitHash: 'current-hash' }];

		expect(
			hasCompleteEvidenceUnitCoverage({
				fileId: 'cad-file',
				required,
				coverage: [
					{
						fileId: 'cad-file',
						unitKey: 'cad:render:front',
						unitHash: 'stale-hash',
						state: 'cached'
					}
				]
			})
		).toBe(false);
		expect(
			hasCompleteEvidenceUnitCoverage({
				fileId: 'cad-file',
				required,
				coverage: [
					{
						fileId: 'cad-file',
						unitKey: 'cad:render:front',
						unitHash: 'current-hash',
						state: 'completed'
					}
				]
			})
		).toBe(true);
		expect(
			hasCompleteEvidenceUnitCoverage({
				fileId: 'cad-file',
				required,
				coverage: [
					{
						fileId: 'cad-file',
						unitKey: 'cad:render:front',
						unitHash: 'current-hash',
						state: 'omitted',
						failureCategory: 'deterministic_cad_render_omitted'
					}
				]
			})
		).toBe(true);
		expect(
			hasCompleteEvidenceUnitCoverage({
				fileId: 'cad-file',
				required,
				coverage: [
					{
						fileId: 'cad-file',
						unitKey: 'cad:render:front',
						unitHash: 'current-hash',
						state: 'omitted',
						failureCategory: 'no_completion_artifacts'
					}
				]
			})
		).toBe(false);
	});

	it('accepts only schema-valid reusable cache payloads from authoritative extraction sources', () => {
		const valid = JSON.stringify({
			fileId: 'file-1',
			fileName: 'scope.txt',
			artifactKind: 'text',
			extractionSource: 'model_structured',
			evidenceIdentifiers: ['text:plain_text:chunk:1'],
			summary: 'Machine one steel shaft.',
			estimatingSignals: ['Turn steel shaft'],
			candidateItems: [],
			issues: []
		});

		expect(
			parseReusableEvidenceCachePayload(valid, {
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text',
				requiredUnitKey: 'text:plain_text:chunk:1'
			})
		).toMatchObject({ extractionSource: 'model_structured', fileId: 'file-1' });
		expect(
			parseReusableEvidenceCachePayload('{"summary":42}', {
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text'
			})
		).toBeNull();
		expect(
			parseReusableEvidenceCachePayload(valid.replace('model_structured', 'heuristic_fallback'), {
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text'
			})
		).toBeNull();
		expect(
			parseReusableEvidenceCachePayload(valid.replace('model_structured', 'model_repaired'), {
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text'
			})
		).toBeNull();
		expect(
			parseReusableEvidenceCachePayload(
				JSON.stringify({
					...JSON.parse(valid),
					candidateItems: [
						{
							label: 'Unproven drawing item',
							quantityHint: '1',
							unitHint: 'ea',
							notes: '',
							evidenceRefs: [
								{
									file_id: 'file-1',
									file_name: 'scope.txt',
									artifact_kind: 'text',
									page_number: null,
									view_label: null,
									evidence_identifier: 'cad:render:omitted',
									quote_path: 'heuristic.line.1',
									summary: 'Unproven drawing item'
								}
							]
						}
					]
				}),
				{
					fileId: 'file-1',
					fileName: 'scope.txt',
					artifactKind: 'text'
				}
			)
		).toBeNull();
	});

	it('does not restore asset-owned relevance from the reusable file cache', () => {
		const parsed = parseReusableEvidenceCachePayload(
			JSON.stringify({
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text',
				extractionSource: 'model_structured',
				evidenceIdentifiers: ['text:plain_text:chunk:1'],
				contentClass: 'specification',
				estimatingUtility: 'high',
				runDisposition: 'irrelevant',
				summary: 'Fabricate one shaft.',
				estimatingSignals: ['shaft'],
				candidateItems: [
					{
						label: 'Shaft',
						quantityHint: '1',
						unitHint: 'ea',
						notes: '',
						evidenceRefs: [
							{
								file_id: 'file-1',
								file_name: 'scope.txt',
								artifact_kind: 'text',
								page_number: null,
								view_label: null,
								evidence_identifier: 'text:plain_text:chunk:1',
								quote_path: 'heuristic.line.1',
								summary: 'Fabricate one shaft.'
							}
						]
					}
				],
				issues: []
			}),
			{
				fileId: 'file-1',
				fileName: 'scope.txt',
				artifactKind: 'text'
			}
		);

		expect(parsed).not.toBeNull();
		expect(parsed).not.toHaveProperty('runDisposition');
	});

	it('classifies coerced or incomplete batch output as repaired rather than exact', () => {
		const batchUnits = [
			{ key: 'cad:render:front', artifacts: [] },
			{ key: 'cad:render:side', artifacts: [] }
		];

		expect(
			isExactEvidenceBatchExtraction({
				batchUnits,
				extraction: {
					units: [
						{
							unitKey: 'wrong-key',
							contentClass: 'technical_drawing',
							estimatingUtility: 'high',
							summary: 'Front view',
							estimatingSignals: [],
							candidateItems: [],
							issues: []
						}
					]
				}
			})
		).toBe(false);
	});

	it('batches CAD metadata and four canonical views without dropping a unit', () => {
		const units = [
			{ key: 'cad:metadata', artifacts: [{ kind: 'text' as const, textContent: 'metadata' }] },
			...['iso', 'front', 'side', 'top'].map((view) => ({
				key: `cad:render:${view}`,
				artifacts: [
					{ kind: 'image' as const, mimeType: 'image/png', base64Data: view },
					{ kind: 'text' as const, textContent: view }
				]
			}))
		];
		const batches = buildEvidenceInferenceBatches('cad', units);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.map((unit) => unit.key)).toEqual(units.map((unit) => unit.key));
	});

	it('uses one PDF visual page per batch without dropping a unit', () => {
		const units = [1, 2, 3].map((page) => ({
			key: `pdf:raster:page:${page}`,
			artifacts: [{ kind: 'image' as const, mimeType: 'image/png', base64Data: String(page) }]
		}));
		const batches = buildEvidenceInferenceBatches('pdf', units);
		expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1]);
		expect(batches.flat().map((unit) => unit.key)).toEqual(units.map((unit) => unit.key));
	});

	it('reserves enough bounded output for a one-unit structured extraction tool call', () => {
		expect(getEvidenceBatchMaxOutputTokens(1)).toBe(1_024);
		expect(getEvidenceBatchMaxOutputTokens(5)).toBe(1_536);
	});

	it('constrains each evidence batch to its exact requested unit set', () => {
		const schema = buildEvidenceBatchExtractionSchema(['cad:metadata', 'cad:render:front']);
		const unit = {
			contentClass: 'technical_drawing',
			estimatingUtility: 'high',
			summary: 'Bracket front view',
			estimatingSignals: [],
			candidateItems: [],
			issues: []
		};
		expect(
			schema.safeParse({
				units: [
					{ ...unit, unitKey: 'cad:metadata' },
					{ ...unit, unitKey: 'cad:render:front' }
				]
			}).success
		).toBe(true);
		expect(schema.safeParse({ units: [{ ...unit, unitKey: 'cad:wrong' }] }).success).toBe(false);
	});

	it('uses a flat scalar tool contract for LiteRT evidence-unit extraction', () => {
		const schema = buildLiteRtEvidenceUnitExtractionSchema('cad:render:front');
		const jsonSchema = buildStructuredToolParameters(schema) as {
			properties?: Record<string, { type?: string }>;
			required?: string[];
		};
		expect(
			schema.safeParse({
				unitKey: 'cad:render:front',
				contentClass: 'technical_drawing',
				estimatingUtility: 'high',
				summary: 'Front view of a shaft.',
				estimatingSignalsText: 'Turned shaft; steel',
				candidateLabel: 'Turned shaft',
				candidateQuantityHint: '1',
				candidateUnitHint: 'ea',
				candidateNotes: 'Evidence-backed candidate.'
			}).success
		).toBe(true);
		expect(jsonSchema.properties?.estimatingSignalsText?.type).toBe('string');
		expect(jsonSchema.properties?.candidateLabel?.type).toBe('string');
		expect(jsonSchema.required).not.toContain('candidateNotes');
		const omittedOptionalDetail = schema.parse({
			unitKey: 'cad:render:front',
			contentClass: 'technical_drawing',
			estimatingUtility: 'high',
			summary: 'Front view of a shaft.',
			estimatingSignalsText: 'Turned shaft; steel',
			candidateLabel: 'Turned shaft',
			candidateQuantityHint: '1',
			candidateUnitHint: 'ea'
		});
		expect(omittedOptionalDetail.candidateNotes).toBeUndefined();
	});

	it('constrains relevance decisions to every supplied file exactly once', () => {
		const schema = buildAssetEvidenceRelevanceSchema(['file-a', 'file-b']);
		expect(
			schema.safeParse({
				files: [
					{ fileId: 'file-a', disposition: 'relevant', reason: 'Matches scope.' },
					{ fileId: 'file-b', disposition: 'irrelevant', reason: 'Unrelated reference.' }
				]
			}).success
		).toBe(true);
		expect(
			schema.safeParse({
				files: [{ fileId: 'file-a', disposition: 'relevant', reason: 'Missing second file.' }]
			}).success
		).toBe(false);
	});

	it('excludes irrelevant files from fallback scope and keeps candidates from separate files separate', async () => {
		const { buildFallbackOutlineFromExtractions } = await import('./local-ai.js');
		const outline = buildFallbackOutlineFromExtractions({
			detail: 'test fallback',
			extractions: [
				{
					fileId: 'pdf-1',
					fileName: 'research.pdf',
					artifactKind: 'pdf',
					extractionSource: 'heuristic_fallback',
					evidenceIdentifiers: ['pdf:text:1'],
					summary: '[Page 1]',
					estimatingSignals: ['unrelated visual primitives research'],
					candidateItems: [],
					issues: []
				},
				{
					fileId: 'step-1',
					fileName: 'shaft.step',
					artifactKind: 'cad',
					extractionSource: 'model_structured',
					evidenceIdentifiers: ['cad:render:iso'],
					summary: 'Machined shaft CAD evidence.',
					estimatingSignals: ['Machined shaft'],
					candidateItems: [
						{ label: 'Shaft', quantityHint: null, unitHint: null, notes: '', evidenceRefs: [] },
						{
							label: 'Shaft CAD Summary',
							quantityHint: null,
							unitHint: null,
							notes: '',
							evidenceRefs: []
						}
					],
					issues: []
				},
				{
					fileId: 'dwg-1',
					fileName: 'seat.dwg',
					artifactKind: 'cad',
					extractionSource: 'model_structured',
					evidenceIdentifiers: ['cad:render:drawing'],
					summary: 'Seat drawing evidence.',
					estimatingSignals: ['Seat drawing'],
					candidateItems: [
						{ label: 'Seat', quantityHint: '1', unitHint: 'ea', notes: '', evidenceRefs: [] }
					],
					issues: []
				}
			]
		});

		expect(outline.scope_summary).toBe('Machined shaft CAD evidence.');
		expect(outline.notes).not.toContain('visual primitives');
		expect(outline.takeoff_items.map((item) => item.name)).toEqual(['Shaft', 'Seat']);
		expect(outline.takeoff_items[0]?.cost_components).toHaveLength(1);
	});

	describe('normaliseTakeoffUnitHint', () => {
		it('returns null for empty or null inputs', () => {
			expect(normaliseTakeoffUnitHint(null)).toBe(null);
			expect(normaliseTakeoffUnitHint('')).toBe(null);
			expect(normaliseTakeoffUnitHint('   ')).toBe(null);
		});

		it('normalises standard abbreviations', () => {
			expect(normaliseTakeoffUnitHint('ea')).toBe('ea');
			expect(normaliseTakeoffUnitHint('m2')).toBe('m2');
			expect(normaliseTakeoffUnitHint('m3')).toBe('m3');
			expect(normaliseTakeoffUnitHint('kg')).toBe('kg');
			expect(normaliseTakeoffUnitHint('t')).toBe('t');
			expect(normaliseTakeoffUnitHint('L')).toBe('L');
		});

		it('normalises full words and synonyms', () => {
			expect(normaliseTakeoffUnitHint('each')).toBe('ea');
			expect(normaliseTakeoffUnitHint('sets')).toBe('set');
			expect(normaliseTakeoffUnitHint('lots')).toBe('lot');
			expect(normaliseTakeoffUnitHint('jobs')).toBe('job');
			expect(normaliseTakeoffUnitHint('sheets')).toBe('sheet');
			expect(normaliseTakeoffUnitHint('packs')).toBe('pack');
			expect(normaliseTakeoffUnitHint('boxes')).toBe('box');
			expect(normaliseTakeoffUnitHint('bags')).toBe('bag');
			expect(normaliseTakeoffUnitHint('rolls')).toBe('roll');
			expect(normaliseTakeoffUnitHint('minute')).toBe('min');
			expect(normaliseTakeoffUnitHint('hours')).toBe('hr');
			expect(normaliseTakeoffUnitHint('days')).toBe('day');
			expect(normaliseTakeoffUnitHint('shifts')).toBe('shift');
			expect(normaliseTakeoffUnitHint('weeks')).toBe('week');
			expect(normaliseTakeoffUnitHint('metre')).toBe('m');
			expect(normaliseTakeoffUnitHint('meters')).toBe('m');
			expect(normaliseTakeoffUnitHint('square metre')).toBe('m2');
			expect(normaliseTakeoffUnitHint('square meters')).toBe('m2');
			expect(normaliseTakeoffUnitHint('cubic metre')).toBe('m3');
			expect(normaliseTakeoffUnitHint('cubic meters')).toBe('m3');
			expect(normaliseTakeoffUnitHint('litre')).toBe('L');
			expect(normaliseTakeoffUnitHint('liters')).toBe('L');
			expect(normaliseTakeoffUnitHint('kilogram')).toBe('kg');
			expect(normaliseTakeoffUnitHint('tonne')).toBe('t');
			expect(normaliseTakeoffUnitHint('tons')).toBe('t');
			expect(normaliseTakeoffUnitHint('lump sum')).toBe('fixed');
		});

		it('handles casing gracefully', () => {
			expect(normaliseTakeoffUnitHint('Ea')).toBe('ea');
			expect(normaliseTakeoffUnitHint('EACH')).toBe('ea');
			expect(normaliseTakeoffUnitHint('SqM')).toBe('m2');
			expect(normaliseTakeoffUnitHint('SQUARE METERS')).toBe('m2');
			expect(normaliseTakeoffUnitHint('Litre')).toBe('L');
		});

		it('handles punctuation and spacing correctly', () => {
			expect(normaliseTakeoffUnitHint('sq.m')).toBe('m2');
			expect(normaliseTakeoffUnitHint('sq. m.')).toBe('m2');
			expect(normaliseTakeoffUnitHint('square metre (m2)')).toBe('m2');
			expect(normaliseTakeoffUnitHint('cubic meter (m3)')).toBe('m3');
			expect(normaliseTakeoffUnitHint(' cu m ')).toBe('m3');
			expect(normaliseTakeoffUnitHint('  each  ')).toBe('ea');
		});

		it('returns null for unrecognised units', () => {
			expect(normaliseTakeoffUnitHint('random_unit')).toBe(null);
			expect(normaliseTakeoffUnitHint('unknown')).toBe(null);
			expect(normaliseTakeoffUnitHint('123')).toBe(null);
		});
	});
});
