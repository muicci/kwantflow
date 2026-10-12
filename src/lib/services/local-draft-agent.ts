import { getAssistantToolDeclarations } from '$lib/services/assistant-actions/registry.js';
import { getRecord, searchRecords } from '$lib/services/assistant-tools/records.js';
import { normaliseJsonLikeContent, normaliseToolCallArguments } from '$lib/utils/json-like.js';

const DRAFT_TOOL_NAMES = new Set(['records_search', 'records_get', 'draft_evidence_get']);

export const LOCAL_DRAFT_AGENT_MAX_TURNS = 4;

type DraftToolCall = {
	id: string;
	function: { name: string; arguments: string };
};

type DraftCompletion = {
	content: unknown;
	toolCalls?: DraftToolCall[];
};

export type LocalDraftAgentStep = {
	turn: number;
	toolCallCount: number;
};

export type LocalDraftAgentToolCall = {
	turn: number;
	name: string;
	arguments: Record<string, unknown>;
	status: string | null;
};

export function getLocalDraftAgentToolDeclarations() {
	return [
		...getAssistantToolDeclarations().filter((tool) => DRAFT_TOOL_NAMES.has(tool.function.name)),
		{
			type: 'function' as const,
			function: {
				name: 'draft_evidence_get',
				description:
					'Read one bounded slice of already-prepared local evidence by file ID. Use when the extraction summary is insufficient. Read-only.',
				parameters: {
					type: 'object',
					properties: {
						file_id: { type: 'string' },
						evidence_identifier: { type: 'string' }
					},
					required: ['file_id']
				}
			}
		}
	];
}

export async function executeLocalDraftTool(
	name: string,
	args: Record<string, unknown>,
	workspaceId?: string
): Promise<unknown> {
	switch (name) {
		case 'records_search':
			return searchRecords(args, undefined, workspaceId);
		case 'records_get':
			return getRecord(args, undefined, workspaceId);
		default:
			throw new Error(`Draft agent cannot execute undeclared tool: ${name}`);
	}
}

function parseContent(content: unknown): unknown {
	if (typeof content !== 'string') return content;
	const trimmed = content.trim();
	if (!trimmed) throw new Error('Draft agent returned an empty final response');
	return normaliseJsonLikeContent(trimmed);
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
	return normaliseToolCallArguments(raw);
}

function assistantToolCallMessage(calls: DraftToolCall[]): Record<string, unknown> {
	return {
		role: 'assistant',
		content: '',
		tool_calls: calls.map((call) => ({
			...call,
			function: {
				...call.function,
				arguments: parseToolArguments(call.function.arguments || '{}')
			}
		}))
	};
}

function toolResponseMessage(
	responses: Array<{ name: string; response: unknown }>
): Record<string, unknown> {
	return {
		role: 'tool',
		content: responses.map((result) => ({
			type: 'tool_response',
			tool_response: {
				name: result.name,
				value: result.response
			}
		}))
	};
}

function responseStatus(response: unknown): string | null {
	if (!response || typeof response !== 'object' || !('status' in response)) return null;
	return String(response.status);
}

function isFailedResponse(response: unknown): boolean {
	const status = responseStatus(response);
	return status === 'error' || status === 'unavailable' || status === 'not_found';
}

export async function runLocalDraftAgent<T>(params: {
	initialMessage: string;
	complete: (messages: Array<Record<string, unknown>>) => Promise<DraftCompletion>;
	executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
	readEvidence?: (args: { file_id: string; evidence_identifier?: string }) => Promise<unknown>;
	parseFinal: (value: unknown) => T;
	finalToolName?: string;
	maxTurns?: number;
	requireToolUseBeforeFinal?: boolean;
	onStep?: (step: LocalDraftAgentStep) => void;
	onToolCall?: (toolCall: LocalDraftAgentToolCall) => void;
}): Promise<{
	final: T;
	steps: LocalDraftAgentStep[];
	toolCalls: LocalDraftAgentToolCall[];
}> {
	const maxTurns = params.maxTurns ?? LOCAL_DRAFT_AGENT_MAX_TURNS;
	const messages: Array<Record<string, unknown>> = [
		{ role: 'user', content: params.initialMessage }
	];
	const steps: LocalDraftAgentStep[] = [];
	const toolCalls: LocalDraftAgentToolCall[] = [];
	const failedCalls = new Map<string, number>();
	const successfulLookups = new Set<string>();
	let finalCorrectionSent = false;
	let toolUseCorrectionSent = false;

	for (let turn = 1; turn <= maxTurns; turn += 1) {
		const completion = await params.complete(messages);
		const calls = completion.toolCalls ?? [];
		const step = { turn, toolCallCount: calls.length };
		steps.push(step);
		params.onStep?.(step);
		const finalCalls = params.finalToolName
			? calls.filter((call) => call.function.name === params.finalToolName)
			: [];
		if (finalCalls.length > 0) {
			if (finalCalls.length !== 1 || calls.length !== 1) {
				throw new Error('Draft agent must submit the final proposal in one dedicated tool call.');
			}
			try {
				return {
					final: params.parseFinal(parseToolArguments(finalCalls[0]!.function.arguments || '{}')),
					steps,
					toolCalls
				};
			} catch (error) {
				if (finalCorrectionSent) throw error;
				finalCorrectionSent = true;
				messages.push(
					{ role: 'assistant', content: 'The submitted estimator proposal did not validate.' },
					{
						role: 'user',
						content:
							'Resubmit the final estimator proposal using the exact declared return-tool schema. Keep the seeded takeoff item count and order. Do not call read-only tools again.'
					}
				);
				continue;
			}
		}

		if (calls.length === 0) {
			if (params.requireToolUseBeforeFinal && toolCalls.length === 0) {
				if (toolUseCorrectionSent) {
					throw new Error('Draft agent returned a final answer without using required tools');
				}
				toolUseCorrectionSent = true;
				messages.push(
					{
						role: 'assistant',
						content:
							typeof completion.content === 'string'
								? completion.content
								: JSON.stringify(completion.content)
					},
					{
						role: 'user',
						content:
							'Before returning the final draft, use the read-only tools to inspect prepared evidence and workspace records. At minimum call draft_evidence_get plus records_search when records are available.'
					}
				);
				continue;
			}
			try {
				return { final: params.parseFinal(parseContent(completion.content)), steps, toolCalls };
			} catch (error) {
				if (finalCorrectionSent) throw error;
				finalCorrectionSent = true;
				messages.push(
					{
						role: 'assistant',
						content: 'The previous estimator response was not accepted.'
					},
					{
						role: 'user',
						content:
							'Final response validation failed. Return the complete draft using the exact required JSON schema. Do not omit required fields and do not call tools unless essential evidence is still missing.'
					}
				);
				continue;
			}
		}

		const responses: Array<{ name: string; response: unknown }> = [];
		for (const call of calls) {
			const name = call.function.name;
			if (!DRAFT_TOOL_NAMES.has(name)) {
				if (/_change$/.test(name)) {
					throw new Error(`Draft agent cannot execute undeclared tool: ${name}`);
				}
				const args = parseToolArguments(call.function.arguments || '{}');
				const signature = `${name}:${JSON.stringify(args)}`;
				const count = (failedCalls.get(signature) ?? 0) + 1;
				failedCalls.set(signature, count);
				if (count >= 2) throw new Error(`Draft agent repeated undeclared tool: ${name}`);
				const toolCall = { turn, name, arguments: args, status: 'error' };
				toolCalls.push(toolCall);
				params.onToolCall?.(toolCall);
				responses.push({
					name,
					response: {
						status: 'error',
						code: 'unknown_tool',
						recoverable: true,
						message: `Tool ${name} is not available in Draft with AI.`,
						availableTools: Array.from(DRAFT_TOOL_NAMES)
					}
				});
				continue;
			}
			const args = parseToolArguments(call.function.arguments || '{}');
			const signature = `${name}:${JSON.stringify(args)}`;
			const repeatedLookup =
				(name === 'records_search' || name === 'records_get' || name === 'draft_evidence_get') &&
				successfulLookups.has(signature);
			const response = repeatedLookup
				? {
						status: 'error',
						code: 'record_already_retrieved',
						recoverable: true,
						message: 'This exact lookup was already returned. Use the previous result.'
					}
				: name === 'draft_evidence_get'
					? await params.readEvidence?.({
							file_id: String(args.file_id ?? ''),
							...(typeof args.evidence_identifier === 'string'
								? { evidence_identifier: args.evidence_identifier }
								: {})
						})
					: await params.executeTool(name, args);
			if (name === 'draft_evidence_get' && !params.readEvidence) {
				throw new Error('Draft evidence reader is unavailable');
			}
			const status = responseStatus(response);
			const toolCall = { turn, name, arguments: args, status };
			toolCalls.push(toolCall);
			params.onToolCall?.(toolCall);
			if (isFailedResponse(response)) {
				const count = (failedCalls.get(signature) ?? 0) + 1;
				failedCalls.set(signature, count);
				if (count >= 2) throw new Error('Draft agent repeated a failing tool call');
			} else if (
				name === 'records_search' ||
				name === 'records_get' ||
				name === 'draft_evidence_get'
			) {
				successfulLookups.add(signature);
			}
			responses.push({ name, response });
		}

		messages.push(assistantToolCallMessage(calls), toolResponseMessage(responses));
	}

	throw new Error(`Draft agent exceeded ${maxTurns} model turns`);
}
