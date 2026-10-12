import Fuse from 'fuse.js';
import Papa from 'papaparse';
import { z } from 'zod';

import {
	CLASSIFICATION_SYSTEM_TYPE_OPTIONS,
	EQUIPMENT_RATE_UNIT_CODES,
	LABOUR_RATE_UNIT_CODES,
	normaliseUnitCode,
	SUBCONTRACT_RATE_UNIT_CODES,
	WORKSPACE_COUNTRY_OPTIONS
} from '$lib/constants/index.js';
import {
	classificationSystemFormSchema,
	costCodeFormSchema,
	costComponentPresetFormSchema,
	CostComponentPresetRowSchema,
	contactFormSchema,
	equipmentRateCardFormSchema,
	estimateTemplateFormSchema,
	EstimateTemplateRowSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	projectStructureTemplateFormSchema,
	subcontractRateCardFormSchema
} from '$lib/schemas/index.js';
import {
	buildSetupImportPendingContactCompanyKey,
	deriveContactDisplayName,
	SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX
} from '$lib/services/contact-normalisation.js';
import { normaliseEmailValue as normalisePersistedEmailValue } from '$lib/services/email.js';
import { isValidEmailAddress, isValidGenericPhone } from '$lib/services/input-validation.js';
import { formatPhoneDraft } from '$lib/services/phone.js';
import type { Contact, CostCode, CostComponentPreset, EstimateTemplate } from '$lib/types/index.js';
import { parseAliasesInput } from '$lib/utils/aliases.js';
import {
	type SetupImportSchemaDigest,
	type SetupImportSchemaFieldDigest,
	type SetupImportSchemaTableDigest,
	type SetupImportTargetTable,
	SETUP_IMPORT_DIGEST_VERSION,
	setupImportTableDefinitions
} from '$lib/constants/setup-import-registry.js';

export type SetupImportMappingStatus = 'green' | 'yellow' | 'red' | 'ignored';
export type SetupImportSheetReadiness = 'ready' | 'needs_review' | 'blocked' | 'ignored';
export type SetupImportDuplicateMode = 'keep_existing' | 'update_matched';

export interface SetupImportWorkbookSheet {
	sheetId: string;
	sheetName: string;
	headers: string[];
	headerIssues: string[];
	headerRowNumber?: number;
	rowCount: number;
	rows: Array<Record<string, string>>;
	sourceRowNumbers?: number[];
	sampleRows: Array<Record<string, string>>;
}

export interface SetupImportWorkbook {
	fileName: string;
	fileExtension: string;
	sheets: SetupImportWorkbookSheet[];
}

export interface SetupImportSheetMapping {
	sourceColumn: string;
	targetField: string | null;
	status: SetupImportMappingStatus;
	confidence: 'high' | 'medium' | 'low';
	reason: string;
}

export interface SetupImportSheetAnalysis {
	sheetId: string;
	sheetName: string;
	targetTable: SetupImportTargetTable | null;
	readiness: SetupImportSheetReadiness;
	summary: string;
	unmatchedColumns: string[];
	ignoredColumns?: string[];
	missingRequiredFields: string[];
	mappings: SetupImportSheetMapping[];
}

export interface SetupImportAnalysis {
	workbookSummary: {
		importableSheetCount: number;
		ignoredSheetCount: number;
		reviewPriority: string[];
	};
	sheets: SetupImportSheetAnalysis[];
}

export interface SetupImportRowError {
	rowNumber: number;
	messages: string[];
	fieldIssues: Array<{ fieldId: string; message: string }>;
	raw: Record<string, string>;
	mappedValues: Record<string, string>;
}

export interface SetupImportSheetPreview {
	validRows: unknown[];
	errors: SetupImportRowError[];
	blocked: boolean;
	rowValidationDeferred?: boolean;
	skippedRowCount?: number;
}

export type SetupImportRowFieldOverrides = Record<number, Record<string, string>>;

export interface ParseSetupImportFileInput {
	fileName: string;
	text?: string;
	bytes?: Uint8Array;
}

export interface SetupImportLoadResult {
	workbook: SetupImportWorkbook;
	analysis: SetupImportAnalysis;
}

export type SetupImportCostPresetRow = z.infer<typeof costComponentPresetFormSchema> & {
	components_json?: CostComponentPreset['components'];
};

export type SetupImportEstimateTemplateRow = z.infer<typeof estimateTemplateFormSchema> & {
	estimate_json?: EstimateTemplate['estimate'];
};

export type SetupImportCatalogueRow<T> = T & { company_names?: string[] };

export type SetupImportProjectStructureTemplateRow = z.infer<
	typeof projectStructureTemplateFormSchema
>;

export interface SetupImportSheetPreviewOptions {
	rowOverrides?: SetupImportRowFieldOverrides;
	skippedRowNumbers?: number[] | Set<number>;
	workspaceCountryCode?: string | null;
	costCodeExistingCodes?: Array<Pick<CostCode, 'id' | 'code'>>;
	existingCompanyContacts?: Array<
		Pick<Contact, 'id' | 'kind' | 'display_name' | 'name' | 'company_name' | 'business_id_value'>
	>;
}

export interface SetupImportCostCodeHierarchyIssue {
	rowIndex: number;
	message: string;
}

export interface SetupImportCostCodeHierarchyResult<T> {
	orderedRows: Array<{ row: T; rowIndex: number }>;
	issues: SetupImportCostCodeHierarchyIssue[];
}

const MAX_SAMPLE_ROWS = 8;
const MAX_WORKBOOK_SHEETS = 24;
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLUMNS = 80;
const MAX_TOTAL_CELLS = 100000;
const MAX_CELL_LENGTH = 2000;

export { buildSetupImportPendingContactCompanyKey, SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX };

type SetupImportFieldScore = {
	fieldId: string;
	score: number;
	headerScore: number;
	valueScore: number;
	contextScore: number;
};

type SetupImportTableScore = {
	tableId: SetupImportTargetTable;
	score: number;
	matchCount: number;
	requiredMatchCount: number;
};

type SetupImportStrongFieldMatch = {
	fieldId: string;
	score: number;
	reason: string;
};

function buildIgnoredMappingReason(): string {
	return 'Ignored by default';
}

function normaliseSheetId(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'sheet'
	);
}

function normaliseCellValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString().slice(0, 10);
	}
	return String(value).trim();
}

function getSourceRowNumber(sheet: SetupImportWorkbookSheet, rowIndex: number): number {
	return sheet.sourceRowNumbers?.[rowIndex] ?? rowIndex + 2;
}

function assertSheetSizeWithinSetupImportLimits(sheetName: string, rows: string[][]): void {
	if (rows.length > MAX_SHEET_ROWS) {
		throw new Error(
			`Sheet "${sheetName}" has ${rows.length} rows. Setup import supports up to ${MAX_SHEET_ROWS} rows per sheet.`
		);
	}

	let totalCells = 0;
	for (const [rowIndex, row] of rows.entries()) {
		if (row.length > MAX_SHEET_COLUMNS) {
			throw new Error(
				`Sheet "${sheetName}" row ${rowIndex + 1} has ${row.length} columns. Setup import supports up to ${MAX_SHEET_COLUMNS} columns.`
			);
		}
		totalCells += row.length;
		if (totalCells > MAX_TOTAL_CELLS) {
			throw new Error(
				`Sheet "${sheetName}" is too large for setup import. Reduce the workbook to ${MAX_TOTAL_CELLS} cells or fewer.`
			);
		}
		if (row.some((value) => value.length > MAX_CELL_LENGTH)) {
			throw new Error(
				`Sheet "${sheetName}" row ${rowIndex + 1} contains a cell longer than ${MAX_CELL_LENGTH} characters.`
			);
		}
	}
}

function assertWorkbookSheetCountWithinSetupImportLimits(sheetCount: number): void {
	if (sheetCount > MAX_WORKBOOK_SHEETS) {
		throw new Error(
			`This workbook has ${sheetCount} sheets. Setup import supports up to ${MAX_WORKBOOK_SHEETS} sheets at a time.`
		);
	}
}

function parseDelimitedAliases(value: string): string[] {
	return parseAliasesInput(value);
}

function parseDelimitedCompanyNames(value: string): string[] {
	return [
		...new Set(
			value
				.split(';')
				.map((name) => name.trim())
				.filter(Boolean)
		)
	];
}

function buildCatalogueCommercialValues(row: Record<string, string>) {
	return {
		currency_code: row.currency_code?.trim().toUpperCase() || undefined,
		effective_date: row.effective_date?.trim() || '',
		verified_date: row.verified_date?.trim() || '',
		rate_basis: row.rate_basis?.trim().toLowerCase() || 'cost',
		lead_time: row.lead_time?.trim() || '',
		availability: row.availability?.trim() || '',
		reference: row.reference?.trim() || ''
	};
}

function collectHeaderIssues(headers: string[]): string[] {
	const issues: string[] = [];
	const seen = new Set<string>();

	headers.forEach((header, index) => {
		if (!header) {
			issues.push(`Blank column header in position ${index + 1}`);
			return;
		}

		const key = header.toLowerCase();
		if (seen.has(key)) {
			issues.push(`Duplicate column header: ${header}`);
			return;
		}

		seen.add(key);
	});

	return issues;
}

function looksHeaderNoiseValue(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return true;
	if (trimmed.length > 56) return true;
	if (looksNumericLike(trimmed)) return true;
	return /[.:;!?]/.test(trimmed) || trimmed.split(/\s+/).length >= 6;
}

function scoreExplicitHeaderTerms(value: string): number {
	if (looksHeaderNoiseValue(value)) return 0;
	const normalised = normaliseLookupValue(value);
	if (!normalised) return 0;
	const tokens = normalised.split('_').filter(Boolean);
	const headerTerms = new Set([
		'name',
		'code',
		'type',
		'default',
		'email',
		'phone',
		'address',
		'country',
		'unit',
		'rate',
		'notes',
		'description',
		'status',
		'active',
		'category',
		'contact',
		'company',
		'customer',
		'client',
		'system',
		'family',
		'preset'
	]);
	return tokens.reduce((score, token) => score + (headerTerms.has(token) ? 2 : 0), 0);
}

function scoreHeaderCandidateRow(rows: string[][], rowIndex: number): number {
	const row = rows[rowIndex] ?? [];
	const nonEmptyValues = row.map(normaliseCellValue).filter(Boolean);
	if (nonEmptyValues.length < 2) return Number.NEGATIVE_INFINITY;

	const uniqueCount = new Set(nonEmptyValues.map((value) => value.toLowerCase())).size;
	const nearbyRows = rows.slice(rowIndex + 1, rowIndex + 4);
	const populatedColumnsBelow = row.reduce((count, value, columnIndex) => {
		if (!normaliseCellValue(value)) return count;
		return (
			count +
			(nearbyRows.some((candidate) => normaliseCellValue(candidate[columnIndex]) !== '') ? 1 : 0)
		);
	}, 0);
	const compactHeaderLikeCount = nonEmptyValues.filter(
		(value) => !looksHeaderNoiseValue(value)
	).length;
	const noisyValueCount = nonEmptyValues.length - compactHeaderLikeCount;
	const explicitHeaderTermScore = nonEmptyValues.reduce(
		(score, value) => score + scoreExplicitHeaderTerms(value),
		0
	);
	const firstRowBias = rowIndex === 0 ? 4 : 0;

	return (
		nonEmptyValues.length * 4 +
		populatedColumnsBelow * 3 +
		compactHeaderLikeCount * 2 +
		explicitHeaderTermScore +
		firstRowBias +
		(uniqueCount === nonEmptyValues.length ? 2 : -4) -
		noisyValueCount * 4
	);
}

function findHeaderRowIndex(rows: string[][]): number {
	const candidateLimit = Math.min(rows.length, 6);
	const candidates = Array.from({ length: candidateLimit }, (_, index) => ({
		index,
		score: scoreHeaderCandidateRow(rows, index)
	})).sort((left, right) => right.score - left.score);

	const bestCandidate = candidates[0];
	if (!bestCandidate || !Number.isFinite(bestCandidate.score) || bestCandidate.score < 8) {
		return 0;
	}

	return bestCandidate.index;
}

function rowsToSheetPayload(sheetName: string, rows: unknown[][]): SetupImportWorkbookSheet | null {
	const normalisedRows = rows.map((row) => row.map((value) => normaliseCellValue(value)));
	assertSheetSizeWithinSetupImportLimits(sheetName, normalisedRows);
	const nonEmptyRows = normalisedRows
		.map((row, index) => ({ row, sourceRowNumber: index + 1 }))
		.filter((entry) => entry.row.some((value) => value !== ''));
	if (nonEmptyRows.length === 0) return null;

	const headerRowIndex = findHeaderRowIndex(nonEmptyRows.map((entry) => entry.row));
	const headerEntry = nonEmptyRows[headerRowIndex];
	const headers = headerEntry?.row.map((value) => normaliseCellValue(value)) ?? [];
	const headerIssues = collectHeaderIssues(headers);
	const bodyRows = nonEmptyRows.slice(headerRowIndex + 1);
	if (headerIssues.length > 0) {
		return {
			sheetId: normaliseSheetId(sheetName),
			sheetName,
			headers,
			headerIssues,
			headerRowNumber: headerEntry?.sourceRowNumber ?? 1,
			rowCount: bodyRows.length,
			rows: [],
			sourceRowNumbers: [],
			sampleRows: []
		};
	}

	const mappedRows = bodyRows.map((entry) =>
		headers.reduce<Record<string, string>>((record, header, index) => {
			record[header] = normaliseCellValue(entry.row[index]);
			return record;
		}, {})
	);
	const sampleRows = mappedRows.slice(0, MAX_SAMPLE_ROWS);

	return {
		sheetId: normaliseSheetId(sheetName),
		sheetName,
		headers,
		headerIssues,
		headerRowNumber: headerEntry?.sourceRowNumber ?? 1,
		rowCount: bodyRows.length,
		rows: mappedRows,
		sourceRowNumbers: bodyRows.map((entry) => entry.sourceRowNumber),
		sampleRows
	};
}

function normaliseLookupValue(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function normaliseSearchValue(value: string): string {
	return normaliseLookupValue(value).replaceAll('_', ' ').trim();
}

function buildMissingCostCodeParentMessage(parentRef: string): string {
	return `Parent cost code "${parentRef}" must exist in this sheet or in the selected classification system.`;
}

function buildCircularCostCodeParentMessage(): string {
	return 'Cost codes contain a circular parent relationship.';
}

function inferCostCodeParentReference(code: string, availableCodes: Set<string>): string | null {
	const trimmed = code.trim();
	if (!trimmed) return null;
	const separators = ['.', '-', '/'];
	for (const separator of separators) {
		if (!trimmed.includes(separator)) continue;
		const candidate = trimmed.slice(0, trimmed.lastIndexOf(separator)).trim();
		if (candidate && availableCodes.has(normaliseLookupValue(candidate))) return candidate;
	}
	return null;
}

function inferCostCodeParentFromSourceRow(
	sourceRow: Record<string, string>,
	code: string
): string | null {
	const normalizedCode = normaliseLookupValue(code);
	if (!normalizedCode) return null;
	const pathEntry = Object.entries(sourceRow).find(([header, value]) => {
		const key = normaliseLookupValue(header);
		return value.trim() && (key === 'path' || key.endsWith('_path') || key.includes('hierarchy'));
	});
	if (pathEntry) {
		const parts = pathEntry[1]
			.split(/>|\/|\\|;/)
			.map((part) => part.trim())
			.filter(Boolean);
		const index = parts.findIndex((part) => normaliseLookupValue(part) === normalizedCode);
		if (index > 0) return parts[index - 1];
	}

	const levelEntries = Object.entries(sourceRow)
		.map(([header, value]) => {
			const match = normaliseLookupValue(header).match(/^(?:level|lvl)_(\d+)$/);
			return match && value.trim() ? { level: Number(match[1]), value: value.trim() } : null;
		})
		.filter((entry): entry is { level: number; value: string } => !!entry)
		.sort((left, right) => left.level - right.level);
	const levelIndex = levelEntries.findIndex(
		(entry) => normaliseLookupValue(entry.value) === normalizedCode
	);
	if (levelIndex > 0) return levelEntries[levelIndex - 1].value;
	return null;
}

export function analyseCostCodeHierarchy<T extends { code: string; parent_id?: string | null }>(
	rows: T[],
	options: {
		existingCodes?: Array<Pick<CostCode, 'id' | 'code'>>;
	} = {}
): SetupImportCostCodeHierarchyResult<T> {
	const existingByCode = new Set(
		(options.existingCodes ?? []).map((item) => normaliseLookupValue(item.code))
	);
	const pendingSheetCodes = new Set(rows.map((row) => normaliseLookupValue(row.code)));
	const allAvailableCodes = new Set([...existingByCode, ...pendingSheetCodes]);
	const pendingRows = rows.map((row, rowIndex) => {
		const inferredParentRef = row.parent_id?.trim()
			? null
			: inferCostCodeParentReference(row.code, allAvailableCodes);
		const rowWithParent = inferredParentRef ? { ...row, parent_id: inferredParentRef } : row;
		return {
			row: rowWithParent,
			rowIndex,
			normalizedCode: normaliseLookupValue(row.code),
			normalizedParentRef: normaliseLookupValue(rowWithParent.parent_id ?? ''),
			sourceParentRef: rowWithParent.parent_id?.trim() || null
		};
	});
	const availableCodes = new Set(existingByCode);
	const orderedRows: Array<{ row: T; rowIndex: number }> = [];
	const issues: SetupImportCostCodeHierarchyIssue[] = [];

	while (pendingRows.length > 0) {
		let progressed = false;
		for (let index = 0; index < pendingRows.length; index += 1) {
			const candidate = pendingRows[index];
			if (
				candidate.sourceParentRef &&
				!availableCodes.has(candidate.normalizedParentRef) &&
				!pendingSheetCodes.has(candidate.normalizedParentRef)
			) {
				issues.push({
					rowIndex: candidate.rowIndex,
					message: buildMissingCostCodeParentMessage(candidate.sourceParentRef)
				});
				pendingSheetCodes.delete(candidate.normalizedCode);
				pendingRows.splice(index, 1);
				index -= 1;
				progressed = true;
				continue;
			}

			if (!candidate.sourceParentRef || availableCodes.has(candidate.normalizedParentRef)) {
				orderedRows.push({ row: candidate.row, rowIndex: candidate.rowIndex });
				availableCodes.add(candidate.normalizedCode);
				pendingSheetCodes.delete(candidate.normalizedCode);
				pendingRows.splice(index, 1);
				index -= 1;
				progressed = true;
			}
		}

		if (progressed) continue;

		for (const candidate of pendingRows) {
			issues.push({
				rowIndex: candidate.rowIndex,
				message: buildCircularCostCodeParentMessage()
			});
		}
		break;
	}

	return { orderedRows, issues };
}

function getTableDefinition(
	tableId: SetupImportTargetTable,
	digest: SetupImportSchemaDigest
): SetupImportSchemaTableDigest | null {
	return digest.tables.find((table) => table.id === tableId) ?? null;
}

export function getSetupImportFieldLabel(
	tableId: SetupImportTargetTable,
	fieldId: string,
	digest: SetupImportSchemaDigest = buildSetupImportSchemaDigest()
): string {
	return (
		getTableDefinition(tableId, digest)?.fields.find((field) => field.id === fieldId)?.label ??
		fieldId
	);
}

function formatIssueList(values: string[]): string {
	if (values.length === 0) return '';
	if (values.length === 1) return values[0];
	if (values.length === 2) return `${values[0]} or ${values[1]}`;
	return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
}

function toDisplayEnumValue(value: string): string {
	switch (value.trim().toLowerCase()) {
		case 'masterformat':
			return 'Masterformat';
		case 'uniformat':
			return 'Uniformat';
		case 'xactimate':
			return 'Xactimate';
		case 'custom':
			return 'Custom';
		default:
			return value
				.split(/[_\s-]+/)
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
				.join(' ');
	}
}

function formatSetupImportFieldIssueMessage(
	tableId: SetupImportTargetTable,
	fieldId: string,
	message: string,
	digest: SetupImportSchemaDigest
): string {
	const label = getSetupImportFieldLabel(tableId, fieldId, digest);
	const requiredMatch = message.match(/^(.*)\s+is required$/i);
	if (requiredMatch) {
		return `${label} is blank in this row`;
	}

	if (/expected boolean/i.test(message)) {
		return `${label} must be Yes or No`;
	}

	if (/expected number|received nan|invalid input: expected number/i.test(message)) {
		return `${label} must be a number`;
	}

	const enumValues = [...message.matchAll(/"([^"]+)"/g)].map((match) =>
		toDisplayEnumValue(match[1])
	);
	if (/^Invalid option:/i.test(message) && enumValues.length > 0) {
		return `${label} must be one of ${formatIssueList(enumValues)}`;
	}

	return message;
}

export function formatSetupImportRowMessages(
	tableId: SetupImportTargetTable,
	fieldIssues: Array<{ fieldId: string; message: string }>,
	digest: SetupImportSchemaDigest = buildSetupImportSchemaDigest()
): string[] {
	return fieldIssues.map((issue) =>
		formatSetupImportFieldIssueMessage(tableId, issue.fieldId, issue.message, digest)
	);
}

function buildFieldLookupCandidates(field: SetupImportSchemaFieldDigest): string[] {
	return [
		...new Set(
			[field.id, field.label, ...field.aliases, ...(field.keywords ?? [])]
				.map(normaliseLookupValue)
				.filter(Boolean)
		)
	];
}

function getStrongFieldMatch(
	sourceColumn: string,
	field: SetupImportSchemaFieldDigest
): SetupImportStrongFieldMatch | null {
	const source = normaliseLookupValue(sourceColumn);
	if (!source) return null;
	const sourceCompact = source.replaceAll('_', '');

	for (const candidate of buildFieldLookupCandidates(field)) {
		const candidateCompact = candidate.replaceAll('_', '');
		if (source === candidate) {
			return { fieldId: field.id, score: 16, reason: 'exact header match' };
		}
		if (sourceCompact === candidateCompact) {
			return { fieldId: field.id, score: 15, reason: 'exact alias match' };
		}
	}

	return null;
}

function scoreFieldTokenMatch(sourceColumn: string, field: SetupImportSchemaFieldDigest): number {
	const source = normaliseLookupValue(sourceColumn);
	if (!source) return 0;
	const sourceCompact = source.replaceAll('_', '');
	const sourceTokens = source.split('_').filter(Boolean);

	let bestScore = 0;
	for (const candidate of buildFieldLookupCandidates(field)) {
		const candidateCompact = candidate.replaceAll('_', '');
		if (source === candidate) return 12;
		if (sourceCompact === candidateCompact) bestScore = Math.max(bestScore, 11);
		if (source.includes(candidate) || candidate.includes(source))
			bestScore = Math.max(bestScore, 7);
		const candidateTokens = candidate.split('_').filter(Boolean);
		const overlap = candidateTokens.filter((token) => sourceTokens.includes(token)).length;
		if (overlap > 0) {
			bestScore = Math.max(bestScore, overlap * 3);
		}
	}

	return bestScore;
}

function scoreFieldHeaderMatch(
	table: SetupImportSchemaTableDigest,
	sourceColumn: string,
	field: SetupImportSchemaFieldDigest
): number {
	const directScore = scoreFieldTokenMatch(sourceColumn, field);
	const query = normaliseSearchValue(sourceColumn);
	if (!query) return directScore;

	const entries = table.fields.map((entry) => ({
		fieldId: entry.id,
		label: normaliseSearchValue(entry.label),
		id: normaliseSearchValue(entry.id),
		aliases: entry.aliases.map(normaliseSearchValue),
		keywords: (entry.keywords ?? []).map(normaliseSearchValue)
	}));
	const fuse = new Fuse(entries, {
		includeScore: true,
		ignoreLocation: true,
		threshold: 0.4,
		fieldNormWeight: 0.2,
		keys: [
			{ name: 'label', weight: 3 },
			{ name: 'aliases', weight: 2.6 },
			{ name: 'keywords', weight: 2.2 },
			{ name: 'id', weight: 1.4 }
		]
	});
	const result = fuse.search(query).find((entry) => entry.item.fieldId === field.id);
	if (!result || result.score === undefined) return directScore;

	const fuzzyScore = Math.round((1 - result.score) * 12);
	return Math.max(directScore, fuzzyScore);
}

type ContextScoreRule = {
	fieldId: string;
	match: RegExp | ((sourceColumn: string, columnValues: string[]) => boolean);
	score: number;
};

const CONTEXT_SCORE_RULES: Record<string, ContextScoreRule[]> = {
	contacts: [
		{
			fieldId: 'person_name',
			match: (sourceColumn, columnValues) =>
				looksLikePersonColumn(columnValues) || /attention|contact|person/i.test(sourceColumn),
			score: 6
		},
		{ fieldId: 'display_name', match: /client|customer|company|business|account/i, score: 8 },
		{ fieldId: 'company_name', match: /company|business|account/i, score: 3 },
		{ fieldId: 'country_code', match: /country/i, score: 4 },
		{ fieldId: 'country_code', match: /(^|[^a-z])(au\s*\/\s*nz|anz|region)([^a-z]|$)/i, score: 8 },
		{
			fieldId: 'business_id_value',
			match: /ref|reference|business id|client code|customer code/i,
			score: 5
		},
		{ fieldId: 'tax_id_value', match: /gst|vat|tax/i, score: 5 }
	],
	classification_systems: [
		{
			fieldId: 'name',
			match: /system name|family name|classification name|code family/i,
			score: 8
		},
		{ fieldId: 'code', match: /system code|family code/i, score: 10 },
		{ fieldId: 'code', match: /system ref|family ref/i, score: 5 },
		{
			fieldId: 'classification_type',
			match: /family type|classification type|system type|\btype\b/i,
			score: 8
		},
		{ fieldId: 'is_default', match: /default/i, score: 6 }
	],
	materials: [
		{ fieldId: 'code', match: /material code|material ref|material id|sku/i, score: 8 },
		{
			fieldId: 'name',
			match: /material name|material desc|material description|\bdescription\b/i,
			score: 8
		},
		{ fieldId: 'aliases', match: /alias|alternate names|aka|search terms|keywords/i, score: 8 },
		{ fieldId: 'unit', match: /uom|unit|unit of measure/i, score: 4 },
		{
			fieldId: 'default_rate',
			match: /unit cost|unit price|cost|price|buy rate|buy price/i,
			score: 6
		}
	],
	subcontract_rates: [
		{ fieldId: 'code', match: /subcontract code|vendor code|supplier code|trade code/i, score: 8 },
		{ fieldId: 'name', match: /scope description|subcontract name|trade|description/i, score: 8 },
		{ fieldId: 'aliases', match: /alias|alternate names|aka|search terms|keywords/i, score: 8 },
		{ fieldId: 'unit', match: /uom|unit|unit of measure/i, score: 4 },
		{
			fieldId: 'default_rate',
			match: /unit rate|unit price|subcontract rate|price|rate/i,
			score: 6
		},
		{ fieldId: 'is_active', match: /enabled|active|live/i, score: 6 }
	],
	labour_rates: [
		{ fieldId: 'name', match: /crew|title|charge name/i, score: 4 },
		{ fieldId: 'default_rate', match: /rate|hr|hour/i, score: 4 }
	],
	equipment_rates: [
		{ fieldId: 'code', match: /equipment code|plant code|gear code/i, score: 8 },
		{ fieldId: 'name', match: /equipment name|plant name|gear name|rate name/i, score: 8 },
		{ fieldId: 'aliases', match: /alias|alternate names|aka|search terms|keywords/i, score: 8 },
		{ fieldId: 'unit', match: /uom|unit|unit of measure/i, score: 4 },
		{ fieldId: 'default_rate', match: /hire rate|hourly rate|unit rate|rate/i, score: 6 },
		{ fieldId: 'is_active', match: /enabled|active|live/i, score: 6 }
	],
	cost_codes: [
		{ fieldId: 'parent_id', match: /parent|parent code|parent code ref/i, score: 8 },
		{ fieldId: 'code', match: /cost code|code id|code ref|\bcode\b/i, score: 10 },
		{ fieldId: 'name', match: /description|title|short description/i, score: 8 },
		{ fieldId: 'description', match: /long description|notes/i, score: 6 },
		{ fieldId: 'is_active', match: /enabled|active|live/i, score: 6 },
		{ fieldId: 'sort_order', match: /order|sequence/i, score: 6 }
	],
	cost_presets: [
		{ fieldId: 'code', match: /preset ref/i, score: 10 },
		{ fieldId: 'code', match: /preset code|\bcode\b/i, score: 8 },
		{ fieldId: 'name', match: /preset name|assembly name|preset title|\bname\b/i, score: 8 },
		{ fieldId: 'description', match: /preset notes|notes|description|desc/i, score: 6 },
		{ fieldId: 'aliases', match: /alias|alternate names|aka|search terms|keywords/i, score: 8 },
		{ fieldId: 'is_active', match: /enabled|active|live/i, score: 6 },
		{
			fieldId: 'components_json',
			match: /components json|components|component payload|preset json|assembly json|items json/i,
			score: 10
		}
	],
	estimate_templates: [
		{ fieldId: 'code', match: /template code|\bcode\b/i, score: 8 },
		{ fieldId: 'name', match: /template name|estimate name|template title|\bname\b/i, score: 8 },
		{ fieldId: 'description', match: /template notes|notes|description|desc/i, score: 6 },
		{ fieldId: 'aliases', match: /alias|alternate names|aka|search terms|keywords/i, score: 8 },
		{ fieldId: 'is_active', match: /enabled|active|live/i, score: 6 },
		{
			fieldId: 'estimate_json',
			match: /estimate json|template json|estimate payload|quote template data/i,
			score: 10
		}
	]
};

function getFieldContextScore(
	table: SetupImportSchemaTableDigest,
	field: SetupImportSchemaFieldDigest,
	sourceColumn: string,
	columnValues: string[]
): number {
	if (
		field.id === 'company_names' &&
		/(?:^|\b)(?:company|companies|supplier|suppliers|vendor|vendors)(?:\b|$)/i.test(sourceColumn)
	) {
		return 8;
	}
	const rules = CONTEXT_SCORE_RULES[table.id];
	if (!rules) return 0;

	for (const rule of rules) {
		if (rule.fieldId !== field.id) continue;

		if (rule.match instanceof RegExp) {
			if (rule.match.test(sourceColumn)) return rule.score;
		} else if (typeof rule.match === 'function') {
			if (rule.match(sourceColumn, columnValues)) return rule.score;
		}
	}

	return 0;
}

function scoreTableSheetNameMatch(table: SetupImportSchemaTableDigest, sheetName: string): number {
	const normalisedSheetName = normaliseLookupValue(sheetName);
	if (!normalisedSheetName) return 0;
	if (table.exactSheetNames.includes(normalisedSheetName)) return 100;

	const negativeMatch = (table.negativeKeywords ?? []).some((keyword) =>
		normalisedSheetName.includes(normaliseLookupValue(keyword))
	);
	if (negativeMatch) return -10;

	const sheetTokens = new Set(normalisedSheetName.split('_').filter(Boolean));
	const directSheetNameHit = [
		...table.exactSheetNames,
		...table.sheetNameHints,
		...(table.keywords ?? [])
	]
		.map(normaliseLookupValue)
		.filter(Boolean)
		.some((candidate) =>
			candidate.includes('_') ? normalisedSheetName.includes(candidate) : sheetTokens.has(candidate)
		);
	if (directSheetNameHit) return 20;

	const entries = [
		{
			id: table.id,
			label: normaliseSearchValue(table.label),
			exactSheetNames: table.exactSheetNames.map(normaliseSearchValue),
			sheetNameHints: table.sheetNameHints.map(normaliseSearchValue),
			keywords: (table.keywords ?? []).map(normaliseSearchValue)
		}
	];
	const fuse = new Fuse(entries, {
		includeScore: true,
		ignoreLocation: true,
		threshold: 0.42,
		fieldNormWeight: 0.2,
		keys: [
			{ name: 'exactSheetNames', weight: 3 },
			{ name: 'sheetNameHints', weight: 2.4 },
			{ name: 'keywords', weight: 1.8 },
			{ name: 'label', weight: 1.2 }
		]
	});
	const query = normaliseSearchValue(sheetName);
	const result = fuse.search(query)[0];
	if (!result || result.score === undefined) return 0;
	return Math.round((1 - result.score) * 10);
}

function hasContactInferenceSignals(mappings: SetupImportSheetMapping[]): boolean {
	const mappedFieldIds = new Set(
		mappings.flatMap((mapping) => (mapping.targetField ? [mapping.targetField] : []))
	);
	return [
		'display_name',
		'name',
		'company_name',
		'person_name',
		'person_first_name',
		'person_last_name'
	].some((fieldId) => mappedFieldIds.has(fieldId));
}

function inferTargetTableForSheet(
	sheet: SetupImportWorkbookSheet,
	digest: SetupImportSchemaDigest
): SetupImportTargetTable | null {
	const candidates = digest.tables
		.map<SetupImportTableScore>((table) => {
			const scores = sheet.headers.map((header, index) => {
				const columnValues = sheet.rows.map((row) => row[header] ?? '').filter(Boolean);
				return Math.max(
					...table.fields.map(
						(field) =>
							scoreFieldHeaderMatch(table, header, field) +
							scoreFieldValueShape(field.id, field.type, columnValues) +
							getFieldContextScore(table, field, header, columnValues) +
							(index === 0 && field.required ? 1 : 0)
					),
					0
				);
			});
			return {
				tableId: table.id,
				matchCount: scores.filter((score) => score >= 7).length,
				requiredMatchCount: table.fields.filter((field) => {
					if (!field.required) return false;
					return sheet.headers.some((header) => {
						const columnValues = sheet.rows.map((row) => row[header] ?? '').filter(Boolean);
						return (
							scoreFieldHeaderMatch(table, header, field) +
								scoreFieldValueShape(field.id, field.type, columnValues) +
								getFieldContextScore(table, field, header, columnValues) >=
							9
						);
					});
				}).length,
				score:
					scores.reduce((sum, score) => sum + score, 0) +
					scoreTableSheetNameMatch(table, sheet.sheetName)
			};
		})
		.sort((left, right) => right.score - left.score);

	const [best, second] = candidates;
	if (!best) return null;
	if (best.matchCount < 2 && best.requiredMatchCount === 0) return null;
	if (best.score < (best.requiredMatchCount > 0 ? 14 : 16)) return null;
	if (second && best.score < second.score + 3) return null;
	return best.tableId;
}

function buildFieldScore(
	table: SetupImportSchemaTableDigest,
	field: SetupImportSchemaFieldDigest,
	sourceColumn: string,
	columnValues: string[]
): SetupImportFieldScore {
	if (
		field.id === 'company_names' &&
		!/(?:^|\b)(?:company|companies|supplier|suppliers|vendor|vendors)(?:\b|$)/i.test(sourceColumn)
	) {
		return { fieldId: field.id, headerScore: 0, valueScore: 0, contextScore: 0, score: 0 };
	}
	const strongMatch = getStrongFieldMatch(sourceColumn, field);
	const headerScore = Math.max(
		scoreFieldHeaderMatch(table, sourceColumn, field),
		strongMatch?.score ?? 0
	);
	const valueScore = scoreFieldValueShape(field.id, field.type, columnValues);
	const contextScore = getFieldContextScore(table, field, sourceColumn, columnValues);
	return {
		fieldId: field.id,
		headerScore,
		valueScore,
		contextScore,
		score: headerScore + valueScore + contextScore
	};
}

function buildSuggestedMappingsForTable(
	workbookSheet: SetupImportWorkbookSheet,
	table: SetupImportSchemaTableDigest
): SetupImportSheetMapping[] {
	// Inference-only columns consumed internally (e.g. by inferCostCodeParentFromSourceRow).
	// These are not DB fields so cannot appear in the registry; detect them by a hardcoded alias set
	// keyed by table ID so the lookup stays close to the inference implementation.
	const INFERENCE_ALIASES_BY_TABLE: Record<string, readonly string[]> = {
		cost_codes: [
			'path',
			'hierarchy_path',
			'code_path',
			'full_path',
			'breadcrumb',
			'level_1',
			'level_2',
			'level_3',
			'level_4',
			'level_5',
			'lvl_1',
			'lvl_2',
			'lvl_3',
			'l1',
			'l2',
			'l3'
		]
	};
	const inferenceAliasSet = new Set(INFERENCE_ALIASES_BY_TABLE[table.id] ?? []);

	// All registry fields are importable (the alignment checker enforces this).
	const importableFields = table.fields;

	const candidateScores = workbookSheet.headers.map((header) => {
		const columnValues = workbookSheet.rows.map((row) => row[header] ?? '').filter(Boolean);
		return {
			header,
			columnValues,
			scores: importableFields
				.map((field) => buildFieldScore(table, field, header, columnValues))
				.sort((left, right) => right.score - left.score)
		};
	});

	const assignments = new Map<string, SetupImportFieldScore>();
	const claimedFieldIds = new Set<string>();
	for (const column of candidateScores) {
		const exactScore = column.scores.find((score) => {
			const source = normaliseLookupValue(column.header).replaceAll('_', '');
			const field = normaliseLookupValue(score.fieldId).replaceAll('_', '');
			const digestField = importableFields.find((entry) => entry.id === score.fieldId);
			const shouldPreclaimExactField =
				digestField?.required || (table.id === 'contacts' && score.fieldId === 'company_name');
			return source && source === field && score.score >= 15 && shouldPreclaimExactField;
		});
		if (!exactScore || claimedFieldIds.has(exactScore.fieldId)) continue;
		assignments.set(column.header, exactScore);
		claimedFieldIds.add(exactScore.fieldId);
	}
	const pairScores = candidateScores
		.flatMap((column) =>
			column.scores.map((score) => ({
				sourceColumn: column.header,
				score,
				isRequired: importableFields.find((field) => field.id === score.fieldId)?.required ?? false
			}))
		)
		.sort((left, right) => {
			const scoreDiff = right.score.score - left.score.score;
			// Required fields beat non-required fields when scores are within 1 point
			const requiredDiff = (right.isRequired ? 1 : 0) - (left.isRequired ? 1 : 0);
			if (requiredDiff !== 0 && Math.abs(scoreDiff) <= 1) return requiredDiff;
			return scoreDiff;
		});

	for (const pair of pairScores) {
		if (pair.score.score < 7) continue;
		if (assignments.has(pair.sourceColumn)) continue;
		if (claimedFieldIds.has(pair.score.fieldId)) continue;
		assignments.set(pair.sourceColumn, pair.score);
		claimedFieldIds.add(pair.score.fieldId);
	}

	const hasExplicitPersonColumn =
		table.id === 'contacts' &&
		workbookSheet.headers.some((header) =>
			/contact person|person name|contact name|main contact/i.test(header)
		);

	if (table.id === 'contacts' && hasExplicitPersonColumn) {
		for (const column of candidateScores) {
			if (!/company name|business name/i.test(column.header)) continue;
			const companyNameScore =
				column.scores.find((score) => score.fieldId === 'company_name') ?? null;
			if (!companyNameScore || companyNameScore.score < 7) continue;

			const currentAssignment = assignments.get(column.header);
			if (!currentAssignment || currentAssignment.fieldId === 'display_name') {
				if (currentAssignment) {
					claimedFieldIds.delete(currentAssignment.fieldId);
				}
				assignments.set(column.header, companyNameScore);
				claimedFieldIds.add(companyNameScore.fieldId);
			}
		}
	}

	return workbookSheet.headers.map((header, index) => {
		const sourceLabel = header || `Column ${index + 1}`;

		// Auto-ignore columns that match inference-only fields (e.g. path, level 1)
		if (inferenceAliasSet.size > 0) {
			const normalisedHeader = normaliseLookupValue(header);
			if (normalisedHeader && inferenceAliasSet.has(normalisedHeader)) {
				return {
					sourceColumn: sourceLabel,
					targetField: null,
					status: 'ignored' as const,
					confidence: 'high' as const,
					reason: 'Used for hierarchy inference'
				};
			}
		}

		const columnValues = workbookSheet.rows.map((row) => row[header] ?? '').filter(Boolean);
		const assigned = assignments.get(header) ?? null;
		let mapping: SetupImportSheetMapping = {
			sourceColumn: sourceLabel,
			targetField: null,
			status: 'red',
			confidence: 'low',
			reason: 'Needs review'
		};

		if (assigned) {
			const second = candidateScores
				.find((entry) => entry.header === header)
				?.scores.find((score) => score.fieldId !== assigned.fieldId);
			const reasonParts: string[] = [];
			if (assigned.headerScore >= 12) reasonParts.push('exact header match');
			if (assigned.headerScore >= 8) reasonParts.push('alias/header match');
			if (assigned.valueScore >= 4) reasonParts.push('sample values');
			if (assigned.contextScore > 0) reasonParts.push('table context');

			const sourceMatchesExactFieldId =
				normaliseLookupValue(header).replaceAll('_', '') ===
				normaliseLookupValue(assigned.fieldId).replaceAll('_', '');
			const isConfident =
				sourceMatchesExactFieldId ||
				(assigned.score >= 11 && (!second || assigned.score > second.score + 1));
			mapping = {
				sourceColumn: header || `Column ${index + 1}`,
				targetField: assigned.fieldId,
				status: isConfident ? 'green' : 'yellow',
				confidence: isConfident ? 'high' : 'medium',
				reason: `${isConfident ? 'Matched' : 'Likely match'} from ${reasonParts.join(' + ') || 'header analysis'}`
			};
		}

		if (mapping.targetField) {
			const ambiguityReason = getAmbiguityReason(mapping.targetField, columnValues);
			if (ambiguityReason && mapping.status === 'green') {
				mapping = {
					...mapping,
					status: 'yellow',
					confidence: 'medium',
					reason: ambiguityReason
				};
			}
		}

		return mapping;
	});
}

export function deriveSetupImportSheetReadiness(
	table: SetupImportSchemaTableDigest,
	mappings: SetupImportSheetMapping[]
): {
	readiness: SetupImportSheetReadiness;
	missingRequiredFields: string[];
	unmatchedColumns: string[];
	ignoredColumns: string[];
} {
	const mappedFieldIds = new Set(
		mappings.flatMap((mapping) => (mapping.targetField ? [mapping.targetField] : []))
	);
	const missingRequiredFields = table.fields
		.filter((field) => {
			if (!field.required) return false;
			if (mappedFieldIds.has(field.id)) return false;
			if (table.id !== 'contacts') return true;
			if (field.id === 'kind') return !hasContactInferenceSignals(mappings);
			if (field.id === 'name' || field.id === 'display_name') {
				return ![
					'name',
					'display_name',
					'company_name',
					'person_name',
					'person_first_name',
					'person_last_name'
				].some((fieldId) => mappedFieldIds.has(fieldId));
			}
			return true;
		})
		.map((field) => field.id);

	return {
		readiness:
			missingRequiredFields.length > 0
				? 'blocked'
				: mappings.some((mapping) => mapping.status === 'yellow' || mapping.status === 'red')
					? 'needs_review'
					: 'ready',
		missingRequiredFields,
		unmatchedColumns: mappings
			.filter((mapping) => mapping.status === 'red')
			.map((mapping) => mapping.sourceColumn),
		ignoredColumns: mappings
			.filter((mapping) => mapping.status === 'ignored')
			.map((mapping) => mapping.sourceColumn)
	};
}

function autoIgnoreOptionalMappings(
	table: SetupImportSchemaTableDigest,
	mappings: SetupImportSheetMapping[]
): SetupImportSheetMapping[] {
	const readiness = deriveSetupImportSheetReadiness(table, mappings);
	if (readiness.missingRequiredFields.length > 0) return mappings;

	return mappings.map((mapping) =>
		mapping.status === 'red'
			? {
					...mapping,
					status: 'ignored',
					reason: buildIgnoredMappingReason()
				}
			: mapping
	);
}

export function suggestSetupImportSheetForTargetTable(
	workbookSheet: SetupImportWorkbookSheet,
	sheet: SetupImportSheetAnalysis,
	targetTable: SetupImportTargetTable,
	digest: SetupImportSchemaDigest
): SetupImportSheetAnalysis {
	const table = digest.tables.find((entry) => entry.id === targetTable);
	if (!table) {
		return {
			...sheet,
			targetTable,
			readiness: 'blocked',
			summary: 'Target table is unavailable'
		};
	}

	const mappings = autoIgnoreOptionalMappings(
		table,
		buildSuggestedMappingsForTable(workbookSheet, table)
	);
	const { readiness, missingRequiredFields, unmatchedColumns, ignoredColumns } =
		deriveSetupImportSheetReadiness(table, mappings);

	return {
		...sheet,
		targetTable,
		readiness,
		summary: table.label,
		unmatchedColumns,
		ignoredColumns,
		missingRequiredFields,
		mappings
	};
}

function looksLikeEmail(value: string): boolean {
	return isValidEmailAddress(value);
}

function looksLikePhone(value: string): boolean {
	return isValidGenericPhone(value);
}

function looksLikePersonName(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (looksLikeEmail(trimmed) || looksLikePhone(trimmed) || looksNumericLike(trimmed)) return false;
	return /^[A-Za-z][A-Za-z' -]+(?:\s+[A-Za-z][A-Za-z' -]+)+$/.test(trimmed);
}

function looksLikePersonColumn(values: string[]): boolean {
	const nonEmptyValues = values.map((value) => value.trim()).filter(Boolean);
	if (nonEmptyValues.length === 0) return false;
	const matches = nonEmptyValues.filter(looksLikePersonName).length / nonEmptyValues.length;
	return matches >= 0.6;
}

function looksBooleanLike(value: string): boolean {
	return ['1', '0', 'true', 'false', 'yes', 'no', 'y', 'n'].includes(value.trim().toLowerCase());
}

function looksCountryCode(value: string): boolean {
	return /^[A-Z]{2}$/i.test(value.trim());
}

function looksNumericLike(value: string): boolean {
	return value.trim().length > 0 && !Number.isNaN(Number(value.replace(/[$,%\s,]/g, '')));
}

function looksUnitLike(value: string): boolean {
	return normaliseUnitCode(value) !== null;
}

function looksCodeLike(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length >= 4 && /^[A-Z0-9][A-Z0-9/_-]{1,23}$/i.test(trimmed);
}

function looksJsonLike(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function scoreFieldValueShape(
	fieldId: string,
	fieldType: SetupImportSchemaFieldDigest['type'],
	values: string[]
): number {
	const nonEmptyValues = values.map((value) => value.trim()).filter(Boolean);
	if (nonEmptyValues.length === 0) return 0;

	const ratio = (predicate: (value: string) => boolean): number =>
		nonEmptyValues.filter(predicate).length / nonEmptyValues.length;

	if (fieldId === 'email') {
		const emailRatio = ratio(looksLikeEmail);
		if (emailRatio >= 0.85) return 8;
		if (emailRatio >= 0.6) return 4;
		return 0;
	}

	if (fieldId === 'phone') {
		const phoneRatio = ratio(looksLikePhone);
		if (phoneRatio >= 0.85) return 7;
		if (phoneRatio >= 0.6) return 3;
		return 0;
	}

	if (
		(fieldId === 'person_name' ||
			fieldId === 'person_first_name' ||
			fieldId === 'person_last_name') &&
		looksLikePersonColumn(nonEmptyValues)
	) {
		return 6;
	}

	if (fieldId === 'country_code') {
		const countryRatio = ratio(looksCountryCode);
		if (countryRatio >= 0.85) return 8;
		if (countryRatio >= 0.6) return 4;
		return 0;
	}

	if (fieldType === 'boolean') {
		const booleanRatio = ratio(looksBooleanLike);
		if (booleanRatio >= 0.85) return 7;
		if (booleanRatio >= 0.6) return 3;
		return 0;
	}

	if (fieldType === 'number') {
		const numericRatio = ratio(looksNumericLike);
		if (numericRatio >= 0.9) return 6;
		if (numericRatio >= 0.65) return 3;
		return 0;
	}

	if (fieldId === 'unit') {
		const unitRatio = ratio(looksUnitLike);
		if (unitRatio >= 0.75) return 7;
		if (unitRatio >= 0.5) return 4;
		return 0;
	}

	if (fieldId === 'components_json' || fieldId === 'estimate_json') {
		const jsonRatio = ratio(looksJsonLike);
		if (jsonRatio >= 0.75) return 8;
		if (jsonRatio >= 0.5) return 4;
		return 0;
	}

	if (fieldId === 'code' || fieldId.endsWith('_id') || fieldId === 'business_id_value') {
		const codeRatio = ratio(looksCodeLike);
		if (codeRatio >= 0.75) return 5;
		if (codeRatio >= 0.5) return 2;
	}

	return 0;
}

function countPatternMatches(value: string, pattern: RegExp): number {
	return Array.from(value.matchAll(pattern)).length;
}

function getAmbiguityReason(targetField: string, values: string[]): string | null {
	const nonEmptyValues = values.map((value) => value.trim()).filter(Boolean);
	if (nonEmptyValues.length === 0) return null;

	if (targetField === 'email') {
		const validCount = nonEmptyValues.filter(looksLikeEmail).length;
		const hasMultipleEmails = nonEmptyValues.some(
			(value) => countPatternMatches(value, /[^\s@]+@[^\s@]+\.[^\s@]+/gi) > 1
		);
		if (hasMultipleEmails || (validCount > 0 && validCount < nonEmptyValues.length)) {
			return 'Some sample values contain multiple or inconsistent email values. Review before import.';
		}
	}

	if (targetField === 'phone') {
		const validCount = nonEmptyValues.filter(looksLikePhone).length;
		const hasMultiplePhones = nonEmptyValues.some(
			(value) => countPatternMatches(value, /\+?\d[\d\s().-]{5,}/g) > 1
		);
		if (hasMultiplePhones || (validCount > 0 && validCount < nonEmptyValues.length)) {
			return 'Some sample values contain multiple or inconsistent phone values. Review before import.';
		}
	}

	return null;
}

function buildReviewPriority(sheets: SetupImportSheetAnalysis[]): string[] {
	return sheets.filter((sheet) => sheet.readiness !== 'ready').map((sheet) => sheet.sheetId);
}

function buildBlockedSheetAnalysis(sheet: SetupImportWorkbookSheet): SetupImportSheetAnalysis {
	return {
		sheetId: sheet.sheetId,
		sheetName: sheet.sheetName,
		targetTable: null,
		readiness: 'blocked',
		summary: 'Fix spreadsheet headers before import',
		unmatchedColumns: [],
		ignoredColumns: [],
		missingRequiredFields: [],
		mappings: sheet.headers.map((header, index) => ({
			sourceColumn: header || `Column ${index + 1}`,
			targetField: null,
			status: 'red',
			confidence: 'low',
			reason: sheet.headerIssues.join(' · ')
		}))
	};
}

function buildIgnoredSheetAnalysis(sheet: SetupImportWorkbookSheet): SetupImportSheetAnalysis {
	return {
		sheetId: sheet.sheetId,
		sheetName: sheet.sheetName,
		targetTable: null,
		readiness: 'ignored',
		summary: 'Choose a table to begin',
		unmatchedColumns: [...sheet.headers],
		ignoredColumns: [],
		missingRequiredFields: [],
		mappings: sheet.headers.map((header, index) => ({
			sourceColumn: header || `Column ${index + 1}`,
			targetField: null,
			status: 'red',
			confidence: 'low',
			reason: 'Needs review'
		}))
	};
}

function analyseSheetLocally(
	workbookSheet: SetupImportWorkbookSheet,
	digest: SetupImportSchemaDigest
): SetupImportSheetAnalysis {
	if (workbookSheet.headerIssues.length > 0) {
		return buildBlockedSheetAnalysis(workbookSheet);
	}

	const targetTable = inferTargetTableForSheet(workbookSheet, digest);
	if (!targetTable) {
		return buildIgnoredSheetAnalysis(workbookSheet);
	}

	const table = digest.tables.find((entry) => entry.id === targetTable);
	if (!table) {
		return {
			...buildIgnoredSheetAnalysis(workbookSheet),
			readiness: 'blocked',
			summary: 'Target table is unavailable'
		};
	}

	const mappings = autoIgnoreOptionalMappings(
		table,
		buildSuggestedMappingsForTable(workbookSheet, table)
	);
	const { readiness, missingRequiredFields, unmatchedColumns, ignoredColumns } =
		deriveSetupImportSheetReadiness(table, mappings);

	return {
		sheetId: workbookSheet.sheetId,
		sheetName: workbookSheet.sheetName,
		targetTable,
		readiness,
		summary: table.label,
		unmatchedColumns,
		ignoredColumns,
		missingRequiredFields,
		mappings
	};
}

export async function analyseSetupImportWorkbook(
	workbook: SetupImportWorkbook,
	options?: { localOnly?: boolean }
): Promise<SetupImportAnalysis> {
	void options;
	const digest = buildSetupImportSchemaDigest();
	const sheets = workbook.sheets.map((sheet) => analyseSheetLocally(sheet, digest));

	return {
		workbookSummary: {
			importableSheetCount: sheets.filter((sheet) => sheet.targetTable).length,
			ignoredSheetCount: sheets.filter((sheet) => sheet.readiness === 'ignored').length,
			reviewPriority: buildReviewPriority(sheets)
		},
		sheets
	};
}

function parseCsvRows(text: string): string[][] {
	const parsed = Papa.parse<string[]>(text, {
		delimiter: '',
		skipEmptyLines: true
	});
	if (parsed.errors.length > 0 && parsed.data.length === 0) {
		throw new Error(parsed.errors[0]?.message || 'The CSV file could not be parsed.');
	}

	return parsed.data.map((row: string[]) => row.map((value: string) => normaliseCellValue(value)));
}

export function buildSetupImportSchemaDigest(): SetupImportSchemaDigest {
	return {
		digestVersion: SETUP_IMPORT_DIGEST_VERSION,
		tables: setupImportTableDefinitions.map(({ formSchema, ...tableDigest }) => {
			void formSchema;
			return tableDigest;
		})
	};
}

export async function parseSetupImportFile(
	input: ParseSetupImportFileInput,
	options?: { localOnly?: boolean }
): Promise<SetupImportWorkbook> {
	void options;
	const extension = input.fileName.split('.').pop()?.toLowerCase() ?? '';

	if (extension === 'csv') {
		const text = input.text ?? '';
		const rows = parseCsvRows(text);
		assertWorkbookSheetCountWithinSetupImportLimits(1);
		const sheet = rowsToSheetPayload(input.fileName.replace(/\.csv$/i, ''), rows);
		return {
			fileName: input.fileName,
			fileExtension: extension,
			sheets: sheet ? [sheet] : []
		};
	}

	if (extension !== 'xlsx') {
		throw new Error('Only CSV and XLSX files are supported.');
	}

	if (!input.bytes) {
		throw new Error('The selected XLSX file could not be read.');
	}

	const XLSX = await import('xlsx');
	const workbook = XLSX.read(input.bytes, { type: 'array', cellDates: true });
	assertWorkbookSheetCountWithinSetupImportLimits(workbook.SheetNames.length);
	return {
		fileName: input.fileName,
		fileExtension: extension,
		sheets: workbook.SheetNames.map((sheetName) =>
			rowsToSheetPayload(
				sheetName,
				XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
					header: 1,
					defval: ''
				}) as unknown[][]
			)
		).filter((sheet): sheet is SetupImportWorkbookSheet => !!sheet)
	};
}

export async function loadSetupImportFileAnalysis(
	input: ParseSetupImportFileInput
): Promise<SetupImportLoadResult> {
	if (typeof Worker !== 'undefined') {
		const Comlink = await import('comlink');
		const { workerClient } = await import('./worker-client.js');
		const api = workerClient.getAPI();
		if ('parseAndAnalyseSetupImport' in api) {
			if (input.bytes) {
				return api.parseAndAnalyseSetupImport(
					Comlink.transfer({ ...input, bytes: input.bytes }, [input.bytes.buffer])
				);
			}
			return api.parseAndAnalyseSetupImport(input);
		}
	}

	const workbook = await parseSetupImportFile(input, { localOnly: true });
	const analysis = await analyseSetupImportWorkbook(workbook, { localOnly: true });
	return { workbook, analysis };
}

export function buildEmptyEstimateTemplatePayload() {
	return {
		scope_summary: '',
		notes: '',
		takeoff_items: []
	};
}

export function buildEmptyCostPresetComponents() {
	return [];
}

function buildJsonFieldRowError(
	tableId: SetupImportTargetTable,
	fieldId: string,
	message: string,
	rowNumber: number,
	raw: Record<string, string>
): SetupImportRowError {
	const fieldIssues = [{ fieldId, message }];
	return {
		rowNumber,
		raw,
		mappedValues: raw,
		fieldIssues,
		messages: formatSetupImportRowMessages(tableId, fieldIssues)
	};
}

function parseMappedJsonValue(
	value: string,
	options: { tableId: SetupImportTargetTable; fieldId: string; label: string }
): { success: true; value: unknown } | { success: false; message: string } {
	const rawValue = value.trim();
	if (!rawValue) {
		return {
			success: false,
			message: `${options.label} is blank in this row`
		};
	}

	try {
		return { success: true, value: JSON.parse(rawValue) as unknown };
	} catch {
		return {
			success: false,
			message: `${options.label} is not valid JSON`
		};
	}
}

function hasRequiredJsonObjectKeys(
	value: unknown,
	keys: string[]
): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		keys.every((key) => key in value)
	);
}

function normaliseBoolean(value: string): boolean {
	const normalised = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'y', 'enabled', 'active', 'on'].includes(normalised)) return true;
	if (['0', 'false', 'no', 'n', 'disabled', 'inactive', 'off'].includes(normalised)) return false;
	return false;
}

function normaliseNumber(value: string): number {
	const trimmed = value.trim();
	if (!trimmed) return Number.NaN;
	const signAdjusted = trimmed.replace(/^\((.+)\)$/, '-$1');
	return Number(signAdjusted.replace(/[$,\s]/g, ''));
}

function splitCellCandidates(value: string): string[] {
	return value
		.split(/[;|,\n]/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function extractPhoneCandidates(value: string): string[] {
	return Array.from(value.matchAll(/\+?[\d(][\d\s().-]{5,}/g))
		.map((match) => match[0]?.trim() ?? '')
		.filter(Boolean);
}

function getEmailCandidates(value: string): string[] {
	const candidates = splitCellCandidates(value).filter(looksLikeEmail);
	if (looksLikeEmail(value.trim())) candidates.unshift(value.trim());
	return [...new Set(candidates.map(normalisePersistedEmailValue))];
}

function getPhoneCandidates(value: string, countryCode?: string | null): string[] {
	const candidates = [
		...splitCellCandidates(value).filter(looksLikePhone),
		...extractPhoneCandidates(value).filter(looksLikePhone)
	];
	if (looksLikePhone(value.trim())) candidates.unshift(value.trim());
	return [
		...new Set(candidates.map((candidate) => formatPhoneDraft(candidate, countryCode ?? '')))
	].filter(Boolean);
}

function normaliseEmailValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const candidates = getEmailCandidates(trimmed);
	if (candidates.length === 1) return candidates[0];
	return trimmed;
}

function sanitiseImportPhoneValue(value: string, countryCode?: string | null): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (looksBooleanLike(trimmed)) return '';
	const candidates = getPhoneCandidates(trimmed, countryCode);
	if (candidates.length === 1) return candidates[0];
	const stripped = trimmed
		.replace(/[A-Za-z]/g, '')
		.replace(/[^\d+\s().-]/g, '')
		.trim();
	if (stripped && looksLikePhone(stripped)) return formatPhoneDraft(stripped, countryCode ?? '');
	return trimmed;
}

function buildAmbiguousContactValueIssues(
	row: Record<string, string>,
	countryCode: string
): Array<{ fieldId: string; message: string }> {
	const issues: Array<{ fieldId: string; message: string }> = [];
	const emailCandidates = getEmailCandidates(row.email ?? '');
	if (emailCandidates.length > 1) {
		issues.push({
			fieldId: 'email',
			message: 'Email contains multiple possible values. Choose one email before importing.'
		});
	}
	const phoneCandidates = getPhoneCandidates(
		row.phone ?? '',
		row.phone_country_code ?? countryCode
	);
	if (phoneCandidates.length > 1) {
		issues.push({
			fieldId: 'phone',
			message: 'Phone contains multiple possible values. Choose one phone number before importing.'
		});
	}
	return issues;
}

function normaliseCountryCodeValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const normalised = normaliseLookupValue(trimmed).replace(/\s+/g, ' ');
	const direct =
		WORKSPACE_COUNTRY_OPTIONS.find((option) => option.code.toLowerCase() === normalised)?.code ??
		null;
	if (direct) return direct;
	const labelMatch =
		WORKSPACE_COUNTRY_OPTIONS.find(
			(option) => normaliseLookupValue(option.label).replace(/\s+/g, ' ') === normalised
		)?.code ?? null;
	if (labelMatch) return labelMatch;
	const aliasMap: Record<string, string> = {
		australia: 'AU',
		australian: 'AU',
		au: 'AU',
		'new zealand': 'NZ',
		nz: 'NZ'
	};
	return aliasMap[normalised] ?? trimmed.toUpperCase();
}

function normaliseUnitValue(value: string): string {
	return normaliseUnitCode(value) ?? value.trim();
}

function buildUnsupportedRateCardUnitMessage(
	label: string,
	value: string,
	allowedUnits: readonly string[]
): string {
	return `${label} unit "${value.trim()}" is not supported. Use one of: ${allowedUnits.join(', ')}.`;
}

function getUnsupportedRateCardUnitMessage(
	tableId: 'labour_rates' | 'equipment_rates' | 'subcontract_rates',
	rawValue: string
): string | null {
	const trimmed = rawValue.trim();
	if (!trimmed) return null;
	const normalized = normaliseUnitValue(trimmed);
	switch (tableId) {
		case 'labour_rates':
			return LABOUR_RATE_UNIT_CODES.includes(normalized as (typeof LABOUR_RATE_UNIT_CODES)[number])
				? null
				: buildUnsupportedRateCardUnitMessage('Labour', trimmed, LABOUR_RATE_UNIT_CODES);
		case 'equipment_rates':
			return EQUIPMENT_RATE_UNIT_CODES.includes(
				normalized as (typeof EQUIPMENT_RATE_UNIT_CODES)[number]
			)
				? null
				: buildUnsupportedRateCardUnitMessage('Equipment', trimmed, EQUIPMENT_RATE_UNIT_CODES);
		case 'subcontract_rates':
			return SUBCONTRACT_RATE_UNIT_CODES.includes(
				normalized as (typeof SUBCONTRACT_RATE_UNIT_CODES)[number]
			)
				? null
				: buildUnsupportedRateCardUnitMessage('Subcontract', trimmed, SUBCONTRACT_RATE_UNIT_CODES);
	}
}

function normaliseClassificationSystemType(value: string): string {
	const normalised = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
	const officialAlias = CLASSIFICATION_SYSTEM_TYPE_OPTIONS.find((option) => {
		const optionLabel = option.label.trim().toLowerCase().replace(/[_-]+/g, ' ');
		return option.value === normalised || optionLabel === normalised;
	});
	if (officialAlias) return officialAlias.value;
	const aliasMap: Record<string, string> = {
		'master format': 'masterformat',
		masterformat: 'masterformat',
		'uni format': 'uniformat',
		uniformat: 'uniformat',
		xactimate: 'xactimate',
		custom: 'custom'
	};
	return aliasMap[normalised] ?? normalised.replace(/\s+/g, '');
}

function inferContactCountryCode(
	row: Record<string, string>,
	workspaceCountryCode?: string | null
): string {
	const explicit = normaliseCountryCodeValue(row.country_code ?? '');
	if (explicit) return explicit;

	const phoneValue = row.phone ?? '';
	if (/^\s*\+61/.test(phoneValue)) return 'AU';
	if (/^\s*\+64/.test(phoneValue)) return 'NZ';

	const taxValue = normaliseLookupValue(row.tax_id_value ?? '');
	if (/\babn\b/.test(taxValue)) return 'AU';
	if (/\bnzbn\b/.test(taxValue)) return 'NZ';

	const addressValue = normaliseLookupValue(row.address ?? '');
	if (
		/\b(nsw|vic|qld|wa|sa|tas|nt|act|adelaide|sydney|melbourne|brisbane|perth)\b/.test(addressValue)
	) {
		return 'AU';
	}
	if (/\b(auckland|tauranga|wellington|christchurch|hamilton|dunedin)\b/.test(addressValue)) {
		return 'NZ';
	}

	const workspaceFallback = normaliseCountryCodeValue(workspaceCountryCode ?? '');
	return workspaceFallback || '';
}

function buildMappedRows(
	sheet: SetupImportWorkbookSheet,
	analysis: SetupImportSheetAnalysis,
	rowOverrides: SetupImportRowFieldOverrides = {}
): Array<Record<string, string>> {
	return sheet.rows.map((row, index) => {
		const rowNumber = getSourceRowNumber(sheet, index);
		const mappedValues = analysis.mappings.reduce<Record<string, string>>((record, mapping) => {
			if (!mapping.targetField) return record;
			record[mapping.targetField] = row[mapping.sourceColumn] ?? '';
			return record;
		}, {});
		return {
			...mappedValues,
			...(rowOverrides[rowNumber] ?? {})
		};
	});
}

function buildDuplicateKeys(
	tableId: SetupImportTargetTable,
	row: Record<string, string>
): string[] {
	const normalizedCode = normaliseLookupValue(row.code ?? '');
	const normalizedName = normaliseLookupValue(row.name ?? row.display_name ?? '');
	const keys: string[] = [];
	const addKey = (scope: string, value: string): void => {
		if (value) keys.push(`${scope}:${value}`);
	};

	switch (tableId) {
		case 'contacts': {
			const businessId = normaliseLookupValue(row.business_id_value ?? '');
			const countryCode = normaliseLookupValue(row.country_code ?? '');
			const kind = normaliseLookupValue(row.kind ?? 'company') || 'company';
			if (kind === 'person') {
				const linkedCompany = normaliseLookupValue(
					row.linked_company_id || row.company_name || row.company || ''
				);
				addKey('person_name_company', `${linkedCompany || '__unlinked__'}|${normalizedName}`);
			} else {
				addKey('company_name', normalizedName);
			}
			if (businessId && countryCode) addKey('business', `${countryCode}|${businessId}`);
			break;
		}
		case 'materials':
		case 'cost_presets':
		case 'estimate_templates':
		case 'project_structure_templates':
		case 'classification_systems':
		case 'labour_rates':
		case 'equipment_rates':
			addKey('code', normalizedCode);
			addKey('name', normalizedName);
			break;
		case 'subcontract_rates':
			addKey('code', normalizedCode);
			addKey('name', normalizedName);
			break;
		case 'cost_codes':
			addKey('code', normalizedCode);
			break;
	}

	return keys;
}

function buildDuplicateRowError(
	rowNumber: number,
	row: Record<string, string>
): SetupImportRowError {
	const message =
		'This workbook contains another row with the same import key. Skip or edit one duplicate before importing.';
	return {
		rowNumber,
		raw: row,
		mappedValues: row,
		messages: [message],
		fieldIssues: [{ fieldId: 'code', message }]
	};
}

function getDuplicateRowNumbers(
	tableId: SetupImportTargetTable,
	rows: Array<Record<string, string>>,
	sheet: SetupImportWorkbookSheet,
	skippedRowNumbers: Set<number>
): Set<number> {
	const keyRows = new Map<string, number[]>();
	rows.forEach((row, index) => {
		const rowNumber = getSourceRowNumber(sheet, index);
		if (skippedRowNumbers.has(rowNumber)) return;

		for (const key of buildDuplicateKeys(tableId, row)) {
			keyRows.set(key, [...(keyRows.get(key) ?? []), rowNumber]);
		}
	});
	return new Set([...keyRows.values()].filter((rowNumbers) => rowNumbers.length > 1).flat());
}

function splitPersonName(fullName: string): { firstName: string; lastName: string } {
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	if (parts.length <= 1) {
		return { firstName: parts[0] ?? '', lastName: '' };
	}

	return {
		firstName: parts[0] ?? '',
		lastName: parts.slice(1).join(' ')
	};
}

function buildContactFormValues(
	row: Record<string, string>,
	options: { workspaceCountryCode?: string | null } = {}
): Record<string, unknown> {
	const countryCode = inferContactCountryCode(row, options.workspaceCountryCode);
	const identity = deriveContactDisplayName(row);
	return {
		kind: row.kind?.trim() || 'company',
		country_code: countryCode,
		display_name: identity,
		name: identity,
		company_name: row.company_name ?? row.name ?? '',
		person_first_name: row.person_first_name ?? '',
		person_last_name: row.person_last_name ?? '',
		role_title: row.role_title ?? '',
		linked_company_id: row.linked_company_id ?? '',
		is_primary_company_contact: normaliseBoolean(row.is_primary_company_contact ?? 'false'),
		contact_name: row.contact_name ?? '',
		email: normaliseEmailValue(row.email ?? ''),
		phone: sanitiseImportPhoneValue(row.phone ?? '', row.phone_country_code ?? countryCode),
		phone_country_code: row.phone_country_code ?? '',
		phone_e164: row.phone_e164 ?? '',
		abn: row.abn ?? '',
		business_id_label: row.business_id_label ?? '',
		business_id_value: row.business_id_value ?? '',
		tax_id_label: row.tax_id_label ?? '',
		tax_id_value: row.tax_id_value ?? '',
		address: row.address ?? '',
		notes: row.notes ?? '',
		custom_role_label: row.custom_role_label ?? '',
		roles: Array.isArray(row.roles)
			? row.roles
			: typeof row.roles === 'string' && row.roles.trim()
				? row.roles
						.split(',')
						.map((value) => value.trim())
						.filter(Boolean)
				: [],
		tags: Array.isArray(row.tags)
			? row.tags
			: typeof row.tags === 'string' && row.tags.trim()
				? row.tags
						.split(',')
						.map((value) => value.trim())
						.filter(Boolean)
				: [],
		is_active: normaliseBoolean(row.is_active ?? 'true')
	};
}

function buildCompanyMatchKeys(
	contact: Pick<
		Contact,
		'id' | 'kind' | 'display_name' | 'name' | 'company_name' | 'business_id_value'
	>
): string[] {
	return [
		contact.id,
		contact.display_name,
		contact.name,
		contact.company_name,
		contact.business_id_value
	]
		.map((value) => normaliseLookupValue(value ?? ''))
		.filter(Boolean);
}

function resolveImportedLinkedCompany(
	row: Record<string, string>,
	existingCompanies: Array<
		Pick<Contact, 'id' | 'kind' | 'display_name' | 'name' | 'company_name' | 'business_id_value'>
	>
): { value: string; issue?: string } {
	const rawValue = (row.linked_company_id || row.company_name || '').trim();
	if (!rawValue) return { value: '' };
	if (rawValue.startsWith(SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX)) {
		const hasPendingCompany = existingCompanies.some(
			(contact) => contact.kind === 'company' && contact.id === rawValue
		);
		return hasPendingCompany
			? { value: rawValue }
			: { value: rawValue, issue: `Linked company "${rawValue}" could not be matched.` };
	}

	const normalizedRaw = normaliseLookupValue(rawValue);
	const matches = existingCompanies.filter(
		(contact) =>
			contact.kind === 'company' && buildCompanyMatchKeys(contact).includes(normalizedRaw)
	);
	if (matches.length === 1) return { value: matches[0].id };
	if (matches.length > 1) {
		return { value: rawValue, issue: `Linked company "${rawValue}" matches multiple companies.` };
	}
	return { value: rawValue, issue: `Linked company "${rawValue}" could not be matched.` };
}

function expandContactMappedRow(row: Record<string, string>): Array<Record<string, string>> {
	const explicitKind = normaliseLookupValue(row.kind ?? '');
	if (explicitKind === 'person') {
		const personDisplayName =
			row.display_name?.trim() ||
			[row.person_first_name?.trim(), row.person_last_name?.trim()]
				.filter(Boolean)
				.join(' ')
				.trim() ||
			row.person_name?.trim() ||
			row.name?.trim();
		const { firstName, lastName } = splitPersonName(personDisplayName ?? '');
		return [
			{
				...row,
				kind: 'person',
				display_name: personDisplayName ?? '',
				name: personDisplayName ?? '',
				person_first_name: row.person_first_name ?? firstName,
				person_last_name: row.person_last_name ?? lastName
			}
		];
	}

	const companyDisplayName =
		row.display_name?.trim() || row.company_name?.trim() || row.name?.trim() || '';
	const companyName = row.company_name?.trim() || '';
	const resolvedCompanyName = companyName || companyDisplayName;
	const personDisplayName =
		row.person_name?.trim() ||
		[row.person_first_name?.trim(), row.person_last_name?.trim()].filter(Boolean).join(' ').trim();
	const shouldExpand =
		!!companyDisplayName &&
		!!personDisplayName &&
		explicitKind !== 'company' &&
		explicitKind !== 'person' &&
		looksLikePersonName(personDisplayName);

	const companyRow: Record<string, string> = {
		...row,
		kind: explicitKind === 'company' ? 'company' : 'company',
		display_name: companyDisplayName,
		name: row.name?.trim() || companyDisplayName,
		company_name: companyName,
		contact_name: '',
		email: shouldExpand ? '' : (row.email ?? ''),
		phone: shouldExpand ? '' : (row.phone ?? ''),
		role_title: shouldExpand ? '' : (row.role_title ?? ''),
		person_first_name: '',
		person_last_name: '',
		linked_company_id: ''
	};

	if (!shouldExpand) {
		return [companyRow];
	}

	const { firstName, lastName } = splitPersonName(personDisplayName);
	const pendingCompanyKey = buildSetupImportPendingContactCompanyKey({
		country_code: row.country_code,
		business_id_value: row.business_id_value,
		company_name: resolvedCompanyName,
		display_name: companyDisplayName,
		name: companyDisplayName,
		email: row.email
	});

	const personRow: Record<string, string> = {
		...row,
		kind: 'person',
		display_name: personDisplayName,
		name: personDisplayName,
		company_name: resolvedCompanyName,
		person_first_name: row.person_first_name?.trim() || firstName,
		person_last_name: row.person_last_name?.trim() || lastName,
		contact_name: '',
		linked_company_id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}${pendingCompanyKey}`,
		is_primary_company_contact: row.is_primary_company_contact ?? 'true',
		email: row.email ?? '',
		phone: row.phone ?? '',
		address: '',
		business_id_value: '',
		tax_id_value: '',
		abn: ''
	};

	return [companyRow, personRow];
}

function formatFieldErrors(
	tableId: SetupImportTargetTable,
	error: {
		flatten(): { fieldErrors: Record<string, string[] | undefined> };
	},
	digest: SetupImportSchemaDigest = buildSetupImportSchemaDigest()
): {
	fieldIssues: Array<{ fieldId: string; message: string }>;
	messages: string[];
} {
	const fieldIssues = Object.entries(error.flatten().fieldErrors).flatMap(([fieldId, messages]) =>
		(messages ?? []).map((message) => ({ fieldId, message }))
	);
	return {
		fieldIssues,
		messages: formatSetupImportRowMessages(tableId, fieldIssues, digest)
	};
}

function normalisePreviewOptions(
	rowOverridesOrOptions: SetupImportRowFieldOverrides | SetupImportSheetPreviewOptions = {}
): Required<SetupImportSheetPreviewOptions> {
	if (
		'rowOverrides' in rowOverridesOrOptions ||
		'skippedRowNumbers' in rowOverridesOrOptions ||
		'workspaceCountryCode' in rowOverridesOrOptions ||
		'costCodeExistingCodes' in rowOverridesOrOptions ||
		'existingCompanyContacts' in rowOverridesOrOptions
	) {
		return {
			rowOverrides: rowOverridesOrOptions.rowOverrides ?? {},
			skippedRowNumbers: rowOverridesOrOptions.skippedRowNumbers ?? [],
			workspaceCountryCode: rowOverridesOrOptions.workspaceCountryCode ?? null,
			costCodeExistingCodes: rowOverridesOrOptions.costCodeExistingCodes ?? [],
			existingCompanyContacts: rowOverridesOrOptions.existingCompanyContacts ?? []
		};
	}

	return {
		rowOverrides: rowOverridesOrOptions as SetupImportRowFieldOverrides,
		skippedRowNumbers: [],
		workspaceCountryCode: null,
		costCodeExistingCodes: [],
		existingCompanyContacts: []
	};
}

export function previewSetupImportSheet(
	sheet: SetupImportWorkbookSheet,
	analysis: SetupImportSheetAnalysis,
	rowOverridesOrOptions: SetupImportRowFieldOverrides | SetupImportSheetPreviewOptions = {}
): SetupImportSheetPreview {
	const options = normalisePreviewOptions(rowOverridesOrOptions);
	const skippedRowNumbers = new Set(
		Array.isArray(options.skippedRowNumbers)
			? options.skippedRowNumbers
			: [...options.skippedRowNumbers]
	);
	if (sheet.headerIssues.length > 0) {
		return {
			validRows: [],
			errors: [
				{
					rowNumber: sheet.headerRowNumber ?? 1,
					messages: sheet.headerIssues,
					fieldIssues: [],
					raw: {},
					mappedValues: {}
				}
			],
			blocked: true,
			rowValidationDeferred: false,
			skippedRowCount: 0
		};
	}

	if (!analysis.targetTable) {
		return {
			validRows: [],
			errors: [],
			blocked: analysis.readiness === 'blocked',
			rowValidationDeferred: true,
			skippedRowCount: skippedRowNumbers.size
		};
	}

	const hasUnresolvedMappings =
		analysis.missingRequiredFields.length > 0 ||
		analysis.mappings.some((mapping) => mapping.status === 'yellow' || mapping.status === 'red') ||
		(analysis.targetTable === 'cost_codes' && analysis.readiness === 'blocked');
	if (hasUnresolvedMappings) {
		return {
			validRows: [],
			errors: [],
			blocked: analysis.readiness === 'blocked',
			rowValidationDeferred: true,
			skippedRowCount: skippedRowNumbers.size
		};
	}

	const mappedRows = buildMappedRows(sheet, analysis, options.rowOverrides);
	const errors: SetupImportRowError[] = [];
	const duplicateRowNumbers = getDuplicateRowNumbers(
		analysis.targetTable,
		mappedRows,
		sheet,
		skippedRowNumbers
	);

	switch (analysis.targetTable) {
		case 'contacts': {
			const pendingCompanyContacts = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber) || duplicateRowNumbers.has(rowNumber)) return [];
				return expandContactMappedRow(row)
					.filter((expandedRow) => normaliseLookupValue(expandedRow.kind ?? '') === 'company')
					.map((companyRow) => ({
						id: `${SETUP_IMPORT_PENDING_CONTACT_COMPANY_PREFIX}${buildSetupImportPendingContactCompanyKey(companyRow)}`,
						kind: 'company' as const,
						display_name: companyRow.display_name ?? '',
						name: companyRow.name ?? '',
						company_name: companyRow.company_name ?? '',
						business_id_value: companyRow.business_id_value ?? ''
					}));
			});
			const companyContacts = [...options.existingCompanyContacts, ...pendingCompanyContacts];
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const expandedRows = expandContactMappedRow(row);
				const parsedRows = expandedRows.flatMap((expandedRow) => {
					const countryCode = inferContactCountryCode(expandedRow, options.workspaceCountryCode);
					const fieldIssues = buildAmbiguousContactValueIssues(expandedRow, countryCode);
					if (normaliseLookupValue(expandedRow.kind ?? '') === 'person') {
						const resolved = resolveImportedLinkedCompany(expandedRow, companyContacts);
						expandedRow = { ...expandedRow, linked_company_id: resolved.value };
						if (resolved.issue) {
							fieldIssues.push({ fieldId: 'linked_company_id', message: resolved.issue });
						}
					}
					if (fieldIssues.length > 0) {
						errors.push({
							rowNumber,
							raw: row,
							mappedValues: expandedRow,
							messages: fieldIssues.map((issue) => issue.message),
							fieldIssues
						});
						return [];
					}
					const parsed = contactFormSchema.safeParse(
						buildContactFormValues(expandedRow, {
							workspaceCountryCode: options.workspaceCountryCode
						})
					);
					if (parsed.success) return [parsed.data];
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						...formatFieldErrors('contacts', parsed.error)
					});
					return [];
				});
				return parsedRows;
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'materials': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const parsed = materialCatalogItemFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					category: row.category ?? '',
					specification: row.specification ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					unit: normaliseUnitValue(row.unit ?? ''),
					default_rate: normaliseNumber(row.default_rate ?? ''),
					...buildCatalogueCommercialValues(row),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (parsed.success) {
					return [
						{ ...parsed.data, company_names: parseDelimitedCompanyNames(row.company_names ?? '') }
					];
				}
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('materials', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'labour_rates': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const unitError = getUnsupportedRateCardUnitMessage('labour_rates', row.unit ?? '');
				if (unitError) {
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						messages: [unitError],
						fieldIssues: [{ fieldId: 'unit', message: unitError }]
					});
					return [];
				}
				const parsed = labourRateCardFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					category: row.category ?? '',
					work_center: row.work_center ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					unit: normaliseUnitValue(row.unit ?? ''),
					default_rate: normaliseNumber(row.default_rate ?? ''),
					...buildCatalogueCommercialValues(row),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (parsed.success) {
					return [
						{ ...parsed.data, company_names: parseDelimitedCompanyNames(row.company_names ?? '') }
					];
				}
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('labour_rates', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'equipment_rates': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const unitError = getUnsupportedRateCardUnitMessage('equipment_rates', row.unit ?? '');
				if (unitError) {
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						messages: [unitError],
						fieldIssues: [{ fieldId: 'unit', message: unitError }]
					});
					return [];
				}
				const parsed = equipmentRateCardFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					category: row.category ?? '',
					work_center: row.work_center ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					unit: normaliseUnitValue(row.unit ?? ''),
					default_rate: normaliseNumber(row.default_rate ?? ''),
					...buildCatalogueCommercialValues(row),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (parsed.success) {
					return [
						{ ...parsed.data, company_names: parseDelimitedCompanyNames(row.company_names ?? '') }
					];
				}
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('equipment_rates', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'subcontract_rates': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const unitError = getUnsupportedRateCardUnitMessage('subcontract_rates', row.unit ?? '');
				if (unitError) {
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						messages: [unitError],
						fieldIssues: [{ fieldId: 'unit', message: unitError }]
					});
					return [];
				}
				const parsed = subcontractRateCardFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					category: row.category ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					unit: normaliseUnitValue(row.unit ?? ''),
					default_rate: normaliseNumber(row.default_rate ?? ''),
					...buildCatalogueCommercialValues(row),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (parsed.success) {
					return [
						{ ...parsed.data, company_names: parseDelimitedCompanyNames(row.company_names ?? '') }
					];
				}
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('subcontract_rates', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'cost_presets': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const parsed = costComponentPresetFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					description: row.description ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (!parsed.success) {
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						...formatFieldErrors('cost_presets', parsed.error)
					});
					return [];
				}
				if (Object.hasOwn(row, 'components_json')) {
					const parsedJson = parseMappedJsonValue(row.components_json ?? '', {
						tableId: 'cost_presets',
						fieldId: 'components_json',
						label: 'Components data'
					});
					if (!parsedJson.success) {
						errors.push(
							buildJsonFieldRowError(
								'cost_presets',
								'components_json',
								parsedJson.message,
								rowNumber,
								row
							)
						);
						return [];
					}
					const payload = CostComponentPresetRowSchema.shape.components_json.safeParse(
						parsedJson.value
					);
					if (!payload.success) {
						errors.push(
							buildJsonFieldRowError(
								'cost_presets',
								'components_json',
								'Components data is not in the expected structure',
								rowNumber,
								row
							)
						);
						return [];
					}
					return [
						{ ...parsed.data, components_json: payload.data } satisfies SetupImportCostPresetRow
					];
				}
				return [parsed.data];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'estimate_templates': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const parsed = estimateTemplateFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					description: row.description ?? '',
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (!parsed.success) {
					errors.push({
						rowNumber,
						raw: row,
						mappedValues: row,
						...formatFieldErrors('estimate_templates', parsed.error)
					});
					return [];
				}
				if (Object.hasOwn(row, 'estimate_json')) {
					const parsedJson = parseMappedJsonValue(row.estimate_json ?? '', {
						tableId: 'estimate_templates',
						fieldId: 'estimate_json',
						label: 'Estimate data'
					});
					if (!parsedJson.success) {
						errors.push(
							buildJsonFieldRowError(
								'estimate_templates',
								'estimate_json',
								parsedJson.message,
								rowNumber,
								row
							)
						);
						return [];
					}
					if (
						!hasRequiredJsonObjectKeys(parsedJson.value, [
							'scope_summary',
							'notes',
							'takeoff_items'
						])
					) {
						errors.push(
							buildJsonFieldRowError(
								'estimate_templates',
								'estimate_json',
								'Estimate data is missing required sections',
								rowNumber,
								row
							)
						);
						return [];
					}
					const payload = EstimateTemplateRowSchema.shape.estimate_json.safeParse(parsedJson.value);
					if (!payload.success) {
						errors.push(
							buildJsonFieldRowError(
								'estimate_templates',
								'estimate_json',
								'Estimate data is not in the expected structure',
								rowNumber,
								row
							)
						);
						return [];
					}
					return [
						{ ...parsed.data, estimate_json: payload.data } satisfies SetupImportEstimateTemplateRow
					];
				}
				return [parsed.data];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'project_structure_templates': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const parsed = projectStructureTemplateFormSchema.safeParse({
					code: row.code ?? '',
					name: row.name ?? '',
					description: row.description ?? '',
					is_active: normaliseBoolean(row.is_active ?? 'true')
				});
				if (parsed.success) return [parsed.data];
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('project_structure_templates', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'classification_systems': {
			const validRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const parsed = classificationSystemFormSchema.safeParse({
					name: row.name ?? '',
					code: row.code ?? '',
					classification_type: normaliseClassificationSystemType(
						row.classification_type ?? 'custom'
					),
					aliases: parseDelimitedAliases(row.aliases ?? ''),
					is_default: normaliseBoolean(row.is_default ?? 'false')
				});
				if (parsed.success) return [parsed.data];
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('classification_systems', parsed.error)
				});
				return [];
			});
			return {
				validRows,
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
		case 'cost_codes': {
			const parsedRows = mappedRows.flatMap((row, index) => {
				const rowNumber = getSourceRowNumber(sheet, index);
				if (skippedRowNumbers.has(rowNumber)) return [];
				if (duplicateRowNumbers.has(rowNumber)) {
					errors.push(buildDuplicateRowError(rowNumber, row));
					return [];
				}
				const sourceSortOrder = row.sort_order?.trim();
				const sourceParent = inferCostCodeParentFromSourceRow(
					sheet.rows[index] ?? {},
					row.code ?? ''
				);
				const parsed = costCodeFormSchema.safeParse({
					parent_id: row.parent_id || sourceParent || null,
					code: row.code ?? '',
					name: row.name ?? '',
					description: row.description ?? '',
					is_active: normaliseBoolean(row.is_active ?? 'true'),
					sort_order:
						sourceSortOrder && sourceSortOrder.length > 0 ? normaliseNumber(sourceSortOrder) : index
				});
				if (parsed.success) {
					return [
						{
							parsed: parsed.data,
							rowNumber,
							raw: row,
							mappedValues: row
						}
					];
				}
				errors.push({
					rowNumber,
					raw: row,
					mappedValues: row,
					...formatFieldErrors('cost_codes', parsed.error)
				});
				return [];
			});
			const hierarchy = analyseCostCodeHierarchy(
				parsedRows.map((entry) => entry.parsed),
				{
					existingCodes: options.costCodeExistingCodes
				}
			);
			for (const issue of hierarchy.issues) {
				const row = parsedRows[issue.rowIndex];
				if (!row) continue;
				errors.push({
					rowNumber: row.rowNumber,
					raw: row.raw,
					mappedValues: row.mappedValues,
					messages: [issue.message],
					fieldIssues: [{ fieldId: 'parent_id', message: issue.message }]
				});
			}
			return {
				validRows: hierarchy.orderedRows.map((entry) => entry.row),
				errors,
				blocked: analysis.readiness === 'blocked',
				rowValidationDeferred: false,
				skippedRowCount: skippedRowNumbers.size
			};
		}
	}
}
