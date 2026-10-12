import { z } from 'zod';

export function buildStructuredToolParameters(schema: z.ZodType): Record<string, unknown> {
	const jsonSchema = z.toJSONSchema(schema, {
		target: 'draft-07',
		reused: 'inline',
		unrepresentable: 'any'
	}) as Record<string, unknown>;
	const properties = jsonSchema.properties;
	// `required` is absent when all fields are optional — that is valid JSON Schema.
	// Only reject schemas that are not objects or have no properties at all.
	if (
		jsonSchema.type !== 'object' ||
		!properties ||
		typeof properties !== 'object' ||
		Array.isArray(properties) ||
		Object.keys(properties).length === 0
	) {
		throw new Error('Structured tool schema must be a non-empty object.');
	}
	return jsonSchema;
}
