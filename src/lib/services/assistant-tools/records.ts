import { z } from 'zod';
import { dbService } from '$lib/services/db.js';

export const RecordsDescribeParametersSchema = z.object({
	scope: z.string().trim().min(1).max(80).optional()
});

export const RecordsSearchParametersSchema = z
	.object({
		scope: z.string().trim().min(1).max(80).optional(),
		query: z.string().trim().max(160).default(''),
		browse: z.boolean().default(false),
		limit: z.number().int().min(1).max(10).default(5),
		projectId: z.string().trim().min(1).optional(),
		includeInactive: z.boolean().default(false)
	})
	.refine((value) => value.browse || value.query.length > 0, {
		message: 'records_search requires a query unless browse is true.',
		path: ['query']
	});

export const RecordsGetParametersSchema = z.object({
	scope: z.string().trim().min(1).max(80),
	recordId: z.string().trim().min(1).max(160),
	projectId: z.string().trim().min(1).optional()
});

export type RecordScopeDescription = {
	scope: string;
	label: string;
	description: string;
	searchableFields: string[];
	detailFields: Array<{ name: string; kind: string }>;
	supportedFilters: string[];
};

export type RecordSearchResult = {
	scope: string;
	id: string;
	label: string;
	subtitle: string | null;
	relevance: number;
	fields: Record<string, string | number | boolean | null>;
};

export type RecordDetail = {
	scope: string;
	recordId: string;
	label: string;
	subtitle: string | null;
	fields: Record<string, unknown>;
};

export type RecordsSource = {
	describe: (scope?: string) => Promise<RecordScopeDescription[]>;
	search: (
		input: z.infer<typeof RecordsSearchParametersSchema> & { workspaceId?: string }
	) => Promise<RecordSearchResult[]>;
	get: (
		input: z.infer<typeof RecordsGetParametersSchema> & { workspaceId?: string }
	) => Promise<RecordDetail | null>;
};

type ToolIssue = {
	code: string;
	message: string;
	path?: PropertyKey[];
};

const RECORD_SCOPE_ALIASES = new Map<string, string>([
	['rfq', 'projects'],
	['rfqs', 'projects'],
	['project', 'projects'],
	['projects', 'projects'],
	['contact', 'contacts'],
	['contacts', 'contacts'],
	['company', 'contacts'],
	['companies', 'contacts'],
	['person', 'contacts'],
	['people', 'contacts'],
	['material', 'materials'],
	['materials', 'materials'],
	['labour', 'labour_rates'],
	['labor', 'labour_rates'],
	['labour rates', 'labour_rates'],
	['labor rates', 'labour_rates'],
	['equipment', 'equipment_rates'],
	['equipment rates', 'equipment_rates'],
	['subcontract', 'subcontract_rates'],
	['subcontract rates', 'subcontract_rates'],
	['subcontracts', 'subcontract_rates'],
	['subcontractors', 'subcontract_rates']
]);

function normalizeRecordScope(scope: string | undefined): string | undefined {
	const trimmed = scope?.trim();
	if (!trimmed) return undefined;
	const canonical = trimmed.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
	return RECORD_SCOPE_ALIASES.get(canonical) ?? canonical.replace(/\s+/g, '_');
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function invalidArguments(error: z.ZodError) {
	return {
		status: 'error' as const,
		code: 'invalid_arguments',
		recoverable: true,
		message: 'Tool arguments did not match the required schema.',
		retryHint: 'Retry the tool call with arguments that match the declared schema.',
		issues: error.issues.map((issue): ToolIssue => ({
			code: issue.code,
			message: issue.message,
			path: issue.path
		}))
	};
}

const liveSource: RecordsSource = {
	describe: (scope) => dbService.describeWorkspaceRecords(scope),
	search: (input) => dbService.searchAssistantRecords(input),
	get: (input) => dbService.getWorkspaceRecord(input)
};

export async function describeRecords(input: unknown, source: RecordsSource = liveSource) {
	const parsed = RecordsDescribeParametersSchema.safeParse(input);
	if (!parsed.success) return invalidArguments(parsed.error);
	try {
		return {
			status: 'ok' as const,
			scopes: await source.describe(normalizeRecordScope(parsed.data.scope)),
			issues: []
		};
	} catch (error) {
		return {
			status: 'unavailable' as const,
			code: 'describe_failed',
			recoverable: true,
			message: errorMessage(error),
			scopes: [],
			retryHint: 'Call records_describe without a scope to inspect allowed scopes, then retry.',
			issues: [{ code: 'describe_failed', message: errorMessage(error) }]
		};
	}
}

export async function searchRecords(
	input: unknown,
	source: RecordsSource = liveSource,
	workspaceId?: string
) {
	const parsed = RecordsSearchParametersSchema.safeParse(input);
	if (!parsed.success) return invalidArguments(parsed.error);
	try {
		const normalizedScope = normalizeRecordScope(parsed.data.scope);
		let results = await source.search({
			...parsed.data,
			scope: normalizedScope,
			workspaceId
		});
		const fallback =
			normalizedScope && !parsed.data.browse && results.length === 0
				? {
						reason: `No records matched in scope "${normalizedScope}". Retried once across all allowed scopes.`,
						originalScope: normalizedScope
					}
				: undefined;
		if (fallback) {
			results = await source.search({
				...parsed.data,
				scope: undefined,
				workspaceId
			});
		}
		return {
			status: 'ok' as const,
			results,
			fallback,
			recoverable: results.length === 0,
			retryHint:
				results.length === 0
					? 'No records matched. Broaden the query, omit scope, or call records_describe to inspect available scopes.'
					: undefined,
			issues: []
		};
	} catch (error) {
		return {
			status: 'unavailable' as const,
			code: 'search_failed',
			recoverable: true,
			message: errorMessage(error),
			results: [],
			retryHint: 'Call records_describe to inspect allowed scopes, then retry records_search.',
			issues: [{ code: 'search_failed', message: errorMessage(error) }]
		};
	}
}

export async function getRecord(
	input: unknown,
	source: RecordsSource = liveSource,
	workspaceId?: string
) {
	const parsed = RecordsGetParametersSchema.safeParse(input);
	if (!parsed.success) return invalidArguments(parsed.error);
	try {
		const normalizedScope = normalizeRecordScope(parsed.data.scope) ?? parsed.data.scope;
		const record = await source.get({ ...parsed.data, scope: normalizedScope, workspaceId });
		return {
			status: record ? ('ok' as const) : ('not_found' as const),
			code: record ? undefined : 'record_not_found',
			recoverable: !record,
			record,
			retryHint: record
				? undefined
				: 'Use records_search to find candidate records before records_get.',
			issues: record
				? []
				: [
						{
							code: 'record_not_found',
							message: `No ${normalizedScope} record matched ${parsed.data.recordId}.`
						}
					]
		};
	} catch (error) {
		return {
			status: 'unavailable' as const,
			code: 'get_failed',
			recoverable: true,
			message: errorMessage(error),
			record: null,
			retryHint:
				'Call records_search to find candidate records, then retry records_get with an exact ID.',
			issues: [{ code: 'get_failed', message: errorMessage(error) }]
		};
	}
}
