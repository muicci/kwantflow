import { z } from 'zod';
import {
	normaliseEquipmentRateUnitCode,
	normaliseLabourRateUnitCode,
	normaliseMaterialUnitCode,
	normaliseSubcontractRateUnitCode,
	SUPPORTED_CURRENCY_CODES
} from '$lib/constants/index.js';

const SourceRecordScopeSchema = z.enum([
	'contacts',
	'materials',
	'labour_rates',
	'equipment_rates',
	'subcontract_rates',
	'wbs_nodes',
	'quote_options',
	'assets'
]);
export type SourceRecordProposalScope = z.infer<typeof SourceRecordScopeSchema>;

export const sourceRecordProposalToolScopes = {
	contact_change: 'contacts',
	material_change: 'materials',
	labour_rate_change: 'labour_rates',
	equipment_rate_change: 'equipment_rates',
	subcontract_rate_change: 'subcontract_rates',
	wbs_item_change: 'wbs_nodes',
	quote_option_change: 'quote_options',
	asset_change: 'assets'
} as const satisfies Record<string, SourceRecordProposalScope>;

export type SourceRecordProposalToolName = keyof typeof sourceRecordProposalToolScopes;

const scopeAliases: Record<string, SourceRecordProposalScope> = {
	contact: 'contacts',
	contacts: 'contacts',
	company: 'contacts',
	companies: 'contacts',
	people: 'contacts',
	person: 'contacts',
	material: 'materials',
	materials: 'materials',
	labour_rate: 'labour_rates',
	labour_rates: 'labour_rates',
	labor_rate: 'labour_rates',
	labor_rates: 'labour_rates',
	equipment_rate: 'equipment_rates',
	equipment_rates: 'equipment_rates',
	subcontract_rate: 'subcontract_rates',
	subcontract_rates: 'subcontract_rates',
	wbs: 'wbs_nodes',
	wbs_node: 'wbs_nodes',
	wbs_nodes: 'wbs_nodes',
	quote_option: 'quote_options',
	quote_options: 'quote_options',
	asset: 'assets',
	assets: 'assets'
};

const proposalScopeLabels: Record<SourceRecordProposalScope, string> = {
	contacts: 'contact',
	materials: 'material',
	labour_rates: 'labour rate',
	equipment_rates: 'equipment rate',
	subcontract_rates: 'subcontract rate',
	wbs_nodes: 'WBS item',
	quote_options: 'quote option',
	assets: 'asset'
};

const allowedFieldsByScope: Record<SourceRecordProposalScope, Set<string>> = {
	contacts: new Set([
		'kind',
		'name',
		'display_name',
		'person_first_name',
		'person_last_name',
		'linked_company_id',
		'email',
		'phone',
		'address',
		'role_title',
		'custom_role_label',
		'notes',
		'is_active'
	]),
	materials: new Set([
		'code',
		'name',
		'category',
		'specification',
		'unit',
		'default_rate',
		'currency_code',
		'rate_basis',
		'lead_time',
		'availability',
		'reference',
		'aliases',
		'is_active'
	]),
	labour_rates: new Set([
		'code',
		'name',
		'category',
		'work_center',
		'unit',
		'default_rate',
		'currency_code',
		'rate_basis',
		'aliases',
		'is_active'
	]),
	equipment_rates: new Set([
		'code',
		'name',
		'category',
		'work_center',
		'unit',
		'default_rate',
		'currency_code',
		'rate_basis',
		'aliases',
		'is_active'
	]),
	subcontract_rates: new Set([
		'code',
		'name',
		'category',
		'unit',
		'default_rate',
		'currency_code',
		'rate_basis',
		'aliases',
		'is_active'
	]),
	wbs_nodes: new Set(['project_id', 'parent_id', 'code', 'name', 'type', 'sort_order']),
	quote_options: new Set([
		'project_id',
		'label',
		'lead_time',
		'markup_percentage',
		'notes',
		'sort_order'
	]),
	assets: new Set(['project_id', 'name'])
};

export const requiredCreateFieldsByScope: Record<SourceRecordProposalScope, string[]> = {
	contacts: ['name'],
	materials: ['name', 'unit', 'default_rate'],
	labour_rates: ['name', 'unit', 'default_rate'],
	equipment_rates: ['name', 'unit', 'default_rate'],
	subcontract_rates: ['name', 'unit', 'default_rate'],
	wbs_nodes: ['project_id', 'name', 'type'],
	quote_options: ['project_id', 'label', 'markup_percentage'],
	assets: ['project_id', 'name']
};

const proposalNumberFields = new Set(['default_rate', 'markup_percentage', 'sort_order']);

export function sourceRecordProposalToolSchema(
	_scope: SourceRecordProposalScope
): Record<string, unknown> {
	return {
		type: 'object',
		properties: {
			action: { type: 'string', enum: ['create', 'update'] },
			sourceItem: {
				type: 'integer',
				description:
					'One-based Mutation source item to propose. Use the exact item number supplied in the current user message; never copy source fields into this tool call.'
			},
			recordId: {
				type: 'string',
				description:
					'Required for updates. Use the short ref returned by records_search, such as r1. Omit for creates.'
			}
		},
		required: ['action']
	};
}

export function buildMutationSourceItems(prompt: string): string[] {
	const trimmed = prompt.trim();
	if (!trimmed) return [];
	const colonIndex = trimmed.indexOf(':');
	const candidate =
		colonIndex >= 0 && /[;\n]/.test(trimmed.slice(colonIndex + 1))
			? trimmed.slice(colonIndex + 1)
			: trimmed;
	const items = candidate
		.split(/;|\n+/)
		.map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
		.filter(Boolean);
	return items.length > 1 ? items : [trimmed];
}

export function sourceRecordProposalScopeForTool(name: string): SourceRecordProposalScope | null {
	return sourceRecordProposalToolScopes[name as SourceRecordProposalToolName] ?? null;
}

export function sourceRecordProposalToolDescription(scope: SourceRecordProposalScope): string {
	return `Draft the next user-approved ${proposalScopeLabels[scope]} create or update proposal from the ordered Mutation source items. This never saves data. Create requires ${requiredCreateFieldsByScope[scope].join(', ')}. For an update whose next source item states an exact code, Kwantflow resolves and reads back that code. Otherwise update requires recordId from records_get. Call once per record with action only; Kwantflow advances to the next exact source item.`;
}

export const RecordsProposeChangeParametersSchema = z.object({
	scope: SourceRecordScopeSchema.describe('Business record family, never a SQLite table name.'),
	action: z.enum(['create', 'update']),
	recordId: z.string().trim().min(1).max(160).optional(),
	text: z.string().trim().min(1).max(1000).optional(),
	fields: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Only allowlisted fields for the selected scope.'),
	summary: z.string().trim().min(1).max(240).describe('Short user-facing reason for the proposal.')
});

export type SourceRecordProposalAction = z.infer<
	typeof RecordsProposeChangeParametersSchema
>['action'];

export type SourceRecordProposal = {
	id: string;
	scope: SourceRecordProposalScope;
	action: SourceRecordProposalAction;
	recordId?: string;
	fields: Record<string, unknown>;
	summary: string;
};

type SourceRecordProposalOptions = {
	sourceText?: string | null;
};

function normalizeFields(scope: SourceRecordProposalScope, fields: Record<string, unknown>) {
	const allowed = allowedFieldsByScope[scope];
	const output: Record<string, unknown> = {};
	const rejected: string[] = [];
	for (const [key, value] of Object.entries(fields)) {
		const normalizedKey = normalizeFieldName(scope, key);
		if (!allowed.has(normalizedKey)) {
			rejected.push(key);
			continue;
		}
		if (value === undefined) continue;
		output[normalizedKey] = value;
	}
	return { fields: output, rejected };
}

function normalizeScope(value: unknown): SourceRecordProposalScope | unknown {
	if (typeof value !== 'string') return value;
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	return scopeAliases[normalized] ?? value;
}

function normalizeFieldName(scope: SourceRecordProposalScope, key: string): string {
	const normalized = key
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	const commonAliases: Record<string, string> = {
		rate: 'default_rate',
		currency: 'currency_code',
		basis: 'rate_basis',
		rate_basis: 'rate_basis',
		spec: 'specification',
		specs: 'specification'
	};
	const contactAliases: Record<string, string> = {
		role: 'role_title',
		title: 'role_title',
		job_title: 'role_title'
	};
	return scope === 'contacts'
		? (contactAliases[normalized] ?? commonAliases[normalized] ?? normalized)
		: (commonAliases[normalized] ?? normalized);
}

export function hasSourceRecordProposalFieldValues(
	scope: SourceRecordProposalScope,
	input: Record<string, unknown>
): boolean {
	return Object.keys(input).some((key) =>
		allowedFieldsByScope[scope].has(normalizeFieldName(scope, key))
	);
}

function normalizeFieldRecord(
	scope: SourceRecordProposalScope,
	fields: Record<string, unknown>
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		output[normalizeFieldName(scope, key)] = value;
	}
	return output;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimExtractedText(value: string): string {
	return value
		.replace(/^\s*(?:a|an|one|new)\s+/i, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s"'“”]+|[\s"'“”.,;:]+$/g, '')
		.trim();
}

function extractDelimitedValue(text: string, labels: string[]): string | null {
	for (const label of labels) {
		const pattern = new RegExp(
			`\\b${escapeRegExp(label)}\\b\\s*(?:is|as|=|:)?\\s+(.+?)(?=\\s+\\b(?:with|unit|rate|default|to|currency|basis|cost|sell|email|phone|role|title|notes|category|spec|specification|project|called|named)\\b|[,.;]|$)`,
			'i'
		);
		const match = text.match(pattern);
		const value = match?.[1] ? trimExtractedText(match[1]) : '';
		if (value) return value;
	}
	return null;
}

function extractRecordLabel(scope: SourceRecordProposalScope, text: string): string | null {
	const explicit = extractDelimitedValue(text, ['called', 'named', 'name it']);
	if (explicit) return explicit;

	const prefixByScope: Record<SourceRecordProposalScope, RegExp> = {
		contacts:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:company|contact|person|people)?\s*/i,
		materials: /^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:material|materials)?\s*/i,
		labour_rates:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:labou?r\s+rate|labou?r|crew)?\s*/i,
		equipment_rates:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:equipment\s+rate|equipment)?\s*/i,
		subcontract_rates:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:subcontract\s+rate|subcontractor|subcontract)?\s*/i,
		wbs_nodes:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:wbs\s+item|wbs\s+node|wbs)?\s*/i,
		quote_options:
			/^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:quote\s+option|option)?\s*/i,
		assets: /^\s*(?:create|update|draft|add)?\s*(?:a|an|one|new)?\s*(?:asset)?\s*/i
	};
	const stripped = text.replace(prefixByScope[scope], '');
	const label = stripped.match(
		/^(.+?)(?=\s+\b(?:with|unit|rate|at|for|currency|basis|cost|sell|email|phone|role|title|notes|category|spec|specification|project)\b|[,.;]|$)/i
	)?.[1];
	const trimmed = label ? trimExtractedText(label) : '';
	return trimmed || null;
}

function extractRate(text: string): number | null {
	const match =
		text.match(
			/\b(?:rate|at|price|cost)\b\s*(?:is|as|to|of|=|:)?\s*(?:[$€£]|[A-Z]{3}\s*)?(-?\d+(?:\.\d+)?)/i
		) ?? text.match(/(?:^|[,;]\s*)(-?\d+(?:\.\d+)?)\s+[A-Z]{3}\s+per\b/i);
	const value = match?.[1] ? Number(match[1]) : NaN;
	return Number.isFinite(value) ? value : null;
}

function extractCurrency(text: string): string | null {
	for (const code of SUPPORTED_CURRENCY_CODES) {
		if (new RegExp(`\\b${code}\\b`, 'i').test(text)) return code;
	}
	return null;
}

function extractRateBasis(text: string): 'cost' | 'sell' | null {
	if (/\bcost\b/i.test(text)) return 'cost';
	if (/\bsell\b/i.test(text)) return 'sell';
	return null;
}

function extractUnit(scope: SourceRecordProposalScope, text: string): string | null {
	const normaliseUnit = unitNormalisers[scope];
	if (!normaliseUnit) return null;
	const candidates = [
		...text.matchAll(
			/\bunit\b\s*(?:is|as|=|:)?\s+([a-zA-Z0-9/$²^ ]+?)(?=\s+\b(?:rate|currency|basis|cost|sell|for|with)\b|[,.;]|$)/gi
		),
		...text.matchAll(
			/\bper\s+([a-zA-Z0-9/$²^ ]+?)(?=\s+\b(?:rate|currency|basis|cost|sell|for|with)\b|[,.;]|$)/gi
		),
		...text.matchAll(/\/\s*([a-zA-Z0-9²^]+)\b/g)
	];
	for (const match of candidates) {
		const unit = normaliseUnit(trimExtractedText(match[1] ?? ''));
		if (unit) return unit;
	}
	return null;
}

export function extractSourceRecordProposalFields(
	scope: SourceRecordProposalScope,
	action: SourceRecordProposalAction,
	text: string
): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	const label = extractRecordLabel(scope, text);
	if (label) {
		if (scope === 'quote_options') fields.label = label;
		else fields.name = label;
		if (scope === 'contacts') fields.display_name = label;
	}
	const rate = extractRate(text);
	if (rate !== null) fields.default_rate = rate;
	const code = extractDelimitedValue(text, ['code']);
	if (code) fields.code = code;
	const unit = extractUnit(scope, text);
	if (unit) fields.unit = unit;
	const currency = extractCurrency(text);
	if (currency) fields.currency_code = currency;
	const rateBasis = extractRateBasis(text);
	if (rateBasis) fields.rate_basis = rateBasis;

	const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
	if (email) fields.email = email;
	const phone = extractDelimitedValue(text, ['phone', 'mobile', 'telephone']);
	if (phone) fields.phone = phone;
	const role = extractDelimitedValue(text, ['role', 'title']);
	if (role) fields.role_title = role;
	const category = extractDelimitedValue(text, ['category']);
	if (category) fields.category = category;
	const specification = extractDelimitedValue(text, ['specification', 'spec']);
	if (specification) fields.specification = specification;
	const projectId = extractDelimitedValue(text, ['project_id', 'project id']);
	if (projectId) fields.project_id = projectId;
	const markup = text.match(/\b(?:markup|markup_percentage)\b\s*(?:is|as|=|:)?\s*(\d+(?:\.\d+)?)/i);
	if (markup?.[1]) fields.markup_percentage = Number(markup[1]);

	if (scope === 'contacts') {
		if (/\b(company|supplier|subcontractor|business)\b/i.test(text)) fields.kind = 'company';
		else if (/\b(person|people|contact)\b/i.test(text)) fields.kind = 'person';
	}

	if (action === 'update') {
		delete fields.name;
		delete fields.display_name;
		delete fields.label;
		delete fields.code;
	}

	return fields;
}

function normalizeProposalInput(input: unknown) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
	const raw = input as Record<string, unknown>;
	const scope = normalizeScope(raw.scope);
	const output: Record<string, unknown> = { ...raw, scope };
	const parsedScope = SourceRecordScopeSchema.safeParse(scope);
	if (parsedScope.success && typeof output.text === 'string') {
		const action = output.action === 'update' ? 'update' : 'create';
		output.fields = extractSourceRecordProposalFields(parsedScope.data, action, output.text);
	}
	if (
		(!output.fields || typeof output.fields !== 'object' || Array.isArray(output.fields)) &&
		typeof scope === 'string'
	) {
		if (parsedScope.success) {
			const allowed = allowedFieldsByScope[parsedScope.data];
			const lifted: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(output)) {
				if (allowed.has(normalizeFieldName(parsedScope.data, key))) lifted[key] = value;
			}
			if (Object.keys(lifted).length > 0) {
				output.fields = normalizeFieldRecord(parsedScope.data, lifted);
			}
		}
	} else if (output.fields && typeof output.fields === 'object' && !Array.isArray(output.fields)) {
		const parsedScope = SourceRecordScopeSchema.safeParse(scope);
		if (parsedScope.success) {
			output.fields = normalizeFieldRecord(
				parsedScope.data,
				output.fields as Record<string, unknown>
			);
		}
	}
	if (typeof output.summary !== 'string' || output.summary.trim().length === 0) {
		const action = typeof output.action === 'string' ? output.action : 'change';
		const fields =
			output.fields && typeof output.fields === 'object' && !Array.isArray(output.fields)
				? (output.fields as Record<string, unknown>)
				: {};
		const family =
			typeof scope === 'string' && SourceRecordScopeSchema.safeParse(scope).success
				? proposalScopeLabels[scope as SourceRecordProposalScope]
				: 'record';
		const label =
			typeof output.name === 'string'
				? output.name
				: typeof output.label === 'string'
					? output.label
					: typeof output.display_name === 'string'
						? output.display_name
						: typeof fields.name === 'string'
							? fields.name
							: typeof fields.label === 'string'
								? fields.label
								: typeof fields.display_name === 'string'
									? fields.display_name
									: typeof output.recordId === 'string'
										? output.recordId
										: null;
		output.summary = `${action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Change'} ${family}${label ? ` “${label}”` : ''}.`;
	}
	return output;
}

const nonNegativeNumberFields = proposalNumberFields;
const booleanFields = new Set(['is_active']);
const arrayLikeFields = new Set(['aliases']);
const objectLikeFields = new Set(['components_json', 'estimate_json']);
const unitNormalisers: Partial<
	Record<SourceRecordProposalScope, (value: unknown) => string | null>
> = {
	materials: normaliseMaterialUnitCode,
	labour_rates: normaliseLabourRateUnitCode,
	equipment_rates: normaliseEquipmentRateUnitCode,
	subcontract_rates: normaliseSubcontractRateUnitCode
};

function fieldIsBlank(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		(typeof value === 'string' && value.trim().length === 0)
	);
}

function validateFieldValues(scope: SourceRecordProposalScope, fields: Record<string, unknown>) {
	const issues: Array<{ field: string; message: string }> = [];
	if (fields.unit !== undefined) {
		const normaliseUnit = unitNormalisers[scope];
		if (normaliseUnit) {
			const unit = normaliseUnit(fields.unit);
			if (unit) fields.unit = unit;
			else issues.push({ field: 'unit', message: `Unit is not supported for ${scope}.` });
		}
	}
	if (typeof fields.currency_code === 'string') {
		const currencyCode = fields.currency_code.trim().toUpperCase();
		fields.currency_code = currencyCode;
		if (!/^[A-Z]{3}$/.test(currencyCode)) {
			issues.push({ field: 'currency_code', message: 'Currency must be a three-letter code.' });
		}
	}
	if (typeof fields.rate_basis === 'string') {
		const rateBasis = fields.rate_basis.trim().toLowerCase();
		fields.rate_basis = rateBasis;
		if (!['cost', 'sell'].includes(rateBasis)) {
			issues.push({ field: 'rate_basis', message: 'Rate basis must be cost or sell.' });
		}
	}
	for (const [field, value] of Object.entries(fields)) {
		if (fieldIsBlank(value)) {
			issues.push({ field, message: 'Field value is blank.' });
			continue;
		}
		if (nonNegativeNumberFields.has(field)) {
			const numberValue = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(numberValue) || numberValue < 0) {
				issues.push({ field, message: 'Field must be a finite non-negative number.' });
			} else {
				fields[field] = numberValue;
			}
			continue;
		}
		if (booleanFields.has(field) && typeof value !== 'boolean') {
			issues.push({ field, message: 'Field must be true or false.' });
			continue;
		}
		if (arrayLikeFields.has(field)) {
			if (
				!Array.isArray(value) ||
				!value.every(
					(entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0
				)
			) {
				issues.push({ field, message: 'Field must be an array of non-empty strings.' });
			} else {
				fields[field] = value.map((entry: string) => entry.trim());
			}
			continue;
		}
		if (
			objectLikeFields.has(field) &&
			(Array.isArray(value) || typeof value !== 'object' || value === null)
		) {
			issues.push({ field, message: 'Field must be an object.' });
		}
	}
	return issues;
}

function normalizeLiteralText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function extractNumericLiterals(value: string): number[] {
	const matches = value.match(/-?\d+(?:\.\d+)?/g) ?? [];
	return matches
		.map((match) => Number(match))
		.filter((numberValue) => Number.isFinite(numberValue));
}

function validateLiteralSourceValues(
	fields: Record<string, unknown>,
	sourceText: string | null | undefined
) {
	const issues: Array<{ field: string; message: string }> = [];
	if (!sourceText || sourceText.trim().length === 0) return issues;

	const normalizedSource = normalizeLiteralText(sourceText);
	const sourceCode = extractDelimitedValue(sourceText, ['code']);
	if (
		typeof fields.code === 'string' &&
		sourceCode &&
		fields.code.trim().toLowerCase() !== sourceCode.trim().toLowerCase()
	) {
		issues.push({
			field: 'code',
			message: 'The proposed code does not match the literal user request.'
		});
	}
	for (const field of ['name', 'display_name', 'label']) {
		const value = fields[field];
		if (typeof value !== 'string') continue;
		const normalizedValue = normalizeLiteralText(value);
		if (normalizedValue && !normalizedSource.includes(normalizedValue)) {
			issues.push({
				field,
				message: 'The proposed value does not match the literal user request.'
			});
		}
	}

	const sourceNumbers = extractNumericLiterals(sourceText);
	for (const field of ['default_rate', 'markup_percentage']) {
		const value = fields[field];
		if (typeof value !== 'number' && typeof value !== 'string') continue;
		const numberValue = Number(value);
		if (
			Number.isFinite(numberValue) &&
			sourceNumbers.length > 0 &&
			!sourceNumbers.some((sourceNumber) => Object.is(sourceNumber, numberValue))
		) {
			issues.push({
				field,
				message: 'The proposed numeric value does not match the literal user request.'
			});
		}
	}

	return issues;
}

function proposalFieldLabel(fields: Record<string, unknown>, recordId?: string): string | null {
	const value =
		fields.name ?? fields.label ?? fields.display_name ?? fields.code ?? recordId ?? null;
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function buildProposalSummary(
	scope: SourceRecordProposalScope,
	action: SourceRecordProposalAction,
	fields: Record<string, unknown>,
	recordId?: string,
	sourceLabel?: string | null
): string {
	const label = sourceLabel ?? proposalFieldLabel(fields, recordId);
	return `${action === 'create' ? 'Create' : 'Update'} ${proposalScopeLabels[scope]}${label ? ` “${label}”` : ''}.`;
}

export function proposeSourceRecordChange(
	input: unknown,
	options: SourceRecordProposalOptions = {}
) {
	const parsed = RecordsProposeChangeParametersSchema.safeParse(normalizeProposalInput(input));
	if (!parsed.success) {
		return {
			status: 'error' as const,
			code: 'invalid_arguments',
			recoverable: true,
			message: 'Proposal arguments did not match the required schema.',
			issues: parsed.error.issues.map((issue) => ({
				code: issue.code,
				message: issue.message,
				path: issue.path
			})),
			retryHint:
				'Retry the same scope-specific proposal tool with action and the records_search ref for updates.'
		};
	}

	const { scope, action, recordId } = parsed.data;
	if (action === 'update' && !recordId) {
		return {
			status: 'error' as const,
			code: 'missing_record_id',
			recoverable: true,
			message: 'Updates require an exact recordId.',
			retryHint: 'Use records_search and records_get to identify the exact record, then retry.'
		};
	}

	const normalized = normalizeFields(scope, parsed.data.fields ?? {});
	if (normalized.rejected.length > 0) {
		return {
			status: 'error' as const,
			code: 'unsupported_fields',
			recoverable: true,
			message: `Unsupported field${normalized.rejected.length === 1 ? '' : 's'}: ${normalized.rejected.join(', ')}.`,
			retryHint: `Retry with only these fields for ${scope}: ${Array.from(allowedFieldsByScope[scope]).join(', ')}.`,
			rejected: normalized.rejected
		};
	}

	const valueIssues = validateFieldValues(scope, normalized.fields);
	if (valueIssues.length > 0) {
		return {
			status: 'error' as const,
			code: 'invalid_field_values',
			recoverable: true,
			message: 'One or more proposal fields have invalid values.',
			issues: valueIssues,
			retryHint:
				'Retry the same scope-specific proposal tool with a valid sourceItem and the records_search ref when updating.'
		};
	}

	const literalIssues = validateLiteralSourceValues(normalized.fields, options.sourceText);
	if (literalIssues.length > 0) {
		return {
			status: 'error' as const,
			code: 'literal_value_mismatch',
			recoverable: true,
			message: 'One or more proposal fields do not match the literal user request.',
			issues: literalIssues,
			retryHint:
				'Retry the same scope-specific proposal tool with the sourceItem containing the exact user-provided values.'
		};
	}

	if (Object.keys(normalized.fields).length === 0) {
		return {
			status: 'error' as const,
			code: 'missing_fields',
			recoverable: true,
			message: 'A proposal must change at least one field.',
			retryHint: 'Retry with at least one allowlisted field.'
		};
	}

	const required = action === 'create' ? requiredCreateFieldsByScope[scope] : [];
	const missing = required.filter((field) => fieldIsBlank(normalized.fields[field]));
	if (missing.length > 0) {
		return {
			status: 'error' as const,
			code: 'missing_required_fields',
			recoverable: true,
			message: `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
			retryHint: 'Retry with the required fields for this record family.',
			missing
		};
	}

	const proposal: SourceRecordProposal = {
		id: `source-record-proposal-${crypto.randomUUID()}`,
		scope,
		action,
		recordId,
		fields: normalized.fields,
		summary: buildProposalSummary(
			scope,
			action,
			normalized.fields,
			recordId,
			typeof parsed.data.text === 'string'
				? action === 'update'
					? (extractDelimitedValue(parsed.data.text, ['code']) ??
						extractRecordLabel(scope, parsed.data.text))
					: extractRecordLabel(scope, parsed.data.text)
				: null
		)
	};

	return {
		status: 'proposal' as const,
		proposal
	};
}
