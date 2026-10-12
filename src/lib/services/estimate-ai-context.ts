import { getCostComponentUnitOptions, type UnitCode, UNIT_OPTIONS } from '$lib/constants/index.js';
import {
	buildReferenceSearchTerms,
	stripTrailingReferenceQuantityHint
} from '$lib/utils/reference-search.js';
import {
	hasMeaningfulReferenceIdentity,
	isLowSignalReferenceText,
	referenceIdentityQualityScore
} from '$lib/utils/reference-quality.js';
import type {
	AiDraftEstimate,
	AiDraftMatching,
	AiDraftTakeoffItem,
	AiEstimateContextSnapshot,
	AiIssue,
	CostComponentPreset,
	CostComponentCategory,
	CostComponentSourceType,
	Estimate,
	EstimateTemplate,
	EstimateMappingCandidate,
	EstimateMappingFieldReview,
	EstimateMappingReview,
	EstimateMappingReviewItem
} from '$lib/types/index.js';

export const ESTIMATE_AI_CONTEXT_VERSION = 'estimate-ai-context-v2';
export const ESTIMATE_MAPPING_CLEAR_VALUE = '__clear__';

type BuildAiEstimateContextSnapshotParams = {
	assetId: string;
	assetName: string;
	projectName?: string | null;
	tableSnapshot: Record<string, unknown>;
	currentEstimate: Estimate;
	savedEstimate?: Estimate | null;
};

type EstimateContextReferenceData = ReturnType<typeof normaliseAiTableSnapshot>;

type EstimateReferenceIndex = {
	classificationSystems: Map<
		string,
		{ id: string; name: string | null; code: string | null; aliases: string[] }
	>;
	costCodes: Map<
		string,
		{
			id: string;
			classificationSystemId: string | null;
			path: string;
			code: string | null;
			name: string | null;
		}
	>;
	wbsNodes: Map<string, { id: string; path: string; name: string | null; code: string | null }>;
	materialSources: Map<string, { id: string; label: string; unit: UnitCode | null }>;
	labourSources: Map<string, { id: string; label: string; unit: UnitCode | null }>;
	equipmentSources: Map<string, { id: string; label: string; unit: UnitCode | null }>;
	subcontractSources: Map<string, { id: string; label: string; unit: UnitCode | null }>;
};

type EstimateMappingOverrides = Record<string, string>;
type NormalizedSnapshot = ReturnType<typeof normaliseAiTableSnapshot>;
type MaterialSourceRecord = NormalizedSnapshot['materialCatalogItems'][number];
type LabourSourceRecord = NormalizedSnapshot['labourRateCards'][number];
type EquipmentSourceRecord = NormalizedSnapshot['equipmentRateCards'][number];
type SubcontractSourceRecord = NormalizedSnapshot['subcontractRateCards'][number];
type WorkspaceSourceRecord =
	MaterialSourceRecord | LabourSourceRecord | EquipmentSourceRecord | SubcontractSourceRecord;

type WorkspaceSourceCandidate = {
	record: WorkspaceSourceRecord;
	category: CostComponentCategory;
	sourceType: CostComponentSourceType;
};

type SourceParityResolution = {
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number];
	autoMatched: boolean;
	rejectedSource?: {
		id: string;
		type: CostComponentSourceType;
	};
	ambiguousSourceCount?: number;
};

type TakeoffSeedResolution = {
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number];
	score: number;
	exactIdentity: boolean;
	matchSignals: string[];
	candidateCount: number;
};

type SourceMatchResult = {
	score: number;
	matchSignals: string[];
	exactIdentity: boolean;
	hardUnitMismatch: boolean;
	crossCategory: boolean;
};

type NamedReferenceResolution = {
	autoMatched: boolean;
	exactIdentity: boolean;
	score: number;
	candidateCount: number;
	matchSignals: string[];
};

function normaliseString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normaliseNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function normaliseBoolean(value: unknown): boolean {
	return value === true || value === 1 || value === '1';
}

function normaliseActiveBoolean(value: unknown): boolean {
	return value == null ? true : normaliseBoolean(value);
}

function stableCompare(left: string | null, right: string | null): number {
	return (left ?? '').localeCompare(right ?? '', undefined, { sensitivity: 'base' });
}

function compareReferenceQuality(
	left: {
		code?: string | null;
		name?: string | null;
		description?: string | null;
		aliases?: string[];
	},
	right: {
		code?: string | null;
		name?: string | null;
		description?: string | null;
		aliases?: string[];
	}
): number {
	return referenceIdentityQualityScore(right) - referenceIdentityQualityScore(left);
}

function formatNodeLabel(code: string | null, name: string | null): string | null {
	if (code && name) return `${code} ${name}`;
	return code ?? name ?? null;
}

function readAliases(entry: Record<string, unknown>): string[] {
	if (Array.isArray(entry.aliases)) {
		return entry.aliases
			.map((value) => normaliseString(value))
			.filter((value): value is string => value !== null);
	}
	const metadata =
		entry.metadata && typeof entry.metadata === 'object'
			? (entry.metadata as Record<string, unknown>)
			: null;
	const aliases = metadata?.aliases;
	if (!Array.isArray(aliases)) return [];
	return aliases
		.map((value) => normaliseString(value))
		.filter((value): value is string => value !== null);
}

type PlainJsonValue =
	null | string | number | boolean | PlainJsonValue[] | { [key: string]: PlainJsonValue };

function toPlainJsonValue(
	value: unknown,
	seen = new WeakMap<object, PlainJsonValue>()
): PlainJsonValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}

	if (Array.isArray(value)) {
		if (seen.has(value)) return seen.get(value)!;
		const next: PlainJsonValue[] = [];
		seen.set(value, next);
		for (const entry of value) {
			next.push(toPlainJsonValue(entry, seen));
		}
		return next;
	}

	if (value && typeof value === 'object') {
		if (seen.has(value)) return seen.get(value)!;
		const next: Record<string, PlainJsonValue> = {};
		seen.set(value, next);
		for (const [key, entry] of Object.entries(value)) {
			if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
			if (typeof entry === 'bigint') {
				next[key] = entry.toString();
				continue;
			}
			next[key] = toPlainJsonValue(entry, seen);
		}
		return next;
	}

	return null;
}

function toPlainJsonRecord(value: unknown): Record<string, unknown> {
	const next = toPlainJsonValue(value);
	return next && typeof next === 'object' && !Array.isArray(next)
		? (next as Record<string, unknown>)
		: {};
}

function toPlainJsonArray(value: unknown): unknown[] {
	const next = toPlainJsonValue(value);
	return Array.isArray(next) ? next : [];
}

function createDefaultAiConfidence() {
	return {
		overall: 0.5,
		extraction: 0.5,
		mapping: 0.5,
		quantity: 0.5
	};
}

function buildHierarchyPaths(
	entries: Array<{
		id: string;
		parentId: string | null;
		code: string | null;
		name: string | null;
	}>
): Map<string, string> {
	const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
	const cache = new Map<string, string>();

	const visit = (id: string, trail = new Set<string>()): string => {
		const cached = cache.get(id);
		if (cached) return cached;
		const entry = byId.get(id);
		if (!entry) return id;
		const label = formatNodeLabel(entry.code, entry.name) ?? entry.id;
		if (!entry.parentId || trail.has(entry.parentId)) {
			cache.set(id, label);
			return label;
		}
		const nextTrail = new Set(trail);
		nextTrail.add(id);
		const path = `${visit(entry.parentId, nextTrail)} / ${label}`;
		cache.set(id, path);
		return path;
	};

	for (const entry of entries) {
		visit(entry.id);
	}

	return cache;
}

function dedupeIssues(issues: AiIssue[]): AiIssue[] {
	const seen = new Set<string>();
	const output: AiIssue[] = [];
	for (const issue of issues) {
		const key = [
			issue.code,
			issue.message,
			issue.fileId ?? '',
			issue.fileName ?? '',
			issue.severity
		].join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		output.push(issue);
	}
	return output;
}

function buildIssue(
	code: string,
	message: string,
	severity: AiIssue['severity'] = 'warning'
): AiIssue {
	return {
		code,
		message,
		severity,
		fileId: null,
		fileName: null
	};
}

function buildSourceLabel(entry: {
	code: string | null;
	name: string | null;
	category?: string | null;
	workCentre?: string | null;
	supplierName?: string | null;
}): string {
	const parts = [
		formatNodeLabel(entry.code, entry.name),
		entry.category ?? null,
		entry.workCentre ?? null,
		entry.supplierName ?? null
	].filter((part): part is string => Boolean(part && part.trim()));
	return parts.join(' · ');
}

function normaliseMatchText(value: string | null | undefined): string {
	const trimmed = value?.trim() ?? '';
	if (!trimmed) return '';
	return trimmed
		.toLowerCase()
		.replace(/\blabour\b/g, 'labor')
		.replace(/\bcatalogue\b/g, 'catalog')
		.replace(/\bmetres\b/g, 'meters')
		.replace(/\bmetre\b/g, 'meter')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function hasMeaningfulCostCodeIdentity(entry: {
	code?: string | null;
	name?: string | null;
	description?: string | null;
}): boolean {
	if (isLowSignalReferenceText(entry.code) || isLowSignalReferenceText(entry.name)) {
		return false;
	}
	const hasMeaningfulCode = Boolean(entry.code && normaliseMatchText(entry.code).length > 0);
	const hasMeaningfulName = Boolean(entry.name && !isLowSignalReferenceText(entry.name));
	const hasMeaningfulDescription = Boolean(
		entry.description && !isLowSignalReferenceText(entry.description)
	);
	return hasMeaningfulCode || hasMeaningfulName || hasMeaningfulDescription;
}

function buildMatchPhrases(component: { name: string; description: string }): string[] {
	const name = normaliseMatchText(component.name);
	return name ? [name] : [];
}

function buildMatchTokens(component: { name: string; description: string }): string[] {
	const stopWords = new Set([
		'and',
		'for',
		'the',
		'with',
		'from',
		'row',
		'item',
		'rate',
		'cost',
		'source',
		'manual'
	]);
	return [
		...new Set(
			buildReferenceSearchTerms(
				`${stripTrailingReferenceQuantityHint(component.name) || component.name} ${component.description}`
			).filter((token) => token.length >= 3 && !stopWords.has(token))
		)
	];
}

function sourceRecordAliases(record: WorkspaceSourceRecord): string[] {
	return 'aliases' in record ? record.aliases : [];
}

function buildWorkspaceSourceCandidates(
	referenceData: EstimateContextReferenceData,
	category?: CostComponentCategory
): WorkspaceSourceCandidate[] {
	const candidates: WorkspaceSourceCandidate[] = [
		...referenceData.materialCatalogItems.map((record) => ({
			record,
			category: 'material' as const,
			sourceType: 'material_catalog' as const
		})),
		...referenceData.labourRateCards.map((record) => ({
			record,
			category: 'labour' as const,
			sourceType: 'labour_rate_card' as const
		})),
		...referenceData.equipmentRateCards.map((record) => ({
			record,
			category: 'equipment' as const,
			sourceType: 'equipment_rate_card' as const
		})),
		...referenceData.subcontractRateCards.map((record) => ({
			record,
			category: 'subcontract' as const,
			sourceType: 'subcontract_rate_card' as const
		}))
	];

	return category ? candidates.filter((candidate) => candidate.category === category) : candidates;
}

function isGenericScaffoldUnit(unit: UnitCode | null): boolean {
	return unit === 'lot' || unit === 'job' || unit === 'fixed';
}

type UnitFamily =
	| 'generic_scaffold'
	| 'count'
	| 'time'
	| 'length'
	| 'area'
	| 'volume'
	| 'mass'
	| 'liquid'
	| 'packaging'
	| 'other';

function classifyUnitFamily(unit: UnitCode | null): UnitFamily | null {
	if (!unit) return null;
	if (isGenericScaffoldUnit(unit)) return 'generic_scaffold';
	switch (unit) {
		case 'ea':
		case 'set':
			return 'count';
		case 'min':
		case 'hr':
		case 'day':
		case 'shift':
		case 'week':
			return 'time';
		case 'mm':
		case 'm':
			return 'length';
		case 'm2':
			return 'area';
		case 'm3':
			return 'volume';
		case 'kg':
		case 't':
			return 'mass';
		case 'L':
			return 'liquid';
		case 'sheet':
		case 'pack':
		case 'box':
		case 'bag':
		case 'roll':
			return 'packaging';
		default:
			return 'other';
	}
}

function isCompatibleUnitFamilyMatch(
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	componentUnit: UnitCode | null,
	recordUnit: UnitCode | null
): boolean {
	const expectedSourceType = expectedLinkedSourceType(component.category);
	if (
		component.source_type !== 'manual' &&
		expectedSourceType &&
		component.source_type !== expectedSourceType
	) {
		return false;
	}

	const componentFamily = classifyUnitFamily(componentUnit);
	const recordFamily = classifyUnitFamily(recordUnit);

	if (!componentFamily || !recordFamily) return false;
	if (componentFamily === recordFamily) return true;
	if (componentFamily === 'generic_scaffold' || recordFamily === 'generic_scaffold') return true;

	const packagingFamilies = new Set<UnitFamily>(['count', 'packaging']);
	if (packagingFamilies.has(componentFamily) && packagingFamilies.has(recordFamily)) {
		return true;
	}

	if (
		(component.category === 'labour' || component.category === 'equipment') &&
		((componentFamily === 'count' && recordFamily === 'time') ||
			(componentFamily === 'time' && recordFamily === 'count') ||
			(componentFamily === 'packaging' && recordFamily === 'time') ||
			(componentFamily === 'time' && recordFamily === 'packaging'))
	) {
		return true;
	}

	return false;
}

function sourceRecordDescription(record: WorkspaceSourceRecord): string {
	if ('specification' in record) return record.specification ?? '';
	if ('workCentre' in record) return record.workCentre ?? '';
	if ('supplierName' in record) return record.supplierName ?? record.category ?? '';
	return '';
}

function expectedLinkedSourceType(category: CostComponentCategory): CostComponentSourceType | null {
	switch (category) {
		case 'material':
			return 'material_catalog';
		case 'labour':
			return 'labour_rate_card';
		case 'equipment':
			return 'equipment_rate_card';
		case 'subcontract':
			return 'subcontract_rate_card';
		case 'misc':
			return null;
	}
}

function candidateSourceRecords(
	referenceData: EstimateContextReferenceData,
	category: CostComponentCategory
): WorkspaceSourceRecord[] {
	return buildWorkspaceSourceCandidates(referenceData, category).map(
		(candidate) => candidate.record
	);
}

function buildSourceRecordParityPayload(record: WorkspaceSourceRecord): {
	name: string;
	description: string;
	unit: UnitCode | null;
	unitRate: number | null;
	metadata: Record<string, unknown>;
} {
	return {
		name: record.name ?? '',
		description: sourceRecordDescription(record),
		unit: record.unit ?? null,
		unitRate: record.defaultRate ?? null,
		metadata: {
			...(record.metadata ?? {})
		}
	};
}

function isUnitAllowedForCategory(unit: UnitCode, category: CostComponentCategory): boolean {
	return getCostComponentUnitOptions(category).some((option) => option.value === unit);
}

function buildTakeoffComponentSeed(
	item: AiDraftEstimate['takeoff_items'][number],
	category: CostComponentCategory
): AiDraftEstimate['takeoff_items'][number]['cost_components'][number] {
	const preferredUnit = isUnitAllowedForCategory(item.unit, category)
		? item.unit
		: (getCostComponentUnitOptions(category)[0]?.value ?? 'ea');
	return {
		category,
		source_type: expectedLinkedSourceType(category) ?? 'manual',
		source_id: null,
		name: item.name,
		description: item.description,
		quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
		unit: preferredUnit,
		unit_rate: 0,
		formula: {},
		metadata: {
			seeded_from_takeoff_item: true
		},
		sort_order: 0,
		evidence_refs: structuredClone(item.evidence_refs),
		confidence: {
			overall: Math.max(item.confidence.overall ?? 0.2, 0.35),
			extraction: Math.max(item.confidence.extraction ?? 0.2, 0.35),
			mapping: Math.max(item.confidence.mapping ?? 0.2, 0.7),
			quantity: Math.max(item.confidence.quantity ?? 0.2, 0.35)
		},
		mapping_status: 'unresolved'
	};
}

function seedLikelyTakeoffComponent(
	item: AiDraftEstimate['takeoff_items'][number],
	referenceData: EstimateContextReferenceData
): TakeoffSeedResolution | null {
	const itemIdentity = normaliseMatchText(item.name);
	if (itemIdentity.length < 4 || isLowSignalReferenceText(item.name)) {
		return null;
	}

	const candidates = buildWorkspaceSourceCandidates(referenceData);
	if (candidates.length === 0) {
		return null;
	}

	const scored = candidates
		.map((candidate) => {
			const scaffold = buildTakeoffComponentSeed(item, candidate.category);
			return {
				candidate,
				scaffold,
				match: scoreWorkspaceSourceMatch(scaffold, candidate)
			};
		})
		.filter((entry) => !entry.match.hardUnitMismatch)
		.sort((left, right) => right.match.score - left.match.score);

	const exactMatches = scored.filter((entry) => entry.match.exactIdentity);
	const best = exactMatches.length === 1 ? exactMatches[0] : null;
	if (!best) {
		return null;
	}

	return {
		component: applyWorkspaceSourceParity(best.scaffold, best.candidate, {
			strategy: 'exact_takeoff_seed_source_match',
			score: best.match.score,
			candidateCount: exactMatches.length,
			signals: best.match.matchSignals,
			seededFrom: 'takeoff_item'
		}),
		score: best.match.score,
		exactIdentity: best.match.exactIdentity,
		matchSignals: best.match.matchSignals,
		candidateCount: scored.length
	};
}

function scoreWorkspaceSourceMatch(
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	candidate: WorkspaceSourceCandidate
): SourceMatchResult {
	const exactValues = new Set(
		[
			candidate.record.code ?? '',
			candidate.record.name ?? '',
			...sourceRecordAliases(candidate.record)
		]
			.map((value) => normaliseMatchText(value))
			.filter((value) => value.length > 0)
	);
	const exactIdentity = buildMatchPhrases(component).some((phrase) => exactValues.has(phrase));
	const matchSignals = exactIdentity ? ['exact_name_code_or_alias'] : [];
	let hardUnitMismatch = false;
	if (component.unit === candidate.record.unit) {
		matchSignals.push('unit_match');
	} else if (component.unit && candidate.record.unit) {
		if (isCompatibleUnitFamilyMatch(component, component.unit, candidate.record.unit)) {
			matchSignals.push('compatible_unit_family');
		} else {
			hardUnitMismatch = true;
			matchSignals.push('unit_mismatch');
		}
	}
	const crossCategory = candidate.category !== component.category;
	matchSignals.push(crossCategory ? 'category_mismatch' : 'category_match');
	return {
		score: (exactIdentity ? 120 : 0) + (hardUnitMismatch || crossCategory ? 0 : 20),
		matchSignals,
		exactIdentity,
		hardUnitMismatch,
		crossCategory
	};
}

function applyWorkspaceSourceParity(
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	candidate: WorkspaceSourceCandidate,
	matchMetadata?: Record<string, unknown>
): AiDraftEstimate['takeoff_items'][number]['cost_components'][number] {
	const record = candidate.record;
	const parity = buildSourceRecordParityPayload(record);
	return {
		...component,
		category: candidate.category,
		source_type: candidate.sourceType,
		source_id: record.id,
		name: parity.name || component.name,
		description: parity.description,
		unit: parity.unit ?? component.unit,
		unit_rate: parity.unitRate ?? 0,
		metadata: {
			...component.metadata,
			...parity.metadata,
			...(matchMetadata ? { ai_match: matchMetadata } : {})
		},
		mapping_status: 'matched'
	};
}

function reconcileWorkspaceSourceParity(
	component: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	referenceData: EstimateContextReferenceData
): SourceParityResolution {
	if (
		component.source_type === 'manual' &&
		component.metadata &&
		typeof component.metadata === 'object' &&
		!Array.isArray(component.metadata) &&
		component.metadata.ai_linking_suppressed === true
	) {
		return { component, autoMatched: false };
	}

	const expectedSourceType = expectedLinkedSourceType(component.category);
	if (!expectedSourceType) {
		return { component, autoMatched: false };
	}

	const records = candidateSourceRecords(referenceData, component.category);
	if (records.length === 0) {
		return { component, autoMatched: false };
	}

	if (component.source_id) {
		const directCandidate = buildWorkspaceSourceCandidates(referenceData).find(
			(candidate) => candidate.record.id === component.source_id
		);
		const directMatch = directCandidate
			? scoreWorkspaceSourceMatch(component, directCandidate)
			: null;
		if (
			directCandidate &&
			directCandidate.category === component.category &&
			directMatch &&
			!directMatch.hardUnitMismatch
		) {
			return {
				component: applyWorkspaceSourceParity(component, directCandidate, {
					strategy: 'explicit_source_id'
				}),
				autoMatched: true
			};
		}
		return {
			component: {
				...component,
				source_type: 'manual',
				source_id: null,
				unit_rate: 0,
				mapping_status: 'unresolved'
			},
			autoMatched: false,
			rejectedSource: {
				id: component.source_id,
				type: component.source_type
			}
		};
	}

	const scored = buildWorkspaceSourceCandidates(referenceData, component.category)
		.map((candidate) => ({
			candidate,
			match: scoreWorkspaceSourceMatch(component, candidate)
		}))
		.filter((entry) => !entry.match.hardUnitMismatch)
		.sort((left, right) => right.match.score - left.match.score);

	const exactMatches = scored.filter((entry) => entry.match.exactIdentity);
	const best = exactMatches.length === 1 ? exactMatches[0] : null;
	if (!best) {
		if (exactMatches.length > 1) {
			return {
				component: {
					...component,
					source_type: 'manual',
					source_id: null,
					unit_rate: 0,
					mapping_status: 'unresolved'
				},
				autoMatched: false,
				ambiguousSourceCount: exactMatches.length
			};
		}
		return { component, autoMatched: false };
	}

	return {
		component: applyWorkspaceSourceParity(component, best.candidate, {
			strategy: 'exact_source_match',
			score: best.match.score,
			candidateCount: exactMatches.length,
			signals: best.match.matchSignals
		}),
		autoMatched: true
	};
}

function invalidSourceIssueCode(sourceType: CostComponentSourceType): string {
	switch (sourceType) {
		case 'material_catalog':
			return 'invalid_material_source';
		case 'labour_rate_card':
			return 'invalid_labour_source';
		case 'equipment_rate_card':
			return 'invalid_equipment_source';
		case 'subcontract_rate_card':
			return 'invalid_subcontract_source';
		case 'manual':
			return 'invalid_linked_source';
	}
}

function readArray(tableSnapshot: Record<string, unknown>, key: string): Record<string, unknown>[] {
	return Array.isArray(tableSnapshot[key])
		? (tableSnapshot[key] as unknown[]).filter(
				(entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object'
			)
		: [];
}

export function normaliseAiTableSnapshot(tableSnapshot: Record<string, unknown>) {
	const classificationSystemsRaw = readArray(tableSnapshot, 'classificationSystems')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			name: normaliseString(entry.name),
			code: normaliseString(entry.code),
			type: normaliseString(entry.type),
			aliases: readAliases(entry),
			isDefault: normaliseBoolean(entry.is_default),
			isActive: normaliseActiveBoolean(entry.is_active)
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry));

	const costCodesRaw = readArray(tableSnapshot, 'costCodes').map((entry) => ({
		id: normaliseString(entry.id) ?? '',
		classificationSystemId: normaliseString(entry.classification_system_id),
		parentId: normaliseString(entry.parent_id),
		code: normaliseString(entry.code),
		name: normaliseString(entry.name),
		description: normaliseString(entry.description),
		isActive: normaliseActiveBoolean(entry.is_active)
	}));
	const costCodePaths = buildHierarchyPaths(
		costCodesRaw.map((entry) => ({
			id: entry.id,
			parentId: entry.parentId,
			code: entry.code,
			name: entry.name
		}))
	);
	const costCodes = costCodesRaw
		.filter((entry) => entry.id.length > 0 && hasMeaningfulCostCodeIdentity(entry))
		.map((entry) => ({
			...entry,
			path: costCodePaths.get(entry.id) ?? (formatNodeLabel(entry.code, entry.name) || entry.id)
		}))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const wbsNodesRaw = readArray(tableSnapshot, 'wbsNodes').map((entry) => ({
		id: normaliseString(entry.id) ?? '',
		parentId: normaliseString(entry.parent_id),
		code: normaliseString(entry.code),
		name: normaliseString(entry.name),
		type: normaliseString(entry.type)
	}));
	const wbsPaths = buildHierarchyPaths(
		wbsNodesRaw.map((entry) => ({
			id: entry.id,
			parentId: entry.parentId,
			code: entry.code,
			name: entry.name
		}))
	);
	const wbsNodes = wbsNodesRaw
		.filter((entry) => entry.id.length > 0)
		.map((entry) => ({
			...entry,
			path: wbsPaths.get(entry.id) ?? (formatNodeLabel(entry.code, entry.name) || entry.id)
		}))
		.filter((entry) => hasMeaningfulReferenceIdentity(entry))
		.sort((left, right) => stableCompare(left.path, right.path));

	const materialCatalogItems = readArray(tableSnapshot, 'materialCatalogItems')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			category: normaliseString(entry.category),
			specification: normaliseString(entry.specification),
			unit: normaliseString(entry.unit) as UnitCode | null,
			defaultRate: normaliseNumber(entry.default_rate),
			effectiveDate: normaliseString(entry.effective_date),
			verifiedDate: normaliseString(entry.verified_date),
			rateBasis: normaliseString(entry.rate_basis),
			leadTime: normaliseString(entry.lead_time),
			availability: normaliseString(entry.availability),
			reference: normaliseString(entry.reference),
			isActive: normaliseActiveBoolean(entry.is_active),
			aliases: readAliases(entry),
			metadata:
				entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
					? toPlainJsonRecord(entry.metadata)
					: {}
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const labourRateCards = readArray(tableSnapshot, 'labourRateCards')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			category: normaliseString(entry.category),
			workCentre: normaliseString(entry.work_center),
			unit: normaliseString(entry.unit) as UnitCode | null,
			defaultRate: normaliseNumber(entry.default_rate),
			effectiveDate: normaliseString(entry.effective_date),
			verifiedDate: normaliseString(entry.verified_date),
			rateBasis: normaliseString(entry.rate_basis),
			leadTime: normaliseString(entry.lead_time),
			availability: normaliseString(entry.availability),
			reference: normaliseString(entry.reference),
			isActive: normaliseActiveBoolean(entry.is_active),
			aliases: readAliases(entry),
			metadata:
				entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
					? toPlainJsonRecord(entry.metadata)
					: {}
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const equipmentRateCards = readArray(tableSnapshot, 'equipmentRateCards')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			category: normaliseString(entry.category),
			workCentre: normaliseString(entry.work_center),
			unit: normaliseString(entry.unit) as UnitCode | null,
			defaultRate: normaliseNumber(entry.default_rate),
			effectiveDate: normaliseString(entry.effective_date),
			verifiedDate: normaliseString(entry.verified_date),
			rateBasis: normaliseString(entry.rate_basis),
			leadTime: normaliseString(entry.lead_time),
			availability: normaliseString(entry.availability),
			reference: normaliseString(entry.reference),
			isActive: normaliseActiveBoolean(entry.is_active),
			aliases: readAliases(entry),
			metadata:
				entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
					? toPlainJsonRecord(entry.metadata)
					: {}
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const subcontractRateCards = readArray(tableSnapshot, 'subcontractRateCards')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			category: normaliseString(entry.category),
			supplierName:
				entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
					? normaliseString((entry.metadata as Record<string, unknown>).supplier)
					: null,
			unit: normaliseString(entry.unit) as UnitCode | null,
			defaultRate: normaliseNumber(entry.default_rate),
			effectiveDate: normaliseString(entry.effective_date),
			verifiedDate: normaliseString(entry.verified_date),
			rateBasis: normaliseString(entry.rate_basis),
			leadTime: normaliseString(entry.lead_time),
			availability: normaliseString(entry.availability),
			reference: normaliseString(entry.reference),
			isActive: normaliseActiveBoolean(entry.is_active),
			aliases: readAliases(entry),
			metadata:
				entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
					? toPlainJsonRecord(entry.metadata)
					: {}
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const costComponentPresets = readArray(tableSnapshot, 'costComponentPresets')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			description: normaliseString(entry.description),
			aliases: readAliases(entry),
			isActive: normaliseActiveBoolean(entry.is_active),
			components: Array.isArray(entry.components)
				? (toPlainJsonArray(entry.components) as CostComponentPreset['components'])
				: []
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const estimateTemplates = readArray(tableSnapshot, 'estimateTemplates')
		.map((entry) => ({
			id: normaliseString(entry.id) ?? '',
			code: normaliseString(entry.code),
			name: normaliseString(entry.name),
			description: normaliseString(entry.description),
			aliases: readAliases(entry),
			isActive: normaliseActiveBoolean(entry.is_active),
			estimate:
				entry.estimate && typeof entry.estimate === 'object'
					? (toPlainJsonRecord(entry.estimate) as unknown as EstimateTemplate['estimate'])
					: null
		}))
		.filter((entry) => entry.id.length > 0 && hasMeaningfulReferenceIdentity(entry))
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	const relevantClassificationIds = new Set<string>();
	for (const costCode of costCodes) {
		if (costCode.classificationSystemId) {
			relevantClassificationIds.add(costCode.classificationSystemId);
		}
	}
	for (const template of estimateTemplates) {
		if (template.estimate?.classification_system_id) {
			relevantClassificationIds.add(template.estimate.classification_system_id);
		}
	}

	const classificationSystems = classificationSystemsRaw
		.filter(
			(entry) => relevantClassificationIds.size === 0 || relevantClassificationIds.has(entry.id)
		)
		.sort(
			(left, right) =>
				compareReferenceQuality(left, right) ||
				stableCompare(left.code, right.code) ||
				stableCompare(left.name, right.name)
		);

	return {
		allowedUnits: UNIT_OPTIONS.map((option) => ({
			code: option.value,
			label: option.label
		})),
		classificationSystems,
		costCodes,
		wbsNodes,
		materialCatalogItems,
		labourRateCards,
		equipmentRateCards,
		subcontractRateCards,
		costComponentPresets,
		estimateTemplates
	};
}

function buildEstimateReferenceIndex(
	referenceData: EstimateContextReferenceData
): EstimateReferenceIndex {
	return {
		classificationSystems: new Map(
			referenceData.classificationSystems.map((entry) => [
				entry.id,
				{
					id: entry.id,
					name: entry.name,
					code: entry.code,
					aliases: entry.aliases ?? []
				}
			])
		),
		costCodes: new Map(
			referenceData.costCodes.map((entry) => [
				entry.id,
				{
					id: entry.id,
					classificationSystemId: entry.classificationSystemId,
					path: entry.path,
					code: entry.code,
					name: entry.name
				}
			])
		),
		wbsNodes: new Map(
			referenceData.wbsNodes.map((entry) => [
				entry.id,
				{
					id: entry.id,
					path: entry.path,
					name: entry.name,
					code: entry.code
				}
			])
		),
		materialSources: new Map(
			referenceData.materialCatalogItems.map((entry) => [
				entry.id,
				{
					id: entry.id,
					label: buildSourceLabel(entry),
					unit: entry.unit
				}
			])
		),
		labourSources: new Map(
			referenceData.labourRateCards.map((entry) => [
				entry.id,
				{
					id: entry.id,
					label: buildSourceLabel(entry),
					unit: entry.unit
				}
			])
		),
		equipmentSources: new Map(
			referenceData.equipmentRateCards.map((entry) => [
				entry.id,
				{
					id: entry.id,
					label: buildSourceLabel(entry),
					unit: entry.unit
				}
			])
		),
		subcontractSources: new Map(
			referenceData.subcontractRateCards.map((entry) => [
				entry.id,
				{
					id: entry.id,
					label: buildSourceLabel(entry),
					unit: entry.unit
				}
			])
		)
	};
}

function buildClassificationCandidates(
	referenceData: EstimateContextReferenceData
): EstimateMappingCandidate[] {
	return referenceData.classificationSystems.map((entry) => ({
		value: entry.id,
		label: formatNodeLabel(entry.code, entry.name) ?? entry.id,
		description: entry.aliases?.length ? `Aliases: ${entry.aliases.join(', ')}` : undefined
	}));
}

function buildCostCodeCandidates(
	referenceData: EstimateContextReferenceData,
	classificationSystemId: string | null
): EstimateMappingCandidate[] {
	return referenceData.costCodes
		.filter(
			(entry) => !classificationSystemId || entry.classificationSystemId === classificationSystemId
		)
		.map((entry) => ({
			value: entry.id,
			label: entry.path,
			description: entry.description
		}));
}

function buildWbsCandidates(
	referenceData: EstimateContextReferenceData
): EstimateMappingCandidate[] {
	return referenceData.wbsNodes.map((entry) => ({
		value: entry.id,
		label: entry.path,
		description: entry.type ?? undefined
	}));
}

function findUniqueExactNamedReference<T>(params: {
	values: Array<string | null | undefined>;
	records: T[];
	terms: (record: T) => Array<string | null | undefined>;
}): T | null {
	const values = new Set(
		params.values
			.map((value) => normaliseMatchText(value ?? ''))
			.filter((value) => value.length > 0)
	);
	if (values.size === 0) return null;
	const matches = params.records.filter((record) =>
		params
			.terms(record)
			.map((value) => normaliseMatchText(value ?? ''))
			.some((value) => value.length > 0 && values.has(value))
	);
	return matches.length === 1 ? matches[0]! : null;
}

function unresolvedNamedReference(candidateCount: number): NamedReferenceResolution {
	return {
		autoMatched: false,
		exactIdentity: false,
		score: 0,
		candidateCount,
		matchSignals: []
	};
}

function reconcileClassificationSelection(
	draft: AiDraftEstimate,
	referenceData: EstimateContextReferenceData
): NamedReferenceResolution {
	const systems = referenceData.classificationSystems;
	if (systems.length === 0) {
		draft.classification_system_id = null;
		return unresolvedNamedReference(0);
	}

	if (draft.classification_system_id) {
		const direct = systems.find((system) => system.id === draft.classification_system_id);
		if (direct) {
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: systems.length,
				matchSignals: ['explicit_classification_id']
			};
		}
	}

	const rawValue = normaliseString(draft.classification_system_id);
	if (!rawValue) {
		draft.classification_system_id = null;
		return unresolvedNamedReference(systems.length);
	}
	const exact = findUniqueExactNamedReference({
		values: [rawValue],
		records: systems,
		terms: (system) => [system.code, system.name, ...(system.aliases ?? [])]
	});
	if (!exact) {
		draft.classification_system_id = null;
		return unresolvedNamedReference(systems.length);
	}

	draft.classification_system_id = exact.id;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: systems.length,
		matchSignals: ['exact_classification_match']
	};
}

function reconcileWbsRootSelection(
	draft: AiDraftEstimate,
	referenceData: EstimateContextReferenceData
): NamedReferenceResolution {
	const nodes = referenceData.wbsNodes;
	if (nodes.length === 0) {
		draft.wbs_root_node_id = null;
		return unresolvedNamedReference(0);
	}

	if (draft.wbs_root_node_id) {
		const direct = nodes.find((node) => node.id === draft.wbs_root_node_id);
		if (direct) {
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: nodes.length,
				matchSignals: ['explicit_wbs_root_id']
			};
		}
	}

	const rawValue = normaliseString(draft.wbs_root_node_id);
	if (!rawValue) {
		draft.wbs_root_node_id = null;
		return unresolvedNamedReference(nodes.length);
	}
	const exact = findUniqueExactNamedReference({
		values: [rawValue],
		records: nodes,
		terms: (node) => [node.code, node.name]
	});
	if (!exact) {
		draft.wbs_root_node_id = null;
		return unresolvedNamedReference(nodes.length);
	}

	draft.wbs_root_node_id = exact.id;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: nodes.length,
		matchSignals: ['exact_wbs_root_match']
	};
}

function reconcileCostCodeSelection(
	item: AiDraftEstimate['takeoff_items'][number],
	referenceData: EstimateContextReferenceData,
	classificationSystemId: string | null
): NamedReferenceResolution {
	const costCodes = referenceData.costCodes.filter(
		(entry) => !classificationSystemId || entry.classificationSystemId === classificationSystemId
	);
	if (costCodes.length === 0) {
		item.cost_code_id = null;
		return unresolvedNamedReference(0);
	}

	if (item.cost_code_id) {
		const direct = costCodes.find((entry) => entry.id === item.cost_code_id);
		if (direct) {
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: costCodes.length,
				matchSignals: ['explicit_cost_code_id']
			};
		}
	}

	const rawValue = normaliseString(item.cost_code_id);
	if (!rawValue) {
		item.cost_code_id = null;
		return unresolvedNamedReference(costCodes.length);
	}
	const exact = findUniqueExactNamedReference({
		values: [rawValue],
		records: costCodes,
		terms: (entry) => [entry.code, entry.name]
	});
	if (!exact) {
		item.cost_code_id = null;
		return unresolvedNamedReference(costCodes.length);
	}

	item.cost_code_id = exact.id;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: costCodes.length,
		matchSignals: ['exact_cost_code_match']
	};
}

function reconcileTakeoffWbsSelection(
	item: AiDraftEstimate['takeoff_items'][number],
	referenceData: EstimateContextReferenceData
): NamedReferenceResolution {
	const nodes = referenceData.wbsNodes;
	if (nodes.length === 0) {
		item.wbs_node_id = null;
		return unresolvedNamedReference(0);
	}

	if (item.wbs_node_id) {
		const direct = nodes.find((node) => node.id === item.wbs_node_id);
		if (direct) {
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: nodes.length,
				matchSignals: ['explicit_wbs_node_id']
			};
		}
	}

	const rawValue = normaliseString(item.wbs_node_id);
	if (!rawValue) {
		item.wbs_node_id = null;
		return unresolvedNamedReference(nodes.length);
	}
	const exact = findUniqueExactNamedReference({
		values: [rawValue],
		records: nodes,
		terms: (node) => [node.code, node.name]
	});
	if (!exact) {
		item.wbs_node_id = null;
		return unresolvedNamedReference(nodes.length);
	}

	item.wbs_node_id = exact.id;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: nodes.length,
		matchSignals: ['exact_wbs_node_match']
	};
}

function reconcileAppliedTemplateSelection(
	draft: AiDraftEstimate,
	referenceData: EstimateContextReferenceData
): NamedReferenceResolution {
	const templates = referenceData.estimateTemplates;
	if (templates.length === 0) {
		draft.applied_template_id = null;
		draft.applied_template_name = null;
		return {
			autoMatched: false,
			exactIdentity: false,
			score: 0,
			candidateCount: 0,
			matchSignals: []
		};
	}

	if (draft.applied_template_id) {
		const direct = templates.find((template) => template.id === draft.applied_template_id);
		if (direct) {
			draft.applied_template_name = direct.name ?? draft.applied_template_name ?? null;
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: templates.length,
				matchSignals: ['explicit_template_id']
			};
		}
	}

	const exact = findUniqueExactNamedReference({
		values: [draft.applied_template_id, draft.applied_template_name],
		records: templates,
		terms: (template) => [template.code, template.name, ...(template.aliases ?? [])]
	});
	if (!exact) {
		draft.applied_template_id = null;
		draft.applied_template_name = null;
		return unresolvedNamedReference(templates.length);
	}

	draft.applied_template_id = exact.id;
	draft.applied_template_name = exact.name ?? draft.applied_template_name ?? null;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: templates.length,
		matchSignals: ['exact_template_match']
	};
}

function reconcileAppliedPresetSelection(
	item: AiDraftEstimate['takeoff_items'][number],
	referenceData: EstimateContextReferenceData
): NamedReferenceResolution {
	const presets = referenceData.costComponentPresets;
	if (presets.length === 0) {
		item.applied_preset_id = null;
		item.applied_preset_name = null;
		return {
			autoMatched: false,
			exactIdentity: false,
			score: 0,
			candidateCount: 0,
			matchSignals: []
		};
	}

	if (item.applied_preset_id) {
		const direct = presets.find((preset) => preset.id === item.applied_preset_id);
		if (direct) {
			item.applied_preset_name = direct.name ?? item.applied_preset_name ?? null;
			return {
				autoMatched: false,
				exactIdentity: true,
				score: 999,
				candidateCount: presets.length,
				matchSignals: ['explicit_preset_id']
			};
		}
	}

	const exact = findUniqueExactNamedReference({
		values: [item.applied_preset_id, item.applied_preset_name],
		records: presets,
		terms: (preset) => [preset.code, preset.name, ...(preset.aliases ?? [])]
	});
	if (!exact) {
		item.applied_preset_id = null;
		item.applied_preset_name = null;
		return unresolvedNamedReference(presets.length);
	}

	item.applied_preset_id = exact.id;
	item.applied_preset_name = exact.name ?? item.applied_preset_name ?? null;
	return {
		autoMatched: true,
		exactIdentity: true,
		score: 120,
		candidateCount: presets.length,
		matchSignals: ['exact_preset_match']
	};
}

function normaliseNameKey(value: string | null | undefined): string {
	return normaliseMatchText(value ?? '');
}

function tokenOverlapCount(left: string[], right: string[]): number {
	const rightSet = new Set(right);
	return left.filter((token) => rightSet.has(token)).length;
}

function buildSeededDraftComponent(
	component: {
		category: CostComponentCategory;
		source_type: CostComponentSourceType;
		source_id?: string | null;
		name: string;
		description: string;
		quantity: number;
		unit: UnitCode;
		unit_rate: number;
		formula: Record<string, unknown>;
		metadata: Record<string, unknown>;
		sort_order?: number;
	},
	seedSource: 'template' | 'preset'
): AiDraftEstimate['takeoff_items'][number]['cost_components'][number] {
	return {
		...component,
		sort_order: component.sort_order ?? 0,
		source_id: component.source_id ?? null,
		evidence_refs: [],
		confidence: createDefaultAiConfidence(),
		mapping_status: component.source_id ? 'matched' : 'manual',
		metadata: {
			...component.metadata,
			ai_seed: {
				kind: seedSource
			}
		}
	};
}

function buildSeededDraftItem(
	item: {
		name: string;
		description: string;
		quantity: number;
		unit: UnitCode;
		sort_order?: number;
		cost_code_id?: string | null;
		wbs_node_id?: string | null;
		applied_preset_id?: string | null;
		applied_preset_name?: string | null;
		properties: Record<string, unknown>;
		cost_components: Array<{
			category: CostComponentCategory;
			source_type: CostComponentSourceType;
			source_id?: string | null;
			name: string;
			description: string;
			quantity: number;
			unit: UnitCode;
			unit_rate: number;
			formula: Record<string, unknown>;
			metadata: Record<string, unknown>;
			sort_order?: number;
		}>;
	},
	seedSource: 'template' | 'preset'
): AiDraftTakeoffItem {
	return {
		name: item.name,
		description: item.description,
		quantity: item.quantity,
		unit: item.unit,
		sort_order: item.sort_order ?? 0,
		cost_code_id: item.cost_code_id ?? null,
		wbs_node_id: item.wbs_node_id ?? null,
		applied_preset_id: item.applied_preset_id ?? null,
		applied_preset_name: item.applied_preset_name ?? null,
		properties: {
			...item.properties,
			ai_seed: {
				kind: seedSource
			}
		},
		cost_components: item.cost_components.map((component) =>
			buildSeededDraftComponent(component, seedSource)
		),
		evidence_refs: [],
		confidence: createDefaultAiConfidence(),
		open_questions: []
	};
}

function scoreItemMergeMatch(seed: AiDraftTakeoffItem, overlay: AiDraftTakeoffItem): number {
	if (
		seed.applied_preset_id &&
		overlay.applied_preset_id &&
		seed.applied_preset_id === overlay.applied_preset_id
	) {
		return 200;
	}
	const seedName = normaliseNameKey(seed.name);
	const overlayName = normaliseNameKey(overlay.name);
	if (seedName && seedName === overlayName) return 120;
	const overlap = tokenOverlapCount(buildMatchTokens(seed), buildMatchTokens(overlay));
	if (overlap >= 3) return 80;
	if (overlap >= 2) return 55;
	return 0;
}

function scoreComponentMergeMatch(
	seed: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	overlay: AiDraftEstimate['takeoff_items'][number]['cost_components'][number]
): number {
	if (seed.category !== overlay.category) return -1;
	if (seed.source_id && overlay.source_id && seed.source_id === overlay.source_id) {
		return 200;
	}
	const seedName = normaliseNameKey(seed.name);
	const overlayName = normaliseNameKey(overlay.name);
	if (seedName && seedName === overlayName) return 120;
	const overlap = tokenOverlapCount(buildMatchTokens(seed), buildMatchTokens(overlay));
	if (overlap >= 3) return 80;
	if (overlap >= 2) return 55;
	return 0;
}

function shouldPreserveSeedUnitRate(
	seed: AiDraftEstimate['takeoff_items'][number]['cost_components'][number],
	overlay: AiDraftEstimate['takeoff_items'][number]['cost_components'][number]
): boolean {
	return (
		Number.isFinite(seed.unit_rate) &&
		seed.unit_rate > 0 &&
		(!Number.isFinite(overlay.unit_rate) || overlay.unit_rate <= 0)
	);
}

function mergeDraftComponents(
	seeded: AiDraftEstimate['takeoff_items'][number]['cost_components'],
	overlays: AiDraftEstimate['takeoff_items'][number]['cost_components']
): AiDraftEstimate['takeoff_items'][number]['cost_components'] {
	if (seeded.length === 0) {
		return overlays.map((component, index) => ({
			...component,
			sort_order: component.sort_order ?? index
		}));
	}
	if (overlays.length === 0) {
		return seeded.map((component, index) => ({
			...component,
			sort_order: component.sort_order ?? index
		}));
	}

	const usedOverlayIndexes = new Set<number>();
	const merged = seeded.map((seedComponent, seededIndex) => {
		let bestMatchIndex = -1;
		let bestScore = 0;
		for (const [overlayIndex, overlayComponent] of overlays.entries()) {
			if (usedOverlayIndexes.has(overlayIndex)) continue;
			const score = scoreComponentMergeMatch(seedComponent, overlayComponent);
			if (score > bestScore) {
				bestScore = score;
				bestMatchIndex = overlayIndex;
			}
		}

		if (bestMatchIndex < 0) {
			return { ...seedComponent, sort_order: seededIndex };
		}

		usedOverlayIndexes.add(bestMatchIndex);
		const overlay = overlays[bestMatchIndex]!;
		const preserveSeedUnitRate = shouldPreserveSeedUnitRate(seedComponent, overlay);
		return {
			...seedComponent,
			...overlay,
			unit_rate: preserveSeedUnitRate ? seedComponent.unit_rate : overlay.unit_rate,
			source_id: overlay.source_id ?? seedComponent.source_id ?? null,
			metadata: {
				...seedComponent.metadata,
				...overlay.metadata
			},
			sort_order: overlay.sort_order ?? seededIndex
		};
	});

	for (const [overlayIndex, overlayComponent] of overlays.entries()) {
		if (usedOverlayIndexes.has(overlayIndex)) continue;
		merged.push({
			...overlayComponent,
			sort_order: overlayComponent.sort_order ?? merged.length
		});
	}

	return merged.map((component, index) => ({
		...component,
		sort_order: index
	}));
}

function mergeDraftItems(
	seeded: AiDraftTakeoffItem[],
	overlays: AiDraftTakeoffItem[]
): AiDraftTakeoffItem[] {
	if (seeded.length === 0) {
		return overlays.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
	}
	if (overlays.length === 0) {
		return seeded.map((item, index) => ({ ...item, sort_order: item.sort_order ?? index }));
	}

	const usedOverlayIndexes = new Set<number>();
	const merged = seeded.map((seedItem, seededIndex) => {
		let bestMatchIndex = -1;
		let bestScore = 0;
		for (const [overlayIndex, overlayItem] of overlays.entries()) {
			if (usedOverlayIndexes.has(overlayIndex)) continue;
			const score = scoreItemMergeMatch(seedItem, overlayItem);
			if (score > bestScore) {
				bestScore = score;
				bestMatchIndex = overlayIndex;
			}
		}

		if (bestMatchIndex < 0) {
			return { ...seedItem, sort_order: seededIndex };
		}

		usedOverlayIndexes.add(bestMatchIndex);
		const overlay = overlays[bestMatchIndex]!;
		return {
			...seedItem,
			...overlay,
			cost_code_id: overlay.cost_code_id ?? seedItem.cost_code_id ?? null,
			wbs_node_id: overlay.wbs_node_id ?? seedItem.wbs_node_id ?? null,
			applied_preset_id: overlay.applied_preset_id ?? seedItem.applied_preset_id ?? null,
			applied_preset_name: overlay.applied_preset_name ?? seedItem.applied_preset_name ?? null,
			properties: {
				...seedItem.properties,
				...overlay.properties
			},
			cost_components: mergeDraftComponents(seedItem.cost_components, overlay.cost_components),
			sort_order: overlay.sort_order ?? seededIndex
		};
	});

	for (const [overlayIndex, overlayItem] of overlays.entries()) {
		if (usedOverlayIndexes.has(overlayIndex)) continue;
		merged.push({
			...overlayItem,
			sort_order: overlayItem.sort_order ?? merged.length
		});
	}

	return merged.map((item, index) => ({
		...item,
		sort_order: index
	}));
}

function applyTemplateSeed(
	draft: AiDraftEstimate,
	template: EstimateContextReferenceData['estimateTemplates'][number]
): void {
	if (!template.estimate || typeof template.estimate !== 'object') return;
	const seededItems = Array.isArray(
		(template.estimate as { takeoff_items?: unknown[] }).takeoff_items
	)
		? (
				template.estimate as { takeoff_items: EstimateTemplate['estimate']['takeoff_items'] }
			).takeoff_items.map((item) => buildSeededDraftItem(item, 'template'))
		: [];
	draft.scope_summary =
		normaliseString((template.estimate as { scope_summary?: unknown }).scope_summary) ??
		draft.scope_summary;
	draft.notes = normaliseString((template.estimate as { notes?: unknown }).notes) ?? draft.notes;
	draft.classification_system_id =
		normaliseString(
			(template.estimate as { classification_system_id?: unknown }).classification_system_id
		) ??
		draft.classification_system_id ??
		null;
	draft.wbs_root_node_id =
		normaliseString((template.estimate as { wbs_root_node_id?: unknown }).wbs_root_node_id) ??
		draft.wbs_root_node_id ??
		null;
	draft.takeoff_items = mergeDraftItems(seededItems, draft.takeoff_items);
}

function applyPresetSeed(
	item: AiDraftTakeoffItem,
	preset: EstimateContextReferenceData['costComponentPresets'][number]
): void {
	const seededComponents = preset.components.map((component) =>
		buildSeededDraftComponent(component, 'preset')
	);
	item.cost_components = mergeDraftComponents(seededComponents, item.cost_components);
}

function buildSourceCandidates(
	referenceData: EstimateContextReferenceData,
	sourceType: CostComponentSourceType
): EstimateMappingCandidate[] {
	const sourceEntries =
		sourceType === 'material_catalog'
			? referenceData.materialCatalogItems
			: sourceType === 'labour_rate_card'
				? referenceData.labourRateCards
				: sourceType === 'equipment_rate_card'
					? referenceData.equipmentRateCards
					: sourceType === 'subcontract_rate_card'
						? referenceData.subcontractRateCards
						: [];

	return sourceEntries.map((entry) => ({
		value: entry.id,
		label: buildSourceLabel(entry),
		description:
			entry.unit && entry.defaultRate != null
				? `${entry.unit} · ${entry.defaultRate}`
				: (entry.unit ?? null)
	}));
}

function buildUnitCandidates(category: CostComponentCategory): EstimateMappingCandidate[] {
	return getCostComponentUnitOptions(category).map((option) => ({
		value: option.value,
		label: option.label
	}));
}

function buildSeededHeaderFields(estimate: Estimate): string[] {
	const seeded: string[] = [];
	if (normaliseString(estimate.scope_summary)) seeded.push('scope_summary');
	if (normaliseString(estimate.notes)) seeded.push('notes');
	if (estimate.classification_system_id) seeded.push('classification_system_id');
	if (estimate.wbs_root_node_id) seeded.push('wbs_root_node_id');
	return seeded;
}

function hasDraftedStructure(estimate: Estimate): boolean {
	return estimate.takeoff_items.length > 0;
}

function normaliseDraftLinkFields(draft: AiDraftEstimate): void {
	draft.applied_template_id = draft.applied_template_id ?? null;
	draft.applied_template_name = draft.applied_template_name ?? null;
	for (const item of draft.takeoff_items) {
		item.applied_preset_id = item.applied_preset_id ?? null;
		item.applied_preset_name = item.applied_preset_name ?? null;
	}
}

function applyOverridesToDraft(
	draft: AiDraftEstimate,
	overrides: EstimateMappingOverrides
): AiDraftEstimate {
	const nextDraft = structuredClone(draft);
	normaliseDraftLinkFields(nextDraft);

	for (const [fieldId, value] of Object.entries(overrides)) {
		const takeoffMatch = fieldId.match(/^takeoff_items\[(\d+)\]\.(cost_code_id|wbs_node_id)$/);
		const componentMatch = fieldId.match(
			/^takeoff_items\[(\d+)\]\.cost_components\[(\d+)\]\.(source_id|unit)$/
		);

		if (fieldId === 'header.classification_system_id') {
			nextDraft.classification_system_id = value === ESTIMATE_MAPPING_CLEAR_VALUE ? null : value;
			continue;
		}

		if (fieldId === 'header.wbs_root_node_id') {
			nextDraft.wbs_root_node_id = value === ESTIMATE_MAPPING_CLEAR_VALUE ? null : value;
			continue;
		}

		if (takeoffMatch) {
			const [, itemIndexRaw, field] = takeoffMatch;
			const item = nextDraft.takeoff_items[Number(itemIndexRaw)];
			if (!item) continue;
			if (field === 'cost_code_id') {
				item.cost_code_id = value === ESTIMATE_MAPPING_CLEAR_VALUE ? null : value;
			} else {
				item.wbs_node_id = value === ESTIMATE_MAPPING_CLEAR_VALUE ? null : value;
			}
			continue;
		}

		if (componentMatch) {
			const [, itemIndexRaw, componentIndexRaw, field] = componentMatch;
			const item = nextDraft.takeoff_items[Number(itemIndexRaw)];
			const component = item?.cost_components[Number(componentIndexRaw)];
			if (!component) continue;
			if (field === 'source_id') {
				if (value === ESTIMATE_MAPPING_CLEAR_VALUE) {
					component.source_type = 'manual';
					component.source_id = null;
					component.mapping_status = 'manual';
					component.metadata = {
						...component.metadata,
						ai_linking_suppressed: true
					};
				} else {
					component.source_id = value;
					component.mapping_status = 'matched';
					if (component.metadata && typeof component.metadata === 'object') {
						const nextMetadata = { ...component.metadata };
						delete nextMetadata.ai_linking_suppressed;
						component.metadata = nextMetadata;
					}
				}
				continue;
			}

			component.unit = value as UnitCode;
		}
	}

	return nextDraft;
}

function allReviewFields(review: EstimateMappingReview): EstimateMappingFieldReview[] {
	return [
		...review.headerFields,
		...review.items.flatMap((item) => [...item.fields, ...item.componentFields])
	];
}

function buildField(
	field: Omit<EstimateMappingFieldReview, 'candidates'> & {
		candidates?: EstimateMappingCandidate[];
	}
): EstimateMappingFieldReview {
	return {
		...field,
		candidates: field.candidates ?? []
	};
}

export function buildAiEstimateContextSnapshot(
	params: BuildAiEstimateContextSnapshotParams
): AiEstimateContextSnapshot {
	const referenceData = normaliseAiTableSnapshot(params.tableSnapshot);
	const allowedUnitsByCategory = (
		['material', 'labour', 'equipment', 'subcontract', 'misc'] as CostComponentCategory[]
	).reduce<Record<string, Array<{ code: UnitCode; label: string }>>>((accumulator, category) => {
		accumulator[category] = getCostComponentUnitOptions(category).map((option) => ({
			code: option.value,
			label: option.label
		}));
		return accumulator;
	}, {});

	return {
		version: ESTIMATE_AI_CONTEXT_VERSION,
		asset_context: {
			assetId: params.assetId,
			assetName: params.assetName,
			projectName: params.projectName ?? null
		},
		schema: {
			headerFields: ['scope_summary', 'notes', 'classification_system_id', 'wbs_root_node_id'],
			takeoffItemFields: ['name', 'description', 'quantity', 'unit', 'cost_code_id', 'wbs_node_id'],
			costComponentFields: [
				'category',
				'source_type',
				'source_id',
				'name',
				'description',
				'quantity',
				'unit',
				'unit_rate'
			],
			allowedCategories: ['material', 'labour', 'equipment', 'subcontract', 'misc'],
			allowedUnits: referenceData.allowedUnits,
			allowedUnitsByCategory
		},
		reference_data: referenceData,
		field_semantics: {
			sections: [
				{
					id: 'estimate_setup',
					label: 'Estimate Setup',
					description: 'Header-level estimating defaults and project-wide coding context.'
				},
				{
					id: 'takeoff_items',
					label: 'Takeoff Items',
					description:
						'Distinct scoped work items that hold measured quantities, coding, and the detailed pricing rows beneath that scope.'
				},
				{
					id: 'cost_components',
					label: 'Cost Rows',
					description: 'Material, labour, equipment, subcontract, and manual commercial rows.'
				}
			],
			fields: {
				scope_summary: {
					label: 'Scope Summary',
					description: 'Short estimator-facing description of the overall asset scope.',
					guidance:
						'If the user has already entered this field, treat it as current setup context and avoid replacing it unless the review explicitly chooses the AI wording.'
				},
				notes: {
					label: 'Estimate Notes',
					description: 'Internal notes for estimating context, exclusions, and follow-up detail.',
					guidance:
						'Keep user-entered note context unless the review explicitly chooses the AI change.'
				},
				classification_system_id: {
					label: 'Classification',
					description: 'Optional coding system that constrains which cost codes may be applied.',
					guidance:
						'If the user has already selected a classification system, draft inside that system by default.'
				},
				wbs_root_node_id: {
					label: 'Structure Root',
					description: 'Optional project structure root used to frame takeoff locations.',
					guidance:
						'If the user has already selected a structure root, keep it as the active framing context by default.'
				},
				takeoff_item_name: {
					label: 'Item Name',
					description: 'Primary scoped work item label for a takeoff row.',
					guidance:
						'Split takeoff items only when the measurable or installable scope changes. Do not create separate takeoff items just because the cost rows use different categories.'
				},
				takeoff_item_description: {
					label: 'Item details',
					description:
						'Optional description of what is being measured or installed for the takeoff item.'
				},
				takeoff_item_quantity: {
					label: 'Quantity',
					description: 'Measured quantity for the takeoff item.'
				},
				takeoff_item_unit: {
					label: 'Unit',
					description: 'Commercial unit for the takeoff item quantity.'
				},
				takeoff_item_cost_code_id: {
					label: 'Cost Code',
					description: 'Optional work code that must belong to the selected classification system.'
				},
				takeoff_item_wbs_node_id: {
					label: 'Structure',
					description: 'Optional project structure node that must belong to the current project.'
				},
				cost_component_source_id: {
					label: 'Linked Source',
					description: 'Optional catalogue or rate-card source for a cost component.'
				},
				cost_component_name: {
					label: 'Cost row name',
					description:
						'Commercial name for the material, labour, equipment, subcontract, or misc row.'
				},
				cost_component_quantity: {
					label: 'Cost row quantity',
					description: 'Quantity applied to the cost row.'
				},
				cost_component_unit: {
					label: 'Unit',
					description: 'Commercial unit for the component. Must fit the selected category.'
				},
				cost_component_unit_rate: {
					label: 'Rate',
					description:
						'Unit rate for the cost row. Quote-engine math remains the local source of truth.',
					guidance:
						'If no credible commercially usable rate is available, keep the row reviewable and surface a rate-review issue instead of implying the rate is known.'
				}
			}
		},
		current_estimate_state: {
			currentEstimate: params.currentEstimate,
			savedEstimate: params.savedEstimate ?? null,
			seededHeaderFields: buildSeededHeaderFields(params.currentEstimate),
			hasDraftedStructure: hasDraftedStructure(params.currentEstimate)
		},
		mapping_rules: {
			classificationCostCodeOwnership: 'strict',
			projectStructureOwnership: 'strict',
			sourceLinkedComponents: 'workspace_scoped',
			unresolvedStrategy: 'apply_to_working_copy'
		},
		review_rules: {
			blockingStatuses: ['needs_review', 'unresolved'],
			clearableTargets: [
				'classification_system',
				'wbs_root',
				'takeoff_cost_code',
				'takeoff_wbs',
				'component_source'
			]
		}
	};
}

export function buildEstimateMappingReview(params: {
	draft: AiDraftEstimate;
	contextSnapshot: AiEstimateContextSnapshot;
	overrides?: EstimateMappingOverrides;
}): EstimateMappingReview {
	const draftWithOverrides = applyOverridesToDraft(params.draft, params.overrides ?? {});
	const referenceData = params.contextSnapshot.reference_data as EstimateContextReferenceData;
	const references = buildEstimateReferenceIndex(referenceData);
	const issues: AiIssue[] = [...draftWithOverrides.issues];
	const reconciledDraft = structuredClone(draftWithOverrides);
	normaliseDraftLinkFields(reconciledDraft);
	const currentEstimate = params.contextSnapshot.current_estimate_state.currentEstimate;
	const hasAnyOverride = Object.keys(params.overrides ?? {}).length > 0;
	const hasClassificationOverride = Object.hasOwn(
		params.overrides ?? {},
		'header.classification_system_id'
	);
	const hasWbsRootOverride = Object.hasOwn(params.overrides ?? {}, 'header.wbs_root_node_id');
	const headerFields: EstimateMappingFieldReview[] = [];
	const items: EstimateMappingReviewItem[] = [];

	const requestedTemplateId = reconciledDraft.applied_template_id ?? null;
	if (!(hasAnyOverride && !requestedTemplateId)) {
		reconcileAppliedTemplateSelection(reconciledDraft, referenceData);
	}
	if (requestedTemplateId && requestedTemplateId !== reconciledDraft.applied_template_id) {
		issues.push(
			buildIssue(
				'invalid_estimate_template',
				'The selected estimate template is not available in this workspace, so the draft keeps its composed structure without a linked template.'
			)
		);
	}
	if (reconciledDraft.applied_template_id) {
		const appliedTemplate = referenceData.estimateTemplates.find(
			(template) => template.id === reconciledDraft.applied_template_id
		);
		if (appliedTemplate) {
			applyTemplateSeed(reconciledDraft, appliedTemplate);
		}
	}

	for (const item of reconciledDraft.takeoff_items) {
		const requestedPresetId = item.applied_preset_id ?? null;
		if (!(hasAnyOverride && !requestedPresetId)) {
			reconcileAppliedPresetSelection(item, referenceData);
		}
		if (requestedPresetId && requestedPresetId !== item.applied_preset_id) {
			issues.push(
				buildIssue(
					'invalid_cost_component_preset',
					`The selected preset for ${item.name} is not available in this workspace, so the draft keeps its composed rows without a linked preset.`
				)
			);
		}
		if (item.applied_preset_id) {
			const appliedPreset = referenceData.costComponentPresets.find(
				(preset) => preset.id === item.applied_preset_id
			);
			if (appliedPreset) {
				applyPresetSeed(item, appliedPreset);
			}
		}
	}

	const seededScopeSummary = normaliseString(currentEstimate.scope_summary);
	if (seededScopeSummary) {
		reconciledDraft.scope_summary = currentEstimate.scope_summary;
	}

	const seededNotes = normaliseString(currentEstimate.notes);
	if (seededNotes) {
		reconciledDraft.notes = currentEstimate.notes;
	}

	if (
		seededScopeSummary &&
		normaliseString(draftWithOverrides.scope_summary) !== seededScopeSummary
	) {
		issues.push(
			buildIssue(
				'seeded_scope_summary_preserved',
				'The current scope summary stays as the active setup context unless you replace it after the draft is applied.',
				'info'
			)
		);
	}

	if (seededNotes && normaliseString(draftWithOverrides.notes) !== seededNotes) {
		issues.push(
			buildIssue(
				'seeded_estimate_notes_preserved',
				'The current estimate notes stay as the active setup context unless you replace them after the draft is applied.',
				'info'
			)
		);
	}

	const seededClassificationId = currentEstimate.classification_system_id ?? null;
	const requestedClassificationId = reconciledDraft.classification_system_id ?? null;
	const classificationResolution = reconcileClassificationSelection(reconciledDraft, referenceData);
	const classificationId = reconciledDraft.classification_system_id ?? null;
	if (seededClassificationId && !hasClassificationOverride) {
		reconciledDraft.classification_system_id = seededClassificationId;
		if (classificationId && classificationId !== seededClassificationId) {
			if (requestedClassificationId && !classificationResolution.autoMatched) {
				issues.push(
					buildIssue(
						'invalid_classification_system',
						'The AI suggested a classification that is not available in this workspace. Your current setup will be kept.'
					)
				);
			}
			headerFields.push(
				buildField({
					id: 'header.classification_system_id',
					label: 'Classification',
					path: 'header.classification_system_id',
					target: 'classification_system',
					status: 'needs_review',
					message: 'Your current setup stays active unless you choose the AI suggestion.',
					required: false,
					allowClear: true,
					existingValue: seededClassificationId,
					currentValue: classificationId,
					resolvedValue: seededClassificationId,
					candidates: buildClassificationCandidates(referenceData)
				})
			);
		}
	} else if (requestedClassificationId && !classificationId) {
		reconciledDraft.classification_system_id = null;
		issues.push(
			buildIssue(
				'invalid_classification_system',
				'The selected AI classification is not available in this workspace.'
			)
		);
		headerFields.push(
			buildField({
				id: 'header.classification_system_id',
				label: 'Classification',
				path: 'header.classification_system_id',
				target: 'classification_system',
				status: 'unresolved',
				message: 'Choose a classification system or leave it blank.',
				required: false,
				allowClear: true,
				currentValue: classificationId,
				resolvedValue: null,
				candidates: buildClassificationCandidates(referenceData)
			})
		);
	}

	const seededWbsRootId = currentEstimate.wbs_root_node_id ?? null;
	const requestedWbsRootId = reconciledDraft.wbs_root_node_id ?? null;
	const wbsRootResolution = reconcileWbsRootSelection(reconciledDraft, referenceData);
	const wbsRootId = reconciledDraft.wbs_root_node_id ?? null;
	if (seededWbsRootId && !hasWbsRootOverride) {
		reconciledDraft.wbs_root_node_id = seededWbsRootId;
		if (wbsRootId && wbsRootId !== seededWbsRootId) {
			if (requestedWbsRootId && !wbsRootResolution.autoMatched) {
				issues.push(
					buildIssue(
						'invalid_wbs_root',
						'The AI suggested a structure root that is not available in this project. Your current setup will be kept.'
					)
				);
			}
			headerFields.push(
				buildField({
					id: 'header.wbs_root_node_id',
					label: 'Structure Root',
					path: 'header.wbs_root_node_id',
					target: 'wbs_root',
					status: 'needs_review',
					message: 'Your current setup stays active unless you choose the AI suggestion.',
					required: false,
					allowClear: true,
					existingValue: seededWbsRootId,
					currentValue: wbsRootId,
					resolvedValue: seededWbsRootId,
					candidates: buildWbsCandidates(referenceData)
				})
			);
		}
	} else if (requestedWbsRootId && !wbsRootId) {
		reconciledDraft.wbs_root_node_id = null;
		issues.push(
			buildIssue(
				'invalid_wbs_root',
				'The selected AI structure root is not available in this project.'
			)
		);
		headerFields.push(
			buildField({
				id: 'header.wbs_root_node_id',
				label: 'Structure Root',
				path: 'header.wbs_root_node_id',
				target: 'wbs_root',
				status: 'unresolved',
				message: 'Choose a project structure root or leave it blank.',
				required: false,
				allowClear: true,
				currentValue: wbsRootId,
				resolvedValue: null,
				candidates: buildWbsCandidates(referenceData)
			})
		);
	}

	for (const [itemIndex, item] of reconciledDraft.takeoff_items.entries()) {
		const itemFields: EstimateMappingFieldReview[] = [];
		const componentFields: EstimateMappingFieldReview[] = [];

		if (item.cost_code_id) {
			const requestedCostCodeId = item.cost_code_id;
			reconcileCostCodeSelection(
				item,
				referenceData,
				reconciledDraft.classification_system_id ?? null
			);
			const costCodeId = item.cost_code_id;
			const costCode = costCodeId ? references.costCodes.get(costCodeId) : undefined;
			if (!costCode) {
				issues.push(
					buildIssue(
						'invalid_cost_code',
						`The cost code for ${item.name} is not available locally.`
					)
				);
				itemFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].cost_code_id`,
						label: 'Cost Code',
						path: `takeoff_items[${itemIndex}].cost_code_id`,
						target: 'takeoff_cost_code',
						status: 'unresolved',
						message: 'Choose a cost code or leave it blank.',
						required: false,
						allowClear: true,
						currentValue: requestedCostCodeId,
						resolvedValue: null,
						candidates: buildCostCodeCandidates(
							referenceData,
							reconciledDraft.classification_system_id ?? null
						)
					})
				);
			} else if (
				reconciledDraft.classification_system_id &&
				costCode.classificationSystemId !== reconciledDraft.classification_system_id
			) {
				issues.push(
					buildIssue(
						'invalid_cost_code_classification_pair',
						`The cost code for ${item.name} does not belong to the selected classification system.`
					)
				);
				item.cost_code_id = null;
				itemFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].cost_code_id`,
						label: 'Cost Code',
						path: `takeoff_items[${itemIndex}].cost_code_id`,
						target: 'takeoff_cost_code',
						status: 'unresolved',
						message: 'Choose a cost code that belongs to the selected classification.',
						required: false,
						allowClear: true,
						currentValue: costCode.id,
						resolvedValue: null,
						candidates: buildCostCodeCandidates(
							referenceData,
							reconciledDraft.classification_system_id ?? null
						)
					})
				);
			}
		}

		if (item.wbs_node_id) {
			const requestedWbsNodeId = item.wbs_node_id;
			reconcileTakeoffWbsSelection(item, referenceData);
			if (!item.wbs_node_id || !references.wbsNodes.has(item.wbs_node_id)) {
				issues.push(
					buildIssue(
						'invalid_wbs_node',
						`The structure node for ${item.name} is not available locally.`
					)
				);
				itemFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].wbs_node_id`,
						label: 'Structure',
						path: `takeoff_items[${itemIndex}].wbs_node_id`,
						target: 'takeoff_wbs',
						status: 'unresolved',
						message: 'Choose a structure node or leave it blank.',
						required: false,
						allowClear: true,
						currentValue: requestedWbsNodeId,
						resolvedValue: null,
						candidates: buildWbsCandidates(referenceData)
					})
				);
			}
		}

		if (item.cost_components.length === 0) {
			const seededComponent = seedLikelyTakeoffComponent(item, referenceData);
			if (seededComponent) {
				item.cost_components = [seededComponent.component];
			}
		}

		for (const [componentIndex, component] of item.cost_components.entries()) {
			const parityResolution = reconcileWorkspaceSourceParity(component, referenceData);
			item.cost_components[componentIndex] = parityResolution.component;
			const nextComponent = item.cost_components[componentIndex]!;
			const expectedSourceType = expectedLinkedSourceType(nextComponent.category);
			if (parityResolution.rejectedSource) {
				issues.push(
					buildIssue(
						invalidSourceIssueCode(parityResolution.rejectedSource.type),
						`The linked source for ${nextComponent.name} on ${item.name} does not exist locally or is incompatible with its category or unit.`
					)
				);
				componentFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
						label: `${nextComponent.name} source`,
						path: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
						target: 'component_source',
						status: 'unresolved',
						message: 'Choose an exact compatible linked source or keep this row manual.',
						required: true,
						allowClear: true,
						currentValue: parityResolution.rejectedSource.id,
						resolvedValue: null,
						candidates: buildSourceCandidates(referenceData, expectedSourceType ?? 'manual')
					})
				);
			}
			if (parityResolution.ambiguousSourceCount) {
				issues.push(
					buildIssue(
						'ambiguous_linked_source',
						`${nextComponent.name} on ${item.name} matches ${parityResolution.ambiguousSourceCount} compatible workspace records and must be resolved manually.`
					)
				);
				componentFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
						label: `${nextComponent.name} source`,
						path: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
						target: 'component_source',
						status: 'unresolved',
						message: 'Choose the intended exact compatible linked source.',
						required: true,
						allowClear: true,
						currentValue: null,
						resolvedValue: null,
						candidates: buildSourceCandidates(referenceData, expectedSourceType ?? 'manual')
					})
				);
			}

			if (
				expectedSourceType &&
				nextComponent.source_type !== 'manual' &&
				nextComponent.source_type !== expectedSourceType
			) {
				issues.push(
					buildIssue(
						'invalid_component_source_category',
						`${nextComponent.name} is linked to a source type that does not fit the ${nextComponent.category} category.`
					)
				);
				nextComponent.source_type = 'manual';
				nextComponent.source_id = null;
				nextComponent.mapping_status = 'unresolved';
			}

			const sourceMap =
				nextComponent.source_type === 'material_catalog'
					? references.materialSources
					: nextComponent.source_type === 'labour_rate_card'
						? references.labourSources
						: nextComponent.source_type === 'equipment_rate_card'
							? references.equipmentSources
							: nextComponent.source_type === 'subcontract_rate_card'
								? references.subcontractSources
								: null;

			if (nextComponent.source_type !== 'manual') {
				if (!nextComponent.source_id || !sourceMap?.has(nextComponent.source_id)) {
					const currentValue = nextComponent.source_id ?? null;
					issues.push(
						buildIssue(
							invalidSourceIssueCode(nextComponent.source_type),
							`The linked source for ${nextComponent.name} on ${item.name} is not available locally.`
						)
					);
					nextComponent.source_type = 'manual';
					nextComponent.source_id = null;
					nextComponent.mapping_status = 'unresolved';
					componentFields.push(
						buildField({
							id: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
							label: `${nextComponent.name} source`,
							path: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].source_id`,
							target: 'component_source',
							status: 'unresolved',
							message: 'Choose a linked source or convert this row to manual.',
							required: true,
							allowClear: true,
							currentValue,
							resolvedValue: null,
							candidates: buildSourceCandidates(
								referenceData,
								nextComponent.source_type === 'manual'
									? (expectedSourceType ?? 'manual')
									: nextComponent.source_type
							)
						})
					);
				}
			}

			const allowedUnits = getCostComponentUnitOptions(nextComponent.category).map(
				(option) => option.value
			);
			if (!allowedUnits.includes(nextComponent.unit)) {
				issues.push(
					buildIssue(
						'invalid_component_unit_category',
						`${nextComponent.name} uses a unit that does not fit the ${nextComponent.category} category.`
					)
				);
				componentFields.push(
					buildField({
						id: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].unit`,
						label: `${nextComponent.name} unit`,
						path: `takeoff_items[${itemIndex}].cost_components[${componentIndex}].unit`,
						target: 'component_unit',
						status: 'needs_review',
						message: `Choose a unit that fits the ${nextComponent.category} category.`,
						required: true,
						allowClear: false,
						currentValue: nextComponent.unit,
						resolvedValue: nextComponent.unit,
						candidates: buildUnitCandidates(nextComponent.category)
					})
				);
			}

			if (!Number.isFinite(nextComponent.unit_rate) || nextComponent.unit_rate <= 0) {
				issues.push(
					buildIssue('missing_component_rate', `${nextComponent.name} needs a rate review.`)
				);
				nextComponent.mapping_status = 'unresolved';
			}
		}

		items.push({
			itemId: `${itemIndex}:${item.name}`,
			itemIndex,
			itemName: item.name,
			fields: itemFields,
			componentFields
		});
	}

	const review: EstimateMappingReview = {
		reconciledDraft,
		issues: dedupeIssues(issues),
		headerFields,
		items,
		preflight: {
			blockerCount: 0,
			warningCount: 0,
			reviewCount: 0,
			canFinalize: true
		}
	};

	const reviewFields = allReviewFields(review);
	const commercialBlockerCodes = new Set([
		'missing_component_rate',
		'invalid_material_source',
		'invalid_labour_source',
		'invalid_equipment_source',
		'invalid_subcontract_source',
		'invalid_linked_source',
		'ambiguous_linked_source',
		'invalid_component_source_category',
		'invalid_component_unit_category',
		'local_draft_missing_evidence_ref',
		'artifact_extraction_failed',
		'local_evidence_unavailable',
		'evidence_coverage_incomplete'
	]);
	const unresolvedFieldCount = reviewFields.filter(
		(field) => field.required && field.status !== 'matched' && field.status !== 'ignored'
	).length;
	const commercialIssueCount = review.issues.filter((issue) =>
		commercialBlockerCodes.has(issue.code)
	).length;
	review.preflight = {
		blockerCount: unresolvedFieldCount + commercialIssueCount,
		warningCount: review.issues.filter((issue) => issue.severity !== 'info').length,
		reviewCount: reviewFields.length,
		canFinalize: unresolvedFieldCount === 0 && commercialIssueCount === 0
	};

	return review;
}

export function buildDraftMatchingFromReconciledEstimate(params: {
	draft: AiDraftEstimate;
	contextSnapshot: AiEstimateContextSnapshot;
	issues?: AiIssue[];
}): AiDraftMatching {
	const referenceData = params.contextSnapshot.reference_data as EstimateContextReferenceData;
	const references = buildEstimateReferenceIndex(referenceData);

	const resolveSourceName = (
		sourceType: AiDraftEstimate['takeoff_items'][number]['cost_components'][number]['source_type'],
		sourceId: string | null | undefined
	): string | null => {
		if (!sourceId || sourceType === 'manual') return null;
		const sourceMap =
			sourceType === 'material_catalog'
				? references.materialSources
				: sourceType === 'labour_rate_card'
					? references.labourSources
					: sourceType === 'equipment_rate_card'
						? references.equipmentSources
						: sourceType === 'subcontract_rate_card'
							? references.subcontractSources
							: null;
		return sourceMap?.get(sourceId)?.label ?? null;
	};

	return {
		applied_template_id: params.draft.applied_template_id ?? null,
		applied_template_name: params.draft.applied_template_name ?? null,
		classification_system_id: params.draft.classification_system_id ?? null,
		wbs_root_node_id: params.draft.wbs_root_node_id ?? null,
		takeoff_items: params.draft.takeoff_items.map((item) => ({
			sort_order: item.sort_order,
			applied_preset_id: item.applied_preset_id ?? null,
			applied_preset_name: item.applied_preset_name ?? null,
			cost_code_id: item.cost_code_id ?? null,
			wbs_node_id: item.wbs_node_id ?? null,
			cost_components: item.cost_components.map((component) => {
				const metadata =
					component.metadata &&
					typeof component.metadata === 'object' &&
					!Array.isArray(component.metadata)
						? component.metadata
						: {};
				const aiMatch =
					typeof metadata.ai_match === 'object' &&
					metadata.ai_match &&
					!Array.isArray(metadata.ai_match)
						? (metadata.ai_match as Record<string, unknown>)
						: undefined;
				const matchStrategy =
					typeof aiMatch?.strategy === 'string'
						? aiMatch.strategy
						: typeof metadata.ai_match_strategy === 'string'
							? metadata.ai_match_strategy
							: null;
				const matchSignals = Array.isArray(aiMatch?.signals)
					? aiMatch.signals.filter((signal): signal is string => typeof signal === 'string')
					: Array.isArray(metadata.ai_match_signals)
						? metadata.ai_match_signals.filter(
								(signal): signal is string => typeof signal === 'string'
							)
						: [];

				return {
					category: component.category,
					sort_order: component.sort_order,
					source_type: component.source_type,
					source_id: component.source_id ?? null,
					source_name:
						resolveSourceName(component.source_type, component.source_id) ??
						(typeof metadata.ai_source_name === 'string' ? metadata.ai_source_name : null),
					mapping_status: component.mapping_status,
					match_strategy: matchStrategy,
					match_signals: matchSignals
				};
			})
		})),
		issues: [...(params.issues ?? params.draft.issues ?? [])]
	};
}
