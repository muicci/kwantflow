import { getLocalAiRuntimeClientId } from '$lib/constants/local-ai-runtime-manifest.js';
import {
	getEstimateAiPreparedArtifactKind,
	getFileCategory,
	normaliseUnitCode
} from '$lib/constants/index.js';
import {
	getPreparedEvidenceCachePath,
	hashFileBytes,
	readPreparedEvidenceCacheText,
	readVaultFile,
	writePreparedEvidenceCacheText
} from '$lib/services/assets.js';
import { isCadLoadError } from '$lib/services/cad-loader.js';
import {
	buildEstimateAiCadEvidence,
	type AiCadArtifactData,
	type AiCadMetadata,
	type AiCadRender
} from '$lib/services/ai-cad-evidence.js';
import { invoke } from '@tauri-apps/api/core';
import PdfJsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker';
import {
	buildAiEstimateContextSnapshot,
	buildEstimateMappingReview,
	normaliseAiTableSnapshot as normaliseEstimateAiTableSnapshot
} from '$lib/services/estimate-ai-context.js';
import {
	buildEstimateAiImageArtifactDetailed,
	readEstimateAiTextContentDetailed,
	prepareAndIndexFileChunks,
	type EstimateAiImageArtifactData,
	type EstimateAiImageQualitySignals
} from '$lib/services/ai-file-evidence.js';
import { tileImageWithGridCoordinates } from './image-tiler.js';
import {
	buildAiSystemInstruction as buildSharedAiSystemInstruction,
	buildArtifactExtractionPrompt as buildSharedArtifactExtractionPrompt,
	buildDraftCompositionPrompt as buildSharedDraftCompositionPrompt,
	buildDraftMatchingPrompt as buildSharedDraftMatchingPrompt,
	buildDraftOutlineFallbackPromptFromExtractions as buildSharedDraftOutlineFallbackPromptFromExtractions,
	buildDraftOutlinePromptFromExtractions as buildSharedDraftOutlinePromptFromExtractions,
	buildDraftPromptFromExtractions as buildSharedDraftPromptFromExtractions
} from '$lib/contracts/ai-prompts.js';
import { JsonStringSchema, AiDraftEstimateSchema } from '$lib/schemas/index.js';
import { createLogger } from '$lib/services/logger.js';
import { isTauri } from '$lib/utils/env.js';
import { AI_FAILURE_KINDS } from '$lib/types/index.js';
import type {
	AiDraftEstimate,
	AiDraftTakeoffItem,
	AiEvidenceRef,
	AiEstimateContextSnapshot,
	AiArtifactManifestEntry,
	AiTextArtifactSourceFormat,
	AiTextArtifactStructureHints,
	AiAssetContext,
	AiOutputContract,
	AiFailureKind,
	AiIssue,
	AiPromptContract,
	AiProjectContext,
	AiReferenceContext,
	AiWorkspaceKnowledgeContext,
	AiReferenceSection,
	AiRunProgressDetail,
	AiOverrideEvent,
	AiWorkflowRules,
	AssetFile,
	Estimate
} from '$lib/types/index.js';

export type AiArtifactKind = 'text' | 'pdf' | 'image' | 'cad';

export type AiArtifactRender = AiCadRender;

type BaseArtifact = {
	kind: AiArtifactKind;
	fileId: string;
	fileName: string;
	filePath: string;
	byteSize?: number;
	contentHash?: string | null;
	checksumAlgorithm?: string;
	documentType?: string;
	revisionLabel?: string;
	receivedAt?: string | null;
	sourceLabel?: string;
	sourceMetadata?: Record<string, unknown>;
};

export type TextArtifact = BaseArtifact & {
	kind: 'text';
	textContent: string;
	sourceFormat: AiTextArtifactSourceFormat;
	structureHints: AiTextArtifactStructureHints | null;
};

export type PdfArtifact = BaseArtifact & {
	kind: 'pdf';
	pageCount: number;
	textContent: string;
	inlineData: string | null;
	mimeType: string;
	rasterPages: Array<{
		pageNumber: number;
		mimeType: string;
		inlineData: string;
	}>;
};

export type ImageArtifact = BaseArtifact & {
	kind: 'image';
	mimeType: string;
	inlineData: string;
	imageQualitySignals?: EstimateAiImageQualitySignals;
};

export type CadArtifact = BaseArtifact & {
	kind: 'cad';
	metadata: AiCadMetadata;
	renders: AiArtifactRender[];
	summaryText: string;
};

export type AiPreparedArtifact = TextArtifact | PdfArtifact | ImageArtifact | CadArtifact;

type PdfArtifactData = {
	pageCount: number;
	text: string;
	inlineData?: string | null;
	mimeType?: string;
	rasterPages?: Array<{
		pageNumber: number;
		mimeType: string;
		inlineData: string;
	}>;
	issues?: AiIssue[];
	cacheHit?: boolean | null;
	pageTextContents?: string[];
};

type PreparedPdfCacheEntry = {
	version: 7;
	kind: 'pdf';
	filePath: string;
	fileName: string;
	sourceFingerprint: string;
	preparedAt: string;
	pageCount: number;
	text: string;
	inlineData: string | null;
	mimeType: string;
	rasterPages: Array<{
		pageNumber: number;
		mimeType: string;
		inlineData: string;
	}>;
	issues: AiIssue[];
};

type NativePdfPageTextResult = {
	pageNumber: number;
	textContent: string;
};

type CadArtifactData = AiCadArtifactData;

type ArtifactCollectorDeps = {
	readText: (file: AssetFile) => Promise<{
		textContent: string;
		cacheHit: boolean;
		sourceFormat: AiTextArtifactSourceFormat;
		structureHints: AiTextArtifactStructureHints | null;
		isTruncated?: boolean;
		chunks?: Array<{
			textContent: string;
			structureHints: AiTextArtifactStructureHints | null;
			isTruncated?: boolean;
		}>;
	}>;
	readPdf: (file: AssetFile) => Promise<PdfArtifactData>;
	readImage: (file: AssetFile) => Promise<
		EstimateAiImageArtifactData & {
			cacheHit?: boolean | null;
			pages?: Array<EstimateAiImageArtifactData & { pageNumber: number }>;
		}
	>;
	readCad: (file: AssetFile) => Promise<CadArtifactData>;
};

type AiDraftValidationContext = {
	classificationSystemIds: Set<string>;
	wbsNodeIds: Set<string>;
	costCodeIds: Set<string>;
	materialSourceIds: Set<string>;
	labourSourceIds: Set<string>;
	equipmentSourceIds: Set<string>;
	subcontractSourceIds: Set<string>;
	templateIds?: Set<string>;
	presetIds?: Set<string>;
};

type AiArtifactExtraction = {
	fileId: string;
	fileName: string;
	artifactKind: AiArtifactKind;
	summary: string;
	estimatingSignals: string[];
	candidateItems: Array<{
		label: string;
		quantityHint: string | null;
		unitHint: string | null;
		notes: string;
		evidenceRefs: AiEvidenceRef[];
	}>;
	issues: AiIssue[];
};

type LegacyDraftTextArtifact = {
	fileId: string;
	fileName: string;
	filePath: string;
	content: string;
};

export type PreparedDraftRun = {
	artifacts: AiPreparedArtifact[];
	issues: AiIssue[];
	artifactManifest: AiArtifactManifestEntry[];
	contextFingerprint?: string;
	preprocessProfile: {
		totalElapsedMs: number;
		artifacts: Array<{
			fileId: string;
			fileName: string;
			declaredCategory: string | null;
			included: boolean;
			cacheHit: boolean | null;
			artifactKind: AiArtifactKind | null;
			extractionMode: string | null;
			elapsedMs: number;
			renderCount: number | null;
			renderSize: number | null;
			viewLabels: string[];
			issueCodes: string[];
			localSkipReason: string | null;
		}>;
	};
	progressDetail: AiRunProgressDetail;
};

type StartDraftRunRequest = {
	runId: string;
	workspaceId: string;
	projectContext: AiProjectContext;
	assetContext: AiAssetContext;
	workspaceKnowledgeContext: AiWorkspaceKnowledgeContext | null;
	preparedRun: PreparedDraftRun;
	referenceContext: AiReferenceContext;
	workflowRules: AiWorkflowRules;
	outputContract: AiOutputContract;
	normalizedTableSnapshot: Record<string, unknown>;
	estimateContextSnapshot: AiEstimateContextSnapshot;
	promptContract: AiPromptContract;
};

const log = createLogger('aiDraftingService');

export const AI_PROMPT_CONTRACT: AiPromptContract = {
	systemInstructionVersion: 'local-system-v3-senior-estimator',
	extractionPromptVersion: 'local-extraction-v5-senior-estimator',
	draftPromptVersion: 'local-draft-v3-senior-estimator'
};

export const LOCAL_LITERT_LM_RUNTIME_CONTRACT = {
	version: 'local-ai-kernel-v3',
	clientRuntimeId: getLocalAiRuntimeClientId()
};

function normaliseTextBlock(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normaliseBriefSection(lines: string[]): string | null {
	if (lines.length === 0) return null;
	return normaliseTextBlock(lines.join('\n'));
}

function pushUniqueLine(lines: string[], line: string): void {
	if (!lines.includes(line)) {
		lines.push(line);
	}
}

function isIgnoredRfqLine(line: string): boolean {
	const lower = line.toLowerCase();
	if (lower.length === 0) return true;
	if (
		/^(hi|hello|dear|kind regards|regards|thanks|thank you|cheers|best|from:|sent:|subject:|to:|cc:)\b/.test(
			lower
		)
	) {
		return true;
	}
	if (lower === 'estimator') return true;
	if (/^[-_]{3,}$/.test(lower)) return true;
	if (/@/.test(lower) && !/\b(mm|cm|m2|m3|kg|ea|qty|quantity)\b/.test(lower)) return true;
	if (/^\+?[0-9()\s-]{7,}$/.test(line.trim())) return true;
	return false;
}

function buildStructuredRfqBrief(content: string | null | undefined): AiProjectContext['rfqBrief'] {
	const cleanedSourceText = normaliseTextBlock(content);
	if (!cleanedSourceText) {
		return {
			scopeSummary: null,
			constraints: null,
			materialsAndSpecs: null,
			quantitiesAndUnits: null,
			referencedDocuments: null,
			exclusions: null,
			cleanedSourceText: null
		};
	}

	const lines = cleanedSourceText
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !isIgnoredRfqLine(line));

	const scopeSummary: string[] = [];
	const constraints: string[] = [];
	const materialsAndSpecs: string[] = [];
	const quantitiesAndUnits: string[] = [];
	const referencedDocuments: string[] = [];
	const exclusions: string[] = [];

	for (const line of lines) {
		const lower = line.toLowerCase();
		const isExclusion = /\b(exclude|excluding|exclusion|not included|by others)\b/.test(lower);
		const hasQuantity =
			/\b(qty|quantity|quantities|length|width|height|weight|tonne|ton|kg|mm|cm|m2|m3|sqm|sq\.m|pcs|pc|each|ea|lm|m)\b/.test(
				lower
			);
		const hasReferencedDocument =
			/\b(draw|drawing|dwg|sheet|detail|section|elev|elevation|plan|sk-|ga\b|revision|rev\b|spec section)\b/.test(
				lower
			);
		const hasMaterialSpec =
			/\b(spec|specification|material|grade|finish|coating|galv|galvan(?:ised|ized)?|stainless|aluminium|aluminum|powder|thickness|anti-slip|grating|tread)\b/.test(
				lower
			);
		const hasConstraint =
			/\b(site|install|installation|delivery|access|tolerance|program|lead time|shutdown|weld|welding|paint|primer|inspection)\b/.test(
				lower
			);
		const isScopeLead = /^(fabricate|supply|install|manufacture|provide|construct)\b/.test(lower);

		if (isExclusion) {
			pushUniqueLine(exclusions, line);
			continue;
		}
		if (hasQuantity) {
			pushUniqueLine(quantitiesAndUnits, line);
		}
		if (hasReferencedDocument) {
			pushUniqueLine(referencedDocuments, line);
		}
		if (hasMaterialSpec) {
			pushUniqueLine(materialsAndSpecs, line);
		}
		if (hasConstraint && !isScopeLead) {
			pushUniqueLine(constraints, line);
		}
		if (
			isScopeLead ||
			(!hasQuantity && !hasReferencedDocument && !hasMaterialSpec && !hasConstraint)
		) {
			pushUniqueLine(scopeSummary, line);
		}
	}

	return {
		scopeSummary: normaliseBriefSection(scopeSummary),
		constraints: normaliseBriefSection(constraints),
		materialsAndSpecs: normaliseBriefSection(materialsAndSpecs),
		quantitiesAndUnits: normaliseBriefSection(quantitiesAndUnits),
		referencedDocuments: normaliseBriefSection(referencedDocuments),
		exclusions: normaliseBriefSection(exclusions),
		cleanedSourceText: normaliseBriefSection(lines)
	};
}

function inferArtifactRole(
	artifact: Pick<AiPreparedArtifact, 'kind' | 'fileName'>
): AiArtifactManifestEntry['aiRole'] {
	const fileName = artifact.fileName.toLowerCase();
	if (/\b(quote|pricing|supplier|vendor|proposal)\b/.test(fileName)) {
		return 'supplier_quote';
	}
	if (/\b(spec|specification|scope)\b/.test(fileName)) {
		return 'specification';
	}
	if (/\b(markup|marked|redline|annotat|comment|screenshot)\b/.test(fileName)) {
		return 'marked_up_screenshot';
	}
	if (/\b(site|photo|install|existing)\b/.test(fileName)) {
		return 'site_photo';
	}
	if (/\b(draw|drawing|plan|elev|section|detail)\b/.test(fileName)) {
		return 'scope_drawing';
	}
	if (artifact.kind === 'cad' && fileName.endsWith('.dxf')) {
		return 'scope_drawing';
	}
	if (artifact.kind === 'cad') return 'cad_model';
	if (artifact.kind === 'image') return 'reference_image';
	if (artifact.kind === 'text') return 'plain_text_note';
	return 'unknown';
}

function inferExtractionMode(
	artifact: AiPreparedArtifact
): AiArtifactManifestEntry['extractionMode'] {
	switch (artifact.kind) {
		case 'text':
			return 'text_only';
		case 'pdf':
			if (artifact.inlineData && artifact.textContent.trim().length > 0) {
				return 'native_document_with_text';
			}
			return artifact.inlineData ? 'native_document' : 'text_only';
		case 'image':
			return 'image';
		case 'cad':
			return artifact.renders.length > 0 ? 'cad_renders' : 'cad_metadata';
	}
}

function describeArtifactInclusion(
	artifact: AiPreparedArtifact,
	role: AiArtifactManifestEntry['aiRole']
): string {
	switch (role) {
		case 'scope_drawing':
			return 'Included as primary scope evidence for measured work and drawing context.';
		case 'specification':
			return 'Included as written scope and specification evidence.';
		case 'supplier_quote':
			return 'Included as supplier pricing and scope evidence.';
		case 'marked_up_screenshot':
			return 'Included as marked-up visual clarification from the estimator.';
		case 'site_photo':
			return 'Included as site condition evidence.';
		case 'reference_image':
			return 'Included as supporting visual reference.';
		case 'cad_model':
			return artifact.kind === 'cad' && artifact.renders.length === 0
				? 'Included as CAD metadata evidence because no drawable renders were available.'
				: 'Included as CAD geometry evidence through rendered views and metadata.';
		case 'plain_text_note':
			return 'Included as plain text asset context.';
		case 'unknown':
			return 'Included as general scope item evidence because it is attached to this scope item.';
	}
}

function buildIssue(
	code: string,
	message: string,
	severity: AiIssue['severity'],
	file?: AssetFile
): AiIssue {
	return {
		code,
		message,
		severity,
		fileId: file?.id ?? null,
		fileName: file?.original_name ?? null
	};
}

function inferMimeType(file: AssetFile, fallback = 'application/octet-stream'): string {
	if (file.mime_type?.trim()) return file.mime_type;

	const extension = file.original_name.split('.').pop()?.toLowerCase() ?? '';
	switch (extension) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'gif':
			return 'image/gif';
		case 'bmp':
			return 'image/bmp';
		case 'svg':
			return 'image/svg+xml';
		case 'pdf':
			return 'application/pdf';
		default:
			return fallback;
	}
}

function isLowSignalOperationalTextArtifact(file: Pick<AssetFile, 'original_name'>): boolean {
	const fileName = file.original_name.toLowerCase();
	if (/^readme(?:\.[a-z0-9]+)?$/.test(fileName)) {
		return true;
	}

	if (fileName.endsWith('.log')) {
		return true;
	}

	return /(^|[-_.])(app|system|runtime|debug|trace|server)?[-_.]?(config|settings)([-_.]|$)/.test(
		fileName
	);
}

export function classifyAiFailure(error: unknown): AiFailureKind {
	const message = error instanceof Error ? error.message : String(error ?? '');
	const prefixMatch = message.match(/ai_failure_kind=([a-z_]+);/i);
	const prefixedKind = prefixMatch?.[1];
	if (prefixedKind && AI_FAILURE_KINDS.includes(prefixedKind as AiFailureKind)) {
		return prefixedKind as AiFailureKind;
	}

	if (/foreign key|constraint failed/i.test(message)) return 'validation_error';
	if (/context (?:window|limit)|too many tokens|input .* too large/i.test(message)) {
		return 'context_limit';
	}
	if (/prepare|preprocess|raster|extract .*file|unsupported file/i.test(message)) {
		return 'preparation_error';
	}
	if (
		/selected .* (model|runtime) is no longer available|(?:model|runtime) is no longer available|model .*not found/i.test(
			message
		)
	) {
		return 'model_unavailable';
	}
	if (/cancel(?:lation)? .*timed out|did not stop after cancellation/i.test(message)) {
		return 'cancel_timeout';
	}
	if (/timeout|timed out|deadline/i.test(message)) return 'timeout';
	if (/structured json|schema|parse/i.test(message)) return 'schema_error';
	if (/no takeoff|blocked|empty response|no usable evidence/i.test(message)) {
		return 'blocked_or_empty';
	}
	if (/interrupt|connection closed|stream closed/i.test(message)) return 'interrupted';
	return 'native_runtime';
}

export function normaliseAiFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return message
		.trim()
		.replace(/^ai_failure_kind=[a-z_]+;\s*/i, '')
		.trim();
}

export function summariseAiFailureMessage(error: unknown, kind?: AiFailureKind | null): string {
	const message = normaliseAiFailureMessage(error);
	const resolvedKind = kind ?? classifyAiFailure(message);
	const lowerMessage = message.toLowerCase();

	if (
		resolvedKind === 'schema_error' ||
		(lowerMessage.startsWith('[') &&
			(lowerMessage.includes('"code": "invalid_value"') ||
				lowerMessage.includes('"code":"invalid_value"') ||
				lowerMessage.includes('providerexecutioncontext')))
	) {
		return 'AI finished, but Kwantflow could not validate part of the local result. Rerun AI or update the app before trying again.';
	}

	if (resolvedKind === 'timeout') {
		return 'AI took too long to finish this draft. You can rerun AI or keep estimating manually.';
	}

	if (resolvedKind === 'cancel_timeout') {
		return 'AI did not stop in time after cancellation was requested. Please try again.';
	}

	return message || 'AI drafting failed.';
}

export function isAiCancelledError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /^ai_failure_kind=cancelled;/i.test(message);
}

export const normaliseAiTableSnapshot = normaliseEstimateAiTableSnapshot;

export class AiPreprocessFailure extends Error {
	issues: AiIssue[];
	artifactManifest: ReturnType<typeof buildArtifactManifest>;
	progressDetail: AiRunProgressDetail;

	constructor(
		message: string,
		params: {
			issues: AiIssue[];
			artifactManifest: ReturnType<typeof buildArtifactManifest>;
			progressDetail: AiRunProgressDetail;
		}
	) {
		super(message);
		this.name = 'AiPreprocessFailure';
		this.issues = params.issues;
		this.artifactManifest = params.artifactManifest;
		this.progressDetail = params.progressDetail;
	}
}

function normaliseScopeIdentityPart(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeStrings(values: string[]): string[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const next = value.trim();
		if (!next || seen.has(next)) {
			return false;
		}
		seen.add(next);
		return true;
	});
}

function dedupeEvidenceRefs(refs: AiEvidenceRef[]): AiEvidenceRef[] {
	const seen = new Set<string>();
	return refs.filter((ref) => {
		const key = [
			ref.file_id ?? '',
			ref.file_name ?? '',
			ref.artifact_kind ?? '',
			String(ref.page_number ?? ''),
			ref.view_label ?? '',
			ref.evidence_identifier ?? '',
			JSON.stringify(ref.locator ?? null),
			ref.quote_path ?? '',
			ref.summary ?? ''
		].join('|');
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function mergeAiConfidence(
	left: AiDraftTakeoffItem['confidence'],
	right: AiDraftTakeoffItem['confidence']
): AiDraftTakeoffItem['confidence'] {
	return {
		overall: Math.min(left.overall, right.overall),
		extraction: Math.min(left.extraction, right.extraction),
		mapping: Math.min(left.mapping, right.mapping),
		quantity: Math.min(left.quantity, right.quantity)
	};
}

function takeoffMergeKey(item: AiDraftTakeoffItem): string {
	return [
		normaliseScopeIdentityPart(item.name),
		normaliseScopeIdentityPart(item.description),
		String(item.quantity),
		item.unit,
		item.cost_code_id ?? '',
		item.wbs_node_id ?? ''
	].join('|');
}

const AGGREGATE_TAKEOFF_UNITS = new Set([
	'min',
	'hr',
	'day',
	'shift',
	'week',
	'mm',
	'm',
	'm2',
	'm3',
	'L',
	'kg',
	't'
]);

function isAggregateTakeoffUnit(unit: string | null | undefined): boolean {
	return typeof unit === 'string' && AGGREGATE_TAKEOFF_UNITS.has(unit);
}

function shouldCollapseDuplicatedAggregateQuantity(
	item: AiDraftTakeoffItem,
	component: AiDraftTakeoffItem['cost_components'][number]
): boolean {
	if (!Number.isFinite(item.quantity) || !Number.isFinite(component.quantity)) return false;
	if (item.quantity <= 1 || component.quantity <= 1) return false;
	if (component.unit !== item.unit) return false;
	if (!isAggregateTakeoffUnit(item.unit)) return false;
	return Math.abs(component.quantity - item.quantity) < 0.000001;
}

export function buildDraftEvidenceCoverage(draft: AiDraftEstimate) {
	const components = draft.takeoff_items.flatMap((item) => item.cost_components);
	const hasEvidence = (refs: AiEvidenceRef[]) => refs.length > 0;
	const hasSpatialEvidence = (refs: AiEvidenceRef[]) =>
		refs.some((ref) => ref.locator && Object.keys(ref.locator).length > 0);

	return {
		takeoffItemCount: draft.takeoff_items.length,
		takeoffItemsWithEvidence: draft.takeoff_items.filter((item) => hasEvidence(item.evidence_refs))
			.length,
		takeoffItemsWithSpatialEvidence: draft.takeoff_items.filter((item) =>
			hasSpatialEvidence(item.evidence_refs)
		).length,
		costComponentCount: components.length,
		costComponentsWithEvidence: components.filter((component) =>
			hasEvidence(component.evidence_refs)
		).length,
		costComponentsWithSpatialEvidence: components.filter((component) =>
			hasSpatialEvidence(component.evidence_refs)
		).length
	};
}

export function normaliseDraftEstimateStructure(draft: AiDraftEstimate): AiDraftEstimate {
	const mergedItems: AiDraftTakeoffItem[] = [];

	for (const item of draft.takeoff_items) {
		const currentKey = takeoffMergeKey(item);
		const previous = mergedItems.at(-1);
		if (previous && takeoffMergeKey(previous) === currentKey) {
			previous.cost_components = [...previous.cost_components, ...item.cost_components].map(
				(component, index) => ({
					...component,
					sort_order: index
				})
			);
			previous.evidence_refs = dedupeEvidenceRefs([
				...previous.evidence_refs,
				...item.evidence_refs
			]);
			previous.open_questions = dedupeStrings([...previous.open_questions, ...item.open_questions]);
			previous.properties = {
				...previous.properties,
				...item.properties
			};
			previous.confidence = mergeAiConfidence(previous.confidence, item.confidence);
			continue;
		}

		mergedItems.push({
			...item,
			quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
			sort_order: mergedItems.length,
			cost_components: item.cost_components.map((component, index) => ({
				...component,
				quantity: shouldCollapseDuplicatedAggregateQuantity(item, component)
					? 1
					: component.quantity,
				sort_order: index
			})),
			evidence_refs: dedupeEvidenceRefs(item.evidence_refs),
			open_questions: dedupeStrings(item.open_questions)
		});
	}

	return {
		...draft,
		takeoff_items: mergedItems
	};
}

type PdfJsLike = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfJsModulePromise: Promise<PdfJsLike> | null = null;
let pdfWorker: Worker | null = null;
const PDF_RASTER_FALLBACK_MAX_LONGEST_EDGE = 1280;
const PDF_RASTER_TEXT_DENSITY_THRESHOLD = 300;
const PDF_RASTER_LOW_TEXT_CHAR_THRESHOLD = 160;

function selectPdfRasterPages(numPages: number, pageTextContents: string[]): number[] {
	if (numPages === 0) {
		return [];
	}
	if (numPages <= 2) {
		return Array.from({ length: numPages }, (_, i) => i + 1);
	}

	const required = new Set<number>();
	const orderedRequired: number[] = [];
	const addRequiredPage = (pageNumber: number) => {
		if (required.has(pageNumber)) return;
		required.add(pageNumber);
		orderedRequired.push(pageNumber);
	};

	// Score remaining pages by drawing density: low text = likely drawing = high score
	const scored = Array.from({ length: numPages - 2 }, (_, i) => i + 2).map((pageNum) => {
		const text = pageTextContents[pageNum - 1] ?? '';
		const chars = text.replace(/\s+/g, ' ').trim();
		const charCount = chars.length;
		const lineCount = Math.max(1, chars.split(/\n|[.;:]/).length);
		const textDensity = lineCount > 0 ? charCount / lineCount : 0;
		const score = 1 - Math.min(textDensity / PDF_RASTER_TEXT_DENSITY_THRESHOLD, 1);
		return { pageNum, score, charCount };
	});

	const firstPageTextLength = (pageTextContents[0] ?? '').replace(/\s+/g, ' ').trim().length;
	const lastPageTextLength = (pageTextContents[numPages - 1] ?? '')
		.replace(/\s+/g, ' ')
		.trim().length;
	if (firstPageTextLength < PDF_RASTER_LOW_TEXT_CHAR_THRESHOLD) addRequiredPage(1);
	if (lastPageTextLength < PDF_RASTER_LOW_TEXT_CHAR_THRESHOLD) addRequiredPage(numPages);

	scored.sort((a, b) => b.score - a.score || a.pageNum - b.pageNum);

	// Identify every drawing-heavy or scanned page before applying the preparation budget.
	for (const entry of scored) {
		if (entry.charCount < PDF_RASTER_LOW_TEXT_CHAR_THRESHOLD || entry.score > 0.65) {
			addRequiredPage(entry.pageNum);
		}
	}

	if (pageTextContents.every((text) => !text.trim())) {
		for (let i = 1; i <= numPages; i++) {
			addRequiredPage(i);
		}
	}

	return orderedRequired.sort((a, b) => a - b);
}

async function getPdfJsModule() {
	if (!pdfJsModulePromise) {
		pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsLike>;
	}
	return pdfJsModulePromise;
}

function ensurePdfWorker(pdfjs: PdfJsLike): void {
	if (!pdfjs.GlobalWorkerOptions) {
		return;
	}

	if (typeof Worker === 'undefined') {
		pdfjs.GlobalWorkerOptions.workerPort = null;
		return;
	}

	if (!pdfWorker) {
		pdfWorker = new PdfJsWorker();
	}
	pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
}

function clampPdfRasterDimensions(
	width: number,
	height: number
): { width: number; height: number } {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const longestEdge = Math.max(safeWidth, safeHeight);
	if (longestEdge <= PDF_RASTER_FALLBACK_MAX_LONGEST_EDGE) {
		return { width: safeWidth, height: safeHeight };
	}

	const scale = PDF_RASTER_FALLBACK_MAX_LONGEST_EDGE / longestEdge;
	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale))
	};
}

async function renderPdfRasterFallbackPage(
	page: {
		getViewport: (params: { scale: number }) => { width: number; height: number };
		render: (params: {
			canvasContext: CanvasRenderingContext2D;
			viewport: { width: number; height: number };
		}) => { promise: Promise<unknown> };
	},
	pageNumber: number
): Promise<{
	pageNumber: number;
	mimeType: string;
	inlineData: string;
} | null> {
	if (typeof document === 'undefined') {
		return null;
	}

	const baseViewport = page.getViewport({ scale: 1 });
	const { width, height } = clampPdfRasterDimensions(baseViewport.width, baseViewport.height);
	const scale = Math.min(
		width / Math.max(baseViewport.width, 1),
		height / Math.max(baseViewport.height, 1)
	);
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(viewport.width));
	canvas.height = Math.max(1, Math.round(viewport.height));
	const context = canvas.getContext('2d');
	if (!context) {
		return null;
	}

	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, canvas.width, canvas.height);
	await page.render({
		canvasContext: context,
		viewport
	}).promise;

	return {
		pageNumber,
		mimeType: 'image/jpeg',
		inlineData: canvas.toDataURL('image/jpeg', 0.6).replace(/^data:image\/jpeg;base64,/, '')
	};
}

async function renderPdfRasterPagesFromDocument(
	pdfDocument: {
		numPages: number;
		getPage: (pageNumber: number) => Promise<{
			getViewport?: (params: { scale: number }) => { width: number; height: number };
			render?: (params: {
				canvasContext: CanvasRenderingContext2D;
				viewport: { width: number; height: number };
			}) => { promise: Promise<unknown> };
		}>;
	},
	selectedPages: number[]
): Promise<{
	rasterPages: Array<{
		pageNumber: number;
		mimeType: string;
		inlineData: string;
	}>;
	failedPages: number[];
}> {
	const rasterPages: Array<{
		pageNumber: number;
		mimeType: string;
		inlineData: string;
	}> = [];
	const failedPages: number[] = [];

	for (const pageNumber of selectedPages) {
		try {
			const page = await pdfDocument.getPage(pageNumber);
			if (typeof page.getViewport !== 'function' || typeof page.render !== 'function') {
				failedPages.push(pageNumber);
				continue;
			}
			const rasterPage = await renderPdfRasterFallbackPage(
				page as Parameters<typeof renderPdfRasterFallbackPage>[0],
				pageNumber
			);
			if (rasterPage) {
				rasterPages.push(rasterPage);
			} else {
				failedPages.push(pageNumber);
			}
		} catch (error) {
			failedPages.push(pageNumber);
			log.warn('PDF raster preparation failed for AI drafting', {
				pageNumber,
				error
			});
		}
	}

	return { rasterPages, failedPages };
}

function buildPdfRasterFailureIssues(file: AssetFile, failedPages: number[]): AiIssue[] {
	return failedPages.map((pageNumber) =>
		buildIssue(
			'pdf_visual_page_failed',
			`PDF page ${pageNumber} required visual preparation, but its raster evidence could not be prepared.`,
			'error',
			file
		)
	);
}

function decodePdfLiteralString(raw: string): string {
	return raw
		.replace(/\\([nrtbf()\\])/g, (_match, token: string) => {
			switch (token) {
				case 'n':
					return '\n';
				case 'r':
					return '\r';
				case 't':
					return '\t';
				case 'b':
					return '\b';
				case 'f':
					return '\f';
				default:
					return token;
			}
		})
		.replace(/\\([0-7]{1,3})/g, (_match, octal: string) =>
			String.fromCharCode(Number.parseInt(octal, 8))
		);
}

function extractSimplePdfTextFallback(bytes: Uint8Array): string {
	const decoded = new TextDecoder('latin1').decode(bytes);
	const blocks = decoded.match(/BT[\s\S]*?ET/g) ?? [decoded];
	const collected: string[] = [];

	const appendLiteralStrings = (segment: string): void => {
		const literalRegex = /\((?:\\.|[^\\()])*\)/g;
		for (const match of segment.matchAll(literalRegex)) {
			const raw = match[0];
			const literal = decodePdfLiteralString(raw.slice(1, -1)).replace(/\s+/g, ' ').trim();
			if (literal.length > 0) {
				collected.push(literal);
			}
		}
	};

	for (const block of blocks) {
		for (const match of block.matchAll(/\[(.*?)\]\s*TJ/gs)) {
			appendLiteralStrings(match[1] ?? '');
		}
		for (const match of block.matchAll(/(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)\s*Tj/g)) {
			const token = match[1] ?? '';
			if (token.startsWith('(') && token.endsWith(')')) {
				appendLiteralStrings(token);
			}
		}
	}

	return collected.join(' ').replace(/\s+/g, ' ').trim();
}

async function readBinaryAssetFile(file: AssetFile): Promise<Uint8Array> {
	return readVaultFile(file.file_path);
}

async function tryReadPdfAssetFileViaTauri(file: AssetFile): Promise<PdfArtifactData | null> {
	if (!isTauri()) {
		return null;
	}

	try {
		const pages = await invoke<NativePdfPageTextResult[]>('extract_pdf_pages_text', {
			filePath: file.file_path
		});
		const pageCount = pages.reduce((maximum, page) => Math.max(maximum, page.pageNumber), 0);
		const pageTextContents = Array.from({ length: pageCount }, () => '');
		for (const page of pages) {
			if (page.pageNumber >= 1 && page.pageNumber <= pageCount) {
				pageTextContents[page.pageNumber - 1] = page.textContent.trim();
			}
		}
		return {
			pageCount,
			text: pageTextContents
				.map(
					(textContent, index) => `[Page ${index + 1}]\n${textContent || '[No extractable text]'}`
				)
				.join('\n\n')
				.trim(),
			inlineData: null,
			mimeType: inferMimeType(file, 'application/pdf'),
			issues: [],
			cacheHit: false,
			pageTextContents
		};
	} catch (error) {
		log.warn('Native PDF text extraction failed for AI drafting; falling back to PDF.js', {
			fileId: file.id,
			fileName: file.original_name,
			error
		});
		return null;
	}
}

async function tryRasterizePdfPagesViaTauri(
	file: AssetFile,
	pages: number[]
): Promise<Array<{ pageNumber: number; mimeType: string; inlineData: string }> | null> {
	if (!isTauri() || pages.length === 0) {
		return null;
	}

	try {
		const base64s = await invoke<string[]>('rasterize_pdf_pages', {
			filePath: file.file_path,
			pages
		});
		if (!Array.isArray(base64s) || base64s.length !== pages.length) {
			throw new Error('Invalid rasterization output length from native runtime');
		}
		return pages.map((pageNumber, i) => ({
			pageNumber,
			mimeType: 'image/jpeg',
			inlineData: base64s[i] as string
		}));
	} catch (error) {
		log.warn('Native PDF page rasterization failed; falling back to PDF.js', {
			fileId: file.id,
			fileName: file.original_name,
			error
		});
		return null;
	}
}

export async function readPdfAssetFile(file: AssetFile): Promise<PdfArtifactData> {
	const bytes = await readBinaryAssetFile(file);
	const sourceFingerprint = await hashFileBytes(bytes);
	const cachePath = getPreparedEvidenceCachePath(
		file.file_path,
		file.id,
		sourceFingerprint,
		'pdf.json'
	);
	const cached = await readPreparedEvidenceCacheText(cachePath);
	if (cached) {
		try {
			const parsed = JsonStringSchema.parse(cached) as PreparedPdfCacheEntry;
			if (parsed.version === 7 && parsed.kind === 'pdf' && parsed.filePath === file.file_path) {
				return {
					pageCount: parsed.pageCount,
					text: parsed.text,
					inlineData: parsed.inlineData,
					mimeType: parsed.mimeType,
					rasterPages: parsed.rasterPages,
					issues: parsed.issues,
					cacheHit: true
				};
			}
		} catch {
			// Ignore malformed cache entries and rebuild them.
		}
	}

	const nativeExtraction = await tryReadPdfAssetFileViaTauri(file);
	if (nativeExtraction) {
		let rasterPages: Array<{
			pageNumber: number;
			mimeType: string;
			inlineData: string;
		}> = [];
		const pagesToRasterize = selectPdfRasterPages(
			nativeExtraction.pageCount,
			nativeExtraction.pageTextContents ?? []
		);
		let rasterIssues: AiIssue[] = [];

		const nativeRaster = await tryRasterizePdfPagesViaTauri(file, pagesToRasterize);
		if (nativeRaster) {
			rasterPages = nativeRaster;
		} else {
			try {
				const pdfjs = await getPdfJsModule();
				ensurePdfWorker(pdfjs);
				const loadingTask = pdfjs.getDocument({
					data: new Uint8Array(bytes),
					useWasm: false
				});
				const pdfDocument = (await loadingTask.promise) as unknown as {
					numPages: number;
					getPage: (pageNumber: number) => Promise<{
						getViewport: (params: { scale: number }) => { width: number; height: number };
						render: (params: {
							canvasContext: CanvasRenderingContext2D;
							viewport: { width: number; height: number };
						}) => { promise: Promise<void> };
						getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
					}>;
				};
				const fallbackRaster = await renderPdfRasterPagesFromDocument(
					pdfDocument,
					pagesToRasterize
				);
				rasterPages = fallbackRaster.rasterPages;
				rasterIssues = buildPdfRasterFailureIssues(file, fallbackRaster.failedPages);
			} catch (error) {
				log.warn(
					'PDF page-image preparation failed for native PDF extraction; continuing with text evidence',
					{
						fileId: file.id,
						fileName: file.original_name,
						error
					}
				);
				rasterIssues = buildPdfRasterFailureIssues(file, pagesToRasterize);
			}
		}
		const result = {
			pageCount: nativeExtraction.pageCount,
			text: nativeExtraction.text,
			inlineData: nativeExtraction.inlineData ?? null,
			mimeType: nativeExtraction.mimeType ?? inferMimeType(file, 'application/pdf'),
			rasterPages,
			issues: [...(nativeExtraction.issues ?? []), ...rasterIssues],
			cacheHit: false
		} satisfies PdfArtifactData;
		await writePreparedEvidenceCacheText(
			cachePath,
			JSON.stringify({
				version: 7,
				kind: 'pdf',
				filePath: file.file_path,
				fileName: file.original_name,
				sourceFingerprint,
				preparedAt: new Date().toISOString(),
				pageCount: result.pageCount,
				text: result.text,
				inlineData: result.inlineData ?? null,
				mimeType: result.mimeType ?? inferMimeType(file, 'application/pdf'),
				rasterPages: result.rasterPages ?? [],
				issues: result.issues ?? []
			} satisfies PreparedPdfCacheEntry)
		);
		return result;
	}

	const pdfjs = await getPdfJsModule();
	ensurePdfWorker(pdfjs);
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		useWasm: false
	});
	const pdfDocument = (await loadingTask.promise) as unknown as {
		numPages: number;
		getPage: (pageNumber: number) => Promise<{
			getViewport: (params: { scale: number }) => { width: number; height: number };
			render: (params: {
				canvasContext: CanvasRenderingContext2D;
				viewport: { width: number; height: number };
			}) => { promise: Promise<void> };
			getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
		}>;
	};

	const pageTexts = Array.from({ length: pdfDocument.numPages }, () => '');
	const failedTextPages = new Set<number>();
	const issues: AiIssue[] = [];

	// Step 1: Extract text from all pages first
	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		const page = await pdfDocument.getPage(pageNumber);
		try {
			const textContent = await page.getTextContent();
			const pageText = textContent.items
				.map((item) => item.str ?? '')
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			pageTexts[pageNumber - 1] = pageText;
		} catch {
			failedTextPages.add(pageNumber);
			issues.push(
				buildIssue(
					'pdf_text_extraction_fallback',
					`PDF page ${pageNumber} could not be read as text locally, so AI drafting may have limited visibility into this page.`,
					'warning',
					file
				)
			);
		}
	}

	// Step 2: Select pages with drawings based on text density
	const selectedRasterPages = selectPdfRasterPages(pdfDocument.numPages, pageTexts);

	// Step 3: Render only the selected pages
	const rasterPreparation = await renderPdfRasterPagesFromDocument(
		pdfDocument,
		selectedRasterPages
	);
	const rasterPages = rasterPreparation.rasterPages;
	issues.push(...buildPdfRasterFailureIssues(file, rasterPreparation.failedPages));

	if (pageTexts.every((pageText) => !pageText.trim())) {
		const heuristicText = extractSimplePdfTextFallback(bytes);
		if (heuristicText.length > 0) {
			pageTexts[0] = heuristicText;
			failedTextPages.delete(1);
			if (pdfDocument.numPages === 1) {
				for (let index = issues.length - 1; index >= 0; index -= 1) {
					if (issues[index]?.code === 'pdf_text_extraction_fallback') {
						issues.splice(index, 1);
					}
				}
			}
		}
	}
	const result = {
		pageCount: pdfDocument.numPages,
		text: pageTexts
			.map((pageText, index) => {
				const pageNumber = index + 1;
				const terminalText = failedTextPages.has(pageNumber)
					? '[Text extraction failed]'
					: pageText || '[No extractable text]';
				return `[Page ${pageNumber}]\n${terminalText}`;
			})
			.join('\n\n'),
		inlineData: null,
		mimeType: inferMimeType(file, 'application/pdf'),
		rasterPages,
		issues,
		cacheHit: false
	} satisfies PdfArtifactData;

	await writePreparedEvidenceCacheText(
		cachePath,
		JSON.stringify({
			version: 7,
			kind: 'pdf',
			filePath: file.file_path,
			fileName: file.original_name,
			sourceFingerprint,
			preparedAt: new Date().toISOString(),
			pageCount: result.pageCount,
			text: result.text,
			inlineData: result.inlineData ?? null,
			mimeType: result.mimeType ?? inferMimeType(file, 'application/pdf'),
			rasterPages: result.rasterPages ?? [],
			issues: result.issues ?? []
		} satisfies PreparedPdfCacheEntry)
	);

	return result;
}

async function readCadAssetFile(file: AssetFile): Promise<CadArtifactData> {
	return buildEstimateAiCadEvidence(file);
}

async function readImageAssetFile(
	file: AssetFile
): Promise<EstimateAiImageArtifactData & { cacheHit?: boolean | null }> {
	return buildEstimateAiImageArtifactDetailed(file);
}

function serialiseEstimateForDiff(estimate: Estimate): Record<string, unknown> {
	return {
		scope_summary: estimate.scope_summary,
		notes: estimate.notes,
		classification_system_id: estimate.classification_system_id ?? null,
		wbs_root_node_id: estimate.wbs_root_node_id ?? null,
		takeoff_items: estimate.takeoff_items.map((item) => ({
			name: item.name,
			description: item.description,
			quantity: item.quantity,
			unit: item.unit,
			cost_code_id: item.cost_code_id ?? null,
			wbs_node_id: item.wbs_node_id ?? null,
			properties: item.properties,
			cost_components: item.cost_components.map((component) => ({
				category: component.category,
				source_type: component.source_type,
				source_id: component.source_id ?? null,
				name: component.name,
				description: component.description,
				quantity: component.quantity,
				unit: component.unit,
				unit_rate: component.unit_rate,
				formula: component.formula,
				metadata: component.metadata
			}))
		}))
	};
}

function collectDiffEvents(
	fieldPath: string,
	originalValue: unknown,
	nextValue: unknown,
	output: AiOverrideEvent[],
	runId: string,
	assetId: string
): void {
	if (JSON.stringify(originalValue) === JSON.stringify(nextValue)) {
		return;
	}

	const originalIsArray = Array.isArray(originalValue);
	const nextIsArray = Array.isArray(nextValue);
	if (originalIsArray && nextIsArray) {
		const maxLength = Math.max(originalValue.length, nextValue.length);
		for (let index = 0; index < maxLength; index += 1) {
			collectDiffEvents(
				`${fieldPath}[${index}]`,
				originalValue[index],
				nextValue[index],
				output,
				runId,
				assetId
			);
		}
		return;
	}

	const originalIsObject =
		originalValue !== null && typeof originalValue === 'object' && !Array.isArray(originalValue);
	const nextIsObject =
		nextValue !== null && typeof nextValue === 'object' && !Array.isArray(nextValue);
	if (originalIsObject && nextIsObject) {
		const keys = new Set([...Object.keys(originalValue), ...Object.keys(nextValue)]);
		for (const key of keys) {
			collectDiffEvents(
				fieldPath ? `${fieldPath}.${key}` : key,
				(originalValue as Record<string, unknown>)[key],
				(nextValue as Record<string, unknown>)[key],
				output,
				runId,
				assetId
			);
		}
		return;
	}

	output.push({
		id: crypto.randomUUID(),
		run_id: runId,
		asset_id: assetId,
		field_path: fieldPath,
		original_value_json: JSON.stringify(originalValue ?? null),
		final_value_json: JSON.stringify(nextValue ?? null),
		created_at: new Date().toISOString()
	});
}

export async function collectTextArtifacts(
	files: AssetFile[],
	reader: (file: AssetFile) => Promise<string>
): Promise<{ artifacts: LegacyDraftTextArtifact[]; issues: AiIssue[] }> {
	const artifacts: LegacyDraftTextArtifact[] = [];
	const issues: AiIssue[] = [];

	for (const file of files) {
		if (getFileCategory(file.file_path) !== 'text') {
			issues.push(
				buildIssue(
					'unsupported_file',
					`${file.original_name} is not supported by the legacy text-only AI helper.`,
					'warning',
					file
				)
			);
			continue;
		}

		try {
			const content = (await reader(file)).trim();
			if (!content) {
				issues.push(
					buildIssue(
						'empty_text_file',
						`${file.original_name} did not contain readable text for AI drafting.`,
						'warning',
						file
					)
				);
				continue;
			}

			artifacts.push({
				fileId: file.id,
				fileName: file.original_name,
				filePath: file.file_path,
				content
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown read error.';
			issues.push(
				buildIssue(
					'file_read_failed',
					`Kwantflow could not read ${file.original_name} for AI drafting: ${message}`,
					'error',
					file
				)
			);
		}
	}

	return { artifacts, issues };
}

export async function collectAssetArtifacts(
	files: AssetFile[],
	deps: ArtifactCollectorDeps
): Promise<{
	artifacts: AiPreparedArtifact[];
	issues: AiIssue[];
	preprocessProfile: PreparedDraftRun['preprocessProfile'];
}> {
	const artifacts: AiPreparedArtifact[] = [];
	const issues: AiIssue[] = [];
	const preprocessArtifacts: PreparedDraftRun['preprocessProfile']['artifacts'] = [];
	const startedAt = Date.now();

	for (const file of files) {
		const category = getEstimateAiPreparedArtifactKind(file.file_path, file.mime_type);
		const fileStartedAt = Date.now();
		const issueCountBefore = issues.length;
		let included = false;
		let preparedArtifact: AiPreparedArtifact | null = null;
		let cacheHit: boolean | null = null;

		try {
			switch (category) {
				case 'text': {
					await prepareAndIndexFileChunks(file);
					if (isLowSignalOperationalTextArtifact(file)) {
						const issue = buildIssue(
							'low_signal_file_skipped',
							`${file.original_name} was skipped for AI drafting because it appears to be operational context rather than estimating evidence.`,
							'warning',
							file
						);
						issues.push(issue);
						log.info('Skipped low-signal AI artifact evidence', {
							fileId: file.id,
							fileName: file.original_name,
							included: false,
							reason: issue.code
						});
						break;
					}

					const textArtifact = await deps.readText(file);
					const chunks =
						textArtifact.chunks && textArtifact.chunks.length > 0
							? textArtifact.chunks
							: [
									{
										textContent: textArtifact.textContent,
										structureHints: textArtifact.structureHints,
										isTruncated: textArtifact.isTruncated
									}
								];

					let hasContent = false;
					for (const [chunkIndex, chunk] of chunks.entries()) {
						const content = chunk.textContent.trim();
						if (!content) continue;
						hasContent = true;

						if (chunk.isTruncated) {
							issues.push(
								buildIssue(
									'text_file_truncated',
									`${file.original_name} exceeded a text preparation safety limit. The omitted content must be reviewed before this evidence is considered complete.`,
									'error',
									file
								)
							);
						}

						const chunkFileName =
							chunks.length > 1
								? `${file.original_name} (Part ${chunkIndex + 1} of ${chunks.length})`
								: file.original_name;

						const baseArtifact = buildBaseArtifact(file);
						const chunkHash = baseArtifact.contentHash
							? chunks.length > 1
								? `${baseArtifact.contentHash}-part-${chunkIndex + 1}`
								: baseArtifact.contentHash
							: null;

						artifacts.push({
							kind: 'text',
							...baseArtifact,
							fileName: chunkFileName,
							contentHash: chunkHash,
							sourceMetadata: {
								...(baseArtifact.sourceMetadata ?? {}),
								textChunk: { index: chunkIndex + 1, total: chunks.length }
							},
							textContent: content,
							sourceFormat: textArtifact.sourceFormat,
							structureHints: chunk.structureHints ?? textArtifact.structureHints
						});
					}

					if (!hasContent) {
						issues.push(
							buildIssue(
								'empty_text_file',
								`${file.original_name} did not contain readable text for AI drafting.`,
								'warning',
								file
							)
						);
						break;
					}

					preparedArtifact = artifacts.at(-1) ?? null;
					cacheHit = textArtifact.cacheHit;
					included = true;
					log.info('Prepared AI artifact evidence', {
						fileId: file.id,
						fileName: file.original_name,
						evidenceMode: 'text',
						cacheHit: textArtifact.cacheHit,
						included: true
					});
					break;
				}
				case 'pdf': {
					await prepareAndIndexFileChunks(file);
					const pdf = await deps.readPdf(file);
					issues.push(...(pdf.issues ?? []));
					const textContent = pdf.text.trim();
					const rasterPages = pdf.rasterPages ?? [];
					if (!textContent && rasterPages.length === 0) {
						const issue = buildIssue(
							'pdf_evidence_unavailable',
							`${file.original_name} did not contain readable PDF text or raster pages for AI drafting.`,
							'warning',
							file
						);
						issues.push(issue);
						cacheHit = pdf.cacheHit ?? null;
						log.warn('Skipped PDF AI artifact with no usable evidence', {
							fileId: file.id,
							fileName: file.original_name,
							cacheHit: pdf.cacheHit ?? null,
							included: false,
							reason: issue.code
						});
						break;
					}
					artifacts.push({
						kind: 'pdf',
						...buildBaseArtifact(file),
						pageCount: pdf.pageCount,
						textContent,
						inlineData: pdf.inlineData ?? null,
						mimeType: pdf.mimeType ?? inferMimeType(file, 'application/pdf'),
						rasterPages
					});
					preparedArtifact = artifacts.at(-1) ?? null;
					cacheHit = pdf.cacheHit ?? null;
					included = true;
					log.info('Prepared AI artifact evidence', {
						fileId: file.id,
						fileName: file.original_name,
						evidenceMode: textContent.length > 0 ? 'native_document_with_text' : 'native_document',
						cacheHit: pdf.cacheHit ?? null,
						included: true
					});
					break;
				}
				case 'image': {
					const image = await deps.readImage(file);
					if (image.pages && image.pages.length > 0) {
						const baseArtifact = buildBaseArtifact(file);
						for (const page of image.pages) {
							artifacts.push({
								kind: 'image',
								...baseArtifact,
								fileName:
									image.pages.length > 1
										? `${file.original_name} (Page ${page.pageNumber} of ${image.pages.length})`
										: file.original_name,
								sourceMetadata: {
									...(baseArtifact.sourceMetadata ?? {}),
									imagePage: { pageNumber: page.pageNumber, total: image.pages.length }
								},
								mimeType: page.mimeType,
								inlineData: page.inlineData,
								imageQualitySignals: page.qualitySignals
							});
						}
						preparedArtifact = artifacts.at(-1) ?? null;
						cacheHit = image.cacheHit ?? null;
						included = true;
						log.info('Prepared paged visual evidence image', {
							fileId: file.id,
							fileName: file.original_name,
							pageCount: image.pages.length,
							included: true
						});
						break;
					}
					const isLargeDrawing =
						image.qualitySignals &&
						((image.qualitySignals.sourceWidth ?? 0) > 1600 ||
							(image.qualitySignals.sourceHeight ?? 0) > 1600);

					if (isLargeDrawing) {
						try {
							const byteString = atob(image.inlineData);
							const ab = new ArrayBuffer(byteString.length);
							const ia = new Uint8Array(ab);
							for (let i = 0; i < byteString.length; i++) {
								ia[i] = byteString.charCodeAt(i);
							}
							const blob = new Blob([ab], { type: image.mimeType });
							const tiles = await tileImageWithGridCoordinates(blob, { drawOverlay: false });

							for (const tile of tiles) {
								artifacts.push({
									kind: 'image',
									...buildBaseArtifact(file),
									fileName: `${file.original_name} [${tile.displayName}]`,
									mimeType: 'image/jpeg',
									inlineData: tile.inlineData,
									sourceMetadata: {
										tileGrid: {
											colIndex: tile.colIndex,
											rowIndex: tile.rowIndex,
											displayName: tile.displayName,
											x: tile.x,
											y: tile.y,
											width: tile.width,
											height: tile.height
										}
									}
								});
							}
							preparedArtifact = artifacts.at(-1) ?? null;
							cacheHit = image.cacheHit ?? null;
							included = true;
							log.info('Prepared tiled visual evidence image', {
								fileId: file.id,
								fileName: file.original_name,
								tileCount: tiles.length,
								included: true
							});
							break;
						} catch (tileErr) {
							log.error('Failed to tile large visual evidence image', tileErr);
							// Fallback to untiled image below
						}
					}

					const imageIssue = image.qualitySignals?.isLikelyBlank
						? buildIssue(
								'raster_low_signal',
								`${file.original_name} was prepared as an image, but the raster appears blank or very low contrast.`,
								'warning',
								file
							)
						: null;
					if (imageIssue) issues.push(imageIssue);
					artifacts.push({
						kind: 'image',
						...buildBaseArtifact(file),
						mimeType: image.mimeType,
						inlineData: image.inlineData,
						imageQualitySignals: image.qualitySignals
					});
					preparedArtifact = artifacts.at(-1) ?? null;
					cacheHit = image.cacheHit ?? null;
					included = true;
					log.info('Prepared AI artifact evidence', {
						fileId: file.id,
						fileName: file.original_name,
						evidenceMode: 'image',
						cacheHit: image.cacheHit ?? null,
						included: true
					});
					break;
				}
				case 'cad': {
					const cad = await deps.readCad(file);
					artifacts.push({
						kind: 'cad',
						...buildBaseArtifact(file),
						metadata: cad.metadata,
						renders: cad.renders,
						summaryText: cad.summaryText
					});
					preparedArtifact = artifacts.at(-1) ?? null;
					cacheHit = null;
					included = true;
					log.info('Prepared AI artifact evidence', {
						fileId: file.id,
						fileName: file.original_name,
						evidenceMode: cad.extractionMode,
						previewMode: cad.metadata.previewMode,
						renderCount: cad.renders.length,
						metadataOnlyReason: cad.metadata.reason,
						included: true
					});
					break;
				}
				default: {
					const issue = buildIssue(
						'unsupported_file',
						`${file.original_name} is not supported in the current AI drafting phase.`,
						'warning',
						file
					);
					issues.push(issue);
					log.warn('Skipped AI artifact evidence', {
						fileId: file.id,
						fileName: file.original_name,
						included: false,
						reason: issue.code
					});
					break;
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown read error.';
			const issueCode = isCadLoadError(error) ? error.code : 'file_read_failed';
			const issue = buildIssue(
				issueCode,
				`Kwantflow could not prepare ${file.original_name} for AI drafting: ${message}`,
				'error',
				file
			);
			issues.push(issue);
			log.warn('Failed to prepare AI artifact evidence', {
				fileId: file.id,
				fileName: file.original_name,
				included: false,
				reason: issueCode,
				error
			});
		}

		const newIssues = issues.slice(issueCountBefore);
		const fileName = file.original_name ?? file.file_path.split('/').pop() ?? file.id;
		const localSkipReason = included ? null : (newIssues[0]?.code ?? null);
		preprocessArtifacts.push({
			fileId: file.id,
			fileName,
			declaredCategory: category,
			included,
			cacheHit,
			artifactKind: preparedArtifact?.kind ?? null,
			extractionMode: preparedArtifact ? inferExtractionMode(preparedArtifact) : null,
			elapsedMs: Date.now() - fileStartedAt,
			renderCount: preparedArtifact?.kind === 'cad' ? preparedArtifact.metadata.renderCount : null,
			renderSize: preparedArtifact?.kind === 'cad' ? preparedArtifact.metadata.renderSize : null,
			viewLabels: preparedArtifact?.kind === 'cad' ? preparedArtifact.metadata.viewLabels : [],
			issueCodes: newIssues.map((issue) => issue.code),
			localSkipReason
		});
	}

	return {
		artifacts,
		issues,
		preprocessProfile: {
			totalElapsedMs: Date.now() - startedAt,
			artifacts: preprocessArtifacts
		}
	};
}

export function parseDraftEstimateResponse(raw: unknown): AiDraftEstimate {
	const parsed = AiDraftEstimateSchema.parse(normaliseDraftEstimatePayload(raw));
	return normaliseDraftEstimateStructure({
		scope_summary: parsed.scopeSummary,
		notes: parsed.notes,
		classification_system_id: parsed.classificationSystemId ?? null,
		wbs_root_node_id: parsed.wbsRootNodeId ?? null,
		applied_template_id: parsed.appliedTemplateId ?? null,
		applied_template_name: parsed.appliedTemplateName ?? null,
		takeoff_items: parsed.takeoffItems.map((item) => ({
			name: item.name,
			description: item.description,
			quantity: item.quantity,
			unit: item.unit,
			sort_order: item.sort_order,
			cost_code_id: item.cost_code_id ?? null,
			wbs_node_id: item.wbs_node_id ?? null,
			applied_preset_id: item.applied_preset_id ?? null,
			applied_preset_name: item.applied_preset_name ?? null,
			properties: item.properties,
			cost_components: item.cost_components,
			evidence_refs: item.evidence_refs,
			confidence: item.confidence,
			open_questions: item.open_questions
		})),
		issues: parsed.issues.map((issue) => ({
			code: issue.code,
			message: issue.message,
			severity: issue.severity,
			fileId: issue.fileId ?? null,
			fileName: issue.fileName ?? null
		}))
	});
}

function normaliseDraftEstimatePayload(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}

	const record = raw as Record<string, unknown>;
	return {
		scopeSummary: record.scopeSummary ?? record.scope_summary,
		notes: record.notes ?? '',
		classificationSystemId:
			record.classificationSystemId ?? record.classification_system_id ?? null,
		wbsRootNodeId: record.wbsRootNodeId ?? record.wbs_root_node_id ?? null,
		appliedTemplateId: record.appliedTemplateId ?? record.applied_template_id ?? null,
		appliedTemplateName: record.appliedTemplateName ?? record.applied_template_name ?? null,
		takeoffItems: normaliseDraftTakeoffItems(record.takeoffItems ?? record.takeoff_items),
		issues: normaliseDraftIssues(record.issues)
	};
}

function normaliseDraftIssues(raw: unknown): unknown[] {
	if (!Array.isArray(raw)) return [];

	return raw.map((entry, index) => {
		if (typeof entry === 'string') {
			return {
				code: 'local_model_issue',
				message: entry.trim(),
				severity: 'warning'
			};
		}

		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return {
				code: 'local_model_issue',
				message: `Kwantflow AI returned an unsupported issue entry at position ${index + 1}.`,
				severity: 'warning'
			};
		}

		const issue = entry as Record<string, unknown>;
		const message =
			typeof issue.message === 'string'
				? issue.message
				: typeof issue.detail === 'string'
					? issue.detail
					: typeof issue.summary === 'string'
						? issue.summary
						: `Kwantflow AI flagged a review item at position ${index + 1}.`;
		const code =
			typeof issue.code === 'string'
				? issue.code
				: typeof issue.kind === 'string'
					? issue.kind
					: 'local_model_issue';
		const severity = issue.severity;

		return {
			code,
			message,
			severity:
				severity === 'info' || severity === 'warning' || severity === 'error'
					? severity
					: 'warning',
			fileId:
				typeof issue.fileId === 'string'
					? issue.fileId
					: typeof issue.file_id === 'string'
						? issue.file_id
						: null,
			fileName:
				typeof issue.fileName === 'string'
					? issue.fileName
					: typeof issue.file_name === 'string'
						? issue.file_name
						: null
		};
	});
}

function defaultAiConfidence(): AiDraftTakeoffItem['confidence'] {
	return {
		overall: 0.2,
		extraction: 0.4,
		mapping: 0.1,
		quantity: 0.2
	};
}

function coerceDraftQuantity(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return 1;
}

function normaliseDraftTakeoffItems(raw: unknown): unknown[] {
	if (!Array.isArray(raw)) return [];

	return raw
		.filter(
			(entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
		)
		.map((item, index) => ({
			name:
				typeof item.name === 'string' && item.name.trim().length > 0
					? item.name
					: `Draft item ${index + 1}`,
			description: typeof item.description === 'string' ? item.description : '',
			quantity: coerceDraftQuantity(item.quantity),
			unit: normaliseUnitCode(item.unit) ?? 'ea',
			sort_order:
				typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
					? item.sort_order
					: index,
			cost_code_id:
				typeof item.cost_code_id === 'string'
					? item.cost_code_id
					: typeof item.costCodeId === 'string'
						? item.costCodeId
						: null,
			wbs_node_id:
				typeof item.wbs_node_id === 'string'
					? item.wbs_node_id
					: typeof item.wbsNodeId === 'string'
						? item.wbsNodeId
						: null,
			applied_preset_id:
				typeof item.applied_preset_id === 'string'
					? item.applied_preset_id
					: typeof item.appliedPresetId === 'string'
						? item.appliedPresetId
						: null,
			applied_preset_name:
				typeof item.applied_preset_name === 'string'
					? item.applied_preset_name
					: typeof item.appliedPresetName === 'string'
						? item.appliedPresetName
						: null,
			properties:
				item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties)
					? item.properties
					: {},
			cost_components: Array.isArray(item.cost_components)
				? item.cost_components
				: Array.isArray(item.costComponents)
					? item.costComponents
					: [],
			evidence_refs: Array.isArray(item.evidence_refs)
				? item.evidence_refs
				: Array.isArray(item.evidenceRefs)
					? item.evidenceRefs
					: [],
			confidence:
				item.confidence && typeof item.confidence === 'object' && !Array.isArray(item.confidence)
					? item.confidence
					: defaultAiConfidence(),
			open_questions: Array.isArray(item.open_questions)
				? item.open_questions
				: Array.isArray(item.openQuestions)
					? item.openQuestions
					: []
		}));
}

function formatManifestPageRange(pageNumbers: number[]): string | null {
	const pages = Array.from(new Set(pageNumbers.filter((page) => page > 0))).sort((a, b) => a - b);
	if (pages.length === 0) return null;
	if (pages.length === 1) return `${pages[0]}`;
	return `${pages[0]}-${pages.at(-1)}`;
}

function buildBaseArtifact(file: AssetFile) {
	return {
		fileId: file.id,
		fileName: file.original_name,
		filePath: file.file_path,
		byteSize: file.byte_size,
		contentHash: file.content_hash ?? null,
		checksumAlgorithm: file.checksum_algorithm,
		documentType: file.document_type,
		revisionLabel: file.revision_label,
		receivedAt: file.received_at ?? null,
		sourceLabel: file.source_label,
		sourceMetadata: file.source_metadata
	};
}

function buildEvidenceIdentifiers(artifact: AiPreparedArtifact): string[] {
	switch (artifact.kind) {
		case 'text':
			return [`text:${artifact.sourceFormat}:chunk:1`];
		case 'pdf': {
			const identifiers: string[] = [];
			const textPageRange = artifact.textContent.trim()
				? formatManifestPageRange(
						Array.from({ length: artifact.pageCount }, (_, index) => index + 1)
					)
				: null;
			if (textPageRange) identifiers.push(`pdf:text:pages:${textPageRange}`);
			for (const page of artifact.rasterPages) {
				identifiers.push(`pdf:raster:page:${page.pageNumber}`);
			}
			return identifiers;
		}
		case 'image':
			return ['image:raster:1'];
		case 'cad':
			return artifact.renders.length > 0
				? ['cad:metadata', ...artifact.renders.map((render) => `cad:render:${render.viewLabel}`)]
				: ['cad:metadata'];
	}
}

function buildEvidenceLocators(
	artifact: AiPreparedArtifact,
	evidenceIdentifiers: string[]
): AiArtifactManifestEntry['evidenceLocators'] {
	switch (artifact.kind) {
		case 'text':
			return evidenceIdentifiers.map((evidenceIdentifier) => ({
				evidenceIdentifier,
				kind: 'text_chunk',
				label: `${artifact.fileName} text chunk 1`,
				sourceFormat: artifact.sourceFormat
			}));
		case 'pdf': {
			const textRange = artifact.textContent.trim()
				? formatManifestPageRange(
						Array.from({ length: artifact.pageCount }, (_, index) => index + 1)
					)
				: null;
			return evidenceIdentifiers.map((evidenceIdentifier) => {
				const rasterPageMatch = evidenceIdentifier.match(/^pdf:raster:page:(\d+)$/);
				if (rasterPageMatch) {
					const pageNumber = Number.parseInt(rasterPageMatch[1] ?? '0', 10);
					return {
						evidenceIdentifier,
						kind: 'pdf_raster_page' as const,
						label: `${artifact.fileName} raster page ${pageNumber}`,
						pageNumber
					};
				}
				return {
					evidenceIdentifier,
					kind: 'pdf_text_pages' as const,
					label: `${artifact.fileName} extracted text pages ${textRange ?? 'unknown'}`,
					pageRange: textRange
				};
			});
		}
		case 'image':
			return evidenceIdentifiers.map((evidenceIdentifier) => ({
				evidenceIdentifier,
				kind: 'image_raster',
				label: `${artifact.fileName} normalised raster image 1`
			}));
		case 'cad':
			return evidenceIdentifiers.map((evidenceIdentifier) => {
				const renderMatch = evidenceIdentifier.match(/^cad:render:(.+)$/);
				if (renderMatch) {
					const viewLabel = renderMatch[1] ?? 'view';
					return {
						evidenceIdentifier,
						kind: 'cad_render' as const,
						label: `${artifact.fileName} CAD render ${viewLabel}`,
						viewLabel
					};
				}
				return {
					evidenceIdentifier,
					kind: 'cad_metadata' as const,
					label: `${artifact.fileName} CAD metadata summary`
				};
			});
	}
}

function buildQualitySignals(
	artifact: AiPreparedArtifact
): AiArtifactManifestEntry['qualitySignals'] {
	const structureHints = artifact.kind === 'text' ? artifact.structureHints : null;
	const hasRasterEvidence =
		artifact.kind === 'image' ||
		(artifact.kind === 'pdf' && artifact.rasterPages.length > 0) ||
		(artifact.kind === 'cad' && artifact.renders.length > 0);
	const rasterQuality = artifact.kind === 'image' ? artifact.imageQualitySignals : null;
	return {
		preparedEvidenceVersion: 'golden_v1',
		hasReadableText:
			artifact.kind === 'text' || artifact.kind === 'pdf'
				? artifact.textContent.trim().length > 0
				: artifact.kind === 'cad'
					? artifact.summaryText.trim().length > 0
					: false,
		hasRasterEvidence,
		hasStructuredTableHints: Boolean(
			(structureHints?.tableCount ?? 0) > 0 ||
			(structureHints?.rowCount ?? 0) > 0 ||
			(structureHints?.columnCount ?? 0) > 0
		),
		hasCadMetadata: artifact.kind === 'cad',
		isMetadataOnly: artifact.kind === 'cad' && artifact.renders.length === 0,
		pageCount: artifact.kind === 'pdf' ? artifact.pageCount : null,
		renderCount:
			artifact.kind === 'pdf'
				? artifact.rasterPages.length
				: artifact.kind === 'cad'
					? artifact.renders.length
					: null,
		characterCount:
			artifact.kind === 'text' || artifact.kind === 'pdf'
				? artifact.textContent.length
				: artifact.kind === 'cad'
					? artifact.summaryText.length
					: null,
		rowCount: structureHints?.rowCount ?? null,
		columnCount: structureHints?.columnCount ?? null,
		tableCount: structureHints?.tableCount ?? null,
		embeddedImageCount: structureHints?.embeddedImageCount ?? null,
		rasterSourceWidth: rasterQuality?.sourceWidth ?? null,
		rasterSourceHeight: rasterQuality?.sourceHeight ?? null,
		rasterOutputWidth: rasterQuality?.outputWidth ?? null,
		rasterOutputHeight: rasterQuality?.outputHeight ?? null,
		rasterResizeRatio: rasterQuality?.resizeRatio ?? null,
		rasterContrastScore: rasterQuality?.contrastScore ?? null,
		rasterLikelyBlank: rasterQuality?.isLikelyBlank ?? null
	};
}

export function buildArtifactManifest(artifacts: AiPreparedArtifact[]): AiArtifactManifestEntry[] {
	return artifacts.map((artifact) => {
		const aiRole = inferArtifactRole(artifact);
		const extractionMode = inferExtractionMode(artifact);
		const evidenceIdentifiers = buildEvidenceIdentifiers(artifact);
		const baseEntry = {
			fileId: artifact.fileId,
			fileName: artifact.fileName,
			filePath: artifact.filePath,
			byteSize: artifact.byteSize,
			contentHash: artifact.contentHash ?? null,
			checksumAlgorithm: artifact.checksumAlgorithm,
			documentType: artifact.documentType,
			revisionLabel: artifact.revisionLabel,
			receivedAt: artifact.receivedAt ?? null,
			sourceLabel: artifact.sourceLabel,
			sourceMetadata: artifact.sourceMetadata,
			artifactKind: artifact.kind,
			aiRole,
			inclusionReason: describeArtifactInclusion(artifact, aiRole),
			extractionMode,
			roleConfidence: aiRole === 'unknown' ? 'low' : 'medium',
			evidenceIdentifiers,
			evidenceLocators: buildEvidenceLocators(artifact, evidenceIdentifiers),
			qualitySignals: buildQualitySignals(artifact)
		} as const;
		switch (artifact.kind) {
			case 'text':
				return {
					...baseEntry,
					mimeType: 'text/plain',
					pageCount: null,
					renderCount: null,
					characterCount: artifact.textContent.length,
					sourceFormat: artifact.sourceFormat,
					structureHints: artifact.structureHints
				};
			case 'pdf':
				return {
					...baseEntry,
					mimeType: artifact.mimeType,
					pageCount: artifact.pageCount,
					renderCount: artifact.rasterPages.length,
					characterCount: artifact.textContent.length,
					sourceFormat: null,
					structureHints: null,
					roleConfidence:
						aiRole === 'scope_drawing' || aiRole === 'specification' ? 'high' : 'medium'
				};
			case 'image':
				return {
					...baseEntry,
					mimeType: artifact.mimeType,
					pageCount: null,
					renderCount: null,
					characterCount: null,
					sourceFormat: null,
					structureHints: null
				};
			case 'cad':
				return {
					...baseEntry,
					mimeType: null,
					pageCount: null,
					renderCount: artifact.renders.length,
					characterCount: null,
					sourceFormat: null,
					structureHints: null,
					roleConfidence: 'high'
				};
		}
	});
}

export function buildAiProjectContext(params: {
	projectId: string;
	projectName?: string | null;
	rfqNumber?: string | null;
	content?: string | null;
	note?: string | null;
	receivedDate?: string | null;
	submissionDeadlineAt?: string | null;
	estimatorName?: string | null;
	customerTenderReference?: string | null;
	addendumLabel?: string | null;
	addendumDate?: string | null;
	addendumNotes?: string | null;
	siteAddress?: string | null;
	deliveryAddress?: string | null;
}): AiProjectContext {
	const rfqBrief = buildStructuredRfqBrief(params.content);
	return {
		projectId: params.projectId,
		projectName: normaliseTextBlock(params.projectName),
		rfqNumber: normaliseTextBlock(params.rfqNumber),
		rfqBrief,
		estimatorNote: normaliseTextBlock(params.note),
		rfqContext: {
			receivedDate: normaliseTextBlock(params.receivedDate),
			submissionDeadlineAt: normaliseTextBlock(params.submissionDeadlineAt),
			estimatorName: normaliseTextBlock(params.estimatorName),
			customerTenderReference: normaliseTextBlock(params.customerTenderReference),
			addendumLabel: normaliseTextBlock(params.addendumLabel),
			addendumDate: normaliseTextBlock(params.addendumDate),
			addendumNotes: normaliseTextBlock(params.addendumNotes),
			siteAddress: normaliseTextBlock(params.siteAddress),
			deliveryAddress: normaliseTextBlock(params.deliveryAddress)
		},
		briefingSourceSummary: {
			hasRfqBrief: Boolean(rfqBrief.cleanedSourceText),
			hasEstimatorNote: Boolean(normaliseTextBlock(params.note))
		}
	};
}

function buildEstimateSeedContext(
	estimate: Estimate | null | undefined,
	contextSnapshot: AiEstimateContextSnapshot
): AiAssetContext['currentEstimateSeed'] | null {
	if (!estimate) return null;

	const scopeSummary = normaliseTextBlock(estimate.scope_summary);
	const notes = normaliseTextBlock(estimate.notes);
	return {
		scopeSummary: scopeSummary ? scopeSummary.slice(0, 80) : '',
		notes: notes ? notes.slice(0, 96) : '',
		classificationSystemId: estimate.classification_system_id ?? null,
		wbsRootNodeId: estimate.wbs_root_node_id ?? null,
		appliedTemplateId: estimate.applied_template_id ?? null,
		appliedTemplateName: estimate.applied_template_name ?? null,
		takeoffItemCount: estimate.takeoff_items.length,
		seededHeaderFields: contextSnapshot.current_estimate_state.seededHeaderFields,
		hasExistingStructure:
			estimate.takeoff_items.length > 0 ||
			Boolean(estimate.applied_template_id ?? estimate.applied_template_name)
	};
}

export function buildAiAssetContext(params: {
	assetId: string;
	assetName: string;
	currentEstimate: Estimate;
	savedEstimate?: Estimate | null;
	contextSnapshot: AiEstimateContextSnapshot;
}): AiAssetContext {
	return {
		assetId: params.assetId,
		assetName: params.assetName,
		currentEstimateSeed: buildEstimateSeedContext(
			params.currentEstimate,
			params.contextSnapshot
		) ?? {
			scopeSummary: '',
			notes: '',
			classificationSystemId: null,
			wbsRootNodeId: null,
			appliedTemplateId: null,
			appliedTemplateName: null,
			takeoffItemCount: 0,
			seededHeaderFields: [],
			hasExistingStructure: false
		},
		savedEstimateSeed: buildEstimateSeedContext(
			params.savedEstimate ?? null,
			params.contextSnapshot
		)
	};
}

export function buildAiReferenceContext(
	normalizedTableSnapshot: Record<string, unknown>,
	params?: {
		currentEstimate?: Estimate | null;
		savedEstimate?: Estimate | null;
	}
): AiReferenceContext {
	const referenceData = normalizedTableSnapshot as {
		classificationSystems?: Array<Record<string, unknown>>;
		costCodes?: Array<Record<string, unknown>>;
		wbsNodes?: Array<Record<string, unknown>>;
		materialCatalogItems?: Array<Record<string, unknown>>;
		labourRateCards?: Array<Record<string, unknown>>;
		equipmentRateCards?: Array<Record<string, unknown>>;
		subcontractRateCards?: Array<Record<string, unknown>>;
		costComponentPresets?: Array<Record<string, unknown>>;
		estimateTemplates?: Array<Record<string, unknown>>;
	};

	const pinnedIds = collectPinnedReferenceIds(params?.currentEstimate, params?.savedEstimate);
	const classificationSystems = selectActiveReferenceRecords(
		referenceData.classificationSystems ?? [],
		pinnedIds.classificationSystemIds
	);
	const costCodes = selectActiveReferenceRecords(
		referenceData.costCodes ?? [],
		pinnedIds.costCodeIds
	);
	const wbsNodes = referenceData.wbsNodes ?? [];
	const materials = selectActiveReferenceRecords(
		referenceData.materialCatalogItems ?? [],
		pinnedIds.materialSourceIds
	);
	const labourRates = selectActiveReferenceRecords(
		referenceData.labourRateCards ?? [],
		pinnedIds.labourSourceIds
	);
	const equipmentRates = selectActiveReferenceRecords(
		referenceData.equipmentRateCards ?? [],
		pinnedIds.equipmentSourceIds
	);
	const subcontractRates = selectActiveReferenceRecords(
		referenceData.subcontractRateCards ?? [],
		pinnedIds.subcontractSourceIds
	);
	const estimateTemplates = selectActiveReferenceRecords(
		referenceData.estimateTemplates ?? [],
		pinnedIds.templateIds
	);
	const costComponentPresets = selectActiveReferenceRecords(
		referenceData.costComponentPresets ?? [],
		pinnedIds.presetIds
	);

	return {
		mappingTargets: {
			classificationSystems: {
				howToUse:
					'Classification systems group the cost-code taxonomy for the estimate header. Choose one only when the asset evidence clearly points to a known commercial coding system; otherwise leave the estimate classification blank.',
				constraintLevel: 'hard_mapping',
				selectionBasis: classificationSystems.selectionBasis,
				totalAvailableCount: classificationSystems.records.length,
				records: classificationSystems.records
			},
			costCodes: {
				howToUse:
					'Cost codes classify takeoff items inside the selected classification system. Use them only for commercial categorisation of the scoped work item; they do not replace the item name, quantities, or priced cost rows.',
				constraintLevel: 'hard_mapping',
				selectionBasis: costCodes.selectionBasis,
				totalAvailableCount: costCodes.records.length,
				records: costCodes.records
			},
			wbsNodes: {
				howToUse:
					'Project structure roots and nodes anchor the estimate to the local work breakdown hierarchy. Use them only when the evidence clearly maps to an existing project structure path.',
				constraintLevel: 'hard_mapping',
				selectionBasis: 'all_active',
				totalAvailableCount: wbsNodes.length,
				records: wbsNodes
			}
		},
		catalogueSources: {
			materials: {
				howToUse:
					'Material catalogue rows are reusable priced material records. Link one when the evidence clearly identifies an existing material by code, name, alias, spec, or unit; otherwise keep a manual material row for review.',
				constraintLevel: 'auto_link_source',
				selectionBasis: materials.selectionBasis,
				totalAvailableCount: materials.records.length,
				records: materials.records
			}
		},
		rateSources: {
			labourRates: {
				howToUse:
					'Labour rates are reusable labour pricing records. Link one only when the evidence clearly matches an existing labour role, crew, alias, work-centre, or unit; otherwise keep a manual labour row for review.',
				constraintLevel: 'auto_link_source',
				selectionBasis: labourRates.selectionBasis,
				totalAvailableCount: labourRates.records.length,
				records: labourRates.records
			},
			equipmentRates: {
				howToUse:
					'Equipment rates are reusable plant and equipment pricing records. Link one when the evidence clearly matches an existing equipment type, alias, or hire basis; otherwise keep a manual equipment row for review.',
				constraintLevel: 'auto_link_source',
				selectionBasis: equipmentRates.selectionBasis,
				totalAvailableCount: equipmentRates.records.length,
				records: equipmentRates.records
			},
			subcontractRates: {
				howToUse:
					'Subcontract rates are reusable third-party trade or service pricing records. Link one when the evidence clearly matches an existing subcontract scope, alias, or rate basis; otherwise keep a manual subcontract row for review.',
				constraintLevel: 'auto_link_source',
				selectionBasis: subcontractRates.selectionBasis,
				totalAvailableCount: subcontractRates.records.length,
				records: subcontractRates.records
			}
		},
		draftingPatterns: {
			estimateTemplates: {
				howToUse:
					'Estimate templates are reusable estimate-level starting structures. Use one only when the asset scope clearly matches an existing template pattern, then keep extra evidence-driven rows and notes that the template does not already cover.',
				constraintLevel: 'structural_seed',
				selectionBasis: estimateTemplates.selectionBasis,
				totalAvailableCount: estimateTemplates.records.length,
				records: summarizeTemplateRecords(estimateTemplates.records)
			},
			costComponentPresets: {
				howToUse:
					'Cost presets are reusable takeoff-item row packs. Apply one per takeoff item when the scoped work clearly matches an existing install/fabrication package, then keep extra linked or manual rows that the preset does not already cover.',
				constraintLevel: 'structural_seed',
				selectionBasis: costComponentPresets.selectionBasis,
				totalAvailableCount: costComponentPresets.records.length,
				records: summarizePresetRecords(costComponentPresets.records)
			}
		}
	};
}

const MAX_AI_TEMPLATE_TAKEOFF_SUMMARIES = 3;
const MAX_AI_PRESET_COMPONENT_SUMMARIES = 4;
export const MAX_ASSET_FILES = 5;

function compactText(value: unknown, maxLength = 160): string | null {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) return null;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function readSummaryArray(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value)
		? value.filter(
				(entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
			)
		: [];
}

function summarizeTemplateRecords(
	records: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
	return records.map((record) => {
		const estimate =
			record.estimate && typeof record.estimate === 'object'
				? (record.estimate as Record<string, unknown>)
				: null;
		const takeoffItems = estimate ? readSummaryArray(estimate.takeoff_items) : [];

		return {
			id: record.id,
			code: record.code ?? null,
			name: record.name ?? null,
			description: compactText(record.description),
			aliases: Array.isArray(record.aliases) ? record.aliases : [],
			isActive: record.isActive !== false,
			scopeSummary: compactText(estimate?.scope_summary),
			takeoffItemCount: takeoffItems.length,
			takeoffItems: takeoffItems.slice(0, MAX_AI_TEMPLATE_TAKEOFF_SUMMARIES).map((item) => {
				const components = readSummaryArray(item.cost_components);
				return {
					name: item.name ?? null,
					description: compactText(item.description, 120),
					unit: item.unit ?? null,
					quantity: typeof item.quantity === 'number' ? item.quantity : (item.quantity ?? null),
					appliedPresetName: item.applied_preset_name ?? null,
					componentCategories: [
						...new Set(components.map((component) => component.category).filter(Boolean))
					],
					linkedSourceTypes: [
						...new Set(components.map((component) => component.source_type).filter(Boolean))
					]
				};
			})
		};
	});
}

function summarizePresetRecords(
	records: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
	return records.map((record) => {
		const components = readSummaryArray(record.components);

		return {
			id: record.id,
			code: record.code ?? null,
			name: record.name ?? null,
			description: compactText(record.description),
			aliases: Array.isArray(record.aliases) ? record.aliases : [],
			isActive: record.isActive !== false,
			componentCount: components.length,
			componentCategories: [
				...new Set(components.map((component) => component.category).filter(Boolean))
			],
			linkedSourceTypes: [
				...new Set(components.map((component) => component.source_type).filter(Boolean))
			],
			componentSummaries: components
				.slice(0, MAX_AI_PRESET_COMPONENT_SUMMARIES)
				.map((component) => ({
					category: component.category ?? null,
					name: component.name ?? null,
					description: compactText(component.description, 120),
					unit: component.unit ?? null,
					quantity:
						typeof component.quantity === 'number'
							? component.quantity
							: (component.quantity ?? null),
					sourceType: component.source_type ?? null
				}))
		};
	});
}

function selectActiveReferenceRecords<T extends Record<string, unknown>>(
	records: T[],
	pinnedIds: Set<string>
): {
	selectionBasis: AiReferenceSection['selectionBasis'];
	records: T[];
} {
	let includedPinnedInactive = false;
	const filtered = records.filter((record) => {
		const recordId = typeof record.id === 'string' ? record.id : null;
		const isPinned = recordId ? pinnedIds.has(recordId) : false;
		const isActive = record.isActive !== false;
		if (!isActive && isPinned) {
			includedPinnedInactive = true;
		}
		return isActive || isPinned;
	});
	return {
		selectionBasis: includedPinnedInactive ? 'all_active_plus_seeded_inactive' : 'all_active',
		records: filtered
	};
}

function collectPinnedReferenceIds(
	currentEstimate?: Estimate | null,
	savedEstimate?: Estimate | null
) {
	const templateIds = new Set<string>();
	const presetIds = new Set<string>();
	const costCodeIds = new Set<string>();
	const classificationSystemIds = new Set<string>();
	const materialSourceIds = new Set<string>();
	const labourSourceIds = new Set<string>();
	const equipmentSourceIds = new Set<string>();
	const subcontractSourceIds = new Set<string>();

	for (const estimate of [currentEstimate, savedEstimate]) {
		if (!estimate) continue;
		if (estimate.applied_template_id) {
			templateIds.add(estimate.applied_template_id);
		}
		if (estimate.classification_system_id) {
			classificationSystemIds.add(estimate.classification_system_id);
		}
		for (const item of estimate.takeoff_items) {
			if (item.applied_preset_id) {
				presetIds.add(item.applied_preset_id);
			}
			if (item.cost_code_id) {
				costCodeIds.add(item.cost_code_id);
			}
			for (const component of item.cost_components) {
				if (!component.source_id) continue;
				switch (component.source_type) {
					case 'material_catalog':
						materialSourceIds.add(component.source_id);
						break;
					case 'labour_rate_card':
						labourSourceIds.add(component.source_id);
						break;
					case 'equipment_rate_card':
						equipmentSourceIds.add(component.source_id);
						break;
					case 'subcontract_rate_card':
						subcontractSourceIds.add(component.source_id);
						break;
					default:
						break;
				}
			}
		}
	}

	return {
		templateIds,
		presetIds,
		classificationSystemIds,
		costCodeIds,
		materialSourceIds,
		labourSourceIds,
		equipmentSourceIds,
		subcontractSourceIds
	};
}

export function buildAiWorkflowRules(): AiWorkflowRules {
	return {
		precedence: [
			'current_estimate_seed',
			'asset_file_evidence',
			'rfq_brief',
			'estimator_note',
			'active_reference_matches',
			'drafting_patterns',
			'unresolved_when_ambiguous'
		],
		estimatorNotePriority: 'lower_than_asset_evidence',
		unresolvedStrategy: 'leave_unresolved',
		pricingStrategy: 'unique_exact_compatible_reference_match_only',
		nonGoals: [
			'Do not invent quantities.',
			'Do not invent catalogue or code mappings.',
			'Do not output commercial quote totals as business truth.',
			'Do not hide missing or weak rates behind commercially complete-looking rows.'
		]
	};
}

export function buildAiOutputContract(): AiOutputContract {
	return {
		returnShape: 'kwantflow_estimate_draft_v1',
		reviewExpectation: 'auto_apply_working_copy',
		requiredTopLevelFields: [
			'scope_summary',
			'notes',
			'classification_system_id',
			'wbs_root_node_id',
			'takeoff_items',
			'issues'
		],
		unresolvedHandling: 'surface_in_issues_and_open_questions'
	};
}

export function buildArtifactExtractionPrompt(
	params: {
		projectContext: AiProjectContext;
		assetContext: AiAssetContext;
		artifact: AiPreparedArtifact;
		manifestEntry: AiArtifactManifestEntry;
	},
	promptContract: AiPromptContract
): string {
	return buildSharedArtifactExtractionPrompt(
		{
			projectContext: {
				projectName: null,
				rfqNumber: null,
				rfqBrief: null,
				estimatorNote: null,
				rfqContext: null
			},
			assetContext: { assetName: '' },
			artifactContext: {
				...params.manifestEntry,
				fileName: params.artifact.fileName
			}
		},
		promptContract
	);
}

export function buildAiSystemInstruction(
	promptContract: AiPromptContract,
	stage: 'extraction' | 'draft'
): string {
	return buildSharedAiSystemInstruction(promptContract, stage);
}

export function buildDraftPromptFromExtractions(
	params: Pick<
		StartDraftRunRequest,
		| 'projectContext'
		| 'assetContext'
		| 'referenceContext'
		| 'workflowRules'
		| 'outputContract'
		| 'estimateContextSnapshot'
		| 'promptContract'
	> & {
		workspaceKnowledgeContext?: StartDraftRunRequest['workspaceKnowledgeContext'];
	},
	extractions: AiArtifactExtraction[]
): string {
	return buildSharedDraftPromptFromExtractions(params, extractions);
}

export function buildDraftOutlinePromptFromExtractions(
	params: Pick<
		StartDraftRunRequest,
		| 'projectContext'
		| 'assetContext'
		| 'referenceContext'
		| 'workflowRules'
		| 'outputContract'
		| 'estimateContextSnapshot'
		| 'promptContract'
	> & {
		workspaceKnowledgeContext?: StartDraftRunRequest['workspaceKnowledgeContext'];
	},
	extractions: AiArtifactExtraction[]
): string {
	return buildSharedDraftOutlinePromptFromExtractions(params, extractions);
}

export function buildDraftOutlineFallbackPromptFromExtractions(
	params: Pick<
		StartDraftRunRequest,
		| 'projectContext'
		| 'assetContext'
		| 'referenceContext'
		| 'workflowRules'
		| 'outputContract'
		| 'estimateContextSnapshot'
		| 'promptContract'
	> & {
		workspaceKnowledgeContext?: StartDraftRunRequest['workspaceKnowledgeContext'];
	},
	extractions: AiArtifactExtraction[]
): string {
	return buildSharedDraftOutlineFallbackPromptFromExtractions(params, extractions);
}

function extractReferenceKeywords(text: string): string[] {
	if (!text?.trim()) return [];
	const STOP_WORDS = new Set([
		'is',
		'in',
		'to',
		'of',
		'the',
		'and',
		'or',
		'for',
		'per',
		'with',
		'from',
		'by',
		'at',
		'an',
		'a',
		'as',
		'be',
		'on',
		'no',
		'each',
		'all',
		'including',
		'includes',
		'include',
		'included',
		'excludes',
		'exclude',
		'excluded',
		'not',
		'will',
		'shall',
		'must',
		'may',
		'can',
		'etc',
		'item',
		'items',
		'type',
		'types',
		'part',
		'parts',
		'refer',
		'ref',
		'see',
		'note',
		'notes',
		'provide',
		'supply',
		'install',
		'complete',
		'fabricate',
		'fabrication',
		'general',
		'standard',
		'specification',
		'per',
		'any',
		'all',
		'both',
		'shall',
		'will',
		'must',
		'may',
		'per',
		'each',
		'not',
		'no',
		'none',
		'this',
		'that',
		'these',
		'those',
		'there',
		'their',
		'they',
		'them'
	]);
	return (
		text
			.toLowerCase()
			// eslint-disable-next-line no-useless-escape
			.split(/[\s,;:.!?()\[\]{}"'\/\\|]+/)
			.filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
			.filter((word, i, arr) => arr.indexOf(word) === i)
	);
}

function recordMatchesKeywords(record: Record<string, unknown>, keywords: string[]): boolean {
	// Search every string value on the record — code, name, aliases, category,
	// specification, description, work_center, unit, etc.
	const stringValues: string[] = [];
	for (const val of Object.values(record)) {
		if (typeof val === 'string') {
			stringValues.push(val.toLowerCase());
		} else if (Array.isArray(val)) {
			for (const entry of val) {
				if (typeof entry === 'string') stringValues.push(entry.toLowerCase());
			}
		}
	}

	return keywords.some((keyword) =>
		stringValues.some((sv) => sv === keyword || sv.includes(keyword))
	);
}

/**
 * Filter the reference context to only include records that match keywords
 * extracted from the outline's takeoff items and scope summary.
 * This keeps the matching prompt lean by excluding irrelevant records.
 * Falls back to the full context if no keywords or no matches.
 */
export function filterReferenceContextByOutline(
	outline: Record<string, unknown>,
	refContext: AiReferenceContext
): AiReferenceContext {
	const outlineData = outline as {
		scope_summary?: string;
		takeoff_items?: Array<{ name?: string; description?: string }>;
	};

	const keywords = new Set<string>();

	if (outlineData.scope_summary) {
		for (const kw of extractReferenceKeywords(outlineData.scope_summary)) {
			keywords.add(kw);
		}
	}

	for (const item of outlineData.takeoff_items ?? []) {
		if (item.name) for (const kw of extractReferenceKeywords(item.name)) keywords.add(kw);
		if (item.description)
			for (const kw of extractReferenceKeywords(item.description)) keywords.add(kw);
	}

	if (keywords.size === 0) return refContext;

	const kwArray = Array.from(keywords);

	// Handle both nested AiReferenceContext shape and flat test/caller shape
	if (
		!refContext.mappingTargets?.classificationSystems?.records &&
		!refContext.catalogueSources?.materials?.records
	) {
		// Flat shape — return unfiltered, the caller is using the old format
		return refContext;
	}

	function filterSection(section: AiReferenceSection): AiReferenceSection {
		const matched = section.records.filter((r) => recordMatchesKeywords(r, kwArray));
		if (matched.length > 0) {
			return { ...section, records: matched, totalAvailableCount: matched.length };
		}
		// No matches — keep first 3 as a fallback so the model has options
		return { ...section, records: section.records.slice(0, 3), totalAvailableCount: 3 };
	}

	// 2.5d: When outline has 10+ items, compact records to only essential fields
	const outlineItems = (outline as { takeoff_items?: Array<unknown> }).takeoff_items;
	const shouldCompact = !!outlineItems && outlineItems.length >= 10;

	function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
		const essential: Record<string, unknown> = {
			id: record.id,
			code: record.code,
			name: record.name,
			unit: record.unit
		};
		if (record.default_rate !== undefined) essential.default_rate = record.default_rate;
		if (record.category !== undefined) essential.category = record.category;
		if (record.work_center !== undefined) essential.work_center = record.work_center;
		if (record.classification_system_id !== undefined)
			essential.classification_system_id = record.classification_system_id;
		return essential;
	}

	function compactSection(section: AiReferenceSection): AiReferenceSection {
		if (!shouldCompact) return section;
		return { ...section, records: section.records.map(compactRecord) };
	}

	return {
		mappingTargets: {
			classificationSystems: compactSection(
				filterSection(refContext.mappingTargets.classificationSystems)
			),
			costCodes: compactSection(filterSection(refContext.mappingTargets.costCodes)),
			wbsNodes: compactSection(filterSection(refContext.mappingTargets.wbsNodes))
		},
		catalogueSources: {
			materials: compactSection(filterSection(refContext.catalogueSources.materials))
		},
		rateSources: {
			labourRates: compactSection(filterSection(refContext.rateSources.labourRates)),
			equipmentRates: compactSection(filterSection(refContext.rateSources.equipmentRates)),
			subcontractRates: compactSection(filterSection(refContext.rateSources.subcontractRates))
		},
		draftingPatterns: {
			estimateTemplates: compactSection(
				filterSection(refContext.draftingPatterns.estimateTemplates)
			),
			costComponentPresets: compactSection(
				filterSection(refContext.draftingPatterns.costComponentPresets)
			)
		}
	};
}

export function buildDraftMatchingPrompt(
	params: Pick<
		StartDraftRunRequest,
		| 'projectContext'
		| 'assetContext'
		| 'referenceContext'
		| 'workflowRules'
		| 'outputContract'
		| 'estimateContextSnapshot'
		| 'promptContract'
	> & {
		workspaceKnowledgeContext?: StartDraftRunRequest['workspaceKnowledgeContext'];
	},
	outline: Record<string, unknown>
): string {
	return buildSharedDraftMatchingPrompt(params, outline);
}

export function buildDraftCompositionPrompt(
	params: Pick<
		StartDraftRunRequest,
		| 'projectContext'
		| 'assetContext'
		| 'referenceContext'
		| 'workflowRules'
		| 'outputContract'
		| 'estimateContextSnapshot'
		| 'promptContract'
	> & {
		workspaceKnowledgeContext?: StartDraftRunRequest['workspaceKnowledgeContext'];
	},
	outline: Record<string, unknown>,
	matching: Record<string, unknown>
): string {
	return buildSharedDraftCompositionPrompt(params, outline, matching);
}

export function validateDraftEstimateRefs(
	draft: AiDraftEstimate,
	context: AiDraftValidationContext
): { draft: AiDraftEstimate; issues: AiIssue[] } {
	const tableSnapshot = {
		classificationSystems: [...context.classificationSystemIds].map((id) => ({ id })),
		wbsNodes: [...context.wbsNodeIds].map((id) => ({ id })),
		costCodes: [...context.costCodeIds].map((id) => ({ id })),
		materialCatalogItems: [...context.materialSourceIds].map((id) => ({ id })),
		labourRateCards: [...context.labourSourceIds].map((id) => ({ id })),
		equipmentRateCards: [...context.equipmentSourceIds].map((id) => ({ id })),
		subcontractRateCards: [...context.subcontractSourceIds].map((id) => ({ id })),
		costComponentPresets: [...(context.presetIds ?? new Set<string>())].map((id) => ({ id })),
		estimateTemplates: [...(context.templateIds ?? new Set<string>())].map((id) => ({ id }))
	};
	const contextSnapshot = buildAiEstimateContextSnapshot({
		assetId: 'validation-only',
		assetName: 'Validation only',
		projectName: null,
		tableSnapshot,
		currentEstimate: {
			asset_id: 'validation-only',
			scope_summary: '',
			notes: '',
			classification_system_id: null,
			wbs_root_node_id: null,
			applied_template_id: null,
			applied_template_name: null,
			takeoff_items: []
		}
	});
	const review = buildEstimateMappingReview({
		draft: normaliseDraftEstimateStructure(draft),
		contextSnapshot
	});

	return {
		draft: {
			...review.reconciledDraft,
			issues: review.issues
		},
		issues: review.issues
	};
}

export function buildAiOverrideEvents(params: {
	runId: string;
	assetId: string;
	baseline: Estimate;
	current: Estimate;
}): AiOverrideEvent[] {
	const output: AiOverrideEvent[] = [];
	collectDiffEvents(
		'',
		serialiseEstimateForDiff(params.baseline),
		serialiseEstimateForDiff(params.current),
		output,
		params.runId,
		params.assetId
	);
	return output;
}

export function buildEstimateApplySignature(estimate: Estimate): string {
	return JSON.stringify(serialiseEstimateForDiff(estimate));
}

export function draftEstimateToEstimate(assetId: string, draft: AiDraftEstimate): Estimate {
	return {
		asset_id: assetId,
		scope_summary: draft.scope_summary,
		notes: draft.notes,
		classification_system_id: draft.classification_system_id ?? null,
		wbs_root_node_id: draft.wbs_root_node_id ?? null,
		applied_template_id: draft.applied_template_id ?? null,
		applied_template_name: draft.applied_template_name ?? null,
		takeoff_items: draft.takeoff_items.map((item, itemIndex) => {
			const takeoffItemId = crypto.randomUUID();
			return {
				id: takeoffItemId,
				estimate_asset_id: assetId,
				parent_id: null,
				wbs_node_id: item.wbs_node_id ?? null,
				cost_code_id: item.cost_code_id ?? null,
				applied_preset_id: item.applied_preset_id ?? null,
				applied_preset_name: item.applied_preset_name ?? null,
				name: item.name,
				description: item.description,
				quantity: item.quantity,
				unit: item.unit,
				properties: {
					...item.properties,
					ai_confidence: item.confidence,
					ai_evidence_refs: item.evidence_refs,
					ai_open_questions: item.open_questions
				},
				sort_order: item.sort_order ?? itemIndex,
				cost_components: item.cost_components.map((component, componentIndex) => ({
					id: crypto.randomUUID(),
					takeoff_item_id: takeoffItemId,
					category: component.category,
					source_type: component.source_type,
					source_id: component.source_id ?? null,
					name: component.name,
					description: component.description,
					quantity: component.quantity,
					unit: component.unit,
					unit_rate: component.unit_rate,
					formula: component.formula,
					metadata: {
						...component.metadata,
						ai_confidence: component.confidence,
						ai_mapping_status: component.mapping_status,
						ai_evidence_refs: component.evidence_refs
					},
					sort_order: component.sort_order ?? componentIndex
				}))
			};
		})
	};
}

async function _readTextAssetFile(file: AssetFile): Promise<{
	textContent: string;
	cacheHit: boolean;
	sourceFormat: AiTextArtifactSourceFormat;
	structureHints: AiTextArtifactStructureHints | null;
}> {
	return readEstimateAiTextContentDetailed(file);
}

/**
 * Build a complete PreparedDraftRun from local files using real artifact collection.
 * Prepares a Kwantflow AI draft run — collects real artifacts,
 * builds manifests, and returns properly populated progress detail.
 */
export async function buildLocalPreparedRun(files: AssetFile[]): Promise<PreparedDraftRun> {
	const { artifacts, issues, preprocessProfile } = await collectAssetArtifacts(files, {
		readText: readEstimateAiTextContentDetailed,
		readPdf: readPdfAssetFile,
		readImage: readImageAssetFile,
		readCad: readCadAssetFile
	});

	return {
		artifacts,
		issues,
		artifactManifest: buildArtifactManifest(artifacts),
		preprocessProfile,
		progressDetail: {
			currentArtifactName: null,
			processedArtifactCount: artifacts.length,
			usableArtifactCount: artifacts.length,
			artifactIssueCount: issues.length,
			totalArtifactCount: artifacts.length,
			supportedArtifactCount: artifacts.length,
			unsupportedArtifactCount: 0,
			draftSubphase: null
		}
	};
}
