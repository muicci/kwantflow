import { describe, expect, it } from 'vitest';
import { AssetFileSchema } from './index.js';

describe('AssetFileSchema', () => {
	it('handles invalid JSON in source_metadata_json by returning an empty object', () => {
		const result = AssetFileSchema.parse({
			id: 'test-id',
			project_id: 'proj-1',
			file_path: '/tmp/test.pdf',
			original_name: 'test.pdf',
			created_at: new Date().toISOString(),
			source_metadata_json: '{"invalid": json'
		});

		expect(result.source_metadata).toEqual({});
	});

	it('handles valid JSON in source_metadata_json by returning parsed object', () => {
		const result = AssetFileSchema.parse({
			id: 'test-id',
			project_id: 'proj-1',
			file_path: '/tmp/test.pdf',
			original_name: 'test.pdf',
			created_at: new Date().toISOString(),
			source_metadata_json: '{"valid": "json"}'
		});

		expect(result.source_metadata).toEqual({ valid: 'json' });
	});

	it('handles undefined source_metadata_json by returning an empty object', () => {
		const result = AssetFileSchema.parse({
			id: 'test-id',
			project_id: 'proj-1',
			file_path: '/tmp/test.pdf',
			original_name: 'test.pdf',
			created_at: new Date().toISOString()
		});

		expect(result.source_metadata).toEqual({});
	});
});
