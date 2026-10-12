import { z } from 'zod';
import {
	ModelEvaluateDecimalParametersSchema,
	ValidateQuantityFormulaParametersSchema
} from '$lib/services/assistant-tools/calculator.js';
import { ConvertEstimatorUnitParametersSchema } from '$lib/services/assistant-tools/units.js';
import {
	RecordsDescribeParametersSchema,
	RecordsGetParametersSchema,
	RecordsSearchParametersSchema
} from '$lib/services/assistant-tools/records.js';
import {
	RecordsProposeChangeParametersSchema,
	sourceRecordProposalToolDescription,
	sourceRecordProposalToolSchema,
	type SourceRecordProposalScope
} from '$lib/services/assistant-tools/source-record-proposals.js';

export type AssistantActionPermission = 'read_only' | 'proposal';

export type AssistantActionIntent =
	'calculation' | 'unit_conversion' | 'record_lookup' | 'record_proposal' | 'screen_inspection';

export type AssistantActionRepairPolicy =
	'none' | 'safe_coerce' | 'bounded_json_repair' | 'clarify';

export type AssistantActionDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
	name: string;
	description: string;
	permission: AssistantActionPermission;
	intent: AssistantActionIntent;
	parametersSchema: TSchema;
	parse: (value: unknown) => z.infer<TSchema>;
	jsonSchema: Record<string, unknown>;
	repairPolicy: AssistantActionRepairPolicy;
	proposalScope?: SourceRecordProposalScope;
};

/**
 * Strip non-standard JSON Schema keys that the Gemma 4 chat template
 * would render literally into the prompt. Uses a denylist so property
 * names (like "expression", "answer") are never stripped.
 * Gemma expects clean, inline schemas with only standard schema fields.
 */
/**
 * Build a lean JSON Schema for tool parameters — includes top-level
 * property names and scalar types but NOT nested objects, arrays, enums,
 * defaults, or any metadata that would bloat the prompt or confuse Gemma's
 * Jinja template (which renders unknown keys literally).
 *
 * ~150 bytes per tool, ~3KB for all 19 tools — no OOM risk.
 * The model just needs parameter NAMES + TYPES to call tools correctly.
 * Full Zod validation happens on the TypeScript side.
 */
function buildLeanToolSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	let shape: Record<string, z.ZodTypeAny> = {};

	// Extract top-level shape from Zod object (Zod v4 uses _fields,
	// .shape may be an object or function depending on Zod version)
	function getShape(s: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
		if (s instanceof z.ZodObject) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const raw = (s as any)._fields;
			if (raw && typeof raw === 'object') return raw;
			// Fallback: .shape might be a method (Zod v3 compat) or property
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const shapeVal = (s as any).shape;
			if (shapeVal) {
				if (typeof shapeVal === 'function') {
					const r = shapeVal();
					if (r && typeof r === 'object') return r;
				} else if (typeof shapeVal === 'object') {
					return shapeVal;
				}
			}
		}
		// Unwrap ZodEffects (refine/transform)
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const inner = (s as any).unwrap?.();
			if (inner && typeof inner === 'object') {
				return getShape(inner);
			}
		} catch {
			// noop — Zod type introspection may throw for non-object types
		}
		return null;
	}

	const s = getShape(schema);
	if (s) shape = s;

	function getJsonType(zodType: z.ZodTypeAny): string {
		if (zodType instanceof z.ZodString) return 'string';
		if (zodType instanceof z.ZodNumber) return 'number';
		if (zodType instanceof z.ZodBoolean) return 'boolean';
		if (zodType instanceof z.ZodArray) return 'array';
		if (zodType instanceof z.ZodObject || zodType instanceof z.ZodRecord) return 'object';
		if (zodType instanceof z.ZodEnum) return 'string';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const def = (zodType as any)._def;
		const kind = def?.typeName ?? def?.type;
		if (
			kind === 'ZodOptional' ||
			kind === 'ZodNullable' ||
			kind === 'optional' ||
			kind === 'nullable'
		) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return getJsonType((zodType as any).unwrap());
		}
		if (kind === 'ZodDefault' || kind === 'default') {
			return getJsonType(def.innerType);
		}
		// Unwrap ZodEffects (refine/transform/min), ZodPipeline (coerce), and ZodTransformer
		// to detect the underlying type. Without this, z.coerce.number() reports as "string"
		// instead of "number", depriving litert-lm's constrained decoding grammar of type info.
		if (
			kind === 'ZodEffects' ||
			kind === 'ZodPipeline' ||
			kind === 'ZodTransformer' ||
			kind === 'pipe'
		) {
			// ZodEffects stores the inner schema in _def.schema
			if (def.schema) return getJsonType(def.schema);
			// ZodPipeline stores output type in _def.out
			if (def.out) return getJsonType(def.out);
			// Fallback: try .unwrap()
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const inner = (zodType as any).unwrap?.();
				if (inner && inner !== zodType) return getJsonType(inner);
			} catch {
				// noop
			}
		}
		return 'string';
	}

	const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
	const required: string[] = [];

	for (const [key, zodType] of Object.entries(shape)) {
		const zod = zodType as z.ZodTypeAny;
		const prop: { type: string; description?: string; enum?: string[] } = {
			type: getJsonType(zod)
		};
		if (zod instanceof z.ZodEnum) {
			prop.enum = zod.options.filter((option): option is string => typeof option === 'string');
		}
		// Extract .describe() text from Zod schema for per-field guidance
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const desc = (zod as any).description;
			if (desc && typeof desc === 'string' && desc.length > 0) {
				prop.description = desc;
			}
		} catch {
			/* noop */
		}
		properties[key] = prop;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const def = (zod as any)._def;
		const typeName = def?.typeName ?? def?.type;
		const isOptional =
			typeName === 'ZodOptional' ||
			typeName === 'ZodDefault' ||
			typeName === 'optional' ||
			typeName === 'default';
		const isNullable = typeName === 'ZodNullable' || typeName === 'nullable';
		if (!isOptional && !isNullable) required.push(key);
	}

	const result: Record<string, unknown> = { type: 'object', properties };
	// Always emit `required` — even as an empty array — so the Gemma-4 Jinja chat
	// template never receives `undefined` for `params['required']`. The template's
	// `format_parameters(params['properties'], params['required'])` call passes this
	// value into a macro that does string operations on it; if it's undefined, minijinja
	// throws `invalid operation: tried to use + operator on unsupported types string and
	// undefined` at template line 194 and the entire message stream fails to start.
	result.required = required;
	return result;
}

function cleanStringQuotesDeep(val: unknown): unknown {
	if (typeof val === 'string') {
		let s = val.trim();
		let changed = true;
		while (changed) {
			changed = false;
			if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
				s = s.slice(1, -1).trim();
				changed = true;
			} else if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
				s = s.slice(1, -1).trim();
				changed = true;
			} else if (s.endsWith('"') || s.endsWith("'")) {
				s = s.slice(0, -1).trim();
				changed = true;
			} else if (s.startsWith('"') || s.startsWith("'")) {
				s = s.slice(1).trim();
				changed = true;
			}
		}
		return s;
	}
	if (Array.isArray(val)) {
		return val.map(cleanStringQuotesDeep);
	}
	if (val && typeof val === 'object') {
		const res: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val)) {
			res[k] = cleanStringQuotesDeep(v);
		}
		return res;
	}
	return val;
}

function preprocessToolArgs(schema: z.ZodTypeAny, rawValue: unknown): unknown {
	const value = cleanStringQuotesDeep(rawValue);
	if (!value || typeof value !== 'object') return value;

	function getCoreType(s: z.ZodTypeAny): z.ZodTypeAny {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const def = (s as any)._def;
		const kind = def?.typeName ?? def?.type;
		if (
			kind === 'ZodOptional' ||
			kind === 'ZodNullable' ||
			kind === 'optional' ||
			kind === 'nullable'
		) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return getCoreType((s as any).unwrap());
		}
		if (kind === 'ZodDefault' || kind === 'default') {
			return getCoreType(def.innerType);
		}
		if (kind === 'ZodEffects' || kind === 'pipe') {
			return getCoreType(def.schema ?? def.out ?? def.in);
		}
		return s;
	}

	const coreSchema = getCoreType(schema);
	let shape: Record<string, z.ZodTypeAny> = {};
	if (coreSchema instanceof z.ZodObject) {
		shape = coreSchema.shape;
	} else {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const shapeVal = (coreSchema as any).shape;
		if (shapeVal) {
			shape = typeof shapeVal === 'function' ? shapeVal() : shapeVal;
		}
	}

	const result = { ...(value as Record<string, unknown>) };

	if ('query' in shape && result.query === undefined) {
		if (result.search_term !== undefined) {
			result.query = result.search_term;
		} else if (result.term !== undefined) {
			result.query = result.term;
		}
	}

	if ('table' in shape && typeof result.table === 'string') {
		const tbl = result.table.toLowerCase().trim();
		if (tbl === 'contact' || tbl === 'contact_list') {
			result.table = 'contacts';
		} else if (tbl === 'material_catalog_item' || tbl === 'material' || tbl === 'materials') {
			result.table = 'material_catalog_items';
		} else if (
			tbl === 'labour_rate_card' ||
			tbl === 'labour_rate' ||
			tbl === 'labour_rates' ||
			tbl === 'labour'
		) {
			result.table = 'labour_rate_cards';
		} else if (
			tbl === 'equipment_rate_card' ||
			tbl === 'equipment_rate' ||
			tbl === 'equipment_rates' ||
			tbl === 'equipment'
		) {
			result.table = 'equipment_rate_cards';
		} else if (
			tbl === 'subcontract_rate_card' ||
			tbl === 'subcontract_rate' ||
			tbl === 'subcontract_rates' ||
			tbl === 'subcontract'
		) {
			result.table = 'subcontract_rate_cards';
		} else if (
			tbl === 'classification_system' ||
			tbl === 'classification' ||
			tbl === 'classifications'
		) {
			result.table = 'classification_systems';
		} else if (tbl === 'cost_code') {
			result.table = 'cost_codes';
		}
	}

	// If this schema represents a proposal item or action (has 'fields' and 'id' in its shape),
	// preprocess flat/top-level fields into the 'fields' record and ensure 'id' and 'title' exist.
	if ('fields' in shape && 'id' in shape) {
		const existingFields =
			result.fields && typeof result.fields === 'object'
				? { ...(result.fields as Record<string, unknown>) }
				: {};
		const flatFields: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(result)) {
			if (!(k in shape) || k === 'fields') {
				if (k !== 'fields') {
					flatFields[k] = v;
				}
			}
		}
		result.fields = { ...flatFields, ...existingFields };

		const fieldsObj = result.fields as Record<string, unknown>;
		if (fieldsObj) {
			if (fieldsObj.alias !== undefined && fieldsObj.aliases === undefined) {
				fieldsObj.aliases = fieldsObj.alias;
				delete fieldsObj.alias;
			}

			// Table classification self-healing: override table mapping based on clear keywords
			const isRateOrMaterialTable =
				result.table === 'material_catalog_items' ||
				result.table === 'labour_rate_cards' ||
				result.table === 'equipment_rate_cards' ||
				result.table === 'subcontract_rate_cards' ||
				result.table === 'contacts';

			if (isRateOrMaterialTable) {
				const name = String(
					fieldsObj.name || fieldsObj.contact_name || fieldsObj.display_name || result.id || ''
				).toLowerCase();
				const unit = String(fieldsObj.unit || '')
					.toLowerCase()
					.trim();

				const contactKeywords = [
					'specialists',
					'work specialists',
					'depot',
					'masonry',
					'specialist',
					'ltd',
					'pty',
					'co.',
					'inc.'
				];
				const isActuallyContact =
					result.table === 'contacts' ||
					fieldsObj.contact_name !== undefined ||
					fieldsObj.contact_email !== undefined ||
					fieldsObj.contact_phone !== undefined ||
					fieldsObj.kind === 'company' ||
					fieldsObj.kind === 'person' ||
					(result.table !== 'equipment_rate_cards' &&
						result.table !== 'labour_rate_cards' &&
						result.table !== 'subcontract_rate_cards' &&
						result.table !== 'material_catalog_items' &&
						(contactKeywords.some((kw) => name.includes(kw)) ||
							/^[cC]\d+/.test(String(result.id))));

				if (isActuallyContact) {
					result.table = 'contacts';
				}

				// Materials (physical products)
				const materialKeywords = [
					'beam',
					'mesh',
					'concrete',
					'steel',
					'timber',
					'pipe',
					'brick',
					'sheet',
					'board',
					'gravel',
					'sand',
					'reinforcement',
					'reinforcing',
					'plasterboard',
					'conduit',
					'cable',
					'pipework'
				];
				const isMaterial = materialKeywords.some((kw) => name.includes(kw));

				// Equipment (hire, plant, machinery)
				const equipmentKeywords = [
					'lift',
					'excavator',
					'crane',
					'hoist',
					'hire',
					'loader',
					'truck',
					'digger',
					'plant',
					'generator',
					'scissor',
					'bobcat',
					'dumper'
				];
				const isEquipment = equipmentKeywords.some((kw) => name.includes(kw));

				// Subcontract (quoted trade services / packages)
				const subcontractKeywords = [
					'subcontract',
					'subcontractor',
					'subbie',
					'package',
					'pumping',
					'masonry',
					'bricklayer',
					'specialists',
					'contractor',
					'supply & install',
					'supply and install',
					'preliminaries',
					'excavation'
				];
				const isSubcontract = subcontractKeywords.some((kw) => name.includes(kw));

				const hasLaborIndicator =
					name.includes('labor') ||
					name.includes('labour') ||
					name.includes('rate') ||
					name.includes('trade') ||
					name.includes('bricklayer') ||
					name.includes('carpenter') ||
					unit === 'hr' ||
					unit === 'hour' ||
					unit === 'hours';

				if (isActuallyContact) {
					result.table = 'contacts';
				} else if (isSubcontract) {
					result.table = 'subcontract_rate_cards';
				} else if (isEquipment) {
					result.table = 'equipment_rate_cards';
				} else if (isMaterial && !hasLaborIndicator) {
					result.table = 'material_catalog_items';
				} else if (result.table === 'labour_rate_cards' && name.includes('subcontract')) {
					result.table = 'subcontract_rate_cards';
				}
			}
			const isContactProposal =
				result.table === 'contacts' || fieldsObj.kind === 'company' || fieldsObj.kind === 'person';

			if (isContactProposal) {
				if (fieldsObj.contact_name !== undefined && fieldsObj.name === undefined) {
					fieldsObj.name = fieldsObj.contact_name;
				}
				if (fieldsObj.name !== undefined && fieldsObj.display_name === undefined) {
					fieldsObj.display_name = fieldsObj.name;
				} else if (fieldsObj.display_name !== undefined && fieldsObj.name === undefined) {
					fieldsObj.name = fieldsObj.display_name;
				}
			}

			if (result.table === 'classification_systems') {
				if (fieldsObj.type === undefined) {
					fieldsObj.type = 'custom';
				}
			}

			if (result.table === 'cost_codes') {
				if (
					fieldsObj.code === undefined &&
					result.id !== undefined &&
					!String(result.id).startsWith('proposed-item-')
				) {
					fieldsObj.code = result.id;
				}
				if (result.id === undefined && fieldsObj.code !== undefined) {
					result.id = fieldsObj.code;
				}
			}

			if (
				result.table === 'labour_rate_cards' ||
				result.table === 'equipment_rate_cards' ||
				result.table === 'subcontract_rate_cards' ||
				result.table === 'material_catalog_items'
			) {
				if (typeof fieldsObj.unit === 'string') {
					const norm = fieldsObj.unit.toLowerCase().trim();
					if (norm === 'flat') {
						fieldsObj.unit = 'fixed';
					} else if (norm === 'hour' || norm === 'hours') {
						fieldsObj.unit = 'hr';
					} else if (
						norm === 'meter' ||
						norm === 'meters' ||
						norm === 'metre' ||
						norm === 'metres'
					) {
						fieldsObj.unit = 'm';
					} else if (norm === 'each') {
						fieldsObj.unit = 'ea';
					}
				}
			}

			const needsName =
				result.table === 'contacts' ||
				result.table === 'material_catalog_items' ||
				result.table === 'labour_rate_cards' ||
				result.table === 'equipment_rate_cards' ||
				result.table === 'subcontract_rate_cards' ||
				result.table === 'classification_systems';

			if (needsName && fieldsObj.name === undefined && result.id !== undefined) {
				const idStr = String(result.id).trim();
				const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					idStr
				);
				const isTempId =
					idStr.startsWith('proposed-') ||
					idStr.startsWith('new_') ||
					idStr.startsWith('contact_') ||
					idStr.startsWith('material_') ||
					idStr.startsWith('labour_') ||
					idStr.startsWith('equipment_') ||
					idStr.startsWith('subcontract_');

				if (!isUuid && !isTempId) {
					// Convert slugified ID format (underscores/hyphens) to spaces
					let nameVal = idStr.replace(/[_-]+/g, ' ').trim();
					// Capitalize first letter of each word to make it a clean name
					nameVal = nameVal
						.split(' ')
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
						.join(' ');
					fieldsObj.name = nameVal;
					if (result.table === 'contacts' && fieldsObj.display_name === undefined) {
						fieldsObj.display_name = nameVal;
					}
				}
			}
		}

		if (result.id === undefined || result.id === null || String(result.id).trim().length === 0) {
			result.id = `proposed-item-${crypto.randomUUID()}`;
		}
		if (
			'title' in shape &&
			(result.title === undefined ||
				result.title === null ||
				String(result.title).trim().length === 0)
		) {
			result.title = String(
				fieldsObj.display_name ??
					fieldsObj.name ??
					fieldsObj.title ??
					fieldsObj.label ??
					'Proposed Item'
			);
		}
	}

	for (const [key, zodType] of Object.entries(shape)) {
		const val = result[key];
		if (val === undefined) continue;

		const core = getCoreType(zodType);

		if (core instanceof z.ZodNumber) {
			if (typeof val === 'string') {
				const num = Number(val);
				if (!isNaN(num)) {
					result[key] = num;
				}
			}
		} else if (core instanceof z.ZodBoolean) {
			if (typeof val === 'string') {
				if (val.toLowerCase() === 'true') {
					result[key] = true;
				} else if (val.toLowerCase() === 'false') {
					result[key] = false;
				}
			}
		} else if (core instanceof z.ZodArray) {
			let arrayValue = Array.isArray(val) ? val : null;
			if (arrayValue === null) {
				if (typeof val === 'string') {
					const trimmed = val.trim();
					if (trimmed.startsWith('[')) {
						try {
							const parsed = JSON.parse(trimmed);
							if (Array.isArray(parsed)) {
								arrayValue = parsed;
							}
						} catch {
							// Keep the original value so Zod reports the invalid argument.
						}
					}
				}
				if (arrayValue === null && val !== null && val !== undefined) {
					arrayValue = [val];
				}
			}
			if (arrayValue !== null) {
				const def = core as unknown as {
					_def?: { element?: z.ZodTypeAny; type?: z.ZodTypeAny };
					element?: z.ZodTypeAny;
				};
				const elementSchema = def._def?.element ?? def.element ?? def._def?.type;
				result[key] = elementSchema
					? arrayValue.map((item) => preprocessToolArgs(elementSchema, item))
					: arrayValue;
			}
		} else if (core instanceof z.ZodObject && typeof val === 'object' && val !== null) {
			result[key] = preprocessToolArgs(core, val);
		}
	}

	return result;
}

function createActionDefinition<TSchema extends z.ZodTypeAny>(params: {
	name: string;
	description: string;
	permission: AssistantActionPermission;
	intent: AssistantActionIntent;
	parametersSchema: TSchema;
	jsonSchema?: Record<string, unknown>;
	proposalScope?: SourceRecordProposalScope;
	repairPolicy?: AssistantActionRepairPolicy;
}): AssistantActionDefinition<TSchema> {
	return {
		...params,
		repairPolicy: params.repairPolicy ?? 'safe_coerce',
		parse: (value) =>
			params.parametersSchema.parse(preprocessToolArgs(params.parametersSchema, value)),
		jsonSchema: params.jsonSchema ?? buildLeanToolSchema(params.parametersSchema)
	};
}

export const InspectCurrentScreenParametersSchema = z.object({
	includeScreenshot: z
		.boolean()
		.default(false)
		.describe(
			'Set true only when visual screenshot evidence is required. Default false returns structured app state only.'
		)
});

function createProposalAction(name: string, scope: SourceRecordProposalScope) {
	return createActionDefinition({
		name,
		description: sourceRecordProposalToolDescription(scope),
		permission: 'proposal',
		intent: 'record_proposal',
		parametersSchema: RecordsProposeChangeParametersSchema,
		jsonSchema: sourceRecordProposalToolSchema(scope),
		proposalScope: scope
	});
}

export const assistantActionRegistry = {
	calculator_evaluate_decimal: createActionDefinition({
		name: 'calculator_evaluate_decimal',
		description:
			'Evaluate a mathematical expression and return the EXACT computed result. ' +
			'Use this tool for EVERY calculation — never compute numbers yourself. ' +
			'Accepts a single expression string with numbers, parentheses, and +, -, *, / operators. ' +
			'Returns the raw computed value and the expression that was evaluated. Use that exact value in the final answer.',
		permission: 'read_only',
		intent: 'calculation',
		parametersSchema: ModelEvaluateDecimalParametersSchema
	}),
	formula_validate_quantity: createActionDefinition({
		name: 'formula_validate_quantity',
		description:
			'Validate a quantity formula string for a given unit. Returns the computed value or validation issues. Read-only.',
		permission: 'read_only',
		intent: 'calculation',
		parametersSchema: ValidateQuantityFormulaParametersSchema
	}),
	units_convert: createActionDefinition({
		name: 'units_convert',
		description:
			'Call this tool for ANY unit conversion. Use for: "5000mm to metres", "convert sqm to m2", "acres to hectares". Takes value, from_unit, and to_unit. Returns converted value. Never convert in your head.',
		permission: 'read_only',
		intent: 'unit_conversion',
		parametersSchema: ConvertEstimatorUnitParametersSchema
	}),
	records_describe: createActionDefinition({
		name: 'records_describe',
		description:
			'Describe the available read-only business record scopes and their searchable/detail fields. Use when the correct scope or available fields are unclear.',
		permission: 'read_only',
		intent: 'record_lookup',
		parametersSchema: RecordsDescribeParametersSchema
	}),
	records_search: createActionDefinition({
		name: 'records_search',
		description:
			'Search read-only business records by text. Omit scope to search all allowed business scopes. Returns compact candidates with scope and record ID. Use records_get before relying on exact fields such as rates, units, currencies, status, or relationships.',
		permission: 'read_only',
		intent: 'record_lookup',
		parametersSchema: RecordsSearchParametersSchema
	}),
	records_get: createActionDefinition({
		name: 'records_get',
		description:
			'Get one exact read-only business record by scope and recordId. Use after records_search when exact fields such as rate, currency, unit, status, or project relationship are needed.',
		permission: 'read_only',
		intent: 'record_lookup',
		parametersSchema: RecordsGetParametersSchema
	}),
	contact_change: createProposalAction('contact_change', 'contacts'),
	material_change: createProposalAction('material_change', 'materials'),
	labour_rate_change: createProposalAction('labour_rate_change', 'labour_rates'),
	equipment_rate_change: createProposalAction('equipment_rate_change', 'equipment_rates'),
	subcontract_rate_change: createProposalAction('subcontract_rate_change', 'subcontract_rates'),
	wbs_item_change: createProposalAction('wbs_item_change', 'wbs_nodes'),
	quote_option_change: createProposalAction('quote_option_change', 'quote_options'),
	asset_change: createProposalAction('asset_change', 'assets'),
	inspect_current_screen: createActionDefinition({
		name: 'inspect_current_screen',
		description:
			'Read the current Kwantflow screen context. Use when the user asks what they are looking at, what to do on this page, what is selected, or whether the current screen has warnings. Returns structured app state by default. Set includeScreenshot true only when visible pixels are required.',
		permission: 'read_only',
		intent: 'screen_inspection',
		parametersSchema: InspectCurrentScreenParametersSchema
	})
} as const;

export type AssistantActionName = keyof typeof assistantActionRegistry;

export function getAssistantActionDefinition(name: string): AssistantActionDefinition | null {
	return (assistantActionRegistry as Record<string, AssistantActionDefinition>)[name] ?? null;
}

export function getAssistantToolDeclarations(): Array<{
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
	return Object.values(assistantActionRegistry).map((definition) => ({
		type: 'function' as const,
		function: {
			name: definition.name,
			description: definition.description,
			parameters: definition.jsonSchema
		}
	}));
}
