use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddProjectFileInput {
    pub file_id: String,
    pub project_id: String,
    pub asset_id: Option<String>,
    pub file_path: String,
    pub original_name: String,
    pub mime_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteFileInput {
    pub file_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteFileResult {
    pub file_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteQuoteOptionInput {
    pub option_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteCatalogueItemsInput {
    pub scope: CatalogueCompanyLinkScope,
    pub ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CatalogueCompanyLinkScope {
    Materials,
    LabourRates,
    EquipmentRates,
    SubcontractRates,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceCatalogueRecordCompanyLinksInput {
    pub scope: CatalogueCompanyLinkScope,
    pub record_id: String,
    pub company_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceCompanyCatalogueLinksInput {
    pub company_id: String,
    pub material_ids: Vec<String>,
    pub labour_rate_ids: Vec<String>,
    pub equipment_rate_ids: Vec<String>,
    pub subcontract_rate_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedCompanySummary {
    pub id: String,
    pub display_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedCatalogueRecordSummary {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogueRecordCompanyLinksResult {
    pub scope: CatalogueCompanyLinkScope,
    pub record_id: String,
    pub companies: Vec<LinkedCompanySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanyCatalogueLinksResult {
    pub company_id: String,
    pub materials: Vec<LinkedCatalogueRecordSummary>,
    pub labour_rates: Vec<LinkedCatalogueRecordSummary>,
    pub equipment_rates: Vec<LinkedCatalogueRecordSummary>,
    pub subcontract_rates: Vec<LinkedCatalogueRecordSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetDefaultQuoteOptionInput {
    pub option_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapFoundationInput {
    pub now: String,
    pub workspace_id: String,
    pub primary_member_id: String,
    pub onboarding_version: i64,
    pub member_email: String,
    pub avatar_path: String,
    pub workspace_role: String,
    pub onboarding_completed_at: Option<String>,
    pub display_name: String,
    pub country_code: String,
    pub business_name: String,
    pub logo_file_path: String,
    pub business_id_label: String,
    pub business_id_value: String,
    pub tax_id_label: String,
    pub tax_id_value: String,
    pub tax_display_label: String,
    pub tax_rate_percentage: f64,
    pub business_contact_name: String,
    pub business_contact_first_name: String,
    pub business_contact_last_name: String,
    pub business_contact_email: String,
    pub business_contact_phone: String,
    pub business_contact_phone_e164: String,
    pub business_contact_phone_country_code: String,
    pub currency_code: String,
    pub currency_symbol: String,
    pub measurement_unit: String,
    pub date_format: String,
    pub language_locale: String,
    pub number_locale: String,
    pub primary_operator_role: String,
    pub industry: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceAiEvidenceRefsInput {
    pub run_id: String,
    pub asset_id: String,
    pub refs: Vec<ReplaceAiEvidenceRefRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceAiEvidenceRefRow {
    pub file_id: Option<String>,
    pub file_name: String,
    pub artifact_kind: Option<String>,
    pub page_number: Option<i64>,
    pub view_label: Option<String>,
    pub evidence_identifier: Option<String>,
    pub locator_json: Option<serde_json::Value>,
    pub draft_entity_kind: Option<String>,
    pub draft_entity_key: Option<String>,
    pub confidence_json: Option<serde_json::Value>,
    pub quote_path: String,
    pub summary: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAssetFromFilesInput {
    pub asset_id: String,
    pub project_id: String,
    pub display_name: String,
    pub file_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignFilesToAssetInput {
    pub asset_id: String,
    pub project_id: String,
    pub file_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeAssetsInput {
    pub target_asset_id: String,
    pub source_asset_ids: Vec<String>,
    pub new_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeAssetsResult {
    pub estimates_discarded: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UngroupAssetInput {
    pub asset_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UngroupAssetResult {
    pub had_estimate: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveFileFromAssetInput {
    pub file_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionInput {
    pub project_id: String,
    pub rfq_number: String,
    pub quote_number: Option<String>,
    pub revision_reason: Option<String>,
    pub contact_name: Option<String>,
    pub contact: Option<CreateQuoteRevisionContactInput>,
    pub project_name: Option<String>,
    pub business: CreateQuoteRevisionBusinessInput,
    pub issued_date: String,
    pub valid_until_date: String,
    pub package_attachments_json: String,
    pub sent: Option<CreateQuoteRevisionSentInput>,
    pub recipient_snapshot: Option<serde_json::Value>,
    pub terms_snapshot: Option<serde_json::Value>,
    pub options: Vec<CreateQuoteRevisionOptionInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionSentInput {
    pub status: Option<String>,
    pub date: Option<String>,
    pub method: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionContactInput {
    pub country_code: Option<String>,
    pub business_id_label: Option<String>,
    pub business_id_value: Option<String>,
    pub tax_id_label: Option<String>,
    pub tax_id_value: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionBusinessInput {
    pub name: String,
    pub country_code: Option<String>,
    pub abn: Option<String>,
    pub business_id_label: Option<String>,
    pub business_id_value: Option<String>,
    pub tax_id_label: Option<String>,
    pub tax_id_value: Option<String>,
    pub tax_display_label: Option<String>,
    pub tax_rate_percentage: Option<f64>,
    pub address: Option<String>,
    pub contact_name: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub currency_code: String,
    pub currency_symbol: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionOptionInput {
    pub source_quote_option_id: Option<String>,
    pub label: String,
    pub lead_time: String,
    pub markup_percentage: f64,
    pub notes: String,
    pub sort_order: i64,
    pub is_default: bool,
    pub is_selected: bool,
    pub line_items_json: String,
    pub subtotal_amount: f64,
    pub gst_amount: f64,
    pub total_amount: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateQuoteRevisionResult {
    pub revision_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddProjectInput {
    pub id: String,
    pub workspace_id: String,
    pub sort_order: i64,
    pub rfq_number: String,
    pub contact_id: Option<String>,
    pub contact_name_snapshot: Option<String>,
    pub requester_contact_id: Option<String>,
    pub requester_name_snapshot: Option<String>,
    pub quote_recipient_contact_id: Option<String>,
    pub project_name: Option<String>,
    pub due_date: Option<String>,
    pub received_date: Option<String>,
    pub submission_deadline_at: Option<String>,
    pub estimator_name: Option<String>,
    pub customer_tender_reference: Option<String>,
    pub addendum_label: Option<String>,
    pub addendum_date: Option<String>,
    pub addendum_notes: Option<String>,
    pub site_address: Option<String>,
    pub delivery_address: Option<String>,
    pub source_channel: String,
    pub source_reference: Option<String>,
    pub source_email_message_id: Option<String>,
    pub source_email_integration_id: Option<String>,
    pub priority: String,
    pub status: String,
    pub content: Option<String>,
    pub note: Option<String>,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectWorkspaceFileSeedInput {
    pub id: String,
    pub file_path: String,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub byte_size: Option<i64>,
    pub content_hash: Option<String>,
    pub document_type: Option<String>,
    pub revision_label: Option<String>,
    pub received_at: Option<String>,
    pub source_label: Option<String>,
    pub source_metadata_json: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateProjectWorkspaceInput {
    pub project: AddProjectInput,
    pub files: Vec<ProjectWorkspaceFileSeedInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateProjectWorkspaceInput {
    pub id: String,
    pub rfq_number: String,
    pub contact_id: Option<String>,
    pub contact_name_snapshot: Option<String>,
    pub requester_contact_id: Option<String>,
    pub requester_name_snapshot: Option<String>,
    pub quote_recipient_contact_id: Option<String>,
    pub project_name: Option<String>,
    pub due_date: Option<String>,
    pub received_date: Option<String>,
    pub submission_deadline_at: Option<String>,
    pub estimator_name: Option<String>,
    pub customer_tender_reference: Option<String>,
    pub addendum_label: Option<String>,
    pub addendum_date: Option<String>,
    pub addendum_notes: Option<String>,
    pub site_address: Option<String>,
    pub delivery_address: Option<String>,
    pub source_channel: String,
    pub source_reference: Option<String>,
    pub source_email_message_id: Option<String>,
    pub source_email_integration_id: Option<String>,
    pub priority: String,
    pub status: String,
    pub content: Option<String>,
    pub note: Option<String>,
    pub updated_at: String,
    pub new_files: Vec<ProjectWorkspaceFileSeedInput>,
    pub removed_file_ids: Vec<String>,
    pub removed_asset_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuoteOptionPersistInput {
    pub id: String,
    pub label: String,
    pub lead_time: String,
    pub markup_percentage: f64,
    #[serde(default)]
    pub material_markup_percentage: Option<f64>,
    #[serde(default)]
    pub labour_markup_percentage: Option<f64>,
    #[serde(default)]
    pub equipment_markup_percentage: Option<f64>,
    #[serde(default)]
    pub subcontract_markup_percentage: Option<f64>,
    pub notes: String,
    pub sort_order: i64,
    pub is_default: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetQuoteWorkspaceInput {
    pub project_id: String,
    pub asset_ids: Vec<String>,
    pub quote_options: Vec<QuoteOptionPersistInput>,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContactWriteInput {
    pub id: String,
    pub workspace_id: String,
    pub sort_order: Option<i64>,
    pub updated_at: String,
    pub data: serde_json::Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedContactActionInput {
    pub id: String,
    pub action: String,
    pub record_id: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedContactsBundleInput {
    pub proposal_id: String,
    pub turn_id: String,
    pub tool_name: String,
    pub workspace_id: String,
    pub updated_at: String,
    pub actions: Vec<AssistantApprovedContactActionInput>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AssistantRecordProposalScope {
    Contacts,
    Materials,
    LabourRates,
    EquipmentRates,
    SubcontractRates,
    WbsNodes,
    QuoteOptions,
    Assets,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AssistantRecordProposalAction {
    Create,
    Update,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedRecordProposalInput {
    pub proposal_id: String,
    pub turn_id: String,
    pub workspace_id: String,
    pub updated_at: String,
    pub scope: AssistantRecordProposalScope,
    pub action: AssistantRecordProposalAction,
    pub record_id: String,
    pub fields: serde_json::Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedRecordProposalSetItemInput {
    pub proposal_id: String,
    pub scope: AssistantRecordProposalScope,
    pub action: AssistantRecordProposalAction,
    pub record_id: Option<String>,
    pub fields: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedRecordProposalSetInput {
    pub proposal_set_id: String,
    pub turn_id: String,
    pub items: Vec<AssistantApprovedRecordProposalSetItemInput>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantApprovedContactsBundleResult {
    pub status: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub errors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEstimateInput {
    pub asset_id: String,
    pub updated_at: String,
    pub estimate: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStructureTemplateNodeInput {
    pub id: String,
    pub parent_id: Option<String>,
    pub code: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectStructureTemplateBundleInput {
    pub id: String,
    pub workspace_id: String,
    pub code: Option<String>,
    pub name: String,
    pub description: String,
    pub is_active: bool,
    pub updated_at: String,
    pub nodes: Vec<ProjectStructureTemplateNodeInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyProjectStructureTemplateInput {
    pub project_id: String,
    pub nodes: Vec<ProjectStructureTemplateNodeInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportEntityOperationInput {
    pub id: String,
    pub action: String,
    pub mapped_fields: Vec<String>,
    pub data: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportClassificationSystemOperationInput {
    pub id: String,
    pub action: String,
    pub mapped_fields: Vec<String>,
    #[serde(rename = "clientKey")]
    pub _client_key: String,
    pub data: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportCostCodeOperationInput {
    pub id: String,
    pub action: String,
    pub mapped_fields: Vec<String>,
    pub classification_system_id: String,
    pub data: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportCompanyCatalogueLinkInput {
    pub scope: CatalogueCompanyLinkScope,
    pub record_id: String,
    pub company_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportAuditInput {
    pub id: String,
    pub source_file_name: String,
    pub source_content_hash: String,
    pub imported_sheet_ids: Vec<String>,
    pub duplicate_modes_json: String,
    pub created_count: i64,
    pub updated_count: i64,
    pub skipped_count: i64,
    pub failure_summary: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupImportSessionInput {
    pub audit: SetupImportAuditInput,
    pub contacts: Vec<SetupImportEntityOperationInput>,
    pub materials: Vec<SetupImportEntityOperationInput>,
    pub labour_rates: Vec<SetupImportEntityOperationInput>,
    pub equipment_rates: Vec<SetupImportEntityOperationInput>,
    pub subcontract_rates: Vec<SetupImportEntityOperationInput>,
    pub cost_presets: Vec<SetupImportEntityOperationInput>,
    pub estimate_templates: Vec<SetupImportEntityOperationInput>,
    pub project_structure_templates: Vec<SetupImportEntityOperationInput>,
    pub classification_systems: Vec<SetupImportClassificationSystemOperationInput>,
    pub cost_codes: Vec<SetupImportCostCodeOperationInput>,
    pub company_catalogue_links: Vec<SetupImportCompanyCatalogueLinkInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DuplicateProjectInput {
    pub project: serde_json::Value,
    pub quote_options: Vec<serde_json::Value>,
    pub wbs_nodes: Vec<serde_json::Value>,
    pub assets: Vec<serde_json::Value>,
    pub files: Vec<serde_json::Value>,
    pub asset_thumbnail_updates: Vec<serde_json::Value>,
    pub estimates: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteAssistantActionAuditInput {
    pub workspace_id: String,
    pub turn_id: String,
    pub action_id: String,
    pub tool_name: String,
    pub status: String,
    pub item_count: i64,
    pub issue_count: i64,
    pub error_count: i64,
    pub error_message: Option<String>,
    pub payload_json: Option<String>,
}
