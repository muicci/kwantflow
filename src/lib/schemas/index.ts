// Companion schema sync for clean workspace schema version 2.
import { z } from 'zod';
import {
	EQUIPMENT_RATE_UNIT_CODES,
	LABOUR_RATE_UNIT_CODES,
	MATERIAL_UNIT_CODES,
	PriorityLevel,
	ProjectStatus,
	SUBCONTRACT_RATE_UNIT_CODES,
	SUPPORTED_CURRENCY_CODES,
	SUPPORTED_DATE_FORMATS,
	SUPPORTED_LANGUAGE_LOCALES,
	SUPPORTED_NUMBER_LOCALES,
	SUPPORTED_UNIT_CODES,
	normaliseEquipmentRateUnitCode,
	normaliseLabourRateUnitCode,
	normaliseMaterialUnitCode,
	normaliseSubcontractRateUnitCode,
	normaliseUnitCode
} from '../constants/index.js';
import { GENERIC_PHONE_PATTERN, RequiredEmailValueSchema } from '$lib/services/input-validation.js';
import { normaliseEstimateTemplatePayloadLike } from '$lib/utils/estimate-template-normalisation.js';

export const RFQ_SOURCE_CHANNELS = ['manual', 'folder_upload', 'hosted_form', 'email'] as const;

/**
 * Runtime schema validation for data crossing the SQL ↔ TypeScript boundary.
 * These schemas catch shape mismatches that TypeScript types cannot catch at runtime
 * (e.g. missing columns after migrations, wrong enum strings from SQLite).
 */

export const ProjectSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	is_favourite: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	quote_round_prices: z
		.preprocess(
			(val) =>
				val === undefined || val === null || val === '' ? false : val === 1 || val === true,
			z.boolean()
		)
		.optional(),
	rfq_number: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
	contact_id: z.string().optional().nullable(),
	contact_name_snapshot: z.string().optional().nullable(),
	contact_name: z.string().optional().nullable(),
	requester_contact_id: z.string().optional().nullable(),
	requester_name_snapshot: z.string().optional().nullable(),
	requester_contact_name: z.string().optional().nullable(),
	quote_recipient_contact_id: z.string().optional().nullable(),
	project_name: z.string().optional().nullable(),
	due_date: z.string().optional().nullable(),
	received_date: z.string().optional().nullable(),
	submission_deadline_at: z.string().optional().nullable(),
	estimator_name: z.string().optional().default(''),
	customer_tender_reference: z.string().optional().default(''),
	addendum_label: z.string().optional().default(''),
	addendum_date: z.string().optional().nullable(),
	addendum_notes: z.string().optional().default(''),
	site_address: z.string().optional().default(''),
	delivery_address: z.string().optional().default(''),
	source_channel: z.enum(RFQ_SOURCE_CHANNELS).optional(),
	source_reference: z.string().optional().nullable(),
	source_email_message_id: z.string().optional().nullable(),
	source_email_integration_id: z.string().optional().nullable(),
	priority: z.nativeEnum(PriorityLevel),
	status: z.nativeEnum(ProjectStatus),
	content: z.string().optional().nullable(),
	note: z.string().optional().nullable(),
	asset_count: z
		.preprocess((val) => Number(val), z.number())
		.optional()
		.nullable()
});

export const ProjectArraySchema = z.array(ProjectSchema);

export const AssetFileSchema = z
	.object({
		id: z.string(),
		project_id: z.string(),
		asset_id: z.string().optional().nullable(),
		file_path: z.string(),
		original_name: z.string(),
		mime_type: z.string().optional().nullable(),
		byte_size: z
			.preprocess((val) => (val == null || val === '' ? 0 : Number(val)), z.number().int().min(0))
			.optional(),
		content_hash: z.string().optional().nullable(),
		checksum_algorithm: z.string().optional().default('sha256'),
		document_type: z.string().optional().default(''),
		revision_label: z.string().optional().default(''),
		received_at: z.string().optional().nullable(),
		source_label: z.string().optional().default(''),
		source_metadata_json: z
			.preprocess(
				(value) => {
					if (typeof value !== 'string') return value ?? {};
					try {
						return JSON.parse(value);
					} catch {
						return {};
					}
				},
				z.record(z.string(), z.unknown())
			)
			.optional(),
		created_at: z.string()
	})
	.transform(({ source_metadata_json, ...file }) => ({
		...file,
		source_metadata: source_metadata_json ?? {}
	}));

export const AssetFileArraySchema = z.array(AssetFileSchema);

export const AssetSchema = z.object({
	id: z.string(),
	project_id: z.string(),
	display_name: z.string(),
	thumbnail_file_id: z.string().nullable(),
	is_selected: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	quote_quantity: z
		.preprocess(
			(val) => (val === undefined || val === null || val === '' ? 1 : Number(val)),
			z.number().int().min(1)
		)
		.optional(),
	is_pdf_included: z
		.preprocess(
			(val) => (val === undefined || val === null || val === '' ? true : val === 1 || val === true),
			z.boolean()
		)
		.optional(),
	created_at: z.string(),
	files: z.array(AssetFileSchema).optional()
});

export const AssetArraySchema = z.array(AssetSchema);

export const EstimateRowSchema = z.object({
	asset_id: z.string(),
	scope_summary: z.string(),
	notes: z.string(),
	classification_system_id: z.string().nullable(),
	wbs_root_node_id: z.string().nullable(),
	applied_template_id: z.string().nullable(),
	applied_template_name: z.string().nullable(),
	currency_code: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});

export const EstimateSummarySchema = z.object({
	asset_id: z.string(),
	has_quote_content: z.preprocess((val) => val === 1 || val === true, z.boolean())
});

export const ClassificationSystemRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	name: z.string(),
	code: z.string(),
	classification_type: z.enum(['masterformat', 'uniformat', 'xactimate', 'custom']),
	aliases_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(z.string())),
	is_default: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string()
});

export const CostCodeRowSchema = z.object({
	id: z.string(),
	classification_system_id: z.string(),
	parent_id: z.string().nullable(),
	code: z.string(),
	name: z.string(),
	description: z.string(),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	sort_order: z.number(),
	created_at: z.string()
});

export const WbsNodeRowSchema = z.object({
	id: z.string(),
	project_id: z.string(),
	parent_id: z.string().nullable(),
	code: z.string().nullable(),
	name: z.string(),
	type: z.enum(['phase', 'level', 'zone', 'room', 'trade', 'custom']),
	sort_order: z.number(),
	created_at: z.string()
});

const JsonObjectSchema = z.record(z.string(), z.unknown());
const CurrencyCodeSchema = z.enum(SUPPORTED_CURRENCY_CODES);
const UnitCodeSchema = z.enum(SUPPORTED_UNIT_CODES);
const LabourRateUnitCodeSchema = z.enum(LABOUR_RATE_UNIT_CODES);
const EquipmentRateUnitCodeSchema = z.enum(EQUIPMENT_RATE_UNIT_CODES);
const MaterialUnitCodeSchema = z.enum(MATERIAL_UNIT_CODES);
const SubcontractRateUnitCodeSchema = z.enum(SUBCONTRACT_RATE_UNIT_CODES);
export const NormalisedUnitCodeSchema = z.preprocess(
	(value) => normaliseUnitCode(value) ?? value,
	UnitCodeSchema
);
const CountryCodeSchema = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z]{2}$/, 'Select a valid country');
const ContactKindSchema = z.enum(['company', 'person']);
const ContactRoleSchema = z.enum([
	'customer',
	'subcontractor',
	'supplier',
	'vendor',
	'manufacturer'
]);
const OptionalEmailSchema = z.union([z.literal(''), RequiredEmailValueSchema]);
const GenericPhoneSchema = z
	.string()
	.trim()
	.regex(GENERIC_PHONE_PATTERN, 'Enter a valid phone number')
	.optional()
	.or(z.literal(''));
const OnboardingOperatorRoleSchema = z.enum([
	'owner_founder',
	'director_manager',
	'estimator',
	'project_manager',
	'operations_admin',
	'other'
]);
export const JsonStringSchema = z.preprocess((value) => {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}, JsonObjectSchema);

export const TakeoffItemRowSchema = z.object({
	id: z.string(),
	estimate_asset_id: z.string(),
	parent_id: z.string().nullable(),
	wbs_node_id: z.string().nullable(),
	cost_code_id: z.string().nullable(),
	applied_preset_id: z.string().nullable(),
	applied_preset_name: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	quantity: z.number(),
	unit: NormalisedUnitCodeSchema,
	properties_json: JsonStringSchema,
	sort_order: z.number(),
	created_at: z.string(),
	updated_at: z.string()
});

export const CostComponentRowSchema = z.object({
	id: z.string(),
	takeoff_item_id: z.string(),
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	source_type: z.enum([
		'manual',
		'material_catalog',
		'labour_rate_card',
		'equipment_rate_card',
		'subcontract_rate_card'
	]),
	source_id: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	quantity: z.number(),
	unit: NormalisedUnitCodeSchema,
	unit_rate: z.number(),
	source_unit_rate_decimal: z.string().nullable(),
	source_currency_code: z.string().nullable(),
	fx_rate_snapshot_id: z.string().nullable(),
	formula_json: JsonStringSchema,
	metadata_json: JsonStringSchema,
	sort_order: z.number(),
	created_at: z.string(),
	updated_at: z.string()
});

export const MaterialCatalogueItemRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	category: z.string().nullable(),
	specification: z.string().nullable(),
	unit: z.preprocess((value) => normaliseMaterialUnitCode(value) ?? value, MaterialUnitCodeSchema),
	default_rate: z.number(),
	currency_code: CurrencyCodeSchema.nullable(),
	aliases_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(z.string())),
	metadata_json: JsonStringSchema,
	effective_date: z.string().nullable().optional(),
	verified_date: z.string().nullable().optional(),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().default(''),
	availability: z.string().default(''),
	reference: z.string().default(''),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const LabourRateCardRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	category: z.string().nullable(),
	work_center: z.string().nullable(),
	unit: z.preprocess(
		(value) => normaliseLabourRateUnitCode(value) ?? value,
		LabourRateUnitCodeSchema
	),
	default_rate: z.number(),
	currency_code: CurrencyCodeSchema.nullable(),
	aliases_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(z.string())),
	metadata_json: JsonStringSchema,
	effective_date: z.string().nullable().optional(),
	verified_date: z.string().nullable().optional(),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().default(''),
	availability: z.string().default(''),
	reference: z.string().default(''),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const EquipmentRateCardRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	category: z.string().nullable(),
	work_center: z.string().nullable(),
	unit: z.preprocess(
		(value) => normaliseEquipmentRateUnitCode(value) ?? value,
		EquipmentRateUnitCodeSchema
	),
	default_rate: z.number(),
	currency_code: CurrencyCodeSchema.nullable(),
	aliases_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(z.string())),
	metadata_json: JsonStringSchema,
	effective_date: z.string().nullable().optional(),
	verified_date: z.string().nullable().optional(),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().default(''),
	availability: z.string().default(''),
	reference: z.string().default(''),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const SubcontractRateCardRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	category: z.string().nullable(),
	unit: z.preprocess(
		(value) => normaliseSubcontractRateUnitCode(value) ?? value,
		SubcontractRateUnitCodeSchema
	),
	default_rate: z.number(),
	currency_code: CurrencyCodeSchema.nullable(),
	aliases_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(z.string())),
	metadata_json: JsonStringSchema,
	effective_date: z.string().nullable().optional(),
	verified_date: z.string().nullable().optional(),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().default(''),
	availability: z.string().default(''),
	reference: z.string().default(''),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const CostComponentPresetComponentSchema = z.object({
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	source_type: z.enum([
		'manual',
		'material_catalog',
		'labour_rate_card',
		'equipment_rate_card',
		'subcontract_rate_card'
	]),
	source_id: z.string().nullable().optional(),
	name: z.string(),
	description: z.string(),
	quantity: z.number(),
	unit: NormalisedUnitCodeSchema,
	unit_rate: z.number(),
	formula: JsonObjectSchema,
	metadata: JsonObjectSchema,
	sort_order: z.number().int().min(0)
});

export const CostComponentPresetRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	aliases_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(z.string())),
	components_json: z.preprocess((value) => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return [];
		}
	}, z.array(CostComponentPresetComponentSchema)),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

const EstimateTemplateCostComponentSchema = z.object({
	id: z.string(),
	takeoff_item_id: z.string(),
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	source_type: z.enum([
		'manual',
		'material_catalog',
		'labour_rate_card',
		'equipment_rate_card',
		'subcontract_rate_card'
	]),
	source_id: z.string().nullable().optional(),
	name: z.string(),
	description: z.string(),
	quantity: z.number(),
	unit: NormalisedUnitCodeSchema,
	unit_rate: z.number(),
	formula: JsonObjectSchema,
	metadata: JsonObjectSchema,
	sort_order: z.number().int().min(0)
});

const EstimateTemplateTakeoffItemSchema = z.object({
	id: z.string(),
	estimate_asset_id: z.string(),
	parent_id: z.string().nullable().optional(),
	wbs_node_id: z.string().nullable().optional(),
	cost_code_id: z.string().nullable().optional(),
	applied_preset_id: z.string().nullable().optional(),
	applied_preset_name: z.string().nullable().optional(),
	name: z.string(),
	description: z.string(),
	quantity: z.number(),
	unit: NormalisedUnitCodeSchema,
	properties: JsonObjectSchema,
	sort_order: z.number(),
	cost_components: z.array(EstimateTemplateCostComponentSchema)
});

export const EstimateTemplatePayloadSchema = z.object({
	scope_summary: z.string().default(''),
	notes: z.string().default(''),
	classification_system_id: z.string().nullable().optional(),
	wbs_root_node_id: z.string().nullable().optional(),
	takeoff_items: z.array(EstimateTemplateTakeoffItemSchema)
});

export const EstimateTemplateRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	aliases_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(z.string())),
	estimate_json: z.preprocess((value) => {
		let parsed = value;
		if (typeof value === 'string') {
			try {
				parsed = JSON.parse(value);
			} catch {
				parsed = {};
			}
		}
		return normaliseEstimateTemplatePayloadLike(parsed);
	}, EstimateTemplatePayloadSchema),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const ProjectStructureTemplateNodeRowSchema = z.object({
	id: z.string(),
	template_id: z.string(),
	parent_id: z.string().nullable(),
	code: z.string().nullable(),
	name: z.string(),
	type: z.enum(['phase', 'level', 'zone', 'room', 'trade', 'custom']),
	sort_order: z.number(),
	created_at: z.string()
});

export const ProjectStructureTemplateRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	code: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const QuoteOptionRowSchema = z.object({
	id: z.string(),
	project_id: z.string(),
	label: z.string(),
	lead_time: z.string(),
	markup_percentage: z.preprocess(Number, z.number().min(-100)),
	material_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	labour_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	equipment_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	subcontract_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	notes: z.string(),
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	is_default: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});

export const QuoteOptionPresetRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	label: z.string(),
	lead_time: z.string(),
	markup_percentage: z.preprocess(Number, z.number().min(-100)),
	material_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	labour_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	equipment_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	subcontract_markup_percentage: z.preprocess(Number, z.number().min(-100).nullable()),
	notes: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const QuoteRevisionLineItemSchema = z.object({
	file_name: z.string(),
	description: z.string(),
	quantity: z.preprocess(Number, z.number()),
	lead_time: z.string(),
	unit_price: z.preprocess(Number, z.number()),
	line_total: z.preprocess(Number, z.number())
});

export const QuotePackageAttachmentOutcomeSchema = z.object({
	file_id: z.string().nullable().optional(),
	file_name: z.string(),
	status: z.enum(['appended', 'omitted']),
	reason: z.string().nullable().optional()
});

export const QuoteRevisionOptionRowSchema = z.object({
	id: z.string(),
	revision_id: z.string(),
	source_quote_option_id: z.string().nullable(),
	label: z.string(),
	lead_time: z.string(),
	markup_percentage: z.preprocess(Number, z.number().min(-100)),
	notes: z.string(),
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	is_default: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	is_selected: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	line_items_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(QuoteRevisionLineItemSchema)),
	subtotal_amount: z.preprocess(Number, z.number()),
	gst_amount: z.preprocess(Number, z.number()),
	total_amount: z.preprocess(Number, z.number()),
	created_at: z.string(),
	updated_at: z.string()
});

export const QuoteRevisionRowSchema = z.object({
	id: z.string(),
	project_id: z.string(),
	revision_number: z.preprocess(Number, z.number().int().min(1)),
	revision_label: z.string(),
	rfq_number_snapshot: z.string(),
	quote_number_snapshot: z.string().optional().default(''),
	revision_reason: z.string().optional().default(''),
	contact_name_snapshot: z.string().nullable(),
	contact_country_code_snapshot: z.string().nullable(),
	contact_business_id_label_snapshot: z.string().nullable(),
	contact_business_id_value_snapshot: z.string().nullable(),
	contact_tax_id_label_snapshot: z.string().nullable(),
	contact_tax_id_value_snapshot: z.string().nullable(),
	project_name_snapshot: z.string().nullable(),
	business_name_snapshot: z.string(),
	business_abn_snapshot: z.string().nullable(),
	business_id_label_snapshot: z.string().nullable(),
	business_id_value_snapshot: z.string().nullable(),
	tax_id_label_snapshot: z.string().nullable(),
	tax_id_value_snapshot: z.string().nullable(),
	tax_display_label_snapshot: z.string().nullable(),
	tax_rate_percentage_snapshot: z.preprocess(
		(value) => (value == null || value === '' ? null : Number(value)),
		z.number().nullable()
	),
	business_address_snapshot: z.string().nullable(),
	business_email_snapshot: z.string().nullable(),
	business_contact_name_snapshot: z.string().nullable(),
	business_contact_phone_snapshot: z.string().nullable(),
	currency_code_snapshot: z.string(),
	currency_symbol_snapshot: z.string(),
	issued_date: z.string(),
	valid_until_date: z.string(),
	sent_status: z.enum(['exported', 'sent']).default('exported'),
	sent_date: z.string().nullable().optional(),
	sent_method: z.string().default('download'),
	recipient_snapshot_json: z.preprocess(
		(value) => {
			if (typeof value === 'string') {
				try {
					return JSON.parse(value);
				} catch {
					return {};
				}
			}
			return value ?? {};
		},
		z.record(z.string(), z.unknown())
	),
	terms_snapshot_json: z.preprocess(
		(value) => {
			if (typeof value === 'string') {
				try {
					return JSON.parse(value);
				} catch {
					return {};
				}
			}
			return value ?? {};
		},
		z.record(z.string(), z.unknown())
	),
	package_attachments_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(QuotePackageAttachmentOutcomeSchema)),
	created_at: z.string(),
	updated_at: z.string()
});

export const AiIssueSchema = z.object({
	code: z.string(),
	message: z.string(),
	severity: z.enum(['info', 'warning', 'error']),
	fileId: z.string().nullable().optional(),
	fileName: z.string().nullable().optional()
});

function normaliseAiIssueEntries(value: unknown): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	return value.map((entry, index) => {
		if (typeof entry === 'string') {
			return {
				code: 'local_model_issue',
				message: entry.trim(),
				severity: 'warning'
			};
		}

		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return {
				code: 'local_model_issue',
				message: `Kwantflow AI returned an unsupported issue entry at position ${index + 1}.`,
				severity: 'warning'
			};
		}

		const issue = entry as Record<string, unknown>;
		const message =
			typeof issue.message === 'string'
				? issue.message
				: typeof issue.detail === 'string'
					? issue.detail
					: typeof issue.summary === 'string'
						? issue.summary
						: `Kwantflow AI flagged a review item at position ${index + 1}.`;
		const code =
			typeof issue.code === 'string'
				? issue.code
				: typeof issue.kind === 'string'
					? issue.kind
					: 'local_model_issue';
		const severity = issue.severity;

		return {
			code,
			message,
			severity:
				severity === 'info' || severity === 'warning' || severity === 'error'
					? severity
					: 'warning',
			fileId:
				typeof issue.fileId === 'string'
					? issue.fileId
					: typeof issue.file_id === 'string'
						? issue.file_id
						: null,
			fileName:
				typeof issue.fileName === 'string'
					? issue.fileName
					: typeof issue.file_name === 'string'
						? issue.file_name
						: null
		};
	});
}

const AiIssueArraySchema = z
	.preprocess(normaliseAiIssueEntries, z.array(AiIssueSchema))
	.default([]);

export const AiEvidenceRefSchema = z.object({
	file_id: z.string().nullable(),
	file_name: z.string(),
	artifact_kind: z.enum(['text', 'pdf', 'image', 'cad']).nullable().optional(),
	page_number: z.preprocess(
		(value) => (value == null || value === '' ? null : Number(value)),
		z.number().int().positive().nullable().optional()
	),
	view_label: z.string().nullable().optional(),
	evidence_identifier: z.string().optional(),
	locator: JsonObjectSchema.optional(),
	draft_entity_kind: z.string().optional(),
	draft_entity_key: z.string().optional(),
	confidence: JsonObjectSchema.optional(),
	quote_path: z.string(),
	summary: z.string()
});

export const AiConfidenceSchema = z.object({
	overall: z.preprocess(Number, z.number().min(0).max(1)),
	extraction: z.preprocess(Number, z.number().min(0).max(1)),
	mapping: z.preprocess(Number, z.number().min(0).max(1)),
	quantity: z.preprocess(Number, z.number().min(0).max(1))
});

export const AiDraftCostComponentSchema = z.object({
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	source_type: z.enum([
		'manual',
		'material_catalog',
		'labour_rate_card',
		'equipment_rate_card',
		'subcontract_rate_card'
	]),
	source_id: z.string().nullable().optional(),
	name: z.string(),
	description: z.string(),
	quantity: z.preprocess(Number, z.number().min(0)),
	unit: NormalisedUnitCodeSchema,
	unit_rate: z.preprocess(Number, z.number().min(0)),
	formula: JsonObjectSchema,
	metadata: JsonObjectSchema,
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	evidence_refs: z.array(AiEvidenceRefSchema).default([]),
	confidence: AiConfidenceSchema,
	mapping_status: z.enum(['auto_linked', 'matched', 'manual', 'unresolved']).default('unresolved')
});

export const AiDraftTakeoffItemSchema = z.object({
	name: z.string(),
	description: z.string(),
	quantity: z.preprocess(Number, z.number().min(0)),
	unit: NormalisedUnitCodeSchema,
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	cost_code_id: z.string().nullable().optional(),
	wbs_node_id: z.string().nullable().optional(),
	applied_preset_id: z.string().nullable().optional(),
	applied_preset_name: z.string().nullable().optional(),
	properties: JsonObjectSchema,
	cost_components: z.array(AiDraftCostComponentSchema),
	evidence_refs: z.array(AiEvidenceRefSchema).default([]),
	confidence: AiConfidenceSchema,
	open_questions: z.array(z.string()).default([])
});

export const AiDraftEstimateSchema = z.object({
	scopeSummary: z.string(),
	notes: z.string().default(''),
	classificationSystemId: z.string().nullable().optional(),
	wbsRootNodeId: z.string().nullable().optional(),
	appliedTemplateId: z.string().nullable().optional(),
	appliedTemplateName: z.string().nullable().optional(),
	takeoffItems: z.array(AiDraftTakeoffItemSchema),
	issues: AiIssueArraySchema
});

export const AiRunRowSchema = z.object({
	id: z.string(),
	asset_id: z.string(),
	provider: z.enum(['local_litert_lm']),
	model_id: z.string(),
	status: z.preprocess(
		(value) => (value === 'consolidating' ? 'drafting' : value),
		z.enum([
			'queued',
			'preprocessing',
			'extracting',
			'drafting',
			'drafted',
			'applied',
			'failed',
			'cancelled'
		])
	),
	trigger_source: z.enum(['settings_validation', 'asset_editor']),
	started_at: z.string(),
	completed_at: z.string().nullable(),
	failed_at: z.string().nullable(),
	cancelled_at: z.string().nullable(),
	error_message: z.string().nullable(),
	prompt_contract_version: z.string().optional().default(''),
	context_fingerprint: z.string().optional().default(''),
	failure_kind: z.string().optional().default(''),
	failure_stage: z.string().optional().default(''),
	usage_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value;
	}, JsonObjectSchema),
	created_at: z.string(),
	updated_at: z.string()
});

export const AiRunProgressDetailSchema = z.object({
	currentArtifactName: z.string().nullable(),
	processedArtifactCount: z.number().int().min(0),
	usableArtifactCount: z.number().int().min(0).optional(),
	artifactIssueCount: z.number().int().min(0).optional(),
	totalArtifactCount: z.number().int().min(0),
	supportedArtifactCount: z.number().int().min(0),
	unsupportedArtifactCount: z.number().int().min(0),
	draftSubphase: z.enum(['outline', 'matching', 'composition', 'validation']).nullable().optional()
});

export const LocalAiDownloadProgressSchema = z.object({
	stage: z.enum([
		'queued',
		'downloading_model',
		'downloading_mirror',
		'downloading_support_files',
		'verifying',
		'complete'
	]),
	label: z.string().trim().min(1),
	downloadedBytes: z.number().int().min(0),
	totalBytes: z.number().int().min(0).nullable(),
	percent: z.number().min(0).max(100).nullable()
});

const LocalAiDiagnosticErrorClassSchema = z
	.enum(['startup', 'request', 'timeout', 'response_parse', 'unknown'])
	.nullable();

export const LocalAiCapabilityProbeDiagnosticsSchema = z.object({
	supportsConstrainedToolCalls: z.boolean().default(false),
	supportsNativeToolCalls: z.boolean().default(false),
	supportsReasoningSeparation: z.boolean().default(false),
	supportsVisionInputs: z.boolean().default(false),
	supportsPersistentConversation: z.boolean().default(false),
	supportsPersistentConversationWithVision: z.boolean().default(false),
	checkedElapsedMs: z.number().int().min(0).nullable().default(null),
	source: z.enum(['unverified', 'native_probe', 'unknown']).default('unknown')
});

export const LocalAiDiagnosticsSchema = z.object({
	activeLaunchProfile: z.enum(['gpu_preferred', 'cpu_only', 'not_started', 'unknown']),
	startupElapsedMs: z.number().int().min(0).nullable(),
	imageProbeElapsedMs: z.number().int().min(0).nullable(),
	lastCompletionElapsedMs: z.number().int().min(0).nullable(),
	lastFailureClass: LocalAiDiagnosticErrorClassSchema,
	lastTimeoutStage: z.enum(['startup', 'completion', 'image_probe']).nullable(),
	gpuAcceleration: z.enum(['gpu_preferred', 'cpu_only', 'gpu_active', 'cpu_fallback', 'unknown']),
	contextSizeTokens: z.number().int().min(0).nullable().default(null),
	activeStreamCount: z.number().int().min(0).default(0),
	capabilityProbe: LocalAiCapabilityProbeDiagnosticsSchema.default({
		supportsConstrainedToolCalls: false,
		supportsNativeToolCalls: false,
		supportsReasoningSeparation: false,
		supportsVisionInputs: false,
		supportsPersistentConversation: false,
		supportsPersistentConversationWithVision: false,
		checkedElapsedMs: null,
		source: 'unknown'
	})
});

export const LocalAiStatusSchema = z.object({
	expectedDownloadBytes: z.number().int().positive(),
	runtimeKind: z.enum(['litert_lm']),
	runtimeVersion: z.string().trim().min(1),
	modelRepoId: z.string().trim().min(1),
	modelArtifactId: z.string().trim().min(1),
	modelFileName: z.string().trim().min(1),
	mmprojFileName: z.string().trim().min(1).nullable(),
	installState: z.enum([
		'not_downloaded',
		'downloading',
		'verifying',
		'installed',
		'loading',
		'ready',
		'failed',
		'repair_needed',
		'unsupported'
	]),
	runtimeAvailable: z.boolean(),
	modelReady: z.boolean(),
	supportsImageInputs: z.boolean(),
	supportsNativeToolCalls: z.boolean().default(false),
	activeDownload: LocalAiDownloadProgressSchema.nullable(),
	lastError: z.string().nullable(),
	diagnostics: LocalAiDiagnosticsSchema.default({
		activeLaunchProfile: 'unknown',
		startupElapsedMs: null,
		imageProbeElapsedMs: null,
		lastCompletionElapsedMs: null,
		lastFailureClass: null,
		lastTimeoutStage: null,
		gpuAcceleration: 'unknown',
		contextSizeTokens: null,
		activeStreamCount: 0,
		capabilityProbe: {
			supportsConstrainedToolCalls: false,
			supportsNativeToolCalls: false,
			supportsReasoningSeparation: false,
			supportsVisionInputs: false,
			supportsPersistentConversation: false,
			supportsPersistentConversationWithVision: false,
			checkedElapsedMs: null,
			source: 'unknown'
		}
	})
});

export const AiRfqBriefSchema = z.object({
	scopeSummary: z.string().nullable(),
	constraints: z.string().nullable(),
	materialsAndSpecs: z.string().nullable(),
	quantitiesAndUnits: z.string().nullable(),
	referencedDocuments: z.string().nullable(),
	exclusions: z.string().nullable(),
	cleanedSourceText: z.string().nullable()
});

const AiDraftRunUsageSchema = z.object({
	promptTokenCount: z.number().int().min(0).optional(),
	candidatesTokenCount: z.number().int().min(0).optional(),
	thoughtsTokenCount: z.number().int().min(0).optional(),
	totalTokenCount: z.number().int().min(0).optional(),
	cachedContentTokenCount: z.number().int().min(0).optional(),
	preflightTokenEstimate: z.number().int().min(0).optional()
});

const AiDraftStageTimingDiagnosticsSchema = z.object({
	promptTokenCount: z.number().int().min(0).optional(),
	predictedTokenCount: z.number().int().min(0).optional(),
	cacheTokenCount: z.number().int().min(0).optional(),
	promptMs: z.number().min(0).nullable().default(null),
	predictedMs: z.number().min(0).nullable().default(null),
	promptPerSecond: z.number().min(0).nullable().default(null),
	predictedPerSecond: z.number().min(0).nullable().default(null)
});

const AiDraftStageMetricSchema = z.object({
	stage: z.enum(['outline', 'matching', 'composition', 'validation']),
	elapsedMs: z.number().int().min(0),
	timeoutMs: z.number().int().min(0),
	attemptCount: z.number().int().min(1),
	status: z.enum(['completed', 'failed', 'cancelled']),
	modelId: z.string().trim().min(1),
	usage: AiDraftRunUsageSchema.optional(),
	timings: AiDraftStageTimingDiagnosticsSchema.optional()
});

const AiDraftRunPromptContractSchema = z.object({
	systemInstructionVersion: z.string().trim().min(1),
	extractionPromptVersion: z.string().trim().min(1),
	draftPromptVersion: z.string().trim().min(1)
});

const AiDraftRunCacheMetadataSchema = z.object({
	strategy: z.literal('telemetry'),
	normalizedTableSnapshotFingerprint: z.string().trim().min(1),
	estimateContextSnapshotFingerprint: z.string().trim().min(1),
	referenceContextFingerprint: z.string().trim().min(1).optional(),
	extractionContextFingerprint: z.string().trim().min(1),
	draftContextFingerprint: z.string().trim().min(1).nullable(),
	cachedContentTokenCount: z.number().int().min(0).optional()
});

const AiDraftEvidenceArtifactSchema = z.object({
	fileId: z.string().trim().min(1),
	fileName: z.string().trim().min(1),
	artifactKind: z.enum(['text', 'pdf', 'image', 'cad']).optional(),
	sourceFormat: z
		.enum(['plain_text', 'markdown', 'json', 'xml', 'csv', 'docx', 'xlsx'])
		.nullable()
		.optional(),
	structureHints: z
		.object({
			rowCount: z.number().int().min(0).nullable().optional(),
			columnCount: z.number().int().min(0).nullable().optional(),
			sheetCount: z.number().int().min(0).nullable().optional(),
			formulaCount: z.number().int().min(0).nullable().optional(),
			headingCount: z.number().int().min(0).nullable().optional(),
			tableCount: z.number().int().min(0).nullable().optional(),
			embeddedImageCount: z.number().int().min(0).nullable().optional()
		})
		.nullable()
		.optional(),
	evidenceIdentifiers: z.array(z.string().trim().min(1)).default([])
});

const LocalDraftRunRuntimeMetadataSchema = z.object({
	runtimeKind: z.enum(['litert_lm']),
	runtimeVersion: z.string().trim().min(1),
	modelRepoId: z.string().trim().min(1),
	modelArtifactId: z.string().trim().min(1),
	modelFileName: z.string().trim().min(1),
	mmprojFileName: z.string().trim().min(1).nullable(),
	supportsImageInputs: z.boolean(),
	diagnostics: LocalAiDiagnosticsSchema.optional()
});

const AiDraftRuntimeExecutionContextSchema = z.object({
	runtimeContractVersion: z.string().trim().min(1),
	kernelContractVersion: z.string().trim().min(1),
	localRuntime: LocalDraftRunRuntimeMetadataSchema,
	evidenceArtifacts: z.array(AiDraftEvidenceArtifactSchema),
	draftStageMetrics: z.array(AiDraftStageMetricSchema).default([]),
	activeDraftSubphase: z
		.enum(['outline', 'matching', 'composition', 'validation'])
		.nullable()
		.optional()
});

const AiDraftOutlineCostComponentSchema = z.object({
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	name: z.string(),
	description: z.string(),
	quantity: z.number().min(0),
	unit: z.string().trim().min(1),
	rate_hint: z.number().nullable().optional(),
	sort_order: z.number().int().min(0),
	evidence_refs: z.array(AiEvidenceRefSchema).default([]),
	confidence: AiConfidenceSchema
});

const AiDraftOutlineTakeoffItemSchema = z.object({
	name: z.string(),
	description: z.string(),
	quantity: z.number().min(0),
	unit: z.string().trim().min(1),
	sort_order: z.number().int().min(0),
	cost_components: z.array(AiDraftOutlineCostComponentSchema),
	evidence_refs: z.array(AiEvidenceRefSchema).default([]),
	confidence: AiConfidenceSchema,
	open_questions: z.array(z.string()).default([]),
	reasoning: z.string().optional()
});

export const AiDraftOutlineSchema = z.object({
	scope_summary: z.string(),
	notes: z.string().default(''),
	classification_system_id: z.string().nullable().optional(),
	wbs_root_node_id: z.string().nullable().optional(),
	takeoff_items: z.array(AiDraftOutlineTakeoffItemSchema),
	issues: AiIssueArraySchema
});

const AiDraftMatchingCostComponentSchema = z.object({
	category: z.enum(['material', 'labour', 'equipment', 'subcontract', 'misc']),
	sort_order: z.number().int().min(0).optional().default(0),
	source_type: z
		.enum([
			'manual',
			'material_catalog',
			'labour_rate_card',
			'equipment_rate_card',
			'subcontract_rate_card'
		])
		.optional()
		.default('manual'),
	source_id: z.string().nullable().optional(),
	source_name: z.string().nullable().optional(),
	mapping_status: z
		.enum(['auto_linked', 'matched', 'manual', 'unresolved'])
		.optional()
		.default('unresolved'),
	match_strategy: z.string().nullable().optional(),
	match_signals: z.array(z.string()).default([])
});

const AiDraftMatchingTakeoffItemSchema = z.object({
	sort_order: z.number().int().min(0),
	applied_preset_id: z.string().nullable().optional(),
	applied_preset_name: z.string().nullable().optional(),
	cost_code_id: z.string().nullable().optional(),
	wbs_node_id: z.string().nullable().optional(),
	cost_components: z.array(AiDraftMatchingCostComponentSchema)
});

export const AiDraftMatchingSchema = z.object({
	applied_template_id: z.string().nullable().optional(),
	applied_template_name: z.string().nullable().optional(),
	classification_system_id: z.string().nullable().optional(),
	wbs_root_node_id: z.string().nullable().optional(),
	takeoff_items: z.array(AiDraftMatchingTakeoffItemSchema),
	issues: AiIssueArraySchema
});

export const AiDraftRunEstimateSchema = z.object({
	scope_summary: z.string(),
	notes: z.string().default(''),
	classification_system_id: z.string().nullable().optional(),
	wbs_root_node_id: z.string().nullable().optional(),
	applied_template_id: z.string().nullable().optional(),
	applied_template_name: z.string().nullable().optional(),
	takeoff_items: z.array(AiDraftTakeoffItemSchema),
	issues: AiIssueArraySchema
});

export const AiDraftRunResultSchema = z.object({
	draft: AiDraftRunEstimateSchema,
	draftAgentSteps: z.array(JsonObjectSchema).optional(),
	draftToolCalls: z.array(JsonObjectSchema).optional(),
	draftAgentFinal: JsonObjectSchema.optional(),
	draftOutline: AiDraftOutlineSchema.optional(),
	draftMatching: AiDraftMatchingSchema.optional(),
	draftStageMetrics: z.array(AiDraftStageMetricSchema).default([]),
	evidenceRefs: z.array(AiEvidenceRefSchema),
	issues: AiIssueArraySchema,
	artifactManifest: z.array(JsonObjectSchema),
	extractions: z.array(JsonObjectSchema),
	usage: AiDraftRunUsageSchema,
	promptContract: AiDraftRunPromptContractSchema,
	normalizedTableSnapshot: JsonObjectSchema,
	cacheMetadata: AiDraftRunCacheMetadataSchema,
	evidenceCoverage: z
		.object({
			totalUnits: z.number().int().nonnegative(),
			cachedUnits: z.number().int().nonnegative(),
			completedUnits: z.number().int().nonnegative(),
			failedUnits: z.number().int().nonnegative(),
			omittedUnits: z.number().int().nonnegative(),
			units: z
				.array(
					z.object({
						fileId: z.string(),
						fileName: z.string(),
						unitKey: z.string(),
						unitHash: z.string(),
						state: z.enum(['cached', 'completed', 'failed', 'omitted']),
						failureCategory: z.string().nullable().optional()
					})
				)
				.default([])
		})
		.default({
			totalUnits: 0,
			cachedUnits: 0,
			completedUnits: 0,
			failedUnits: 0,
			omittedUnits: 0,
			units: []
		}),
	runtimeExecutionContext: AiDraftRuntimeExecutionContextSchema
});

export const AiDraftRunResultEnvelopeSchema = z.object({
	runId: z.string().trim().min(1),
	result: AiDraftRunResultSchema
});

export const AiRunInputRowSchema = z.object({
	id: z.string(),
	run_id: z.string(),
	input_kind: z.string(),
	payload_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value;
	}, JsonObjectSchema),
	payload_hash: z.string().optional().default(''),
	contract_version: z.string().optional().default(''),
	stage_name: z.string().optional().default(''),
	created_at: z.string()
});

export const AiRunOutputRowSchema = z.object({
	id: z.string(),
	run_id: z.string(),
	output_kind: z.string(),
	payload_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value;
	}, JsonObjectSchema),
	payload_hash: z.string().optional().default(''),
	contract_version: z.string().optional().default(''),
	stage_name: z.string().optional().default(''),
	created_at: z.string()
});

export const AiTaskSummaryRowSchema = z.object({
	run_id: z.string(),
	asset_id: z.string(),
	asset_name: z.string(),
	project_id: z.string(),
	project_rfq_number: z.string().nullable().optional(),
	status: z.preprocess(
		(value) => (value === 'consolidating' ? 'drafting' : value),
		z.enum([
			'queued',
			'preprocessing',
			'extracting',
			'drafting',
			'drafted',
			'applied',
			'failed',
			'cancelled'
		])
	),
	started_at: z.string(),
	completed_at: z.string().nullable().optional(),
	failed_at: z.string().nullable().optional(),
	cancelled_at: z.string().nullable().optional(),
	error_message: z.string().nullable().optional()
});

export const AiEvidenceRefRowSchema = z.object({
	id: z.string(),
	run_id: z.string(),
	asset_id: z.string(),
	file_id: z.string().nullable(),
	file_name: z.string(),
	artifact_kind: z.enum(['text', 'pdf', 'image', 'cad']),
	page_number: z.preprocess(
		(value) => (value == null || value === '' ? null : Number(value)),
		z.number().int().positive().nullable()
	),
	view_label: z.string().nullable(),
	evidence_identifier: z.string().optional().default(''),
	locator_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value ?? {};
	}, JsonObjectSchema),
	draft_entity_kind: z.string().optional().default(''),
	draft_entity_key: z.string().optional().default(''),
	confidence_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value ?? {};
	}, JsonObjectSchema),
	quote_path: z.string(),
	summary: z.string(),
	created_at: z.string()
});

export const AiReviewEventRowSchema = z.object({
	id: z.string(),
	run_id: z.string(),
	asset_id: z.string(),
	event_type: z.string(),
	event_payload_json: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value;
	}, JsonObjectSchema),
	created_at: z.string()
});

export const AiOverrideEventRowSchema = z.object({
	id: z.string(),
	run_id: z.string(),
	asset_id: z.string(),
	field_path: z.string(),
	original_value_json: z.string(),
	final_value_json: z.string(),
	created_at: z.string()
});

export const EstimateRowArraySchema = z.array(EstimateRowSchema);
export const EstimateSummaryArraySchema = z.array(EstimateSummarySchema);
export const ClassificationSystemRowArraySchema = z.array(ClassificationSystemRowSchema);
export const CostCodeRowArraySchema = z.array(CostCodeRowSchema);
export const WbsNodeRowArraySchema = z.array(WbsNodeRowSchema);
export const TakeoffItemRowArraySchema = z.array(TakeoffItemRowSchema);
export const CostComponentRowArraySchema = z.array(CostComponentRowSchema);
export const MaterialCatalogueItemRowArraySchema = z.array(MaterialCatalogueItemRowSchema);
export const LabourRateCardRowArraySchema = z.array(LabourRateCardRowSchema);
export const EquipmentRateCardRowArraySchema = z.array(EquipmentRateCardRowSchema);
export const SubcontractRateCardRowArraySchema = z.array(SubcontractRateCardRowSchema);
export const CostComponentPresetRowArraySchema = z.array(CostComponentPresetRowSchema);
export const EstimateTemplateRowArraySchema = z.array(EstimateTemplateRowSchema);
export const ProjectStructureTemplateRowArraySchema = z.array(ProjectStructureTemplateRowSchema);
export const ProjectStructureTemplateNodeRowArraySchema = z.array(
	ProjectStructureTemplateNodeRowSchema
);
export const QuoteOptionRowArraySchema = z.array(QuoteOptionRowSchema);
export const QuoteOptionPresetRowArraySchema = z.array(QuoteOptionPresetRowSchema);
export const QuoteRevisionOptionRowArraySchema = z.array(QuoteRevisionOptionRowSchema);
export const QuoteRevisionRowArraySchema = z.array(QuoteRevisionRowSchema);
export const AiRunRowArraySchema = z.array(AiRunRowSchema);
export const AiRunInputRowArraySchema = z.array(AiRunInputRowSchema);
export const AiRunOutputRowArraySchema = z.array(AiRunOutputRowSchema);
export const AiEvidenceRefRowArraySchema = z.array(AiEvidenceRefRowSchema);
export const AiReviewEventRowArraySchema = z.array(AiReviewEventRowSchema);
export const AiOverrideEventRowArraySchema = z.array(AiOverrideEventRowSchema);
export const AiTaskSummaryRowArraySchema = z.array(AiTaskSummaryRowSchema);

export const ContactSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	sort_order: z.preprocess(Number, z.number().int().min(0)),
	kind: ContactKindSchema,
	display_name: z
		.string()
		.nullable()
		.transform((value) => value ?? ''),
	name: z.string(),
	company_name: z.string().optional().nullable(),
	person_first_name: z.string().optional().nullable(),
	person_last_name: z.string().optional().nullable(),
	role_title: z.string().optional().nullable(),
	linked_company_id: z.string().optional().nullable(),
	is_primary_company_contact: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	country_code: CountryCodeSchema,
	contact_name: z.string().optional().nullable(),
	email: z.string().trim().toLowerCase().optional().nullable(),
	website: z.string().optional().nullable(),
	phone: z.string().optional().nullable(),
	phone_e164: z.string().optional().nullable(),
	phone_country_code: z.string().optional().nullable(),
	abn: z.string().optional().nullable(),
	business_id_label: z.string().optional().nullable(),
	business_id_value: z.string().optional().nullable(),
	tax_id_label: z.string().optional().nullable(),
	tax_id_value: z.string().optional().nullable(),
	address: z.string().optional().nullable(),
	notes: z.string().optional().nullable(),
	logo_file_path: z.string().optional().nullable(),
	custom_role_label: z.string().optional().nullable(),
	roles: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(ContactRoleSchema)),
	tags: z.preprocess((value) => {
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return [];
			}
		}
		return value;
	}, z.array(z.string())),
	is_active: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	created_at: z.string(),
	updated_at: z.string()
});
export const ContactArraySchema = z.array(ContactSchema);
export const CustomerSchema = ContactSchema;
export const CustomerArraySchema = z.array(CustomerSchema);

export const ProfileIdentityRowSchema = z.object({
	id: z.string(),
	display_name: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	email: z.string().trim().toLowerCase().nullable(),
	phone: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
export const ProfileIdentitySchema = z.object({
	id: z.string(),
	displayName: z.string(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	email: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
	created_at: z.string(),
	updated_at: z.string()
});

export const ControlCustomerIdentityRowSchema = z.object({
	id: z.string(),
	profile_id: z.string(),
	display_name: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});
export const ControlCustomerIdentitySchema = z.object({
	id: z.string(),
	profileId: z.string(),
	displayName: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceRegistryRowSchema = z.object({
	id: z.string(),
	customer_id: z.string(),
	display_name: z.string(),
	slug: z.string(),
	db_path: z.string(),
	vault_root_path: z.string(),
	is_default: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	last_opened_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
export const WorkspaceRegistrySchema = z.object({
	id: z.string(),
	customerId: z.string(),
	displayName: z.string(),
	slug: z.string(),
	dbPath: z.string(),
	vaultRootPath: z.string(),
	isDefault: z.boolean(),
	lastOpenedAt: z.string().nullable().optional(),
	created_at: z.string(),
	updated_at: z.string()
});

export const OnboardingStateRowSchema = z.object({
	id: z.string(),
	current_step: z.enum([
		'workspace_setup',
		'setup_import_optional',
		'local_ai_optional',
		'ready',
		'blocked_setup_error',
		'workspace_creation_failed',
		'import_failed_retryable',
		'local_ai_setup_attention'
	]),
	profile_completed_at: z.string().nullable(),
	first_workspace_created_at: z.string().nullable(),
	import_decided_at: z.string().nullable(),
	local_ai_decided_at: z.string().nullable(),
	completed_at: z.string().nullable(),
	active_workspace_id: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
export const OnboardingStateSchema = z.object({
	id: z.string(),
	currentStep: z.enum([
		'workspace_setup',
		'setup_import_optional',
		'local_ai_optional',
		'ready',
		'blocked_setup_error',
		'workspace_creation_failed',
		'import_failed_retryable',
		'local_ai_setup_attention'
	]),
	profileCompletedAt: z.string().nullable().optional(),
	firstWorkspaceCreatedAt: z.string().nullable().optional(),
	importDecidedAt: z.string().nullable().optional(),
	localAiDecidedAt: z.string().nullable().optional(),
	completedAt: z.string().nullable().optional(),
	activeWorkspaceId: z.string().nullable().optional(),
	created_at: z.string(),
	updated_at: z.string()
});

// Account/customer identity schemas remain for synthesized app-state snapshots. The clean SQLite
// baselines no longer store account/auth/customer tables inside workspace databases.
export const AccountIdentitySchema = z.object({
	id: z.string(),
	accountName: z.string(),
	accountEmail: z.string(),
	phone: z.string(),
	avatarPath: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceIdentityRowSchema = z.object({
	id: z.string(),
	bootstrap_completed_at: z.string().nullable(),
	onboarding_completed_at: z.string().nullable(),
	onboarding_version: z.preprocess(Number, z.number().int().min(1)),
	workspace_role: z.enum(['owner', 'admin', 'member']).nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
export const WorkspaceIdentitySchema = z.object({
	id: z.string(),
	bootstrapCompletedAt: z.string().nullable().optional(),
	onboardingCompletedAt: z.string().nullable().optional(),
	onboardingVersion: z.number().int().min(1),
	workspaceRole: z.enum(['owner', 'admin', 'member']).nullable().optional(),
	created_at: z.string(),
	updated_at: z.string()
});

export const CustomerIdentitySchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	displayName: z.string(),
	countryCode: CountryCodeSchema,
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceProfileRowSchema = z.object({
	workspace_id: z.string(),
	display_name: z.string(),
	country_code: CountryCodeSchema,
	business_name: z.string(),
	logo_file_path: z.string().default(''),
	ai_playbook_text: z.string().default(''),
	abn: z.string().optional(),
	business_id_label: z.string(),
	business_id_value: z.string(),
	tax_id_label: z.string(),
	tax_id_value: z.string(),
	tax_display_label: z.string(),
	tax_rate_percentage: z.preprocess(Number, z.number().min(0).max(100)),
	business_address: z.string(),
	business_contact_name: z.string(),
	business_contact_first_name: z.string(),
	business_contact_last_name: z.string(),
	business_contact_email: z.string().trim().toLowerCase(),
	business_contact_phone: z.string(),
	business_contact_phone_e164: z.string(),
	business_contact_phone_country_code: z.string(),
	currency_code: z.enum(SUPPORTED_CURRENCY_CODES),
	currency_symbol: z.string(),
	measurement_unit: z.enum(['Metric', 'Imperial']),
	date_format: z.enum(SUPPORTED_DATE_FORMATS),
	language_locale: z.enum(SUPPORTED_LANGUAGE_LOCALES),
	number_locale: z.enum(SUPPORTED_NUMBER_LOCALES),
	quote_payment_terms: z.string().default('Payment Terms: Due on receipt.'),
	quote_validity_days: z.preprocess(Number, z.number().int().min(1)).default(30),
	quote_default_inclusions: z.string().default(''),
	quote_default_exclusions: z.string().default(''),
	quote_default_terms: z.string().default(''),
	quote_number_prefix: z.string().default('Q'),
	quote_number_format: z.string().default('{prefix}-{yyyy}-{seq}'),
	email_signature: z.string().default(''),
	created_at: z.string(),
	updated_at: z.string()
});
export const WorkspaceProfileSchema = z.object({
	workspaceId: z.string(),
	displayName: z.string(),
	emailSignature: z.string().default(''),
	countryCode: CountryCodeSchema,
	businessName: z.string(),
	logoFilePath: z.string(),
	aiPlaybookText: z.string(),
	abn: z.string().optional().nullable(),
	businessIdLabel: z.string(),
	businessIdValue: z.string(),
	taxIdLabel: z.string(),
	taxIdValue: z.string(),
	taxDisplayLabel: z.string(),
	taxRatePercentage: z.number().min(0).max(100),
	businessAddress: z.string(),
	businessContactName: z.string(),
	businessContactFirstName: z.string().optional(),
	businessContactLastName: z.string().optional(),
	businessContactEmail: OptionalEmailSchema,
	businessContactPhone: z.string(),
	businessContactPhoneE164: z.string(),
	businessContactPhoneCountryCode: z.string(),
	currencyCode: z.enum(SUPPORTED_CURRENCY_CODES),
	currencySymbol: z.string(),
	measurementUnit: z.enum(['Metric', 'Imperial']),
	dateFormat: z.enum(SUPPORTED_DATE_FORMATS),
	languageLocale: z.enum(SUPPORTED_LANGUAGE_LOCALES),
	numberLocale: z.enum(SUPPORTED_NUMBER_LOCALES),
	quotePaymentTerms: z.string(),
	quoteValidityDays: z.number().int().min(1),
	quoteDefaultInclusions: z.string(),
	quoteDefaultExclusions: z.string(),
	quoteDefaultTerms: z.string(),
	quoteNumberPrefix: z.string(),
	quoteNumberFormat: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceAiKnowledgeFileRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	file_path: z.string(),
	original_name: z.string(),
	mime_type: z.string().nullable(),
	byte_size: z.preprocess(Number, z.number().int().min(0)),
	extracted_text: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceAiKnowledgeFileSchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	filePath: z.string(),
	originalName: z.string(),
	mimeType: z.string().nullable(),
	byteSize: z.number().int().min(0),
	extractedText: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceAiFeedbackEntryRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	run_id: z.string(),
	asset_id: z.string().nullable(),
	estimate_id: z.string().nullable(),
	feedback_text: z.string(),
	created_at: z.string()
});

export const WorkspaceAiFeedbackEntryRowArraySchema = z.array(WorkspaceAiFeedbackEntryRowSchema);

export const WorkspaceAiFeedbackEntrySchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	runId: z.string(),
	assetId: z.string().nullable(),
	estimateId: z.string().nullable(),
	feedbackText: z.string(),
	created_at: z.string()
});

export const WorkspaceOnboardingProfileRowSchema = z.object({
	workspace_id: z.string(),
	primary_operator_role: OnboardingOperatorRoleSchema,
	industry: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});
export const WorkspaceOnboardingProfileSchema = z.object({
	workspaceId: z.string(),
	primaryOperatorRole: OnboardingOperatorRoleSchema,
	industry: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const WorkspaceMemberRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	role: z.enum(['owner', 'admin', 'member']),
	display_name: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	email: z.string().trim().toLowerCase(),
	avatar_path: z.string(),
	is_primary: z.preprocess((val) => val === 1 || val === true, z.boolean()),
	joined_at: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});
export const WorkspaceMemberSchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	role: z.enum(['owner', 'admin', 'member']),
	displayName: z.string(),
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	email: z.string().trim().toLowerCase(),
	avatarPath: z.string(),
	isPrimary: z.boolean(),
	joinedAt: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const RuntimeContractStateRowSchema = z.object({
	id: z.string(),
	schema_version: z.preprocess(Number, z.number().int().positive()),
	last_opened_app_version: z.string().trim().min(1),
	minimum_supported_app_version: z.string().nullable(),
	contract_status: z.enum(['ready', 'update_required', 'repair_required']),
	last_checked_at: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});
export const RuntimeContractStateSchema = z.object({
	id: z.string(),
	schemaVersion: z.number().int().positive(),
	lastOpenedAppVersion: z.string().trim().min(1),
	minimumSupportedAppVersion: z.string().nullable().optional(),
	contractStatus: z.enum(['ready', 'update_required', 'repair_required']),
	lastCheckedAt: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

export const accountSettingsSchema = z.object({
	accountEmail: OptionalEmailSchema.default(''),
	phone: GenericPhoneSchema,
	avatar: z.string().optional().or(z.literal(''))
});
export type AccountSettingsValues = z.infer<typeof accountSettingsSchema>;

export const workspaceDefaultsSettingsSchema = z.object({
	currencySymbol: z.string().trim().min(1, 'Currency symbol is required'),
	currencyCode: z.enum(SUPPORTED_CURRENCY_CODES, 'Select a supported currency'),
	measurementUnit: z.enum(['Metric', 'Imperial']),
	dateFormat: z.enum(SUPPORTED_DATE_FORMATS, 'Select a supported date format'),
	languageLocale: z.enum(SUPPORTED_LANGUAGE_LOCALES).optional(),
	numberLocale: z.enum(SUPPORTED_NUMBER_LOCALES).optional(),
	taxRatePercentage: z.coerce
		.number()
		.min(0, 'Tax rate cannot be negative')
		.max(100, 'Tax rate cannot exceed 100'),
	quotePaymentTerms: z.string().trim().optional().or(z.literal('')),
	quoteValidityDays: z.coerce
		.number()
		.int('Quote validity must be a whole number of days')
		.min(1, 'Quote validity must be at least 1 day'),
	quoteDefaultInclusions: z.string().trim().optional().or(z.literal('')),
	quoteDefaultExclusions: z.string().trim().optional().or(z.literal('')),
	quoteDefaultTerms: z.string().trim().optional().or(z.literal('')),
	quoteNumberPrefix: z.string().trim().optional().or(z.literal('')),
	quoteNumberFormat: z.string().trim().optional().or(z.literal(''))
});
export type WorkspaceDefaultsSettingsValues = z.infer<typeof workspaceDefaultsSettingsSchema>;

export const workspaceIdentitySettingsSchema = z.object({
	displayName: z.string().trim().min(1, 'Workspace name is required'),
	countryCode: CountryCodeSchema
});
export type WorkspaceIdentitySettingsValues = z.infer<typeof workspaceIdentitySettingsSchema>;

const capitaliseLeadingCharacter = (value: string): string =>
	value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const WorkspaceBusinessNameSchema = z.string().trim().optional().or(z.literal(''));
const WorkspaceBusinessContactNameSchema = z.string().trim().optional().or(z.literal(''));
const WorkspaceBusinessContactEmailSchema = OptionalEmailSchema;
const WorkspaceBusinessContactPhoneSchema = GenericPhoneSchema;
const WorkspaceIndustrySchema = z.string().trim().max(120).optional().or(z.literal(''));
const OnboardingWorkspaceNameSchema = z
	.string()
	.trim()
	.min(2, 'Workspace name must be at least 2 characters');
const OnboardingBusinessNameSchema = z.string().trim().min(1, 'Business name is required');
const onboardingBusinessContactNameSchema = (label: string) =>
	z.string().trim().min(1, `${label} is required`).transform(capitaliseLeadingCharacter);

export const workspaceBusinessProfileSettingsSchema = z.object({
	businessName: WorkspaceBusinessNameSchema,
	logoFilePath: z.string().trim().optional().or(z.literal('')),
	businessContactFirstName: WorkspaceBusinessContactNameSchema,
	businessContactLastName: WorkspaceBusinessContactNameSchema,
	businessContactEmail: WorkspaceBusinessContactEmailSchema,
	businessContactPhone: WorkspaceBusinessContactPhoneSchema,
	businessIdValue: z.string().trim().max(100).optional().or(z.literal('')),
	businessAddress: z.string().optional().or(z.literal('')),
	emailSignature: z.string().optional().or(z.literal(''))
});
export type WorkspaceBusinessProfileSettingsValues = z.infer<
	typeof workspaceBusinessProfileSettingsSchema
>;

export const workspaceProfileSettingsSchema = workspaceIdentitySettingsSchema.merge(
	workspaceBusinessProfileSettingsSchema
);
export type WorkspaceProfileSettingsValues = z.infer<typeof workspaceProfileSettingsSchema>;

export const workspaceOnboardingProfileSettingsSchema = z.object({
	primaryOperatorRole: OnboardingOperatorRoleSchema,
	industry: WorkspaceIndustrySchema
});
export type WorkspaceOnboardingProfileSettingsValues = z.infer<
	typeof workspaceOnboardingProfileSettingsSchema
>;

export const workspaceOnboardingEditableSettingsSchema = z.object({
	primaryOperatorRole: OnboardingOperatorRoleSchema,
	industry: WorkspaceIndustrySchema
});
export type WorkspaceOnboardingEditableSettingsValues = z.infer<
	typeof workspaceOnboardingEditableSettingsSchema
>;

export const workspaceCreateDetailsSchema = z.object({
	workspaceName: OnboardingWorkspaceNameSchema,
	countryCode: CountryCodeSchema.default('AU'),
	businessName: WorkspaceBusinessNameSchema.default(''),
	logoFilePath: z.string().trim().optional().or(z.literal('')).default(''),
	businessContactFirstName: WorkspaceBusinessContactNameSchema.default(''),
	businessContactLastName: WorkspaceBusinessContactNameSchema.default(''),
	businessContactPhone: WorkspaceBusinessContactPhoneSchema.default(''),
	businessContactEmail: WorkspaceBusinessContactEmailSchema.default(''),
	businessIdValue: z.string().trim().max(100).optional().or(z.literal('')).default(''),
	primaryOperatorRole: OnboardingOperatorRoleSchema.default('owner_founder'),
	industry: WorkspaceIndustrySchema.default('')
});
export type WorkspaceCreateDetailsValues = z.infer<typeof workspaceCreateDetailsSchema>;

export const onboardingWorkspaceDetailsSchema = z.object({
	workspaceName: OnboardingWorkspaceNameSchema,
	countryCode: CountryCodeSchema.default('AU'),
	businessName: OnboardingBusinessNameSchema,
	logoFilePath: z.string().trim().optional().or(z.literal('')).default(''),
	businessContactFirstName: onboardingBusinessContactNameSchema('First name'),
	businessContactLastName: onboardingBusinessContactNameSchema('Last name'),
	businessContactPhone: WorkspaceBusinessContactPhoneSchema.default(''),
	businessContactEmail: WorkspaceBusinessContactEmailSchema.default(''),
	businessIdValue: z.string().trim().max(100).optional().or(z.literal('')).default(''),
	primaryOperatorRole: OnboardingOperatorRoleSchema.default('owner_founder'),
	industry: WorkspaceIndustrySchema.default('')
});
export type OnboardingWorkspaceDetailsValues = z.infer<typeof onboardingWorkspaceDetailsSchema>;

export const settingsProfileSchema = accountSettingsSchema
	.merge(workspaceDefaultsSettingsSchema)
	.merge(workspaceProfileSettingsSchema)
	.merge(workspaceOnboardingProfileSettingsSchema);
export type SettingsProfileValues = z.infer<typeof settingsProfileSchema>;

export const workspaceProfileImportSchema = workspaceDefaultsSettingsSchema.merge(
	workspaceProfileSettingsSchema
);
export type WorkspaceProfileImportValues = z.infer<typeof workspaceProfileImportSchema>;

export const contactBaseFormSchema = z.object({
	country_code: CountryCodeSchema,
	name: z.string().trim().default(''),
	contact_name: z.string().trim().default(''),
	email: OptionalEmailSchema.default(''),
	website: z.string().trim().max(255).default(''),
	phone: GenericPhoneSchema,
	phone_country_code: z.string().trim().toUpperCase().default(''),
	phone_e164: z.string().default(''),
	abn: z.string().default(''),
	business_id_label: z.string().trim().max(100).default(''),
	business_id_value: z.string().trim().max(100).default(''),
	tax_id_label: z.string().trim().max(100).default(''),
	tax_id_value: z.string().trim().max(100).default(''),
	address: z.string().default(''),
	notes: z.string().default(''),
	logo_file_path: z.string().trim().optional().or(z.literal('')),
	custom_role_label: z.string().trim().max(80).default('')
});

// Schema validates contact shape; SQLite indexes enforce company/person scoped name uniqueness.
const contactFormSchemaBase = contactBaseFormSchema.extend({
	kind: ContactKindSchema.default('company'),
	display_name: z.string().trim().default(''),
	company_name: z.string().trim().default(''),
	person_first_name: z.string().trim().default(''),
	person_last_name: z.string().trim().default(''),
	role_title: z.string().trim().default(''),
	linked_company_id: z.string().trim().default(''),
	is_primary_company_contact: z.boolean().default(false),
	roles: z.array(ContactRoleSchema).default([]),
	tags: z.array(z.string()).default([]),
	is_active: z.boolean().default(true)
});

export const companyContactFormSchema = contactFormSchemaBase.superRefine((value, ctx) => {
	if (value.kind !== 'company') return;
	const companyName =
		value.display_name?.trim() || value.name?.trim() || value.company_name?.trim() || '';
	if (!companyName) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['display_name'],
			message: 'Company name is required'
		});
	}
});

export const personContactFormSchema = contactFormSchemaBase.superRefine((value, ctx) => {
	if (value.kind !== 'person') return;
	if (!value.linked_company_id?.trim()) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['linked_company_id'],
			message: 'Linked company is required for people'
		});
	}
	const firstName = value.person_first_name?.trim() ?? '';
	const lastName = value.person_last_name?.trim() ?? '';
	const displayName = value.display_name?.trim() || value.name?.trim() || '';
	if (!firstName && !lastName && !displayName) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['person_first_name'],
			message: 'First name or last name is required'
		});
	}
});

export const contactFormSchema = contactFormSchemaBase.superRefine((value, ctx) => {
	if (value.kind === 'person') {
		if (!value.linked_company_id.trim()) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['linked_company_id'],
				message: 'Linked company is required for people'
			});
		}
		if (
			!value.person_first_name.trim() &&
			!value.person_last_name.trim() &&
			!value.display_name.trim() &&
			!value.name.trim()
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['person_first_name'],
				message: 'First name or last name is required'
			});
		}
		return;
	}

	if (!value.display_name.trim() && !value.name.trim() && !value.company_name.trim()) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['display_name'],
			message: 'Company name is required'
		});
	}
});
export type ContactFormValues = z.infer<typeof contactFormSchema>;

/**
 * RFQ Intake Validation Schema (Felte + Zod)
 */
export const rfqSchema = z
	.object({
		rfq_number: z.string().trim().min(1, 'RFQ number is required'),
		company_contact_id: z.string().trim().optional().nullable(),
		company_name: z.string().trim().optional(),
		requester_contact_id: z.string().trim().optional().nullable(),
		requester_name: z.string().trim().optional(),
		project_name: z.string().trim().optional(),
		due_date: z.string().optional().or(z.literal('')),
		received_date: z.string().optional().or(z.literal('')),
		submission_deadline_at: z.string().optional().or(z.literal('')),
		estimator_name: z.string().trim().optional(),
		customer_tender_reference: z.string().trim().optional(),
		addendum_label: z.string().trim().optional(),
		addendum_date: z.string().optional().or(z.literal('')),
		addendum_notes: z.string().trim().optional(),
		site_address: z.string().trim().optional(),
		delivery_address: z.string().trim().optional(),
		source_channel: z.enum(RFQ_SOURCE_CHANNELS).default('manual'),
		source_reference: z.string().trim().optional().nullable(),
		source_email_message_id: z.string().trim().optional().nullable(),
		source_email_integration_id: z.string().trim().optional().nullable(),
		priority: z.nativeEnum(PriorityLevel),
		status: z.nativeEnum(ProjectStatus),
		content: z.string().trim().optional(),
		note: z.string().trim().optional()
	})
	.superRefine((value, ctx) => {
		const hasCompanyId = Boolean(value.company_contact_id?.trim());
		const hasCompanyName = Boolean(value.company_name?.trim());
		if (!hasCompanyId && !hasCompanyName) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['company_name'],
				message: 'Company is required'
			});
		}
	});

export type RfqValues = z.infer<typeof rfqSchema>;

export const materialCatalogItemFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Material name is required'),
	category: z.string().trim().optional().or(z.literal('')),
	specification: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	unit: z.preprocess((value) => normaliseMaterialUnitCode(value) ?? value, MaterialUnitCodeSchema),
	default_rate: z.number().min(0, 'Default rate must be 0 or greater'),
	currency_code: CurrencyCodeSchema.optional(),
	effective_date: z.string().optional().or(z.literal('')),
	verified_date: z.string().optional().or(z.literal('')),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().trim().optional().or(z.literal('')),
	availability: z.string().trim().optional().or(z.literal('')),
	reference: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean()
});
export type MaterialCatalogItemFormValues = z.input<typeof materialCatalogItemFormSchema>;

export const subcontractRateCardFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Rate name is required'),
	category: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	unit: z.preprocess(
		(value) => normaliseSubcontractRateUnitCode(value) ?? value,
		SubcontractRateUnitCodeSchema
	),
	default_rate: z.number().min(0, 'Default rate must be 0 or greater'),
	currency_code: CurrencyCodeSchema.optional(),
	effective_date: z.string().optional().or(z.literal('')),
	verified_date: z.string().optional().or(z.literal('')),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().trim().optional().or(z.literal('')),
	availability: z.string().trim().optional().or(z.literal('')),
	reference: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean()
});
export type SubcontractRateCardFormValues = z.input<typeof subcontractRateCardFormSchema>;

export const labourRateCardFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Rate name is required'),
	category: z.string().trim().optional().or(z.literal('')),
	work_center: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	unit: z.preprocess(
		(value) => normaliseLabourRateUnitCode(value) ?? value,
		LabourRateUnitCodeSchema
	),
	default_rate: z.number().min(0, 'Default rate must be 0 or greater'),
	currency_code: CurrencyCodeSchema.optional(),
	effective_date: z.string().optional().or(z.literal('')),
	verified_date: z.string().optional().or(z.literal('')),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().trim().optional().or(z.literal('')),
	availability: z.string().trim().optional().or(z.literal('')),
	reference: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean()
});
export type LabourRateCardFormValues = z.input<typeof labourRateCardFormSchema>;

export const equipmentRateCardFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Rate name is required'),
	category: z.string().trim().optional().or(z.literal('')),
	work_center: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	unit: z.preprocess(
		(value) => normaliseEquipmentRateUnitCode(value) ?? value,
		EquipmentRateUnitCodeSchema
	),
	default_rate: z.number().min(0, 'Default rate must be 0 or greater'),
	currency_code: CurrencyCodeSchema.optional(),
	effective_date: z.string().optional().or(z.literal('')),
	verified_date: z.string().optional().or(z.literal('')),
	rate_basis: z.enum(['cost', 'sell']).default('cost'),
	lead_time: z.string().trim().optional().or(z.literal('')),
	availability: z.string().trim().optional().or(z.literal('')),
	reference: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean()
});
export type EquipmentRateCardFormValues = z.input<typeof equipmentRateCardFormSchema>;

export const classificationSystemFormSchema = z.object({
	name: z.string().trim().min(1, 'System name is required'),
	code: z.string().trim().optional().or(z.literal('')),
	classification_type: z.enum(['masterformat', 'uniformat', 'xactimate', 'custom']),
	aliases: z.array(z.string().trim().min(1)).default([]),
	is_default: z.boolean()
});
export type ClassificationSystemFormValues = z.infer<typeof classificationSystemFormSchema>;

export const costCodeFormSchema = z.object({
	parent_id: z.string().nullable().optional(),
	code: z.string().trim().min(1, 'Code is required'),
	name: z.string().trim().min(1, 'Name is required'),
	description: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean(),
	sort_order: z.number().int().min(0, 'Sort order must be 0 or greater')
});
export type CostCodeFormValues = z.infer<typeof costCodeFormSchema>;

export const wbsNodeFormSchema = z.object({
	parent_id: z.string().nullable().optional(),
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Name is required'),
	type: z.enum(['phase', 'level', 'zone', 'room', 'trade', 'custom']),
	sort_order: z.number().int().min(0, 'Sort order must be 0 or greater')
});
export type WbsNodeFormValues = z.infer<typeof wbsNodeFormSchema>;

export const quoteOptionFormSchema = z.object({
	label: z.string().trim().min(1, 'Option label is required'),
	lead_time: z.string().trim().min(1, 'Lead time is required'),
	markup_percentage: z.number().min(-100, 'Markup must be -100 or greater'),
	material_markup_percentage: z.number().min(-100).nullable().optional(),
	labour_markup_percentage: z.number().min(-100).nullable().optional(),
	equipment_markup_percentage: z.number().min(-100).nullable().optional(),
	subcontract_markup_percentage: z.number().min(-100).nullable().optional(),
	notes: z.string().optional(),
	is_default: z.boolean()
});
export type QuoteOptionFormValues = z.infer<typeof quoteOptionFormSchema>;

export const quoteOptionPresetFormSchema = z.object({
	label: z.string().trim().min(1, 'Preset label is required'),
	lead_time: z.string().trim().min(1, 'Lead time is required'),
	markup_percentage: z.number().min(-100, 'Markup must be -100 or greater'),
	material_markup_percentage: z.number().min(-100).nullable().optional(),
	labour_markup_percentage: z.number().min(-100).nullable().optional(),
	equipment_markup_percentage: z.number().min(-100).nullable().optional(),
	subcontract_markup_percentage: z.number().min(-100).nullable().optional(),
	notes: z.string().optional()
});
export type QuoteOptionPresetFormValues = z.infer<typeof quoteOptionPresetFormSchema>;

export const costComponentPresetFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Preset name is required'),
	description: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	is_active: z.boolean()
});
export type CostComponentPresetFormValues = z.infer<typeof costComponentPresetFormSchema>;

export const estimateTemplateFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Template name is required'),
	description: z.string().trim().optional().or(z.literal('')),
	aliases: z.array(z.string().trim().min(1)).default([]),
	is_active: z.boolean()
});
export type EstimateTemplateFormValues = z.infer<typeof estimateTemplateFormSchema>;

export const projectStructureTemplateFormSchema = z.object({
	code: z.string().trim().optional().or(z.literal('')),
	name: z.string().trim().min(1, 'Template name is required'),
	description: z.string().trim().optional().or(z.literal('')),
	is_active: z.boolean()
});
export type ProjectStructureTemplateFormValues = z.infer<typeof projectStructureTemplateFormSchema>;

// ---------------------------------------------------------------
// Workspace Integrations Schemas
// ---------------------------------------------------------------

export const WorkspaceIntegrationRowSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	provider: z.string(),
	label: z.string(),
	status: z.enum(['active', 'expired', 'revoked', 'error']),
	external_id: z.string().nullable(),
	external_name: z.string().nullable(),
	config: z.string(),
	token_expires_at: z.number().int().nullable(),
	last_error: z.string().nullable(),
	rfq_detection_enabled: z.number().int().min(0).max(1),
	polling_interval: z.enum(['off', '15m', '30m', '1h']),
	sync_cursor: z.string().nullable(),
	last_synced_at: z.string().nullable(),
	connected_at: z.string(),
	updated_at: z.string(),
	created_at: z.string()
});
export type ValidatedWorkspaceIntegrationRow = z.infer<typeof WorkspaceIntegrationRowSchema>;

export const EmailRfqClassificationRowSchema = z.object({
	integration_id: z.string(),
	provider_message_id: z.string(),
	classifier_version: z.string(),
	verdict: z.enum(['rfq', 'not_rfq']),
	model_id: z.string(),
	classified_at: z.string(),
	created_at: z.string(),
	updated_at: z.string()
});

// Infer types from schemas (single source of truth)
export type ValidatedProject = z.infer<typeof ProjectSchema>;
export type ValidatedAsset = z.infer<typeof AssetSchema>;

export const GlobalSearchIndexSchema = z.object({
	id: z.string(),
	rfq_number: z.string(),
	project_name: z.string().nullable().optional(),
	content: z.string().nullable().optional(),
	note: z.string().nullable().optional()
});

export const ContactsSearchIndexSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	kind: z.string(),
	display_name: z.string(),
	name: z.string(),
	company_name: z.string().nullable().optional(),
	person_first_name: z.string().nullable().optional(),
	person_last_name: z.string().nullable().optional(),
	custom_role_label: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
	address: z.string().nullable().optional(),
	notes: z.string().nullable().optional()
});

export const MaterialsSearchIndexSchema = z.object({
	id: z.string(),
	workspace_id: z.string(),
	name: z.string(),
	code: z.string(),
	category: z.string().nullable().optional(),
	unit: z.string(),
	specification: z.string().nullable().optional(),
	aliases_json: z.string().nullable().optional()
});

/**
 * Fx rate snapshot schema.
 *
 * Currency codes validated against the canonical 23-code enum.
 * rate must be a non-empty string (exact decimal validated by service-layer
 * normalizer). from_currency_code and to_currency_code enforced as different
 * via refinement.
 */
export const FxRateSnapshotSchema = z
	.object({
		id: z.string(),
		workspace_id: z.string(),
		from_currency_code: CurrencyCodeSchema,
		to_currency_code: CurrencyCodeSchema,
		rate_decimal: z.string().min(1, 'Rate must not be empty'),
		source: z.string().default('manual'),
		effective_at: z.string(),
		created_at: z.string()
	})
	.refine((data) => data.from_currency_code !== data.to_currency_code, {
		message: 'from_currency_code and to_currency_code must differ'
	});

export type FxRateSnapshotSchemaType = z.infer<typeof FxRateSnapshotSchema>;
