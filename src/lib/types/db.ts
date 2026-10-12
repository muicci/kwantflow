// Generated automatically from SQLite migrations. Do not edit manually.

import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
	EquipmentRateUnitCode,
	LabourRateUnitCode,
	MaterialUnitCode,
	SubcontractRateUnitCode,
	SupportedCurrencyCode
} from '../constants/index.js';

export interface AiEvidenceCacheTable {
	id: string;
	file_id: string;
	cache_kind: string;
	source_content_hash: string;
	evidence_unit_key: string;
	evidence_unit_hash: string;
	preparation_version: string;
	extraction_version: Generated<string>;
	synthesis_version: Generated<string>;
	model_runtime_id: Generated<string>;
	payload_json: Generated<string>;
	artifact_path: string | null;
	byte_size: Generated<number>;
	created_at: Generated<string>;
	last_accessed_at: Generated<string>;
}

export type AiEvidenceCacheRow = Selectable<AiEvidenceCacheTable>;
export type NewAiEvidenceCache = Insertable<AiEvidenceCacheTable>;
export type AiEvidenceCacheUpdate = Updateable<AiEvidenceCacheTable>;

export interface AiEvidenceRefsTable {
	id: string;
	run_id: string;
	asset_id: string;
	file_id: string | null;
	file_name: string;
	quote_path: string;
	summary: string;
	created_at: Generated<string>;
	artifact_kind: Generated<'text' | 'pdf' | 'image' | 'cad'>;
	page_number: number | null;
	view_label: string | null;
	evidence_identifier: Generated<string>;
	locator_json: Generated<string>;
	draft_entity_kind: Generated<string>;
	draft_entity_key: Generated<string>;
	confidence_json: Generated<string>;
}

export type AiEvidenceRefRow = Selectable<AiEvidenceRefsTable>;
export type NewAiEvidenceRef = Insertable<AiEvidenceRefsTable>;
export type AiEvidenceRefUpdate = Updateable<AiEvidenceRefsTable>;

export interface AiOverrideEventsTable {
	id: string;
	run_id: string;
	asset_id: string;
	field_path: string;
	original_value_json: string;
	final_value_json: string;
	created_at: Generated<string>;
}

export type AiOverrideEventRow = Selectable<AiOverrideEventsTable>;
export type NewAiOverrideEvent = Insertable<AiOverrideEventsTable>;
export type AiOverrideEventUpdate = Updateable<AiOverrideEventsTable>;

export interface AiReviewEventsTable {
	id: string;
	run_id: string;
	asset_id: string;
	event_type: string;
	event_payload_json: string;
	created_at: Generated<string>;
}

export type AiReviewEventRow = Selectable<AiReviewEventsTable>;
export type NewAiReviewEvent = Insertable<AiReviewEventsTable>;
export type AiReviewEventUpdate = Updateable<AiReviewEventsTable>;

export interface AiRunInputsTable {
	id: string;
	run_id: string;
	input_kind: string;
	payload_json: string;
	created_at: Generated<string>;
	payload_hash: Generated<string>;
	contract_version: Generated<string>;
	stage_name: Generated<string>;
}

export type AiRunInputRow = Selectable<AiRunInputsTable>;
export type NewAiRunInput = Insertable<AiRunInputsTable>;
export type AiRunInputUpdate = Updateable<AiRunInputsTable>;

export interface AiRunOutputsTable {
	id: string;
	run_id: string;
	output_kind: string;
	payload_json: string;
	created_at: Generated<string>;
	payload_hash: Generated<string>;
	contract_version: Generated<string>;
	stage_name: Generated<string>;
}

export type AiRunOutputRow = Selectable<AiRunOutputsTable>;
export type NewAiRunOutput = Insertable<AiRunOutputsTable>;
export type AiRunOutputUpdate = Updateable<AiRunOutputsTable>;

export interface AiRunsTable {
	id: string;
	asset_id: string;
	provider: string;
	model_id: string;
	status: string;
	trigger_source: string;
	started_at: string;
	completed_at: string | null;
	failed_at: string | null;
	cancelled_at: string | null;
	error_message: string | null;
	usage_json: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	prompt_contract_version: Generated<string>;
	context_fingerprint: Generated<string>;
	failure_kind: Generated<string>;
	failure_stage: Generated<string>;
}

export type AiRunRow = Selectable<AiRunsTable>;
export type NewAiRun = Insertable<AiRunsTable>;
export type AiRunUpdate = Updateable<AiRunsTable>;

export interface AssetsTable {
	id: string;
	project_id: string;
	display_name: string;
	thumbnail_file_id: string | null;
	is_selected: Generated<number>;
	created_at: Generated<string>;
	quote_quantity: Generated<number>;
	is_pdf_included: Generated<number>;
}

export type AssetRow = Selectable<AssetsTable>;
export type NewAsset = Insertable<AssetsTable>;
export type AssetUpdate = Updateable<AssetsTable>;

export interface AssistantActionAuditTable {
	id: string;
	workspace_id: string;
	turn_id: string;
	action_id: string;
	proposal_id: string;
	tool_name: string;
	status: 'proposed' | 'validated' | 'rejected' | 'approved' | 'executed' | 'failed';
	item_count: Generated<number>;
	issue_count: Generated<number>;
	error_count: Generated<number>;
	payload_json: Generated<string>;
	error_message: string | null;
	created_at: Generated<string>;
}

export type AssistantActionAuditRow = Selectable<AssistantActionAuditTable>;
export type NewAssistantActionAudit = Insertable<AssistantActionAuditTable>;
export type AssistantActionAuditUpdate = Updateable<AssistantActionAuditTable>;

export interface ClassificationSystemsTable {
	id: string;
	workspace_id: string;
	name: string;
	code: string;
	classification_type: string;
	is_default: Generated<number>;
	created_at: Generated<string>;
	aliases_json: Generated<string>;
}

export type ClassificationSystemRow = Selectable<ClassificationSystemsTable>;
export type NewClassificationSystem = Insertable<ClassificationSystemsTable>;
export type ClassificationSystemUpdate = Updateable<ClassificationSystemsTable>;

export interface CompanyEquipmentRateLinksTable {
	company_id: string;
	equipment_rate_id: string;
	created_at: Generated<string>;
}

export type CompanyEquipmentRateLinkRow = Selectable<CompanyEquipmentRateLinksTable>;
export type NewCompanyEquipmentRateLink = Insertable<CompanyEquipmentRateLinksTable>;
export type CompanyEquipmentRateLinkUpdate = Updateable<CompanyEquipmentRateLinksTable>;

export interface CompanyLabourRateLinksTable {
	company_id: string;
	labour_rate_id: string;
	created_at: Generated<string>;
}

export type CompanyLabourRateLinkRow = Selectable<CompanyLabourRateLinksTable>;
export type NewCompanyLabourRateLink = Insertable<CompanyLabourRateLinksTable>;
export type CompanyLabourRateLinkUpdate = Updateable<CompanyLabourRateLinksTable>;

export interface CompanyMaterialLinksTable {
	company_id: string;
	material_id: string;
	created_at: Generated<string>;
}

export type CompanyMaterialLinkRow = Selectable<CompanyMaterialLinksTable>;
export type NewCompanyMaterialLink = Insertable<CompanyMaterialLinksTable>;
export type CompanyMaterialLinkUpdate = Updateable<CompanyMaterialLinksTable>;

export interface CompanySubcontractRateLinksTable {
	company_id: string;
	subcontract_rate_id: string;
	created_at: Generated<string>;
}

export type CompanySubcontractRateLinkRow = Selectable<CompanySubcontractRateLinksTable>;
export type NewCompanySubcontractRateLink = Insertable<CompanySubcontractRateLinksTable>;
export type CompanySubcontractRateLinkUpdate = Updateable<CompanySubcontractRateLinksTable>;

export interface ContactRelationshipsTable {
	id: string;
	workspace_id: string;
	from_contact_id: string;
	to_contact_id: string;
	relationship_type: string;
	is_primary: Generated<number>;
	notes: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type ContactRelationshipRow = Selectable<ContactRelationshipsTable>;
export type NewContactRelationship = Insertable<ContactRelationshipsTable>;
export type ContactRelationshipUpdate = Updateable<ContactRelationshipsTable>;

export interface ContactsTable {
	id: string;
	workspace_id: string;
	sort_order: Generated<number>;
	name: string;
	contact_name: string | null;
	email: string | null;
	phone: string | null;
	abn: string | null;
	address: string | null;
	notes: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	country_code: Generated<string>;
	business_id_label: Generated<string>;
	business_id_value: string | null;
	tax_id_label: Generated<string>;
	tax_id_value: string | null;
	phone_e164: Generated<string>;
	phone_country_code: Generated<string>;
	kind: Generated<string>;
	display_name: string | null;
	company_name: string | null;
	person_first_name: string | null;
	person_last_name: string | null;
	role_title: string | null;
	linked_company_id: string | null;
	is_primary_company_contact: Generated<number>;
	roles_json: Generated<string>;
	tags_json: Generated<string>;
	is_active: Generated<number>;
	logo_file_path: string | null;
	custom_role_label: string | null;
	website: string | null;
}

export type ContactRow = Selectable<ContactsTable>;
export type NewContact = Insertable<ContactsTable>;
export type ContactUpdate = Updateable<ContactsTable>;

export interface CostCodesTable {
	id: string;
	classification_system_id: string;
	parent_id: string | null;
	code: string;
	name: string;
	description: Generated<string>;
	is_active: Generated<number>;
	sort_order: Generated<number>;
	created_at: Generated<string>;
}

export type CostCodeRow = Selectable<CostCodesTable>;
export type NewCostCode = Insertable<CostCodesTable>;
export type CostCodeUpdate = Updateable<CostCodesTable>;

export interface CostComponentPresetsTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	description: Generated<string>;
	components_json: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	aliases_json: Generated<string>;
}

export type CostComponentPresetRow = Selectable<CostComponentPresetsTable>;
export type NewCostComponentPreset = Insertable<CostComponentPresetsTable>;
export type CostComponentPresetUpdate = Updateable<CostComponentPresetsTable>;

export interface CostComponentsTable {
	id: string;
	takeoff_item_id: string;
	category: string;
	source_type: string;
	source_id: string | null;
	name: Generated<string>;
	description: Generated<string>;
	quantity: Generated<number>;
	unit: Generated<string>;
	unit_rate: Generated<number>;
	formula_json: Generated<string>;
	metadata_json: Generated<string>;
	sort_order: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	source_unit_rate_decimal: string | null;
	source_currency_code: string | null;
	fx_rate_snapshot_id: string | null;
}

export type CostComponentRow = Selectable<CostComponentsTable>;
export type NewCostComponent = Insertable<CostComponentsTable>;
export type CostComponentUpdate = Updateable<CostComponentsTable>;

export interface EmailRfqClassificationsTable {
	integration_id: string;
	provider_message_id: string;
	classifier_version: string;
	verdict: string;
	model_id: string;
	classified_at: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type EmailRfqClassificationRow = Selectable<EmailRfqClassificationsTable>;
export type NewEmailRfqClassification = Insertable<EmailRfqClassificationsTable>;
export type EmailRfqClassificationUpdate = Updateable<EmailRfqClassificationsTable>;

export interface EquipmentRateCardsTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	category: string | null;
	work_center: string | null;
	unit: EquipmentRateUnitCode;
	default_rate: Generated<number>;
	aliases_json: Generated<string>;
	metadata_json: Generated<string>;
	effective_date: string | null;
	verified_date: string | null;
	rate_basis: Generated<string>;
	lead_time: Generated<string>;
	availability: Generated<string>;
	reference: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	currency_code: SupportedCurrencyCode | null;
}

export type EquipmentRateCardRow = Selectable<EquipmentRateCardsTable>;
export type NewEquipmentRateCard = Insertable<EquipmentRateCardsTable>;
export type EquipmentRateCardUpdate = Updateable<EquipmentRateCardsTable>;

export interface EstimateTemplatesTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	description: Generated<string>;
	estimate_json: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	aliases_json: Generated<string>;
}

export type EstimateTemplatRow = Selectable<EstimateTemplatesTable>;
export type NewEstimateTemplat = Insertable<EstimateTemplatesTable>;
export type EstimateTemplatUpdate = Updateable<EstimateTemplatesTable>;

export interface EstimatesTable {
	asset_id: string | null;
	scope_summary: Generated<string>;
	notes: Generated<string>;
	classification_system_id: string | null;
	wbs_root_node_id: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	applied_template_id: string | null;
	applied_template_name: string | null;
	currency_code: string | null;
}

export type EstimatRow = Selectable<EstimatesTable>;
export type NewEstimat = Insertable<EstimatesTable>;
export type EstimatUpdate = Updateable<EstimatesTable>;

export interface FilesTable {
	id: string;
	project_id: string;
	asset_id: string | null;
	file_path: string;
	original_name: string;
	mime_type: string | null;
	created_at: Generated<string>;
	byte_size: Generated<number>;
	content_hash: string | null;
	checksum_algorithm: Generated<string>;
	document_type: Generated<string>;
	revision_label: Generated<string>;
	received_at: string | null;
	source_label: Generated<string>;
	source_metadata_json: Generated<string>;
}

export type FilRow = Selectable<FilesTable>;
export type NewFil = Insertable<FilesTable>;
export type FilUpdate = Updateable<FilesTable>;

export interface FxRateSnapshotsTable {
	id: string;
	workspace_id: string;
	from_currency_code: string;
	to_currency_code: string;
	rate_decimal: string;
	source: Generated<string>;
	effective_at: string;
	created_at: Generated<string>;
}

export type FxRateSnapshotRow = Selectable<FxRateSnapshotsTable>;
export type NewFxRateSnapshot = Insertable<FxRateSnapshotsTable>;
export type FxRateSnapshotUpdate = Updateable<FxRateSnapshotsTable>;

export interface LabourRateCardsTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	category: string | null;
	work_center: string | null;
	unit: LabourRateUnitCode;
	default_rate: Generated<number>;
	aliases_json: Generated<string>;
	metadata_json: Generated<string>;
	effective_date: string | null;
	verified_date: string | null;
	rate_basis: Generated<string>;
	lead_time: Generated<string>;
	availability: Generated<string>;
	reference: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	currency_code: SupportedCurrencyCode | null;
}

export type LabourRateCardRow = Selectable<LabourRateCardsTable>;
export type NewLabourRateCard = Insertable<LabourRateCardsTable>;
export type LabourRateCardUpdate = Updateable<LabourRateCardsTable>;

export interface MaterialCatalogueItemsTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	category: string | null;
	specification: string | null;
	unit: MaterialUnitCode;
	default_rate: Generated<number>;
	metadata_json: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	aliases_json: Generated<string>;
	effective_date: string | null;
	verified_date: string | null;
	rate_basis: Generated<string>;
	lead_time: Generated<string>;
	availability: Generated<string>;
	reference: Generated<string>;
	currency_code: SupportedCurrencyCode | null;
}

export type MaterialCatalogueItemRow = Selectable<MaterialCatalogueItemsTable>;
export type NewMaterialCatalogueItem = Insertable<MaterialCatalogueItemsTable>;
export type MaterialCatalogueItemUpdate = Updateable<MaterialCatalogueItemsTable>;

export interface ProjectAssetSomGridsTable {
	id: string;
	file_id: string;
	page_number: number | null;
	grid_rows: number;
	grid_cols: number;
	grid_data_json: string | null;
	created_at: Generated<string>;
}

export type ProjectAssetSomGridRow = Selectable<ProjectAssetSomGridsTable>;
export type NewProjectAssetSomGrid = Insertable<ProjectAssetSomGridsTable>;
export type ProjectAssetSomGridUpdate = Updateable<ProjectAssetSomGridsTable>;

export interface ProjectFilePageChunksTable {
	id: string;
	file_id: string;
	page_number: number;
	chunk_index: number;
	text_content: string;
	word_count: number;
	created_at: Generated<string>;
}

export type ProjectFilePageChunkRow = Selectable<ProjectFilePageChunksTable>;
export type NewProjectFilePageChunk = Insertable<ProjectFilePageChunksTable>;
export type ProjectFilePageChunkUpdate = Updateable<ProjectFilePageChunksTable>;

export interface ProjectFilePageChunksFtsTable {
	id: string;
	text_content: string | null;
}

export type ProjectFilePageChunkFtRow = Selectable<ProjectFilePageChunksFtsTable>;
export type NewProjectFilePageChunkFt = Insertable<ProjectFilePageChunksFtsTable>;
export type ProjectFilePageChunkFtUpdate = Updateable<ProjectFilePageChunksFtsTable>;

export interface ProjectStructureTemplateNodesTable {
	id: string;
	template_id: string;
	parent_id: string | null;
	code: string | null;
	name: string;
	type: string;
	sort_order: Generated<number>;
	created_at: Generated<string>;
}

export type ProjectStructureTemplateNodRow = Selectable<ProjectStructureTemplateNodesTable>;
export type NewProjectStructureTemplateNod = Insertable<ProjectStructureTemplateNodesTable>;
export type ProjectStructureTemplateNodUpdate = Updateable<ProjectStructureTemplateNodesTable>;

export interface ProjectStructureTemplatesTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	description: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type ProjectStructureTemplatRow = Selectable<ProjectStructureTemplatesTable>;
export type NewProjectStructureTemplat = Insertable<ProjectStructureTemplatesTable>;
export type ProjectStructureTemplatUpdate = Updateable<ProjectStructureTemplatesTable>;

export interface ProjectsTable {
	id: string;
	workspace_id: string;
	rfq_number: string;
	project_name: string | null;
	due_date: string | null;
	priority: Generated<string>;
	status: Generated<string>;
	content: string | null;
	note: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	sort_order: Generated<number>;
	is_favourite: Generated<number>;
	contact_id: string | null;
	contact_name_snapshot: string | null;
	requester_contact_id: string | null;
	requester_name_snapshot: string | null;
	source_channel: Generated<string>;
	source_reference: string | null;
	quote_round_prices: Generated<number>;
	received_date: string | null;
	submission_deadline_at: string | null;
	estimator_name: Generated<string>;
	customer_tender_reference: Generated<string>;
	addendum_label: Generated<string>;
	addendum_date: string | null;
	addendum_notes: Generated<string>;
	site_address: Generated<string>;
	delivery_address: Generated<string>;
	quote_recipient_contact_id: string | null;
	source_email_message_id: string | null;
	source_email_integration_id: string | null;
}

export type ProjectRow = Selectable<ProjectsTable>;
export type NewProject = Insertable<ProjectsTable>;
export type ProjectUpdate = Updateable<ProjectsTable>;

export interface QuoteOptionPresetsTable {
	id: string;
	workspace_id: string;
	label: string;
	lead_time: Generated<string>;
	markup_percentage: Generated<number>;
	notes: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	material_markup_percentage: number | null;
	labour_markup_percentage: number | null;
	equipment_markup_percentage: number | null;
	subcontract_markup_percentage: number | null;
}

export type QuoteOptionPresetRow = Selectable<QuoteOptionPresetsTable>;
export type NewQuoteOptionPreset = Insertable<QuoteOptionPresetsTable>;
export type QuoteOptionPresetUpdate = Updateable<QuoteOptionPresetsTable>;

export interface QuoteOptionsTable {
	id: string;
	project_id: string;
	label: string;
	lead_time: Generated<string>;
	markup_percentage: Generated<number>;
	notes: Generated<string>;
	sort_order: Generated<number>;
	is_default: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	material_markup_percentage: number | null;
	labour_markup_percentage: number | null;
	equipment_markup_percentage: number | null;
	subcontract_markup_percentage: number | null;
}

export type QuoteOptionRow = Selectable<QuoteOptionsTable>;
export type NewQuoteOption = Insertable<QuoteOptionsTable>;
export type QuoteOptionUpdate = Updateable<QuoteOptionsTable>;

export interface QuoteRevisionOptionsTable {
	id: string;
	revision_id: string;
	source_quote_option_id: string | null;
	label: string;
	lead_time: string;
	markup_percentage: Generated<number>;
	notes: Generated<string>;
	sort_order: Generated<number>;
	is_default: Generated<number>;
	is_selected: Generated<number>;
	line_items_json: Generated<string>;
	subtotal_amount: Generated<number>;
	gst_amount: Generated<number>;
	total_amount: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type QuoteRevisionOptionRow = Selectable<QuoteRevisionOptionsTable>;
export type NewQuoteRevisionOption = Insertable<QuoteRevisionOptionsTable>;
export type QuoteRevisionOptionUpdate = Updateable<QuoteRevisionOptionsTable>;

export interface QuoteRevisionsTable {
	id: string;
	project_id: string;
	revision_number: number;
	revision_label: string;
	rfq_number_snapshot: string;
	contact_name_snapshot: string | null;
	project_name_snapshot: string | null;
	business_name_snapshot: string;
	business_abn_snapshot: string | null;
	business_address_snapshot: string | null;
	business_email_snapshot: string | null;
	currency_code_snapshot: string;
	currency_symbol_snapshot: string;
	issued_date: string;
	valid_until_date: string;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	business_contact_name_snapshot: string | null;
	business_contact_phone_snapshot: string | null;
	business_id_label_snapshot: string | null;
	business_id_value_snapshot: string | null;
	tax_id_label_snapshot: string | null;
	tax_id_value_snapshot: string | null;
	contact_country_code_snapshot: string | null;
	contact_business_id_label_snapshot: string | null;
	contact_business_id_value_snapshot: string | null;
	contact_tax_id_label_snapshot: string | null;
	contact_tax_id_value_snapshot: string | null;
	tax_display_label_snapshot: string | null;
	tax_rate_percentage_snapshot: number | null;
	package_attachments_json: Generated<string>;
	sent_status: Generated<string>;
	sent_date: string | null;
	sent_method: Generated<string>;
	recipient_snapshot_json: Generated<string>;
	terms_snapshot_json: Generated<string>;
	quote_number_snapshot: Generated<string>;
	revision_reason: Generated<string>;
}

export type QuoteRevisionRow = Selectable<QuoteRevisionsTable>;
export type NewQuoteRevision = Insertable<QuoteRevisionsTable>;
export type QuoteRevisionUpdate = Updateable<QuoteRevisionsTable>;

export interface RuntimeContractStateTable {
	id: string;
	schema_version: number;
	last_opened_app_version: string;
	minimum_supported_app_version: string | null;
	contract_status: Generated<string>;
	last_checked_at: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type RuntimeContractStateRow = Selectable<RuntimeContractStateTable>;
export type NewRuntimeContractState = Insertable<RuntimeContractStateTable>;
export type RuntimeContractStateUpdate = Updateable<RuntimeContractStateTable>;

export interface SetupImportAuditTable {
	id: string;
	workspace_id: string;
	source_file_name: string;
	source_content_hash: string;
	imported_sheet_ids_json: Generated<string>;
	duplicate_modes_json: Generated<string>;
	created_count: Generated<number>;
	updated_count: Generated<number>;
	skipped_count: Generated<number>;
	failure_summary: string | null;
	created_at: Generated<string>;
}

export type SetupImportAuditRow = Selectable<SetupImportAuditTable>;
export type NewSetupImportAudit = Insertable<SetupImportAuditTable>;
export type SetupImportAuditUpdate = Updateable<SetupImportAuditTable>;

export interface SubcontractRateCardsTable {
	id: string;
	workspace_id: string;
	code: string | null;
	name: string;
	category: string | null;
	unit: SubcontractRateUnitCode;
	default_rate: Generated<number>;
	aliases_json: Generated<string>;
	metadata_json: Generated<string>;
	effective_date: string | null;
	verified_date: string | null;
	rate_basis: Generated<string>;
	lead_time: Generated<string>;
	availability: Generated<string>;
	reference: Generated<string>;
	is_active: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	currency_code: SupportedCurrencyCode | null;
}

export type SubcontractRateCardRow = Selectable<SubcontractRateCardsTable>;
export type NewSubcontractRateCard = Insertable<SubcontractRateCardsTable>;
export type SubcontractRateCardUpdate = Updateable<SubcontractRateCardsTable>;

export interface TakeoffItemsTable {
	id: string;
	estimate_asset_id: string;
	parent_id: string | null;
	wbs_node_id: string | null;
	cost_code_id: string | null;
	name: Generated<string>;
	description: Generated<string>;
	quantity: Generated<number>;
	unit: Generated<string>;
	properties_json: Generated<string>;
	sort_order: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	applied_preset_id: string | null;
	applied_preset_name: string | null;
}

export type TakeoffItemRow = Selectable<TakeoffItemsTable>;
export type NewTakeoffItem = Insertable<TakeoffItemsTable>;
export type TakeoffItemUpdate = Updateable<TakeoffItemsTable>;

export interface WbsNodesTable {
	id: string;
	project_id: string;
	parent_id: string | null;
	code: string | null;
	name: string;
	type: string;
	sort_order: Generated<number>;
	created_at: Generated<string>;
}

export type WbNodRow = Selectable<WbsNodesTable>;
export type NewWbNod = Insertable<WbsNodesTable>;
export type WbNodUpdate = Updateable<WbsNodesTable>;

export interface WorkspaceAiFeedbackEntriesTable {
	id: string;
	workspace_id: string;
	run_id: string;
	asset_id: string | null;
	estimate_id: string | null;
	feedback_text: string;
	created_at: Generated<string>;
}

export type WorkspaceAiFeedbackEntryRow = Selectable<WorkspaceAiFeedbackEntriesTable>;
export type NewWorkspaceAiFeedbackEntry = Insertable<WorkspaceAiFeedbackEntriesTable>;
export type WorkspaceAiFeedbackEntryUpdate = Updateable<WorkspaceAiFeedbackEntriesTable>;

export interface WorkspaceAiKnowledgeFilesTable {
	id: string;
	workspace_id: string;
	file_path: string;
	original_name: string;
	mime_type: string | null;
	byte_size: Generated<number>;
	extracted_text: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type WorkspaceAiKnowledgeFilRow = Selectable<WorkspaceAiKnowledgeFilesTable>;
export type NewWorkspaceAiKnowledgeFil = Insertable<WorkspaceAiKnowledgeFilesTable>;
export type WorkspaceAiKnowledgeFilUpdate = Updateable<WorkspaceAiKnowledgeFilesTable>;

export interface WorkspaceIdentityTable {
	id: string;
	bootstrap_completed_at: string | null;
	onboarding_version: Generated<number>;
	workspace_role: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	onboarding_completed_at: string | null;
}

export type WorkspaceIdentityRow = Selectable<WorkspaceIdentityTable>;
export type NewWorkspaceIdentity = Insertable<WorkspaceIdentityTable>;
export type WorkspaceIdentityUpdate = Updateable<WorkspaceIdentityTable>;

export interface WorkspaceIntegrationsTable {
	id: string;
	workspace_id: string;
	provider: string;
	label: string;
	status: Generated<string>;
	external_id: string | null;
	external_name: string | null;
	config: Generated<string | null>;
	token_expires_at: number | null;
	last_error: string | null;
	connected_at: Generated<string>;
	updated_at: Generated<string>;
	created_at: Generated<string>;
	rfq_detection_enabled: Generated<number>;
	polling_interval: Generated<string>;
	sync_cursor: string | null;
	last_synced_at: string | null;
}

export type WorkspaceIntegrationRow = Selectable<WorkspaceIntegrationsTable>;
export type NewWorkspaceIntegration = Insertable<WorkspaceIntegrationsTable>;
export type WorkspaceIntegrationUpdate = Updateable<WorkspaceIntegrationsTable>;

export interface WorkspaceMembersTable {
	id: string;
	workspace_id: string;
	role: string;
	display_name: Generated<string>;
	email: Generated<string>;
	avatar_path: Generated<string>;
	is_primary: Generated<number>;
	joined_at: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	first_name: Generated<string>;
	last_name: Generated<string>;
}

export type WorkspaceMemberRow = Selectable<WorkspaceMembersTable>;
export type NewWorkspaceMember = Insertable<WorkspaceMembersTable>;
export type WorkspaceMemberUpdate = Updateable<WorkspaceMembersTable>;

export interface WorkspaceOnboardingProfileTable {
	workspace_id: string | null;
	primary_operator_role: Generated<string>;
	industry: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type WorkspaceOnboardingProfileRow = Selectable<WorkspaceOnboardingProfileTable>;
export type NewWorkspaceOnboardingProfile = Insertable<WorkspaceOnboardingProfileTable>;
export type WorkspaceOnboardingProfileUpdate = Updateable<WorkspaceOnboardingProfileTable>;

export interface WorkspaceProfileTable {
	workspace_id: string | null;
	display_name: Generated<string>;
	country_code: Generated<string>;
	business_name: Generated<string>;
	business_id_label: Generated<string>;
	business_id_value: Generated<string>;
	tax_id_label: Generated<string>;
	tax_id_value: Generated<string>;
	tax_display_label: Generated<string>;
	tax_rate_percentage: Generated<number>;
	abn: Generated<string>;
	business_address: Generated<string>;
	business_contact_name: Generated<string>;
	business_contact_email: Generated<string>;
	business_contact_phone: Generated<string>;
	business_contact_phone_e164: Generated<string>;
	business_contact_phone_country_code: Generated<string>;
	currency_code: Generated<string>;
	currency_symbol: Generated<string>;
	measurement_unit: Generated<string>;
	date_format: Generated<string>;
	language_locale: Generated<string>;
	number_locale: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	ai_playbook_text: Generated<string>;
	logo_file_path: Generated<string>;
	business_contact_first_name: Generated<string>;
	business_contact_last_name: Generated<string>;
	quote_payment_terms: Generated<string>;
	quote_validity_days: Generated<number>;
	quote_default_inclusions: Generated<string>;
	quote_default_exclusions: Generated<string>;
	quote_default_terms: Generated<string>;
	quote_number_prefix: Generated<string>;
	quote_number_format: Generated<string>;
	email_signature: Generated<string>;
}

export type WorkspaceProfileRow = Selectable<WorkspaceProfileTable>;
export type NewWorkspaceProfile = Insertable<WorkspaceProfileTable>;
export type WorkspaceProfileUpdate = Updateable<WorkspaceProfileTable>;

export interface ControlContractStateTable {
	id: string;
	schema_version: number;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type ControlContractStateRow = Selectable<ControlContractStateTable>;
export type NewControlContractState = Insertable<ControlContractStateTable>;
export type ControlContractStateUpdate = Updateable<ControlContractStateTable>;

export interface ControlCustomerIdentityTable {
	id: string;
	profile_id: string;
	display_name: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type ControlCustomerIdentityRow = Selectable<ControlCustomerIdentityTable>;
export type NewControlCustomerIdentity = Insertable<ControlCustomerIdentityTable>;
export type ControlCustomerIdentityUpdate = Updateable<ControlCustomerIdentityTable>;

export interface OnboardingStateTable {
	id: string;
	current_step: Generated<string>;
	profile_completed_at: string | null;
	first_workspace_created_at: string | null;
	import_decided_at: string | null;
	local_ai_decided_at: string | null;
	completed_at: string | null;
	active_workspace_id: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type OnboardingStateRow = Selectable<OnboardingStateTable>;
export type NewOnboardingState = Insertable<OnboardingStateTable>;
export type OnboardingStateUpdate = Updateable<OnboardingStateTable>;

export interface ProfileIdentityTable {
	id: string;
	display_name: Generated<string>;
	email: string | null;
	phone: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	first_name: Generated<string>;
	last_name: Generated<string>;
}

export type ProfileIdentityRow = Selectable<ProfileIdentityTable>;
export type NewProfileIdentity = Insertable<ProfileIdentityTable>;
export type ProfileIdentityUpdate = Updateable<ProfileIdentityTable>;

export interface WorkspaceRegistryTable {
	id: string;
	customer_id: string;
	display_name: string;
	slug: string;
	db_path: string;
	vault_root_path: string;
	is_default: Generated<number>;
	last_opened_at: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export type WorkspaceRegistryRow = Selectable<WorkspaceRegistryTable>;
export type NewWorkspaceRegistry = Insertable<WorkspaceRegistryTable>;
export type WorkspaceRegistryUpdate = Updateable<WorkspaceRegistryTable>;

export interface ControlDB {
	control_contract_state: ControlContractStateTable;
	control_customer_identity: ControlCustomerIdentityTable;
	onboarding_state: OnboardingStateTable;
	profile_identity: ProfileIdentityTable;
	workspace_registry: WorkspaceRegistryTable;
}

export interface DB {
	ai_evidence_cache: AiEvidenceCacheTable;
	ai_evidence_refs: AiEvidenceRefsTable;
	ai_override_events: AiOverrideEventsTable;
	ai_review_events: AiReviewEventsTable;
	ai_run_inputs: AiRunInputsTable;
	ai_run_outputs: AiRunOutputsTable;
	ai_runs: AiRunsTable;
	assets: AssetsTable;
	assistant_action_audit: AssistantActionAuditTable;
	classification_systems: ClassificationSystemsTable;
	company_equipment_rate_links: CompanyEquipmentRateLinksTable;
	company_labour_rate_links: CompanyLabourRateLinksTable;
	company_material_links: CompanyMaterialLinksTable;
	company_subcontract_rate_links: CompanySubcontractRateLinksTable;
	contact_relationships: ContactRelationshipsTable;
	contacts: ContactsTable;
	cost_codes: CostCodesTable;
	cost_component_presets: CostComponentPresetsTable;
	cost_components: CostComponentsTable;
	email_rfq_classifications: EmailRfqClassificationsTable;
	equipment_rate_cards: EquipmentRateCardsTable;
	estimate_templates: EstimateTemplatesTable;
	estimates: EstimatesTable;
	files: FilesTable;
	fx_rate_snapshots: FxRateSnapshotsTable;
	labour_rate_cards: LabourRateCardsTable;
	material_catalog_items: MaterialCatalogueItemsTable;
	project_asset_som_grids: ProjectAssetSomGridsTable;
	project_file_page_chunks: ProjectFilePageChunksTable;
	project_file_page_chunks_fts: ProjectFilePageChunksFtsTable;
	project_structure_template_nodes: ProjectStructureTemplateNodesTable;
	project_structure_templates: ProjectStructureTemplatesTable;
	projects: ProjectsTable;
	quote_option_presets: QuoteOptionPresetsTable;
	quote_options: QuoteOptionsTable;
	quote_revision_options: QuoteRevisionOptionsTable;
	quote_revisions: QuoteRevisionsTable;
	runtime_contract_state: RuntimeContractStateTable;
	setup_import_audit: SetupImportAuditTable;
	subcontract_rate_cards: SubcontractRateCardsTable;
	takeoff_items: TakeoffItemsTable;
	wbs_nodes: WbsNodesTable;
	workspace_ai_feedback_entries: WorkspaceAiFeedbackEntriesTable;
	workspace_ai_knowledge_files: WorkspaceAiKnowledgeFilesTable;
	workspace_identity: WorkspaceIdentityTable;
	workspace_integrations: WorkspaceIntegrationsTable;
	workspace_members: WorkspaceMembersTable;
	workspace_onboarding_profile: WorkspaceOnboardingProfileTable;
	workspace_profile: WorkspaceProfileTable;
}
