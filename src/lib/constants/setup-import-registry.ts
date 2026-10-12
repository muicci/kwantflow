import { z } from 'zod';

import {
	classificationSystemFormSchema,
	costCodeFormSchema,
	costComponentPresetFormSchema,
	CostComponentPresetRowSchema,
	contactFormSchema,
	equipmentRateCardFormSchema,
	estimateTemplateFormSchema,
	EstimateTemplateRowSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	projectStructureTemplateFormSchema,
	subcontractRateCardFormSchema
} from '$lib/schemas/index.js';

export type SetupImportTargetTable =
	| 'contacts'
	| 'materials'
	| 'labour_rates'
	| 'equipment_rates'
	| 'subcontract_rates'
	| 'cost_presets'
	| 'estimate_templates'
	| 'project_structure_templates'
	| 'classification_systems'
	| 'cost_codes';

export interface SetupImportSchemaFieldDigest {
	id: string;
	label: string;
	required: boolean;
	type: 'string' | 'number' | 'boolean' | 'enum';
	aliases: string[];
	keywords?: string[];
	importable?: boolean;
}

export interface SetupImportSchemaTableDigest {
	id: SetupImportTargetTable;
	label: string;
	purpose: string;
	exactSheetNames: string[];
	sheetNameHints: string[];
	keywords?: string[];
	negativeKeywords?: string[];
	fields: SetupImportSchemaFieldDigest[];
	excludedFieldIds: string[];
}

export interface SetupImportTableDefinition extends SetupImportSchemaTableDigest {
	formSchema: z.ZodObject<z.ZodRawShape>;
}

export interface SetupImportSchemaDigest {
	digestVersion: string;
	tables: SetupImportSchemaTableDigest[];
}

export const SETUP_IMPORT_DIGEST_VERSION = 'setup-import-v4';

export const SETUP_IMPORT_TARGET_TABLES = [
	'contacts',
	'materials',
	'labour_rates',
	'equipment_rates',
	'subcontract_rates',
	'cost_presets',
	'estimate_templates',
	'project_structure_templates',
	'classification_systems',
	'cost_codes'
] as const satisfies readonly SetupImportTargetTable[];

const costComponentPresetImportSchema = costComponentPresetFormSchema.extend({
	components_json: CostComponentPresetRowSchema.shape.components_json.optional()
});

const estimateTemplateImportSchema = estimateTemplateFormSchema.extend({
	estimate_json: EstimateTemplateRowSchema.shape.estimate_json.optional()
});

const contactImportSchema = contactFormSchema.extend({
	person_name: z.string().optional()
});

const catalogueCompanyImportField = {
	id: 'company_names',
	label: 'Companies',
	required: false,
	type: 'string' as const,
	aliases: [
		'company',
		'companies',
		'company name',
		'company names',
		'supplier',
		'suppliers',
		'vendor',
		'vendors'
	]
};

const materialImportSchema = materialCatalogItemFormSchema.extend({
	company_names: z.array(z.string()).optional()
});
const labourRateImportSchema = labourRateCardFormSchema.extend({
	company_names: z.array(z.string()).optional()
});
const equipmentRateImportSchema = equipmentRateCardFormSchema.extend({
	company_names: z.array(z.string()).optional()
});
const subcontractRateImportSchema = subcontractRateCardFormSchema.extend({
	company_names: z.array(z.string()).optional()
});

export const setupImportTableDefinitions = [
	{
		id: 'contacts',
		label: 'Companies',
		purpose:
			'Workspace companies CRM records, plus linked people used for RFQs, counterparties, and commercial links.',
		exactSheetNames: [
			'client_directory',
			'customer_directory',
			'client_list',
			'customer_list',
			'clients'
		],
		sheetNameHints: ['customer', 'customers', 'client', 'clients', 'directory', 'crm', 'contacts'],
		keywords: ['company', 'business', 'customer', 'client', 'contact', 'directory', 'counterparty'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: contactImportSchema,
		excludedFieldIds: [
			'contact_name',
			'phone_country_code',
			'phone_e164',
			'abn',
			'business_id_label',
			'tax_id_label',
			'logo_file_path'
		],
		fields: [
			{
				id: 'country_code',
				label: 'Country',
				required: false,
				type: 'enum',
				aliases: ['country', 'country code', 'country_code', 'au / nz', 'anz country']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['name', 'legal name', 'record name', 'canonical name']
			},
			{
				id: 'display_name',
				label: 'Display name',
				required: true,
				type: 'string',
				aliases: [
					'contact',
					'contact name',
					'customer',
					'customer name',
					'company',
					'company name',
					'client',
					'client name'
				],
				keywords: ['company', 'business', 'customer', 'client', 'organisation', 'account name']
			},
			{
				id: 'kind',
				label: 'Record kind',
				required: false,
				type: 'enum',
				aliases: ['kind', 'contact kind', 'record type', 'company or person', 'type'],
				keywords: ['company', 'person', 'record kind', 'contact type']
			},
			{
				id: 'company_name',
				label: 'Company name',
				required: false,
				type: 'string',
				aliases: ['company', 'company name', 'business name'],
				keywords: ['company', 'business', 'organisation']
			},
			{
				id: 'person_first_name',
				label: 'First name',
				required: false,
				type: 'string',
				aliases: ['first name', 'given name']
			},
			{
				id: 'person_last_name',
				label: 'Last name',
				required: false,
				type: 'string',
				aliases: ['last name', 'surname', 'family name']
			},
			{
				id: 'role_title',
				label: 'Role title',
				required: false,
				type: 'string',
				aliases: ['title', 'role', 'job title', 'position']
			},
			{
				id: 'linked_company_id',
				label: 'Linked company',
				required: false,
				type: 'string',
				aliases: ['linked company', 'company id', 'company key', 'employer id', 'works for']
			},
			{
				id: 'is_primary_company_contact',
				label: 'Primary company contact',
				required: false,
				type: 'boolean',
				aliases: ['primary contact', 'primary company contact', 'main company contact']
			},
			{
				id: 'person_name',
				label: 'Person name',
				required: false,
				type: 'string',
				aliases: ['primary contact', 'contact person', 'main contact', 'attention'],
				keywords: ['person', 'buyer', 'estimator', 'contact', 'attention']
			},
			{
				id: 'email',
				label: 'Email',
				required: false,
				type: 'string',
				aliases: ['customer email', 'client email', 'email', 'email address']
			},
			{
				id: 'website',
				label: 'Website',
				required: false,
				type: 'string',
				aliases: ['website', 'web site', 'url', 'homepage', 'company website']
			},
			{
				id: 'phone',
				label: 'Phone',
				required: false,
				type: 'string',
				aliases: ['mobile', 'mobile number', 'phone', 'phone number', 'telephone']
			},
			{
				id: 'business_id_value',
				label: 'Business ID',
				required: false,
				type: 'string',
				aliases: [
					'business id',
					'company id',
					'client ref',
					'customer ref',
					'client code',
					'contact code'
				],
				keywords: ['account code', 'reference', 'erp id', 'business reference']
			},
			{
				id: 'tax_id_value',
				label: 'Tax ID',
				required: false,
				type: 'string',
				aliases: ['tax id', 'gst', 'gst no', 'gst number', 'vat number']
			},
			{
				id: 'address',
				label: 'Address',
				required: false,
				type: 'string',
				aliases: ['location', 'address', 'billing address', 'street address', 'street addr']
			},
			{
				id: 'notes',
				label: 'Notes',
				required: false,
				type: 'string',
				aliases: ['comments', 'remarks', 'memo', 'note', 'notes'].concat(['internal notes'])
			},
			{
				id: 'roles',
				label: 'Types',
				required: false,
				type: 'enum',
				aliases: [
					'roles',
					'types',
					'contact roles',
					'company types',
					'counterparty roles',
					'tags by role'
				]
			},
			{
				id: 'custom_role_label',
				label: 'Custom Type',
				required: false,
				type: 'string',
				aliases: [
					'custom role',
					'custom type',
					'other role',
					'other type',
					'role detail',
					'role label'
				]
			},
			{
				id: 'tags',
				label: 'Tags',
				required: false,
				type: 'string',
				aliases: ['tags', 'labels', 'keywords']
			},

			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			}
		]
	},
	{
		id: 'materials',
		label: 'Materials',
		purpose: 'Workspace material catalogue with default unit rates.',
		exactSheetNames: ['material_master', 'materials_master', 'materials', 'materials_list'],
		sheetNameHints: ['material', 'materials', 'inventory', 'stock'],
		keywords: ['material', 'inventory', 'stock', 'product', 'item'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: materialImportSchema,
		excludedFieldIds: [],
		fields: [
			catalogueCompanyImportField,
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['material code', 'material ref', 'material id', 'sku']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['material name', 'material desc', 'material description', 'description']
			},
			{ id: 'category', label: 'Category', required: false, type: 'string', aliases: ['group'] },
			{
				id: 'specification',
				label: 'Specification',
				required: false,
				type: 'string',
				aliases: ['spec', 'standard']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'unit',
				label: 'Unit',
				required: true,
				type: 'enum',
				aliases: ['uom', 'unit of measure']
			},
			{
				id: 'default_rate',
				label: 'Default rate',
				required: true,
				type: 'number',
				aliases: ['rate', 'unit rate', 'unit cost', 'unit price', 'cost'],
				keywords: ['price', 'buy rate', 'buy price', 'rate each']
			},
			{
				id: 'currency_code',
				label: 'Currency',
				required: false,
				type: 'enum',
				aliases: ['currency', 'currency code', 'iso currency']
			},
			{
				id: 'effective_date',
				label: 'Effective date',
				required: false,
				type: 'string',
				aliases: ['effective date', 'effective from', 'valid from']
			},
			{
				id: 'verified_date',
				label: 'Verified date',
				required: false,
				type: 'string',
				aliases: ['verified date', 'last checked', 'last verified']
			},
			{
				id: 'rate_basis',
				label: 'Rate basis',
				required: false,
				type: 'enum',
				aliases: ['rate basis', 'basis', 'cost or sell', 'cost/sell']
			},
			{
				id: 'lead_time',
				label: 'Lead time',
				required: false,
				type: 'string',
				aliases: ['lead time', 'leadtime', 'availability lead time']
			},
			{
				id: 'availability',
				label: 'Availability',
				required: false,
				type: 'string',
				aliases: ['availability', 'available', 'supply status']
			},
			{
				id: 'reference',
				label: 'Reference',
				required: false,
				type: 'string',
				aliases: ['reference', 'source reference', 'price reference']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			}
		]
	},
	{
		id: 'labour_rates',
		label: 'Labour Rates',
		purpose: 'Workspace labour rate cards used in estimating.',
		exactSheetNames: ['crew_rates', 'labour_rates', 'labor_rates', 'labour_rate_cards'],
		sheetNameHints: ['labour', 'labor', 'crew', 'crews', 'rates', 'labour_rates'],
		keywords: ['labour', 'labor', 'crew', 'crew rates', 'workforce', 'hourly'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: labourRateImportSchema,
		excludedFieldIds: [],
		fields: [
			catalogueCompanyImportField,
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['labour code', 'rate code', 'crew code']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['rate name', 'labour name', 'labour rate', 'crew name'],
				keywords: ['crew title', 'trade name', 'role name', 'labour title']
			},
			{ id: 'category', label: 'Category', required: false, type: 'string', aliases: ['group'] },
			{
				id: 'work_center',
				label: 'Work centre',
				required: false,
				type: 'string',
				aliases: ['work center', 'workcentre', 'work centre']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'unit',
				label: 'Unit',
				required: true,
				type: 'enum',
				aliases: ['uom', 'unit', 'unit of measure']
			},
			{
				id: 'default_rate',
				label: 'Default rate',
				required: true,
				type: 'number',
				aliases: ['rate', 'hourly rate', 'charge rate', 'unit rate'],
				keywords: ['rate per hr', 'rate per hour', 'hour rate', 'sell rate', 'charge out']
			},
			{
				id: 'currency_code',
				label: 'Currency',
				required: false,
				type: 'enum',
				aliases: ['currency', 'currency code', 'iso currency']
			},
			{
				id: 'effective_date',
				label: 'Effective date',
				required: false,
				type: 'string',
				aliases: ['effective date', 'effective from', 'valid from']
			},
			{
				id: 'verified_date',
				label: 'Verified date',
				required: false,
				type: 'string',
				aliases: ['verified date', 'last checked', 'last verified']
			},
			{
				id: 'rate_basis',
				label: 'Rate basis',
				required: false,
				type: 'enum',
				aliases: ['rate basis', 'basis', 'cost or sell', 'cost/sell']
			},
			{
				id: 'lead_time',
				label: 'Lead time',
				required: false,
				type: 'string',
				aliases: ['lead time', 'leadtime', 'availability lead time']
			},
			{
				id: 'availability',
				label: 'Availability',
				required: false,
				type: 'string',
				aliases: ['availability', 'available', 'supply status']
			},
			{
				id: 'reference',
				label: 'Reference',
				required: false,
				type: 'string',
				aliases: ['reference', 'source reference', 'price reference']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			}
		]
	},
	{
		id: 'equipment_rates',
		label: 'Equipment Rates',
		purpose: 'Workspace equipment rate cards used in estimating.',
		exactSheetNames: ['plant_gear', 'plant_and_gear', 'equipment_rates', 'equipment_hire'],
		sheetNameHints: ['equipment', 'plant', 'gear', 'hire', 'equipment_rates'],
		keywords: ['equipment', 'plant', 'gear', 'hire', 'machine'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: equipmentRateImportSchema,
		excludedFieldIds: [],
		fields: [
			catalogueCompanyImportField,
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['equipment code', 'plant code', 'gear code']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['equipment name', 'plant name', 'gear name', 'rate name']
			},
			{ id: 'category', label: 'Category', required: false, type: 'string', aliases: ['group'] },
			{
				id: 'work_center',
				label: 'Work centre',
				required: false,
				type: 'string',
				aliases: ['work center', 'workcentre', 'work centre']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'unit',
				label: 'Unit',
				required: true,
				type: 'enum',
				aliases: ['uom', 'unit', 'unit of measure']
			},
			{
				id: 'default_rate',
				label: 'Default rate',
				required: true,
				type: 'number',
				aliases: ['rate', 'hourly rate', 'hire rate', 'unit rate']
			},
			{
				id: 'currency_code',
				label: 'Currency',
				required: false,
				type: 'enum',
				aliases: ['currency', 'currency code', 'iso currency']
			},
			{
				id: 'effective_date',
				label: 'Effective date',
				required: false,
				type: 'string',
				aliases: ['effective date', 'effective from', 'valid from']
			},
			{
				id: 'verified_date',
				label: 'Verified date',
				required: false,
				type: 'string',
				aliases: ['verified date', 'last checked', 'last verified']
			},
			{
				id: 'rate_basis',
				label: 'Rate basis',
				required: false,
				type: 'enum',
				aliases: ['rate basis', 'basis', 'cost or sell', 'cost/sell']
			},
			{
				id: 'lead_time',
				label: 'Lead time',
				required: false,
				type: 'string',
				aliases: ['lead time', 'leadtime', 'availability lead time']
			},
			{
				id: 'availability',
				label: 'Availability',
				required: false,
				type: 'string',
				aliases: ['availability', 'available', 'supply status']
			},
			{
				id: 'reference',
				label: 'Reference',
				required: false,
				type: 'string',
				aliases: ['reference', 'source reference', 'price reference']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			}
		]
	},
	{
		id: 'subcontract_rates',
		label: 'Subcontract Rates',
		purpose: 'Workspace subcontract rate cards used for sourced subcontract pricing.',
		exactSheetNames: [
			'subcontract_rates',
			'subcontractors',
			'subcontract_rate_cards',
			'vendor_rates',
			'supplier_rates'
		],
		sheetNameHints: [
			'subcontract',
			'subcontractor',
			'subcontractors',
			'vendor',
			'supplier',
			'trade',
			'outsourced'
		],
		keywords: ['subcontract', 'vendor', 'supplier', 'trade', 'outsourced'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: subcontractRateImportSchema,
		excludedFieldIds: [],
		fields: [
			catalogueCompanyImportField,
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['subcontract code', 'vendor code', 'supplier code', 'trade code']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['rate name', 'subcontract name', 'description', 'scope description', 'trade']
			},
			{
				id: 'category',
				label: 'Category',
				required: false,
				type: 'string',
				aliases: ['category', 'group', 'trade group']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'unit',
				label: 'Unit',
				required: true,
				type: 'enum',
				aliases: ['uom', 'unit', 'unit of measure']
			},
			{
				id: 'default_rate',
				label: 'Default rate',
				required: true,
				type: 'number',
				aliases: ['rate', 'unit rate', 'unit price', 'subcontract rate', 'price']
			},
			{
				id: 'currency_code',
				label: 'Currency',
				required: false,
				type: 'enum',
				aliases: ['currency', 'currency code', 'iso currency']
			},
			{
				id: 'effective_date',
				label: 'Effective date',
				required: false,
				type: 'string',
				aliases: ['effective date', 'effective from', 'valid from']
			},
			{
				id: 'verified_date',
				label: 'Verified date',
				required: false,
				type: 'string',
				aliases: ['verified date', 'last checked', 'last verified']
			},
			{
				id: 'rate_basis',
				label: 'Rate basis',
				required: false,
				type: 'enum',
				aliases: ['rate basis', 'basis', 'cost or sell', 'cost/sell']
			},
			{
				id: 'lead_time',
				label: 'Lead time',
				required: false,
				type: 'string',
				aliases: ['lead time', 'leadtime', 'availability lead time']
			},
			{
				id: 'availability',
				label: 'Availability',
				required: false,
				type: 'string',
				aliases: ['availability', 'available', 'supply status']
			},
			{
				id: 'reference',
				label: 'Reference',
				required: false,
				type: 'string',
				aliases: ['reference', 'source reference', 'price reference']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			}
		]
	},
	{
		id: 'cost_presets',
		label: 'Cost Presets',
		purpose: 'Reusable cost component preset library records.',
		exactSheetNames: ['preset_library', 'cost_presets', 'preset_list'],
		sheetNameHints: ['preset', 'presets', 'library', 'cost_preset', 'cost_presets'],
		keywords: ['preset', 'library', 'component preset', 'default component'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: costComponentPresetImportSchema,
		excludedFieldIds: [],
		fields: [
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['preset code', 'preset ref', 'preset id']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['preset name', 'assembly name', 'preset title']
			},
			{
				id: 'description',
				label: 'Description',
				required: false,
				type: 'string',
				aliases: ['notes', 'preset notes', 'description']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'enabled', 'enabled?']
			},
			{
				id: 'components_json',
				label: 'Components data',
				required: false,
				type: 'string',
				aliases: [
					'components json',
					'component payload',
					'preset json',
					'assembly json',
					'items json'
				],
				keywords: ['json', 'components', 'payload', 'assembly', 'cost components']
			}
		]
	},
	{
		id: 'estimate_templates',
		label: 'Estimate Templates',
		purpose: 'Reusable estimate template library records.',
		exactSheetNames: ['template_seeds', 'estimate_templates', 'templates'],
		sheetNameHints: ['template', 'templates', 'seed', 'seeds', 'estimate_template'],
		keywords: ['template', 'estimate template', 'quote template', 'seed'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: estimateTemplateImportSchema,
		excludedFieldIds: [],
		fields: [
			{ id: 'code', label: 'Code', required: false, type: 'string', aliases: ['template code'] },
			{ id: 'name', label: 'Name', required: true, type: 'string', aliases: ['template name'] },
			{
				id: 'description',
				label: 'Description',
				required: false,
				type: 'string',
				aliases: ['notes']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'alias',
					'alt name',
					'alt names',
					'alternate names',
					'aka',
					'search terms',
					'keywords'
				]
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'enabled']
			},
			{
				id: 'estimate_json',
				label: 'Estimate data',
				required: false,
				type: 'string',
				aliases: [
					'estimate json',
					'template json',
					'estimate payload',
					'template payload',
					'quote template data'
				],
				keywords: ['json', 'estimate', 'template', 'payload', 'takeoff']
			}
		]
	},
	{
		id: 'project_structure_templates',
		label: 'Project Structure Templates',
		purpose: 'Reusable project structure template records.',
		exactSheetNames: ['project_structure_templates', 'wbs_templates', 'structure_templates'],
		sheetNameHints: ['project structure', 'wbs template', 'structure template'],
		keywords: ['project structure', 'wbs', 'work breakdown', 'structure template'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: projectStructureTemplateFormSchema,
		excludedFieldIds: [],
		fields: [
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['template code', 'wbs code']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['template name', 'structure name']
			},
			{
				id: 'description',
				label: 'Description',
				required: false,
				type: 'string',
				aliases: ['description', 'notes']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'enabled']
			}
		]
	},
	{
		id: 'classification_systems',
		label: 'Classification Systems',
		purpose: 'Top-level classification systems used to organise cost codes.',
		exactSheetNames: ['code_families', 'classification_systems', 'classifications'],
		sheetNameHints: ['classification', 'classifications', 'system', 'systems', 'families'],
		keywords: ['classification', 'system', 'family', 'code family', 'taxonomy'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: classificationSystemFormSchema,
		excludedFieldIds: [],
		fields: [
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['system name', 'family name', 'code family', 'system title', 'family title']
			},
			{
				id: 'code',
				label: 'Code',
				required: false,
				type: 'string',
				aliases: ['system code', 'family code', 'system ref', 'family ref', 'classification code']
			},
			{
				id: 'classification_type',
				label: 'Type',
				required: false,
				type: 'enum',
				aliases: ['classification type', 'system type', 'family type', 'type'],
				keywords: ['masterformat', 'uniformat', 'xactimate', 'custom']
			},
			{
				id: 'aliases',
				label: 'Aliases',
				required: false,
				type: 'string',
				aliases: [
					'keywords',
					'search terms',
					'alt name',
					'alt names',
					'alternate names',
					'synonyms'
				]
			},
			{
				id: 'is_default',
				label: 'Default',
				required: false,
				type: 'boolean',
				aliases: ['default system', 'default', 'default?', 'is default']
			}
		]
	},
	{
		id: 'cost_codes',
		label: 'Cost Codes',
		purpose: 'Codes within a classification system.',
		exactSheetNames: ['coding_list', 'cost_codes', 'codes'],
		sheetNameHints: ['code', 'codes', 'coding', 'coding_list', 'cost_codes'],
		keywords: ['cost code', 'coding', 'code list', 'wbs code', 'schedule'],
		negativeKeywords: ['read me', 'readme', 'notes', 'legend', 'instructions', 'example'],
		formSchema: costCodeFormSchema,
		excludedFieldIds: [],
		fields: [
			{
				id: 'parent_id',
				label: 'Parent code',
				required: false,
				type: 'string',
				aliases: ['parent', 'parent code', 'parent code ref']
			},
			{
				id: 'code',
				label: 'Code',
				required: true,
				type: 'string',
				aliases: ['cost code', 'code id', 'code ref']
			},
			{
				id: 'name',
				label: 'Name',
				required: true,
				type: 'string',
				aliases: ['title', 'short description', 'label']
			},
			{
				id: 'description',
				label: 'Description',
				required: false,
				type: 'string',
				aliases: ['description', 'notes', 'long description', 'short desc', 'desc']
			},
			{
				id: 'is_active',
				label: 'Active',
				required: false,
				type: 'boolean',
				aliases: ['active', 'active flag', 'enabled', 'enabled?']
			},
			{
				id: 'sort_order',
				label: 'Sort order',
				required: false,
				type: 'number',
				aliases: ['order', 'sequence']
			}
		]
	}
] as const satisfies readonly SetupImportTableDefinition[];

export const setupImportTargetTableOptions = setupImportTableDefinitions.map((table) => ({
	value: table.id,
	label: table.label
})) as ReadonlyArray<{ value: SetupImportTargetTable; label: string }>;

export const setupImportFormSchemas = setupImportTableDefinitions.reduce(
	(schemas, table) => {
		schemas[table.id] = table.formSchema;
		return schemas;
	},
	{} as Record<SetupImportTargetTable, z.ZodObject<z.ZodRawShape>>
);

export function getSetupImportTableDefinition(
	tableId: SetupImportTargetTable
): SetupImportTableDefinition {
	const definition = setupImportTableDefinitions.find((table) => table.id === tableId);
	if (!definition) {
		throw new Error(`Unknown setup import table: ${tableId}`);
	}
	return definition;
}
