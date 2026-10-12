import { createLogger } from '$lib/services/logger.js';
import {
	localAiService,
	type LocalAiCompletionArtifact,
	type LocalAiCompletionResponse,
	type LocalAiStreamController
} from '$lib/services/local-ai.js';
import {
	buildLocalAssistantContext,
	selectLocalAssistantContextSections
} from '$lib/services/local-assistant-context.js';
import { profileState } from '$lib/state/profile.svelte.js';
import { isTauri, getRuntimePlatformLabel } from '$lib/utils/env.js';
import { normaliseToolCallArguments } from '$lib/utils/json-like.js';
import { APP_VERSION } from '$lib/constants/index.js';
import { dbService } from '$lib/services/db.js';
import type { LocalAssistantViewportContext } from '$lib/services/local-assistant-viewport-context.js';
import {
	captureViewportScreenshot,
	getViewportScreenshot
} from '$lib/services/local-assistant-screenshot.js';
import {
	evaluateDecimalExpression,
	validateQuantityFormula
} from '$lib/services/assistant-tools/calculator.js';
import { convertEstimatorUnit } from '$lib/services/assistant-tools/units.js';
import {
	describeRecords,
	getRecord,
	searchRecords
} from '$lib/services/assistant-tools/records.js';
import {
	buildMutationSourceItems,
	extractSourceRecordProposalFields,
	hasSourceRecordProposalFieldValues,
	proposeSourceRecordChange,
	type SourceRecordProposalScope,
	type SourceRecordProposal
} from '$lib/services/assistant-tools/source-record-proposals.js';
import {
	getAssistantActionDefinition,
	getAssistantToolDeclarations
} from '$lib/services/assistant-actions/registry.js';
import type {
	AiWorkspaceKnowledgeContext,
	LocalAssistantAnswer,
	LocalAssistantContextSection,
	LocalAssistantEstimateContext,
	LocalAssistantImageAttachment,
	LocalAssistantMessage,
	LocalAssistantProposalSet,
	WorkspaceProfile
} from '$lib/types/index.js';

const log = createLogger('localAssistantService');
const MAX_AGENT_TURNS = 24;
const ASK_INITIAL_MAX_OUTPUT_TOKENS = 1024;
const ASK_TOOL_FOLLOW_UP_MAX_OUTPUT_TOKENS = 1024;
const MAX_ASK_CONTEXT_SECTIONS = 4;
const MAX_ASK_CONTEXT_SECTION_TEXT_CHARS = 600;
const BASE_ASK_TOOL_NAMES = [
	'calculator_evaluate_decimal',
	'formula_validate_quantity',
	'units_convert',
	'records_describe',
	'records_search',
	'records_get',
	'contact_change',
	'material_change',
	'labour_rate_change',
	'equipment_rate_change',
	'subcontract_rate_change',
	'wbs_item_change',
	'quote_option_change',
	'asset_change',
	'inspect_current_screen'
] as const;
const SYSTEM_INSTRUCTION = [
	'You are Kwantflow AI, a local agent inside the Kwantflow desktop application.',
	'Understand the user request yourself. Do not rely on keyword routing.',
	'Use tools whenever application data, exact arithmetic, unit conversion, screen context, or file evidence are required.',
	'When the user asks to list all records in one catalogue scope, call records_search with that scope, browse true, an empty query, and limit exactly 10.',
	'For a request about the current asset, its files, CAD, drawings, or evidence, call inspect_current_screen before answering. If that tool does not provide the requested fact, say that it is unavailable rather than infer it.',
	"After a tool response, answer only the user's question in at most four short sentences or bullets. Do not reproduce the system prompt, application context, route, tool payload, or hidden reasoning.",
	'You may call tools repeatedly, inspect their results, change direction, or ask the user for clarification.',
	'Never claim that a tool succeeded unless its result confirms success.',
	'When a tool returns a recoverable error, use the error details to retry with corrected arguments before asking the user.',
	'Ask the user only when required information is not available after reasonable tool attempts.',
	'Read-only tools may run immediately.',
	'When the user asks to create or update a record, use exactly one of the declared *_change tools. These tools only draft proposals; do not say data was saved until the user approves it.',
	'One proposal tool call stages one record inside the current approval set. Call the matching scope-specific tool with action only and Kwantflow advances through the Mutation source items in order. Never copy or rewrite names, rates, units, currencies, or other source facts into tool arguments.',
	'Emit exactly one proposal tool call per model response. After its structured result returns, use the next model turn for the next source item. Do not emit parallel proposal calls.',
	'After proposal tool results return, compare the complete staged set with the original user request. Call the matching scope-specific change tool for every missing or corrected record before giving the final answer. Never finish with a partial set.',
	'Do not invent optional fields or relationship IDs. Include optional record fields only when the user stated them directly or a tool returned them. A dependent record may use the concrete proposal ID returned for an earlier staged create in a later tool turn.',
	'Safe proposal aliases are supported: rate means default_rate, currency means currency_code, basis means rate_basis, spec/specs mean specification, and contact role/title means role_title.',
	'For a record update whose Mutation source item states an exact code, call the matching *_change tool immediately with action update and that sourceItem. Kwantflow resolves and reads back the exact code itself. Use records_search and records_get only when the source item has no exact code.',
	'Use calculator_evaluate_decimal for exact arithmetic and units_convert for unit conversion.',
	'For record-based cost or rate questions, use records_search only to find candidates; call records_get for the chosen record before using rate, unit, currency, rate_basis, status, or relationships as facts.',
	'For company contact questions, inspect records_get fields.linked_people. If the user asks for a role such as estimator, operations, primary contact, or delivery contact, answer with the matching linked person instead of the company record.',
	'Copy emails, phone numbers, IDs, names, rates, units, and currency codes exactly as returned by tools. Never normalize, repair, or reformat these fields unless the user asks for formatting.',
	'Preserve the exact quantity from the user and the exact rate, unit, currency, and rate_basis from the records_get result.',
	'Before finalizing a numeric answer, verify that the calculator expression uses those exact inputs; if the calculator expression or result conflicts with the user quantity or record rate, retry the tool call.',
	'For currency answers, use the exact calculator value for computation, then present normal money formatting such as 1212.50 AUD for AUD; do not invent or preserve odd trailing zeros.',
	'Combine monetary values only when their currency codes match; otherwise ask for clarification or report separate totals.',
	'When finished, answer naturally.'
].join('\n');

type AskToolDeclaration = ReturnType<typeof getAssistantToolDeclarations>[number];

type NativeToolCall = {
	id?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
};

type RecordRef = {
	ref: string;
	scope: string;
	recordId: string;
	label: string;
	retrieved: boolean;
};

type RecordRefStore = {
	next: number;
	byRef: Map<string, RecordRef>;
	byScope: Map<string, RecordRef[]>;
};

type TurnRequest = {
	prompt: string;
	pathname: string;
	projectId: string | null;
	assetId: string | null;
	workspaceId?: string;
	workspaceProfile: WorkspaceProfile | null;
	knowledgeContext: AiWorkspaceKnowledgeContext | null;
	currentEstimateContext: LocalAssistantEstimateContext | null;
	viewportContext: LocalAssistantViewportContext | null;
	conversation: LocalAssistantMessage[];
	attachments: LocalAssistantImageAttachment[];
	currencyCode?: string;
	currencySymbol?: string;
};

function gemmaAssistantToolCallMessage(toolCalls: NativeToolCall[]): Record<string, unknown> {
	return {
		role: 'assistant',
		tool_calls: toolCalls.map((call) => {
			try {
				return {
					...call,
					function: {
						...call.function,
						arguments: JSON.parse(call.function?.arguments ?? '{}')
					}
				};
			} catch {
				return call;
			}
		}),
		content: ''
	};
}

function gemmaToolResponseMessage(
	results: Array<{ name: string; response: unknown }>
): Record<string, unknown> {
	const toolResponses = results.map((result) => ({
		type: 'tool_response',
		tool_response: {
			name: result.name,
			value: result.response
		}
	}));
	return {
		role: 'tool',
		tool_responses: toolResponses,
		content: toolResponses,
		content_fallback: results
			.map((result) => `${result.name} returned ${JSON.stringify(result.response)}`)
			.join('\n')
	};
}

function compactViewportToolResponse(viewport: LocalAssistantViewportContext | null): unknown {
	if (!viewport) return null;
	const cad = viewport.cadMetadata
		? {
				format: viewport.cadMetadata.format,
				dimensions_mm: viewport.cadMetadata.dimensions ?? null,
				vertices: viewport.cadMetadata.vertexCount,
				faces: viewport.cadMetadata.faceCount,
				edges: viewport.cadMetadata.edgeCount,
				description: viewport.cadMetadata.sourceSummary ?? null
			}
		: null;
	const screen = viewport.screen
		? {
				active_view: viewport.screen.activeView ?? null,
				visible_records: (viewport.screen.visibleRecords ?? []).slice(0, 5),
				draft_summary: viewport.screen.draftSummary ?? null,
				status_messages: (viewport.screen.statusMessages ?? []).slice(0, 5)
			}
		: null;
	return {
		page_title: viewport.pageTitle,
		cad,
		screen,
		...(cad || screen ? {} : { summary: compactAskContextText(viewport.text) })
	};
}

function normaliseNumericFact(value: string): string {
	return value.replace(/[^0-9]/g, '');
}

function hasOnlyViewportNumericFacts(
	answer: string,
	viewport: LocalAssistantViewportContext | null
): boolean {
	const source = JSON.stringify(compactViewportToolResponse(viewport));
	const sourceFacts = new Set(
		(source.match(/\b\d+(?:[.,]\d+)*\b/g) ?? []).map(normaliseNumericFact).filter(Boolean)
	);
	return (answer.match(/\b\d+(?:[.,]\d+)*\b/g) ?? []).every((value) =>
		sourceFacts.has(normaliseNumericFact(value))
	);
}

function deterministicViewportEvidenceSummary(
	viewport: LocalAssistantViewportContext | null
): string {
	if (!viewport) return 'I could not inspect the current screen evidence.';
	const parts = [`I inspected ${viewport.pageTitle}.`];
	if (viewport.cadMetadata) {
		const cad = viewport.cadMetadata;
		const dimensions = cad.dimensions
			? ` Dimensions: ${cad.dimensions.x} × ${cad.dimensions.y} × ${cad.dimensions.z} mm.`
			: '';
		parts.push(
			`Visible CAD evidence: ${cad.format.toUpperCase()} model with ${cad.faceCount.toLocaleString()} faces.${dimensions}`
		);
	}
	const visibleRecords = viewport.screen?.visibleRecords ?? [];
	if (visibleRecords.length > 0) {
		parts.push(
			`Visible records: ${visibleRecords
				.slice(0, 5)
				.map((record) => record.label)
				.join(', ')}.`
		);
	}
	if (parts.length === 1) {
		parts.push('The screen did not expose more structured evidence for a safe summary.');
	}
	return parts.join(' ');
}

function isExplicitViewportEvidenceSummaryRequest(prompt: string): boolean {
	const normalised = prompt.trim().toLowerCase();
	if (!normalised) return false;
	const asksForSummary = /^(?:please\s+)?(?:summari[sz]e|list|show|describe)\b/.test(normalised);
	const asksForViewportFacts =
		/\b(?:current screen|visible|screen evidence|visible evidence)\b/.test(normalised);
	return asksForSummary && asksForViewportFacts;
}

function explicitCreateProposalScope(prompt: string): SourceRecordProposalScope | null {
	if (!/^\s*(?:propose|draft)\b/i.test(prompt)) return null;
	const scopes: Array<[SourceRecordProposalScope, RegExp]> = [
		['materials', /\bmaterials?\b/i],
		['labour_rates', /\blabou?r(?:\s+rate)?s?\b/i],
		['equipment_rates', /\bequipment(?:\s+rate)?s?\b/i],
		['subcontract_rates', /\bsubcontract(?:\s+rate|or)?s?\b/i],
		['contacts', /\b(?:contact|company|person)\b/i],
		['wbs_nodes', /\bwbs(?:\s+(?:item|node))?\b/i],
		['quote_options', /\bquote\s+option\b/i],
		['assets', /\basset\b/i]
	];
	return scopes.find(([, pattern]) => pattern.test(prompt))?.[0] ?? null;
}

function buildExplicitCreateProposalAnswer(prompt: string): LocalAssistantAnswer | null {
	const scope = explicitCreateProposalScope(prompt);
	if (!scope) return null;
	const staged = proposeSourceRecordChange(
		{ scope, action: 'create', text: prompt },
		{ sourceText: prompt }
	);
	if (staged.status !== 'proposal') return null;
	const toolNameByScope: Record<SourceRecordProposalScope, string> = {
		contacts: 'contact_change',
		materials: 'material_change',
		labour_rates: 'labour_rate_change',
		equipment_rates: 'equipment_rate_change',
		subcontract_rates: 'subcontract_rate_change',
		wbs_nodes: 'wbs_item_change',
		quote_options: 'quote_option_change',
		assets: 'asset_change'
	};
	return {
		answer: 'I drafted 1 proposed change for approval.',
		citations: [],
		links: [],
		followUpSuggestions: [],
		proposalSet: {
			id: `source-record-proposal-set-${crypto.randomUUID()}`,
			turnId: `assistant-turn-${crypto.randomUUID()}`,
			summary: 'I drafted 1 proposed change for approval.',
			items: [staged.proposal],
			status: 'pending'
		},
		toolCalls: [
			{
				name: toolNameByScope[scope],
				arguments: { action: 'create' }
			}
		]
	};
}

function historyMessages(messages: LocalAssistantMessage[]): Array<Record<string, unknown>> {
	return messages.flatMap((message) => {
		if (message.role === 'assistant' && message.tool_calls?.length) {
			return {
				role: 'assistant',
				content: message.text,
				tool_calls: message.tool_calls
			};
		}
		if (message.role === 'tool') return [];
		return { role: message.role, content: message.text };
	});
}

function compactAskContextText(value: string): string {
	const text = value.trim();
	if (text.length <= MAX_ASK_CONTEXT_SECTION_TEXT_CHARS) return text;
	return `${text.slice(0, MAX_ASK_CONTEXT_SECTION_TEXT_CHARS - 1).trimEnd()}…`;
}

function buildUserContent(
	prompt: string,
	sections: LocalAssistantContextSection[],
	attachments: LocalAssistantImageAttachment[],
	context: Pick<TurnRequest, 'pathname' | 'projectId' | 'assetId'>
): string {
	const selectedSections = selectLocalAssistantContextSections({
		sections,
		query: prompt,
		pathname: context.pathname,
		projectId: context.projectId,
		assetId: context.assetId,
		maxSections: MAX_ASK_CONTEXT_SECTIONS
	});
	const applicationContext = selectedSections
		.map(
			(section) =>
				`[${section.title}]\n${section.summary}\n${compactAskContextText(section.text)}${
					section.route ? `\nRoute: ${section.route}` : ''
				}`
		)
		.join('\n\n');
	const attachmentSummary = attachments
		.map(
			(attachment, index) => `Attachment ${index + 1}: ${attachment.name} (${attachment.mimeType})`
		)
		.join('\n');
	return [
		prompt,
		applicationContext && `Current application context:\n${applicationContext}`,
		attachmentSummary
	]
		.filter(Boolean)
		.join('\n\n');
}

function artifacts(attachments: LocalAssistantImageAttachment[]): LocalAiCompletionArtifact[] {
	return attachments.map((attachment) => ({
		kind: 'image',
		mimeType: attachment.mimeType,
		base64Data: attachment.base64Data
	}));
}

function askToolDeclarations(hasViewportContext: boolean): AskToolDeclaration[] {
	const names = new Set<string>(BASE_ASK_TOOL_NAMES);
	if (!hasViewportContext) names.delete('inspect_current_screen');
	return getAssistantToolDeclarations().filter((tool) => names.has(tool.function.name));
}

function buildToolGuidance(tools: AskToolDeclaration[]): string {
	if (!tools.length) return '';
	const toolNames = tools.map((tool) => tool.function.name).join(', ');
	return `Available tools: ${toolNames}`;
}

function buildSystemInstruction(
	tools: AskToolDeclaration[],
	userProfile?: { firstName: string; lastName: string; email: string | null },
	stats?: {
		projectsCount: number;
		contactsCount: number;
		materialsCount: number;
		ratesCount: number;
	}
): string {
	const now = new Date();
	const dateString = now.toLocaleString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
		hour12: true
	});
	const timezoneOffset = -now.getTimezoneOffset();
	const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
	const offsetMinutes = Math.abs(timezoneOffset) % 60;
	const offsetSign = timezoneOffset >= 0 ? '+' : '-';
	const formattedOffset = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;

	const platform = isTauri() ? getRuntimePlatformLabel() : 'Web Browser';

	const environmentLines = [
		`- Date & Time: ${dateString}`,
		`- Timezone Offset: UTC${formattedOffset}`,
		`- Client Version: v${APP_VERSION}`,
		`- Client Platform: ${platform}`
	];

	if (userProfile && (userProfile.firstName || userProfile.email)) {
		const namePart = [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ');
		const contactPart = userProfile.email ? `(${userProfile.email})` : '';
		const identity = [namePart, contactPart].filter(Boolean).join(' ');
		if (identity) {
			environmentLines.push(`- Operator Identity: ${identity}`);
		}
	}

	if (stats) {
		environmentLines.push(
			`- Database Scale: ${stats.projectsCount} projects/RFQs, ${stats.contactsCount} contacts/vendors, ${stats.materialsCount} material catalog items, ${stats.ratesCount} service rate cards`
		);
	}

	const timeInstruction = `Current local environment:\n${environmentLines.join('\n')}`;

	return [SYSTEM_INSTRUCTION, timeInstruction, buildToolGuidance(tools)]
		.filter(Boolean)
		.join('\n\n');
}

function parseToolArguments(call: NativeToolCall): unknown {
	const name = call.function?.name;
	const definition = name ? getAssistantActionDefinition(name) : null;
	if (!name || !definition) throw new Error(`Unknown tool: ${name ?? 'missing name'}`);
	const raw = normaliseToolCallArguments(call.function?.arguments ?? '{}', name);
	if (definition.proposalScope) return raw;
	return definition.parse(raw);
}

function proposalScopeForTool(name: string) {
	return getAssistantActionDefinition(name)?.proposalScope ?? null;
}

function isProposalTool(name: string): boolean {
	return proposalScopeForTool(name) !== null;
}

function sourceItemIndex(value: unknown): number | null {
	if (typeof value === 'string') {
		const match = value.match(/^item_(\d+)$/);
		if (match) return Number(match[1]);
	}
	const numeric = Number(value);
	return Number.isInteger(numeric) ? numeric : null;
}

function exactText(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function resolveExactCodeUpdateTarget(
	scope: SourceRecordProposalScope,
	sourceText: string,
	request: TurnRequest
): Promise<{ recordId: string | null; error: Record<string, unknown> | null }> {
	const fields = extractSourceRecordProposalFields(scope, 'create', sourceText);
	const code = exactText(fields.code);
	if (!code) return { recordId: null, error: null };

	const workspaceId = request.workspaceId ?? request.workspaceProfile?.workspaceId;
	const search = await searchRecords({ scope, query: code, limit: 10 }, undefined, workspaceId);
	if (search.status !== 'ok') {
		return {
			recordId: null,
			error: {
				status: 'error',
				code: 'exact_update_lookup_failed',
				recoverable: true,
				message: 'Kwantflow could not verify the exact record code for this update.',
				retryHint:
					'Use the exact existing record code, or search and inspect the record before retrying.'
			}
		};
	}
	const matches = search.results.filter(
		(candidate) =>
			candidate.scope === scope &&
			exactText(candidate.fields.code ?? candidate.subtitle)?.toLocaleLowerCase() ===
				code.toLocaleLowerCase()
	);
	if (matches.length !== 1) {
		return {
			recordId: null,
			error: {
				status: 'error',
				code: 'exact_update_target_required',
				recoverable: true,
				message:
					matches.length === 0
						? `No ${scope} record has the exact code ${code}.`
						: `More than one ${scope} record has the exact code ${code}.`,
				retryHint:
					'Use one unique existing record code, or search and inspect the record before retrying.'
			}
		};
	}
	const recordId = matches[0]!.id;
	const detail = await getRecord({ scope, recordId }, undefined, workspaceId);
	if (
		detail.status !== 'ok' ||
		exactText(detail.record?.fields.code)?.toLocaleLowerCase() !== code.toLocaleLowerCase()
	) {
		return {
			recordId: null,
			error: {
				status: 'error',
				code: 'exact_update_readback_failed',
				recoverable: true,
				message: 'Kwantflow could not verify the exact record before proposing this update.',
				retryHint: 'Search and inspect the record, then retry the update.'
			}
		};
	}
	return { recordId, error: null };
}

function createRecordRefStore(): RecordRefStore {
	return {
		next: 1,
		byRef: new Map(),
		byScope: new Map()
	};
}

function recordSearchResults(response: unknown): Array<Record<string, unknown>> {
	if (!response || typeof response !== 'object') return [];
	const results = 'results' in response ? response.results : null;
	return Array.isArray(results)
		? results.filter(
				(result): result is Record<string, unknown> => Boolean(result) && typeof result === 'object'
			)
		: [];
}

function addRecordSearchRefs(response: unknown, refs: RecordRefStore): unknown {
	if (!response || typeof response !== 'object') return response;
	const results = recordSearchResults(response);
	if (!results.length) return response;
	const recordRefs: RecordRef[] = [];
	const nextResults = results.map((result) => {
		const scope = String(result.scope ?? '').trim();
		const recordId = String(result.id ?? result.recordId ?? '').trim();
		const label = String(result.label ?? '').trim();
		if (!scope || !recordId) return result;
		const ref = `r${refs.next++}`;
		const entry = { ref, scope, recordId, label, retrieved: false };
		refs.byRef.set(ref, entry);
		const scoped = refs.byScope.get(scope) ?? [];
		scoped.push(entry);
		refs.byScope.set(scope, scoped);
		recordRefs.push(entry);
		return { ...result, ref };
	});
	return { ...response, results: nextResults, recordRefs };
}

function resolveRecordGetArgs(
	args: Record<string, unknown>,
	refs: RecordRefStore
): Record<string, unknown> {
	const scope = String(args.scope ?? '').trim();
	const recordId = String(args.recordId ?? '').trim();
	const byRef = refs.byRef.get(recordId);
	if (byRef && (!scope || byRef.scope === scope)) {
		return { ...args, scope: byRef.scope, recordId: byRef.recordId };
	}
	return args;
}

async function executeTool(
	call: NativeToolCall,
	request: TurnRequest,
	recordRefs: RecordRefStore,
	nextProposalSourceItem: number | null = null
): Promise<{
	name: string;
	content: unknown;
	artifact?: LocalAiCompletionArtifact;
	proposal?: SourceRecordProposal;
}> {
	const name = call.function?.name ?? '';
	const args = parseToolArguments(call) as Record<string, unknown>;
	const proposalScope = proposalScopeForTool(name);
	if (proposalScope) {
		const sourceItems = buildMutationSourceItems(request.prompt);
		const explicitSourceItem = sourceItemIndex(args.sourceItem);
		const hasExplicitFields =
			Boolean(args.fields) &&
			typeof args.fields === 'object' &&
			!Array.isArray(args.fields) &&
			Object.keys(args.fields as Record<string, unknown>).length > 0;
		const hasExplicitProposalValues = hasSourceRecordProposalFieldValues(proposalScope, args);
		const sourceItem =
			explicitSourceItem ??
			(!hasExplicitFields && !hasExplicitProposalValues ? nextProposalSourceItem : null);
		const hasSourceItem = sourceItem !== null;
		const useAuthoritativeSourceText =
			sourceItem !== null && !hasExplicitFields && !hasExplicitProposalValues;
		if (!hasSourceItem && !hasExplicitFields && !hasExplicitProposalValues) {
			return {
				name,
				content: {
					status: 'error',
					code: 'no_remaining_source_item',
					recoverable: true,
					message: 'There is no remaining Mutation source item for this proposal call.',
					retryHint: 'Finish the response or call a different scope-specific proposal tool.'
				}
			};
		}
		if (sourceItem !== null && (sourceItem < 1 || sourceItem > sourceItems.length)) {
			return {
				name,
				content: {
					status: 'error',
					code: 'invalid_source_item',
					recoverable: true,
					message: `sourceItem must identify one of the ${sourceItems.length} Mutation source items.`,
					retryHint: 'Call the proposal tool again; Kwantflow will advance to the next source item.'
				}
			};
		}
		const sourceText = sourceItem !== null ? sourceItems[sourceItem - 1] : request.prompt;
		const isSourceAnchoredUpdate =
			useAuthoritativeSourceText && String(args.action ?? '') === 'update';
		const exactTarget = isSourceAnchoredUpdate
			? await resolveExactCodeUpdateTarget(proposalScope, sourceText, request)
			: { recordId: null, error: null };
		if (exactTarget.error) {
			return { name, content: exactTarget.error };
		}
		const groundedArgs = resolveRecordGetArgs(
			useAuthoritativeSourceText
				? {
						action: args.action,
						...(exactTarget.recordId
							? { recordId: exactTarget.recordId }
							: typeof args.recordId === 'string'
								? { recordId: args.recordId }
								: {}),
						scope: proposalScope
					}
				: { ...args, scope: proposalScope },
			recordRefs
		);
		if (String(groundedArgs.action ?? '') === 'update') {
			const recordId = String(groundedArgs.recordId ?? '').trim();
			const retrievedRecord = (recordRefs.byScope.get(proposalScope) ?? []).find(
				(entry) => entry.recordId === recordId && entry.retrieved
			);
			if (!retrievedRecord && exactTarget.recordId !== recordId) {
				return {
					name,
					content: {
						status: 'error',
						code: 'record_detail_required',
						recoverable: true,
						message:
							'Updates require the exact record returned by records_search and verified by records_get.',
						retryHint:
							'Call records_get with the selected search ref, then retry the update with that same ref.'
					}
				};
			}
		}
		const content = proposeSourceRecordChange(
			{
				...groundedArgs,
				...(useAuthoritativeSourceText ? { text: sourceText } : {})
			},
			{ sourceText }
		);
		if (content.status !== 'proposal') {
			const details = content as Record<string, unknown>;
			log.warn('Assistant proposal validation returned recoverable error', {
				name,
				code: details.code ?? null,
				missing: details.missing ?? null,
				rejected: details.rejected ?? null,
				issueFields: Array.isArray(details.issues)
					? details.issues
							.map((issue) =>
								issue && typeof issue === 'object' && 'field' in issue
									? String((issue as { field?: unknown }).field)
									: null
							)
							.filter(Boolean)
					: []
			});
		}
		return {
			name,
			content,
			proposal: content.status === 'proposal' ? content.proposal : undefined
		};
	}

	switch (name) {
		case 'calculator_evaluate_decimal': {
			const result = evaluateDecimalExpression(args);
			log.info('Calculated decimal expression', {
				expression: result.provenance.inputExpression,
				value: result.value
			});
			return {
				name,
				content: {
					expression: String(args.expression ?? ''),
					value: result.value
				}
			};
		}
		case 'formula_validate_quantity': {
			const result = validateQuantityFormula(args);
			return {
				name,
				content: result.valid
					? { valid: true, value: result.value ?? null }
					: { valid: false, issues: result.issues }
			};
		}
		case 'units_convert': {
			const result = convertEstimatorUnit(args);
			return { name, content: { value: result.value, unit: result.toUnit } };
		}
		case 'records_describe':
			return {
				name,
				content: await describeRecords(args)
			};
		case 'records_search':
			return {
				name,
				content: addRecordSearchRefs(
					await searchRecords(
						args,
						undefined,
						request.workspaceId ?? request.workspaceProfile?.workspaceId
					),
					recordRefs
				)
			};
		case 'records_get': {
			const resolvedArgs = resolveRecordGetArgs(args, recordRefs);
			const content = await getRecord(
				resolvedArgs,
				undefined,
				request.workspaceId ?? request.workspaceProfile?.workspaceId
			);
			if (content.status === 'ok') {
				const scope = String(resolvedArgs.scope ?? '').trim();
				const recordId = String(resolvedArgs.recordId ?? '').trim();
				const entry = (recordRefs.byScope.get(scope) ?? []).find(
					(candidate) => candidate.recordId === recordId
				);
				if (entry) entry.retrieved = true;
			}
			return { name, content };
		}
		case 'inspect_current_screen': {
			const includeScreenshot = args.includeScreenshot === true;
			if (includeScreenshot && !getViewportScreenshot(request.pathname)) {
				await captureViewportScreenshot(request.pathname);
			}
			const screenshot = includeScreenshot ? getViewportScreenshot(request.pathname) : null;
			return {
				name,
				content: {
					screen: compactViewportToolResponse(request.viewportContext),
					screenshotAttached: Boolean(screenshot)
				},
				artifact: screenshot
					? {
							kind: 'image',
							mimeType: screenshot.mimeType,
							base64Data: screenshot.base64Data
						}
					: undefined
			};
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

function isNativeToolParseFailure(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes('Failed to parse tool calls') ||
		message.includes('Failed to parse FC tool calls')
	);
}

function answerFromValidatedReadToolResult(name: string, response: unknown): string | null {
	if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
	const result = response as Record<string, unknown>;
	if (result.status !== 'ok') return null;
	if (name === 'records_search' && Array.isArray(result.results)) {
		const records = result.results
			.filter((entry): entry is Record<string, unknown> =>
				Boolean(entry && typeof entry === 'object')
			)
			.slice(0, 10);
		if (records.length === 0) return 'No matching workspace records were found.';
		const lines = records.map((record) => {
			const label = typeof record.label === 'string' ? record.label : 'Unnamed record';
			const subtitle =
				typeof record.subtitle === 'string' && record.subtitle.trim()
					? ` (${record.subtitle.trim()})`
					: '';
			return `- ${label}${subtitle}`;
		});
		return `Returned ${records.length} workspace record${records.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
	}
	if (name === 'records_get' && result.record && typeof result.record === 'object') {
		const record = result.record as Record<string, unknown>;
		const label = typeof record.label === 'string' ? record.label : 'the requested record';
		const subtitle =
			typeof record.subtitle === 'string' && record.subtitle.trim()
				? ` (${record.subtitle.trim()})`
				: '';
		return `I retrieved ${label}${subtitle}.`;
	}
	if (name === 'records_describe' && Array.isArray(result.scopes)) {
		const labels = result.scopes
			.filter((entry): entry is Record<string, unknown> =>
				Boolean(entry && typeof entry === 'object')
			)
			.map((entry) => (typeof entry.label === 'string' ? entry.label : null))
			.filter((label): label is string => Boolean(label));
		return labels.length ? `Available record types: ${labels.join(', ')}.` : null;
	}
	return null;
}

function toolFailureResponse(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const code = rawMessage.startsWith('Unknown tool:')
		? 'unknown_tool'
		: rawMessage.includes('not valid JSON') || rawMessage.includes('Unexpected token')
			? 'invalid_arguments'
			: 'tool_execution_failed';
	const message =
		code === 'unknown_tool'
			? `${rawMessage}. Available tools: ${BASE_ASK_TOOL_NAMES.join(', ')}.`
			: rawMessage;
	return {
		status: 'error' as const,
		code,
		recoverable: true,
		message,
		retryHint:
			code === 'unknown_tool'
				? 'Use only one of the declared tool names.'
				: 'Retry this tool call with corrected arguments that match the declared schema.'
	};
}

type CalculatorResultContext = {
	expression: string;
	value: string;
};

type RecordDetailEvidence = {
	scope: string;
	recordId: string;
	label: string;
	fields: Record<string, unknown>;
};

function decimalValueVariants(value: string): string[] {
	const trimmed = value.trim();
	const variants = new Set<string>([trimmed]);
	try {
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric)) {
			variants.add(String(numeric));
			variants.add(numeric.toFixed(2));
			variants.add(
				new Intl.NumberFormat('en-US', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				}).format(numeric)
			);
		}
	} catch {
		// Keep the raw string only.
	}
	return [...variants].filter(Boolean);
}

function answerContainsCalculatorValue(answer: string, result: CalculatorResultContext): boolean {
	const normalizedAnswer = answer.replace(/\s+/g, ' ');
	return decimalValueVariants(result.value).some((variant) => normalizedAnswer.includes(variant));
}

function recordDetailEvidence(response: unknown): RecordDetailEvidence | null {
	if (!response || typeof response !== 'object') return null;
	if (!('status' in response) || String(response.status) !== 'ok') return null;
	const record = 'record' in response ? response.record : null;
	if (!record || typeof record !== 'object') return null;
	const fields =
		'fields' in record && record.fields && typeof record.fields === 'object'
			? (record.fields as Record<string, unknown>)
			: {};
	return {
		scope: 'scope' in record ? String(record.scope ?? '') : '',
		recordId: 'recordId' in record ? String(record.recordId ?? '') : '',
		label: 'label' in record ? String(record.label ?? '') : '',
		fields
	};
}

function recordAnswerFacts(response: unknown): string[] {
	const evidence = recordDetailEvidence(response);
	if (!evidence) return [];
	const facts = new Set<string>();
	facts.add(`Record ${evidence.scope}/${evidence.recordId}: ${evidence.label}`);
	for (const field of [
		'display_name',
		'name',
		'role_title',
		'email',
		'phone',
		'default_rate',
		'unit',
		'currency_code',
		'rate_basis',
		'status'
	]) {
		const value = evidence.fields[field];
		if (value !== undefined && value !== null && String(value).trim()) {
			facts.add(`${field}: ${String(value)}`);
		}
	}
	const linkedPeople = evidence.fields.linked_people;
	if (Array.isArray(linkedPeople)) {
		for (const rawPerson of linkedPeople) {
			if (!rawPerson || typeof rawPerson !== 'object') continue;
			const person = rawPerson as Record<string, unknown>;
			const parts = [
				person.display_name ? `name=${String(person.display_name)}` : null,
				person.role_title ? `role_title=${String(person.role_title)}` : null,
				person.email ? `email=${String(person.email)}` : null,
				person.phone ? `phone=${String(person.phone)}` : null
			].filter(Boolean);
			if (parts.length) facts.add(`linked_person: ${parts.join(', ')}`);
		}
	}
	const linkedCompanies = evidence.fields.linked_companies;
	if (Array.isArray(linkedCompanies)) {
		for (const rawCompany of linkedCompanies) {
			if (!rawCompany || typeof rawCompany !== 'object') continue;
			const company = rawCompany as Record<string, unknown>;
			const parts = [
				company.display_name ? `name=${String(company.display_name)}` : null,
				company.id ? `id=${String(company.id)}` : null
			].filter(Boolean);
			if (parts.length) facts.add(`linked_company: ${parts.join(', ')}`);
		}
	}
	return [...facts];
}

function responseWithAnswerFacts(name: string, response: unknown): unknown {
	if (name !== 'records_get') return response;
	const answerFacts = recordAnswerFacts(response);
	if (!answerFacts.length || !response || typeof response !== 'object') return response;
	return {
		...response,
		answerFacts
	};
}

function proposalIdentity(proposal: SourceRecordProposal): string {
	if (proposal.action === 'update' && proposal.recordId) {
		return `${proposal.scope}:update:${proposal.recordId}`;
	}
	const fields = proposal.fields;
	return JSON.stringify([
		proposal.scope,
		proposal.action,
		fields.name ?? fields.label ?? proposal.id,
		fields.kind ?? null,
		fields.linked_company_id ?? null,
		fields.project_id ?? null,
		fields.parent_id ?? null
	]);
}

function proposalLabel(proposal: SourceRecordProposal): string {
	const fields = proposal.fields;
	return String(
		fields.name ??
			fields.label ??
			fields.display_name ??
			fields.code ??
			proposal.recordId ??
			proposal.scope
	);
}

function searchResultRequiresRecordDetail(response: unknown): boolean {
	if (!response || typeof response !== 'object') return false;
	const results = 'results' in response ? response.results : null;
	if (!Array.isArray(results)) return false;
	return results.some((result) => {
		if (!result || typeof result !== 'object') return false;
		const fields = 'fields' in result ? result.fields : null;
		if (!fields || typeof fields !== 'object') return false;
		return ['default_rate', 'currency_code', 'rate_basis', 'unit'].some((field) => field in fields);
	});
}

function failedCallSignature(name: string, call: NativeToolCall, response: unknown): string | null {
	if (!response || typeof response !== 'object') return null;
	const status = 'status' in response ? String(response.status) : '';
	if (!['error', 'not_found', 'unavailable'].includes(status)) return null;
	const recoverable = 'recoverable' in response ? response.recoverable === true : false;
	if (!recoverable) return null;
	const code = 'code' in response ? String(response.code) : status;
	return JSON.stringify({
		name,
		arguments: call.function?.arguments ?? '',
		code
	});
}

class LocalAssistantService {
	activeStreamAbort: (() => void) | null = null;
	private turnCounter = 0;
	private conversationWorkspaceId: string | null = null;

	async resetConversation(): Promise<void> {
		this.activeStreamAbort?.();
		this.activeStreamAbort = null;
		this.conversationWorkspaceId = null;
		this.turnCounter += 1;
		try {
			await localAiService.endConversation();
		} catch (error) {
			log.warn('Failed to reset native assistant conversation', { error });
		}
	}

	async answerTurn(
		request: TurnRequest,
		callbacks?: {
			onThinking?: (chunk: string) => void;
			onContent?: (chunk: string) => void;
			onToolCall?: (event: {
				id: string;
				name: string;
				status: 'executing' | 'success' | 'failed';
				arguments?: Record<string, unknown>;
			}) => void;
		}
	): Promise<LocalAssistantAnswer> {
		if (request.viewportContext && isExplicitViewportEvidenceSummaryRequest(request.prompt)) {
			log.info('Answered explicit viewport evidence summary without local inference', {
				pageTitle: request.viewportContext.pageTitle
			});
			return {
				answer: deterministicViewportEvidenceSummary(request.viewportContext),
				citations: [],
				links: [],
				followUpSuggestions: []
			};
		}
		const explicitCreateProposal = buildExplicitCreateProposalAnswer(request.prompt);
		if (explicitCreateProposal) {
			log.info('Drafted explicit typed proposal without local inference', {
				scope: explicitCreateProposal.proposalSet?.items[0]?.scope
			});
			return explicitCreateProposal;
		}
		const requestWorkspaceId = request.workspaceId ?? request.workspaceProfile?.workspaceId ?? null;
		if (
			this.conversationWorkspaceId &&
			requestWorkspaceId &&
			this.conversationWorkspaceId !== requestWorkspaceId
		) {
			await this.resetConversation();
		}
		const turnId = ++this.turnCounter;
		const proposalTurnId = `assistant-turn-${crypto.randomUUID()}`;
		const sections = await buildLocalAssistantContext({
			pathname: request.pathname,
			projectId: request.projectId,
			assetId: request.assetId,
			workspaceProfile: request.workspaceProfile,
			knowledgeContext: request.knowledgeContext,
			currentEstimateContext: request.currentEstimateContext,
			viewportContext: request.viewportContext,
			query: request.prompt
		});
		if (turnId !== this.turnCounter) {
			return { answer: '', citations: [], links: [], followUpSuggestions: [] };
		}

		const mutationSourceItems = buildMutationSourceItems(request.prompt);
		const tools = askToolDeclarations(Boolean(request.viewportContext));
		log.info('Starting local assistant turn', {
			toolCount: tools.length,
			toolNames: tools.map((tool) => tool.function.name),
			hasViewportContext: Boolean(request.viewportContext),
			hasAttachments: request.attachments.length > 0
		});
		// Fetch workspace statistics and user profile details dynamically
		const stats = await dbService.getWorkspaceStats();
		const userProfile = {
			firstName: profileState.firstName,
			lastName: profileState.lastName,
			email: profileState.email
		};

		const systemInstruction = buildSystemInstruction(tools, userProfile, stats);
		const initialHistory = historyMessages(request.conversation);
		const turnArtifacts = artifacts(request.attachments);
		const usePersistentConversation = turnArtifacts.length === 0;
		const mutationSourceContext = mutationSourceItems
			.map((item, index) => `${index + 1}. ${item}`)
			.join('\n');
		const userContent = `${buildUserContent(request.prompt, sections, request.attachments, {
			pathname: request.pathname,
			projectId: request.projectId,
			assetId: request.assetId
		})}\n\n[Mutation source items]\n${mutationSourceContext}`;
		const userMessage = {
			role: 'user',
			content: usePersistentConversation ? [{ type: 'text', text: userContent }] : userContent
		};
		const replayMessages: Array<Record<string, unknown>> = [
			{ role: 'system', content: systemInstruction },
			...initialHistory,
			userMessage
		];
		let nextMessage: Record<string, unknown> | Array<Record<string, unknown>> = userMessage;
		const toolLog: Array<{ name: string; arguments: Record<string, unknown> }> = [];
		let viewportInspectionUsed = false;
		const failedCallCounts = new Map<string, number>();
		const successfulReadCallSignatures = new Set<string>();
		const successfulReadResponses = new Map<string, unknown>();
		const recordRefs = createRecordRefStore();
		const stagedProposals: SourceRecordProposal[] = [];
		const stagedSourceItems = new Set<number>();
		const finishProposalSet = async (): Promise<LocalAssistantAnswer> => {
			const answer = `I drafted ${stagedProposals.length} proposed change${stagedProposals.length === 1 ? '' : 's'} for approval.`;
			if (usePersistentConversation) {
				await localAiService.endConversation();
				this.conversationWorkspaceId = null;
			}
			return {
				answer,
				citations: [],
				links: [],
				followUpSuggestions: [],
				toolCalls: toolLog,
				proposalSet: {
					id: `source-record-proposal-set-${crypto.randomUUID()}`,
					turnId: proposalTurnId,
					summary: answer,
					items: stagedProposals,
					status: 'pending'
				}
			};
		};
		let pendingProposalWaveSize = 0;
		let latestCalculatorResult: CalculatorResultContext | null = null;
		let calculatorAnswerCorrectionSent = false;
		let nativeToolParseCorrectionSent = false;
		let recordDetailRequiredBeforeCalculation = false;

		if (usePersistentConversation) {
			await localAiService.ensureConversation({
				systemInstruction,
				tools,
				messages: initialHistory,
				enableThinking: true,
				temperature: 1,
				topK: 64,
				topP: 0.95
			});
			this.conversationWorkspaceId = requestWorkspaceId;
		}

		for (let step = 1; step <= MAX_AGENT_TURNS; step += 1) {
			const maxOutputTokens =
				step === 1 ? ASK_INITIAL_MAX_OUTPUT_TOKENS : ASK_TOOL_FOLLOW_UP_MAX_OUTPUT_TOKENS;
			log.info('Starting Gemma model turn', { step, maxTurns: MAX_AGENT_TURNS });
			let thinkingStarted = false;
			const onThinking = callbacks?.onThinking
				? (chunk: string) => {
						if (!thinkingStarted) {
							thinkingStarted = true;
							if (step > 1) callbacks.onThinking?.('\n\n---\n\n');
						}
						callbacks.onThinking?.(chunk);
					}
				: undefined;
			const controller: LocalAiStreamController = usePersistentConversation
				? localAiService.sendMessageStream({
						message: nextMessage,
						parseToolCalls: true,
						maxOutputTokens,
						timeoutMs: 120_000,
						workloadClass: 'interactive',
						onThinking,
						onContent: callbacks?.onContent
					})
				: localAiService.runGroundedCompletionStream({
						stage: 'ask_kwantflow_turn',
						messages: replayMessages,
						artifacts: turnArtifacts,
						tools,
						parseToolCalls: true,
						maxOutputTokens,
						timeoutMs: 120_000,
						workloadClass: 'interactive',
						onThinking,
						onContent: callbacks?.onContent
					});
			this.activeStreamAbort = controller.dispose;

			try {
				let completion: LocalAiCompletionResponse;
				try {
					completion = await controller.start();
				} catch (error) {
					if (isNativeToolParseFailure(error)) {
						if (!nativeToolParseCorrectionSent) {
							nativeToolParseCorrectionSent = true;
							log.warn(
								'Native tool-call parser rejected Gemma output; requesting model correction',
								{
									step,
									error: error instanceof Error ? error.message : String(error)
								}
							);
							nextMessage = {
								role: 'user',
								content:
									'The previous tool call was malformed and was not executed. ' +
									'Retry at most one call using only a declared tool and its exact schema, or answer from prior validated results. ' +
									'Do not reconstruct or reuse arguments from the malformed output.'
							};
							continue;
						} else {
							return {
								answer:
									'Kwantflow AI tried to call a tool but the native runtime could not parse the call. Nothing was changed.',
								citations: [],
								links: [],
								followUpSuggestions: ['Try the request with fewer details'],
								toolCalls: toolLog
							};
						}
					} else {
						throw error;
					}
				}
				if (turnId !== this.turnCounter) {
					return { answer: '', citations: [], links: [], followUpSuggestions: [] };
				}

				const calls = completion.toolCalls ?? [];
				log.info('Completed Gemma model turn', {
					step,
					hasThinking: Boolean(completion.thinking),
					toolCallCount: calls.length
				});
				const actionableCalls = calls;
				if (!actionableCalls.length) {
					const content: string =
						typeof completion.content === 'string'
							? completion.content.trim()
							: JSON.stringify(completion.content);
					if (pendingProposalWaveSize > 0) {
						log.warn('Assistant finished with an unresolved proposal wave', {
							pendingProposalWaveSize,
							stagedProposalCount: stagedProposals.length
						});
						return {
							answer: 'I could not safely prepare the complete proposal set. Nothing was changed.',
							citations: [],
							links: [],
							followUpSuggestions: ['Provide the missing or corrected record details'],
							toolCalls: toolLog
						};
					}
					if (
						content &&
						latestCalculatorResult &&
						!answerContainsCalculatorValue(content, latestCalculatorResult)
					) {
						if (calculatorAnswerCorrectionSent) {
							log.warn('Assistant final answer still omitted calculator result after correction', {
								expression: latestCalculatorResult.expression,
								value: latestCalculatorResult.value
							});
							return {
								answer: `I could not safely use the model's final wording because it changed the calculator result. The verified calculator result for ${latestCalculatorResult.expression} is ${latestCalculatorResult.value}.`,
								citations: [],
								links: [],
								followUpSuggestions: [],
								toolCalls: toolLog
							};
						}
						calculatorAnswerCorrectionSent = true;
						log.warn('Assistant final answer omitted calculator result; requesting correction', {
							expression: latestCalculatorResult.expression,
							value: latestCalculatorResult.value
						});
						const correctionMessage = {
							role: 'user',
							content:
								`Answer validation failed: the final answer changed or omitted the exact calculator result. ` +
								`The calculator evaluated "${latestCalculatorResult.expression}" and returned "${latestCalculatorResult.value}". ` +
								'Return the final answer using that exact value. Do not call any tool unless you identify a different expression is required.'
						};
						if (usePersistentConversation) {
							nextMessage = correctionMessage;
						} else {
							replayMessages.push(correctionMessage);
						}
						continue;
					}
					if (content && stagedProposals.length === 0 && recordDetailRequiredBeforeCalculation) {
						log.warn(
							'Assistant answered from record search candidates without record detail; requesting records_get'
						);
						const correctionMessage: Record<string, unknown> = {
							role: 'user',
							content:
								'Answer validation failed: records_search returns candidates only. ' +
								'Call records_get for the selected record before using exact record fields in the final answer.'
						};
						if (usePersistentConversation) nextMessage = correctionMessage;
						else replayMessages.push(correctionMessage);
						continue;
					}
					const answer = content || "Kwantflow AI didn't return a final answer. Please try again.";
					const safeAnswer =
						viewportInspectionUsed && !hasOnlyViewportNumericFacts(answer, request.viewportContext)
							? deterministicViewportEvidenceSummary(request.viewportContext)
							: answer;
					const proposalAnswer = stagedProposals.length
						? `I drafted ${stagedProposals.length} proposed change${stagedProposals.length === 1 ? '' : 's'} for approval.`
						: safeAnswer;
					const proposalSet: LocalAssistantProposalSet | undefined = stagedProposals.length
						? {
								id: `source-record-proposal-set-${crypto.randomUUID()}`,
								turnId: proposalTurnId,
								summary: proposalAnswer,
								items: stagedProposals,
								status: 'pending'
							}
						: undefined;
					return {
						answer: proposalAnswer,
						citations: [],
						links: [],
						followUpSuggestions: [],
						toolCalls: toolLog,
						proposalSet
					};
				}

				const results: Array<{ name: string; response: unknown; toolCallId?: string }> = [];
				const proposalCallCount = actionableCalls.filter((call) =>
					isProposalTool(call.function?.name ?? '')
				).length;
				const proposalWave: SourceRecordProposal[] = [];
				const proposalWaveSourceItems = new Set<number>();
				let proposalWaveFailed = false;
				for (const call of actionableCalls) {
					const name = call.function?.name ?? 'unknown';
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>;
						toolLog.push({ name, arguments: args });
						const readCallSignature =
							name === 'records_get' || name === 'records_search'
								? `${name}:${JSON.stringify(args)}`
								: null;
						if (readCallSignature && successfulReadCallSignatures.has(readCallSignature)) {
							const priorResponse = successfulReadResponses.get(readCallSignature);
							const fallbackAnswer = answerFromValidatedReadToolResult(name, priorResponse);
							if (fallbackAnswer) {
								log.warn(
									'Assistant repeated a completed read tool call; returning validated result',
									{
										step,
										name
									}
								);
								return {
									answer: fallbackAnswer,
									citations: [],
									links: [],
									followUpSuggestions: [],
									toolCalls: toolLog
								};
							}
							const response = {
								status: 'error' as const,
								code: 'record_already_retrieved',
								recoverable: true,
								message:
									'This exact record lookup was already returned in this turn. Use the previous tool result to answer instead of calling the same lookup again.',
								retryHint:
									'Answer from the prior records_search or records_get result, or call a different lookup if different evidence is needed.'
							};
							results.push({ name, toolCallId: call.id, response });
							log.warn('Assistant repeated the same read tool call in one turn', {
								step,
								name
							});
							continue;
						}
						if (name === 'calculator_evaluate_decimal' && recordDetailRequiredBeforeCalculation) {
							const response = {
								status: 'error' as const,
								code: 'record_detail_required',
								recoverable: true,
								message:
									'Use records_get for the chosen search result before calculating with record rates, units, currencies, or rate basis.',
								retryHint:
									'Call records_get with the selected result scope and ID, then retry the calculator using the exact detail fields.'
							};
							results.push({ name, toolCallId: call.id, response });
							log.warn('Assistant calculator call blocked until record detail is fetched', {
								step,
								name
							});
							continue;
						}
						const claimedSourceItems = new Set([...stagedSourceItems, ...proposalWaveSourceItems]);
						const nextProposalSourceItem = isProposalTool(name)
							? mutationSourceItems.findIndex((_, index) => !claimedSourceItems.has(index + 1)) +
									1 || null
							: null;
						callbacks?.onToolCall?.({
							id: call.id,
							name,
							status: 'executing',
							arguments: args
						});
						const result = await executeTool(call, request, recordRefs, nextProposalSourceItem);
						if (name === 'inspect_current_screen') viewportInspectionUsed = true;
						callbacks?.onToolCall?.({
							id: call.id,
							name,
							status: 'success',
							arguments: args
						});
						if (result.artifact) turnArtifacts.push(result.artifact);
						if (result.proposal) proposalWave.push(result.proposal);
						if (name === 'records_search' && args.browse === true) {
							const browseAnswer = answerFromValidatedReadToolResult(name, result.content);
							if (browseAnswer) {
								log.info('Returned validated catalogue browse result without another model turn', {
									step
								});
								return {
									answer: browseAnswer,
									citations: [],
									links: [],
									followUpSuggestions: [],
									toolCalls: toolLog
								};
							}
						}
						const proposalSourceItem = sourceItemIndex(args.sourceItem) ?? nextProposalSourceItem;
						if (result.proposal && proposalSourceItem !== null) {
							proposalWaveSourceItems.add(proposalSourceItem);
						}
						if (isProposalTool(name) && !result.proposal) proposalWaveFailed = true;
						const response = responseWithAnswerFacts(name, result.content);
						results.push({ name, toolCallId: call.id, response });
						if (isProposalTool(name) && result.proposal) {
							log.info('Created assistant proposal for approval', {
								step,
								scope: result.proposal.scope,
								action: result.proposal.action
							});
						}
						if (
							readCallSignature &&
							result.content &&
							typeof result.content === 'object' &&
							'status' in result.content &&
							String(result.content.status) === 'ok'
						) {
							successfulReadCallSignatures.add(readCallSignature);
							successfulReadResponses.set(readCallSignature, result.content);
						}
						if (
							name === 'records_search' &&
							args.browse !== true &&
							searchResultRequiresRecordDetail(result.content)
						) {
							recordDetailRequiredBeforeCalculation = true;
						}
						if (name === 'records_get') {
							recordDetailRequiredBeforeCalculation = false;
							const evidence = recordDetailEvidence(result.content);
							if (evidence) {
								log.info('Received record detail evidence', {
									scope: evidence.scope,
									label: evidence.label,
									fieldKeys: Object.keys(evidence.fields),
									roleTitle: evidence.fields.role_title ?? null,
									linkedPeopleCount: Array.isArray(evidence.fields.linked_people)
										? evidence.fields.linked_people.length
										: 0
								});
							} else if (result.content && typeof result.content === 'object') {
								log.warn('records_get returned no answer-validation evidence', {
									status: 'status' in result.content ? result.content.status : null,
									keys: Object.keys(result.content)
								});
							}
						}
						if (
							name === 'calculator_evaluate_decimal' &&
							result.content &&
							typeof result.content === 'object' &&
							'expression' in result.content &&
							'value' in result.content
						) {
							latestCalculatorResult = {
								expression: String(result.content.expression),
								value: String(result.content.value)
							};
						}
						log.info('Executed assistant tool', {
							step,
							name,
							responseKind: Array.isArray(result.content) ? 'array' : typeof result.content,
							hasArtifact: Boolean(result.artifact)
						});
						const signature = failedCallSignature(name, call, result.content);
						if (signature) {
							const count = (failedCallCounts.get(signature) ?? 0) + 1;
							failedCallCounts.set(signature, count);
							if (count >= 2) {
								return {
									answer:
										'I could not complete that request because the same tool call repeatedly failed. Nothing was changed.',
									citations: [],
									links: [],
									followUpSuggestions: ['Try a narrower request or provide the missing detail'],
									toolCalls: toolLog
								};
							}
						}
					} catch (error) {
						if (isProposalTool(name)) proposalWaveFailed = true;
						const response = toolFailureResponse(error);
						results.push({
							name,
							toolCallId: call.id,
							response
						});
						const signature = failedCallSignature(name, call, response);
						if (signature) {
							const count = (failedCallCounts.get(signature) ?? 0) + 1;
							failedCallCounts.set(signature, count);
							if (count >= 2) {
								return {
									answer:
										'I could not complete that request because the same tool call repeatedly failed. Nothing was changed.',
									citations: [],
									links: [],
									followUpSuggestions: ['Try a narrower request or provide the missing detail'],
									toolCalls: toolLog
								};
							}
						}
						callbacks?.onToolCall?.({
							id: call.id,
							name,
							status: 'failed',
							arguments: args
						});
						log.warn('Assistant tool execution failed', {
							step,
							name,
							error: error instanceof Error ? error.message : String(error)
						});
					}
				}

				if (proposalCallCount > 0) {
					if (pendingProposalWaveSize > 0 && proposalCallCount < pendingProposalWaveSize) {
						proposalWaveFailed = true;
						for (const result of results) {
							if (!isProposalTool(result.name)) continue;
							result.response = {
								status: 'error',
								code: 'proposal_set_incomplete',
								recoverable: true,
								message: `The corrected proposal wave contains ${proposalCallCount} of ${pendingProposalWaveSize} required records.`,
								retryHint:
									'Retry the complete corrected proposal wave, including every requested record.'
							};
						}
					}

					if (proposalWaveFailed || proposalWave.length !== proposalCallCount) {
						pendingProposalWaveSize = Math.max(pendingProposalWaveSize, proposalCallCount);
						log.warn('Assistant proposal wave was not staged because it was incomplete', {
							step,
							proposalCallCount,
							validProposalCount: proposalWave.length,
							pendingProposalWaveSize
						});
					} else {
						pendingProposalWaveSize = 0;
						for (const proposal of proposalWave) {
							const identity = proposalIdentity(proposal);
							const existingIndex = stagedProposals.findIndex(
								(existing) => proposalIdentity(existing) === identity
							);
							if (existingIndex === -1) stagedProposals.push(proposal);
							else stagedProposals[existingIndex] = proposal;
						}
						for (const sourceItem of proposalWaveSourceItems) stagedSourceItems.add(sourceItem);
						log.info('Staged complete assistant proposal wave', {
							step,
							proposalCount: proposalWave.length,
							stagedProposalCount: stagedProposals.length,
							scopes: proposalWave.map((proposal) => proposal.scope)
						});
						if (stagedSourceItems.size === mutationSourceItems.length) {
							return await finishProposalSet();
						}
					}

					for (const result of results) {
						if (!isProposalTool(result.name)) continue;
						const response =
							result.response &&
							typeof result.response === 'object' &&
							!Array.isArray(result.response)
								? (result.response as Record<string, unknown>)
								: { value: result.response };
						result.response = {
							...response,
							proposal_set: {
								staged_count: stagedProposals.length,
								items: stagedProposals.map((proposal) => ({
									id: proposal.id,
									scope: proposal.scope,
									action: proposal.action,
									label: proposalLabel(proposal),
									summary: proposal.summary
								})),
								complete: pendingProposalWaveSize === 0
							}
						};
					}
				}

				const gemmaToolMessage = gemmaToolResponseMessage(results);
				if (usePersistentConversation) {
					nextMessage = gemmaToolMessage;
				} else {
					replayMessages.push(gemmaAssistantToolCallMessage(actionableCalls), gemmaToolMessage);
				}
			} finally {
				this.activeStreamAbort = null;
				controller.dispose();
			}
		}

		return {
			answer:
				'I could not complete that request within the safe agent step limit. Nothing was changed.',
			citations: [],
			links: [],
			followUpSuggestions: ['Try a narrower request'],
			toolCalls: toolLog
		};
	}
}

export const localAssistantService = new LocalAssistantService();
