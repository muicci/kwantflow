import { describe, expect, it } from 'vitest';
import { AiRunRowSchema, AiEvidenceRefRowSchema } from './index.js';

function createAiRunRow(status: string) {
	return {
		id: 'run-1',
		asset_id: 'asset-1',
		provider: 'local_litert_lm',
		model_id: 'local-runtime',
		status,
		trigger_source: 'asset_editor',
		started_at: '2026-03-16T10:00:00.000Z',
		completed_at: null,
		failed_at: null,
		cancelled_at: null,
		error_message: null,
		usage_json: '{}',
		created_at: '2026-03-16T10:00:00.000Z',
		updated_at: '2026-03-16T10:00:00.000Z'
	};
}

describe('AiRunRowSchema', () => {
	it('accepts shipped AI run statuses and normalises stale consolidating rows', () => {
		expect(AiRunRowSchema.parse(createAiRunRow('preprocessing')).status).toBe('preprocessing');
		expect(AiRunRowSchema.parse(createAiRunRow('consolidating')).status).toBe('drafting');
		expect(AiRunRowSchema.parse(createAiRunRow('drafted')).status).toBe('drafted');
		expect(AiRunRowSchema.parse(createAiRunRow('applied')).status).toBe('applied');
	});

	it('accepts local LiteRT-LM provider rows', () => {
		expect(
			AiRunRowSchema.parse({
				...createAiRunRow('drafted'),
				provider: 'local_litert_lm',
				model_id: 'kwantflow-ai.litertlm'
			}).provider
		).toBe('local_litert_lm');
	});

	it('falls back to an empty object when usage_json is an invalid JSON string', () => {
		expect(
			AiRunRowSchema.parse({
				...createAiRunRow('drafted'),
				usage_json: 'invalid-json'
			}).usage_json
		).toEqual({});
	});
});

describe('AiEvidenceRefRowSchema', () => {
	it('parses valid locator_json string to object', () => {
		const row = {
			id: 'ref-1',
			run_id: 'run-1',
			asset_id: 'asset-1',
			file_id: 'file-1',
			file_name: 'test.pdf',
			artifact_kind: 'pdf',
			page_number: 1,
			view_label: 'View 1',
			quote_path: 'path/to/quote',
			summary: 'summary',
			created_at: '2026-03-16T10:00:00.000Z',
			locator_json: '{"x": 10, "y": 20}'
		};
		const parsed = AiEvidenceRefRowSchema.parse(row);
		expect(parsed.locator_json).toEqual({ x: 10, y: 20 });
	});

	it('returns empty object for invalid locator_json string', () => {
		const row = {
			id: 'ref-1',
			run_id: 'run-1',
			asset_id: 'asset-1',
			file_id: 'file-1',
			file_name: 'test.pdf',
			artifact_kind: 'pdf',
			page_number: 1,
			view_label: 'View 1',
			quote_path: 'path/to/quote',
			summary: 'summary',
			created_at: '2026-03-16T10:00:00.000Z',
			locator_json: '{invalid json}'
		};
		const parsed = AiEvidenceRefRowSchema.parse(row);
		expect(parsed.locator_json).toEqual({});
	});

	it('returns existing object if locator_json is already an object', () => {
		const row = {
			id: 'ref-1',
			run_id: 'run-1',
			asset_id: 'asset-1',
			file_id: 'file-1',
			file_name: 'test.pdf',
			artifact_kind: 'pdf',
			page_number: 1,
			view_label: 'View 1',
			quote_path: 'path/to/quote',
			summary: 'summary',
			created_at: '2026-03-16T10:00:00.000Z',
			locator_json: { z: 30 }
		};
		const parsed = AiEvidenceRefRowSchema.parse(row);
		expect(parsed.locator_json).toEqual({ z: 30 });
	});

	it('returns empty object if locator_json is missing/null/undefined', () => {
		const row = {
			id: 'ref-1',
			run_id: 'run-1',
			asset_id: 'asset-1',
			file_id: 'file-1',
			file_name: 'test.pdf',
			artifact_kind: 'pdf',
			page_number: 1,
			view_label: 'View 1',
			quote_path: 'path/to/quote',
			summary: 'summary',
			created_at: '2026-03-16T10:00:00.000Z'
		};
		const parsed = AiEvidenceRefRowSchema.parse(row);
		expect(parsed.locator_json).toEqual({});
	});
});
