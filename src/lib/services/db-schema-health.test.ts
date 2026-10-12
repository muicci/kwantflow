import { describe, expect, it } from 'vitest';

import {
	assertRuntimeSchemaHealth,
	inspectRuntimeContractVersion,
	WORKSPACE_RUNTIME_SCHEMA,
	type RuntimeSchemaQueryable
} from '$lib/services/db-schema-health.js';

it('uses junction relationships instead of removed catalogue supplier columns', () => {
	for (const table of [
		'company_material_links',
		'company_labour_rate_links',
		'company_equipment_rate_links',
		'company_subcontract_rate_links'
	]) {
		expect(WORKSPACE_RUNTIME_SCHEMA.tables).toContain(table);
	}
	for (const table of [
		'material_catalog_items',
		'labour_rate_cards',
		'equipment_rate_cards',
		'subcontract_rate_cards'
	] as const) {
		expect(WORKSPACE_RUNTIME_SCHEMA.columns[table]).not.toContain('contact_id');
	}
});

const completeRuntimeTables = [
	'workspace_identity',
	'workspace_profile',
	'workspace_onboarding_profile',
	'workspace_members',
	'contacts',
	'files',
	'assets',
	'projects',
	'classification_systems',
	'cost_codes',
	'wbs_nodes',
	'estimates',
	'takeoff_items',
	'cost_components',
	'material_catalog_items',
	'labour_rate_cards',
	'equipment_rate_cards',
	'subcontract_rate_cards',
	'cost_component_presets',
	'estimate_templates',
	'quote_option_presets',
	'project_structure_templates',
	'project_structure_template_nodes',
	'quote_options',
	'quote_revisions',
	'quote_revision_options',
	'contact_relationships',
	'company_material_links',
	'company_labour_rate_links',
	'company_equipment_rate_links',
	'company_subcontract_rate_links',
	'ai_runs',
	'ai_run_inputs',
	'ai_run_outputs',
	'ai_evidence_cache',
	'ai_evidence_refs',
	'ai_review_events',
	'ai_override_events',
	'workspace_ai_knowledge_files',
	'workspace_ai_feedback_entries',
	'assistant_action_audit',
	'runtime_contract_state',
	'fx_rate_snapshots',
	'project_file_page_chunks'
];

const completeRuntimeColumns: Record<string, string[]> = {
	workspace_identity: ['bootstrap_completed_at', 'onboarding_completed_at'],
	workspace_profile: [
		'display_name',
		'country_code',
		'business_name',
		'logo_file_path',
		'ai_playbook_text',
		'currency_code',
		'currency_symbol',
		'measurement_unit',
		'date_format',
		'language_locale',
		'number_locale',
		'tax_rate_percentage',
		'quote_payment_terms',
		'quote_validity_days',
		'quote_default_inclusions',
		'quote_default_exclusions',
		'quote_default_terms',
		'quote_number_prefix',
		'quote_number_format',
		'business_contact_name',
		'business_contact_first_name',
		'business_contact_last_name',
		'business_contact_email',
		'business_contact_phone',
		'email_signature'
	],
	workspace_ai_knowledge_files: ['workspace_id', 'file_path', 'original_name', 'extracted_text'],
	workspace_ai_feedback_entries: ['workspace_id', 'run_id', 'feedback_text'],
	assistant_action_audit: ['workspace_id', 'turn_id', 'proposal_id', 'tool_name', 'status'],
	workspace_onboarding_profile: ['primary_operator_role', 'industry'],
	workspace_members: ['role', 'display_name', 'first_name', 'last_name', 'email'],
	contacts: ['kind', 'display_name', 'linked_company_id', 'is_active'],
	contact_relationships: ['from_contact_id', 'to_contact_id', 'relationship_type', 'is_primary'],
	company_material_links: ['company_id', 'material_id'],
	company_labour_rate_links: ['company_id', 'labour_rate_id'],
	company_equipment_rate_links: ['company_id', 'equipment_rate_id'],
	company_subcontract_rate_links: ['company_id', 'subcontract_rate_id'],
	files: [
		'project_id',
		'asset_id',
		'file_path',
		'original_name',
		'byte_size',
		'content_hash',
		'checksum_algorithm',
		'document_type',
		'revision_label',
		'received_at',
		'source_label',
		'source_metadata_json'
	],
	assets: ['project_id', 'thumbnail_file_id', 'is_selected', 'quote_quantity', 'is_pdf_included'],
	projects: [
		'contact_id',
		'contact_name_snapshot',
		'requester_contact_id',
		'requester_name_snapshot',
		'quote_recipient_contact_id',
		'quote_round_prices',
		'source_channel',
		'source_reference',
		'received_date',
		'submission_deadline_at',
		'estimator_name',
		'customer_tender_reference',
		'addendum_label',
		'addendum_date',
		'addendum_notes',
		'site_address',
		'delivery_address',
		'source_email_message_id',
		'source_email_integration_id'
	],
	classification_systems: ['workspace_id', 'name', 'code', 'classification_type', 'aliases_json'],
	cost_codes: ['classification_system_id', 'parent_id', 'code', 'name', 'is_active'],
	wbs_nodes: ['project_id', 'parent_id', 'name', 'type'],
	estimates: [
		'classification_system_id',
		'wbs_root_node_id',
		'applied_template_id',
		'currency_code'
	],
	takeoff_items: ['parent_id', 'cost_code_id', 'wbs_node_id', 'applied_preset_id'],
	cost_components: [
		'takeoff_item_id',
		'source_type',
		'source_id',
		'source_unit_rate_decimal',
		'source_currency_code',
		'fx_rate_snapshot_id'
	],
	material_catalog_items: [
		'effective_date',
		'verified_date',
		'rate_basis',
		'lead_time',
		'availability',
		'reference',
		'currency_code'
	],
	labour_rate_cards: [
		'effective_date',
		'verified_date',
		'rate_basis',
		'lead_time',
		'availability',
		'reference',
		'currency_code'
	],
	equipment_rate_cards: [
		'effective_date',
		'verified_date',
		'rate_basis',
		'lead_time',
		'availability',
		'reference',
		'currency_code'
	],
	subcontract_rate_cards: [
		'effective_date',
		'verified_date',
		'rate_basis',
		'lead_time',
		'availability',
		'reference',
		'currency_code'
	],
	cost_component_presets: ['components_json'],
	estimate_templates: ['estimate_json'],
	quote_option_presets: [
		'workspace_id',
		'label',
		'markup_percentage',
		'material_markup_percentage',
		'labour_markup_percentage',
		'equipment_markup_percentage',
		'subcontract_markup_percentage'
	],
	quote_options: [
		'project_id',
		'label',
		'markup_percentage',
		'material_markup_percentage',
		'labour_markup_percentage',
		'equipment_markup_percentage',
		'subcontract_markup_percentage',
		'is_default'
	],
	quote_revisions: [
		'project_id',
		'revision_number',
		'quote_number_snapshot',
		'revision_reason',
		'contact_name_snapshot',
		'sent_status',
		'sent_date',
		'sent_method',
		'recipient_snapshot_json',
		'terms_snapshot_json'
	],
	quote_revision_options: ['revision_id', 'label', 'markup_percentage', 'is_default'],
	ai_runs: [
		'asset_id',
		'provider',
		'status',
		'model_id',
		'trigger_source',
		'prompt_contract_version',
		'context_fingerprint',
		'failure_kind',
		'failure_stage'
	],
	ai_run_inputs: [
		'run_id',
		'input_kind',
		'payload_json',
		'payload_hash',
		'contract_version',
		'stage_name'
	],
	ai_run_outputs: [
		'run_id',
		'output_kind',
		'payload_json',
		'payload_hash',
		'contract_version',
		'stage_name'
	],
	ai_evidence_cache: [
		'file_id',
		'cache_kind',
		'source_content_hash',
		'evidence_unit_key',
		'evidence_unit_hash',
		'preparation_version',
		'extraction_version',
		'synthesis_version',
		'model_runtime_id',
		'payload_json',
		'artifact_path',
		'byte_size',
		'last_accessed_at'
	],
	ai_evidence_refs: [
		'run_id',
		'asset_id',
		'file_id',
		'artifact_kind',
		'evidence_identifier',
		'locator_json',
		'draft_entity_kind',
		'draft_entity_key',
		'confidence_json'
	],
	ai_review_events: ['run_id', 'asset_id', 'event_type'],
	ai_override_events: ['run_id', 'asset_id', 'field_path'],
	project_structure_templates: ['workspace_id', 'name', 'is_active'],
	project_structure_template_nodes: ['template_id', 'parent_id', 'name', 'type'],
	runtime_contract_state: ['schema_version', 'last_opened_app_version'],
	fx_rate_snapshots: [
		'id',
		'workspace_id',
		'from_currency_code',
		'to_currency_code',
		'rate_decimal',
		'source',
		'effective_at',
		'created_at'
	],
	project_file_page_chunks: ['file_id', 'page_number', 'chunk_index', 'text_content', 'word_count']
};

function createQueryable(definitions: {
	tables: string[];
	columns: Record<string, string[]>;
	runtimeSchemaVersion?: number | string;
}): RuntimeSchemaQueryable {
	return {
		async select<T>(sql: string, params?: unknown[]): Promise<T> {
			if (sql.startsWith('SELECT name FROM sqlite_master')) {
				const tableName = String(params?.[0] ?? '');
				const exists = definitions.tables.includes(tableName);
				return (exists ? [{ name: tableName }] : []) as T;
			}

			if (sql.startsWith('SELECT schema_version FROM runtime_contract_state')) {
				return (
					definitions.runtimeSchemaVersion == null
						? []
						: [{ schema_version: definitions.runtimeSchemaVersion }]
				) as T;
			}

			const pragmaMatch = sql.match(/^PRAGMA table_info\((.+)\)$/);
			if (pragmaMatch) {
				const tableName = pragmaMatch[1]?.replaceAll(/['"]/g, '') ?? '';
				const columns = definitions.columns[tableName] ?? [];
				return columns.map((name, index) => ({ cid: index, name })) as T;
			}

			throw new Error(`Unexpected SQL in test queryable: ${sql}`);
		}
	};
}

describe('runtime schema health', () => {
	it('passes for the workspace runtime profile without account or customer tables', async () => {
		const queryable = createQueryable({
			tables: completeRuntimeTables,
			columns: completeRuntimeColumns
		});

		await expect(assertRuntimeSchemaHealth(queryable, 'workspace')).resolves.toBeUndefined();
	});
	it('reads the active workspace contract version', async () => {
		const queryable = createQueryable({
			tables: ['runtime_contract_state'],
			columns: {},
			runtimeSchemaVersion: '1'
		});

		await expect(inspectRuntimeContractVersion(queryable)).resolves.toBe(1);
	});

	it('passes when the Contacts-era schema is present', async () => {
		const queryable = createQueryable({
			tables: completeRuntimeTables,
			columns: completeRuntimeColumns
		});

		await expect(assertRuntimeSchemaHealth(queryable)).resolves.toBeUndefined();
	});

	it('fails with a descriptive error when required runtime foundation columns are missing', async () => {
		const queryable = createQueryable({
			tables: completeRuntimeTables.filter((tableName) => tableName !== 'contact_relationships'),
			columns: {
				...completeRuntimeColumns,
				projects: [],
				estimates: [],
				takeoff_items: [],
				cost_components: [],
				runtime_contract_state: ['schema_version']
			}
		});

		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'Local database schema is missing required runtime tables or columns'
		);
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow('projects.contact_id');
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow('contact_relationships');
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'runtime_contract_state.last_opened_app_version'
		);
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'estimates.classification_system_id'
		);
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'takeoff_items.cost_code_id'
		);
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'cost_components.source_type'
		);
		await expect(assertRuntimeSchemaHealth(queryable)).rejects.toThrow(
			'runtime_contract_state.last_opened_app_version'
		);
	});
});
