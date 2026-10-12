import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiEvidenceRef } from '$lib/types/index.js';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock
}));

vi.mock('$lib/utils/env.js', () => ({
	isTauri: () => true
}));

describe('dbService AI evidence ref command mapping', () => {
	beforeEach(() => {
		invokeMock.mockReset();
	});

	it('maps snake_case AI evidence refs into the camelCase Tauri command payload', async () => {
		const { dbService } = await import('./db.js');
		(dbService as unknown as { init: () => Promise<void> }).init = vi
			.fn()
			.mockResolvedValue(undefined);
		(
			dbService as unknown as {
				withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>;
			}
		).withWriteLock = async <T>(fn: () => Promise<T>) => fn();

		const refs: AiEvidenceRef[] = [
			{
				file_id: 'file-1',
				file_name: 'validation-rfq.pdf',
				artifact_kind: 'pdf',
				page_number: 2,
				view_label: 'page-2',
				quote_path: 'takeoff_items[0]',
				summary: 'Primary RFQ evidence'
			}
		];

		await dbService.replaceAiEvidenceRefs('run-1', 'asset-1', refs);

		expect(invokeMock).toHaveBeenCalledWith('replace_ai_evidence_refs_command', {
			input: {
				runId: 'run-1',
				assetId: 'asset-1',
				refs: [
					{
						fileId: 'file-1',
						fileName: 'validation-rfq.pdf',
						artifactKind: 'pdf',
						pageNumber: 2,
						viewLabel: 'page-2',
						evidenceIdentifier: '',
						locatorJson: {},
						draftEntityKind: '',
						draftEntityKey: '',
						confidenceJson: {},
						quotePath: 'takeoff_items[0]',
						summary: 'Primary RFQ evidence'
					}
				]
			}
		});
	});
});
