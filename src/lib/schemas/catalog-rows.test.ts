import { describe, expect, it } from 'vitest';
import { ClassificationSystemRowSchema } from './index.js';

describe('catalog row schemas', () => {
	describe('ClassificationSystemRowSchema', () => {
		const baseSystem = {
			id: 'sys-1',
			workspace_id: 'ws-1',
			name: 'CSI MasterFormat',
			code: 'CSI',
			classification_type: 'masterformat',
			is_default: 1,
			created_at: '2026-03-10T10:00:00Z'
		};

		it('parses a valid JSON array string in aliases_json', () => {
			const result = ClassificationSystemRowSchema.safeParse({
				...baseSystem,
				aliases_json: '["csi", "masterformat"]'
			});

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.aliases_json).toEqual(['csi', 'masterformat']);
		});

		it('falls back to an empty array for invalid JSON in aliases_json', () => {
			const result = ClassificationSystemRowSchema.safeParse({
				...baseSystem,
				aliases_json: 'invalid-json'
			});

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.aliases_json).toEqual([]);
		});

		it('returns the value unchanged if it is already an array', () => {
			const result = ClassificationSystemRowSchema.safeParse({
				...baseSystem,
				aliases_json: ['already', 'an', 'array']
			});

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.aliases_json).toEqual(['already', 'an', 'array']);
		});
	});
});
