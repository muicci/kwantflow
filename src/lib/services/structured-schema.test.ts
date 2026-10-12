import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildStructuredToolParameters } from './structured-schema';

describe('buildStructuredToolParameters', () => {
	it('converts a valid zod object schema to a json schema', () => {
		const schema = z.object({
			name: z.string(),
			age: z.number().optional()
		});

		const result = buildStructuredToolParameters(schema);

		expect(result).toMatchObject({
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' }
			},
			required: ['name']
		});
	});

	it('works with schema containing only optional fields', () => {
		const schema = z.object({
			name: z.string().optional(),
			age: z.number().optional()
		});

		const result = buildStructuredToolParameters(schema);

		expect(result).toMatchObject({
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' }
			}
		});

		expect(result.required).toBeUndefined();
	});

	it('throws error when schema is not an object (primitive)', () => {
		const schema = z.string();
		expect(() => buildStructuredToolParameters(schema)).toThrow(
			'Structured tool schema must be a non-empty object.'
		);
	});

	it('throws error when schema is an empty object', () => {
		const schema = z.object({});
		expect(() => buildStructuredToolParameters(schema)).toThrow(
			'Structured tool schema must be a non-empty object.'
		);
	});

	it('throws error when schema is an array', () => {
		const schema = z.array(z.string());
		expect(() => buildStructuredToolParameters(schema)).toThrow(
			'Structured tool schema must be a non-empty object.'
		);
	});
});
