import { Channel, invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { buildStructuredToolParameters } from '$lib/services/structured-schema.js';
import {
	AiEvidenceRefSchema,
	AiIssueSchema,
	AiDraftRunResultSchema,
	AiDraftRunEstimateSchema,
	AiDraftMatchingSchema,
	AiDraftOutlineSchema,
	NormalisedUnitCodeSchema,
	LocalAiCapabilityProbeDiagnosticsSchema,
	LocalAiStatusSchema
} from '$lib/schemas/index.js';
import {
	buildAiSystemInstruction,
	buildDraftOutlinePromptFromExtractions,
	buildDraftMatchingPrompt,
	filterReferenceContextByOutline,
	isAiCancelledError,
	summariseAiFailureMessage,
	validateDraftEstimateRefs,
	type AiPreparedArtifact,
	type PreparedDraftRun
} from '$lib/services/ai-drafting.js';
import { createLogger } from '$lib/services/logger.js';
import { dbService } from '$lib/services/db.js';
import { normaliseJsonLikeContent } from '$lib/utils/json-like.js';
import {
	executeLocalDraftTool,
	getLocalDraftAgentToolDeclarations,
	runLocalDraftAgent
} from '$lib/services/local-draft-agent.js';
import {
	getEffectiveLocalAiRuntimeCapabilities,
	LocalAiRuntimeCapabilitySchema,
	type LocalAiRuntimeCapability
} from '$lib/constants/local-ai-runtime-manifest.js';
import type {
	AiDraftEstimate,
	AiArtifactManifestEntry,
	AiAssetContext,
	AiEstimateContextSnapshot,
	AiEvidenceRef,
	AiOutputContract,
	AiProjectContext,
	AiPromptContract,
	AiReferenceContext,
	AiRunUsage,
	AiWorkflowRules,
	AiWorkspaceKnowledgeContext,
	LocalAiStatus
} from '$lib/types/index.js';

const log = createLogger('localAiService');
export const NATIVE_TOOL_CALLS_DISABLED_MESSAGE =
	'Native LiteRT tool calls are disabled for this runtime.';

type RunLocalAiDraftRequest = {
	runId: string;
	projectContext: AiProjectContext;
	assetContext: AiAssetContext;
	preparedRun: PreparedDraftRun;
	referenceContext: AiReferenceContext;
	workflowRules: AiWorkflowRules;
	outputContract: AiOutputContract;
	normalizedTableSnapshot: Record<string, unknown>;
	estimateContextSnapshot: AiEstimateContextSnapshot;
	promptContract: AiPromptContract;
	workspaceKnowledgeContext: AiWorkspaceKnowledgeContext | null;
	runtimeStatus?: LocalAiStatus;
	allowRasterImageCompletions?: boolean;
	enableDraftRefinement?: boolean;
	onProgress?: (progress: {
		status: 'extracting' | 'drafting';
		currentArtifactName?: string | null;
		processedArtifactCount?: number;
		usableArtifactCount?: number;
		totalArtifactCount?: number;
		supportedArtifactCount?: number;
		unsupportedArtifactCount?: number;
		draftSubphase?: 'outline' | 'matching' | 'composition' | 'validation' | null;
	}) => void;
	forceFresh?: boolean;
};

type LocalStoredDraftOutline = z.infer<typeof AiDraftOutlineSchema>;
type LocalStoredDraftMatching = z.infer<typeof AiDraftMatchingSchema>;
type LocalStoredIssue = z.infer<typeof AiIssueSchema>;
type CanonicalTakeoffUnit = AiDraftEstimate['takeoff_items'][number]['unit'];

export type LocalAiCompletionArtifact =
	| {
			kind: 'text';
			textContent: string;
	  }
	| {
			kind: 'image';
			mimeType: string;
			base64Data: string;
	  };

export type LocalAiWorkloadClass = 'interactive' | 'user_batch' | 'background';

type LocalAiNativeToolRequestParams = {
	tools?: Array<unknown>;
	parseToolCalls?: boolean;
	prompt?: string;
	messages?: Array<Record<string, unknown>>;
};

type LocalAiStreamEvent =
	{ event: 'thinking'; data: { text: string } } | { event: 'content'; data: { text: string } };

export type LocalAiCompletionResponse = z.infer<typeof LocalAiCompletionResponseSchema>;

export type LocalAiStreamController = {
	start: () => Promise<LocalAiCompletionResponse>;
	dispose: () => void;
};

export type StructuredToolCompletion<T> = {
	value: T;
	completion: LocalAiCompletionResponse;
};

export type LocalAiStructuredTask<T> = {
	schemaName: string;
	schema: z.ZodType<T>;
	systemInstruction: string;
	messages: Array<Record<string, unknown>>;
	artifacts?: LocalAiCompletionArtifact[];
	temperature?: number;
	enableThinking?: boolean;
	maxOutputTokens?: number;
	visualTokenBudget?: number;
	timeoutMs?: number;
	parseValue?: (raw: unknown) => T;
	allowCorrection?: boolean;
	workloadClass?: LocalAiWorkloadClass;
};

type LocalAiConversationConfig = {
	systemInstruction: string;
	tools?: Array<Record<string, unknown>>;
	messages?: Array<Record<string, unknown>>;
	enableThinking?: boolean;
	temperature?: number;
	topK?: number;
	topP?: number;
	seed?: number;
};

function structuredUserMessages(text: string): Array<Record<string, unknown>> {
	return [{ role: 'user', content: [{ type: 'text', text }] }];
}

function requireStructuredToolCall(
	messages: Array<Record<string, unknown>>,
	toolName: string
): Array<Record<string, unknown>> {
	const instruction =
		`Response contract: call ${toolName} exactly once. ` +
		'Do not return JSON or prose as assistant content. This final instruction overrides earlier wording about returning JSON directly.';
	let appended = false;
	const next = messages.map((message, index) => {
		if (appended || index !== messages.length - 1 || message.role !== 'user') return message;
		appended = true;
		const content = message.content;
		return {
			...message,
			content: Array.isArray(content)
				? [...content, { type: 'text', text: instruction }]
				: [
						{ type: 'text', text: typeof content === 'string' ? content : '' },
						{ type: 'text', text: instruction }
					]
		};
	});
	if (!appended) {
		throw new Error('Structured local AI tasks require one final user message.');
	}
	return next;
}

class LocalAiStructuredOutputValidationError extends Error {
	readonly validationCause: unknown;

	constructor(cause: unknown) {
		super('Kwantflow AI returned structured output that failed validation.');
		this.name = 'LocalAiStructuredOutputValidationError';
		this.validationCause = cause;
	}
}

function safeLocalAiFailureDiagnostics(error: unknown) {
	const validationCause =
		error instanceof LocalAiStructuredOutputValidationError ? error.validationCause : error;
	return {
		name: error instanceof Error ? error.name : 'UnknownError',
		category: isLocalAiTimeoutError(error)
			? 'timeout'
			: isLocalAiContextCapacityError(error)
				? 'context_capacity'
				: validationCause instanceof z.ZodError
					? 'schema_validation'
					: 'runtime_or_contract',
		messageLength: error instanceof Error ? error.message.length : String(error).length,
		validationIssues:
			validationCause instanceof z.ZodError
				? validationCause.issues.map((entry) => ({
						code: entry.code,
						path: entry.path.map(String)
					}))
				: [],
		contractCode:
			validationCause instanceof Error &&
			validationCause.message === 'Local AI returned mismatched evidence unit identities.'
				? 'evidence_unit_identity_mismatch'
				: null
	};
}

function assertNativeToolCallsAllowed(params: LocalAiNativeToolRequestParams): void {
	const requestsNativeTools = (params.tools?.length ?? 0) > 0 || params.parseToolCalls === true;
	if (requestsNativeTools && !getEffectiveLocalAiRuntimeCapabilities().supportsNativeToolCalls) {
		throw new Error(NATIVE_TOOL_CALLS_DISABLED_MESSAGE);
	}
	if (
		requestsNativeTools &&
		((params.prompt?.trim().length ?? 0) > 0 || (params.messages?.length ?? 0) === 0)
	) {
		throw new Error(
			'Native tool requests must use the canonical messages transport without prompt.'
		);
	}
}

const LOCAL_AI_ARTIFACT_COMPLETION_TIMEOUT_MS = 90_000;
const LOCAL_AI_OUTLINE_COMPLETION_TIMEOUT_MS = 120_000;
const LOCAL_AI_MATCHING_COMPLETION_TIMEOUT_MS = 90_000;
const LOCAL_AI_DRAFT_AGENT_TURN_TIMEOUT_MS = 120_000;
const LOCAL_AI_DRAFT_AGENT_MAX_TURNS = 4;
const LOCAL_AI_ENABLE_LITERT_DRAFT_REFINEMENT = false;
const STRUCTURED_RETURN_TOOL_PREFIX = 'kwantflow_return_';
const DRAFT_AGENT_RETURN_TOOL_NAME = 'kwantflow_return_draft_estimator_proposal';

const EVIDENCE_UNIT_PREPARATION_VERSION = 'evidence-units-v5-complete-terminal-coverage';
const EVIDENCE_FILE_SYNTHESIS_VERSION = 'complete-units-v3-model-assisted';

const nullableUsageCountSchema = z.preprocess(
	(value) => (value == null ? undefined : value),
	z.number().int().min(0).optional()
);
const nullableStringDefaultEmptySchema = z.preprocess(
	(value) => (value == null ? '' : value),
	z.string().default('')
);

const DEFAULT_LOCAL_AI_COMPLETION_TIMINGS = {
	promptMs: null,
	predictedMs: null,
	promptPerSecond: null,
	predictedPerSecond: null
} as const;

const LocalAiCompletionTimingDiagnosticsSchema = z.object({
	promptTokenCount: nullableUsageCountSchema,
	predictedTokenCount: nullableUsageCountSchema,
	cacheTokenCount: nullableUsageCountSchema,
	promptMs: z.number().min(0).nullable().default(null),
	predictedMs: z.number().min(0).nullable().default(null),
	promptPerSecond: z.number().min(0).nullable().default(null),
	predictedPerSecond: z.number().min(0).nullable().default(null),
	timeToFirstTokenMs: z.number().min(0).nullable().optional(),
	prefillTokenCount: nullableUsageCountSchema,
	decodeTokenCount: nullableUsageCountSchema,
	prefillTokensPerSecond: z.number().min(0).nullable().optional(),
	decodeTokensPerSecond: z.number().min(0).nullable().optional()
});

const LocalAiCompletionDiagnosticsSchema = z.object({
	requestId: z.string().trim().min(1).default('unknown-request'),
	stage: z.string().trim().min(1).default('unspecified'),
	queueMs: z.number().int().min(0).default(0),
	elapsedMs: z.number().int().min(0),
	runtimeKind: z.enum(['litert_lm']),
	timeoutSeconds: z.number().int().min(1),
	requestArtifactCount: z.number().int().min(0),
	requestImageCount: z.number().int().min(0),
	promptCharacterCount: z.number().int().min(0),
	visualTokenBudget: z.number().int().min(0).nullable().optional(),
	completionReason: z.string().default('completed'),
	cancellationReason: z.string().nullable().optional(),
	contextSizeTokens: z.number().int().positive().nullable().default(null),
	contextTokenCount: nullableUsageCountSchema,
	contextOccupancyRatio: z.number().min(0).nullable().optional(),
	outputTokenCount: nullableUsageCountSchema,
	backend: z.enum(['gpu', 'cpu', 'unknown']).default('unknown'),
	activeStreamCount: z.number().int().min(0).default(0),
	workloadClass: z.enum(['interactive', 'user_batch', 'background']).default('user_batch'),
	timings: LocalAiCompletionTimingDiagnosticsSchema.default(DEFAULT_LOCAL_AI_COMPLETION_TIMINGS)
});

const LocalAiCompletionResponseSchema = z.object({
	content: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]),
	thinking: z.string().default(''),
	modelId: z.string().trim().min(1),
	usage: z
		.object({
			promptTokenCount: nullableUsageCountSchema,
			candidatesTokenCount: nullableUsageCountSchema,
			totalTokenCount: nullableUsageCountSchema
		})
		.default({}),
	diagnostics: LocalAiCompletionDiagnosticsSchema.optional(),
	toolCalls: z
		.array(
			z.object({
				id: z.string(),
				type: z.string().optional(),
				function: z.object({ name: z.string(), arguments: z.string() })
			})
		)
		.default([])
});

type LocalAiCompletionTimingDiagnostics = z.infer<typeof LocalAiCompletionTimingDiagnosticsSchema>;

const LocalAiExtractionSourceSchema = z.enum([
	'model_structured',
	'model_repaired',
	'heuristic_fallback',
	'deterministic_extraction',
	'deterministic_filtered',
	'unavailable'
]);

const LocalAiCandidateEvidenceStateSchema = z.object({
	hasEvidenceRefs: z
		.preprocess((val: unknown) => {
			if (typeof val === 'boolean') return val;
			if (typeof val === 'string') return val.toLowerCase() === 'true';
			return false;
		}, z.boolean())
		.default(false),
	unresolvedReasons: z.preprocess(
		(val) => {
			if (!Array.isArray(val)) return [];
			return val.filter((v) => typeof v === 'string' && v.trim().length > 0);
		},
		z.array(z.string().trim().min(1)).default([])
	)
});

const LocalAiArtifactExtractionSchema = z.object({
	extractionSource: LocalAiExtractionSourceSchema.default('model_structured'),
	evidenceIdentifiers: z.preprocess(
		(val) => {
			if (typeof val === 'string') return [val];
			if (!Array.isArray(val)) return [];
			return val.filter((v) => typeof v === 'string' && v.trim().length > 0);
		},
		z.array(z.string().trim().min(1)).default([])
	),
	summary: z.preprocess((val: unknown) => (val == null ? '' : String(val)), z.string().default('')),
	estimatingSignals: z.preprocess((val: unknown) => {
		if (typeof val === 'string') return [val];
		if (!Array.isArray(val)) return [];
		return val.filter((v) => typeof v === 'string');
	}, z.array(z.string()).default([])),
	candidateItems: z.preprocess(
		(val) => {
			if (!Array.isArray(val)) return [];
			return val.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
		},
		z
			.array(
				z.object({
					label: z.preprocess(
						(val: unknown) => (val == null ? '' : String(val)),
						z.string().default('')
					),
					quantityHint: z.preprocess(
						(val) => (val == null ? null : String(val)),
						z.string().nullable().optional().default(null)
					),
					unitHint: z.preprocess(
						(val) => (val == null ? null : String(val)),
						z.string().nullable().optional().default(null)
					),
					notes: nullableStringDefaultEmptySchema,
					evidenceRefs: z
						.preprocess((val: unknown) => (Array.isArray(val) ? val : []), z.array(z.unknown()))
						.transform(sanitiseEvidenceRefs)
						.default([]),
					evidenceState: LocalAiCandidateEvidenceStateSchema.optional()
				})
			)
			.default([])
	),
	issues: z
		.preprocess((val: unknown) => {
			if (!Array.isArray(val)) return [];
			return val;
		}, z.array(z.unknown()).default([]))
		.transform((val) => {
			const normalised: z.infer<typeof AiIssueSchema>[] = [];
			for (const entry of val) {
				const parsed = AiIssueSchema.safeParse(entry);
				if (parsed.success) {
					normalised.push(parsed.data);
				} else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
					const record = entry as Record<string, unknown>;
					normalised.push({
						code: typeof record.code === 'string' ? record.code : 'local_model_issue',
						message:
							typeof record.message === 'string'
								? record.message
								: String(record.detail ?? record.summary ?? 'Model flagged an issue'),
						severity:
							record.severity === 'info' ||
							record.severity === 'warning' ||
							record.severity === 'error'
								? record.severity
								: 'warning',
						fileId: typeof record.fileId === 'string' ? record.fileId : null,
						fileName: typeof record.fileName === 'string' ? record.fileName : null
					});
				} else if (typeof entry === 'string') {
					normalised.push({
						code: 'local_model_issue',
						message: entry,
						severity: 'warning',
						fileId: null,
						fileName: null
					});
				}
			}
			return normalised;
		})
});

const LocalAiEvidenceUnitExtractionSchema = z.object({
	contentClass: z.enum([
		'technical_drawing',
		'specification',
		'schedule',
		'commercial',
		'administrative',
		'general_reference',
		'unknown'
	]),
	estimatingUtility: z.enum(['high', 'medium', 'low', 'none']),
	summary: z.string().max(240).default(''),
	estimatingSignals: z.array(z.string().max(240)).max(4).default([]),
	candidateItems: z
		.array(
			z.object({
				label: z.string().max(120),
				quantityHint: z.string().max(32).nullable().default(null),
				unitHint: z.string().max(32).nullable().default(null),
				notes: z.string().max(180).default('')
			})
		)
		.max(3)
		.default([]),
	issues: z.array(AiIssueSchema).max(4).default([])
});

const LocalAiEvidenceBatchExtractionSchema = z.object({
	units: z
		.array(LocalAiEvidenceUnitExtractionSchema.extend({ unitKey: z.string().min(1).max(160) }))
		.min(1)
		.max(5)
});

export function buildEvidenceBatchExtractionSchema(unitKeys: string[]) {
	const [firstUnitKey, ...remainingUnitKeys] = unitKeys;
	if (!firstUnitKey) {
		throw new Error('Evidence extraction requires at least one unit key.');
	}
	return z.object({
		units: z
			.array(
				LocalAiEvidenceUnitExtractionSchema.extend({
					unitKey: z.enum([firstUnitKey, ...remainingUnitKeys])
				})
			)
			.length(unitKeys.length)
	});
}

/**
 * LiteRT-LM's constrained tool-call grammar is reliable for scalar parameters,
 * but not for the nested arrays used by the richer batch contract above. Keep
 * the application contract rich, while giving the native runtime one exact,
 * bounded evidence unit per call and reconstructing the validated shape here.
 */
export function buildLiteRtEvidenceUnitExtractionSchema(unitKey: string) {
	return z.object({
		unitKey: z.enum([unitKey]),
		contentClass: LocalAiEvidenceUnitExtractionSchema.shape.contentClass,
		estimatingUtility: LocalAiEvidenceUnitExtractionSchema.shape.estimatingUtility,
		summary: z.string().max(240),
		estimatingSignalsText: z.string().max(960),
		candidateLabel: z.string().max(120),
		candidateQuantityHint: z.string().max(32),
		candidateUnitHint: z.string().max(32),
		// Optional detail only. LiteRT's constrained call can omit it while still
		// returning every field required to identify and estimate the evidence unit.
		candidateNotes: z.string().max(180).optional()
	});
}

function normaliseLiteRtEvidenceUnitExtraction(
	parsed: z.infer<ReturnType<typeof buildLiteRtEvidenceUnitExtractionSchema>>
): z.infer<typeof LocalAiEvidenceUnitExtractionSchema> & { unitKey: string } {
	const estimatingSignals = parsed.estimatingSignalsText
		.split(/[\n;]+/)
		.map((value) => value.trim())
		.filter(Boolean)
		.slice(0, 4);
	const label = parsed.candidateLabel.trim();
	return {
		unitKey: parsed.unitKey,
		contentClass: parsed.contentClass,
		estimatingUtility: parsed.estimatingUtility,
		summary: parsed.summary.trim(),
		estimatingSignals,
		candidateItems: label
			? [
					{
						label,
						quantityHint: parsed.candidateQuantityHint.trim() || null,
						unitHint: parsed.candidateUnitHint.trim() || null,
						notes: (parsed.candidateNotes ?? '').trim()
					}
				]
			: [],
		issues: []
	};
}

type EvidenceBatchNormalisation = {
	value: unknown;
	repaired: boolean;
};

/**
 * Unit identity is application-owned. For a single-unit request, rebinding an
 * echoed key cannot change what the model reviewed, and prevents cosmetic key
 * formatting from invalidating otherwise schema-valid evidence. Enum casing is
 * similarly normalised only when it maps exactly to a declared value. Any
 * other invalid field still fails Zod validation and is never cacheable.
 */
function normaliseEvidenceBatchForContract(
	raw: unknown,
	unitKeys: string[]
): EvidenceBatchNormalisation {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: raw, repaired: false };
	const record = raw as Record<string, unknown>;
	if (!Array.isArray(record.units)) return { value: raw, repaired: false };
	let repaired = false;
	const acceptedContentClasses = new Set([
		'technical_drawing',
		'specification',
		'schedule',
		'commercial',
		'administrative',
		'general_reference',
		'unknown'
	]);
	const acceptedUtilities = new Set(['high', 'medium', 'low', 'none']);
	const units = record.units.map((unit, index) => {
		if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return unit;
		const next = { ...(unit as Record<string, unknown>) };
		if (unitKeys.length === 1 && index === 0 && next.unitKey !== unitKeys[0]) {
			next.unitKey = unitKeys[0];
			repaired = true;
		}
		for (const [field, accepted] of [
			['contentClass', acceptedContentClasses],
			['estimatingUtility', acceptedUtilities]
		] as const) {
			if (typeof next[field] !== 'string') continue;
			const canonical = next[field].trim().toLowerCase().replace(/[ -]+/g, '_');
			if (canonical !== next[field] && accepted.has(canonical)) {
				next[field] = canonical;
				repaired = true;
			}
		}
		return next;
	});
	return { value: { ...record, units }, repaired };
}

const LocalAiFileSynthesisSchema = z.object({
	contentClass: LocalAiEvidenceUnitExtractionSchema.shape.contentClass,
	estimatingUtility: LocalAiEvidenceUnitExtractionSchema.shape.estimatingUtility,
	summary: z.string().max(360),
	estimatingSignals: z.array(z.string().max(160)).max(8)
});

type LocalAiAssetEvidenceRelevance = {
	files: Array<{
		fileId: string;
		disposition: 'relevant' | 'irrelevant' | 'uncertain';
		reason: string;
	}>;
};

export function buildAssetEvidenceRelevanceSchema(fileIds: string[]) {
	const [firstFileId, ...remainingFileIds] = fileIds;
	if (!firstFileId) {
		throw new Error('Asset evidence relevance requires at least one file ID.');
	}
	return z.object({
		files: z
			.array(
				z.object({
					fileId: z.enum([firstFileId, ...remainingFileIds]),
					disposition: z.enum(['relevant', 'irrelevant', 'uncertain']),
					reason: z.string().trim().max(160)
				})
			)
			.length(fileIds.length)
	});
}

function buildLiteRtAssetEvidenceRelevanceSchema() {
	return z.object({
		disposition: z.enum(['relevant', 'irrelevant', 'uncertain']),
		// LiteRT reliably returns the scalar decision but can use a full sentence
		// for its non-commercial diagnostic. Keep it bounded without rejecting a
		// valid relevance decision solely because that explanation is verbose.
		reason: z.string().trim().min(1).max(320)
	});
}

const LocalDraftAgentProposalComponentSchema = z.object({
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(240).default(''),
	quantity: z.preprocess(Number, z.number().finite().min(0)),
	unit: NormalisedUnitCodeSchema
});

const LocalDraftAgentProposalItemSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(240).default(''),
	quantity: z.preprocess(Number, z.number().finite().min(0)),
	unit: NormalisedUnitCodeSchema,
	costComponents: z.array(LocalDraftAgentProposalComponentSchema).min(1).max(8),
	openQuestions: z.array(z.string().trim().max(180)).max(4).default([])
});

function buildLocalDraftAgentProposalSchema(itemCount: number) {
	return z.object({
		status: z.literal('complete'),
		scopeSummary: z.string().trim().min(1).max(600),
		notes: z.string().trim().max(600).default(''),
		takeoffItems: z.array(LocalDraftAgentProposalItemSchema).length(itemCount),
		issues: z.array(AiIssueSchema).max(8).default([])
	});
}

function buildLiteRtDraftAgentReturnSchema() {
	return z.object({
		scopeSummary: z.string().trim().min(1).max(600),
		notes: z.string().trim().max(600)
	});
}

type LocalAiArtifactExtraction = z.infer<typeof LocalAiArtifactExtractionSchema> & {
	fileId: string;
	fileName: string;
	artifactKind: AiPreparedArtifact['kind'];
	contentClass?: z.infer<typeof LocalAiEvidenceUnitExtractionSchema>['contentClass'];
	estimatingUtility?: z.infer<typeof LocalAiEvidenceUnitExtractionSchema>['estimatingUtility'];
	runDisposition?: 'relevant' | 'irrelevant' | 'uncertain';
	runDispositionReason?: string;
};

const LocalAiCachedArtifactExtractionSchema = LocalAiArtifactExtractionSchema.extend({
	fileId: z.string().trim().min(1),
	fileName: z.string().trim().min(1),
	artifactKind: z.enum(['text', 'pdf', 'image', 'cad']),
	contentClass: LocalAiEvidenceUnitExtractionSchema.shape.contentClass.optional(),
	estimatingUtility: LocalAiEvidenceUnitExtractionSchema.shape.estimatingUtility.optional()
});

function isReusableEvidenceExtraction(extraction: LocalAiArtifactExtraction): boolean {
	return (
		(extraction.extractionSource === 'model_structured' ||
			extraction.extractionSource === 'deterministic_extraction') &&
		extractionHasMeaningfulSignal(extraction)
	);
}

export function parseReusableEvidenceCachePayload(
	raw: string,
	expected: {
		fileId: string;
		fileName: string;
		artifactKind: AiPreparedArtifact['kind'];
		requiredUnitKey?: string;
	}
): LocalAiArtifactExtraction | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = LocalAiCachedArtifactExtractionSchema.safeParse(value);
	if (
		!parsed.success ||
		parsed.data.fileId !== expected.fileId ||
		parsed.data.artifactKind !== expected.artifactKind ||
		(expected.requiredUnitKey &&
			!parsed.data.evidenceIdentifiers.includes(expected.requiredUnitKey))
	) {
		return null;
	}
	const extraction: LocalAiArtifactExtraction = {
		...parsed.data,
		fileName: expected.fileName
	};
	const evidenceIdentifiers = new Set(extraction.evidenceIdentifiers);
	if (
		extraction.candidateItems.some(
			(candidate) =>
				candidate.evidenceRefs.length === 0 ||
				candidate.evidenceRefs.some(
					(ref) =>
						typeof ref.evidence_identifier !== 'string' ||
						!evidenceIdentifiers.has(ref.evidence_identifier)
				)
		)
	) {
		return null;
	}
	return isReusableEvidenceExtraction(extraction) ? extraction : null;
}

function countUsableLocalExtractions(extractions: LocalAiArtifactExtraction[]): number {
	return extractions.filter(
		(extraction) =>
			extraction.extractionSource !== 'unavailable' &&
			extraction.extractionSource !== 'deterministic_filtered'
	).length;
}

function buildDraftAgentEvidenceSummaries(extractions: LocalAiArtifactExtraction[]) {
	const relevant = extractions.filter((extraction) => extraction.runDisposition === 'relevant');
	const selected = (relevant.length > 0 ? relevant : extractions)
		.filter((extraction) => extraction.estimatingUtility !== 'none')
		.slice(0, 6);
	return selected.map((extraction) => ({
		fileId: extraction.fileId,
		fileName: extraction.fileName,
		artifactKind: extraction.artifactKind,
		runDisposition: extraction.runDisposition ?? null,
		summary: truncateSentence(extraction.summary, 180),
		candidateItems: extraction.candidateItems.slice(0, 1).map((candidate) => ({
			label: truncateSentence(candidate.label, 120),
			quantityHint: candidate.quantityHint,
			unitHint: candidate.unitHint,
			notes: truncateSentence(candidate.notes, 120)
		}))
	}));
}

function normaliseArtifactKind(value: unknown): AiPreparedArtifact['kind'] {
	switch (value) {
		case 'pdf':
		case 'image':
		case 'cad':
			return value;
		default:
			return 'text';
	}
}

function normaliseUnknownExtractions(
	extractions: readonly Record<string, unknown>[]
): LocalAiArtifactExtraction[] {
	return extractions.flatMap((rawExtraction) => {
		const fileId =
			pickString(rawExtraction.fileId) ??
			pickString(rawExtraction.file_id) ??
			pickString(rawExtraction.id);
		const fileName =
			pickString(rawExtraction.fileName) ??
			pickString(rawExtraction.file_name) ??
			pickString(rawExtraction.name);

		if (!fileId || !fileName) {
			return [];
		}

		const candidateItemsRaw = Array.isArray(rawExtraction.candidateItems)
			? rawExtraction.candidateItems
			: [];
		const candidateItems = candidateItemsRaw
			.filter(
				(candidate): candidate is Record<string, unknown> =>
					typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
			)
			.map((candidate) =>
				normaliseCandidateItem({
					label:
						pickString(candidate.label) ??
						pickString(candidate.name) ??
						pickString(candidate.title) ??
						'Candidate item',
					quantityHint:
						pickString(candidate.quantityHint) ??
						pickString(candidate.quantity_hint) ??
						(typeof pickNumber(candidate.quantity) === 'number'
							? String(pickNumber(candidate.quantity))
							: null),
					unitHint:
						pickString(candidate.unitHint) ??
						pickString(candidate.unit_hint) ??
						pickString(candidate.unit),
					notes:
						pickString(candidate.notes) ??
						pickString(candidate.description) ??
						pickString(candidate.summary) ??
						'',
					evidenceRefs: sanitiseEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs)
				})
			);
		const issuesRaw = Array.isArray(rawExtraction.issues) ? rawExtraction.issues : [];
		const issues = stripLocalExtractionIssueNoise(
			issuesRaw.flatMap((issue) => {
				const parsed = AiIssueSchema.safeParse(issue);
				return parsed.success ? [parsed.data] : [];
			})
		);

		return [
			{
				fileId,
				fileName,
				artifactKind: normaliseArtifactKind(
					rawExtraction.artifactKind ?? rawExtraction.artifact_kind ?? rawExtraction.kind
				),
				extractionSource: LocalAiExtractionSourceSchema.catch('model_repaired').parse(
					rawExtraction.extractionSource ?? rawExtraction.extraction_source
				),
				evidenceIdentifiers: pickStringArray(
					rawExtraction.evidenceIdentifiers ?? rawExtraction.evidence_identifiers
				),
				summary: pickString(rawExtraction.summary) ?? '',
				estimatingSignals: pickStringArray(rawExtraction.estimatingSignals),
				candidateItems,
				issues
			}
		];
	});
}

function aggregateUsage(usages: AiRunUsage[]): AiRunUsage {
	const total = (field: keyof AiRunUsage) =>
		usages.reduce((sum, usage) => sum + (usage[field] ?? 0), 0);

	return {
		promptTokenCount: total('promptTokenCount'),
		candidatesTokenCount: total('candidatesTokenCount'),
		totalTokenCount: total('totalTokenCount')
	};
}

function stripLocalExtractionIssueNoise(
	issues: readonly z.infer<typeof AiIssueSchema>[]
): z.infer<typeof AiIssueSchema>[] {
	return issues.filter((issue) => !LOCAL_MODEL_MISSING_INLINE_IMAGE_PATTERN.test(issue.message));
}

function dedupeEvidenceRefs(refs: AiEvidenceRef[]): AiEvidenceRef[] {
	const seen = new Set<string>();
	return refs.filter((ref) => {
		const key = [
			ref.file_id ?? '',
			ref.file_name,
			ref.artifact_kind ?? '',
			String(ref.page_number ?? ''),
			ref.view_label ?? '',
			ref.evidence_identifier ?? '',
			JSON.stringify(ref.locator ?? null),
			ref.quote_path,
			ref.summary
		].join('|');
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function dedupeLocalIssues(issues: LocalStoredIssue[]): LocalStoredIssue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = [
			issue.code,
			issue.message,
			issue.severity,
			issue.fileId ?? '',
			issue.fileName ?? ''
		].join('|');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isLocalAiTimeoutError(error: unknown): boolean {
	return error instanceof Error && /timed out/i.test(error.message);
}

function isStructuredEvidenceContractError(error: unknown): boolean {
	return error instanceof LocalAiStructuredOutputValidationError;
}

export function isLocalAiContextCapacityError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/(?:context|input|prompt).*(?:limit|length|large|long)|too many tokens|resource_exhausted/i.test(
			error.message
		)
	);
}

function collectDraftEvidenceRefs(draft: AiDraftEstimate): AiEvidenceRef[] {
	const refs: AiEvidenceRef[] = [];
	for (const takeoffItem of draft.takeoff_items) {
		refs.push(...takeoffItem.evidence_refs);
		for (const component of takeoffItem.cost_components) {
			refs.push(...component.evidence_refs);
		}
	}
	return dedupeEvidenceRefs(refs);
}

function pickString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normaliseTakeoffUnitHint(value: string | null): CanonicalTakeoffUnit | null {
	if (!value) {
		return null;
	}

	const normalised = value
		.trim()
		.toLowerCase()
		.replace(/[().,]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const unitMap: Record<string, CanonicalTakeoffUnit> = {
		ea: 'ea',
		each: 'ea',
		set: 'set',
		sets: 'set',
		lot: 'lot',
		lots: 'lot',
		job: 'job',
		jobs: 'job',
		sheet: 'sheet',
		sheets: 'sheet',
		pack: 'pack',
		packs: 'pack',
		box: 'box',
		boxes: 'box',
		bag: 'bag',
		bags: 'bag',
		roll: 'roll',
		rolls: 'roll',
		min: 'min',
		mins: 'min',
		minute: 'min',
		minutes: 'min',
		hr: 'hr',
		hrs: 'hr',
		hour: 'hr',
		hours: 'hr',
		day: 'day',
		days: 'day',
		shift: 'shift',
		shifts: 'shift',
		week: 'week',
		weeks: 'week',
		mm: 'mm',
		m: 'm',
		metre: 'm',
		meter: 'm',
		metres: 'm',
		meters: 'm',
		m2: 'm2',
		sqm: 'm2',
		'sq m': 'm2',
		'sq m2': 'm2',
		'square metre m2': 'm2',
		'square meter m2': 'm2',
		'square metre': 'm2',
		'square meter': 'm2',
		'square metres': 'm2',
		'square meters': 'm2',
		m3: 'm3',
		cbm: 'm3',
		'cu m': 'm3',
		'cubic metre m3': 'm3',
		'cubic meter m3': 'm3',
		'cubic metre': 'm3',
		'cubic meter': 'm3',
		'cubic metres': 'm3',
		'cubic meters': 'm3',
		l: 'L',
		litre: 'L',
		liter: 'L',
		litres: 'L',
		liters: 'L',
		kg: 'kg',
		kgs: 'kg',
		kilogram: 'kg',
		kilograms: 'kg',
		t: 't',
		tonne: 't',
		tonnes: 't',
		ton: 't',
		tons: 't',
		ls: 'fixed',
		'lump sum': 'fixed',
		fixed: 'fixed'
	};

	return unitMap[normalised] ?? null;
}

function parseDurationValue(value: string | null): {
	quantity: number | null;
	unit: CanonicalTakeoffUnit | null;
} {
	if (!value) {
		return { quantity: null, unit: null };
	}

	const match = value.trim().match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
	if (!match) {
		return {
			quantity: null,
			unit: normaliseTakeoffUnitHint(value)
		};
	}

	return {
		quantity: Number(match[1]),
		unit: normaliseTakeoffUnitHint(match[2])
	};
}

function parseFilenameQuantity(fileName: string): number | null {
	const withoutExtension = fileName.replace(/\.[^.]+$/, '');
	const match =
		withoutExtension.match(/\b(?:x|qty|quantity)\s*(\d+(?:\.\d+)?)\b/i) ??
		withoutExtension.match(/\b(\d+(?:\.\d+)?)\s*(?:x|off)\b/i);
	if (!match) return null;
	const quantity = Number(match[1]);
	return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function cleanCadCandidateName(fileName: string): string {
	return fileName
		.replace(/\.[^.]+$/, '')
		.replace(/\b(?:x|qty|quantity)\s*\d+(?:\.\d+)?\b/gi, '')
		.replace(/\b\d+(?:\.\d+)?\s*(?:x|off)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function deriveCadCandidateName(artifact: Extract<AiPreparedArtifact, { kind: 'cad' }>): string {
	const sourceSummary = artifact.metadata.sourceSummary ?? '';
	const semanticPart = sourceSummary
		.split(/source metadata:/i)
		.slice(1)
		.flatMap((section) => section.split('|'))
		.map((part) => part.replace(/^\s*Source metadata:\s*/i, '').trim())
		.filter(
			(part) =>
				part.length >= 3 &&
				part.length <= 120 &&
				/\b(bracket|plate|shaft|washer|roller|assembly|flange|housing|beam|steel|aluminium|aluminum)\b/i.test(
					part
				) &&
				!/\b(?:test sample|mechanical context|ap214|file description)\b/i.test(part)
		)
		.sort((left, right) => right.length - left.length)[0];
	return semanticPart ?? (cleanCadCandidateName(artifact.fileName) || artifact.fileName);
}

function deriveLabourQuantityHint(params: {
	description: string | null;
	rawText: string | null;
	quantity: number | null;
	duration: string | null;
	fallbackUnit: string | null;
}): { quantityHint: string | null; unitHint: CanonicalTakeoffUnit | null } {
	const duration = parseDurationValue(params.duration);
	const labourLikeSource = `${params.description ?? ''} ${params.rawText ?? ''}`;
	const labourLike =
		params.quantity != null &&
		duration.quantity != null &&
		duration.unit != null &&
		/\b(installer|installation|install|crew|labou?r|worker|rigging|site)\b/i.test(labourLikeSource);

	if (labourLike) {
		const baseQuantity = params.quantity as number;
		const durationQuantity = duration.quantity as number;
		return {
			quantityHint: String(baseQuantity * durationQuantity),
			unitHint: duration.unit
		};
	}

	return {
		quantityHint: params.quantity == null ? null : String(params.quantity),
		unitHint: duration.unit ?? normaliseTakeoffUnitHint(params.fallbackUnit)
	};
}

function pickNullableString(value: unknown): string | null {
	if (value == null) return null;
	return pickString(value);
}

function pickNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function pickArrayField(record: Record<string, unknown>, keys: string[]): unknown[] {
	for (const key of keys) {
		const candidate = record[key];
		if (Array.isArray(candidate)) {
			return candidate;
		}
	}
	return [];
}

function sanitiseEvidenceRefs(value: unknown): AiEvidenceRef[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const refs: AiEvidenceRef[] = [];
	for (const entry of value) {
		const parsed = AiEvidenceRefSchema.safeParse(entry);
		if (parsed.success) {
			refs.push(parsed.data);
		}
	}
	return refs;
}

function pickStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => pickString(entry)).filter((entry): entry is string => entry !== null);
}

function normaliseCandidateItem(params: {
	label: string;
	quantityHint: string | null;
	unitHint: string | null;
	notes: string;
	evidenceRefs: AiEvidenceRef[];
}): LocalAiArtifactExtraction['candidateItems'][number] {
	const baseCandidate = {
		label: params.label,
		quantityHint: params.quantityHint,
		unitHint: normaliseTakeoffUnitHint(params.unitHint) ?? null,
		notes: params.notes,
		evidenceRefs: params.evidenceRefs,
		evidenceState: {
			hasEvidenceRefs: params.evidenceRefs.length > 0,
			unresolvedReasons: params.evidenceRefs.length > 0 ? [] : ['missing_evidence_ref']
		}
	};

	if (inferCandidateCategory(baseCandidate) !== 'labour') {
		return baseCandidate;
	}
	if (baseCandidate.unitHint && pickNumber(baseCandidate.quantityHint) != null) {
		return baseCandidate;
	}

	const labourDurationSource = [params.unitHint, params.notes].filter(Boolean).join(' ');
	const derived = deriveLabourQuantityHint({
		description: params.label,
		rawText: labourDurationSource,
		quantity: pickNumber(params.quantityHint),
		duration: labourDurationSource,
		fallbackUnit: params.unitHint
	});

	return {
		...baseCandidate,
		quantityHint: derived.quantityHint ?? baseCandidate.quantityHint,
		unitHint: derived.unitHint ?? baseCandidate.unitHint
	};
}

function withCandidateEvidenceStates(
	extraction: LocalAiArtifactExtraction
): LocalAiArtifactExtraction {
	return {
		...extraction,
		candidateItems: extraction.candidateItems.map((candidate) => ({
			...candidate,
			evidenceState: candidate.evidenceState ?? {
				hasEvidenceRefs: candidate.evidenceRefs.length > 0,
				unresolvedReasons: candidate.evidenceRefs.length > 0 ? [] : ['missing_evidence_ref']
			}
		}))
	};
}

function sanitiseConfidence(value: unknown): ReturnType<typeof fallbackConfidence> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return fallbackConfidence();
	}

	const record = value as Record<string, unknown>;
	const overall = pickNumber(record.overall);
	const extraction = pickNumber(record.extraction);
	const mapping = pickNumber(record.mapping);
	const quantity = pickNumber(record.quantity);

	if (overall == null || extraction == null || mapping == null || quantity == null) {
		return fallbackConfidence();
	}

	return {
		overall: Math.max(0, Math.min(1, overall)),
		extraction: Math.max(0, Math.min(1, extraction)),
		mapping: Math.max(0, Math.min(1, mapping)),
		quantity: Math.max(0, Math.min(1, quantity))
	};
}

function fallbackConfidence() {
	return {
		overall: 0.5,
		extraction: 0.5,
		mapping: 0.2,
		quantity: 0.5
	};
}

const LOCAL_DRAFT_MISSING_EVIDENCE_QUESTION =
	'Confirm source evidence before using this Local AI draft item.';

function downgradeLocalEvidenceConfidence(confidence: ReturnType<typeof fallbackConfidence>) {
	return {
		overall: Math.min(confidence.overall, 0.25),
		extraction: Math.min(confidence.extraction, 0.2),
		mapping: Math.min(confidence.mapping, 0.15),
		quantity: Math.min(confidence.quantity, 0.2)
	};
}

function draftTakeoffItemHasEvidence(item: AiDraftEstimate['takeoff_items'][number]): boolean {
	return (
		item.evidence_refs.length > 0 ||
		item.cost_components.some((component) => component.evidence_refs.length > 0)
	);
}

function applyLocalEvidenceValidationGate(draft: AiDraftEstimate): AiDraftEstimate {
	const issues = [...draft.issues];
	const takeoffItems = draft.takeoff_items.map((item) => {
		const itemHasAnyEvidence = draftTakeoffItemHasEvidence(item);
		const missingEvidenceComponents = item.cost_components.filter(
			(component) => component.evidence_refs.length === 0
		);
		if (itemHasAnyEvidence && missingEvidenceComponents.length === 0) {
			return item;
		}

		const evidenceIssue = {
			code: 'local_draft_missing_evidence_ref',
			message:
				missingEvidenceComponents.length > 0 && itemHasAnyEvidence
					? `Local AI proposed ${missingEvidenceComponents.length} component(s) for “${item.name}” without source evidence refs. Review the source artifact before using those draft components.`
					: `Local AI proposed “${item.name}” without source evidence refs. Review the source artifact before using this draft item.`,
			severity: 'warning',
			fileId: null,
			fileName: null
		} as const;
		if (
			!issues.some(
				(issue) => issue.code === evidenceIssue.code && issue.message === evidenceIssue.message
			)
		) {
			issues.push(evidenceIssue);
		}

		return {
			...item,
			confidence: itemHasAnyEvidence
				? item.confidence
				: downgradeLocalEvidenceConfidence(item.confidence),
			open_questions: Array.from(
				new Set([...item.open_questions, LOCAL_DRAFT_MISSING_EVIDENCE_QUESTION])
			),
			cost_components: item.cost_components.map((component) => ({
				...component,
				confidence:
					component.evidence_refs.length > 0
						? component.confidence
						: downgradeLocalEvidenceConfidence(component.confidence),
				mapping_status: component.evidence_refs.length > 0 ? component.mapping_status : 'unresolved'
			}))
		};
	});

	return AiDraftRunEstimateSchema.parse({
		...draft,
		takeoff_items: takeoffItems,
		issues
	});
}

function truncateSentence(value: string, maxLength = 220): string {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}

	return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripBulletPrefix(value: string): string {
	return value.replace(/^[-*]\s+/, '').trim();
}

function normaliseWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function compactTextLines(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

function buildHeuristicEvidenceRef(params: {
	artifact: Pick<AiPreparedArtifact, 'fileId' | 'fileName' | 'kind'>;
	lineNumber: number;
	summary: string;
	evidenceIdentifier?: string | null;
	viewLabel?: string | null;
}): AiEvidenceRef {
	return AiEvidenceRefSchema.parse({
		file_id: params.artifact.fileId,
		file_name: params.artifact.fileName,
		artifact_kind: params.artifact.kind,
		page_number: null,
		view_label: params.viewLabel ?? null,
		...(params.evidenceIdentifier ? { evidence_identifier: params.evidenceIdentifier } : {}),
		quote_path: `heuristic.line.${params.lineNumber}`,
		summary: truncateSentence(params.summary, 120)
	});
}

function normaliseComponentCategory(
	value: unknown
): 'material' | 'labour' | 'equipment' | 'subcontract' | 'misc' {
	const lower = pickString(value)?.toLowerCase();
	if (
		lower === 'material' ||
		lower === 'labour' ||
		lower === 'equipment' ||
		lower === 'subcontract' ||
		lower === 'misc'
	) {
		return lower;
	}
	return 'misc';
}

function inferCandidateCategory(
	candidate: LocalAiArtifactExtraction['candidateItems'][number]
): 'material' | 'labour' | 'equipment' | 'subcontract' | 'misc' {
	const source = normaliseWhitespace(`${candidate.label} ${candidate.notes}`.toLowerCase());
	const bundleLikeUnit =
		candidate.unitHint === 'lot' ||
		candidate.unitHint === 'job' ||
		candidate.unitHint === 'set' ||
		candidate.unitHint === 'fixed';
	const materialBundleSignals =
		/\b(package|supply|steel|plate|base plate|hardware|material|fabrication|canopy|washer|washers|shaft|shafts|roller|rollers|casting|cast iron|mild steel|ms|4140|alloy)\b/.test(
			source
		);
	const labourOnlySignals =
		/\b(installer|installers|crew|labou?r|labour|manhour|man-hour|day rate|day rates)\b/.test(
			source
		);
	if (bundleLikeUnit && materialBundleSignals && !labourOnlySignals) {
		return 'material';
	}
	if (
		/\b(installer|installation|install|crew|labou?r|labour|manhour|man-hour|day rate|day rates)\b/.test(
			source
		)
	) {
		return 'labour';
	}
	if (/\b(crane|scissor lift|forklift|excavator|elevating work platform|ewp)\b/.test(source)) {
		return 'equipment';
	}
	if (/\b(subcontract|subbie|outsourced|external)\b/.test(source)) {
		return 'subcontract';
	}
	if (
		/\b(package|supply|steel|plate|base plate|hardware|material|fabrication|canopy|washer|washers|shaft|shafts|roller|rollers|casting|cast iron|mild steel|ms|4140|alloy)\b/.test(
			source
		)
	) {
		return 'material';
	}
	return 'misc';
}

function isCandidateLikelyStandaloneTakeoff(
	candidate: LocalAiArtifactExtraction['candidateItems'][number]
): boolean {
	const source = normaliseWhitespace(`${candidate.label} ${candidate.notes}`.toLowerCase());
	if (
		/\b(client wants|use prior|rush fabrication|after-hours|preferred|commercially reasonable|keep unresolved)\b/.test(
			source
		)
	) {
		return false;
	}
	if (source.length > 150 && candidate.quantityHint == null) {
		return false;
	}
	return (
		candidate.quantityHint != null ||
		/\b(package|canopy|assembly|system|scope|entry canopy|structural steel|shaft|roller|bracket|washer|plate|gear|flange|bush(?:ing)?|casting|housing|frame|seat|part|component)\b/.test(
			source
		)
	);
}

function isGenericEvidenceCandidate(
	candidate: LocalAiArtifactExtraction['candidateItems'][number]
): boolean {
	return /\b(?:cad|drawing|document)\s+(?:summary|evidence)\b/i.test(
		normaliseWhitespace(`${candidate.label} ${candidate.notes}`)
	);
}

function pickPrimaryFallbackCandidate(
	candidates: LocalAiArtifactExtraction['candidateItems']
): LocalAiArtifactExtraction['candidateItems'][number] | null {
	const specificCandidates = candidates.filter(
		(candidate) => !isGenericEvidenceCandidate(candidate)
	);
	const candidatePool = specificCandidates.length > 0 ? specificCandidates : candidates;
	const quantityPreferred = candidatePool.find((candidate) => {
		const unit = candidate.unitHint ?? '';
		return unit === 'lot' || unit === 'job' || unit === 'set' || unit === 'fixed';
	});
	if (quantityPreferred) {
		return quantityPreferred;
	}

	const labelledPreferred = candidatePool.find((candidate) =>
		/\b(package|canopy|assembly|system|entry canopy|structural steel)\b/i.test(
			normaliseWhitespace(`${candidate.label} ${candidate.notes}`)
		)
	);
	return labelledPreferred ?? candidatePool[0] ?? null;
}

function normaliseCostComponent(
	component: unknown,
	componentIndex: number
): Record<string, unknown> {
	const componentRecord: Record<string, unknown> =
		component && typeof component === 'object' && !Array.isArray(component)
			? (component as Record<string, unknown>)
			: {};
	return {
		category: normaliseComponentCategory(componentRecord.category),
		name: pickString(componentRecord.name) ?? `Cost component ${componentIndex + 1}`,
		description: pickString(componentRecord.description) ?? pickString(componentRecord.notes) ?? '',
		quantity: Math.max(0, pickNumber(componentRecord.quantity) ?? 0),
		unit: normaliseTakeoffUnitHint(pickString(componentRecord.unit)) ?? 'ea',
		rate_hint: Math.max(0, pickNumber(componentRecord.rate_hint) ?? 0) || null,
		sort_order: Math.max(
			0,
			Math.trunc(
				pickNumber(componentRecord.sort_order) ??
					pickNumber(componentRecord.sortOrder) ??
					componentIndex
			)
		),
		evidence_refs: sanitiseEvidenceRefs(
			componentRecord.evidence_refs ?? componentRecord.evidenceRefs
		),
		confidence: sanitiseConfidence(componentRecord.confidence)
	};
}

function normaliseTakeoffItem(item: unknown, itemIndex: number): Record<string, unknown> {
	const itemRecord: Record<string, unknown> =
		item && typeof item === 'object' && !Array.isArray(item)
			? (item as Record<string, unknown>)
			: {};
	const costComponentsRaw: unknown[] = pickArrayField(itemRecord, [
		'cost_components',
		'costComponents',
		'components'
	]);

	return {
		name:
			pickString(itemRecord.name) ??
			pickString(itemRecord.label) ??
			`Takeoff item ${itemIndex + 1}`,
		description: pickString(itemRecord.description) ?? pickString(itemRecord.notes) ?? '',
		quantity: Math.max(0, pickNumber(itemRecord.quantity) ?? 0),
		unit: normaliseTakeoffUnitHint(pickString(itemRecord.unit)) ?? 'ea',
		sort_order: Math.max(
			0,
			Math.trunc(pickNumber(itemRecord.sort_order) ?? pickNumber(itemRecord.sortOrder) ?? itemIndex)
		),
		cost_components: costComponentsRaw.map(normaliseCostComponent),
		evidence_refs: sanitiseEvidenceRefs(itemRecord.evidence_refs ?? itemRecord.evidenceRefs),
		confidence: sanitiseConfidence(itemRecord.confidence),
		open_questions:
			(Array.isArray(itemRecord.open_questions) ? itemRecord.open_questions : null) ??
			(Array.isArray(itemRecord.openQuestions) ? itemRecord.openQuestions : null) ??
			[]
	};
}

export function normaliseOutlineShape(raw: Record<string, unknown>): Record<string, unknown> {
	const takeoffItemsRaw: unknown[] = pickArrayField(raw, [
		'takeoff_items',
		'takeoffItems',
		'items'
	]);

	return {
		scope_summary:
			pickString(raw.scope_summary) ??
			pickString(raw.scopeSummary) ??
			pickString(raw.summary) ??
			'Review the extracted evidence and confirm the required estimating scope.',
		notes: pickString(raw.notes) ?? '',
		classification_system_id:
			pickNullableString(raw.classification_system_id) ??
			pickNullableString(raw.classificationSystemId),
		wbs_root_node_id:
			pickNullableString(raw.wbs_root_node_id) ?? pickNullableString(raw.wbsRootNodeId),
		takeoff_items: takeoffItemsRaw.map(normaliseTakeoffItem),
		issues: raw.issues
	};
}

const ESTIMATING_RELEVANCE_PATTERN =
	/\b(rfq|quote|estimate|fabricat|manufactur|machine|machining|material|steel|stainless|aluminium|aluminum|shaft|plate|bracket|canopy|drawing|cad|weld|cut|drill|turn|mill|bend|fold|finish|coat|quantity|qty|dimension|tolerance|assembly|install)\b/i;

function isExtractionRelevantForDraft(extraction: LocalAiArtifactExtraction): boolean {
	if (extraction.runDisposition === 'irrelevant') return false;
	if (extraction.runDisposition === 'relevant' || extraction.runDisposition === 'uncertain') {
		return true;
	}
	if (extraction.extractionSource === 'unavailable') return false;
	if (extraction.candidateItems.some(isCandidateLikelyStandaloneTakeoff)) return true;
	return ESTIMATING_RELEVANCE_PATTERN.test(
		[extraction.summary, ...extraction.estimatingSignals].join(' ')
	);
}

function assignRunEvidenceDispositions(params: {
	extractions: LocalAiArtifactExtraction[];
	decisions: LocalAiAssetEvidenceRelevance['files'];
}): LocalAiArtifactExtraction[] {
	const decisions = new Map(params.decisions.map((decision) => [decision.fileId, decision]));
	return params.extractions.map((extraction) => {
		if (
			extraction.extractionSource === 'unavailable' ||
			extraction.extractionSource === 'deterministic_filtered' ||
			extraction.estimatingUtility === 'none'
		) {
			return {
				...extraction,
				runDisposition: 'irrelevant',
				runDispositionReason: 'No usable estimating evidence was available for this run.'
			};
		}
		const decision = decisions.get(extraction.fileId);
		if (decision) {
			return {
				...extraction,
				runDisposition: decision.disposition,
				runDispositionReason: decision.reason
			};
		}
		return {
			...extraction,
			runDisposition: 'uncertain',
			runDispositionReason: 'Asset relevance was not conclusively classified during this run.'
		};
	});
}

export function buildFallbackOutlineFromExtractions(params: {
	extractions: LocalAiArtifactExtraction[];
	detail: string;
}): LocalStoredDraftOutline {
	const relevantExtractions = params.extractions.filter(isExtractionRelevantForDraft);
	const candidateItems = relevantExtractions.flatMap((extraction) => extraction.candidateItems);
	const fallbackNotes = relevantExtractions
		.flatMap((extraction) => extraction.estimatingSignals)
		.filter(
			(signal) =>
				!candidateItems.some(
					(candidate) => candidate.notes === signal || candidate.label === signal
				)
		)
		.slice(0, 6)
		.join(' ');

	const seededTakeoffItems = relevantExtractions.flatMap((extraction, extractionIndex) => {
		const fileCandidates = extraction.candidateItems.filter(isCandidateLikelyStandaloneTakeoff);
		const primaryCandidate = pickPrimaryFallbackCandidate(fileCandidates);
		if (!primaryCandidate) return [];
		const supportingCandidates = fileCandidates.filter(
			(candidate) => candidate !== primaryCandidate && !isGenericEvidenceCandidate(candidate)
		);
		return [
			{
				name: pickString(primaryCandidate.label) ?? 'Primary takeoff item',
				description: pickString(primaryCandidate.notes) ?? pickString(primaryCandidate.label) ?? '',
				quantity: Math.max(0, pickNumber(primaryCandidate.quantityHint) ?? 1),
				unit: primaryCandidate.unitHint ?? 'ea',
				sort_order: extractionIndex,
				cost_components: [
					{
						category: inferCandidateCategory(primaryCandidate),
						name: pickString(primaryCandidate.label) ?? 'Primary cost component',
						description:
							pickString(primaryCandidate.notes) ?? pickString(primaryCandidate.label) ?? '',
						quantity:
							inferCandidateCategory(primaryCandidate) === 'labour'
								? Math.max(0, pickNumber(primaryCandidate.quantityHint) ?? 1)
								: 1,
						unit:
							inferCandidateCategory(primaryCandidate) === 'labour'
								? (primaryCandidate.unitHint ?? 'ea')
								: primaryCandidate.unitHint === 'lot' ||
									  primaryCandidate.unitHint === 'job' ||
									  primaryCandidate.unitHint === 'set' ||
									  primaryCandidate.unitHint === 'fixed'
									? primaryCandidate.unitHint
									: 'ea',
						rate_hint: null,
						sort_order: 0,
						evidence_refs: sanitiseEvidenceRefs(primaryCandidate.evidenceRefs),
						confidence: fallbackConfidence()
					},
					...supportingCandidates.map((candidate, index) => ({
						category: inferCandidateCategory(candidate),
						name: pickString(candidate.label) ?? `Supporting cost component ${index + 1}`,
						description: pickString(candidate.notes) ?? pickString(candidate.label) ?? '',
						quantity: Math.max(
							0,
							pickNumber(candidate.quantityHint) ??
								(inferCandidateCategory(candidate) === 'labour' ? 1 : 1)
						),
						unit:
							candidate.unitHint ?? (inferCandidateCategory(candidate) === 'labour' ? 'day' : 'ea'),
						rate_hint: null,
						sort_order: index + 1,
						evidence_refs: sanitiseEvidenceRefs(candidate.evidenceRefs),
						confidence: fallbackConfidence()
					}))
				],
				evidence_refs: dedupeEvidenceRefs([
					...sanitiseEvidenceRefs(primaryCandidate.evidenceRefs),
					...supportingCandidates.flatMap((candidate) =>
						sanitiseEvidenceRefs(candidate.evidenceRefs)
					)
				]),
				confidence: fallbackConfidence(),
				open_questions: []
			}
		];
	});

	const firstSummary =
		relevantExtractions.map((item) => pickString(item.summary)).find((value) => value != null) ??
		null;

	const warningIssue: LocalStoredIssue = {
		code: 'local_outline_shape_repaired',
		message: `Local AI returned a partial outline shape. Kwantflow repaired the draft contract: ${params.detail}`,
		severity: 'warning',
		fileId: null,
		fileName: null
	};

	return AiDraftOutlineSchema.parse({
		scope_summary:
			firstSummary ?? 'Review extracted evidence and confirm estimating scope before final save.',
		notes: fallbackNotes,
		classification_system_id: null,
		wbs_root_node_id: null,
		takeoff_items: seededTakeoffItems,
		issues: [warningIssue]
	});
}

function outlineHasEvidenceRefs(outline: LocalStoredDraftOutline): boolean {
	return outline.takeoff_items.some((item) => {
		if (item.evidence_refs.length > 0) {
			return true;
		}

		return item.cost_components.some((component) => component.evidence_refs.length > 0);
	});
}

function buildFallbackCandidateSet(extractions: LocalAiArtifactExtraction[]) {
	const candidateItems = extractions
		.flatMap((extraction) => extraction.candidateItems)
		.filter(isCandidateLikelyStandaloneTakeoff);
	const primaryCandidate = pickPrimaryFallbackCandidate(candidateItems);
	const supportingCandidates = primaryCandidate
		? candidateItems.filter((candidate) => candidate !== primaryCandidate)
		: [];

	return {
		candidateItems,
		primaryCandidate,
		supportingCandidates
	};
}

function outlineShouldPreferHeuristicBundle(
	outline: LocalStoredDraftOutline,
	extractions: LocalAiArtifactExtraction[]
): boolean {
	const { primaryCandidate, supportingCandidates } = buildFallbackCandidateSet(extractions);
	if (!primaryCandidate) {
		return false;
	}

	const primaryUnit = primaryCandidate.unitHint ?? null;
	const bundleCandidate =
		primaryUnit === 'lot' ||
		primaryUnit === 'job' ||
		primaryUnit === 'set' ||
		primaryUnit === 'fixed';
	if (!bundleCandidate) {
		return false;
	}

	const missingEvidence = !outlineHasEvidenceRefs(outline);
	const splitOutline = outline.takeoff_items.length > 1;
	const labourCandidateQuantity = supportingCandidates
		.filter((candidate) => inferCandidateCategory(candidate) === 'labour')
		.map((candidate) => pickNumber(candidate.quantityHint))
		.find((quantity): quantity is number => quantity != null && quantity > 0);
	const outlineLabourQuantity = outline.takeoff_items
		.flatMap((item) => item.cost_components)
		.filter((component) => component.category === 'labour')
		.map((component) => component.quantity)
		.find((quantity) => Number.isFinite(quantity) && quantity > 0);
	const labourUndercounted =
		labourCandidateQuantity != null &&
		outlineLabourQuantity != null &&
		labourCandidateQuantity > outlineLabourQuantity;

	return (missingEvidence && splitOutline) || labourUndercounted;
}

function outlineNeedsHeuristicSeeding(
	outline: LocalStoredDraftOutline,
	extractions: LocalAiArtifactExtraction[]
): boolean {
	const hasCandidateItems = extractions.some((extraction) => extraction.candidateItems.length > 0);
	if (!hasCandidateItems || outline.takeoff_items.length === 0) {
		return false;
	}

	return outline.takeoff_items.every(
		(item) =>
			item.quantity <= 0 &&
			item.cost_components.length === 0 &&
			item.evidence_refs.length === 0 &&
			item.open_questions.length === 0
	);
}

function parseLocalDraftOutlineWithRepair(params: {
	rawContent: unknown;
	extractions: LocalAiArtifactExtraction[];
}): LocalStoredDraftOutline {
	let raw: Record<string, unknown>;
	try {
		raw = normaliseJsonLikeContent(params.rawContent);
	} catch (error) {
		return buildFallbackOutlineFromExtractions({
			extractions: params.extractions,
			detail:
				error instanceof Error && error.message
					? error.message
					: 'model returned a non-JSON outline response'
		});
	}
	const normalised = normaliseOutlineShape(raw);
	const parsed = AiDraftOutlineSchema.safeParse(normalised);
	if (parsed.success) {
		const hasCandidateItems = params.extractions.some(
			(extraction) => extraction.candidateItems.length > 0
		);
		if (!hasCandidateItems || parsed.data.takeoff_items.length > 0) {
			if (outlineShouldPreferHeuristicBundle(parsed.data, params.extractions)) {
				const seeded = buildFallbackOutlineFromExtractions({
					extractions: params.extractions,
					detail:
						'model outline split or undercounted bundled extraction evidence and was replaced with deterministic local outline seeding'
				});
				return AiDraftOutlineSchema.parse({
					...seeded,
					scope_summary: parsed.data.scope_summary,
					notes: parsed.data.notes || seeded.notes,
					classification_system_id: parsed.data.classification_system_id ?? null,
					wbs_root_node_id: parsed.data.wbs_root_node_id ?? null,
					issues: [...parsed.data.issues, ...seeded.issues]
				});
			}

			if (!outlineNeedsHeuristicSeeding(parsed.data, params.extractions)) {
				return parsed.data;
			}

			const seeded = buildFallbackOutlineFromExtractions({
				extractions: params.extractions,
				detail:
					'model returned takeoff items without resolved quantities, evidence refs, or seeded cost components'
			});
			return AiDraftOutlineSchema.parse({
				...seeded,
				scope_summary: parsed.data.scope_summary,
				notes: parsed.data.notes || seeded.notes,
				classification_system_id: parsed.data.classification_system_id ?? null,
				wbs_root_node_id: parsed.data.wbs_root_node_id ?? null,
				issues: [...parsed.data.issues, ...seeded.issues]
			});
		}

		if (parsed.data.takeoff_items.length > 0) {
			return parsed.data;
		}

		const seeded = buildFallbackOutlineFromExtractions({
			extractions: params.extractions,
			detail: 'model returned an empty takeoff_items array'
		});
		return AiDraftOutlineSchema.parse({
			...seeded,
			scope_summary: parsed.data.scope_summary,
			notes: parsed.data.notes,
			classification_system_id: parsed.data.classification_system_id ?? null,
			wbs_root_node_id: parsed.data.wbs_root_node_id ?? null,
			issues: [...parsed.data.issues, ...seeded.issues]
		});
	}

	const detail = parsed.error.issues
		.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
		.slice(0, 3)
		.join('; ');
	return buildFallbackOutlineFromExtractions({
		extractions: params.extractions,
		detail: detail || 'unknown shape issue'
	});
}

export function repairDraftRunResultHeuristicOutline(
	result: z.infer<typeof AiDraftRunResultSchema>
): z.infer<typeof AiDraftRunResultSchema> {
	if (result.draftAgentFinal) {
		return result;
	}
	if (!result.draftOutline) {
		return result;
	}

	const rawExtractions = result.extractions.filter(
		(extraction): extraction is Record<string, unknown> =>
			typeof extraction === 'object' && extraction !== null
	);
	const extractions = normaliseUnknownExtractions(rawExtractions);
	if (extractions.length === 0) {
		return result;
	}

	const parsedOutline = AiDraftOutlineSchema.safeParse(result.draftOutline);
	if (!parsedOutline.success) {
		return result;
	}

	const repairDetail = outlineShouldPreferHeuristicBundle(parsedOutline.data, extractions)
		? 'model outline split or undercounted bundled extraction evidence and was replaced with deterministic local outline seeding'
		: outlineNeedsHeuristicSeeding(parsedOutline.data, extractions)
			? 'model returned takeoff items without resolved quantities, evidence refs, or seeded cost components'
			: null;

	if (!repairDetail) {
		return result;
	}

	const seeded = buildFallbackOutlineFromExtractions({
		extractions,
		detail: repairDetail
	});
	const repairedOutline = AiDraftOutlineSchema.parse({
		...seeded,
		scope_summary: parsedOutline.data.scope_summary,
		notes: parsedOutline.data.notes || seeded.notes,
		classification_system_id: parsedOutline.data.classification_system_id ?? null,
		wbs_root_node_id: parsedOutline.data.wbs_root_node_id ?? null,
		issues: [...parsedOutline.data.issues, ...seeded.issues]
	});
	const repairedMatching = buildDeterministicDraftMatchingFromOutline(repairedOutline);
	const repairedDraft = composeFinalDraftFromOutlineAndMatching({
		outline: repairedOutline,
		matching: repairedMatching
	});

	return {
		...result,
		draftOutline: repairedOutline,
		draftMatching: repairedMatching,
		draft: repairedDraft,
		issues: [...result.issues, ...seeded.issues]
	};
}

const GENERIC_LOCAL_MODEL_ISSUE_PATTERN = /^Local AI flagged a review item at position \d+\.$/;
const LOCAL_MODEL_QUANTITY_WARNING_PATTERN =
	/^Quantities for takeoff items were not provided in the evidence\./i;
const LOCAL_MODEL_RATE_VALIDATION_WARNING_PATTERN =
	/^The unit rate for the '.*' \([A-Z0-9-]+\) is available but requires commercial validation\.$/i;
const LOCAL_MODEL_MISSING_INLINE_IMAGE_PATTERN =
	/^The attached image \[img-\d+\] was mentioned but not provided for extraction\.$/i;

function hasResolvedTakeoffQuantities(draft: AiDraftEstimate): boolean {
	return (
		draft.takeoff_items.length > 0 &&
		draft.takeoff_items.every(
			(item) =>
				Number.isFinite(item.quantity) && typeof item.quantity === 'number' && item.quantity > 0
		)
	);
}

export function stripLocalModelIssueNoise(draft: AiDraftEstimate): AiDraftEstimate {
	const hasQuantities = hasResolvedTakeoffQuantities(draft);

	return {
		...draft,
		issues: draft.issues.filter((issue) => {
			if (LOCAL_MODEL_MISSING_INLINE_IMAGE_PATTERN.test(issue.message)) {
				return false;
			}

			if (issue.code !== 'local_model_issue') {
				return true;
			}

			if (GENERIC_LOCAL_MODEL_ISSUE_PATTERN.test(issue.message)) {
				return false;
			}

			if (hasQuantities && LOCAL_MODEL_QUANTITY_WARNING_PATTERN.test(issue.message)) {
				return false;
			}

			if (LOCAL_MODEL_RATE_VALIDATION_WARNING_PATTERN.test(issue.message)) {
				return false;
			}

			return true;
		})
	};
}

function buildSingleArtifactEvidenceUnitKey(
	artifact: Extract<AiPreparedArtifact, { kind: 'text' | 'image' }>
): string {
	if (artifact.kind === 'text') {
		const chunkMetadata = artifact.sourceMetadata?.textChunk;
		const chunkIndex =
			chunkMetadata && typeof chunkMetadata === 'object' && !Array.isArray(chunkMetadata)
				? pickNumber((chunkMetadata as Record<string, unknown>).index)
				: null;
		return `text:${artifact.sourceFormat ?? 'plain_text'}:chunk:${Math.max(1, Math.trunc(chunkIndex ?? 1))}`;
	}

	const tileMetadata = artifact.sourceMetadata?.tileGrid;
	if (tileMetadata && typeof tileMetadata === 'object' && !Array.isArray(tileMetadata)) {
		const tile = tileMetadata as Record<string, unknown>;
		const rowIndex = pickNumber(tile.rowIndex);
		const colIndex = pickNumber(tile.colIndex);
		if (rowIndex !== null && colIndex !== null && rowIndex >= 0 && colIndex >= 0) {
			return `image:raster:tile:r${Math.trunc(rowIndex) + 1}:c${Math.trunc(colIndex) + 1}`;
		}
	}
	return 'image:raster:1';
}

export function buildCompletionArtifacts(
	artifact: AiPreparedArtifact,
	allowRasterImageCompletions: boolean
): LocalAiCompletionArtifact[] {
	switch (artifact.kind) {
		case 'text': {
			const evidenceUnitKey = buildSingleArtifactEvidenceUnitKey(artifact);
			return artifact.textContent.trim()
				? [
						{
							kind: 'text',
							textContent: `Text evidence from ${artifact.fileName} (evidence id ${evidenceUnitKey}):\n${artifact.textContent}`
						}
					]
				: [];
		}
		case 'pdf': {
			const parts: LocalAiCompletionArtifact[] = [];
			if (artifact.textContent.trim()) {
				parts.push({
					kind: 'text',
					textContent: `PDF extracted text from ${artifact.fileName} (pages 1-${artifact.pageCount}; cite with page_number where possible):\n${artifact.textContent}`
				});
			}
			if (allowRasterImageCompletions) {
				for (const page of artifact.rasterPages) {
					parts.push({
						kind: 'text',
						textContent: `PDF raster evidence from ${artifact.fileName}, page ${page.pageNumber}, follows. Use evidence id pdf:raster:page:${page.pageNumber} and page_number ${page.pageNumber} for facts visible only in this image.`
					});
					parts.push({
						kind: 'image',
						mimeType: page.mimeType,
						base64Data: page.inlineData
					});
				}
			}
			return parts;
		}
		case 'image': {
			if (!allowRasterImageCompletions) {
				return [];
			}
			const parts: LocalAiCompletionArtifact[] = [
				{
					kind: 'image',
					mimeType: artifact.mimeType,
					base64Data: artifact.inlineData
				}
			];
			const evidenceUnitKey = buildSingleArtifactEvidenceUnitKey(artifact);
			let textContent = `Normalised raster image evidence from ${artifact.fileName} follows. Use evidence id ${evidenceUnitKey} for visible markings, dimensions, labels, or quantities.`;
			if (artifact.sourceMetadata?.tileGrid) {
				textContent += `\nImage coordinate grid metadata (this image is a cropped tile from the main document):\n${JSON.stringify(artifact.sourceMetadata.tileGrid, null, 2)}`;
			}
			parts.push({
				kind: 'text',
				textContent
			});
			return parts;
		}
		case 'cad': {
			const parts: LocalAiCompletionArtifact[] = artifact.summaryText.trim()
				? [
						{
							kind: 'text',
							textContent: `CAD summary for ${artifact.fileName} (evidence id cad:metadata):\n${artifact.summaryText}`
						}
					]
				: [];
			if (allowRasterImageCompletions) {
				for (const render of artifact.renders) {
					parts.push({
						kind: 'image',
						mimeType: render.mimeType,
						base64Data: render.data
					});
					parts.push({
						kind: 'text',
						textContent: `CAD render evidence from ${artifact.fileName}, view ${render.viewLabel}, follows. Use evidence id cad:render:${render.viewLabel} for facts visible only in this view.`
					});
				}
			}
			return parts;
		}
	}
}

/**
 * Split CAD completion artifacts into sequential batches, one per render view.
 * Each batch includes the CAD summary text plus one render (text label + image).
 * Used for high-density CAD models where sending all renders simultaneously
 * would exceed the VLM unified memory budget.
 */
export function buildSequentialCadBatches(
	completionArtifacts: LocalAiCompletionArtifact[]
): LocalAiCompletionArtifact[][] {
	if (completionArtifacts.length < 4) {
		// Fewer than 2 renders (1 summary + 1 text + 1 image), no batching needed
		return [completionArtifacts];
	}

	const summaryPart = completionArtifacts[0];
	if (!summaryPart || summaryPart.kind !== 'text') {
		// Unexpected structure, fall back to single batch
		return [completionArtifacts];
	}

	const batches: LocalAiCompletionArtifact[][] = [];
	const remainingParts = completionArtifacts.slice(1);

	for (let i = 0; i < remainingParts.length; i += 2) {
		const imagePart = remainingParts[i];
		const textPart = remainingParts[i + 1];
		if (imagePart && textPart && imagePart.kind === 'image' && textPart.kind === 'text') {
			batches.push([summaryPart, imagePart, textPart]);
		}
	}

	return batches.length > 1 ? batches : [completionArtifacts];
}

export type LocalAiEvidenceUnit = {
	key: string;
	artifacts: LocalAiCompletionArtifact[];
};

export function hasCompleteEvidenceUnitCoverage(params: {
	fileId: string;
	required: Array<{ key: string; unitHash: string }>;
	coverage: Array<{
		fileId: string;
		unitKey: string;
		unitHash: string;
		state: 'cached' | 'completed' | 'failed' | 'omitted';
		failureCategory?: string | null;
	}>;
}): boolean {
	return params.required.every((requiredUnit) =>
		params.coverage.some(
			(coverage) =>
				coverage.fileId === params.fileId &&
				coverage.unitKey === requiredUnit.key &&
				coverage.unitHash === requiredUnit.unitHash &&
				(coverage.state === 'completed' ||
					coverage.state === 'cached' ||
					(coverage.state === 'omitted' &&
						isNonBlockingDeterministicEvidenceOmission(coverage.failureCategory)))
		)
	);
}

function isNonBlockingDeterministicEvidenceOmission(
	failureCategory: string | null | undefined
): boolean {
	return (
		failureCategory === 'deterministic_filtered' ||
		failureCategory === 'deterministic_cad_render_omitted'
	);
}

const LOCAL_AI_TEXT_UNIT_CHAR_LIMIT = 12_000;
const LOCAL_AI_DETERMINISTIC_PDF_TEXT_CHAR_THRESHOLD = 6_000;

function sanitiseEvidenceTextForLocalAi(text: string): string {
	return (
		text
			.replace(/\r\n?/g, '\n')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{4,}/g, '\n\n\n')
			.trim()
	);
}

function splitEvidenceText(text: string): string[] {
	const safeText = sanitiseEvidenceTextForLocalAi(text);
	if (safeText.length <= LOCAL_AI_TEXT_UNIT_CHAR_LIMIT) return safeText ? [safeText] : [];
	const chunks: string[] = [];
	for (let offset = 0; offset < safeText.length; offset += LOCAL_AI_TEXT_UNIT_CHAR_LIMIT) {
		chunks.push(safeText.slice(offset, offset + LOCAL_AI_TEXT_UNIT_CHAR_LIMIT));
	}
	return chunks;
}

export function buildSequentialEvidenceUnits(
	artifact: AiPreparedArtifact,
	allowRasterImageCompletions: boolean
): LocalAiEvidenceUnit[] {
	if (artifact.kind === 'pdf') {
		const units: LocalAiEvidenceUnit[] = [];
		for (const [index, text] of splitEvidenceText(artifact.textContent.trim()).entries()) {
			if (!text) continue;
			units.push({
				key: `pdf:text:${index + 1}`,
				artifacts: [
					{
						kind: 'text',
						textContent: `PDF extracted text from ${artifact.fileName}, text unit ${index + 1} (cite page numbers when present):\n${text}`
					}
				]
			});
		}
		if (allowRasterImageCompletions) {
			for (const page of artifact.rasterPages) {
				units.push({
					key: `pdf:raster:page:${page.pageNumber}`,
					artifacts: [
						{
							kind: 'text',
							textContent: `PDF raster evidence from ${artifact.fileName}, page ${page.pageNumber}. Use evidence id pdf:raster:page:${page.pageNumber}.`
						},
						{ kind: 'image', mimeType: page.mimeType, base64Data: page.inlineData }
					]
				});
			}
		}
		return units;
	}
	if (artifact.kind === 'cad') {
		const units: LocalAiEvidenceUnit[] = [];
		const summary = artifact.summaryText.trim();
		if (summary) {
			units.push({
				key: 'cad:metadata',
				artifacts: [
					{ kind: 'text', textContent: `CAD summary for ${artifact.fileName}:\n${summary}` }
				]
			});
		}
		if (allowRasterImageCompletions) {
			for (const render of artifact.renders) {
				units.push({
					key: `cad:render:${render.viewLabel}`,
					artifacts: [
						{ kind: 'image', mimeType: render.mimeType, base64Data: render.data },
						{
							kind: 'text',
							textContent: `CAD view ${render.viewLabel} for ${artifact.fileName}. Use evidence id cad:render:${render.viewLabel}.`
						}
					]
				});
			}
		}
		return units;
	}
	const artifacts = buildCompletionArtifacts(artifact, allowRasterImageCompletions);
	return artifacts.length > 0
		? [{ key: buildSingleArtifactEvidenceUnitKey(artifact), artifacts }]
		: [];
}

export function buildEvidenceInferenceBatches(
	artifactKind: AiPreparedArtifact['kind'],
	units: LocalAiEvidenceUnit[]
): LocalAiEvidenceUnit[][] {
	const maxUnits = artifactKind === 'cad' ? 5 : 4;
	const maxImages = artifactKind === 'cad' ? 4 : artifactKind === 'pdf' ? 1 : 2;
	const batches: LocalAiEvidenceUnit[][] = [];
	let current: LocalAiEvidenceUnit[] = [];
	let currentImages = 0;
	for (const unit of units) {
		const unitImages = unit.artifacts.filter((artifact) => artifact.kind === 'image').length;
		if (
			current.length > 0 &&
			(current.length >= maxUnits || currentImages + unitImages > maxImages)
		) {
			batches.push(current);
			current = [];
			currentImages = 0;
		}
		current.push(unit);
		currentImages += unitImages;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

/**
 * A structured function call carries both the envelope and the unit payload. A single evidence
 * unit can therefore need more than the old 512-token floor even though multi-unit batches remain
 * bounded by the existing 1,536-token ceiling.
 */
export function getEvidenceBatchMaxOutputTokens(unitCount: number): number {
	return Math.min(1_536, Math.max(1_024, 256 + Math.max(1, unitCount) * 256));
}

function buildEvidenceBatchExtractionPrompt(params: {
	fileName: string;
	units: LocalAiEvidenceUnit[];
}): string {
	return [
		`Review only these evidence units from "${params.fileName}": ${params.units.map((unit) => unit.key).join(', ')}.`,
		'Return exactly one units entry for every supplied unitKey.',
		'Classify contentClass as technical_drawing, specification, schedule, commercial, administrative, general_reference, or unknown.',
		'Classify estimatingUtility as high, medium, low, or none using only reusable estimating facts in that unit.',
		'Keep each summary and signal within 240 characters, at most 4 signals, and at most 3 candidate items.',
		'Do not invent dimensions, quantities, materials, operations, or certainty. Use empty arrays when a unit adds no estimating evidence.',
		'Kwantflow attaches provenance deterministically; return no citations or locator data.',
		'Return only the requested schema fields. Never return evidence text, unit_content, raw_text, textContent, or copied source content.'
	].join('\n');
}

function buildLiteRtEvidenceUnitExtractionPrompt(params: {
	fileName: string;
	unitKey: string;
}): string {
	return [
		`Review only evidence unit "${params.unitKey}" from "${params.fileName}".`,
		'Return the scalar fields declared by the tool, not a units array.',
		'Classify contentClass as technical_drawing, specification, schedule, commercial, administrative, general_reference, or unknown.',
		'Classify estimatingUtility as high, medium, low, or none using only reusable estimating facts in that unit.',
		'Keep summary within 240 characters. Put at most 4 short signals in estimatingSignalsText, separated by newlines.',
		'Use empty candidate fields when the unit contains no evidence-backed takeoff candidate.',
		'Do not invent dimensions, quantities, materials, operations, or certainty. Do not return citations, source text, raw_text, textContent, or copied evidence.'
	].join('\n');
}

function visualEvidenceTokenBudget(artifactKind: AiPreparedArtifact['kind']): number {
	// Gemma 4 supports only 70, 140, 280, 560, and 1120 visual tokens. Use the
	// smallest documented budget that preserves the evidence family we are inspecting.
	if (artifactKind === 'cad') return 560;
	if (artifactKind === 'pdf') return 280;
	return 140;
}

async function hashEvidenceUnit(unit: LocalAiEvidenceUnit): Promise<string> {
	const value = unit.artifacts
		.map((part) =>
			part.kind === 'text'
				? `text:${part.textContent}`
				: `image:${part.mimeType}:${part.base64Data}`
		)
		.join('\n');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildEvidenceUnitSetHash(units: LocalAiEvidenceUnit[]): Promise<string> {
	const entries = await Promise.all(
		units.map(async (unit) => `${unit.key}:${await hashEvidenceUnit(unit)}`)
	);
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(entries.sort().join('\n'))
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildFileSynthesisCacheKey(units: LocalAiEvidenceUnit[]): string {
	return units.length === 1 ? `file:synthesis:${units[0]!.key}` : 'file:synthesis';
}

/**
 * Merge sequential extraction results from multiple evidence units.
 * Uses the primary (iso overview) extraction as base and supplements
 * with candidate items and signals from secondary batches,
 * deduplicating by label/signal text to avoid double-counting.
 */
export function mergeSequentialEvidenceExtractions(params: {
	artifact: AiPreparedArtifact;
	evidenceIdentifiers: string[];
	extractions: LocalAiArtifactExtraction[];
}): LocalAiArtifactExtraction {
	const { artifact, evidenceIdentifiers, extractions } = params;
	if (extractions.length === 0) {
		return {
			fileId: artifact.fileId,
			fileName: artifact.fileName,
			artifactKind: artifact.kind,
			extractionSource: 'unavailable',
			evidenceIdentifiers,
			summary: '',
			estimatingSignals: [],
			candidateItems: [],
			issues: [
				{
					code: 'local_model_issue',
					message: 'No extractions were produced from sequential evidence units.',
					severity: 'warning',
					fileId: artifact.fileId,
					fileName: artifact.fileName
				}
			]
		};
	}
	if (extractions.length === 1) {
		return extractions[0];
	}

	const primary = extractions[0];
	const seenCandidateLabels = new Set(
		primary.candidateItems.map((c) => c.label.toLowerCase().trim())
	);
	const seenSignalTexts = new Set(primary.estimatingSignals.map((s) => s.toLowerCase().trim()));

	const merged: LocalAiArtifactExtraction = {
		...primary,
		evidenceIdentifiers: [...primary.evidenceIdentifiers],
		estimatingSignals: [...primary.estimatingSignals],
		candidateItems: [...primary.candidateItems],
		issues: [...primary.issues]
	};
	const seenEvidenceIdentifiers = new Set(primary.evidenceIdentifiers);

	for (const extraction of extractions.slice(1)) {
		if (extraction.extractionSource !== 'deterministic_filtered') {
			for (const evidenceIdentifier of extraction.evidenceIdentifiers) {
				if (!seenEvidenceIdentifiers.has(evidenceIdentifier)) {
					seenEvidenceIdentifiers.add(evidenceIdentifier);
					merged.evidenceIdentifiers.push(evidenceIdentifier);
				}
			}
		}
		for (const signal of extraction.estimatingSignals) {
			const key = signal.toLowerCase().trim();
			if (!seenSignalTexts.has(key)) {
				seenSignalTexts.add(key);
				merged.estimatingSignals.push(signal);
			}
		}

		for (const candidate of extraction.candidateItems) {
			const key = candidate.label.toLowerCase().trim();
			if (!seenCandidateLabels.has(key)) {
				seenCandidateLabels.add(key);
				merged.candidateItems.push(candidate);
			}
		}

		merged.issues.push(...extraction.issues);
	}

	return merged;
}

function extractionHasMeaningfulSignal(extraction: LocalAiArtifactExtraction): boolean {
	return (
		extraction.summary.trim().length > 0 ||
		extraction.estimatingSignals.length > 0 ||
		extraction.candidateItems.length > 0
	);
}

function parsePreparedTableRow(line: string): {
	label: string;
	quantityHint: string | null;
	unitHint: string | null;
	notes: string;
} | null {
	const rowMatch = line.match(/^(?:Row \d+|Table \d+ row \d+|Sheet .+ row \d+):\s*(.+)$/i);
	if (!rowMatch) return null;
	const cells = (rowMatch[1] ?? '')
		.split('|')
		.map((cell) => cell.trim())
		.filter(Boolean);
	if (cells.length === 0) return null;
	return {
		label: truncateSentence(cells[0] ?? '', 120),
		quantityHint: cells[1] && /^\d+(?:\.\d+)?$/.test(cells[1]) ? cells[1] : null,
		unitHint: cells[2] && /^[a-zA-Z0-9/²³-]+$/.test(cells[2]) ? cells[2] : null,
		notes: truncateSentence(cells.slice(3).join(' | ') || rowMatch[1] || line, 180)
	};
}

function buildHeuristicExtractionFromArtifact(
	artifact: AiPreparedArtifact
): LocalAiArtifactExtraction | null {
	const sourceText =
		artifact.kind === 'text' || artifact.kind === 'pdf'
			? artifact.textContent
			: artifact.kind === 'cad'
				? artifact.summaryText
				: '';
	const lines = compactTextLines(sourceText);
	if (lines.length === 0) {
		return null;
	}

	const informativeLines = lines.filter(
		(line) =>
			!/^#{1,6}\s*/.test(line) &&
			!/^(scope summary|indicative quantities|requested output|known commercial notes):?$/i.test(
				line
			)
	);
	const summarySource = informativeLines[0] ?? lines[0];
	const summary = truncateSentence(stripBulletPrefix(summarySource));
	const estimatingSignals = informativeLines
		.filter((line) =>
			/fabricat|install|canopy|steel|crew|day|lot|package|rush|after-hours|quote/i.test(line)
		)
		.slice(0, 6)
		.map((line) => truncateSentence(stripBulletPrefix(line), 160));

	const candidateItems: LocalAiArtifactExtraction['candidateItems'] = [];
	for (const [index, line] of lines.entries()) {
		const preparedTableRow = parsePreparedTableRow(line);
		if (preparedTableRow) {
			candidateItems.push({
				label: preparedTableRow.label,
				quantityHint: preparedTableRow.quantityHint,
				unitHint: preparedTableRow.unitHint,
				notes: preparedTableRow.notes,
				evidenceRefs: [
					buildHeuristicEvidenceRef({ artifact, lineNumber: index + 1, summary: line })
				]
			});
			continue;
		}

		const quantityMatch = line.match(
			/^[-*]\s*(.+?):\s*(\d+(?:\.\d+)?)\s+([a-zA-Z]+)(?:\s+for\s+(\d+(?:\.\d+)?)\s+([a-zA-Z]+))?/i
		);
		if (quantityMatch) {
			const derived = deriveLabourQuantityHint({
				description: quantityMatch[1],
				rawText: line,
				quantity: Number(quantityMatch[2]),
				duration:
					quantityMatch[4] && quantityMatch[5] ? `${quantityMatch[4]} ${quantityMatch[5]}` : null,
				fallbackUnit: quantityMatch[3]
			});
			candidateItems.push({
				label: truncateSentence(quantityMatch[1], 120),
				quantityHint: derived.quantityHint,
				unitHint: derived.unitHint,
				notes: truncateSentence(line, 180),
				evidenceRefs: [
					buildHeuristicEvidenceRef({ artifact, lineNumber: index + 1, summary: line })
				]
			});
			continue;
		}

		if (/^[-*]\s+/.test(line) && /fabricat|install|package|canopy|crew|steel/i.test(line)) {
			candidateItems.push({
				label: truncateSentence(line.replace(/^[-*]\s+/, ''), 120),
				quantityHint: null,
				unitHint: null,
				notes: truncateSentence(line.replace(/^[-*]\s+/, ''), 180),
				evidenceRefs: [
					buildHeuristicEvidenceRef({ artifact, lineNumber: index + 1, summary: line })
				]
			});
		}

		if (candidateItems.length >= 6) {
			break;
		}
	}

	if (artifact.kind === 'cad' && candidateItems.length === 0) {
		const candidateName = deriveCadCandidateName(artifact);
		const quantity = parseFilenameQuantity(artifact.fileName) ?? 1;
		const metadataSummary =
			pickString(artifact.summaryText) ??
			`Prepared CAD evidence for ${artifact.fileName}. Review geometry before final save.`;
		const isoRender =
			artifact.renders.find((render) => render.viewLabel === 'iso') ?? artifact.renders[0];
		candidateItems.push({
			label: candidateName,
			quantityHint: String(quantity),
			unitHint: quantity > 1 ? 'ea' : null,
			notes: truncateSentence(metadataSummary, 180),
			evidenceRefs: [
				buildHeuristicEvidenceRef({
					artifact,
					lineNumber: 1,
					summary: metadataSummary,
					evidenceIdentifier: isoRender ? `cad:render:${isoRender.viewLabel}` : 'cad:metadata',
					viewLabel: isoRender?.viewLabel ?? null
				})
			]
		});
		if (!estimatingSignals.some((signal) => signal === metadataSummary)) {
			estimatingSignals.push(truncateSentence(metadataSummary, 160));
		}
	}

	if (!summary && estimatingSignals.length === 0 && candidateItems.length === 0) {
		return null;
	}

	return {
		fileId: artifact.fileId,
		fileName: artifact.fileName,
		artifactKind: artifact.kind,
		extractionSource: 'heuristic_fallback',
		evidenceIdentifiers: [],
		summary,
		estimatingSignals,
		candidateItems,
		issues: [
			{
				code: 'local_extraction_heuristic_fallback',
				message: `${artifact.fileName} was seeded from local prepared text because the model response could not be used as structured extraction evidence.`,
				severity: 'info',
				fileId: artifact.fileId,
				fileName: artifact.fileName
			}
		]
	};
}

function buildModelEvidenceUnitExtraction(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
	parsed: z.infer<typeof LocalAiEvidenceUnitExtractionSchema>;
}): LocalAiArtifactExtraction {
	const candidateItems = params.parsed.candidateItems.map((candidate) =>
		normaliseCandidateItem({
			...candidate,
			evidenceRefs: [
				buildHeuristicEvidenceRef({
					artifact: params.artifact,
					lineNumber: 1,
					summary: candidate.notes || candidate.label,
					evidenceIdentifier: params.evidenceUnit.key
				})
			]
		})
	);
	if (
		params.artifact.kind === 'cad' &&
		params.evidenceUnit.key === 'cad:metadata' &&
		candidateItems.length === 0 &&
		params.parsed.estimatingUtility !== 'none'
	) {
		const candidateName = deriveCadCandidateName(params.artifact);
		const quantity = parseFilenameQuantity(params.artifact.fileName) ?? 1;
		const summary =
			params.parsed.summary ||
			pickString(params.artifact.summaryText) ||
			`Prepared CAD evidence for ${params.artifact.fileName}.`;
		candidateItems.push(
			normaliseCandidateItem({
				label: candidateName,
				quantityHint: String(quantity),
				unitHint: quantity > 1 ? 'ea' : null,
				notes: truncateSentence(summary, 180),
				evidenceRefs: [
					buildHeuristicEvidenceRef({
						artifact: params.artifact,
						lineNumber: 1,
						summary,
						evidenceIdentifier: params.evidenceUnit.key
					})
				]
			})
		);
	}
	return {
		fileId: params.artifact.fileId,
		fileName: params.artifact.fileName,
		artifactKind: params.artifact.kind,
		extractionSource: 'model_structured',
		contentClass: params.parsed.contentClass,
		estimatingUtility: params.parsed.estimatingUtility,
		evidenceIdentifiers: [params.evidenceUnit.key],
		summary: params.parsed.summary,
		estimatingSignals: params.parsed.estimatingSignals,
		candidateItems,
		issues: stripLocalExtractionIssueNoise(params.parsed.issues)
	};
}

function isGenericEvidenceCandidateLabel(label: string): boolean {
	return /^(?:project )?(?:scope|specification|summary|scope and commercial summary|commercial summary|project specification)$/i.test(
		normaliseWhitespace(label).replace(/[.:]+$/, '')
	);
}

/**
 * A heading is valid evidence but never a takeoff candidate. When a constrained
 * extraction places a document heading in its only candidate field, recover an
 * evidence-backed candidate from the same prepared text. This never invents
 * scope or reaches outside the reviewed unit.
 */
function recoverTextCandidateFromGenericModelOutput(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
	extraction: LocalAiArtifactExtraction;
}): LocalAiArtifactExtraction {
	if (
		params.extraction.candidateItems.some(
			(candidate) => !isGenericEvidenceCandidateLabel(candidate.label)
		)
	) {
		return params.extraction;
	}

	const heuristic = buildHeuristicExtractionFromEvidenceUnit({
		artifact: params.artifact,
		evidenceUnit: params.evidenceUnit,
		error: new Error('Model candidate was a generic document heading.')
	});
	const candidates = (heuristic?.candidateItems ?? []).filter(
		(candidate) => !isGenericEvidenceCandidateLabel(candidate.label)
	);
	if (candidates.length === 0) return params.extraction;

	return {
		...params.extraction,
		extractionSource: 'deterministic_extraction',
		candidateItems: candidates,
		issues: [
			...params.extraction.issues,
			{
				code: 'deterministic_candidate_recovery',
				message: `${params.artifact.fileName} replaced a generic document-heading candidate with a candidate grounded in the same prepared evidence.`,
				severity: 'info',
				fileId: params.artifact.fileId,
				fileName: params.artifact.fileName
			}
		]
	};
}

export function isExactEvidenceBatchExtraction(params: {
	batchUnits: LocalAiEvidenceUnit[];
	extraction: z.infer<typeof LocalAiEvidenceBatchExtractionSchema>;
}): boolean {
	const expectedKeys = new Set(params.batchUnits.map((unit) => unit.key));
	const returnedKeys = params.extraction.units.map((unit) => unit.unitKey);
	return (
		returnedKeys.length === expectedKeys.size &&
		new Set(returnedKeys).size === returnedKeys.length &&
		returnedKeys.every((key) => expectedKeys.has(key))
	);
}

function buildDeterministicFilteredExtraction(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): LocalAiArtifactExtraction {
	return {
		fileId: params.artifact.fileId,
		fileName: params.artifact.fileName,
		artifactKind: params.artifact.kind,
		extractionSource: 'deterministic_filtered',
		contentClass: 'general_reference',
		estimatingUtility: 'none',
		evidenceIdentifiers: [params.evidenceUnit.key],
		summary: '',
		estimatingSignals: [],
		candidateItems: [],
		issues: []
	};
}

function shouldUseDeterministicPdfTextUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): boolean {
	return (
		params.artifact.kind === 'pdf' &&
		params.evidenceUnit.key.startsWith('pdf:text:') &&
		!params.evidenceUnit.artifacts.some((part) => part.kind === 'image') &&
		evidenceUnitText(params.evidenceUnit).length >= LOCAL_AI_DETERMINISTIC_PDF_TEXT_CHAR_THRESHOLD
	);
}

function buildDeterministicPdfTextExtraction(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): LocalAiArtifactExtraction {
	if (shouldSkipModelForLowSignalTextUnit(params)) {
		return buildDeterministicFilteredExtraction(params);
	}
	const heuristic = buildHeuristicExtractionFromEvidenceUnit({
		artifact: params.artifact,
		evidenceUnit: params.evidenceUnit,
		error: new Error('PDF text was extracted deterministically before model inference.')
	});
	return {
		...(heuristic ?? buildDeterministicFilteredExtraction(params)),
		extractionSource: 'deterministic_extraction',
		issues: [
			{
				code: 'deterministic_pdf_text_extraction',
				message: `${params.artifact.fileName} text ${params.evidenceUnit.key} used deterministic PDF text extraction instead of model extraction.`,
				severity: 'info',
				fileId: params.artifact.fileId,
				fileName: params.artifact.fileName
			}
		]
	};
}

function isDwgOrDxfCadArtifact(artifact: AiPreparedArtifact): boolean {
	return (
		artifact.kind === 'cad' &&
		(artifact.metadata.format === 'dwg' ||
			artifact.metadata.format === 'dxf' ||
			/\.(?:dwg|dxf)$/i.test(artifact.fileName))
	);
}

function shouldUseDeterministicCadMetadataUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): boolean {
	return isDwgOrDxfCadArtifact(params.artifact) && params.evidenceUnit.key === 'cad:metadata';
}

export function shouldOmitDeterministicCadRenderUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): boolean {
	return (
		params.artifact.kind === 'cad' &&
		isDwgOrDxfCadArtifact(params.artifact) &&
		params.evidenceUnit.key.startsWith('cad:render:') &&
		params.artifact.summaryText.trim().length > 0 &&
		typeof params.artifact.metadata.entityCount === 'number' &&
		params.artifact.metadata.entityCount > 0
	);
}

function buildDeterministicCadMetadataExtraction(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): LocalAiArtifactExtraction | null {
	const heuristic = buildHeuristicExtractionFromEvidenceUnit({
		artifact: params.artifact,
		evidenceUnit: params.evidenceUnit,
		error: new Error('DWG/DXF metadata was extracted deterministically before model inference.')
	});
	if (!heuristic) return null;
	return {
		...heuristic,
		extractionSource: 'deterministic_extraction',
		issues: [
			{
				code: 'deterministic_cad_metadata_extraction',
				message: `${params.artifact.fileName} used deterministic DWG/DXF metadata instead of model extraction for scalable drafting evidence.`,
				severity: 'info',
				fileId: params.artifact.fileId,
				fileName: params.artifact.fileName
			}
		]
	};
}

function buildHeuristicExtractionFromEvidenceUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
	error: unknown;
}): LocalAiArtifactExtraction | null {
	if (params.artifact.kind === 'cad' && params.evidenceUnit.key === 'cad:metadata') {
		const artifactFallback = buildHeuristicExtractionFromArtifact(params.artifact);
		if (artifactFallback) {
			return {
				...artifactFallback,
				evidenceIdentifiers: [params.evidenceUnit.key],
				candidateItems: artifactFallback.candidateItems.map((candidate) => ({
					...candidate,
					evidenceRefs: [
						buildHeuristicEvidenceRef({
							artifact: params.artifact,
							lineNumber: 1,
							summary: candidate.notes || candidate.label,
							evidenceIdentifier: params.evidenceUnit.key
						})
					]
				})),
				issues: [buildLocalArtifactExtractionFailureIssue(params)]
			};
		}
	}

	const sourceText = params.evidenceUnit.artifacts
		.filter(
			(part): part is Extract<LocalAiCompletionArtifact, { kind: 'text' }> => part.kind === 'text'
		)
		.map((part) => part.textContent)
		.join('\n');
	const lines = compactTextLines(sourceText);
	const informativeLines = lines.filter(
		(line) =>
			!/^PDF (extracted text|raster evidence) from /i.test(line) &&
			!/^CAD (summary|view) /i.test(line) &&
			!/^Normalised raster image evidence from /i.test(line) &&
			!/^Text evidence from /i.test(line) &&
			!/^#+\s+/.test(line)
	);
	const summary = truncateSentence(stripBulletPrefix(informativeLines[0] ?? lines[0] ?? ''));
	const estimatingSignals = informativeLines
		.filter((line) =>
			/\b(fabricat|machine|turn|mill|drill|tap|thread|weld|finish|coat|material|steel|aluminium|aluminum|quantity|qty|diameter|length|width|height|thick|tolerance|pdf|cad|drawing|revision)\b/i.test(
				line
			)
		)
		.slice(0, 8)
		.map((line) => truncateSentence(stripBulletPrefix(line), 180));
	const candidateItems: LocalAiArtifactExtraction['candidateItems'] = [];
	for (const [index, line] of informativeLines.entries()) {
		const tableRow = line.match(
			/^Row\s+\d+:\s*A\d+:\s*([^|]+?)\s*\|\s*B\d+:\s*(\d+(?:\.\d+)?)\s*\|\s*C\d+:\s*([^|]+)/i
		);
		if (tableRow && !/^(?:item|description|product|service)$/i.test(tableRow[1]!.trim())) {
			candidateItems.push({
				label: truncateSentence(tableRow[1]!.trim(), 120),
				quantityHint: tableRow[2]!,
				unitHint: normaliseTakeoffUnitHint(tableRow[3]!.trim()) ?? tableRow[3]!.trim(),
				notes: truncateSentence(line, 180),
				evidenceRefs: [
					buildHeuristicEvidenceRef({
						artifact: params.artifact,
						lineNumber: index + 1,
						summary: line,
						evidenceIdentifier: params.evidenceUnit.key
					})
				]
			});
			if (candidateItems.length >= 4) break;
			continue;
		}
		const isBroadActionLine =
			/^(?:[-*•]\s*)?(?:fabricate|install|supply|provide)\b/i.test(line) &&
			informativeLines.some(
				(candidate) =>
					candidate !== line && /:\s*\d+(?:\.\d+)?\s*(?:ea|each|lot|kg|m|hr)?\b/i.test(candidate)
			);
		if (
			!isBroadActionLine &&
			/\b(part|assembly|shaft|bracket|plate|washer|roller|qty|quantity|material|steel|aluminium|aluminum|crew|installer)\b/i.test(
				line
			)
		) {
			const parsedQuantity = stripBulletPrefix(line).match(
				/^(.+?):\s*(\d+(?:\.\d+)?)\s*(ea|each|lot|kg|g|m|mm|hr|hours?)\b/i
			);
			const parsedCrewDuration = stripBulletPrefix(line).match(
				/^(.+?):\s*(\d+(?:\.\d+)?)\s+installers?\s*(?:x|for)\s*(\d+(?:\.\d+)?)\s+days?\b/i
			);
			candidateItems.push({
				label: truncateSentence(
					parsedCrewDuration?.[1] ?? parsedQuantity?.[1] ?? stripBulletPrefix(line),
					120
				),
				quantityHint: parsedCrewDuration
					? String(Number(parsedCrewDuration[2]) * Number(parsedCrewDuration[3]))
					: (parsedQuantity?.[2] ?? null),
				unitHint: parsedCrewDuration ? 'day' : (parsedQuantity?.[3]?.toLowerCase() ?? null),
				notes: truncateSentence(line, 180),
				evidenceRefs: [
					buildHeuristicEvidenceRef({
						artifact: params.artifact,
						lineNumber: index + 1,
						summary: line,
						evidenceIdentifier: params.evidenceUnit.key
					})
				]
			});
		}
		if (candidateItems.length >= 4) break;
	}
	const issue = buildLocalArtifactExtractionFailureIssue({
		artifact: params.artifact,
		error: params.error
	});
	if (!summary && estimatingSignals.length === 0 && candidateItems.length === 0) {
		return {
			fileId: params.artifact.fileId,
			fileName: params.artifact.fileName,
			artifactKind: params.artifact.kind,
			extractionSource: 'heuristic_fallback',
			evidenceIdentifiers: [params.evidenceUnit.key],
			summary: `${params.artifact.fileName} evidence unit ${params.evidenceUnit.key} was processed without model-structured extraction.`,
			estimatingSignals: [],
			candidateItems: [],
			issues: [issue]
		};
	}
	return {
		fileId: params.artifact.fileId,
		fileName: params.artifact.fileName,
		artifactKind: params.artifact.kind,
		extractionSource: 'heuristic_fallback',
		evidenceIdentifiers: [params.evidenceUnit.key],
		summary,
		estimatingSignals,
		candidateItems,
		issues: [issue]
	};
}

function buildDeterministicTextExtractionFromEvidenceUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): LocalAiArtifactExtraction | null {
	if (
		params.evidenceUnit.artifacts.length === 0 ||
		params.evidenceUnit.artifacts.some((part) => part.kind !== 'text')
	) {
		return null;
	}
	const unitExtraction = buildHeuristicExtractionFromEvidenceUnit({
		...params,
		error: new Error('Text facts were extracted deterministically from prepared evidence.')
	});
	const extracted =
		unitExtraction && extractionHasMeaningfulSignal(unitExtraction)
			? unitExtraction
			: buildHeuristicExtractionFromArtifact(params.artifact);
	if (!extracted || !extractionHasMeaningfulSignal(extracted)) return null;
	return {
		...extracted,
		extractionSource: 'deterministic_extraction',
		issues: [
			{
				code: 'deterministic_text_extraction',
				message: `${params.artifact.fileName} used deterministic prepared-text extraction after model enrichment was unavailable.`,
				severity: 'info',
				fileId: params.artifact.fileId,
				fileName: params.artifact.fileName
			}
		]
	};
}

function evidenceUnitText(unit: LocalAiEvidenceUnit): string {
	return unit.artifacts
		.filter(
			(part): part is Extract<LocalAiCompletionArtifact, { kind: 'text' }> => part.kind === 'text'
		)
		.map((part) => part.textContent)
		.join('\n');
}

const STRONG_ESTIMATING_TEXT_SIGNAL_PATTERN =
	/\b(rfq|quote|estimate|revision|part|assembly|material|grade|steel|stainless|aluminium|aluminum|brass|copper|plastic|shaft|bracket|plate|washer|roller|qty|quantity|installer|installation|labou?r|crew|diameter|thread|drill|tap|mill|turn|lathe|cnc|laser|bend|fold|weld|finish|powder\s*coat|galvan|anodis|heat treat|deburr|chamfer)\b/i;
const WEAK_ESTIMATING_TEXT_SIGNAL_PATTERN =
	/\b(scope|drawing|off|ea|radius|length|width|height|thick|thickness|tolerance|machine|cut|coat|paint)\b/gi;

function shouldSkipModelForLowSignalTextUnit(params: {
	artifact: AiPreparedArtifact;
	evidenceUnit: LocalAiEvidenceUnit;
}): boolean {
	if (params.artifact.kind !== 'pdf' || !params.evidenceUnit.key.startsWith('pdf:text:')) {
		return false;
	}
	if (params.evidenceUnit.artifacts.some((part) => part.kind === 'image')) {
		return false;
	}
	const text = evidenceUnitText(params.evidenceUnit);
	if (!text) return false;
	if (STRONG_ESTIMATING_TEXT_SIGNAL_PATTERN.test(text)) return false;
	const weakSignalCount = Array.from(text.matchAll(WEAK_ESTIMATING_TEXT_SIGNAL_PATTERN)).length;
	return weakSignalCount < 6;
}

function buildLocalEvidenceUnavailableIssue(
	artifact: Pick<AiPreparedArtifact, 'fileId' | 'fileName'>
): z.infer<typeof AiIssueSchema> {
	return {
		code: 'local_evidence_unavailable',
		message: `${artifact.fileName} could not be prepared as usable local AI evidence.`,
		severity: 'warning',
		fileId: artifact.fileId,
		fileName: artifact.fileName
	};
}

function buildLocalImageEvidenceUnsupportedIssue(
	artifact: Pick<AiPreparedArtifact, 'fileId' | 'fileName'>
): z.infer<typeof AiIssueSchema> {
	return {
		code: 'local_image_evidence_unsupported',
		message: `${artifact.fileName} could not be used as Local AI image evidence on this device during this run.`,
		severity: 'warning',
		fileId: artifact.fileId,
		fileName: artifact.fileName
	};
}

function buildLocalPdfRasterEvidenceUnsupportedIssue(
	artifact: Pick<AiPreparedArtifact, 'fileId' | 'fileName'>
): z.infer<typeof AiIssueSchema> {
	return {
		code: 'local_image_evidence_unsupported',
		message: `${artifact.fileName} could not use PDF page-image evidence on this device during this run.`,
		severity: 'warning',
		fileId: artifact.fileId,
		fileName: artifact.fileName
	};
}

function buildLocalArtifactExtractionFailureIssue(params: {
	artifact: Pick<AiPreparedArtifact, 'fileId' | 'fileName'>;
	error: unknown;
}): z.infer<typeof AiIssueSchema> {
	const message = summariseAiFailureMessage(params.error);
	return {
		code: 'artifact_extraction_failed',
		message: `Local AI could not extract evidence from ${params.artifact.fileName}: ${message}`,
		severity: 'warning',
		fileId: params.artifact.fileId,
		fileName: params.artifact.fileName
	};
}

function buildDeterministicDraftMatchingFromOutline(
	outline: LocalStoredDraftOutline
): LocalStoredDraftMatching {
	return AiDraftMatchingSchema.parse({
		applied_template_id: null,
		applied_template_name: null,
		classification_system_id: outline.classification_system_id ?? null,
		wbs_root_node_id: outline.wbs_root_node_id ?? null,
		takeoff_items: outline.takeoff_items.map((item) => ({
			sort_order: item.sort_order,
			applied_preset_id: null,
			applied_preset_name: null,
			cost_code_id: null,
			wbs_node_id: null,
			cost_components: item.cost_components.map((component) => ({
				category: component.category,
				sort_order: component.sort_order,
				source_type: 'manual',
				source_id: null,
				source_name: null,
				mapping_status: 'manual',
				match_strategy: 'local_outline_seed',
				match_signals: ['local_outline_seed']
			}))
		})),
		issues: []
	});
}

function composeFinalDraftFromOutlineAndMatching(params: {
	outline: LocalStoredDraftOutline;
	matching: LocalStoredDraftMatching;
}): AiDraftEstimate {
	const matchingItemsBySortOrder = new Map(
		params.matching.takeoff_items.map((item) => [item.sort_order, item] as const)
	);

	const draft = AiDraftRunEstimateSchema.parse({
		scope_summary: params.outline.scope_summary,
		notes: params.outline.notes,
		classification_system_id:
			params.matching.classification_system_id ?? params.outline.classification_system_id ?? null,
		wbs_root_node_id: params.matching.wbs_root_node_id ?? params.outline.wbs_root_node_id ?? null,
		applied_template_id: params.matching.applied_template_id ?? null,
		applied_template_name: params.matching.applied_template_name ?? null,
		takeoff_items: params.outline.takeoff_items.map((outlineItem) => {
			const matchingItem = matchingItemsBySortOrder.get(outlineItem.sort_order);
			const matchingComponentsBySortOrder = new Map(
				(matchingItem?.cost_components ?? []).map(
					(component) => [component.sort_order, component] as const
				)
			);

			return {
				name: outlineItem.name,
				description: outlineItem.description,
				quantity: outlineItem.quantity,
				unit: outlineItem.unit,
				sort_order: outlineItem.sort_order,
				cost_code_id: matchingItem?.cost_code_id ?? null,
				wbs_node_id: matchingItem?.wbs_node_id ?? null,
				applied_preset_id: matchingItem?.applied_preset_id ?? null,
				applied_preset_name: matchingItem?.applied_preset_name ?? null,
				properties: {},
				cost_components: outlineItem.cost_components.map((outlineComponent) => {
					const matchingComponent = matchingComponentsBySortOrder.get(outlineComponent.sort_order);
					const sourceType = matchingComponent?.source_type ?? 'manual';
					return {
						category: outlineComponent.category,
						source_type: sourceType,
						source_id: matchingComponent?.source_id ?? null,
						name: outlineComponent.name,
						description: outlineComponent.description,
						quantity: outlineComponent.quantity,
						unit: outlineComponent.unit,
						unit_rate: sourceType === 'manual' ? (outlineComponent.rate_hint ?? 0) : 0,
						formula: {},
						metadata: {
							ai_source_name: matchingComponent?.source_name ?? null,
							ai_rate_hint: outlineComponent.rate_hint ?? null,
							ai_match_strategy: matchingComponent?.match_strategy ?? null,
							ai_match_signals: matchingComponent?.match_signals ?? []
						},
						sort_order: outlineComponent.sort_order,
						evidence_refs: outlineComponent.evidence_refs,
						confidence: outlineComponent.confidence,
						mapping_status:
							matchingComponent?.mapping_status ??
							(sourceType === 'manual' ? 'manual' : 'unresolved')
					};
				}),
				evidence_refs: outlineItem.evidence_refs,
				confidence: outlineItem.confidence,
				open_questions: outlineItem.open_questions
			};
		}),
		issues: [...params.outline.issues, ...params.matching.issues]
	});

	return applyLocalEvidenceValidationGate(draft);
}

type LocalDraftAgentProposal = z.infer<ReturnType<typeof buildLocalDraftAgentProposalSchema>>;

function buildLocalDraftAgentProposalSeed(draft: AiDraftEstimate) {
	return {
		scopeSummary: truncateSentence(draft.scope_summary, 600),
		notes: truncateSentence(draft.notes, 600),
		takeoffItems: draft.takeoff_items.map((item) => ({
			name: truncateSentence(item.name, 120),
			description: truncateSentence(item.description, 240),
			quantity: item.quantity,
			unit: item.unit,
			evidenceIdentifiers: Array.from(
				new Set(item.evidence_refs.map((ref) => ref.evidence_identifier).filter(Boolean))
			),
			costComponents: item.cost_components.map((component) => ({
				category: component.category,
				name: truncateSentence(component.name, 120),
				description: truncateSentence(component.description, 240),
				quantity: component.quantity,
				unit: component.unit
			}))
		}))
	};
}

function applyLocalDraftAgentProposal(params: {
	baseline: AiDraftEstimate;
	proposal: LocalDraftAgentProposal;
}): AiDraftEstimate {
	if (params.proposal.takeoffItems.length !== params.baseline.takeoff_items.length) {
		throw new Error('Draft estimator proposal did not preserve the seeded takeoff item count.');
	}
	return AiDraftRunEstimateSchema.parse({
		...params.baseline,
		scope_summary: params.proposal.scopeSummary,
		notes: params.proposal.notes,
		takeoff_items: params.baseline.takeoff_items.map((baselineItem, itemIndex) => {
			const proposedItem = params.proposal.takeoffItems[itemIndex]!;
			return {
				...baselineItem,
				name: proposedItem.name,
				description: proposedItem.description,
				quantity: proposedItem.quantity,
				unit: proposedItem.unit,
				cost_components: proposedItem.costComponents.map((component, componentIndex) => ({
					category: component.category,
					source_type: 'manual',
					source_id: null,
					name: component.name,
					description: component.description,
					quantity: component.quantity,
					unit: component.unit,
					unit_rate: 0,
					formula: {},
					metadata: {},
					sort_order: componentIndex,
					evidence_refs: baselineItem.evidence_refs,
					confidence: baselineItem.confidence,
					mapping_status: 'unresolved'
				})),
				open_questions: proposedItem.openQuestions
			};
		}),
		issues: [...params.baseline.issues, ...params.proposal.issues]
	});
}

type LocalEvidenceArtifactExecution = {
	fileId: string;
	fileName: string;
	artifactKind?: AiArtifactManifestEntry['artifactKind'];
	sourceFormat?: AiArtifactManifestEntry['sourceFormat'];
	structureHints?: AiArtifactManifestEntry['structureHints'];
	evidenceIdentifiers?: AiArtifactManifestEntry['evidenceIdentifiers'];
};

function localRuntimeContractVersion(_runtimeKind: LocalAiStatus['runtimeKind']): string {
	return 'local-litert-lm-v1';
}

export function buildLocalRuntimeExecutionContext(params: {
	runtimeStatus?: LocalAiStatus;
	evidenceArtifacts: LocalEvidenceArtifactExecution[];
	draftStageMetrics?: Array<{
		stage: 'outline' | 'matching' | 'composition' | 'validation';
		elapsedMs: number;
		timeoutMs: number;
		attemptCount: number;
		status: 'completed' | 'failed' | 'cancelled';
		modelId: string;
		usage?: AiRunUsage;
		timings?: LocalAiCompletionTimingDiagnostics;
	}>;
}) {
	const runtimeStatus =
		params.runtimeStatus ??
		({
			runtimeKind: 'litert_lm',
			runtimeVersion: 'unknown-local-runtime',
			modelRepoId: 'unknown-local-model-repo',
			modelArtifactId: 'unknown-local-model-artifact',
			modelFileName: 'unknown-local-model-file',
			mmprojFileName: null,
			supportsImageInputs: false,
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
		} as Pick<
			LocalAiStatus,
			| 'runtimeKind'
			| 'runtimeVersion'
			| 'modelRepoId'
			| 'modelArtifactId'
			| 'modelFileName'
			| 'mmprojFileName'
			| 'supportsImageInputs'
			| 'diagnostics'
		>);

	return {
		runtimeContractVersion: localRuntimeContractVersion(runtimeStatus.runtimeKind),
		kernelContractVersion: 'local-ai-kernel-v3',
		localRuntime: {
			runtimeKind: runtimeStatus.runtimeKind,
			runtimeVersion: runtimeStatus.runtimeVersion,
			modelRepoId: runtimeStatus.modelRepoId,
			modelArtifactId: runtimeStatus.modelArtifactId,
			modelFileName: runtimeStatus.modelFileName,
			mmprojFileName: runtimeStatus.mmprojFileName,
			supportsImageInputs: runtimeStatus.supportsImageInputs,
			diagnostics: runtimeStatus.diagnostics
		},
		evidenceArtifacts: params.evidenceArtifacts,
		draftStageMetrics: params.draftStageMetrics ?? [],
		activeDraftSubphase: null
	};
}

class LocalAiService {
	private createStreamController(
		command: 'run_local_ai_completion_stream' | 'send_local_ai_message',
		request: Record<string, unknown>,
		callbacks: {
			onThinking?: (chunk: string) => void;
			onContent?: (chunk: string) => void;
		}
	): LocalAiStreamController {
		const requestId = String(request.requestId ?? '');
		if (!requestId) throw new Error('Local AI stream requestId is required.');
		let settled = false;
		let disposed = false;
		let rejectActive: ((reason: unknown) => void) | null = null;

		const dispose = (reason?: unknown) => {
			if (disposed) return;
			disposed = true;
			const shouldAbort = !settled && rejectActive !== null;
			if (rejectActive) {
				rejectActive(reason ?? new Error('Kwantflow AI stream was stopped.'));
				rejectActive = null;
			}
			if (shouldAbort) {
				invoke('abort_active_local_ai_completion', { requestId }).catch((error) => {
					log.warn('Failed to send abort completion command', { error });
				});
			}
		};

		const start = () =>
			new Promise<z.infer<typeof LocalAiCompletionResponseSchema>>((resolve, reject) => {
				if (disposed) {
					reject(new Error('Kwantflow AI stream was stopped.'));
					return;
				}
				if (rejectActive) {
					reject(new Error('Kwantflow AI stream was already started.'));
					return;
				}
				rejectActive = reject;
				const onEvent = new Channel<LocalAiStreamEvent>();
				onEvent.onmessage = (message) => {
					if (disposed) return;
					if (message.event === 'thinking') {
						callbacks.onThinking?.(message.data.text);
						return;
					}
					callbacks.onContent?.(message.data.text);
				};
				void invoke<unknown>(command, { request, onEvent })
					.then((payload) => {
						if (disposed) return;
						settled = true;
						rejectActive = null;
						resolve(LocalAiCompletionResponseSchema.parse(payload));
						dispose();
					})
					.catch((error) => {
						if (disposed) return;
						settled = true;
						rejectActive = null;
						reject(error instanceof Error ? error : new Error(String(error)));
						dispose();
					});
			});

		return { start, dispose };
	}

	async getCapabilities(): Promise<LocalAiRuntimeCapability> {
		const payload = await invoke<unknown>('get_local_ai_capabilities_command');
		return LocalAiRuntimeCapabilitySchema.parse(payload);
	}

	async getStatus(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('get_local_ai_status');
		return LocalAiStatusSchema.parse(payload);
	}

	async downloadModel(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('download_local_ai_model');
		return LocalAiStatusSchema.parse(payload);
	}

	async cancelDownload(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('cancel_local_ai_download');
		return LocalAiStatusSchema.parse(payload);
	}

	async cancelActiveRun(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('cancel_local_ai_runtime');
		return LocalAiStatusSchema.parse(payload);
	}

	async abortActiveCompletion(requestId: string): Promise<void> {
		await invoke('abort_active_local_ai_completion', { requestId });
	}

	async removeModel(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('remove_local_ai_model');
		this.persistentConversationActive = false;
		return LocalAiStatusSchema.parse(payload);
	}

	async verifyLocalAiInstall(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('verify_local_ai_install');
		return LocalAiStatusSchema.parse(payload);
	}

	async ensureLocalAiReady(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('ensure_local_ai_ready');
		return LocalAiStatusSchema.parse(payload);
	}

	async probeNativeToolsDiagnostic() {
		const payload = await invoke<unknown>('probe_local_ai_native_tools');
		return LocalAiCapabilityProbeDiagnosticsSchema.parse(payload);
	}

	async unloadRuntime(): Promise<LocalAiStatus> {
		const payload = await invoke<unknown>('unload_local_ai_runtime');
		this.persistentConversationActive = false;
		return LocalAiStatusSchema.parse(payload);
	}

	async runGroundedCompletion(params: {
		systemInstruction: string;
		prompt: string;
		artifacts?: LocalAiCompletionArtifact[];
		forceJsonObject?: boolean;
	}): Promise<z.infer<typeof LocalAiCompletionResponseSchema>> {
		return this.runCompletion({
			stage: 'grounded',
			systemInstruction: params.systemInstruction,
			prompt: params.prompt,
			artifacts: params.artifacts ?? [],
			forceJsonObject: params.forceJsonObject
		});
	}

	/** Stream one full-prefill completion through a request-scoped Tauri channel. */
	runGroundedCompletionStream(params: {
		stage?: string;
		systemInstruction?: string;
		prompt?: string;
		artifacts?: LocalAiCompletionArtifact[];
		forceJsonObject?: boolean;
		onThinking?: (chunk: string) => void;
		onContent?: (chunk: string) => void;
		tools?: Array<Record<string, unknown>>;
		parseToolCalls?: boolean;
		messages?: Array<Record<string, unknown>>;
		temperature?: number;
		topK?: number;
		topP?: number;
		seed?: number;
		enableThinking?: boolean;
		maxOutputTokens?: number;
		visualTokenBudget?: number;
		timeoutMs?: number;
		workloadClass?: LocalAiWorkloadClass;
	}): LocalAiStreamController {
		assertNativeToolCallsAllowed(params);
		log.info('[KWANTFLOW TOOLS]', {
			cmd: 'run_local_ai_completion_stream',
			toolCount: params.tools?.length ?? 0,
			parseToolCalls: params.parseToolCalls ?? false,
			promptLen: (params.prompt || '').length
		});
		const request = JSON.parse(
			JSON.stringify({
				requestId: crypto.randomUUID(),
				stage: params.stage ?? 'grounded_completion',
				systemInstruction: params.systemInstruction ?? null,
				prompt: params.prompt ?? null,
				artifacts: params.artifacts ?? [],
				forceJsonObject: params.forceJsonObject ?? false,
				tools: params.tools ?? [],
				parseToolCalls: params.parseToolCalls ?? false,
				messages: params.messages ?? null,
				temperature: params.temperature ?? null,
				topK: params.topK ?? null,
				topP: params.topP ?? null,
				seed: params.seed ?? null,
				enableThinking: params.enableThinking ?? false,
				maxOutputTokens: params.maxOutputTokens ?? null,
				visualTokenBudget: params.visualTokenBudget ?? null,
				timeoutMs: params.timeoutMs ?? null,
				workloadClass: params.workloadClass ?? 'user_batch'
			})
		) as Record<string, unknown>;
		return this.createStreamController('run_local_ai_completion_stream', request, params);
	}

	/**
	 * Run a single non-streaming completion against the native local AI runtime.
	 * Unlike streaming completions, this returns only the final typed response.
	 * Supports tools, tool_choice, and parseToolCalls.
	 *
	 * Use this for structured tool calls (shadow planner, enrichment) where
	 * streaming per-token events are not required and isolation from the chat
	 * stream cancellation state is critical.
	 */
	async runCompletion(params: {
		stage?: string;
		systemInstruction?: string;
		prompt?: string;
		artifacts?: LocalAiCompletionArtifact[];
		messages?: Array<Record<string, unknown>>;
		forceJsonObject?: boolean;
		tools?: Array<Record<string, unknown>>;
		parseToolCalls?: boolean;
		temperature?: number;
		topK?: number;
		topP?: number;
		seed?: number;
		enableThinking?: boolean;
		maxOutputTokens?: number;
		visualTokenBudget?: number;
		timeoutMs?: number;
		workloadClass?: LocalAiWorkloadClass;
	}): Promise<z.infer<typeof LocalAiCompletionResponseSchema>> {
		assertNativeToolCallsAllowed(params);
		// Deep-clone via JSON to strip any Svelte 5 reactivity proxies
		const cleanRequest = JSON.parse(
			JSON.stringify({
				requestId: crypto.randomUUID(),
				stage: params.stage ?? 'unspecified',
				systemInstruction: params.systemInstruction ?? null,
				prompt: params.prompt ?? null,
				artifacts: params.artifacts ?? [],
				messages: params.messages ?? null,
				forceJsonObject: params.forceJsonObject ?? false,
				tools: params.tools ?? [],
				parseToolCalls: params.parseToolCalls ?? false,
				temperature: params.temperature ?? null,
				topK: params.topK ?? null,
				topP: params.topP ?? null,
				seed: params.seed ?? null,
				enableThinking: params.enableThinking ?? false,
				maxOutputTokens: params.maxOutputTokens ?? null,
				visualTokenBudget: params.visualTokenBudget ?? null,
				timeoutMs: params.timeoutMs ?? null,
				workloadClass: params.workloadClass ?? 'user_batch'
			})
		);
		const payload = await invoke<unknown>('run_local_ai_completion', {
			request: cleanRequest
		});
		return LocalAiCompletionResponseSchema.parse(payload);
	}

	private async runStructuredToolCompletion<T>(params: {
		schemaName: string;
		schema: z.ZodType<T>;
		toolSchema?: z.ZodType<unknown>;
		systemInstruction: string;
		messages: Array<Record<string, unknown>>;
		artifacts?: LocalAiCompletionArtifact[];
		temperature?: number;
		enableThinking?: boolean;
		maxOutputTokens?: number;
		visualTokenBudget?: number;
		timeoutMs?: number;
		workloadClass?: LocalAiWorkloadClass;
		parseValue?: (raw: unknown) => T;
	}): Promise<StructuredToolCompletion<T>> {
		const toolName = `${STRUCTURED_RETURN_TOOL_PREFIX}${params.schemaName}`;
		const jsonSchema = buildStructuredToolParameters(params.toolSchema ?? params.schema);
		const systemInstruction = params.enableThinking
			? params.systemInstruction
			: params.systemInstruction.replace(/<\|think\|>\s*/g, '');
		const completion = await this.runCompletion({
			stage: params.schemaName,
			systemInstruction:
				`${systemInstruction}\n\nReturn structured data by calling ${toolName} exactly once. ` +
				'Do not answer in prose. Do not wrap the result in Markdown.',
			// Rust forwards schemas to LiteRT's ConversationConfig only when a
			// messages request is supplied. Artifacts remain separate and are appended
			// to this final user message by the native transport.
			messages: requireStructuredToolCall(params.messages, toolName),
			artifacts: params.artifacts ?? [],
			tools: [
				{
					type: 'function',
					function: {
						name: toolName,
						description: `Return the complete ${params.schemaName} payload.`,
						parameters: jsonSchema
					}
				}
			],
			parseToolCalls: true,
			temperature: params.temperature ?? 0,
			enableThinking: params.enableThinking ?? false,
			maxOutputTokens: params.maxOutputTokens,
			visualTokenBudget: params.visualTokenBudget,
			timeoutMs: params.timeoutMs,
			workloadClass: params.workloadClass
		});
		try {
			const parseStructuredValue = (raw: unknown): T => {
				const decoded = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
				return params.parseValue ? params.parseValue(decoded) : params.schema.parse(decoded);
			};
			const toolCall = completion.toolCalls.find((call) => call.function.name === toolName);
			if (!toolCall) {
				// Gemma 4's v0.16 native constraint mode is TextAndOr. Prefer the
				// declared tool call, but accept direct JSON only when the identical
				// Zod contract validates it. Invalid direct output still fails closed.
				return {
					value: parseStructuredValue(completion.content),
					completion
				};
			}
			return {
				value: parseStructuredValue(toolCall.function.arguments || '{}'),
				completion
			};
		} catch (error) {
			const toolCallShapes = completion.toolCalls.map((call) => {
				let argumentKind = 'invalid_json';
				let argumentKeys: string[] = [];
				try {
					const decoded = JSON.parse(call.function.arguments) as unknown;
					if (Array.isArray(decoded)) {
						argumentKind = 'array';
					} else if (decoded !== null && typeof decoded === 'object') {
						argumentKind = 'object';
						argumentKeys = Object.keys(decoded as Record<string, unknown>).sort();
					} else {
						argumentKind = typeof decoded;
					}
				} catch {
					// Deliberately omit argument values from logs: they can contain local evidence.
				}
				return {
					name: call.function.name,
					argumentKind,
					argumentKeys,
					argumentLength: call.function.arguments.length
				};
			});
			const validationCause = error instanceof Error ? error : null;
			const validationIssues =
				error instanceof z.ZodError
					? error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
					: [];
			log.warn('Local AI structured completion failed validation', {
				stage: params.schemaName,
				expectedToolName: toolName,
				toolCallCount: completion.toolCalls.length,
				toolCallShapes,
				contentKind: completion.content === null ? 'null' : typeof completion.content,
				contentLength:
					typeof completion.content === 'string' ? completion.content.length : undefined,
				contentLooksLikeJson:
					typeof completion.content === 'string'
						? /^[\s\n\r]*[[{]/.test(completion.content)
						: undefined,
				validationErrorName: validationCause?.name ?? 'non_error',
				validationIssues
			});
			throw new LocalAiStructuredOutputValidationError(error);
		}
	}

	async runStructuredTask<T>(
		params: LocalAiStructuredTask<T>
	): Promise<StructuredToolCompletion<T>> {
		const run = (messages: Array<Record<string, unknown>>) =>
			this.runStructuredToolCompletion({ ...params, messages });

		try {
			return await run(params.messages);
		} catch (error) {
			if (!params.allowCorrection || !(error instanceof LocalAiStructuredOutputValidationError)) {
				throw error;
			}
			const cause = error.validationCause;
			const feedback = cause instanceof z.ZodError ? z.prettifyError(cause) : String(cause);
			return run([
				...params.messages,
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text:
								`The previous ${params.schemaName} response failed validation: ${feedback}. ` +
								'Return one corrected tool call using only the declared schema.'
						}
					]
				}
			]);
		}
	}

	// ── Persistent Conversation API ─────────────────────────────────

	private persistentConversationActive = false;
	private persistentConversationConfig: LocalAiConversationConfig | null = null;
	private persistentConversationMessages: Array<Record<string, unknown>> = [];

	private buildConversationRequest(
		params: LocalAiConversationConfig,
		messages: Array<Record<string, unknown>>
	): Record<string, unknown> {
		return JSON.parse(
			JSON.stringify({
				requestId: crypto.randomUUID(),
				systemInstruction: params.systemInstruction,
				tools: params.tools ?? [],
				messages,
				enableThinking: params.enableThinking ?? false,
				temperature: params.temperature ?? null,
				topK: params.topK ?? null,
				topP: params.topP ?? null,
				seed: params.seed ?? null
			})
		) as Record<string, unknown>;
	}

	private packConversationMessages(
		messages: Array<Record<string, unknown>>,
		targetTokens: number
	): Array<Record<string, unknown>> {
		const characterBudget = Math.max(1, Math.floor(targetTokens * 4));
		const groups: Array<Array<Record<string, unknown>>> = [];
		for (const message of messages) {
			if (String(message.role ?? '') === 'user' || groups.length === 0) {
				groups.push([message]);
			} else {
				groups.at(-1)?.push(message);
			}
		}
		const selectedGroups: Array<Array<Record<string, unknown>>> = [];
		let usedCharacters = 0;
		for (let index = groups.length - 1; index >= 0; index -= 1) {
			const group = groups[index];
			if (!group) continue;
			const characters = JSON.stringify(group).length;
			if (selectedGroups.length > 0 && usedCharacters + characters > characterBudget) break;
			selectedGroups.push(group);
			usedCharacters += characters;
		}
		return selectedGroups.reverse().flat();
	}

	private async restartPersistentConversation(
		messages: Array<Record<string, unknown>>
	): Promise<void> {
		if (!this.persistentConversationConfig) {
			throw new Error('Kwantflow AI persistent conversation configuration is unavailable.');
		}
		try {
			await invoke('end_local_ai_conversation');
		} catch (error) {
			log.warn('[conversation] Native conversation cleanup before rebuild failed', { error });
		}
		this.persistentConversationActive = false;
		await invoke('start_local_ai_conversation', {
			request: this.buildConversationRequest(this.persistentConversationConfig, messages)
		});
		this.persistentConversationMessages = messages;
		this.persistentConversationActive = true;
	}

	private async rolloverPersistentConversationIfNeeded(): Promise<void> {
		if (!this.persistentConversationActive || !this.persistentConversationConfig) return;
		let tokenCount: number;
		let contextCapacity: number;
		try {
			tokenCount = await this.getConversationTokenCount();
			const status = await this.getStatus();
			contextCapacity = status.diagnostics.contextSizeTokens ?? 0;
		} catch (error) {
			log.warn('[conversation] Failed to inspect native context occupancy', { error });
			return;
		}
		if (tokenCount < 0 || contextCapacity <= 0 || tokenCount < contextCapacity * 0.75) return;

		const messages = this.packConversationMessages(
			this.persistentConversationMessages,
			contextCapacity * 0.5
		);
		try {
			await this.restartPersistentConversation(messages);
			log.info('[conversation] Rebuilt native conversation before context exhaustion', {
				tokenCount,
				contextCapacity,
				retainedMessageCount: messages.length
			});
		} catch (error) {
			this.persistentConversationActive = false;
			log.warn(
				'[conversation] Context rollover failed after a completed turn; the next turn will rebuild',
				{ error, tokenCount, contextCapacity }
			);
		}
	}

	/**
	 * Start a persistent conversation with the given system instruction
	 * and tool declarations. The underlying LiteRT-LM Conversation retains
	 * KV cache state across turns, avoiding costly history re-prefills.
	 *
	 * Only one persistent conversation can exist per engine at a time.
	 */
	async startConversation(params: LocalAiConversationConfig): Promise<void> {
		// Deep-clone via JSON to strip any Svelte 5 reactivity proxies
		const messages = JSON.parse(JSON.stringify(params.messages ?? [])) as Array<
			Record<string, unknown>
		>;
		if (
			(params.tools?.length ?? 0) > 0 &&
			!getEffectiveLocalAiRuntimeCapabilities().supportsNativeToolCalls
		) {
			throw new Error(NATIVE_TOOL_CALLS_DISABLED_MESSAGE);
		}
		const cleanRequest = this.buildConversationRequest(params, messages);
		try {
			await invoke('start_local_ai_conversation', { request: cleanRequest });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes('A persistent conversation already exists')) {
				throw error;
			}
			if (this.persistentConversationActive) {
				log.info('[conversation] Reusing existing native persistent conversation');
				return;
			}
			log.warn('[conversation] Native conversation existed without frontend ownership; restarting');
			await invoke('end_local_ai_conversation');
			await invoke('start_local_ai_conversation', { request: cleanRequest });
		}
		this.persistentConversationActive = true;
		this.persistentConversationConfig = {
			...params,
			tools: JSON.parse(JSON.stringify(params.tools ?? [])),
			messages: undefined
		};
		this.persistentConversationMessages = messages;
		log.info('[conversation] Started persistent conversation', {
			toolCount: (params.tools ?? []).length,
			enableThinking: params.enableThinking ?? false
		});
	}

	async ensureConversation(
		params: Parameters<LocalAiService['startConversation']>[0]
	): Promise<void> {
		if (this.persistentConversationActive) return;
		await this.startConversation(params);
	}

	/** Send one message through the persistent conversation's request-scoped channel. */
	sendMessageStream(params: {
		message: Record<string, unknown> | Array<Record<string, unknown>>;
		onThinking?: (chunk: string) => void;
		onContent?: (chunk: string) => void;
		parseToolCalls?: boolean;
		maxOutputTokens?: number;
		timeoutMs?: number;
		workloadClass?: LocalAiWorkloadClass;
	}): LocalAiStreamController {
		const request = JSON.parse(
			JSON.stringify({
				requestId: crypto.randomUUID(),
				message: params.message,
				stage: 'ask_kwantflow_turn',
				parseToolCalls: params.parseToolCalls ?? false,
				maxOutputTokens: params.maxOutputTokens ?? 2048,
				timeoutMs: params.timeoutMs ?? 120_000,
				workloadClass: params.workloadClass ?? 'interactive'
			})
		) as Record<string, unknown>;
		const message = request.message as Record<string, unknown> | Array<unknown>;
		log.info('[conversation] Sending message to persistent conversation', {
			messageKind: Array.isArray(message) ? 'batch' : String(message.role ?? 'unknown'),
			messageCount: Array.isArray(message) ? message.length : 1,
			parseToolCalls: params.parseToolCalls ?? false
		});
		let activeController = this.createStreamController('send_local_ai_message', request, params);
		let disposed = false;
		let started = false;
		return {
			dispose: () => {
				disposed = true;
				activeController.dispose();
			},
			start: async () => {
				if (disposed) throw new Error('Kwantflow AI stream was stopped.');
				if (started) throw new Error('Kwantflow AI stream was already started.');
				started = true;
				let completion: LocalAiCompletionResponse;
				try {
					completion = await activeController.start();
				} catch (error) {
					if (disposed) throw new Error('Kwantflow AI stream was stopped.', { cause: error });
					const message = error instanceof Error ? error.message : String(error);
					if (!/No persistent conversation exists/i.test(message)) throw error;

					log.warn('[conversation] Native conversation ownership was lost; rebuilding once');
					await this.restartPersistentConversation(this.persistentConversationMessages);
					if (disposed) throw new Error('Kwantflow AI stream was stopped.', { cause: error });

					request.requestId = crypto.randomUUID();
					activeController = this.createStreamController('send_local_ai_message', request, params);
					completion = await activeController.start();
				}
				if (disposed) throw new Error('Kwantflow AI stream was stopped.');
				const inputMessages = Array.isArray(request.message)
					? (request.message as Array<Record<string, unknown>>)
					: [request.message as Record<string, unknown>];
				this.persistentConversationMessages.push(...inputMessages);
				this.persistentConversationMessages.push({
					role: 'assistant',
					content:
						typeof completion.content === 'string'
							? completion.content
							: JSON.stringify(completion.content),
					...(completion.toolCalls.length > 0 ? { tool_calls: completion.toolCalls } : {})
				});
				await this.rolloverPersistentConversationIfNeeded();
				return completion;
			}
		};
	}

	/**
	 * End the persistent conversation, freeing the underlying
	 * LiteRT-LM Conversation and its KV cache.
	 */
	async endConversation(): Promise<void> {
		await invoke('end_local_ai_conversation');
		this.persistentConversationActive = false;
		this.persistentConversationConfig = null;
		this.persistentConversationMessages = [];
		log.info('[conversation] Ended persistent conversation');
	}

	/**
	 * Get the total token count in the persistent conversation's KV cache.
	 * Returns -1 if no conversation exists.
	 */
	async getConversationTokenCount(): Promise<number> {
		return invoke<number>('get_local_ai_conversation_tokens');
	}

	private async buildLocalDraftMatching(params: {
		outline: Record<string, unknown>;
		draftPromptParams: Pick<
			RunLocalAiDraftRequest,
			| 'projectContext'
			| 'assetContext'
			| 'referenceContext'
			| 'workflowRules'
			| 'outputContract'
			| 'estimateContextSnapshot'
			| 'promptContract'
		> & {
			workspaceKnowledgeContext?: RunLocalAiDraftRequest['workspaceKnowledgeContext'];
		};
		systemInstruction: string;
		refContext: AiReferenceContext;
		useDeterministicMatching?: boolean;
	}): Promise<{
		matching: z.infer<typeof AiDraftMatchingSchema>;
		attemptCount: number;
		elapsedMs: number;
		timeoutMs: number;
		status: 'completed' | 'failed' | 'cancelled';
		modelId: string;
		usage: AiRunUsage;
	}> {
		const matchingStartedAt = Date.now();

		if (params.useDeterministicMatching) {
			return {
				matching: buildDeterministicDraftMatchingFromOutline(params.outline as never),
				attemptCount: 1,
				elapsedMs: Date.now() - matchingStartedAt,
				timeoutMs: LOCAL_AI_MATCHING_COMPLETION_TIMEOUT_MS,
				status: 'completed',
				modelId: 'deterministic_local',
				usage: {}
			};
		}

		const filteredContext = filterReferenceContextByOutline(params.outline, params.refContext);

		const matchingPrompt = buildDraftMatchingPrompt(
			{ ...params.draftPromptParams, referenceContext: filteredContext },
			params.outline
		);

		let attemptCount = 1;
		try {
			const { value: matching, completion } = await this.runStructuredToolCompletion({
				schemaName: 'draft_matching',
				schema: AiDraftMatchingSchema,
				systemInstruction: params.systemInstruction,
				messages: structuredUserMessages(matchingPrompt),
				artifacts: [],
				temperature: 0.0,
				timeoutMs: LOCAL_AI_MATCHING_COMPLETION_TIMEOUT_MS
			});

			return {
				matching,
				attemptCount,
				elapsedMs: Date.now() - matchingStartedAt,
				timeoutMs: LOCAL_AI_MATCHING_COMPLETION_TIMEOUT_MS,
				status: 'completed',
				modelId: completion.modelId,
				usage: completion.usage
			};
		} catch (error) {
			attemptCount = 2;
			if (isAiCancelledError(error)) throw error;
			log.warn('Kwantflow AI matching failed; falling back to deterministic', {
				error: summariseAiFailureMessage(error),
				isTimeout: isLocalAiTimeoutError(error)
			});
		}

		return {
			matching: buildDeterministicDraftMatchingFromOutline(params.outline as never),
			attemptCount,
			elapsedMs: Date.now() - matchingStartedAt,
			timeoutMs: LOCAL_AI_MATCHING_COMPLETION_TIMEOUT_MS,
			status: 'completed',
			modelId: 'deterministic_local',
			usage: {}
		};
	}

	async runDraftRun(
		request: RunLocalAiDraftRequest
	): Promise<z.infer<typeof AiDraftRunResultSchema>> {
		const extractionSystemInstruction = buildAiSystemInstruction(
			request.promptContract,
			'extraction'
		);
		const draftSystemInstruction = buildAiSystemInstruction(request.promptContract, 'draft');
		const extractions: LocalAiArtifactExtraction[] = [];
		const extractionIssues: z.infer<typeof AiIssueSchema>[] = [];
		const usageSamples: AiRunUsage[] = [];
		const draftStageMetrics: NonNullable<
			Parameters<typeof buildLocalRuntimeExecutionContext>[0]['draftStageMetrics']
		> = [];
		const evidenceCoverage = {
			totalUnits: 0,
			cachedUnits: 0,
			completedUnits: 0,
			failedUnits: 0,
			omittedUnits: 0,
			units: [] as Array<{
				fileId: string;
				fileName: string;
				unitKey: string;
				unitHash: string;
				state: 'cached' | 'completed' | 'failed' | 'omitted';
				failureCategory?: string | null;
			}>
		};
		const recordEvidenceUnitState = (input: {
			artifact: AiPreparedArtifact;
			unitKey: string;
			unitHash: string;
			state: 'cached' | 'completed' | 'failed' | 'omitted';
			failureCategory?: string | null;
		}) => {
			evidenceCoverage.units.push({
				fileId: input.artifact.fileId,
				fileName: input.artifact.fileName,
				unitKey: input.unitKey,
				unitHash: input.unitHash,
				state: input.state,
				...(input.failureCategory ? { failureCategory: input.failureCategory } : {})
			});
		};

		// Sort artifacts by kind priority: text > pdf > image > cad
		const kindOrder: Record<string, number> = { text: 0, pdf: 1, image: 2, cad: 3 };
		const sorted = request.preparedRun.artifacts
			.map((a, i) => ({ a, m: request.preparedRun.artifactManifest[i] }))
			.sort((x, y) => (kindOrder[x.a.kind] ?? 4) - (kindOrder[y.a.kind] ?? 4));
		request.preparedRun.artifacts = sorted.map((s) => s.a);
		request.preparedRun.artifactManifest = sorted.map((s) => s.m);

		for (const [index, artifact] of request.preparedRun.artifacts.entries()) {
			const manifestEntry = request.preparedRun.artifactManifest[index];
			if (!manifestEntry) continue;

			const status = request.runtimeStatus;
			const modelRuntimeId =
				status &&
				/\+native-sha256:[a-f0-9]{64}$/.test(status.runtimeVersion) &&
				/@[a-f0-9]{40}\+sha256:[a-f0-9]{64}$/.test(status.modelArtifactId)
					? `${status.runtimeVersion}:${status.modelArtifactId}`
					: null;
			const evidenceUnits = buildSequentialEvidenceUnits(
				artifact,
				request.allowRasterImageCompletions ?? false
			);
			const unitHashes = new Map(
				await Promise.all(
					evidenceUnits.map(async (unit) => [unit.key, await hashEvidenceUnit(unit)] as const)
				)
			);
			const evidenceUnitSetHash = await buildEvidenceUnitSetHash(evidenceUnits);
			const fileSynthesisCacheKey = buildFileSynthesisCacheKey(evidenceUnits);
			const hasCompleteTerminalCoverage = () =>
				hasCompleteEvidenceUnitCoverage({
					fileId: artifact.fileId,
					required: evidenceUnits.map((unit) => ({
						key: unit.key,
						unitHash: unitHashes.get(unit.key) ?? ''
					})),
					coverage: evidenceCoverage.units
				});
			evidenceCoverage.totalUnits += Math.max(1, evidenceUnits.length);

			// Check extraction cache — skip LLM if file unchanged
			if (modelRuntimeId && !request.forceFresh && manifestEntry.contentHash) {
				try {
					const cached = await dbService.lookupCachedExtraction(
						manifestEntry.contentHash,
						artifact.fileId,
						request.promptContract?.extractionPromptVersion ?? '',
						modelRuntimeId,
						EVIDENCE_UNIT_PREPARATION_VERSION,
						evidenceUnitSetHash,
						EVIDENCE_FILE_SYNTHESIS_VERSION
					);
					if (cached) {
						const cachedExtraction = parseReusableEvidenceCachePayload(cached, {
							fileId: artifact.fileId,
							fileName: artifact.fileName,
							artifactKind: artifact.kind
						});
						if (cachedExtraction) {
							extractions.push(cachedExtraction);
							evidenceCoverage.cachedUnits += evidenceUnits.length;
							for (const evidenceUnit of evidenceUnits) {
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: unitHashes.get(evidenceUnit.key) ?? '',
									state: 'cached'
								});
							}
							continue;
						}
						log.warn('Ignored invalid reusable file evidence cache entry', {
							runId: request.runId,
							fileId: artifact.fileId
						});
					}
				} catch {
					/* cache miss — proceed with extraction */
				}
			}

			request.onProgress?.({
				status: 'extracting',
				currentArtifactName: artifact.fileName,
				processedArtifactCount: index,
				usableArtifactCount: countUsableLocalExtractions(extractions),
				totalArtifactCount: request.preparedRun.artifactManifest.length,
				supportedArtifactCount: request.preparedRun.artifactManifest.length,
				unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
				draftSubphase: null
			});
			const completionArtifacts = evidenceUnits.flatMap((unit) => unit.artifacts);

			if (completionArtifacts.length === 0) {
				evidenceCoverage.omittedUnits += 1;
				recordEvidenceUnitState({
					artifact,
					unitKey: 'file:unavailable',
					unitHash: evidenceUnitSetHash,
					state: 'omitted',
					failureCategory: 'no_completion_artifacts'
				});
				const issue =
					artifact.kind === 'image'
						? buildLocalImageEvidenceUnsupportedIssue(artifact)
						: artifact.kind === 'pdf' &&
							  artifact.rasterPages.length > 0 &&
							  !artifact.textContent.trim()
							? buildLocalPdfRasterEvidenceUnsupportedIssue(artifact)
							: buildLocalEvidenceUnavailableIssue(artifact);
				extractions.push({
					fileId: artifact.fileId,
					fileName: artifact.fileName,
					artifactKind: artifact.kind,
					extractionSource: 'unavailable',
					evidenceIdentifiers: manifestEntry.evidenceIdentifiers,
					summary: '',
					estimatingSignals: [],
					candidateItems: [],
					issues: [issue]
				});
				extractionIssues.push(issue);
				request.onProgress?.({
					status: 'extracting',
					currentArtifactName: artifact.fileName,
					processedArtifactCount: index + 1,
					usableArtifactCount: countUsableLocalExtractions(extractions),
					totalArtifactCount: request.preparedRun.artifactManifest.length,
					supportedArtifactCount: request.preparedRun.artifactManifest.length,
					unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
					draftSubphase: null
				});
				continue;
			}

			let rawCompletionContent: unknown = null;
			try {
				log.info('Starting local AI artifact extraction', {
					runId: request.runId,
					fileId: artifact.fileId,
					fileName: artifact.fileName,
					artifactKind: artifact.kind,
					artifactIndex: index,
					artifactCount: request.preparedRun.artifactManifest.length,
					completionArtifactCount: completionArtifacts.length
				});
				// Every supported artifact is processed through independently cacheable evidence units.
				if (evidenceUnits.length > 0) {
					const sequentialExtractions: LocalAiArtifactExtraction[] = [];
					const pendingUnits: LocalAiEvidenceUnit[] = [];
					let sequentialFailedUnitCount = 0;

					for (const evidenceUnit of evidenceUnits) {
						const evidenceUnitHash = unitHashes.get(evidenceUnit.key) ?? '';
						if (modelRuntimeId && !request.forceFresh && manifestEntry.contentHash) {
							const cachedUnit = await dbService.getCachedEvidenceUnit({
								fileId: artifact.fileId,
								sourceContentHash: manifestEntry.contentHash,
								evidenceUnitKey: evidenceUnit.key,
								evidenceUnitHash,
								preparationVersion: EVIDENCE_UNIT_PREPARATION_VERSION,
								extractionVersion: request.promptContract.extractionPromptVersion,
								modelRuntimeId
							});
							if (cachedUnit) {
								const cachedExtraction = parseReusableEvidenceCachePayload(cachedUnit, {
									fileId: artifact.fileId,
									fileName: artifact.fileName,
									artifactKind: artifact.kind,
									requiredUnitKey: evidenceUnit.key
								});
								if (cachedExtraction) {
									sequentialExtractions.push(cachedExtraction);
									evidenceCoverage.cachedUnits += 1;
									recordEvidenceUnitState({
										artifact,
										unitKey: evidenceUnit.key,
										unitHash: evidenceUnitHash,
										state: 'cached'
									});
									continue;
								}
								log.warn('Ignored invalid reusable evidence unit cache entry', {
									runId: request.runId,
									fileId: artifact.fileId,
									evidenceUnitKey: evidenceUnit.key
								});
							}
						}
						if (shouldUseDeterministicCadMetadataUnit({ artifact, evidenceUnit })) {
							const deterministicExtraction = buildDeterministicCadMetadataExtraction({
								artifact,
								evidenceUnit
							});
							if (deterministicExtraction) {
								sequentialExtractions.push(deterministicExtraction);
								evidenceCoverage.completedUnits += 1;
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: evidenceUnitHash,
									state: 'completed'
								});
								if (
									modelRuntimeId &&
									manifestEntry.contentHash &&
									isReusableEvidenceExtraction(deterministicExtraction)
								) {
									try {
										await dbService.putCachedExtraction({
											id: crypto.randomUUID(),
											fileId: artifact.fileId,
											sourceContentHash: manifestEntry.contentHash,
											evidenceUnitKey: evidenceUnit.key,
											evidenceUnitHash,
											preparationVersion: EVIDENCE_UNIT_PREPARATION_VERSION,
											extractionVersion: request.promptContract.extractionPromptVersion,
											modelRuntimeId,
											payload: deterministicExtraction
										});
									} catch (cacheError) {
										log.warn('Failed to persist deterministic CAD metadata cache entry', {
											runId: request.runId,
											fileId: artifact.fileId,
											evidenceUnitKey: evidenceUnit.key,
											error: cacheError
										});
									}
								}
								continue;
							}
						}
						if (shouldOmitDeterministicCadRenderUnit({ artifact, evidenceUnit })) {
							const filtered = buildDeterministicFilteredExtraction({ artifact, evidenceUnit });
							sequentialExtractions.push({
								...filtered,
								issues: [
									{
										code: 'deterministic_cad_render_omitted',
										message: `${artifact.fileName} render ${evidenceUnit.key} was not sent to the model because DWG/DXF metadata was extracted deterministically.`,
										severity: 'info',
										fileId: artifact.fileId,
										fileName: artifact.fileName
									}
								]
							});
							evidenceCoverage.omittedUnits += 1;
							recordEvidenceUnitState({
								artifact,
								unitKey: evidenceUnit.key,
								unitHash: evidenceUnitHash,
								state: 'omitted',
								failureCategory: 'deterministic_cad_render_omitted'
							});
							continue;
						}
						if (shouldUseDeterministicPdfTextUnit({ artifact, evidenceUnit })) {
							const deterministicExtraction = buildDeterministicPdfTextExtraction({
								artifact,
								evidenceUnit
							});
							sequentialExtractions.push(deterministicExtraction);
							if (deterministicExtraction.extractionSource === 'deterministic_filtered') {
								evidenceCoverage.omittedUnits += 1;
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: evidenceUnitHash,
									state: 'omitted',
									failureCategory: 'deterministic_filtered'
								});
							} else {
								evidenceCoverage.completedUnits += 1;
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: evidenceUnitHash,
									state: 'completed'
								});
							}
							continue;
						}
						if (shouldSkipModelForLowSignalTextUnit({ artifact, evidenceUnit })) {
							const filtered = buildDeterministicFilteredExtraction({ artifact, evidenceUnit });
							sequentialExtractions.push(filtered);
							evidenceCoverage.omittedUnits += 1;
							recordEvidenceUnitState({
								artifact,
								unitKey: evidenceUnit.key,
								unitHash: evidenceUnitHash,
								state: 'omitted',
								failureCategory: 'deterministic_filtered'
							});
							continue;
						}
						pendingUnits.push(evidenceUnit);
					}

					const inferenceBatches =
						request.runtimeStatus?.runtimeKind === 'litert_lm'
							? pendingUnits.map((unit) => [unit])
							: buildEvidenceInferenceBatches(artifact.kind, pendingUnits);
					const splitRetriedUnitKeys = new Set<string>();
					for (const [batchIndex, batchUnits] of inferenceBatches.entries()) {
						const batchArtifacts = batchUnits.flatMap((unit) => unit.artifacts);
						const useLiteRtScalarSchema = request.runtimeStatus?.runtimeKind === 'litert_lm';
						const batchExtractionSchema = buildEvidenceBatchExtractionSchema(
							batchUnits.map((unit) => unit.key)
						);
						let repairedBatchOutput = false;
						let deterministicRecoveryCount = 0;
						try {
							const evidencePrompt = useLiteRtScalarSchema
								? buildLiteRtEvidenceUnitExtractionPrompt({
										fileName: artifact.fileName,
										unitKey: batchUnits[0]!.key
									})
								: buildEvidenceBatchExtractionPrompt({
										fileName: artifact.fileName,
										units: batchUnits
									});
							const completionInput = {
								systemInstruction: extractionSystemInstruction,
								messages: structuredUserMessages(evidencePrompt),
								artifacts: batchArtifacts,
								temperature: 0,
								enableThinking: false,
								maxOutputTokens: getEvidenceBatchMaxOutputTokens(batchUnits.length),
								visualTokenBudget: batchArtifacts.some((item) => item.kind === 'image')
									? visualEvidenceTokenBudget(artifact.kind)
									: undefined,
								timeoutMs: LOCAL_AI_ARTIFACT_COMPLETION_TIMEOUT_MS
							};
							const structuredCompletion = useLiteRtScalarSchema
								? await this.runStructuredToolCompletion({
										...completionInput,
										schemaName: 'evidence_unit_extraction',
										schema: LocalAiEvidenceBatchExtractionSchema,
										toolSchema: buildLiteRtEvidenceUnitExtractionSchema(batchUnits[0]!.key),
										parseValue: (raw) => {
											const parsed = buildLiteRtEvidenceUnitExtractionSchema(
												batchUnits[0]!.key
											).parse(raw);
											return { units: [normaliseLiteRtEvidenceUnitExtraction(parsed)] };
										}
									})
								: await this.runStructuredToolCompletion({
										...completionInput,
										schemaName: 'evidence_batch_extraction',
										schema: batchExtractionSchema,
										parseValue: (raw) => {
											const normalised = normaliseEvidenceBatchForContract(
												raw,
												batchUnits.map((unit) => unit.key)
											);
											repairedBatchOutput ||= normalised.repaired;
											const parsed = batchExtractionSchema.parse(normalised.value);
											if (!isExactEvidenceBatchExtraction({ batchUnits, extraction: parsed })) {
												throw new Error('Local AI returned mismatched evidence unit identities.');
											}
											return parsed;
										}
									});
							const batchExtraction = structuredCompletion.value;
							const completion = structuredCompletion.completion;
							rawCompletionContent = completion.content;
							usageSamples.push(completion.usage);
							const returnedByKey = new Map(
								batchExtraction.units.map((unit) => [unit.unitKey, unit] as const)
							);
							for (const evidenceUnit of batchUnits) {
								const parsed = returnedByKey.get(evidenceUnit.key);
								const evidenceUnitHash = unitHashes.get(evidenceUnit.key) ?? '';
								if (!parsed) {
									const missingError = new Error(
										`Local AI omitted required evidence unit ${evidenceUnit.key}.`
									);
									const fallback = buildHeuristicExtractionFromEvidenceUnit({
										artifact,
										evidenceUnit,
										error: missingError
									});
									if (fallback) sequentialExtractions.push(fallback);
									evidenceCoverage.failedUnits += 1;
									sequentialFailedUnitCount += 1;
									recordEvidenceUnitState({
										artifact,
										unitKey: evidenceUnit.key,
										unitHash: evidenceUnitHash,
										state: 'failed',
										failureCategory: 'missing_batch_unit'
									});
									continue;
								}
								let enriched = buildModelEvidenceUnitExtraction({
									artifact,
									evidenceUnit,
									parsed
								});
								enriched = recoverTextCandidateFromGenericModelOutput({
									artifact,
									evidenceUnit,
									extraction: enriched
								});
								if (repairedBatchOutput) {
									enriched.extractionSource = 'model_repaired';
									enriched.issues.push({
										code: 'model_evidence_contract_normalised',
										message: `${artifact.fileName} returned a cosmetic structured-contract mismatch; Kwantflow normalised it without changing evidence facts. This result will not be reused from cache.`,
										severity: 'info',
										fileId: artifact.fileId,
										fileName: artifact.fileName
									});
								}
								if (!extractionHasMeaningfulSignal(enriched)) {
									const emptyError = new Error(
										`Local AI returned no estimating facts for required evidence unit ${evidenceUnit.key}.`
									);
									const fallback =
										batchUnits.length === 1
											? buildHeuristicExtractionFromArtifact(artifact)
											: buildHeuristicExtractionFromEvidenceUnit({
													artifact,
													evidenceUnit,
													error: emptyError
												});
									if (fallback) sequentialExtractions.push(fallback);
									evidenceCoverage.failedUnits += 1;
									sequentialFailedUnitCount += 1;
									recordEvidenceUnitState({
										artifact,
										unitKey: evidenceUnit.key,
										unitHash: evidenceUnitHash,
										state: 'failed',
										failureCategory: 'empty_structured_extraction'
									});
									continue;
								}
								sequentialExtractions.push(enriched);
								evidenceCoverage.completedUnits += 1;
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: evidenceUnitHash,
									state: 'completed'
								});
								if (
									modelRuntimeId &&
									manifestEntry.contentHash &&
									isReusableEvidenceExtraction(enriched)
								) {
									try {
										await dbService.putCachedExtraction({
											id: crypto.randomUUID(),
											fileId: artifact.fileId,
											sourceContentHash: manifestEntry.contentHash,
											evidenceUnitKey: evidenceUnit.key,
											evidenceUnitHash,
											preparationVersion: EVIDENCE_UNIT_PREPARATION_VERSION,
											extractionVersion: request.promptContract.extractionPromptVersion,
											modelRuntimeId,
											payload: enriched
										});
									} catch (cacheError) {
										log.warn('Failed to persist validated evidence unit cache entry', {
											runId: request.runId,
											fileId: artifact.fileId,
											evidenceUnitKey: evidenceUnit.key,
											error: cacheError
										});
									}
								}
							}
						} catch (batchError) {
							if (isAiCancelledError(batchError)) throw batchError;
							const splitReason = isLocalAiContextCapacityError(batchError)
								? 'context'
								: isLocalAiTimeoutError(batchError)
									? 'timeout'
									: isStructuredEvidenceContractError(batchError)
										? 'structured_contract'
										: null;
							if (
								splitReason &&
								batchUnits.length > 1 &&
								batchUnits.every((unit) => !splitRetriedUnitKeys.has(unit.key))
							) {
								for (const unit of batchUnits) splitRetriedUnitKeys.add(unit.key);
								const retryBatches =
									splitReason === 'structured_contract'
										? batchUnits.map((unit) => [unit])
										: [
												batchUnits.slice(0, Math.ceil(batchUnits.length / 2)),
												batchUnits.slice(Math.ceil(batchUnits.length / 2))
											];
								inferenceBatches.splice(batchIndex + 1, 0, ...retryBatches);
								log.warn(
									'Local AI evidence batch failed before completion; retrying once as smaller batches',
									{
										runId: request.runId,
										fileId: artifact.fileId,
										evidenceUnitKeys: batchUnits.map((unit) => unit.key),
										batchIndex,
										splitReason
									}
								);
								continue;
							}
							for (const evidenceUnit of batchUnits) {
								const deterministicTextExtraction =
									buildDeterministicTextExtractionFromEvidenceUnit({
										artifact,
										evidenceUnit
									});
								if (deterministicTextExtraction) {
									sequentialExtractions.push(deterministicTextExtraction);
									evidenceCoverage.completedUnits += 1;
									recordEvidenceUnitState({
										artifact,
										unitKey: evidenceUnit.key,
										unitHash: unitHashes.get(evidenceUnit.key) ?? '',
										state: 'completed'
									});
									log.info('Used deterministic prepared-text extraction after model failure', {
										runId: request.runId,
										fileId: artifact.fileId,
										evidenceUnitKey: evidenceUnit.key
									});
									deterministicRecoveryCount += 1;
									continue;
								}
								const fallback =
									batchUnits.length === 1
										? buildHeuristicExtractionFromArtifact(artifact)
										: buildHeuristicExtractionFromEvidenceUnit({
												artifact,
												evidenceUnit,
												error: batchError
											});
								if (fallback) {
									sequentialExtractions.push(fallback);
									extractionIssues.push(...fallback.issues);
								}
								evidenceCoverage.failedUnits += 1;
								sequentialFailedUnitCount += 1;
								recordEvidenceUnitState({
									artifact,
									unitKey: evidenceUnit.key,
									unitHash: unitHashes.get(evidenceUnit.key) ?? '',
									state: 'failed',
									failureCategory: isLocalAiTimeoutError(batchError)
										? 'timeout'
										: isLocalAiContextCapacityError(batchError)
											? 'context_capacity'
											: 'extraction_failed'
								});
							}
							if (deterministicRecoveryCount === batchUnits.length) {
								continue;
							}
							extractionIssues.push(
								buildLocalArtifactExtractionFailureIssue({ artifact, error: batchError })
							);
							log.warn('Local AI evidence batch failed; required units remain retryable', {
								runId: request.runId,
								fileId: artifact.fileId,
								evidenceUnitKeys: batchUnits.map((unit) => unit.key),
								batchIndex,
								error: safeLocalAiFailureDiagnostics(batchError)
							});
						}
					}

					const mergedExtraction = mergeSequentialEvidenceExtractions({
						artifact,
						evidenceIdentifiers: evidenceUnits.map((unit) => unit.key),
						extractions: sequentialExtractions
					});
					const meaningfulUnits = sequentialExtractions.filter(
						(extraction) =>
							extraction.extractionSource !== 'deterministic_filtered' &&
							extractionHasMeaningfulSignal(extraction)
					);
					let fileSynthesis = mergedExtraction;
					if (
						sequentialFailedUnitCount === 0 &&
						meaningfulUnits.length > 1 &&
						sequentialExtractions.length === evidenceUnits.length
					) {
						try {
							const { value: synthesis, completion } = await this.runStructuredToolCompletion({
								schemaName: 'file_evidence_synthesis',
								schema: LocalAiFileSynthesisSchema,
								systemInstruction:
									'You are a local evidence-synthesis utility for Kwantflow. Combine only the supplied validated facts into one concise reusable file summary. Do not infer scope beyond those facts.',
								messages: structuredUserMessages(
									[
										`Synthesize reusable estimating evidence for "${artifact.fileName}" from the validated unit results below.`,
										'Do not use RFQ, asset, catalogue, playbook, or feedback context. Do not invent facts.',
										JSON.stringify(
											meaningfulUnits.map((unit) => ({
												evidenceIdentifiers: unit.evidenceIdentifiers,
												contentClass: unit.contentClass ?? 'unknown',
												estimatingUtility: unit.estimatingUtility ?? 'medium',
												summary: unit.summary,
												estimatingSignals: unit.estimatingSignals
											}))
										)
									].join('\n')
								),
								artifacts: [],
								temperature: 0,
								enableThinking: false,
								maxOutputTokens: 768,
								timeoutMs: LOCAL_AI_ARTIFACT_COMPLETION_TIMEOUT_MS
							});
							usageSamples.push(completion.usage);
							fileSynthesis = {
								...mergedExtraction,
								contentClass: synthesis.contentClass,
								estimatingUtility: synthesis.estimatingUtility,
								summary: synthesis.summary,
								estimatingSignals: synthesis.estimatingSignals
							};
						} catch (synthesisError) {
							fileSynthesis = {
								...mergedExtraction,
								extractionSource: 'model_repaired',
								issues: [
									...mergedExtraction.issues,
									{
										code: 'file_synthesis_fallback',
										message: `${artifact.fileName} used a deterministic merge because model-assisted file synthesis failed.`,
										severity: 'warning',
										fileId: artifact.fileId,
										fileName: artifact.fileName
									}
								]
							};
							log.warn('Model-assisted file evidence synthesis failed', {
								runId: request.runId,
								fileId: artifact.fileId,
								error: synthesisError
							});
						}
					}
					extractions.push(fileSynthesis);
					if (
						modelRuntimeId &&
						manifestEntry.contentHash &&
						sequentialFailedUnitCount === 0 &&
						sequentialExtractions.length === evidenceUnits.length &&
						hasCompleteTerminalCoverage() &&
						isReusableEvidenceExtraction(fileSynthesis)
					) {
						await dbService.putCachedExtraction({
							id: crypto.randomUUID(),
							fileId: artifact.fileId,
							sourceContentHash: manifestEntry.contentHash,
							evidenceUnitKey: fileSynthesisCacheKey,
							evidenceUnitHash: evidenceUnitSetHash,
							preparationVersion: EVIDENCE_UNIT_PREPARATION_VERSION,
							extractionVersion: request.promptContract.extractionPromptVersion,
							modelRuntimeId,
							payload: fileSynthesis,
							cacheKind: 'file_synthesis',
							synthesisVersion: EVIDENCE_FILE_SYNTHESIS_VERSION
						});
					}
				}
				request.onProgress?.({
					status: 'extracting',
					currentArtifactName: artifact.fileName,
					processedArtifactCount: index + 1,
					usableArtifactCount: countUsableLocalExtractions(extractions),
					totalArtifactCount: request.preparedRun.artifactManifest.length,
					supportedArtifactCount: request.preparedRun.artifactManifest.length,
					unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
					draftSubphase: null
				});
			} catch (error) {
				if (isAiCancelledError(error)) {
					throw error;
				}
				log.warn('Local AI artifact extraction failed; falling back to heuristic handling', {
					runId: request.runId,
					fileId: artifact.fileId,
					fileName: artifact.fileName,
					artifactKind: artifact.kind,
					error: safeLocalAiFailureDiagnostics(error),
					rawContentPresent: rawCompletionContent != null
				});

				const heuristicExtraction = buildHeuristicExtractionFromArtifact(artifact);
				if (heuristicExtraction) {
					const recordedUnitKeys = new Set(
						evidenceCoverage.units
							.filter((unit) => unit.fileId === artifact.fileId)
							.map((unit) => unit.unitKey)
					);
					const unrecordedUnits = evidenceUnits.filter(
						(evidenceUnit) => !recordedUnitKeys.has(evidenceUnit.key)
					);
					if (unrecordedUnits.length === 0 && evidenceUnits.length === 0) {
						evidenceCoverage.failedUnits += 1;
						recordEvidenceUnitState({
							artifact,
							unitKey: 'file:heuristic',
							unitHash: evidenceUnitSetHash,
							state: 'failed',
							failureCategory: 'heuristic_fallback_after_model_error'
						});
					} else {
						evidenceCoverage.failedUnits += unrecordedUnits.length;
						for (const evidenceUnit of unrecordedUnits) {
							recordEvidenceUnitState({
								artifact,
								unitKey: evidenceUnit.key,
								unitHash: await hashEvidenceUnit(evidenceUnit),
								state: 'failed',
								failureCategory: 'heuristic_fallback_after_model_error'
							});
						}
					}
					extractions.push({
						...heuristicExtraction,
						evidenceIdentifiers: manifestEntry.evidenceIdentifiers
					});
					extractionIssues.push(...heuristicExtraction.issues);
					request.onProgress?.({
						status: 'extracting',
						currentArtifactName: artifact.fileName,
						processedArtifactCount: index + 1,
						usableArtifactCount: countUsableLocalExtractions(extractions),
						totalArtifactCount: request.preparedRun.artifactManifest.length,
						supportedArtifactCount: request.preparedRun.artifactManifest.length,
						unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
						draftSubphase: null
					});
					continue;
				}

				const issue = buildLocalArtifactExtractionFailureIssue({
					artifact,
					error
				});
				if (evidenceUnits.length === 1) {
					const evidenceUnit = evidenceUnits[0];
					evidenceCoverage.failedUnits += 1;
					recordEvidenceUnitState({
						artifact,
						unitKey: evidenceUnit?.key ?? 'file:failed',
						unitHash: evidenceUnit ? await hashEvidenceUnit(evidenceUnit) : evidenceUnitSetHash,
						state: 'failed',
						failureCategory: isLocalAiTimeoutError(error) ? 'timeout' : 'extraction_failed'
					});
				}
				extractionIssues.push(issue);
				extractions.push({
					fileId: artifact.fileId,
					fileName: artifact.fileName,
					artifactKind: artifact.kind,
					extractionSource: 'unavailable',
					evidenceIdentifiers: manifestEntry.evidenceIdentifiers,
					summary: '',
					estimatingSignals: [],
					candidateItems: [],
					issues: [issue]
				});
				request.onProgress?.({
					status: 'extracting',
					currentArtifactName: artifact.fileName,
					processedArtifactCount: index + 1,
					usableArtifactCount: countUsableLocalExtractions(extractions),
					totalArtifactCount: request.preparedRun.artifactManifest.length,
					supportedArtifactCount: request.preparedRun.artifactManifest.length,
					unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
					draftSubphase: null
				});
			}
		}

		const evidenceIdentifiersByFileId = new Map(
			request.preparedRun.artifactManifest.map((entry) => [
				entry.fileId,
				entry.evidenceIdentifiers ?? []
			])
		);
		for (const [index, extraction] of extractions.entries()) {
			const extractionEvidenceIdentifiers = extraction.evidenceIdentifiers ?? [];
			extractions[index] = withCandidateEvidenceStates({
				...extraction,
				evidenceIdentifiers:
					extractionEvidenceIdentifiers.length > 0
						? extractionEvidenceIdentifiers
						: (evidenceIdentifiersByFileId.get(extraction.fileId) ?? [])
			});
		}
		const dispositionCandidates = extractions.filter(
			(extraction) =>
				extraction.extractionSource !== 'unavailable' &&
				extraction.extractionSource !== 'deterministic_filtered' &&
				extraction.estimatingUtility !== 'none'
		);
		const relevanceDecisions: LocalAiAssetEvidenceRelevance['files'] = [];
		if (
			dispositionCandidates.length > 0 &&
			request.runtimeStatus?.runtimeKind === 'litert_lm' &&
			request.runtimeStatus.supportsNativeToolCalls
		) {
			try {
				const relevanceStartedAt = Date.now();
				const files = Array.from(
					new Map(
						dispositionCandidates.map((extraction) => [extraction.fileId, extraction])
					).values()
				);
				for (const extraction of files) {
					const relevanceResult = await this.runStructuredTask({
						schemaName: 'asset_file_relevance',
						schema: buildLiteRtAssetEvidenceRelevanceSchema(),
						systemInstruction:
							'You are a local evidence-relevance utility for Kwantflow. Classify the supplied prepared file for this asset only. Mark it relevant only when it directly supports scope, quantities, specifications, operations, or commercial constraints. Mark unrelated material irrelevant. Otherwise use uncertain. Use only the supplied facts.',
						messages: structuredUserMessages(
							JSON.stringify({
								project: {
									name: request.projectContext.projectName,
									rfqNumber: request.projectContext.rfqNumber,
									brief: request.projectContext.rfqBrief
								},
								asset: { id: request.assetContext.assetId, name: request.assetContext.assetName },
								file: {
									fileName: extraction.fileName,
									contentClass: extraction.contentClass ?? 'unknown',
									estimatingUtility: extraction.estimatingUtility ?? 'medium',
									summary: normaliseWhitespace(extraction.summary).slice(0, 240),
									candidateLabels: extraction.candidateItems
										.slice(0, 3)
										.map((candidate) => normaliseWhitespace(candidate.label).slice(0, 120))
								}
							})
						),
						temperature: 0,
						enableThinking: false,
						maxOutputTokens: 256,
						timeoutMs: LOCAL_AI_ARTIFACT_COMPLETION_TIMEOUT_MS,
						workloadClass: 'user_batch',
						allowCorrection: true
					});
					relevanceDecisions.push({ fileId: extraction.fileId, ...relevanceResult.value });
					usageSamples.push(relevanceResult.completion.usage);
				}
				const expectedFileIds = new Set(
					dispositionCandidates.map((extraction) => extraction.fileId)
				);
				const returnedFileIds = relevanceDecisions.map((decision) => decision.fileId);
				if (
					returnedFileIds.length !== expectedFileIds.size ||
					new Set(returnedFileIds).size !== returnedFileIds.length ||
					returnedFileIds.some((fileId) => !expectedFileIds.has(fileId))
				) {
					throw new Error(
						'Asset evidence relevance did not account for every supplied file exactly once.'
					);
				}
				log.info('Completed asset-owned evidence relevance classification', {
					runId: request.runId,
					fileCount: relevanceDecisions.length,
					elapsedMs: Date.now() - relevanceStartedAt
				});
			} catch (error) {
				if (isAiCancelledError(error)) throw error;
				log.warn('Asset-owned evidence relevance classification was inconclusive', {
					runId: request.runId,
					fileCount: dispositionCandidates.length,
					error: safeLocalAiFailureDiagnostics(error)
				});
			}
		}
		const decidedFileIds = new Set(relevanceDecisions.map((decision) => decision.fileId));
		for (const [fileId, fileExtractions] of Map.groupBy(
			extractions,
			(extraction) => extraction.fileId
		)) {
			if (decidedFileIds.has(fileId)) continue;
			const corpus = fileExtractions
				.flatMap((extraction) => [extraction.summary, ...extraction.estimatingSignals])
				.join(' ')
				.toLowerCase();
			const hasQuantifiedScopeCandidate = fileExtractions.some((extraction) =>
				extraction.candidateItems.some(
					(candidate) =>
						pickNumber(candidate.quantityHint) != null &&
						candidate.unitHint != null &&
						candidate.evidenceRefs.length > 0
				)
			);
			const isReferenceWorkbook =
				/\b(raw material list|crew\s*&\s*shop rates|assemblies\s*&\s*presets|legacy column map)\b/.test(
					corpus
				);
			if (isReferenceWorkbook) {
				relevanceDecisions.push({
					fileId,
					disposition: 'irrelevant',
					reason: 'Prepared workbook evidence is a catalogue or reference export, not asset scope.'
				});
			} else if (hasQuantifiedScopeCandidate) {
				relevanceDecisions.push({
					fileId,
					disposition: 'relevant',
					reason: 'Prepared evidence contains a quantified, cited estimating candidate.'
				});
			}
		}
		const disposedExtractions = assignRunEvidenceDispositions({
			extractions,
			decisions: relevanceDecisions
		});
		extractions.splice(0, extractions.length, ...disposedExtractions);
		for (const extraction of extractions) {
			if (extraction.runDisposition === 'uncertain') {
				extractionIssues.push({
					code: 'evidence_relevance_uncertain',
					message: `${extraction.fileName} may relate to this asset, but its estimating relevance requires review.`,
					severity: 'warning',
					fileId: extraction.fileId,
					fileName: extraction.fileName
				});
			}
		}
		const blockingOmittedUnits = evidenceCoverage.units.filter(
			(unit) =>
				unit.state === 'omitted' &&
				!isNonBlockingDeterministicEvidenceOmission(unit.failureCategory)
		).length;
		if (evidenceCoverage.failedUnits > 0 || blockingOmittedUnits > 0) {
			extractionIssues.push({
				code: 'evidence_coverage_incomplete',
				message: `${evidenceCoverage.failedUnits} evidence unit(s) failed and ${blockingOmittedUnits} required unit(s) were omitted. The draft is partial and cannot be commercially ready.`,
				severity: 'error',
				fileId: null,
				fileName: null
			});
		}
		const draftExtractions = extractions.filter(
			(extraction) => extraction.runDisposition !== 'irrelevant'
		);

		const draftPromptParams = {
			projectContext: request.projectContext,
			assetContext: request.assetContext,
			workspaceKnowledgeContext: request.workspaceKnowledgeContext,
			referenceContext: request.referenceContext,
			workflowRules: request.workflowRules,
			outputContract: request.outputContract,
			estimateContextSnapshot: request.estimateContextSnapshot,
			promptContract: request.promptContract
		};

		let outlineCompletion!: LocalAiCompletionResponse;
		let draftOutline!: LocalStoredDraftOutline;
		let outlineAttemptCount = 1;
		let outlineElapsedMs: number;
		request.onProgress?.({
			status: 'drafting',
			currentArtifactName: null,
			processedArtifactCount: request.preparedRun.artifactManifest.length,
			usableArtifactCount: countUsableLocalExtractions(extractions),
			totalArtifactCount: request.preparedRun.artifactManifest.length,
			supportedArtifactCount: request.preparedRun.artifactManifest.length,
			unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
			draftSubphase: 'outline'
		});
		if (request.runtimeStatus?.runtimeKind === 'litert_lm') {
			log.info('Using deterministic local AI draft outline for native LiteRT runtime', {
				runId: request.runId,
				extractionCount: extractions.length,
				issueCount: extractionIssues.length
			});
			outlineElapsedMs = 0;
			draftOutline = buildFallbackOutlineFromExtractions({
				extractions: draftExtractions,
				detail:
					'Kwantflow used deterministic local outline composition because native non-streaming outline calls can exceed the frontend timeout boundary.'
			});
			outlineCompletion = {
				content: draftOutline,
				thinking: '',
				modelId: 'kwantflow-deterministic-outline',
				usage: {},
				toolCalls: []
			};
			log.info('Completed deterministic local AI draft outline', {
				runId: request.runId,
				elapsedMs: outlineElapsedMs,
				sourceExtractionCount: extractions.length,
				candidateExtractionCount: draftExtractions.filter(
					(extraction) => extraction.candidateItems.length > 0
				).length,
				seededTakeoffItemCount: draftOutline.takeoff_items.length
			});
		} else {
			try {
				const outlineStartedAt = Date.now();
				log.info('Starting local AI draft outline', {
					runId: request.runId,
					extractionCount: extractions.length,
					issueCount: extractionIssues.length
				});
				const outlineResult = await this.runStructuredToolCompletion({
					schemaName: 'draft_outline',
					schema: AiDraftOutlineSchema,
					systemInstruction: draftSystemInstruction,
					messages: structuredUserMessages(
						buildDraftOutlinePromptFromExtractions(draftPromptParams, draftExtractions)
					),
					artifacts: [],
					temperature: 0.0,
					maxOutputTokens: 1_536,
					timeoutMs: LOCAL_AI_OUTLINE_COMPLETION_TIMEOUT_MS,
					parseValue: (raw) =>
						parseLocalDraftOutlineWithRepair({
							rawContent: raw,
							extractions: draftExtractions
						})
				});
				outlineCompletion = outlineResult.completion;
				draftOutline = outlineResult.value;
				outlineElapsedMs =
					outlineCompletion.diagnostics?.elapsedMs ?? Date.now() - outlineStartedAt;
				log.info('Completed local AI draft outline', {
					runId: request.runId,
					elapsedMs: outlineElapsedMs,
					promptTokenCount: outlineCompletion.usage.promptTokenCount ?? null,
					candidatesTokenCount: outlineCompletion.usage.candidatesTokenCount ?? null,
					totalTokenCount: outlineCompletion.usage.totalTokenCount ?? null
				});
			} catch (primaryOutlineError) {
				outlineAttemptCount = 2;
				log.warn('Primary local AI draft outline failed; using deterministic outline fallback', {
					runId: request.runId,
					error: primaryOutlineError
				});
				outlineElapsedMs = 0;
				draftOutline = buildFallbackOutlineFromExtractions({
					extractions: draftExtractions,
					detail: summariseAiFailureMessage(primaryOutlineError)
				});
				outlineCompletion = {
					content: draftOutline,
					thinking: '',
					modelId: 'kwantflow-deterministic-outline',
					usage: {},
					toolCalls: []
				};
				log.info('Completed deterministic local AI draft outline fallback', {
					runId: request.runId,
					elapsedMs: outlineElapsedMs,
					sourceExtractionCount: extractions.length
				});
			}
		}

		draftStageMetrics.push({
			stage: 'outline',
			elapsedMs: outlineElapsedMs,
			timeoutMs: LOCAL_AI_OUTLINE_COMPLETION_TIMEOUT_MS,
			attemptCount: outlineAttemptCount,
			status: 'completed',
			modelId: outlineCompletion.modelId,
			usage: outlineCompletion.usage,
			timings: outlineCompletion.diagnostics?.timings
		});
		usageSamples.push(outlineCompletion.usage);
		if (outlineShouldPreferHeuristicBundle(draftOutline, draftExtractions)) {
			const seeded = buildFallbackOutlineFromExtractions({
				extractions: draftExtractions,
				detail:
					'model outline split or undercounted bundled extraction evidence and was replaced with deterministic local outline seeding'
			});
			draftOutline = AiDraftOutlineSchema.parse({
				...seeded,
				scope_summary: draftOutline.scope_summary,
				notes: draftOutline.notes || seeded.notes,
				classification_system_id: draftOutline.classification_system_id ?? null,
				wbs_root_node_id: draftOutline.wbs_root_node_id ?? null,
				issues: [...draftOutline.issues, ...seeded.issues]
			});
		} else if (outlineNeedsHeuristicSeeding(draftOutline, draftExtractions)) {
			draftOutline = buildFallbackOutlineFromExtractions({
				extractions: draftExtractions,
				detail:
					'model returned takeoff items without resolved quantities, evidence refs, or seeded cost components'
			});
		}
		request.onProgress?.({
			status: 'drafting',
			currentArtifactName: null,
			processedArtifactCount: request.preparedRun.artifactManifest.length,
			usableArtifactCount: countUsableLocalExtractions(extractions),
			totalArtifactCount: request.preparedRun.artifactManifest.length,
			supportedArtifactCount: request.preparedRun.artifactManifest.length,
			unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
			draftSubphase: 'matching'
		});
		const matchingResult = await this.buildLocalDraftMatching({
			outline: draftOutline,
			draftPromptParams,
			systemInstruction: draftSystemInstruction,
			refContext: request.referenceContext,
			useDeterministicMatching: request.runtimeStatus?.runtimeKind === 'litert_lm'
		});
		const draftMatching = matchingResult.matching;
		draftStageMetrics.push({
			stage: 'matching',
			elapsedMs: matchingResult.elapsedMs,
			timeoutMs: matchingResult.timeoutMs,
			attemptCount: matchingResult.attemptCount,
			status: matchingResult.status,
			modelId: matchingResult.modelId,
			usage: matchingResult.usage,
			timings: undefined
		});
		if (matchingResult.status === 'completed') {
			usageSamples.push(matchingResult.usage);
		}
		request.onProgress?.({
			status: 'drafting',
			currentArtifactName: null,
			processedArtifactCount: request.preparedRun.artifactManifest.length,
			usableArtifactCount: countUsableLocalExtractions(extractions),
			totalArtifactCount: request.preparedRun.artifactManifest.length,
			supportedArtifactCount: request.preparedRun.artifactManifest.length,
			unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
			draftSubphase: 'composition'
		});
		const compositionStartedAt = Date.now();
		let draft = stripLocalModelIssueNoise(
			composeFinalDraftFromOutlineAndMatching({
				outline: draftOutline,
				matching: draftMatching
			})
		);
		log.info('Composed local AI draft from validated outline and matching', {
			runId: request.runId,
			outlineTakeoffItemCount: draftOutline.takeoff_items.length,
			draftTakeoffItemCount: draft.takeoff_items.length,
			candidateExtractionCount: draftExtractions.filter(
				(extraction) => extraction.candidateItems.length > 0
			).length
		});
		const shouldRequireDraftAgentTools =
			draftExtractions.some((extraction) => extraction.candidateItems.length > 0) &&
			((request.referenceContext.catalogueSources?.materials?.records.length ?? 0) > 0 ||
				(request.referenceContext.rateSources?.labourRates?.records.length ?? 0) > 0 ||
				(request.referenceContext.rateSources?.equipmentRates?.records.length ?? 0) > 0 ||
				(request.referenceContext.rateSources?.subcontractRates?.records.length ?? 0) > 0);
		const draftAgentProposalSchema = buildLocalDraftAgentProposalSchema(draft.takeoff_items.length);
		const useLiteRtScalarDraftReturn = request.runtimeStatus?.runtimeKind === 'litert_lm';
		const draftAgentReturnSchema = useLiteRtScalarDraftReturn
			? buildLiteRtDraftAgentReturnSchema()
			: draftAgentProposalSchema;
		let draftAgent: {
			final: LocalDraftAgentProposal;
			steps: Array<Record<string, unknown>>;
			toolCalls: Array<Record<string, unknown>>;
		} = {
			final: draftAgentProposalSchema.parse({
				status: 'complete',
				...buildLocalDraftAgentProposalSeed(draft),
				issues: []
			}),
			steps: [],
			toolCalls: []
		};
		let draftAgentApplied = false;
		const canRunDraftAgent =
			request.runtimeStatus?.supportsNativeToolCalls &&
			(request.runtimeStatus.runtimeKind !== 'litert_lm' ||
				LOCAL_AI_ENABLE_LITERT_DRAFT_REFINEMENT ||
				request.enableDraftRefinement === true);
		if (!canRunDraftAgent && request.runtimeStatus?.runtimeKind === 'litert_lm') {
			extractionIssues.push({
				code: 'local_draft_agent_skipped_device_budget',
				message:
					'Local AI draft refinement was skipped because the native tool-turn benchmark is not yet reliable within the device budget. Kwantflow used deterministic evidence composition and exact local validation instead.',
				severity: 'info'
			});
		}
		if (canRunDraftAgent) {
			const draftAgentSteps: Array<Record<string, unknown>> = [];
			const draftAgentToolCalls: Array<Record<string, unknown>> = [];
			try {
				if (useLiteRtScalarDraftReturn && !shouldRequireDraftAgentTools) {
					const scalarCompletion = await this.runStructuredTask({
						schemaName: 'draft_estimator_scalar_refinement',
						schema: buildLiteRtDraftAgentReturnSchema(),
						systemInstruction:
							`${draftSystemInstruction}\n\nRefine only the seeded estimate scope summary and notes. ` +
							'Keep statements evidence-backed. Kwantflow owns takeoff structure, record links, rates, units, and totals.',
						messages: structuredUserMessages(
							JSON.stringify({
								draftSeed: buildLocalDraftAgentProposalSeed(draft),
								evidenceSummaries: buildDraftAgentEvidenceSummaries(draftExtractions),
								coverage: evidenceCoverage
							})
						),
						temperature: 0,
						enableThinking: false,
						maxOutputTokens: 768,
						timeoutMs: LOCAL_AI_DRAFT_AGENT_TURN_TIMEOUT_MS,
						allowCorrection: true
					});
					draftAgent = {
						final: draftAgentProposalSchema.parse({
							status: 'complete',
							...buildLocalDraftAgentProposalSeed(draft),
							...scalarCompletion.value,
							issues: []
						}),
						steps: [
							{
								turn: 1,
								toolCallCount: scalarCompletion.completion.toolCalls.length,
								status: 'completed'
							}
						],
						toolCalls: []
					};
				} else {
					draftAgent = await runLocalDraftAgent({
						initialMessage: JSON.stringify({
							task: useLiteRtScalarDraftReturn
								? `Refine only the seeded estimate scope summary and notes from the evidence. Kwantflow retains the evidence-backed takeoff items, links, rates, and totals deterministically. Submit the scalar refinement only by calling ${DRAFT_AGENT_RETURN_TOOL_NAME}.`
								: `Refine the seeded estimate into a compact estimator proposal. Return one takeoff item for every seeded item in the same order. Infer only evidence-backed scope and operations. Submit the final proposal only by calling ${DRAFT_AGENT_RETURN_TOOL_NAME}. Do not return source IDs, rates, formulas, totals, templates, classifications, WBS, or citations. Kwantflow applies those deterministically.`,
							draftSeed: buildLocalDraftAgentProposalSeed(draft),
							evidenceSummaries: buildDraftAgentEvidenceSummaries(draftExtractions),
							availableRecordScopes: {
								materials:
									request.referenceContext.catalogueSources?.materials?.records.length ?? 0,
								labour_rates:
									request.referenceContext.rateSources?.labourRates?.records.length ?? 0,
								equipment_rates:
									request.referenceContext.rateSources?.equipmentRates?.records.length ?? 0,
								subcontract_rates:
									request.referenceContext.rateSources?.subcontractRates?.records.length ?? 0,
								classification_systems:
									request.referenceContext.mappingTargets?.classificationSystems?.records.length ??
									0,
								cost_codes: request.referenceContext.mappingTargets?.costCodes?.records.length ?? 0,
								wbs_nodes: request.referenceContext.mappingTargets?.wbsNodes?.records.length ?? 0
							},
							coverage: {
								totalUnits: evidenceCoverage.totalUnits,
								cachedUnits: evidenceCoverage.cachedUnits,
								completedUnits: evidenceCoverage.completedUnits,
								failedUnits: evidenceCoverage.failedUnits,
								omittedUnits: evidenceCoverage.omittedUnits
							}
						}),
						complete: (messages) =>
							this.runCompletion({
								stage: 'draft_estimator_tool_turn',
								systemInstruction:
									`${draftSystemInstruction}\n\nYou are the bounded Kwantflow estimate drafting agent. ` +
									'Use the prepared evidence summaries first. Call read-only tools only when a bounded evidence slice or record name is needed. ' +
									`Batch required tool calls into one turn. After tool results, submit the compact proposal through ${DRAFT_AGENT_RETURN_TOOL_NAME} instead of calling more tools. ` +
									'Do not brainstorm extra scope. Do not fabricate links, rates, formulas, totals, or record IDs. Kwantflow owns commercial truth.',
								messages,
								tools: [
									...getLocalDraftAgentToolDeclarations(),
									{
										type: 'function',
										function: {
											name: DRAFT_AGENT_RETURN_TOOL_NAME,
											description: useLiteRtScalarDraftReturn
												? 'Return the evidence-backed scope-summary and notes refinement.'
												: 'Return the complete compact estimator proposal after any needed read-only lookups.',
											parameters: buildStructuredToolParameters(draftAgentReturnSchema)
										}
									}
								],
								parseToolCalls: true,
								enableThinking: false,
								temperature: 0,
								maxOutputTokens: 2_048,
								timeoutMs: LOCAL_AI_DRAFT_AGENT_TURN_TIMEOUT_MS
							}),
						executeTool: (name, args) => executeLocalDraftTool(name, args),
						readEvidence: async ({ file_id, evidence_identifier }) => {
							const extraction = draftExtractions.find((entry) => entry.fileId === file_id);
							if (!extraction) {
								return { status: 'not_found', fileId: file_id };
							}
							const matchingCandidates = evidence_identifier
								? extraction.candidateItems.filter((candidate) =>
										candidate.evidenceRefs.some(
											(ref) => ref.evidence_identifier === evidence_identifier
										)
									)
								: extraction.candidateItems;
							return {
								status: 'ok',
								fileId: extraction.fileId,
								fileName: extraction.fileName,
								artifactKind: extraction.artifactKind,
								evidenceIdentifier: evidence_identifier ?? null,
								summary: extraction.summary,
								estimatingSignals: extraction.estimatingSignals,
								candidateItems: matchingCandidates,
								issues: extraction.issues
							};
						},
						parseFinal: (value) => {
							if (!useLiteRtScalarDraftReturn) return draftAgentProposalSchema.parse(value);
							const scalar = buildLiteRtDraftAgentReturnSchema().parse(value);
							return draftAgentProposalSchema.parse({
								status: 'complete',
								...buildLocalDraftAgentProposalSeed(draft),
								...scalar,
								issues: []
							});
						},
						finalToolName: DRAFT_AGENT_RETURN_TOOL_NAME,
						requireToolUseBeforeFinal: shouldRequireDraftAgentTools,
						maxTurns: LOCAL_AI_DRAFT_AGENT_MAX_TURNS,
						onStep: (step) => draftAgentSteps.push(step),
						onToolCall: (toolCall) => draftAgentToolCalls.push(toolCall)
					});
				}
				draftAgentApplied = true;
			} catch (agentError) {
				if (isAiCancelledError(agentError)) throw agentError;
				const failureKind = isLocalAiTimeoutError(agentError) ? 'timeout' : 'error';
				const failureDiagnostics = safeLocalAiFailureDiagnostics(agentError);
				const failureMessage = JSON.stringify({
					category: failureDiagnostics.category,
					validationIssues: failureDiagnostics.validationIssues,
					contractCode: failureDiagnostics.contractCode
				});
				if (draftAgentSteps.length === 0) {
					draftAgentSteps.push({
						turn: 1,
						toolCallCount: 0,
						status: 'failed',
						failureKind,
						message: failureMessage
					});
				} else {
					const lastStep = draftAgentSteps[draftAgentSteps.length - 1]!;
					lastStep.status = 'failed';
					lastStep.failureKind = failureKind;
					lastStep.message = failureMessage;
				}
				const issue: LocalStoredIssue = {
					code: isLocalAiTimeoutError(agentError)
						? 'local_draft_agent_timeout_fallback'
						: 'local_draft_agent_fallback',
					message: `Local AI draft refinement did not complete. Kwantflow kept the deterministic draft for review: ${summariseAiFailureMessage(agentError)}`,
					severity: 'warning',
					fileId: null,
					fileName: null
				};
				log.warn('Local AI draft agent failed; keeping deterministic composed draft', {
					runId: request.runId,
					error: safeLocalAiFailureDiagnostics(agentError)
				});
				extractionIssues.push(issue);
				draft = AiDraftRunEstimateSchema.parse({
					...draft,
					issues: [...draft.issues, issue]
				});
				draftAgent = {
					final: draftAgentProposalSchema.parse({
						status: 'complete',
						...buildLocalDraftAgentProposalSeed(draft),
						issues: []
					}),
					steps: draftAgentSteps,
					toolCalls: draftAgentToolCalls
				};
			}
		}
		if (draftAgentApplied) {
			draft = applyLocalDraftAgentProposal({ baseline: draft, proposal: draftAgent.final });
		}
		draft = applyLocalEvidenceValidationGate(stripLocalModelIssueNoise(draft));
		draftStageMetrics.push({
			stage: 'composition',
			elapsedMs: Date.now() - compositionStartedAt,
			timeoutMs: 0,
			attemptCount: 1,
			status: 'completed',
			modelId: 'deterministic_local',
			usage: {}
		});
		request.onProgress?.({
			status: 'drafting',
			currentArtifactName: null,
			processedArtifactCount: request.preparedRun.artifactManifest.length,
			usableArtifactCount: countUsableLocalExtractions(extractions),
			totalArtifactCount: request.preparedRun.artifactManifest.length,
			supportedArtifactCount: request.preparedRun.artifactManifest.length,
			unsupportedArtifactCount: request.preparedRun.progressDetail.unsupportedArtifactCount,
			draftSubphase: 'validation'
		});
		const validationStartedAt = Date.now();
		const evidenceRefs = collectDraftEvidenceRefs(draft);

		// Validate matching references against the reference context
		const valContext = buildDraftValidationContext(request.referenceContext);
		if (valContext) {
			const valResult = validateDraftEstimateRefs(draft, valContext);
			draft = valResult.draft;
			for (const issue of valResult.issues) {
				extractionIssues.push(issue);
			}
		}

		draftStageMetrics.push({
			stage: 'validation',
			elapsedMs: Date.now() - validationStartedAt,
			timeoutMs: 0,
			attemptCount: 1,
			status: 'completed',
			modelId: 'deterministic_local',
			usage: {}
		});

		return AiDraftRunResultSchema.parse({
			draft,
			draftAgentSteps: draftAgent.steps,
			draftToolCalls: draftAgent.toolCalls,
			draftAgentFinal: draftAgent.final,
			draftOutline,
			draftMatching,
			evidenceRefs,
			issues: dedupeLocalIssues([
				...request.preparedRun.issues,
				...extractionIssues,
				...draft.issues
			]),
			artifactManifest: request.preparedRun.artifactManifest,
			extractions,
			draftStageMetrics,
			usage: aggregateUsage(usageSamples),
			promptContract: request.promptContract,
			normalizedTableSnapshot: request.normalizedTableSnapshot,
			cacheMetadata: {
				strategy: 'telemetry',
				normalizedTableSnapshotFingerprint: `${request.runId}:normalized`,
				estimateContextSnapshotFingerprint: `${request.runId}:estimate`,
				extractionContextFingerprint: `${request.runId}:extraction`,
				draftContextFingerprint: `${request.runId}:draft`
			},
			evidenceCoverage,
			runtimeExecutionContext: buildLocalRuntimeExecutionContext({
				runtimeStatus: request.runtimeStatus,
				draftStageMetrics,
				evidenceArtifacts: request.preparedRun.artifactManifest.map(
					(artifact: AiArtifactManifestEntry) => ({
						fileId: artifact.fileId,
						fileName: artifact.fileName,
						artifactKind: artifact.artifactKind,
						sourceFormat: artifact.sourceFormat,
						structureHints: artifact.structureHints,
						evidenceIdentifiers: artifact.evidenceIdentifiers
					})
				)
			})
		});
	}
}

function buildDraftValidationContext(refContext: AiReferenceContext): {
	classificationSystemIds: Set<string>;
	wbsNodeIds: Set<string>;
	costCodeIds: Set<string>;
	materialSourceIds: Set<string>;
	labourSourceIds: Set<string>;
	equipmentSourceIds: Set<string>;
	subcontractSourceIds: Set<string>;
	templateIds?: Set<string>;
	presetIds?: Set<string>;
} | null {
	if (!refContext.mappingTargets?.classificationSystems?.records) {
		return null;
	}
	return {
		classificationSystemIds: new Set(
			refContext.mappingTargets.classificationSystems.records.map((r) => r.id as string)
		),
		wbsNodeIds: new Set(refContext.mappingTargets.wbsNodes.records.map((r) => r.id as string)),
		costCodeIds: new Set(refContext.mappingTargets.costCodes.records.map((r) => r.id as string)),
		materialSourceIds: new Set(
			refContext.catalogueSources.materials.records.map((r) => r.id as string)
		),
		labourSourceIds: new Set(refContext.rateSources.labourRates.records.map((r) => r.id as string)),
		equipmentSourceIds: new Set(
			refContext.rateSources.equipmentRates.records.map((r) => r.id as string)
		),
		subcontractSourceIds: new Set(
			refContext.rateSources.subcontractRates.records.map((r) => r.id as string)
		),
		templateIds: new Set(
			refContext.draftingPatterns.estimateTemplates.records.map((r) => r.id as string)
		),
		presetIds: new Set(
			refContext.draftingPatterns.costComponentPresets.records.map((r) => r.id as string)
		)
	};
}

export const localAiService = new LocalAiService();
