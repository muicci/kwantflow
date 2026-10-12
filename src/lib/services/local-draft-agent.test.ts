import { describe, expect, it, vi } from 'vitest';
import { getLocalDraftAgentToolDeclarations, runLocalDraftAgent } from './local-draft-agent.js';

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

describe('runLocalDraftAgent', () => {
	it('exposes only the approved read-only tools', () => {
		expect(getLocalDraftAgentToolDeclarations().map((tool) => tool.function.name)).toEqual([
			'records_search',
			'records_get',
			'draft_evidence_get'
		]);
	});

	it('reads a bounded prepared-evidence slice through the draft-only tool', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'evidence-1',
						function: {
							name: 'draft_evidence_get',
							arguments: JSON.stringify({ file_id: 'file-1', evidence_identifier: 'page-2' })
						}
					}
				]
			})
			.mockResolvedValueOnce({ content: '{"status":"complete"}', toolCalls: [] });
		const readEvidence = vi.fn().mockResolvedValue({ status: 'ok', text: 'bounded evidence' });

		await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool: vi.fn(),
			readEvidence,
			parseFinal: (value) => value
		});

		expect(readEvidence).toHaveBeenCalledWith({
			file_id: 'file-1',
			evidence_identifier: 'page-2'
		});
	});

	it('accepts a final proposal through the dedicated return tool without executing it', async () => {
		const executeTool = vi.fn();
		const result = await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete: vi.fn().mockResolvedValue({
				content: '',
				toolCalls: [
					{
						id: 'final-1',
						function: {
							name: 'kwantflow_return_draft_estimator_proposal',
							arguments: JSON.stringify({ status: 'complete', takeoffItems: [] })
						}
					}
				]
			}),
			executeTool,
			finalToolName: 'kwantflow_return_draft_estimator_proposal',
			parseFinal: (value) => value as { status: string; takeoffItems: unknown[] }
		});

		expect(result.final).toEqual({ status: 'complete', takeoffItems: [] });
		expect(executeTool).not.toHaveBeenCalled();
	});

	it('executes declared read-only tools and returns the validated final payload', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'call-1',
						function: {
							name: 'records_search',
							arguments: JSON.stringify({ scope: 'materials', query: 'plate', limit: 5 })
						}
					}
				]
			})
			.mockResolvedValueOnce({
				content: JSON.stringify({ status: 'complete', draft: { scope_summary: 'Plate' } }),
				toolCalls: []
			});
		const executeTool = vi.fn().mockResolvedValue({ status: 'ok', results: [{ id: 'mat-1' }] });

		const result = await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool,
			parseFinal: (value) => value as { status: 'complete'; draft: { scope_summary: string } }
		});

		expect(executeTool).toHaveBeenCalledWith('records_search', {
			scope: 'materials',
			query: 'plate',
			limit: 5
		});
		expect(result.final.draft.scope_summary).toBe('Plate');
		expect(result.steps).toHaveLength(2);
		expect(result.toolCalls).toHaveLength(1);
		expect(complete.mock.calls[1]?.[0]).toContainEqual(
			toolResponseMessage('records_search', { status: 'ok', results: [{ id: 'mat-1' }] })
		);
	});

	it('repairs JSON-like tool arguments before executing draft tools', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'call-1',
						function: {
							name: 'records_search',
							arguments: '{"scope":"materials" "query":"4140"}'
						}
					}
				]
			})
			.mockResolvedValueOnce({ content: '{"status":"complete"}', toolCalls: [] });
		const executeTool = vi.fn().mockResolvedValue({ status: 'ok', results: [] });

		await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool,
			parseFinal: (value) => value
		});

		expect(executeTool).toHaveBeenCalledWith('records_search', {
			scope: 'materials',
			query: '4140'
		});
	});

	it('rejects mutation tools even when the model emits one', async () => {
		const complete = vi.fn().mockResolvedValue({
			content: '',
			toolCalls: [
				{
					id: 'call-1',
					function: { name: 'material_change', arguments: '{}' }
				}
			]
		});

		await expect(
			runLocalDraftAgent({
				initialMessage: 'Prepare an estimate draft.',
				complete,
				executeTool: vi.fn(),
				parseFinal: (value) => value
			})
		).rejects.toThrow('Draft agent cannot execute undeclared tool: material_change');
	});

	it('returns recoverable feedback for unknown read-like tools instead of aborting the draft', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'call-1',
						function: { name: 'draft_get', arguments: '{"file_id":"file-1"}' }
					}
				]
			})
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'call-2',
						function: {
							name: 'draft_evidence_get',
							arguments: '{"file_id":"file-1"}'
						}
					}
				]
			})
			.mockResolvedValueOnce({ content: '{"status":"complete"}', toolCalls: [] });
		const readEvidence = vi.fn().mockResolvedValue({ status: 'ok' });

		const result = await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool: vi.fn(),
			readEvidence,
			parseFinal: (value) => value
		});

		expect(result.toolCalls.map((call) => call.name)).toEqual(['draft_get', 'draft_evidence_get']);
		expect(result.toolCalls[0]?.status).toBe('error');
		expect(readEvidence).toHaveBeenCalledWith({ file_id: 'file-1' });
	});

	it('stops after the bounded turn limit', async () => {
		const complete = vi.fn().mockResolvedValue({
			content: '',
			toolCalls: [
				{
					id: 'call-1',
					function: { name: 'records_search', arguments: '{}' }
				}
			]
		});

		await expect(
			runLocalDraftAgent({
				initialMessage: 'Prepare an estimate draft.',
				complete,
				executeTool: vi.fn().mockResolvedValue({ status: 'ok' }),
				parseFinal: (value) => value,
				maxTurns: 2
			})
		).rejects.toThrow('Draft agent exceeded 2 model turns');
		expect(complete).toHaveBeenCalledTimes(2);
	});

	it('reports partial steps and tool calls before a bounded turn failure', async () => {
		const complete = vi.fn().mockResolvedValue({
			content: '',
			toolCalls: [
				{
					id: 'call-1',
					function: { name: 'records_search', arguments: '{}' }
				}
			]
		});
		const onStep = vi.fn();
		const onToolCall = vi.fn();

		await expect(
			runLocalDraftAgent({
				initialMessage: 'Prepare an estimate draft.',
				complete,
				executeTool: vi.fn().mockResolvedValue({ status: 'ok' }),
				parseFinal: (value) => value,
				maxTurns: 2,
				onStep,
				onToolCall
			})
		).rejects.toThrow('Draft agent exceeded 2 model turns');

		expect(onStep).toHaveBeenCalledTimes(2);
		expect(onToolCall).toHaveBeenCalledTimes(2);
		expect(onToolCall).toHaveBeenLastCalledWith({
			turn: 2,
			name: 'records_search',
			arguments: {},
			status: 'error'
		});
	});

	it('stops after the same failing tool call is repeated', async () => {
		const complete = vi.fn().mockResolvedValue({
			content: '',
			toolCalls: [
				{
					id: 'call-1',
					function: {
						name: 'records_get',
						arguments: JSON.stringify({ scope: 'materials', recordId: 'missing' })
					}
				}
			]
		});
		const executeTool = vi.fn().mockResolvedValue({ status: 'not_found', recoverable: true });

		await expect(
			runLocalDraftAgent({
				initialMessage: 'Prepare an estimate draft.',
				complete,
				executeTool,
				parseFinal: (value) => value
			})
		).rejects.toThrow('Draft agent repeated a failing tool call');
		expect(executeTool).toHaveBeenCalledTimes(2);
	});

	it('does not execute the same successful lookup twice', async () => {
		const lookup = {
			id: 'call-1',
			function: {
				name: 'records_search',
				arguments: JSON.stringify({ scope: 'materials', query: 'plate' })
			}
		};
		const complete = vi
			.fn()
			.mockResolvedValueOnce({ content: '', toolCalls: [lookup] })
			.mockResolvedValueOnce({ content: '', toolCalls: [{ ...lookup, id: 'call-2' }] })
			.mockResolvedValueOnce({ content: '{"status":"complete"}', toolCalls: [] });
		const executeTool = vi.fn().mockResolvedValue({ status: 'ok', results: [] });

		await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool,
			parseFinal: (value) => value
		});

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(complete.mock.calls[2]?.[0]).toContainEqual(
			toolResponseMessage(
				'records_search',
				expect.objectContaining({ code: 'record_already_retrieved' })
			)
		);
	});

	it('gives the model one correction turn for an invalid final payload', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({ content: '{"status":"incomplete"}', toolCalls: [] })
			.mockResolvedValueOnce({
				content: '{"status":"complete","draft":{"scope_summary":"Corrected"}}',
				toolCalls: []
			});
		const parseFinal = vi.fn((value: unknown) => {
			const record = value as { status?: string; draft?: { scope_summary: string } };
			if (record.status !== 'complete' || !record.draft) throw new Error('invalid final schema');
			return record as { status: 'complete'; draft: { scope_summary: string } };
		});

		const result = await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool: vi.fn(),
			parseFinal
		});

		expect(result.final.draft.scope_summary).toBe('Corrected');
		expect(complete).toHaveBeenCalledTimes(2);
		expect(complete.mock.calls[1]?.[0]).toContainEqual(
			expect.objectContaining({
				role: 'user',
				content: expect.stringContaining('validation failed')
			})
		);
	});

	it('requires at least one tool call before accepting a final payload when requested', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: '{"status":"complete","draft":{"scope_summary":"Too early"}}',
				toolCalls: []
			})
			.mockResolvedValueOnce({
				content: '',
				toolCalls: [
					{
						id: 'call-1',
						function: {
							name: 'records_search',
							arguments: JSON.stringify({})
						}
					}
				]
			})
			.mockResolvedValueOnce({
				content: '{"status":"complete","draft":{"scope_summary":"Checked"}}',
				toolCalls: []
			});

		const result = await runLocalDraftAgent({
			initialMessage: 'Prepare an estimate draft.',
			complete,
			executeTool: vi.fn().mockResolvedValue({ status: 'ok', scopes: [] }),
			parseFinal: (value) => value as { status: 'complete'; draft: { scope_summary: string } },
			requireToolUseBeforeFinal: true
		});

		expect(result.final.draft.scope_summary).toBe('Checked');
		expect(result.toolCalls).toHaveLength(1);
		expect(complete.mock.calls[1]?.[0]).toContainEqual(
			expect.objectContaining({
				role: 'user',
				content: expect.stringContaining('Before returning the final draft')
			})
		);
	});
});
