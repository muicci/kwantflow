import { z } from 'zod';

import {
	classificationSystemFormSchema,
	costCodeFormSchema,
	costComponentPresetFormSchema,
	contactFormSchema,
	equipmentRateCardFormSchema,
	estimateTemplateFormSchema,
	labourRateCardFormSchema,
	materialCatalogItemFormSchema,
	projectStructureTemplateFormSchema,
	subcontractRateCardFormSchema,
	rfqSchema
} from '$lib/schemas/index.js';
import type { SetupImportTargetTable } from '$lib/constants/setup-import-registry.js';
import type { DB } from '$lib/types/db.js';
import type { WorkspaceRecordKey } from './workspace-records.js';

export type DbTableName = keyof DB;

export type DbTableContractKind =
	| 'workspace_feature'
	| 'project_operational'
	| 'workspace_foundation'
	| 'workspace_internal'
	| 'quote_snapshot'
	| 'ai_audit';

export interface DbTableContract {
	tableName: DbTableName;
	kind: DbTableContractKind;
	reason: string;
	workspaceRecordKey?: WorkspaceRecordKey;
	tableInterfaceName: string;
	relationship?: {
		companyColumn: 'company_id';
		recordTableName: DbTableName;
		recordColumn: string;
		reverseIndexName: string;
		rustVariant: 'Materials' | 'LabourRates' | 'EquipmentRates' | 'SubcontractRates';
		dialogPath: string;
		stateAuthorityPath: string;
	};
}

export interface WorkspaceFeatureContract {
	key: WorkspaceRecordKey;
	tableName: DbTableName;
	tableInterfaceName: string;
	entityLabel: string;
	formSchema: z.ZodObject<z.ZodRawShape>;
	excludedDbFieldIds: string[];
	importSupport:
		| {
				kind: 'setup_import';
				targetTableId: SetupImportTargetTable;
		  }
		| {
				kind: 'none';
				reason: string;
		  };
}

export interface EnumContractDefinition {
	name: string;
	values: string[];
	requiredFiles: string[];
}

export const workspaceFeatureContracts = [
	{
		key: 'rfqs',
		tableName: 'projects',
		tableInterfaceName: 'ProjectsTable',
		entityLabel: 'RFQs',
		formSchema: rfqSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'sort_order',
			'is_favourite',
			'quote_round_prices',
			'contact_id',
			'contact_name_snapshot',
			'quote_recipient_contact_id',
			'requester_name_snapshot',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'none',
			reason: 'RFQs do not use the setup-import wizard.'
		}
	},
	{
		key: 'contacts',
		tableName: 'contacts',
		tableInterfaceName: 'ContactsTable',
		entityLabel: 'Companies',
		formSchema: contactFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'sort_order',
			'roles_json',
			'tags_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'contacts'
		}
	},
	{
		key: 'materials',
		tableName: 'material_catalog_items',
		tableInterfaceName: 'MaterialCatalogueItemsTable',
		entityLabel: 'Materials',
		formSchema: materialCatalogItemFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'metadata_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'materials'
		}
	},
	{
		key: 'labourRates',
		tableName: 'labour_rate_cards',
		tableInterfaceName: 'LabourRateCardsTable',
		entityLabel: 'Labour Rates',
		formSchema: labourRateCardFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'metadata_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'labour_rates'
		}
	},
	{
		key: 'equipmentRates',
		tableName: 'equipment_rate_cards',
		tableInterfaceName: 'EquipmentRateCardsTable',
		entityLabel: 'Equipment Rates',
		formSchema: equipmentRateCardFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'metadata_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'equipment_rates'
		}
	},
	{
		key: 'subcontractRates',
		tableName: 'subcontract_rate_cards',
		tableInterfaceName: 'SubcontractRateCardsTable',
		entityLabel: 'Subcontract Rates',
		formSchema: subcontractRateCardFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'metadata_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'subcontract_rates'
		}
	},
	{
		key: 'costPresets',
		tableName: 'cost_component_presets',
		tableInterfaceName: 'CostComponentPresetsTable',
		entityLabel: 'Cost Presets',
		formSchema: costComponentPresetFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'components_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'cost_presets'
		}
	},
	{
		key: 'estimateTemplates',
		tableName: 'estimate_templates',
		tableInterfaceName: 'EstimateTemplatesTable',
		entityLabel: 'Estimate Templates',
		formSchema: estimateTemplateFormSchema,
		excludedDbFieldIds: [
			'id',
			'workspace_id',
			'aliases_json',
			'estimate_json',
			'created_at',
			'updated_at'
		],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'estimate_templates'
		}
	},
	{
		key: 'classificationSystems',
		tableName: 'classification_systems',
		tableInterfaceName: 'ClassificationSystemsTable',
		entityLabel: 'Classification Systems',
		formSchema: classificationSystemFormSchema,
		excludedDbFieldIds: ['id', 'workspace_id', 'aliases_json', 'created_at'],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'classification_systems'
		}
	},
	{
		key: 'costCodes',
		tableName: 'cost_codes',
		tableInterfaceName: 'CostCodesTable',
		entityLabel: 'Cost Codes',
		formSchema: costCodeFormSchema,
		excludedDbFieldIds: ['id', 'classification_system_id', 'created_at'],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'cost_codes'
		}
	},
	{
		key: 'projectStructureTemplates',
		tableName: 'project_structure_templates',
		tableInterfaceName: 'ProjectStructureTemplatesTable',
		entityLabel: 'Project Structure Templates',
		formSchema: projectStructureTemplateFormSchema,
		excludedDbFieldIds: ['id', 'workspace_id', 'created_at', 'updated_at'],
		importSupport: {
			kind: 'setup_import',
			targetTableId: 'project_structure_templates'
		}
	}
] as const satisfies readonly WorkspaceFeatureContract[];

export const dbTableContracts = [
	{
		tableName: 'projects',
		kind: 'workspace_feature',
		reason: 'First-class RFQ list and project intake surface.',
		workspaceRecordKey: 'rfqs',
		tableInterfaceName: 'ProjectsTable'
	},
	{
		tableName: 'contacts',
		kind: 'workspace_feature',
		reason: 'First-class companies CRM surface with linked people.',
		workspaceRecordKey: 'contacts',
		tableInterfaceName: 'ContactsTable'
	},
	{
		tableName: 'contact_relationships',
		kind: 'workspace_internal',
		reason: 'CRM relationship table linking contacts to each other.',
		tableInterfaceName: 'ContactRelationshipsTable'
	},
	{
		tableName: 'company_material_links',
		kind: 'workspace_internal',
		reason: 'Junction table linking companies to material catalogue records.',
		tableInterfaceName: 'CompanyMaterialLinksTable',
		relationship: {
			companyColumn: 'company_id',
			recordTableName: 'material_catalog_items',
			recordColumn: 'material_id',
			reverseIndexName: 'idx_company_material_links_material',
			rustVariant: 'Materials',
			dialogPath: 'src/lib/components/materials/material-dialog.svelte',
			stateAuthorityPath: 'src/lib/state/materials.svelte.ts'
		}
	},
	{
		tableName: 'company_labour_rate_links',
		kind: 'workspace_internal',
		reason: 'Junction table linking companies to labour rate records.',
		tableInterfaceName: 'CompanyLabourRateLinksTable',
		relationship: {
			companyColumn: 'company_id',
			recordTableName: 'labour_rate_cards',
			recordColumn: 'labour_rate_id',
			reverseIndexName: 'idx_company_labour_rate_links_labour_rate',
			rustVariant: 'LabourRates',
			dialogPath: 'src/lib/components/labour-rates/labour-rate-dialog.svelte',
			stateAuthorityPath: 'src/lib/state/labour-rates.svelte.ts'
		}
	},
	{
		tableName: 'company_equipment_rate_links',
		kind: 'workspace_internal',
		reason: 'Junction table linking companies to equipment rate records.',
		tableInterfaceName: 'CompanyEquipmentRateLinksTable',
		relationship: {
			companyColumn: 'company_id',
			recordTableName: 'equipment_rate_cards',
			recordColumn: 'equipment_rate_id',
			reverseIndexName: 'idx_company_equipment_rate_links_equipment_rate',
			rustVariant: 'EquipmentRates',
			dialogPath: 'src/lib/components/equipment-rates/equipment-rate-dialog.svelte',
			stateAuthorityPath: 'src/lib/state/equipment-rates.svelte.ts'
		}
	},
	{
		tableName: 'company_subcontract_rate_links',
		kind: 'workspace_internal',
		reason: 'Junction table linking companies to subcontract rate records.',
		tableInterfaceName: 'CompanySubcontractRateLinksTable',
		relationship: {
			companyColumn: 'company_id',
			recordTableName: 'subcontract_rate_cards',
			recordColumn: 'subcontract_rate_id',
			reverseIndexName: 'idx_company_subcontract_rate_links_subcontract_rate',
			rustVariant: 'SubcontractRates',
			dialogPath: 'src/lib/components/subcontract-rates/subcontract-rate-dialog.svelte',
			stateAuthorityPath: 'src/lib/state/subcontract-rates.svelte.ts'
		}
	},
	{
		tableName: 'material_catalog_items',
		kind: 'workspace_feature',
		reason: 'First-class materials catalogue surface.',
		workspaceRecordKey: 'materials',
		tableInterfaceName: 'MaterialCatalogueItemsTable'
	},
	{
		tableName: 'labour_rate_cards',
		kind: 'workspace_feature',
		reason: 'First-class labour rates surface.',
		workspaceRecordKey: 'labourRates',
		tableInterfaceName: 'LabourRateCardsTable'
	},
	{
		tableName: 'equipment_rate_cards',
		kind: 'workspace_feature',
		reason: 'First-class equipment rates surface.',
		workspaceRecordKey: 'equipmentRates',
		tableInterfaceName: 'EquipmentRateCardsTable'
	},
	{
		tableName: 'subcontract_rate_cards',
		kind: 'workspace_feature',
		reason: 'First-class subcontract rates surface.',
		workspaceRecordKey: 'subcontractRates',
		tableInterfaceName: 'SubcontractRateCardsTable'
	},
	{
		tableName: 'cost_component_presets',
		kind: 'workspace_feature',
		reason: 'First-class cost preset surface.',
		workspaceRecordKey: 'costPresets',
		tableInterfaceName: 'CostComponentPresetsTable'
	},
	{
		tableName: 'estimate_templates',
		kind: 'workspace_feature',
		reason: 'First-class estimate template surface.',
		workspaceRecordKey: 'estimateTemplates',
		tableInterfaceName: 'EstimateTemplatesTable'
	},
	{
		tableName: 'classification_systems',
		kind: 'workspace_feature',
		reason: 'First-class classification system surface.',
		workspaceRecordKey: 'classificationSystems',
		tableInterfaceName: 'ClassificationSystemsTable'
	},
	{
		tableName: 'cost_codes',
		kind: 'workspace_feature',
		reason: 'First-class cost code surface.',
		workspaceRecordKey: 'costCodes',
		tableInterfaceName: 'CostCodesTable'
	},
	{
		tableName: 'project_structure_templates',
		kind: 'workspace_feature',
		reason: 'First-class reusable project structure template surface.',
		workspaceRecordKey: 'projectStructureTemplates',
		tableInterfaceName: 'ProjectStructureTemplatesTable'
	},
	{
		tableName: 'assets',
		kind: 'project_operational',
		reason: 'Project-owned estimating bundles.',
		tableInterfaceName: 'AssetsTable'
	},
	{
		tableName: 'files',
		kind: 'project_operational',
		reason: 'Project-owned vault file metadata.',
		tableInterfaceName: 'FilesTable'
	},
	{
		tableName: 'estimates',
		kind: 'project_operational',
		reason: 'Project estimate headers.',
		tableInterfaceName: 'EstimatesTable'
	},
	{
		tableName: 'takeoff_items',
		kind: 'project_operational',
		reason: 'Project estimate takeoff items.',
		tableInterfaceName: 'TakeoffItemsTable'
	},
	{
		tableName: 'cost_components',
		kind: 'project_operational',
		reason: 'Project estimate component rows.',
		tableInterfaceName: 'CostComponentsTable'
	},
	{
		tableName: 'wbs_nodes',
		kind: 'project_operational',
		reason: 'Project-local WBS hierarchy.',
		tableInterfaceName: 'WbsNodesTable'
	},
	{
		tableName: 'project_structure_template_nodes',
		kind: 'workspace_internal',
		reason: 'Child nodes for reusable project structure templates.',
		tableInterfaceName: 'ProjectStructureTemplateNodesTable'
	},
	{
		tableName: 'quote_option_presets',
		kind: 'workspace_internal',
		reason: 'Workspace-scoped reusable quote option presets copied into project quote options.',
		tableInterfaceName: 'QuoteOptionPresetsTable'
	},
	{
		tableName: 'quote_options',
		kind: 'project_operational',
		reason: 'Live project commercial options.',
		tableInterfaceName: 'QuoteOptionsTable'
	},
	{
		tableName: 'quote_revisions',
		kind: 'quote_snapshot',
		reason: 'Immutable issued quote snapshots.',
		tableInterfaceName: 'QuoteRevisionsTable'
	},
	{
		tableName: 'quote_revision_options',
		kind: 'quote_snapshot',
		reason: 'Immutable option snapshots under quote revisions.',
		tableInterfaceName: 'QuoteRevisionOptionsTable'
	},
	{
		tableName: 'ai_runs',
		kind: 'ai_audit',
		reason: 'AI run header audit records.',
		tableInterfaceName: 'AiRunsTable'
	},
	{
		tableName: 'ai_run_inputs',
		kind: 'ai_audit',
		reason: 'AI run input payload audit records.',
		tableInterfaceName: 'AiRunInputsTable'
	},
	{
		tableName: 'ai_run_outputs',
		kind: 'ai_audit',
		reason: 'AI run output payload audit records.',
		tableInterfaceName: 'AiRunOutputsTable'
	},
	{
		tableName: 'ai_evidence_cache',
		kind: 'workspace_internal',
		reason: 'File-owned reusable prepared evidence, unit extraction, and synthesis cache metadata.',
		tableInterfaceName: 'AiEvidenceCacheTable'
	},
	{
		tableName: 'ai_evidence_refs',
		kind: 'ai_audit',
		reason: 'AI evidence reference audit records.',
		tableInterfaceName: 'AiEvidenceRefsTable'
	},
	{
		tableName: 'ai_review_events',
		kind: 'ai_audit',
		reason: 'AI review event audit records.',
		tableInterfaceName: 'AiReviewEventsTable'
	},
	{
		tableName: 'ai_override_events',
		kind: 'ai_audit',
		reason: 'AI override event audit records.',
		tableInterfaceName: 'AiOverrideEventsTable'
	},
	{
		tableName: 'workspace_ai_knowledge_files',
		kind: 'workspace_internal',
		reason: 'Workspace-scoped AI knowledge file staging records.',
		tableInterfaceName: 'WorkspaceAiKnowledgeFilesTable'
	},
	{
		tableName: 'workspace_ai_feedback_entries',
		kind: 'workspace_internal',
		reason:
			'User-authored workspace AI feedback notes used as local guidance for future drafts; removable independently from AI run audit history.',
		tableInterfaceName: 'WorkspaceAiFeedbackEntriesTable'
	},
	{
		tableName: 'assistant_action_audit',
		kind: 'workspace_internal',
		reason: 'Durable assistant approval and execution audit records.',
		tableInterfaceName: 'AssistantActionAuditTable'
	},
	{
		tableName: 'setup_import_audit',
		kind: 'workspace_internal',
		reason: 'Durable setup import source and outcome audit records.',
		tableInterfaceName: 'SetupImportAuditTable'
	},
	{
		tableName: 'workspace_identity',
		kind: 'workspace_foundation',
		reason: 'Workspace boundary and bootstrap state.',
		tableInterfaceName: 'WorkspaceIdentityTable'
	},
	{
		tableName: 'workspace_profile',
		kind: 'workspace_foundation',
		reason: 'Workspace business profile authority.',
		tableInterfaceName: 'WorkspaceProfileTable'
	},
	{
		tableName: 'workspace_members',
		kind: 'workspace_foundation',
		reason: 'Workspace member list.',
		tableInterfaceName: 'WorkspaceMembersTable'
	},
	{
		tableName: 'workspace_onboarding_profile',
		kind: 'workspace_foundation',
		reason: 'Workspace onboarding profile.',
		tableInterfaceName: 'WorkspaceOnboardingProfileTable'
	},
	{
		tableName: 'runtime_contract_state',
		kind: 'workspace_internal',
		reason: 'Local runtime schema and app compatibility guard.',
		tableInterfaceName: 'RuntimeContractStateTable'
	},
	{
		tableName: 'workspace_integrations',
		kind: 'workspace_internal',
		reason: 'Provider-neutral mailbox metadata, sync cursor, and per-connection preferences.',
		tableInterfaceName: 'WorkspaceIntegrationsTable'
	},
	{
		tableName: 'email_rfq_classifications',
		kind: 'workspace_internal',
		reason: 'Versioned RFQ verdicts keyed by mailbox connection and provider message identity.',
		tableInterfaceName: 'EmailRfqClassificationsTable'
	},
	{
		tableName: 'fx_rate_snapshots',
		kind: 'workspace_internal',
		reason: 'Workspace-scoped foreign exchange rate snapshots for currency conversions.',
		tableInterfaceName: 'FxRateSnapshotsTable'
	},
	{
		tableName: 'project_file_page_chunks',
		kind: 'workspace_internal',
		reason: 'Project file page chunks for AI context retrieval.',
		tableInterfaceName: 'ProjectFilePageChunksTable'
	},
	{
		tableName: 'project_file_page_chunks_fts',
		kind: 'workspace_internal',
		reason: 'Virtual FTS5 search index for project file page chunks.',
		tableInterfaceName: 'ProjectFilePageChunksFtsTable'
	},
	{
		tableName: 'project_asset_som_grids',
		kind: 'workspace_internal',
		reason: 'Project asset Set-of-Mark grid data for visual grounding.',
		tableInterfaceName: 'ProjectAssetSomGridsTable'
	}
] as const satisfies readonly DbTableContract[];

export const contractEnumDefinitions = [
	{
		name: 'CostComponentCategory',
		values: ['material', 'labour', 'equipment', 'subcontract', 'misc'],
		requiredFiles: [
			'src/lib/types/index.ts',
			'src/lib/schemas/index.ts',
			'src-tauri/migrations-workspace/001_workspace.sql'
		]
	},
	{
		name: 'CostComponentSourceType',
		values: [
			'manual',
			'material_catalog',
			'labour_rate_card',
			'equipment_rate_card',
			'subcontract_rate_card'
		],
		requiredFiles: [
			'src/lib/types/index.ts',
			'src/lib/schemas/index.ts',
			'src-tauri/migrations-workspace/001_workspace.sql'
		]
	}
] as const satisfies readonly EnumContractDefinition[];
