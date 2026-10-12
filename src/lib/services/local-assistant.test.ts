import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	ensureConversationMock,
	sendMessageStreamMock,
	endConversationMock,
	completionQueue,
	searchAssistantRecordsMock,
	describeWorkspaceRecordsMock,
	getWorkspaceRecordMock,
	buildLocalAssistantContextMock,
	selectLocalAssistantContextSectionsMock
} = vi.hoisted(() => ({
	ensureConversationMock: vi.fn(),
	sendMessageStreamMock: vi.fn(),
	endConversationMock: vi.fn(),
	searchAssistantRecordsMock: vi.fn(),
	describeWorkspaceRecordsMock: vi.fn(),
	getWorkspaceRecordMock: vi.fn(),
	buildLocalAssistantContextMock: vi.fn().mockResolvedValue([]),
	selectLocalAssistantContextSectionsMock: vi.fn(({ sections }) => sections),
	completionQueue: [] as Array<{
		content: string;
		thinking?: string;
		toolCalls: Array<{
			id: string;
			function: { name: string; arguments: string };
		}>;
		error?: Error;
	}>
}));

vi.mock('$lib/services/local-ai.js', () => ({
	localAiService: {
		ensureConversation: ensureConversationMock,
		sendMessageStream: sendMessageStreamMock,
		runGroundedCompletionStream: vi.fn(),
		endConversation: endConversationMock
	}
}));

vi.mock('$lib/services/local-assistant-context.js', () => ({
	buildLocalAssistantContext: buildLocalAssistantContextMock,
	selectLocalAssistantContextSections: selectLocalAssistantContextSectionsMock
}));

vi.mock('$lib/services/db.js', () => ({
	dbService: {
		describeWorkspaceRecords: describeWorkspaceRecordsMock,
		searchAssistantRecords: searchAssistantRecordsMock,
		getWorkspaceRecord: getWorkspaceRecordMock,
		getWorkspaceStats: vi.fn().mockResolvedValue({
			projectsCount: 10,
			contactsCount: 5,
			materialsCount: 20,
			ratesCount: 15
		})
	}
}));

import { localAssistantService } from './local-assistant.js';

const toolResponseMessage = (name: string, value: unknown) =>
	expect.objectContaining({
		role: 'tool',
		content: expect.arrayContaining([
			expect.objectContaining({
				type: 'tool_response',
				tool_response: expect.objectContaining({ name, value })
			})
		])
	});

describe('native Gemma agent loop', () => {
	it('uses native sampling defaults and does not truncate returned tool calls', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/services/local-assistant.ts'), 'utf8');
		expect(source).not.toContain('temperature: 0');
		expect(source).not.toContain('MAX_TOOL_CALLS_PER_TURN');
		expect(source).not.toContain('recordLookupCount');
	});

	beforeEach(() => {
		vi.clearAllMocks();
		completionQueue.length = 0;
		describeWorkspaceRecordsMock.mockResolvedValue([]);
		searchAssistantRecordsMock.mockResolvedValue([]);
		getWorkspaceRecordMock.mockResolvedValue(null);
		buildLocalAssistantContextMock.mockResolvedValue([]);
		selectLocalAssistantContextSectionsMock.mockImplementation(({ sections }) => sections);
		endConversationMock.mockResolvedValue(undefined);
		sendMessageStreamMock.mockImplementation(() => ({
			start: vi.fn(async () => {
				const next = completionQueue.shift();
				if (next?.error) throw next.error;
				return next;
			}),
			dispose: vi.fn()
		}));
	});

	it('starts one persistent conversation and returns a direct Gemma answer', async () => {
		completionQueue.push({ content: 'Hello from Gemma.', toolCalls: [] });
		const onThinking = vi.fn();

		const result = await localAssistantService.answerTurn(
			{
				prompt: 'Hello',
				pathname: '/',
				projectId: null,
				assetId: null,
				workspaceId: 'workspace-1',
				workspaceProfile: null,
				knowledgeContext: null,
				currentEstimateContext: null,
				viewportContext: null,
				conversation: [],
				attachments: []
			},
			{ onThinking }
		);

		expect(ensureConversationMock).toHaveBeenCalledTimes(1);
		const tools = ensureConversationMock.mock.calls[0]?.[0].tools ?? [];
		const toolNames = tools.map((tool: { function: { name: string } }) => tool.function.name);
		expect(toolNames).toEqual(
			expect.arrayContaining([
				'calculator_evaluate_decimal',
				'formula_validate_quantity',
				'units_convert',
				'records_describe',
				'records_search',
				'records_get',
				'material_change'
			])
		);
		expect(toolNames.some((name: string) => name.endsWith('_propose_upsert'))).toBe(false);
		expect(ensureConversationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				enableThinking: true,
				temperature: 1,
				topK: 64,
				topP: 0.95,
				tools: expect.arrayContaining([
					expect.objectContaining({
						type: 'function',
						function: expect.objectContaining({
							name: 'calculator_evaluate_decimal',
							description: expect.any(String),
							parameters: expect.objectContaining({ type: 'object' })
						})
					})
				])
			})
		);
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
		expect(sendMessageStreamMock).toHaveBeenCalledWith(
			expect.objectContaining({
				maxOutputTokens: 1024,
				timeoutMs: 120_000,
				workloadClass: 'interactive'
			})
		);
		expect(onThinking).not.toHaveBeenCalled();
		const streamedThinking = sendMessageStreamMock.mock.calls[0]?.[0].onThinking;
		expect(streamedThinking).toEqual(expect.any(Function));
		streamedThinking('Native thought');
		expect(onThinking).toHaveBeenCalledWith('Native thought');
		expect(sendMessageStreamMock.mock.calls[0]?.[0].message).toEqual(
			expect.objectContaining({
				role: 'user',
				content: [expect.objectContaining({ type: 'text', text: expect.stringContaining('Hello') })]
			})
		);
		expect(result.answer).toBe('Hello from Gemma.');
	});

	it('selects and bounds application context before sending an Ask turn', async () => {
		const longText = 'x'.repeat(700);
		buildLocalAssistantContextMock.mockResolvedValue([
			{ id: 'one', title: 'One', kind: 'current', summary: 'one', text: longText },
			{ id: 'two', title: 'Two', kind: 'current', summary: 'two', text: 'two' },
			{ id: 'three', title: 'Three', kind: 'current', summary: 'three', text: 'three' },
			{ id: 'four', title: 'Four', kind: 'current', summary: 'four', text: 'four' },
			{ id: 'five', title: 'Five', kind: 'current', summary: 'five', text: 'five' }
		]);
		selectLocalAssistantContextSectionsMock.mockImplementation(({ sections }) =>
			sections.slice(0, 4)
		);
		completionQueue.push({ content: 'Bounded answer.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'What is on this asset?',
			pathname: '/project/project-1/asset/asset-1',
			projectId: 'project-1',
			assetId: 'asset-1',
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(selectLocalAssistantContextSectionsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				query: 'What is on this asset?',
				pathname: '/project/project-1/asset/asset-1',
				projectId: 'project-1',
				assetId: 'asset-1',
				maxSections: 4
			})
		);
		const message = sendMessageStreamMock.mock.calls[0]?.[0].message;
		const text = message.content[0].text as string;
		expect(text).toContain('[Four]');
		expect(text).not.toContain('[Five]');
		expect(text).not.toContain('x'.repeat(601));
	});

	it('answers an explicit viewport evidence summary without starting local inference', async () => {
		const result = await localAssistantService.answerTurn({
			prompt: 'Summarise only the evidence visible on the current screen.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: {
				id: 'viewport-home',
				pathname: '/',
				routeId: null,
				pageTitle: 'Home',
				reference: { title: 'Home', label: 'Home', pathname: '/', routeId: null },
				metadata: {},
				text: 'Current page: Home'
			},
			conversation: [],
			attachments: []
		});

		expect(ensureConversationMock).not.toHaveBeenCalled();
		expect(sendMessageStreamMock).not.toHaveBeenCalled();
		expect(result.answer).toBe(
			'I inspected Home. The screen did not expose more structured evidence for a safe summary.'
		);
	});

	it('drafts an explicit typed create proposal without starting local inference', async () => {
		const result = await localAssistantService.answerTurn({
			prompt:
				'Propose a material record named QA Test Material with code QA-TEST-001, unit EA, and default rate 1 AUD.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(ensureConversationMock).not.toHaveBeenCalled();
		expect(sendMessageStreamMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			answer: 'I drafted 1 proposed change for approval.',
			proposalSet: {
				status: 'pending',
				items: [
					expect.objectContaining({
						scope: 'materials',
						action: 'create',
						fields: {
							name: 'QA Test Material',
							code: 'QA-TEST-001',
							unit: 'ea',
							default_rate: 1,
							currency_code: 'AUD'
						}
					})
				]
			}
		});
	});

	it('adds compact registry-derived tool guidance to the conversation system instruction', async () => {
		completionQueue.push({ content: 'Ready.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'What can you do?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		const systemInstruction = ensureConversationMock.mock.calls[0]?.[0].systemInstruction;
		expect(systemInstruction).toContain('Available tools');
		expect(systemInstruction).toContain('calculator_evaluate_decimal');
		expect(systemInstruction).toContain('records_describe');
		expect(systemInstruction).toContain('material_change');
		expect(systemInstruction).toContain('sourceItem');
		expect(systemInstruction).toContain('Current local environment:');
		expect(systemInstruction).toContain('Date & Time:');
		expect(systemInstruction).toContain('Timezone Offset:');
		expect(systemInstruction).toContain('Client Version:');
		expect(systemInstruction).toContain('Client Platform:');
		expect(systemInstruction).toContain(
			'For a request about the current asset, its files, CAD, drawings, or evidence, call inspect_current_screen before answering.'
		);
		expect(systemInstruction).toContain(
			'Database Scale: 10 projects/RFQs, 5 contacts/vendors, 20 material catalog items, 15 service rate cards'
		);
		expect(systemInstruction).not.toContain('propose_upsert');
		expect(systemInstruction).not.toContain('Agent Skills runtime');
	});

	it('returns tool results to Gemma and lets Gemma take the next step', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'calc-1',
						function: {
							name: 'calculator_evaluate_decimal',
							arguments: '{"expression":"125 * 48.25"}'
						}
					}
				]
			},
			{ content: 'The exact result is 6031.25.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Calculate 125 * 48.25',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
		expect(sendMessageStreamMock.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ maxOutputTokens: 1024 })
		);
		expect(sendMessageStreamMock.mock.calls[1]?.[0]).toEqual(
			expect.objectContaining({ maxOutputTokens: 1024 })
		);
		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage('calculator_evaluate_decimal', {
				expression: '125 * 48.25',
				value: '6031.25'
			})
		);
		expect(result.answer).toBe('The exact result is 6031.25.');
	});

	it('replaces corrupted numeric claims after screen inspection with exact viewport facts', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'screen-1',
						function: {
							name: 'inspect_current_screen',
							arguments: '{"includeScreenshot":false}'
						}
					}
				]
			},
			{ content: 'The CAD is 4.6.4 mm with 0.0.0.0 total cost.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Summarise this screen.',
			pathname: '/project/project-1/asset/asset-1',
			projectId: 'project-1',
			assetId: 'asset-1',
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: {
				id: 'viewport-asset',
				pathname: '/project/project-1/asset/asset-1',
				routeId: null,
				pageTitle: 'Part 1',
				reference: {
					title: 'Part 1',
					label: 'Sharing “Part 1”',
					pathname: '/project/project-1/asset/asset-1',
					routeId: null
				},
				metadata: {},
				text: 'Current asset evidence.',
				cadMetadata: {
					format: 'step',
					vertexCount: 2124,
					faceCount: 1062,
					edgeCount: 0,
					dimensions: { x: 1465, y: 50.43, z: 50.8 },
					previewMode: 'mesh',
					rootCount: 1,
					transferCount: 1,
					entityCount: 23,
					sourceSummary: null
				}
			},
			conversation: [],
			attachments: []
		});

		expect(result.answer).toBe(
			'I inspected Part 1. Visible CAD evidence: STEP model with 1,062 faces. Dimensions: 1465 × 50.43 × 50.8 mm.'
		);
	});

	it('does not execute partially recovered proposal arguments after a native parse failure', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [],
				error: new Error(
					'INVALID_ARGUMENT: Failed to parse tool calls from code block: call:material_change{action:<|"|>create<|"|>,name:<|"|>KF Parser Plate<|"|>,unit:<|"|>kg<|"|>,default_rate:4.85}'
				)
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-corrected',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: 'KF Parser Plate',
								unit: 'kg',
								default_rate: 4.85
							})
						}
					}
				]
			},
			{ content: 'I drafted KF Parser Plate for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Parser Plate at 4.85 per kg.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet?.items).toHaveLength(1);
		expect(result.proposalSet?.items[0].fields).toMatchObject({
			name: 'KF Parser Plate',
			default_rate: 4.85,
			unit: 'kg'
		});
		expect(result.toolCalls?.filter((call) => call.name === 'material_change')).toHaveLength(1);
	});

	it('stops safely after the single native tool correction also fails', async () => {
		const malformed = () => ({
			content: '',
			toolCalls: [],
			error: new Error(
				'INVALID_ARGUMENT: Failed to parse tool calls from code block: call:material_change{action:<|"|>create<|"|>,name:<|"|>KF Broken Parser Plate<|"|>}'
			)
		});
		completionQueue.push(malformed(), malformed());

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Broken Parser Plate.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
		expect(result.proposalSet).toBeUndefined();
		expect(result.answer).toContain('native runtime could not parse the call');
	});

	it('requests a proposal retry when malformed native output contains no recoverable string fields', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [],
				error: new Error(
					'INVALID_ARGUMENT: Failed to parse tool calls from code block: call:material_change{default_rate:4.85}'
				)
			},
			{ content: 'I could not prepare the proposal.', toolCalls: [] }
		);

		await localAssistantService.answerTurn({
			prompt: 'Create a material.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			expect.objectContaining({
				content: expect.stringContaining('declared tool and its exact schema')
			})
		);
		expect(String(sendMessageStreamMock.mock.calls[1]?.[0].message.content)).toContain(
			'previous tool call was malformed and was not executed'
		);
	});

	it('never manufactures proposals from the user prompt after a native parser failure', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [],
				error: new Error(
					'INVALID_ARGUMENT: Failed to parse tool calls from code block: call:material_change{action:<|"|>create<|"|>,name:<|"|>KF Bad Parser<|"|>,unit:sheet}'
				)
			},
			{ content: 'I could not safely prepare those proposals.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create these materials for approval: KF Parser Material A at 1.10 AUD per kg cost; KF Parser Material B at 3.30 AUD per metre sell.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
	});

	it('returns an unknown duplicated tool name to Gemma for an exact-name retry', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-duplicated-tool-name',
						function: {
							name: 'material_material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: 'KF Canonical Tool Plate',
								unit: 'kg',
								default_rate: 1.1,
								currency_code: 'AUD',
								rate_basis: 'cost'
							})
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-corrected-tool-name',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: 'KF Canonical Tool Plate',
								unit: 'kg',
								default_rate: 1.1,
								currency_code: 'AUD',
								rate_basis: 'cost'
							})
						}
					}
				]
			},
			{ content: 'I drafted KF Canonical Tool Plate for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Canonical Tool Plate at 1.10 AUD per kg cost for approval.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet?.items).toHaveLength(1);
		expect(result.proposalSet?.items[0].fields).toMatchObject({
			name: 'KF Canonical Tool Plate',
			unit: 'kg',
			default_rate: 1.1,
			currency_code: 'AUD',
			rate_basis: 'cost'
		});
		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage(
				'material_material_change',
				expect.objectContaining({
					status: 'error',
					code: 'unknown_tool',
					recoverable: true
				})
			)
		);
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
	});

	it('asks Gemma for one correction when the native tool parser rejects a continuation', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'calc-1',
						function: {
							name: 'calculator_evaluate_decimal',
							arguments: '{"expression":"19 * 23"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [],
				error: new Error('Failed to parse FC tool calls')
			},
			{ content: '19 * 23 is 437.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'What is 19 * 23?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(3);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			expect.objectContaining({
				role: 'user',
				content: expect.stringContaining('previous tool call was malformed')
			})
		);
		expect(result.answer).toBe('19 * 23 is 437.');
	});

	it('requires Gemma to resend a malformed records_get call through native decoding', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-1',
				label: 'KFVAL Galvanised Steel Plate 10mm',
				subtitle: null,
				relevance: 1,
				fields: {
					default_rate: 4.85,
					unit: 'kg',
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KFVAL Galvanised Steel Plate 10mm',
			subtitle: null,
			fields: {
				default_rate: 4.85,
				unit: 'kg',
				currency_code: 'AUD',
				rate_basis: 'cost'
			}
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-1',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials","query":"steel plate"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [],
				error: new Error(
					'INVALID_ARGUMENT: Failed to parse tool calls from code block: call:records_get{recordId:<|"|>material-1<|"|>scope:<|"|>materials<|"|>}'
				)
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'get-1',
						function: {
							name: 'records_get',
							arguments: '{"recordId":"material-1","scope":"materials"}'
						}
					}
				]
			},
			{ content: 'KFVAL Galvanised Steel Plate 10mm is 4.85 AUD per kg.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Find steel plate in my records and give me its rate, unit, and currency.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(getWorkspaceRecordMock).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'materials',
				recordId: 'material-1',
				workspaceId: 'workspace-1'
			})
		);
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(4);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			expect.objectContaining({
				content: expect.stringContaining('Do not reconstruct or reuse arguments')
			})
		);
		expect(result.answer).toBe('KFVAL Galvanised Steel Plate 10mm is 4.85 AUD per kg.');
	});

	it('blocks calculator use on rate search candidates until Gemma fetches record details', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-1',
				label: 'KFVAL Galvanised Steel Plate 10mm',
				subtitle: null,
				relevance: 1,
				fields: {
					default_rate: 4.85,
					unit: 'kg',
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KFVAL Galvanised Steel Plate 10mm',
			subtitle: null,
			fields: {
				default_rate: 4.85,
				unit: 'kg',
				currency_code: 'AUD',
				rate_basis: 'cost'
			}
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-1',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials","query":"validation steel plate"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'calc-too-soon',
						function: {
							name: 'calculator_evaluate_decimal',
							arguments: '{"expression":"250 * 4.85"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'get-1',
						function: {
							name: 'records_get',
							arguments: '{"scope":"materials","recordId":"material-1"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'calc-1',
						function: {
							name: 'calculator_evaluate_decimal',
							arguments: '{"expression":"250 * 4.85"}'
						}
					}
				]
			},
			{ content: '250 kg costs 1212.50 AUD.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'How much would 250 kg of validation steel plate cost?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(5);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			toolResponseMessage(
				'calculator_evaluate_decimal',
				expect.objectContaining({
					status: 'error',
					code: 'record_detail_required',
					recoverable: true
				})
			)
		);
		expect(sendMessageStreamMock.mock.calls[4]?.[0].message).toEqual(
			toolResponseMessage('calculator_evaluate_decimal', {
				expression: '250 * 4.85',
				value: '1212.5'
			})
		);
		expect(result.answer).toBe('250 kg costs 1212.50 AUD.');
	});

	it('requires records_get before finalizing exact rate fields from search candidates', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-1',
				label: 'KFVAL Galvanised Steel Plate 10mm',
				subtitle: null,
				relevance: 1,
				fields: {
					default_rate: 4.85,
					unit: 'kg',
					currency_code: 'AUD',
					rate_basis: 'cost'
				}
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KFVAL Galvanised Steel Plate 10mm',
			subtitle: null,
			fields: {
				default_rate: 4.85,
				unit: 'kg',
				currency_code: 'AUD',
				rate_basis: 'cost'
			}
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-1',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials","query":"steel plate"}'
						}
					}
				]
			},
			{ content: 'The steel plate rate is 4.50 AUD/kg.', toolCalls: [] },
			{
				content: '',
				toolCalls: [
					{
						id: 'get-1',
						function: {
							name: 'records_get',
							arguments: '{"scope":"materials","recordId":"material-1"}'
						}
					}
				]
			},
			{ content: 'KFVAL Galvanised Steel Plate 10mm is 4.85 AUD per kg.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Find steel plate in my records and give me its rate, unit, and currency.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(4);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			expect.objectContaining({
				role: 'user',
				content: expect.stringContaining('records_search returns candidates only')
			})
		);
		expect(result.answer).toBe('KFVAL Galvanised Steel Plate 10mm is 4.85 AUD per kg.');
	});

	it('adds short record refs to search results and resolves them in records_get', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'contacts',
				id: '6e2ad077-da11-4c9b-a756-bed3ea3fe856',
				label: 'KF Validation Steel Pty Ltd',
				subtitle: null,
				relevance: 1,
				fields: { email: 'validation.steel@example.invalid' }
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'contacts',
			recordId: '6e2ad077-da11-4c9b-a756-bed3ea3fe856',
			label: 'KF Validation Steel Pty Ltd',
			subtitle: null,
			fields: {
				display_name: 'KF Validation Steel Pty Ltd',
				linked_people: [{ display_name: 'Mina Hart', role_title: 'estimator' }]
			}
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-company',
						function: {
							name: 'records_search',
							arguments: '{"scope":"contacts","query":"KF Validation Steel"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'get-company',
						function: {
							name: 'records_get',
							arguments: '{"scope":"contacts","recordId":"r1"}'
						}
					}
				]
			},
			{ content: 'The estimator contact is Mina Hart.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Find KF Validation Steel and tell me who the estimator contact is.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage(
				'records_search',
				expect.objectContaining({
					results: [
						expect.objectContaining({
							ref: 'r1',
							id: '6e2ad077-da11-4c9b-a756-bed3ea3fe856'
						})
					],
					recordRefs: [
						expect.objectContaining({
							ref: 'r1',
							recordId: '6e2ad077-da11-4c9b-a756-bed3ea3fe856'
						})
					]
				})
			)
		);
		expect(getWorkspaceRecordMock).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'contacts',
				recordId: '6e2ad077-da11-4c9b-a756-bed3ea3fe856'
			})
		);
		expect(result.answer).toBe('The estimator contact is Mina Hart.');
	});

	it('resolves short record refs in proposal update targets', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-1',
				label: 'KF Runtime Plate A',
				subtitle: null,
				relevance: 1,
				fields: { default_rate: 4.85, unit: 'kg', currency_code: 'AUD' }
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'materials',
			recordId: 'material-1',
			label: 'KF Runtime Plate A',
			subtitle: null,
			fields: { default_rate: 4.85, unit: 'kg', currency_code: 'AUD' }
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-material',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials","query":"KF Runtime Plate A"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'get-material',
						function: {
							name: 'records_get',
							arguments: '{"scope":"materials","recordId":"r1"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-update',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'update',
								recordId: 'r1',
								fields: { default_rate: 6.7 },
								summary: 'Update rate for KF Runtime Plate A to 6.75 AUD'
							})
						}
					}
				]
			},
			{ content: 'I drafted the rate update for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Update KF Runtime Plate A rate to 6.75 AUD.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.toolCalls?.map((call) => call.name)).toContain('material_change');
	});

	it('resolves an exact update code from the source item before staging a proposal', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-update-code',
				label: 'Assistant Update QA 20260711',
				subtitle: 'UPDATE-QA-20260711',
				relevance: 1,
				fields: { unit: 'kg', default_rate: 1.23, currency_code: 'AUD' }
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'materials',
			recordId: 'material-update-code',
			label: 'Assistant Update QA 20260711',
			subtitle: 'UPDATE-QA-20260711',
			fields: { code: 'UPDATE-QA-20260711', unit: 'kg', default_rate: 1.23 }
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-update-code',
						function: {
							name: 'material_change',
							arguments: '{"action":"update","sourceItem":1}'
						}
					}
				]
			},
			{ content: 'I drafted the update for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Update the existing material with code UPDATE-QA-20260711 to a default rate of 2.34 AUD per kg.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(getWorkspaceRecordMock).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'materials', recordId: 'material-update-code' })
		);
		expect(result.proposalSet?.items).toMatchObject([
			{
				recordId: 'material-update-code',
				fields: { default_rate: 2.34, unit: 'kg', currency_code: 'AUD' }
			}
		]);
	});

	it('rejects a staged update until the exact searched record is retrieved', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				recordId: 'material-1',
				label: 'KF Multi Plate A',
				subtitle: null,
				fields: {}
			}
		]);
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-update',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials","query":"KF Multi Plate A"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-update-source',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'update',
								recordId: 'material-rewritten-by-model',
								sourceItem: 1
							})
						}
					}
				]
			},
			{ content: 'I drafted the update for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Update KF Multi Plate A rate to 5.55 AUD.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(3);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			toolResponseMessage(
				'material_change',
				expect.objectContaining({
					status: 'error',
					code: 'record_detail_required'
				})
			)
		);
	});

	it('does not rewrite a malformed records_get id from the sole search candidate', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'contacts',
				id: '6e2ad077-da11-4c9b-a756-bed3ea3fe856',
				label: 'KF Validation Steel Pty Ltd',
				subtitle: null,
				relevance: 1,
				fields: {}
			}
		]);
		getWorkspaceRecordMock.mockResolvedValue(null);
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'search-company',
						function: {
							name: 'records_search',
							arguments: '{"scope":"contacts","query":"KF Validation Steel"}'
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'get-company',
						function: {
							name: 'records_get',
							arguments: '{"scope":"contacts","recordId":"6e2ad07-da1114c-9b-a76-bed3eafe3fe56"}'
						}
					}
				]
			},
			{ content: 'The estimator contact is Mina Hart.', toolCalls: [] }
		);

		await localAssistantService.answerTurn({
			prompt: 'Find KF Validation Steel and tell me who the estimator contact is.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(getWorkspaceRecordMock).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'contacts',
				recordId: '6e2ad07-da1114c-9b-a76-bed3eafe3fe56'
			})
		);
	});

	it('does not route or reset a turn based on record-related prompt keywords', async () => {
		completionQueue.push({
			content: 'I found KF Validation Steel but no estimator.',
			toolCalls: []
		});

		const result = await localAssistantService.answerTurn({
			prompt: 'Find KF Validation Steel and tell me who the estimator contact is.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(endConversationMock).not.toHaveBeenCalled();
		expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
		expect(result.answer).toBe('I found KF Validation Steel but no estimator.');
	});

	it('returns compact answer facts with record detail tool responses', async () => {
		getWorkspaceRecordMock.mockResolvedValue({
			scope: 'contacts',
			recordId: 'company-1',
			label: 'KF Validation Steel Pty Ltd',
			subtitle: null,
			fields: {
				display_name: 'KF Validation Steel Pty Ltd',
				linked_people: [
					{
						display_name: 'Mina Hart',
						role_title: 'estimator',
						email: 'mina.hart@example.invalid',
						phone: '+61 2 0000 0001'
					}
				]
			}
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'get-company',
						function: {
							name: 'records_get',
							arguments: '{"scope":"contacts","recordId":"company-1"}'
						}
					}
				]
			},
			{
				content: 'The estimator contact is Mina Hart.',
				toolCalls: []
			}
		);

		await localAssistantService.answerTurn({
			prompt: 'Find KF Validation Steel and tell me who the estimator contact is.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage(
				'records_get',
				expect.objectContaining({
					answerFacts: expect.arrayContaining([expect.stringContaining('Mina Hart')])
				})
			)
		);
	});

	it('preserves final-answer history without replaying prior thinking', async () => {
		completionQueue.push({ content: 'You asked me to multiply 19 by 23.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'What did I ask?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [
				{
					id: 'assistant-1',
					role: 'assistant',
					text: 'The result is 437.',
					thinking: 'I should multiply 19 by 23.',
					isStreaming: false,
					createdAt: '2026-06-25T00:00:00.000Z',
					citations: [],
					links: [],
					followUpSuggestions: [],
					attachments: []
				}
			],
			attachments: []
		});

		expect(ensureConversationMock.mock.calls[0]?.[0].messages).toEqual([
			{ role: 'assistant', content: 'The result is 437.' }
		]);
		expect(JSON.stringify(ensureConversationMock.mock.calls[0]?.[0].messages)).not.toContain(
			'I should multiply'
		);
	});

	it('does not replay legacy tool-role messages into new conversation history', async () => {
		completionQueue.push({ content: 'I can continue from the final answer.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'Continue',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [
				{
					id: 'assistant-1',
					role: 'assistant',
					text: 'The result is 437.',
					thinking: '',
					isStreaming: false,
					createdAt: '2026-06-25T00:00:00.000Z',
					citations: [],
					links: [],
					followUpSuggestions: [],
					attachments: []
				},
				{
					id: 'tool-1',
					role: 'tool',
					text: '{"value":"437"}',
					name: 'calculator_evaluate_decimal',
					tool_call_id: 'calc-1',
					thinking: '',
					isStreaming: false,
					createdAt: '2026-06-25T00:00:01.000Z',
					citations: [],
					links: [],
					followUpSuggestions: [],
					attachments: []
				}
			],
			attachments: []
		});

		expect(ensureConversationMock.mock.calls[0]?.[0].messages).toEqual([
			{ role: 'assistant', content: 'The result is 437.' }
		]);
		expect(JSON.stringify(ensureConversationMock.mock.calls[0]?.[0].messages)).not.toContain(
			'calculator_evaluate_decimal'
		);
	});

	it('does not replay stale thinking in tool-result continuation messages', async () => {
		completionQueue.push(
			{
				content: '',
				thinking: 'I should calculate this.',
				toolCalls: [
					{
						id: 'calc-1',
						function: {
							name: 'calculator_evaluate_decimal',
							arguments: '{"expression":"19 * 23"}'
						}
					}
				]
			},
			{ content: '19 multiplied by 23 is 437.', toolCalls: [] }
		);

		await localAssistantService.answerTurn({
			prompt: 'What is 19 * 23?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		const continuation = sendMessageStreamMock.mock.calls[1]?.[0].message;
		expect(continuation).toEqual(
			toolResponseMessage('calculator_evaluate_decimal', expect.anything())
		);
		expect(JSON.stringify(continuation)).not.toContain('I should calculate this.');
	});

	it('adds the screen inspection tool only when viewport context is available', async () => {
		completionQueue.push({ content: 'You are on Home.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'What page am I on?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: {
				id: 'viewport-home',
				pathname: '/',
				routeId: null,
				pageTitle: 'Home',
				reference: {
					title: 'Home',
					label: 'Home',
					pathname: '/',
					routeId: null
				},
				metadata: {},
				text: 'Current page: Home'
			},
			conversation: [],
			attachments: []
		});

		const tools = ensureConversationMock.mock.calls[0]?.[0].tools ?? [];
		expect(tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain(
			'inspect_current_screen'
		);
		expect(tools.length).toBe(15);
	});

	it('does not expose screen inspection when the user has not attached page context', async () => {
		completionQueue.push({ content: 'I can help without screen context.', toolCalls: [] });

		await localAssistantService.answerTurn({
			prompt: 'What can you do?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		const tools = ensureConversationMock.mock.calls[0]?.[0].tools ?? [];
		expect(tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain(
			'inspect_current_screen'
		);
		expect(tools).toHaveLength(14);
	});

	it('returns structured invalid tool arguments to Gemma instead of guessing from prompt keywords', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'lookup-1',
						function: {
							name: 'records_search',
							arguments: 'query:<|"|>Acme'
						}
					}
				]
			},
			{ content: 'I need a valid lookup scope.', toolCalls: [] }
		);

		await localAssistantService.answerTurn({
			prompt: 'Do we have Acme?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage(
				'records_search',
				expect.objectContaining({
					status: 'error',
					code: 'invalid_arguments',
					recoverable: true,
					retryHint: expect.any(String)
				})
			)
		);
	});

	it('stops safely when Gemma repeats the exact same recoverable failed tool call', async () => {
		for (let index = 0; index < 2; index += 1) {
			completionQueue.push({
				content: '',
				toolCalls: [
					{
						id: `bad-search-${index}`,
						function: {
							name: 'records_search',
							arguments: 'query:<|"|>Acme'
						}
					}
				]
			});
		}

		const result = await localAssistantService.answerTurn({
			prompt: 'Do we have Acme?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
		expect(result.answer).toContain('could not complete');
		expect(result.answer).toContain('repeated');
	});

	it('returns the validated read result when Gemma repeats an identical successful lookup', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-4140',
				label: '4140 Shaft',
				subtitle: 'EA',
				relevance: 1,
				fields: {}
			}
		]);
		for (const id of ['first', 'repeat']) {
			completionQueue.push({
				content: '',
				toolCalls: [
					{
						id,
						function: {
							name: 'records_search',
							arguments: JSON.stringify({ scope: 'materials', query: '4140' })
						}
					}
				]
			});
		}

		const result = await localAssistantService.answerTurn({
			prompt: 'List material records matching 4140.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
		expect(result.answer).toContain('4140 Shaft');
		expect(result.answer).toContain('Returned 1 workspace record');
	});

	it('returns a successful catalogue browse without a follow-up model turn', async () => {
		searchAssistantRecordsMock.mockResolvedValue([
			{
				scope: 'materials',
				id: 'material-4140',
				label: '4140 Shaft',
				subtitle: 'ALLOY-4140-50',
				relevance: 1,
				fields: {}
			}
		]);
		completionQueue.push({
			content: '',
			toolCalls: [
				{
					id: 'browse-materials',
					function: {
						name: 'records_search',
						arguments: JSON.stringify({ scope: 'materials', browse: true, query: '' })
					}
				}
			]
		});

		const result = await localAssistantService.answerTurn({
			prompt: 'List all material catalogue records.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
		expect(result.answer).toContain('4140 Shaft');
	});

	it('continues beyond three tool turns until Gemma returns a final answer', async () => {
		for (const scope of ['contacts', 'materials', 'labour_rates', 'equipment_rates']) {
			completionQueue.push({
				content: '',
				toolCalls: [
					{
						id: `lookup-${scope}`,
						function: {
							name: 'records_search',
							arguments: JSON.stringify({ scope, query: 'Acme' })
						}
					}
				]
			});
		}
		completionQueue.push({ content: 'No matching Acme record was found.', toolCalls: [] });

		const result = await localAssistantService.answerTurn({
			prompt: 'Do we have Acme?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(5);
		expect(result.answer).toBe('No matching Acme record was found.');
	});

	it('lets Gemma change lookup direction after an empty result', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'lookup-materials',
						function: {
							name: 'records_search',
							arguments: JSON.stringify({ scope: 'materials', query: 'Acme' })
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'lookup-contacts',
						function: {
							name: 'records_search',
							arguments: JSON.stringify({ scope: 'contacts', query: 'Acme' })
						}
					}
				]
			},
			{ content: 'I found no matching material, so I checked contacts next.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Find Acme',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(3);
		expect(sendMessageStreamMock.mock.calls[1]?.[0].message).toEqual(
			toolResponseMessage('records_search', expect.objectContaining({ results: expect.any(Array) }))
		);
		expect(sendMessageStreamMock.mock.calls[2]?.[0].message).toEqual(
			toolResponseMessage('records_search', expect.objectContaining({ results: expect.any(Array) }))
		);
		expect(result.answer).toBe('I found no matching material, so I checked contacts next.');
	});

	it('does not expose mutation proposal tools in the Ask foundation tool surface', async () => {
		completionQueue.push(
			{
				content: 'I can help draft the material details for review.',
				toolCalls: []
			},
			{
				content: 'Use material_change to draft this for approval.',
				toolCalls: []
			}
		);

		await localAssistantService.answerTurn({
			prompt: 'What can you do?',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		const tools = ensureConversationMock.mock.calls[0]?.[0].tools ?? [];
		const toolNames = tools.map((tool: { function: { name: string } }) => tool.function.name);
		expect(toolNames).toContain('material_change');
		expect(toolNames.some((name: string) => name.endsWith('_propose_upsert'))).toBe(false);
	});

	it('continues after staging a proposal and returns one grouped set', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: {
									name: 'KF Closeout Steel Plate',
									unit: 'kg',
									default_rate: 4.85,
									currency_code: 'AUD',
									rate_basis: 'cost'
								},
								summary: 'Draft material proposal for KF Closeout Steel Plate.'
							})
						}
					}
				]
			},
			{ content: 'I drafted the material for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create a material called KF Closeout Steel Plate with unit kg and rate 4.85 AUD cost.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
		expect(result.answer).toBe('I drafted 1 proposed change for approval.');
		const items = result.proposalSet?.items ?? [];
		expect(items).toHaveLength(1);
		expect(items[0]).toEqual(
			expect.objectContaining({
				scope: 'materials',
				action: 'create'
			})
		);
		expect(result.proposalSet?.status).toBe('pending');
	});

	it('stages a proposal from an exact mutation source item without model-transcribed fields', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-text-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								sourceItem: 1
							})
						}
					}
				]
			},
			{ content: 'I drafted the material for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create one material called KF Closeout Single Plate with unit metre, rate 11.25 AUD, cost basis.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet?.items).toHaveLength(1);
		expect(result.answer).toBe('I drafted 1 proposed change for approval.');
		expect(result.proposalSet?.items[0].fields).toMatchObject({
			name: 'KF Closeout Single Plate',
			unit: 'm',
			default_rate: 11.25,
			currency_code: 'AUD',
			rate_basis: 'cost'
		});
		expect(JSON.stringify(sendMessageStreamMock.mock.calls[0]?.[0]?.message)).toContain(
			'[Mutation source items]'
		);
	});

	it('collects five independent proposals into one complete proposal set', async () => {
		const calls = ['A', 'B', 'C', 'D', 'E'].map((suffix, index) => ({
			id: `proposal-${index + 1}`,
			function: {
				name: 'material_change',
				arguments: JSON.stringify({
					scope: 'materials',
					action: 'create',
					fields: { name: `KF Multi Plate ${suffix}`, unit: 'kg', default_rate: 4.85 + index },
					summary: `Draft material proposal for KF Multi Plate ${suffix}.`
				})
			}
		}));
		completionQueue.push(
			{ content: '', toolCalls: calls },
			{ content: 'I drafted all five materials for your approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create KF Multi Plate A at 4.85, KF Multi Plate B at 5.85, KF Multi Plate C at 6.85, KF Multi Plate D at 7.85, and KF Multi Plate E at 8.85.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
		expect(result.answer).toBe('I drafted 5 proposed changes for approval.');
		expect(result.proposalSet?.items).toHaveLength(5);
		expect(result.proposalSet?.items.map((proposal) => proposal.fields.name)).toEqual(
			['A', 'B', 'C', 'D', 'E'].map((suffix) => `KF Multi Plate ${suffix}`)
		);
	});

	it('anchors multiple proposal calls to distinct exact source items', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [1, 2, 3].map((sourceItem) => ({
					id: `proposal-source-${sourceItem}`,
					function: {
						name: 'material_change',
						arguments: JSON.stringify({ action: 'create', sourceItem })
					}
				}))
			},
			{ content: 'I drafted all three materials for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create these three materials for approval: KF Multi Plate A, 4.85 AUD per kg, cost basis; KF Multi Cable B, 7.20 AUD per metre, cost basis; KF Multi Fastener C, 1.10 AUD per each, cost basis.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet?.items).toHaveLength(3);
		expect(result.proposalSet?.items.map((proposal) => proposal.fields)).toEqual([
			expect.objectContaining({ name: 'KF Multi Plate A', default_rate: 4.85, unit: 'kg' }),
			expect.objectContaining({ name: 'KF Multi Cable B', default_rate: 7.2, unit: 'm' }),
			expect.objectContaining({ name: 'KF Multi Fastener C', default_rate: 1.1, unit: 'ea' })
		]);
	});

	it('collects five sequential proposal turns into one complete proposal set', async () => {
		for (const [index, suffix] of ['A', 'B', 'C', 'D', 'E'].entries()) {
			completionQueue.push({
				content: '',
				toolCalls: [
					{
						id: `proposal-${index + 1}`,
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: `KF Sequential Plate ${suffix}`,
								unit: 'kg',
								default_rate: index + 1
							})
						}
					}
				]
			});
		}
		completionQueue.push({
			content: 'I drafted all five materials for your approval.',
			toolCalls: []
		});

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create these materials: KF Sequential Plate A at 1; KF Sequential Plate B at 2; KF Sequential Plate C at 3; KF Sequential Plate D at 4; KF Sequential Plate E at 5.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(5);
		expect(result.proposalSet?.items).toHaveLength(5);
		expect(result.proposalSet?.items.map((proposal) => proposal.fields.name)).toEqual(
			['A', 'B', 'C', 'D', 'E'].map((suffix) => `KF Sequential Plate ${suffix}`)
		);
		expect(JSON.stringify(sendMessageStreamMock.mock.calls[1]?.[0].message)).toContain(
			'"label":"KF Sequential Plate A"'
		);
		const firstToolResponse = JSON.stringify(sendMessageStreamMock.mock.calls[1]?.[0].message);
		expect(firstToolResponse).toContain('"complete":true');
		expect(firstToolResponse).toContain('"staged_count":1');
		expect(firstToolResponse).not.toContain('"expected_count"');
	});

	it('allows up to 23 sequential proposals plus a final answer within the safety ceiling', async () => {
		for (let index = 1; index <= 23; index += 1) {
			completionQueue.push({
				content: '',
				toolCalls: [
					{
						id: `proposal-${index}`,
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: `KF Turn Limit Plate ${index}`,
								unit: 'kg',
								default_rate: 1
							})
						}
					}
				]
			});
		}
		completionQueue.push({ content: 'I drafted all requested materials.', toolCalls: [] });

		const result = await localAssistantService.answerTurn({
			prompt: `Create these materials: ${Array.from(
				{ length: 23 },
				(_, index) => `KF Turn Limit Plate ${index + 1} at 1`
			).join('; ')}.`,
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(23);
		expect(result.proposalSet?.items).toHaveLength(23);
	});

	it('retries an invalid proposal wave and exposes only the complete corrected set', async () => {
		const validArguments = JSON.stringify({
			scope: 'materials',
			action: 'create',
			fields: { name: 'KF Valid Plate', unit: 'kg', default_rate: 4.85 },
			summary: 'Draft material proposal for KF Valid Plate.'
		});
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{ id: 'proposal-1', function: { name: 'material_change', arguments: validArguments } },
					{
						id: 'proposal-2',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: { name: 'KF Corrected Plate', unit: 'kg', internal_table_name: 'audit' },
								summary: 'Draft invalid material proposal.'
							})
						}
					}
				]
			},
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1-retry',
						function: { name: 'material_change', arguments: validArguments }
					},
					{
						id: 'proposal-2-retry',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: { name: 'KF Corrected Plate', unit: 'kg', default_rate: 5.25 },
								summary: 'Draft material proposal for KF Corrected Plate.'
							})
						}
					}
				]
			},
			{ content: 'I drafted both materials for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create these materials: KF Valid Plate; KF Corrected Plate.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
		expect(result.proposalSet?.items.map((proposal) => proposal.fields.name)).toEqual([
			'KF Valid Plate',
			'KF Corrected Plate'
		]);
	});

	it('does not expose staged proposals when Gemma finishes with an unresolved proposal error', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: { name: 'KF Valid Plate', unit: 'kg', default_rate: 4.85 },
								summary: 'Draft material proposal for KF Valid Plate.'
							})
						}
					},
					{
						id: 'proposal-2',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: { name: 'KF Broken Plate', unit: 'kg', default_rate: -1 },
								summary: 'Draft invalid material proposal.'
							})
						}
					}
				]
			},
			{ content: 'I drafted the materials.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Valid Plate and KF Broken Plate.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.answer).toContain('complete proposal set');
	});

	it('deduplicates a repeated successful proposal before exposing the set', async () => {
		const proposalCall = (id: string) => ({
			id,
			function: {
				name: 'material_change',
				arguments: JSON.stringify({
					scope: 'materials',
					action: 'create',
					fields: { name: 'KF Repeated Plate', unit: 'kg', default_rate: 4.85 },
					summary: 'Draft KF Repeated Plate.'
				})
			}
		});
		completionQueue.push(
			{ content: '', toolCalls: [proposalCall('proposal-1')] },
			{ content: '', toolCalls: [proposalCall('proposal-2')] },
			{ content: 'I drafted the material for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Repeated Plate.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet?.items).toHaveLength(1);
		expect(result.proposalSet?.items[0].fields.name).toBe('KF Repeated Plate');
	});

	it('discards hidden proposal staging when generation is cancelled', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-cancelled',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'create',
								fields: { name: 'KF Cancelled Plate', unit: 'kg', default_rate: 4.85 },
								summary: 'Draft KF Cancelled Plate.'
							})
						}
					}
				]
			},
			{ content: '', toolCalls: [], error: new Error('Local AI stream was stopped') }
		);

		await expect(
			localAssistantService.answerTurn({
				prompt: 'Create these materials: KF Cancelled Plate; KF Cancelled Plate Two.',
				pathname: '/',
				projectId: null,
				assetId: null,
				workspaceId: 'workspace-1',
				workspaceProfile: null,
				knowledgeContext: null,
				currentEstimateContext: null,
				viewportContext: null,
				conversation: [],
				attachments: []
			})
		).rejects.toThrow('stream was stopped');

		completionQueue.push({ content: 'Ready for a new request.', toolCalls: [] });
		const next = await localAssistantService.answerTurn({
			prompt: 'Hello',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});
		expect(next.proposalSet).toBeUndefined();
	});

	it('does not rewrite a proposal rate from prompt text', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								scope: 'materials',
								action: 'update',
								recordId: 'material-1',
								fields: {
									default_rate: 6.7
								},
								summary: 'Update material rate.'
							})
						}
					}
				]
			},
			{ content: 'I drafted the corrected rate update.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Update KF Runtime Plate A rate to 6.75 AUD.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.toolCalls?.map((call) => call.name)).toContain('material_change');
	});

	it('rejects proposal identity or value drift instead of rewriting from prompt text', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: 'KF Plate',
								unit: 'kg',
								default_rate: 4.8,
								currency_code: 'AUD'
							})
						}
					}
				]
			},
			{ content: 'I drafted the exact material for approval.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create KF Raw Debug Plate at 4.85 AUD per kg for approval.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.toolCalls?.map((call) => call.name)).toContain('material_change');
		expect(
			sendMessageStreamMock.mock.calls.some((call) =>
				JSON.stringify(call[0]?.message).includes('proposal_identity_drift')
			)
		).toBe(false);
	});

	it('rejects a drifted called proposal without staging app-generated replacements', async () => {
		completionQueue.push({
			content: '',
			toolCalls: [
				{
					id: 'proposal-a',
					function: {
						name: 'material_change',
						arguments: JSON.stringify({
							action: 'create',
							name: 'KF Drifted A',
							unit: 'each',
							default_rate: 1,
							currency_code: 'USD'
						})
					}
				}
			]
		});
		completionQueue.push({ content: 'I drafted the three materials for approval.', toolCalls: [] });

		const result = await localAssistantService.answerTurn({
			prompt:
				'Create these materials for approval: KF Grounded Plate A at 1.10 AUD per kg cost; KF Grounded Plate B at 2.20 AUD per sheet cost; KF Grounded Plate C at 3.30 AUD per metre sell.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.toolCalls?.map((call) => call.name)).toEqual(['material_change']);
	});

	it('rejects contextual create proposals when no source record or user literal supports them', async () => {
		completionQueue.push(
			{
				content: '',
				toolCalls: [
					{
						id: 'proposal-1',
						function: {
							name: 'material_change',
							arguments: JSON.stringify({
								action: 'create',
								name: 'KF Guessed Plate',
								unit: 'kg',
								default_rate: 4.85,
								currency_code: 'AUD'
							})
						}
					}
				]
			},
			{ content: 'I could not preserve the exact requested record name.', toolCalls: [] }
		);

		const result = await localAssistantService.answerTurn({
			prompt: 'Create that material for approval.',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: null,
			conversation: [],
			attachments: []
		});

		expect(result.proposalSet).toBeUndefined();
		expect(result.toolCalls?.map((call) => call.name)).toContain('material_change');
	});

	it('keeps Ask tool declarations free of legacy proposal/upsert wording', async () => {
		completionQueue.push({
			content: 'Read-only tools are available.',
			toolCalls: []
		});

		await localAssistantService.answerTurn({
			prompt: 'List tools',
			pathname: '/',
			projectId: null,
			assetId: null,
			workspaceId: 'workspace-1',
			workspaceProfile: null,
			knowledgeContext: null,
			currentEstimateContext: null,
			viewportContext: {
				id: 'viewport-home',
				pathname: '/',
				routeId: null,
				pageTitle: 'Home',
				reference: {
					title: 'Home',
					label: 'Home',
					pathname: '/',
					routeId: null
				},
				metadata: {},
				text: 'Current page: Home'
			},
			conversation: [],
			attachments: []
		});

		const tools = ensureConversationMock.mock.calls[0]?.[0].tools ?? [];
		const serialized = JSON.stringify(tools);
		expect(serialized).toContain('material_change');
		expect(serialized).not.toMatch(
			/propose_upsert|arbitrary sql|table name supplied by the model/i
		);
		for (const tool of tools) {
			expect(tool.function.description).toMatch(/return|read|validate|evaluate|convert|draft/i);
		}
	});
});
