// The Shared Type Authority for Kwantflow - companion sync for clean workspace schema version 2.
// SQLite topology: control data lives in kwantflow-control.db; business records live in
// workspaces/{workspaceId}/workspace.db. Account/customer UI snapshots below may be synthesized
// from local control/profile state and are not workspace-table contracts.

import type {
	EquipmentRateUnitCode,
	LabourRateUnitCode,
	MaterialUnitCode,
	SubcontractRateUnitCode,
	UnitCode
} from '../constants/index.js';
import { PriorityLevel, ProjectStatus } from '../constants/index.js';

/**
 * Represents a Request for Quote (RFQ) or Job.
 * STRICT MAPPING: src-tauri/migrations-workspace/001_workspace.sql (projects)
 */
export interface Project {
	id: string; // UUID
	workspace_id: string;
	sort_order: number;
	is_favourite: boolean;
	quote_round_prices?: boolean; // Quote workspace rounding preference
	rfq_number: string;
	created_at: string; // ISO 8601 DATETIME
	updated_at: string; // ISO 8601 DATETIME
	contact_id?: string | null; // Canonical company contact link
	contact_name_snapshot?: string | null; // Historical display snapshot
	contact_name?: string | null; // Resolved UI display name
	requester_contact_id?: string | null; // Canonical requester person link
	requester_name_snapshot?: string | null; // Historical requester display snapshot
	requester_contact_name?: string | null; // Resolved requester UI display name
	quote_recipient_contact_id?: string | null; // Optional quote recipient contact link
	project_name?: string; // Intake: project title
	due_date?: string; // Intake: ISO 8601 date
	received_date?: string | null;
	submission_deadline_at?: string | null;
	estimator_name?: string;
	customer_tender_reference?: string;
	addendum_label?: string;
	addendum_date?: string | null;
	addendum_notes?: string;
	site_address?: string;
	delivery_address?: string;
	source_channel?: 'manual' | 'folder_upload' | 'hosted_form' | 'email'; // Hidden intake provenance
	source_reference?: string | null; // Hidden upstream intake reference
	source_email_message_id?: string | null; // Gmail message ID this project was created from
	source_email_integration_id?: string | null; // Mailbox connection owning the provider message ID
	priority?: PriorityLevel; // Intake: Priority enum
	status: ProjectStatus; // RFQ lifecycle state
	content?: string; // Intake: raw email content
	note?: string; // Intake: private estimator notes
	asset_count?: number; // Population via SQL subquery (currently used as project file count in list views)
}

/**
 * Represents a specific logical component within a Project.
 * An Asset is a user-created estimating bundle for one or more project files.
 * STRICT MAPPING: src-tauri/migrations-workspace/001_workspace.sql (assets)
 */
export interface Asset {
	id: string; // UUID
	project_id: string; // FOREIGN KEY (projects.id)
	display_name: string; // User-editable name
	thumbnail_file_id: string | null; // Pointer to primary file
	is_selected: boolean; // Workspace selection state (persisted)
	quote_quantity?: number; // Quote quantity preference (persisted)
	is_pdf_included?: boolean; // Quote PDF inclusion preference (persisted)
	created_at: string; // ISO 8601 DATETIME
	files?: AssetFile[]; // Joined children
}

/**
 * Represents a physical project file that may optionally be assigned to an Asset.
 */
export interface AssetFile {
	id: string;
	project_id: string;
	asset_id?: string | null;
	file_path: string;
	original_name: string;
	mime_type?: string | null;
	byte_size?: number;
	content_hash?: string | null;
	checksum_algorithm?: string;
	document_type?: string;
	revision_label?: string;
	received_at?: string | null;
	source_label?: string;
	source_metadata?: Record<string, unknown>;
	created_at: string;
}

/**
 * Represents a text chunk extracted from a project file page.
 */
export interface ProjectFilePageChunk {
	id: string;
	file_id: string;
	page_number: number;
	chunk_index: number;
	text_content: string;
	word_count: number;
	created_at?: string;
}

export interface ExplorerProjectChildren {
	loaded: boolean;
	assets: Asset[];
	unassignedFiles: AssetFile[];
}

export interface ExplorerVisibleAsset {
	asset: Asset;
	files: AssetFile[];
}

export interface ExplorerVisibleProject {
	project: Project;
	assets: ExplorerVisibleAsset[];
	unassignedFiles: AssetFile[];
	matchesSearch: boolean;
}

export interface ExplorerPreviewFile {
	file: AssetFile;
	project: Project | null;
}

export type CostComponentCategory = 'material' | 'labour' | 'equipment' | 'subcontract' | 'misc';

export type CostComponentSourceType =
	| 'manual'
	| 'material_catalog'
	| 'labour_rate_card'
	| 'equipment_rate_card'
	| 'subcontract_rate_card';

export type ClassificationSystemType = 'masterformat' | 'uniformat' | 'xactimate' | 'custom';

export type WbsNodeType = 'phase' | 'level' | 'zone' | 'room' | 'trade' | 'custom';

export interface ClassificationSystem {
	id: string;
	workspace_id: string;
	name: string;
	code: string;
	classification_type: ClassificationSystemType;
	aliases: string[];
	is_default: boolean;
	created_at: string;
}

export interface CostCode {
	id: string;
	classification_system_id: string;
	parent_id?: string | null;
	code: string;
	name: string;
	description: string;
	is_active: boolean;
	sort_order: number;
	created_at: string;
}

export interface WbsNode {
	id: string;
	project_id: string;
	parent_id?: string | null;
	code?: string | null;
	name: string;
	type: WbsNodeType;
	sort_order: number;
	created_at: string;
}

export interface ProjectStructureTemplateNode {
	id: string;
	template_id: string;
	parent_id?: string | null;
	code?: string | null;
	name: string;
	type: WbsNodeType;
	sort_order: number;
	created_at: string;
}

export interface MaterialCatalogueItem {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	category?: string | null;
	specification?: string | null;
	unit: MaterialUnitCode;
	default_rate: number;
	currency_code?: string;
	aliases?: string[];
	metadata: Record<string, unknown>;
	effective_date?: string | null;
	verified_date?: string | null;
	rate_basis?: 'cost' | 'sell';
	lead_time?: string;
	availability?: string;
	reference?: string;
	is_active: boolean;
	linkedCompanies?: LinkedCompanySummary[];
	created_at: string;
	updated_at: string;
}

export interface LinkedCompanySummary {
	id: string;
	displayName: string;
}

export interface LinkedCatalogueRecordSummary {
	id: string;
	name: string;
}

export interface CatalogueRecordCompanyLinksResult {
	scope: 'materials' | 'labour_rates' | 'equipment_rates' | 'subcontract_rates';
	recordId: string;
	companies: LinkedCompanySummary[];
}

export interface CompanyCatalogueLinksResult {
	companyId: string;
	materials: LinkedCatalogueRecordSummary[];
	labourRates: LinkedCatalogueRecordSummary[];
	equipmentRates: LinkedCatalogueRecordSummary[];
	subcontractRates: LinkedCatalogueRecordSummary[];
}

export interface LabourRateCard {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	category?: string | null;
	work_center?: string | null;
	unit: LabourRateUnitCode;
	default_rate: number;
	currency_code?: string;
	aliases?: string[];
	metadata: Record<string, unknown>;
	effective_date?: string | null;
	verified_date?: string | null;
	rate_basis?: 'cost' | 'sell';
	lead_time?: string;
	availability?: string;
	reference?: string;
	is_active: boolean;
	linkedCompanies?: LinkedCompanySummary[];
	created_at: string;
	updated_at: string;
}

export interface EquipmentRateCard {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	category?: string | null;
	work_center?: string | null;
	unit: EquipmentRateUnitCode;
	default_rate: number;
	currency_code?: string;
	aliases?: string[];
	metadata: Record<string, unknown>;
	effective_date?: string | null;
	verified_date?: string | null;
	rate_basis?: 'cost' | 'sell';
	lead_time?: string;
	availability?: string;
	reference?: string;
	is_active: boolean;
	linkedCompanies?: LinkedCompanySummary[];
	created_at: string;
	updated_at: string;
}

export interface SubcontractRateCard {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	category?: string | null;
	unit: SubcontractRateUnitCode;
	default_rate: number;
	currency_code?: string;
	aliases?: string[];
	metadata: Record<string, unknown>;
	effective_date?: string | null;
	verified_date?: string | null;
	rate_basis?: 'cost' | 'sell';
	lead_time?: string;
	availability?: string;
	reference?: string;
	is_active: boolean;
	linkedCompanies?: LinkedCompanySummary[];
	created_at: string;
	updated_at: string;
}

export interface CostComponent {
	id: string;
	takeoff_item_id: string;
	category: CostComponentCategory;
	source_type: CostComponentSourceType;
	source_id?: string | null;
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	unit_rate: number;
	source_unit_rate_decimal?: string | null;
	source_currency_code?: string | null;
	fx_rate_snapshot_id?: string | null;
	formula: Record<string, unknown>;
	metadata: Record<string, unknown>;
	sort_order?: number;
}

export interface CostComponentPresetComponent {
	category: CostComponentCategory;
	source_type: CostComponentSourceType;
	source_id?: string | null;
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	unit_rate: number;
	formula: Record<string, unknown>;
	metadata: Record<string, unknown>;
	sort_order: number;
}

export interface CostComponentPreset {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	description: string;
	aliases?: string[];
	components: CostComponentPresetComponent[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface TakeoffItem {
	id: string;
	estimate_asset_id: string;
	parent_id?: string | null;
	wbs_node_id?: string | null;
	cost_code_id?: string | null;
	applied_preset_id?: string | null;
	applied_preset_name?: string | null;
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	properties: Record<string, unknown>;
	sort_order: number;
	cost_components: CostComponent[];
}

/**
 * Represents the full estimation data for a given asset.
 * Persisted to SQLite (estimates + takeoff_items + cost_components tables).
 */
export interface Estimate {
	asset_id: string;
	scope_summary: string;
	notes: string;
	classification_system_id?: string | null;
	wbs_root_node_id?: string | null;
	applied_template_id?: string | null;
	applied_template_name?: string | null;
	currency_code?: string | null;
	takeoff_items: TakeoffItem[];
}

export interface EstimateSummary {
	asset_id: string;
	has_quote_content: boolean;
}

export interface EstimateTemplatePayload {
	scope_summary: string;
	notes: string;
	classification_system_id?: string | null;
	wbs_root_node_id?: string | null;
	takeoff_items: TakeoffItem[];
}

export interface EstimateTemplate {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	description: string;
	aliases?: string[];
	estimate: EstimateTemplatePayload;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface ProjectStructureTemplate {
	id: string;
	workspace_id: string;
	code?: string | null;
	name: string;
	description: string;
	nodes: ProjectStructureTemplateNode[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface QuoteOption {
	id: string;
	project_id: string;
	label: string;
	lead_time: string;
	markup_percentage: number;
	material_markup_percentage: number | null;
	labour_markup_percentage: number | null;
	equipment_markup_percentage: number | null;
	subcontract_markup_percentage: number | null;
	notes: string;
	sort_order: number;
	is_default: boolean;
	created_at: string;
	updated_at: string;
}

export interface QuoteOptionPreset {
	id: string;
	workspace_id: string;
	label: string;
	lead_time: string;
	markup_percentage: number;
	material_markup_percentage: number | null;
	labour_markup_percentage: number | null;
	equipment_markup_percentage: number | null;
	subcontract_markup_percentage: number | null;
	notes: string;
	created_at: string;
	updated_at: string;
}

export interface QuoteRevisionLineItem {
	file_name: string;
	description: string;
	quantity: number;
	lead_time: string;
	unit_price: number;
	line_total: number;
}

export interface QuotePackageAttachmentOutcome {
	file_id?: string | null;
	file_name: string;
	status: 'appended' | 'omitted';
	reason?: string | null;
}

export interface QuoteRevisionOption {
	id: string;
	revision_id: string;
	source_quote_option_id?: string | null;
	label: string;
	lead_time: string;
	markup_percentage: number;
	notes: string;
	sort_order: number;
	is_default: boolean;
	is_selected: boolean;
	line_items: QuoteRevisionLineItem[];
	subtotal_amount: number;
	gst_amount: number;
	total_amount: number;
	created_at: string;
	updated_at: string;
}

export interface QuoteRevision {
	id: string;
	project_id: string;
	revision_number: number;
	revision_label: string;
	rfq_number_snapshot: string;
	quote_number_snapshot?: string;
	revision_reason?: string;
	contact_name_snapshot?: string | null;
	contact_country_code_snapshot?: string | null;
	contact_business_id_label_snapshot?: string | null;
	contact_business_id_value_snapshot?: string | null;
	contact_tax_id_label_snapshot?: string | null;
	contact_tax_id_value_snapshot?: string | null;
	project_name_snapshot?: string | null;
	business_name_snapshot: string;
	business_abn_snapshot?: string | null;
	business_id_label_snapshot?: string | null;
	business_id_value_snapshot?: string | null;
	tax_id_label_snapshot?: string | null;
	tax_id_value_snapshot?: string | null;
	tax_display_label_snapshot?: string | null;
	tax_rate_percentage_snapshot?: number | null;
	business_address_snapshot?: string | null;
	business_email_snapshot?: string | null;
	business_contact_name_snapshot?: string | null;
	business_contact_phone_snapshot?: string | null;
	currency_code_snapshot: string;
	currency_symbol_snapshot: string;
	issued_date: string;
	valid_until_date: string;
	sent_status?: 'exported' | 'sent';
	sent_date?: string | null;
	sent_method?: string;
	recipient_snapshot?: Record<string, unknown>;
	terms_snapshot?: Record<string, unknown>;
	package_attachments: QuotePackageAttachmentOutcome[];
	options: QuoteRevisionOption[];
	created_at: string;
	updated_at: string;
}

export interface CreateQuoteRevisionInput {
	project_id: string;
	rfq_number: string;
	quote_number?: string | null;
	revision_reason?: string | null;
	contact_name?: string | null;
	contact?: {
		countryCode?: string | null;
		businessIdLabel?: string | null;
		businessIdValue?: string | null;
		taxIdLabel?: string | null;
		taxIdValue?: string | null;
	} | null;
	project_name?: string | null;
	business: {
		name: string;
		countryCode?: string | null;
		abn?: string | null;
		businessIdLabel?: string | null;
		businessIdValue?: string | null;
		taxIdLabel?: string | null;
		taxIdValue?: string | null;
		taxDisplayLabel?: string | null;
		taxRatePercentage?: number | null;
		address?: string | null;
		contactName?: string | null;
		contactEmail?: string | null;
		contactPhone?: string | null;
		currency_code: string;
		currency_symbol: string;
		dateFormat?: string | null;
		languageLocale?: string | null;
		numberLocale?: string | null;
	};
	issued_date: string;
	valid_until_date: string;
	package_attachments?: QuotePackageAttachmentOutcome[];
	sent?: { status?: 'exported' | 'sent'; date?: string | null; method?: string | null } | null;
	recipientSnapshot?: Record<string, unknown> | null;
	termsSnapshot?: Record<string, unknown> | null;
	options: Array<{
		source_quote_option_id?: string | null;
		label: string;
		lead_time: string;
		markup_percentage: number;
		notes: string;
		sort_order: number;
		is_default: boolean;
		is_selected: boolean;
		line_items: QuoteRevisionLineItem[];
		subtotal_amount: number;
		gst_amount: number;
		total_amount: number;
	}>;
}

export type AiProvider = 'local_litert_lm';

export type LocalAiInstallState =
	| 'not_downloaded'
	| 'downloading'
	| 'verifying'
	| 'installed'
	| 'loading'
	| 'ready'
	| 'failed'
	| 'repair_needed'
	| 'unsupported';

export interface LocalAiDownloadProgress {
	stage:
		| 'queued'
		| 'downloading_model'
		| 'downloading_mirror'
		| 'downloading_support_files'
		| 'verifying'
		| 'complete';
	label: string;
	downloadedBytes: number;
	totalBytes: number | null;
	percent: number | null;
}

export type LocalAiRuntimeKind = 'litert_lm';

export interface LocalAiCapabilityProbeDiagnostics {
	supportsConstrainedToolCalls: boolean;
	supportsNativeToolCalls: boolean;
	supportsReasoningSeparation: boolean;
	supportsVisionInputs: boolean;
	supportsPersistentConversation: boolean;
	supportsPersistentConversationWithVision: boolean;
	checkedElapsedMs: number | null;
	source: 'unverified' | 'native_probe' | 'unknown';
}

export interface LocalAiDiagnostics {
	activeLaunchProfile: 'gpu_preferred' | 'cpu_only' | 'not_started' | 'unknown';
	startupElapsedMs: number | null;
	imageProbeElapsedMs: number | null;
	lastCompletionElapsedMs: number | null;
	lastFailureClass: 'startup' | 'request' | 'timeout' | 'response_parse' | 'unknown' | null;
	lastTimeoutStage: 'startup' | 'completion' | 'image_probe' | null;
	gpuAcceleration: 'gpu_preferred' | 'cpu_only' | 'gpu_active' | 'cpu_fallback' | 'unknown';
	contextSizeTokens: number | null;
	activeStreamCount: number;
	capabilityProbe?: LocalAiCapabilityProbeDiagnostics;
}

export interface LocalAiStatus {
	expectedDownloadBytes: number;
	runtimeKind: LocalAiRuntimeKind;
	runtimeVersion: string;
	modelRepoId: string;
	modelArtifactId: string;
	modelFileName: string;
	mmprojFileName: string | null;
	installState: LocalAiInstallState;
	runtimeAvailable: boolean;
	modelReady: boolean;
	supportsImageInputs: boolean;
	supportsNativeToolCalls: boolean;
	activeDownload: LocalAiDownloadProgress | null;
	lastError: string | null;
	diagnostics: LocalAiDiagnostics;
}

export interface LocalAssistantLink {
	id: string;
	label: string;
	route: string;
}

export interface LocalAssistantCitation {
	id: string;
	label: string;
	summary: string;
	route?: string | null;
}

export interface LocalAssistantContextSection {
	id: string;
	title: string;
	text: string;
	summary: string;
	kind: 'current' | 'record' | 'overview' | 'help' | 'knowledge' | 'schema';
	keywords: string[];
	route?: string | null;
	routeLabel?: string | null;
}

export interface LocalAssistantImageAttachment {
	id: string;
	name: string;
	mimeType: string;
	base64Data: string;
	previewUrl: string;
	sizeBytes: number;
}

export interface LocalAssistantTakeoffItemContext {
	sort_order: number;
	name: string;
	reasoning?: string;
	evidenceRefCount: number;
	confidence?: string;
}

export interface LocalAssistantEstimateContext {
	assetId: string;
	takeoffItemCount: number;
	scopeSummary: string;
	notes: string;
	totalCost: number;
	takeoffItems: LocalAssistantTakeoffItemContext[];
}

export interface LocalAssistantToolExecution {
	id: string;
	name: string;
	status: 'executing' | 'success' | 'failed';
	arguments?: Record<string, unknown>;
}

export interface LocalAssistantMessage {
	id: string;
	role: 'user' | 'assistant' | 'tool';
	text: string;
	tool_calls?: Array<{
		id: string;
		type: string;
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
	name?: string;
	thinking: string;
	thinkingOpen?: boolean;
	isStreaming: boolean;
	createdAt: string;
	citations: LocalAssistantCitation[];
	links: LocalAssistantLink[];
	followUpSuggestions: string[];
	attachments: LocalAssistantImageAttachment[];
	toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
	proposalSet?: LocalAssistantProposalSet;
	toolExecutions?: LocalAssistantToolExecution[];
}

export interface LocalAssistantAnswer {
	answer: string;
	thinking?: string;
	citations: LocalAssistantCitation[];
	links: LocalAssistantLink[];
	followUpSuggestions: string[];
	toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
	proposalSet?: LocalAssistantProposalSet;
	toolExecutions?: LocalAssistantToolExecution[];
	viewportObservations?: {
		observations: Array<{ label: string; kind: string; summary: string; confidence: string }>;
		uncertainty?: string;
		suggestedNextSteps: string[];
	};
}

export type LocalAssistantSourceRecordScope =
	| 'contacts'
	| 'materials'
	| 'labour_rates'
	| 'equipment_rates'
	| 'subcontract_rates'
	| 'wbs_nodes'
	| 'quote_options'
	| 'assets';

export interface LocalAssistantSourceRecordProposal {
	id: string;
	scope: LocalAssistantSourceRecordScope;
	action: 'create' | 'update';
	recordId?: string;
	fields: Record<string, unknown>;
	summary: string;
}

export interface LocalAssistantProposalSet {
	id: string;
	turnId: string;
	summary: string;
	items: LocalAssistantSourceRecordProposal[];
	status: 'pending' | 'approved' | 'discarded' | 'executed' | 'failed';
}

export type AiRunStatus =
	| 'queued'
	| 'preprocessing'
	| 'extracting'
	| 'drafting'
	| 'drafted'
	| 'applied'
	| 'failed'
	| 'cancelled';

export interface AiRunProgressDetail {
	currentArtifactName: string | null;
	processedArtifactCount: number;
	usableArtifactCount?: number;
	artifactIssueCount?: number;
	totalArtifactCount: number;
	supportedArtifactCount: number;
	unsupportedArtifactCount: number;
	failedEvidenceUnitCount?: number;
	omittedEvidenceUnitCount?: number;
	draftSubphase?: 'outline' | 'matching' | 'composition' | 'validation' | null;
}

export interface AiIssue {
	code: string;
	message: string;
	severity: 'info' | 'warning' | 'error';
	fileId?: string | null;
	fileName?: string | null;
}

export interface AiEvidenceRef {
	file_id: string | null;
	file_name: string;
	artifact_kind?: 'text' | 'pdf' | 'image' | 'cad' | null;
	page_number?: number | null;
	view_label?: string | null;
	evidence_identifier?: string;
	locator?: Record<string, unknown>;
	draft_entity_kind?: string;
	draft_entity_key?: string;
	confidence?: Record<string, unknown>;
	quote_path: string;
	summary: string;
}

export interface AiConfidence {
	overall: number;
	extraction: number;
	mapping: number;
	quantity: number;
}

export interface AiDraftCostComponent {
	category: CostComponentCategory;
	source_type: CostComponentSourceType;
	source_id?: string | null;
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	unit_rate: number;
	formula: Record<string, unknown>;
	metadata: Record<string, unknown>;
	sort_order: number;
	evidence_refs: AiEvidenceRef[];
	confidence: AiConfidence;
	mapping_status: 'auto_linked' | 'matched' | 'manual' | 'unresolved';
}

export interface AiDraftTakeoffItem {
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	sort_order: number;
	cost_code_id?: string | null;
	wbs_node_id?: string | null;
	applied_preset_id?: string | null;
	applied_preset_name?: string | null;
	properties: Record<string, unknown>;
	cost_components: AiDraftCostComponent[];
	evidence_refs: AiEvidenceRef[];
	confidence: AiConfidence;
	open_questions: string[];
	reasoning?: string;
}

export interface AiDraftEstimate {
	scope_summary: string;
	notes: string;
	classification_system_id?: string | null;
	wbs_root_node_id?: string | null;
	applied_template_id?: string | null;
	applied_template_name?: string | null;
	takeoff_items: AiDraftTakeoffItem[];
	issues: AiIssue[];
}

export type EstimateMappingFieldStatus = 'matched' | 'needs_review' | 'unresolved' | 'ignored';

export type EstimateMappingFieldTarget =
	| 'classification_system'
	| 'wbs_root'
	| 'takeoff_cost_code'
	| 'takeoff_wbs'
	| 'component_source'
	| 'component_unit';

export interface EstimateMappingCandidate {
	value: string;
	label: string;
	description?: string | null;
}

export interface EstimateMappingFieldReview {
	id: string;
	label: string;
	path: string;
	target: EstimateMappingFieldTarget;
	status: EstimateMappingFieldStatus;
	message?: string | null;
	required: boolean;
	allowClear: boolean;
	existingValue?: string | null;
	currentValue?: string | null;
	resolvedValue?: string | null;
	candidates: EstimateMappingCandidate[];
}

export interface EstimateMappingReviewItem {
	itemId: string;
	itemIndex: number;
	itemName: string;
	fields: EstimateMappingFieldReview[];
	componentFields: EstimateMappingFieldReview[];
}

export interface EstimateMappingPreflight {
	blockerCount: number;
	warningCount: number;
	reviewCount: number;
	canFinalize: boolean;
}

export interface EstimateMappingReview {
	reconciledDraft: AiDraftEstimate;
	issues: AiIssue[];
	headerFields: EstimateMappingFieldReview[];
	items: EstimateMappingReviewItem[];
	preflight: EstimateMappingPreflight;
}

export interface AiEstimateContextSnapshot {
	version: string;
	asset_context: {
		assetId: string;
		assetName: string;
		projectName?: string | null;
	};
	schema: {
		headerFields: string[];
		takeoffItemFields: string[];
		costComponentFields: string[];
		allowedCategories: CostComponentCategory[];
		allowedUnits: Array<{ code: UnitCode; label: string }>;
		allowedUnitsByCategory: Record<string, Array<{ code: UnitCode; label: string }>>;
	};
	reference_data: Record<string, unknown>;
	field_semantics: {
		sections: Array<{ id: string; label: string; description: string }>;
		fields: Record<string, { label: string; description: string; guidance?: string }>;
	};
	current_estimate_state: {
		currentEstimate: Estimate;
		savedEstimate?: Estimate | null;
		seededHeaderFields: string[];
		hasDraftedStructure: boolean;
	};
	mapping_rules: {
		classificationCostCodeOwnership: 'strict';
		projectStructureOwnership: 'strict';
		sourceLinkedComponents: 'workspace_scoped';
		unresolvedStrategy: 'apply_to_working_copy';
	};
	review_rules: {
		blockingStatuses: EstimateMappingFieldStatus[];
		clearableTargets: EstimateMappingFieldTarget[];
	};
}

export interface AiPromptContract {
	systemInstructionVersion: string;
	extractionPromptVersion: string;
	draftPromptVersion: string;
}

export interface AiDraftOutlineCostComponent {
	category: CostComponentCategory;
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	sort_order: number;
	evidence_refs: AiEvidenceRef[];
	confidence: AiConfidence;
}

export interface AiDraftOutlineTakeoffItem {
	name: string;
	description: string;
	quantity: number;
	unit: UnitCode;
	sort_order: number;
	cost_components: AiDraftOutlineCostComponent[];
	evidence_refs: AiEvidenceRef[];
	confidence: AiConfidence;
	open_questions: string[];
	reasoning?: string;
}

export interface AiDraftOutline {
	scope_summary: string;
	notes: string;
	classification_system_id?: string | null;
	wbs_root_node_id?: string | null;
	takeoff_items: AiDraftOutlineTakeoffItem[];
	issues: AiIssue[];
}

export interface AiDraftMatchingCostComponent {
	category: CostComponentCategory;
	sort_order: number;
	source_type: CostComponentSourceType;
	source_id?: string | null;
	source_name?: string | null;
	mapping_status: 'auto_linked' | 'matched' | 'manual' | 'unresolved';
	match_strategy?: string | null;
	match_signals?: string[];
}

export interface AiDraftMatchingTakeoffItem {
	sort_order: number;
	applied_preset_id?: string | null;
	applied_preset_name?: string | null;
	cost_code_id?: string | null;
	wbs_node_id?: string | null;
	cost_components: AiDraftMatchingCostComponent[];
}

export interface AiDraftMatching {
	applied_template_id?: string | null;
	applied_template_name?: string | null;
	classification_system_id?: string | null;
	wbs_root_node_id?: string | null;
	takeoff_items: AiDraftMatchingTakeoffItem[];
	issues: AiIssue[];
}

export interface AiDraftStageTimingDiagnostics {
	promptTokenCount?: number;
	predictedTokenCount?: number;
	cacheTokenCount?: number;
	promptMs: number | null;
	predictedMs: number | null;
	promptPerSecond: number | null;
	predictedPerSecond: number | null;
}

export interface AiDraftStageMetric {
	stage: 'outline' | 'matching' | 'composition' | 'validation';
	elapsedMs: number;
	timeoutMs: number;
	attemptCount: number;
	status: 'completed' | 'failed' | 'cancelled';
	modelId: string;
	usage?: AiRunUsage;
	timings?: AiDraftStageTimingDiagnostics;
}

export interface AiProjectContext {
	projectId: string;
	projectName: string | null;
	rfqNumber: string | null;
	rfqBrief: {
		scopeSummary: string | null;
		constraints: string | null;
		materialsAndSpecs: string | null;
		quantitiesAndUnits: string | null;
		referencedDocuments: string | null;
		exclusions: string | null;
		cleanedSourceText: string | null;
	};
	estimatorNote: string | null;
	rfqContext?: {
		receivedDate: string | null;
		submissionDeadlineAt: string | null;
		estimatorName: string | null;
		customerTenderReference: string | null;
		addendumLabel: string | null;
		addendumDate: string | null;
		addendumNotes: string | null;
		siteAddress: string | null;
		deliveryAddress: string | null;
	};
	briefingSourceSummary: {
		hasRfqBrief: boolean;
		hasEstimatorNote: boolean;
	};
}

export interface AiEstimateSeedContext {
	scopeSummary: string;
	notes: string;
	classificationSystemId: string | null;
	wbsRootNodeId: string | null;
	appliedTemplateId: string | null;
	appliedTemplateName: string | null;
	takeoffItemCount: number;
	seededHeaderFields: string[];
	hasExistingStructure: boolean;
}

export interface AiAssetContext {
	assetId: string;
	assetName: string;
	currentEstimateSeed: AiEstimateSeedContext;
	savedEstimateSeed: AiEstimateSeedContext | null;
}

export type AiArtifactRole =
	| 'scope_drawing'
	| 'specification'
	| 'supplier_quote'
	| 'marked_up_screenshot'
	| 'site_photo'
	| 'reference_image'
	| 'cad_model'
	| 'plain_text_note'
	| 'unknown';

export type AiArtifactExtractionMode =
	| 'text_only'
	| 'native_document_with_text'
	| 'native_document'
	| 'image'
	| 'cad_renders'
	| 'cad_metadata';

export type AiTextArtifactSourceFormat =
	'plain_text' | 'markdown' | 'json' | 'xml' | 'csv' | 'docx' | 'xlsx';

export interface AiTextArtifactStructureHints {
	rowCount?: number | null;
	columnCount?: number | null;
	sheetCount?: number | null;
	formulaCount?: number | null;
	headingCount?: number | null;
	tableCount?: number | null;
	embeddedImageCount?: number | null;
}

export interface AiArtifactEvidenceLocator {
	evidenceIdentifier: string;
	kind:
		| 'text_chunk'
		| 'pdf_text_pages'
		| 'pdf_raster_page'
		| 'image_raster'
		| 'cad_render'
		| 'cad_metadata';
	label: string;
	pageNumber?: number | null;
	pageRange?: string | null;
	viewLabel?: string | null;
	sourceFormat?: AiTextArtifactSourceFormat | null;
}

export interface AiArtifactQualitySignals {
	preparedEvidenceVersion: 'golden_v1';
	hasReadableText: boolean;
	hasRasterEvidence: boolean;
	hasStructuredTableHints: boolean;
	hasCadMetadata: boolean;
	isMetadataOnly: boolean;
	pageCount: number | null;
	renderCount: number | null;
	characterCount: number | null;
	rowCount: number | null;
	columnCount: number | null;
	tableCount: number | null;
	embeddedImageCount: number | null;
	rasterSourceWidth?: number | null;
	rasterSourceHeight?: number | null;
	rasterOutputWidth?: number | null;
	rasterOutputHeight?: number | null;
	rasterResizeRatio?: number | null;
	rasterContrastScore?: number | null;
	rasterLikelyBlank?: boolean | null;
	rasterProfile?: 'cloud' | 'local' | null;
}

export interface AiArtifactManifestEntry {
	fileId: string;
	fileName: string;
	filePath: string;
	byteSize?: number;
	contentHash?: string | null;
	checksumAlgorithm?: string;
	documentType?: string;
	revisionLabel?: string;
	receivedAt?: string | null;
	sourceLabel?: string;
	sourceMetadata?: Record<string, unknown>;
	artifactKind: 'text' | 'pdf' | 'image' | 'cad';
	mimeType: string | null;
	pageCount: number | null;
	renderCount: number | null;
	characterCount: number | null;
	aiRole: AiArtifactRole;
	inclusionReason: string;
	extractionMode: AiArtifactExtractionMode;
	roleConfidence: 'high' | 'medium' | 'low';
	sourceFormat: AiTextArtifactSourceFormat | null;
	structureHints: AiTextArtifactStructureHints | null;
	evidenceIdentifiers: string[];
	evidenceLocators?: AiArtifactEvidenceLocator[];
	qualitySignals?: AiArtifactQualitySignals;
}

export interface AiReferenceSection<T extends Record<string, unknown> = Record<string, unknown>> {
	howToUse: string;
	constraintLevel: 'hard_mapping' | 'auto_link_source' | 'structural_seed' | 'optional_pattern';
	selectionBasis: 'all_active' | 'all_active_plus_seeded_inactive';
	totalAvailableCount: number;
	records: T[];
}

export interface AiReferenceContext {
	mappingTargets: {
		classificationSystems: AiReferenceSection;
		costCodes: AiReferenceSection;
		wbsNodes: AiReferenceSection;
	};
	catalogueSources: {
		materials: AiReferenceSection;
	};
	rateSources: {
		labourRates: AiReferenceSection;
		equipmentRates: AiReferenceSection;
		subcontractRates: AiReferenceSection;
	};
	draftingPatterns: {
		estimateTemplates: AiReferenceSection;
		costComponentPresets: AiReferenceSection;
	};
}

export interface AiWorkspaceKnowledgeContext {
	playbookText: string | null;
	compiledMarkdown: string | null;
	skillMarkdown: string | null;
	skillHash: string | null;
	skillFilePath: string | null;
	sourceSummary: {
		hasPlaybook: boolean;
		fileCount: number;
		includedFileCount: number;
		feedbackEntryCount: number;
		includedFeedbackCount: number;
		learnedCorrectionCount: number;
		hasLearningAppendix: boolean;
		truncated: boolean;
		totalCharacterCount: number;
	};
	files: Array<{
		id: string;
		originalName: string;
		mimeType: string | null;
		byteSize: number;
		characterCount: number;
		excerpt: string | null;
	}>;
}

export interface WorkspaceAiFeedbackEntry {
	id: string;
	workspaceId: string;
	runId: string;
	assetId: string | null;
	estimateId: string | null;
	feedbackText: string;
	created_at: string;
}

export interface AiWorkflowRules {
	precedence: string[];
	estimatorNotePriority: 'lower_than_asset_evidence';
	unresolvedStrategy: 'leave_unresolved';
	pricingStrategy:
		| 'unique_strong_reference_matches_auto_link'
		| 'highest_scoring_semantic_reference_match_auto_link'
		| 'unique_exact_compatible_reference_match_only';
	nonGoals: string[];
}

export interface AiOutputContract {
	returnShape: 'kwantflow_estimate_draft_v1';
	reviewExpectation: 'auto_apply_working_copy';
	requiredTopLevelFields: string[];
	unresolvedHandling: 'surface_in_issues_and_open_questions';
}

export const AI_FAILURE_KINDS = [
	'model_unavailable',
	'timeout',
	'cancel_timeout',
	'blocked_or_empty',
	'schema_error',
	'validation_error',
	'context_limit',
	'preparation_error',
	'native_runtime',
	'interrupted'
] as const;

export type AiFailureKind = (typeof AI_FAILURE_KINDS)[number];

export interface AiRunUsage {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	thoughtsTokenCount?: number;
	totalTokenCount?: number;
	cachedContentTokenCount?: number;
	preflightTokenEstimate?: number;
}

export interface ProductUsageSnapshotAggregate {
	projectCount: number;
	activeProjectCount: number;
	projectsCreated: number;
	projectsUpdated: number;
	projectsArchived: number;
	fileCount: number;
	filesAdded: number;
	fileTypeBuckets: Record<string, number>;
	assetCount: number;
	assetsCreated: number;
	quoteRevisionCount: number;
	quoteRevisionsCreated: number;
	aiRunsStarted: number;
	aiRunsSucceeded: number;
	aiRunsFailed: number;
	aiRunsCancelled: number;
	aiPromptTokenCount: number;
	aiCandidateTokenCount: number;
	aiThoughtsTokenCount: number;
	aiTotalTokenCount: number;
	aiCachedContentTokenCount: number;
	assistantActionsProposed: number;
	assistantActionsApproved: number;
	assistantActionsExecuted: number;
	assistantActionsFailed: number;
	assistantActionIssueCount: number;
	assistantActionErrorCount: number;
}

export interface AiRun {
	id: string;
	asset_id: string;
	provider: AiProvider;
	model_id: string;
	status: AiRunStatus;
	trigger_source: 'settings_validation' | 'asset_editor';
	started_at: string;
	completed_at?: string | null;
	failed_at?: string | null;
	cancelled_at?: string | null;
	error_message?: string | null;
	usage: AiRunUsage;
	prompt_contract_version?: string;
	context_fingerprint?: string;
	failure_kind?: string;
	failure_stage?: string;
	created_at: string;
	updated_at: string;
}

export interface AiRunInput {
	id: string;
	run_id: string;
	input_kind: string;
	payload: Record<string, unknown>;
	payload_hash?: string;
	contract_version?: string;
	stage_name?: string;
	created_at: string;
}

export interface AiRunOutput {
	id: string;
	run_id: string;
	output_kind: string;
	payload: Record<string, unknown>;
	payload_hash?: string;
	contract_version?: string;
	stage_name?: string;
	created_at: string;
}

export interface IncidentAiRunFailure {
	provider: AiProvider;
	model_id: string;
	trigger_source: 'settings_validation' | 'asset_editor';
	failed_at: string;
	failure_kind: string;
	failure_stage: string;
	prompt_contract_version: string;
	context_fingerprint: string;
}

export interface IncidentAssistantActionFailure {
	tool_name: string;
	status: 'failed';
	issue_count: number;
	error_count: number;
	created_at: string;
	error_message?: string | null;
}

export interface AiTaskSummary {
	run_id: string;
	asset_id: string;
	asset_name: string;
	project_id: string;
	project_rfq_number?: string | null;
	status: AiRunStatus;
	started_at: string;
	completed_at?: string | null;
	failed_at?: string | null;
	cancelled_at?: string | null;
	error_message?: string | null;
}

export interface AiReviewEvent {
	id: string;
	run_id: string;
	asset_id: string;
	event_type: string;
	event_payload: Record<string, unknown>;
	created_at: string;
}

export interface AiOverrideEvent {
	id: string;
	run_id: string;
	asset_id: string;
	field_path: string;
	original_value_json: string;
	final_value_json: string;
	created_at: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type PrimaryOperatorRole =
	| 'owner_founder'
	| 'director_manager'
	| 'estimator'
	| 'project_manager'
	| 'operations_admin'
	| 'other';
export interface AccountIdentity {
	id: string;
	accountName: string;
	accountEmail: string;
	phone: string;
	avatarPath: string;
	created_at: string;
	updated_at: string;
}

export interface ProfileIdentity {
	id: string;
	displayName: string;
	firstName?: string;
	lastName?: string;
	email?: string | null;
	phone?: string | null;
	created_at: string;
	updated_at: string;
}

export interface ControlCustomerIdentity {
	id: string;
	profileId: string;
	displayName: string;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceRegistryEntry {
	id: string;
	customerId: string;
	displayName: string;
	slug: string;
	dbPath: string;
	vaultRootPath: string;
	isDefault: boolean;
	lastOpenedAt?: string | null;
	created_at: string;
	updated_at: string;
}

export type OnboardingStep =
	| 'workspace_setup'
	| 'setup_import_optional'
	| 'local_ai_optional'
	| 'ready'
	| 'blocked_setup_error'
	| 'workspace_creation_failed'
	| 'import_failed_retryable'
	| 'local_ai_setup_attention';

export interface OnboardingStateSnapshot {
	id: string;
	currentStep: OnboardingStep;
	profileCompletedAt?: string | null;
	firstWorkspaceCreatedAt?: string | null;
	importDecidedAt?: string | null;
	localAiDecidedAt?: string | null;
	completedAt?: string | null;
	activeWorkspaceId?: string | null;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceIdentity {
	id: string;
	bootstrapCompletedAt?: string | null;
	onboardingCompletedAt?: string | null;
	onboardingVersion: number;
	workspaceRole?: WorkspaceRole | null;
	created_at: string;
	updated_at: string;
}

export interface CustomerIdentity {
	id: string;
	workspaceId: string;
	displayName: string;
	countryCode: string;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceProfile {
	workspaceId: string;
	displayName: string;
	countryCode: string;
	businessName: string;
	logoFilePath: string;
	aiPlaybookText: string;
	emailSignature: string;
	abn?: string | null;
	businessIdLabel: string;
	businessIdValue: string;
	taxIdLabel: string;
	taxIdValue: string;
	taxDisplayLabel: string;
	taxRatePercentage: number;
	businessAddress: string;
	businessContactName: string;
	businessContactFirstName?: string;
	businessContactLastName?: string;
	businessContactEmail: string;
	businessContactPhone: string;
	businessContactPhoneE164: string;
	businessContactPhoneCountryCode: string;
	currencyCode: string;
	currencySymbol: string;
	measurementUnit: 'Metric' | 'Imperial';
	dateFormat: string;
	languageLocale: string;
	numberLocale: string;
	quotePaymentTerms: string;
	quoteValidityDays: number;
	quoteDefaultInclusions: string;
	quoteDefaultExclusions: string;
	quoteDefaultTerms: string;
	quoteNumberPrefix: string;
	quoteNumberFormat: string;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceAiKnowledgeFile {
	id: string;
	workspaceId: string;
	filePath: string;
	originalName: string;
	mimeType: string | null;
	byteSize: number;
	extractedText: string;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceOnboardingProfile {
	workspaceId: string;
	primaryOperatorRole: PrimaryOperatorRole;
	industry: string;
	created_at: string;
	updated_at: string;
}

export interface WorkspaceMember {
	id: string;
	workspaceId: string;
	role: WorkspaceRole;
	displayName: string;
	firstName?: string;
	lastName?: string;
	email: string;
	avatarPath: string;
	isPrimary: boolean;
	joinedAt: string;
	created_at: string;
	updated_at: string;
}

export type RuntimeContractStatus = 'ready' | 'update_required' | 'repair_required';

export interface RuntimeContractState {
	id: string;
	schemaVersion: number;
	lastOpenedAppVersion: string;
	minimumSupportedAppVersion?: string | null;
	contractStatus: RuntimeContractStatus;
	lastCheckedAt: string;
	created_at: string;
	updated_at: string;
}

/**
 * User profile and formatting preferences.
 * Persisted via Tauri Store (JSON).
 */
export interface UserPreferences {
	name: string;
	email: string;
	avatar: string;
	currencySymbol: string;
	currencyCode: string;
	measurementUnit: 'Metric' | 'Imperial';
	dateFormat: string;
	abn?: string;
	businessName?: string;
	businessAddress?: string;
}

export type ContactKind = 'company' | 'person';
export type ContactRole = 'customer' | 'subcontractor' | 'supplier' | 'vendor' | 'manufacturer';
export type ContactRelationshipType = 'works_for' | 'primary_contact_for';

/** Canonical workspace CRM contact record; name uniqueness is scoped by company/person kind. */
export interface Contact {
	id: string;
	workspace_id: string;
	sort_order: number;
	kind?: ContactKind;
	display_name?: string;
	name: string;
	company_name?: string | null;
	person_first_name?: string | null;
	person_last_name?: string | null;
	role_title?: string | null;
	linked_company_id?: string | null;
	is_primary_company_contact?: boolean;
	country_code: string;
	contact_name?: string | null;
	email?: string | null;
	website?: string | null;
	phone?: string | null;
	phone_e164?: string | null;
	phone_country_code?: string | null;
	abn?: string | null;
	business_id_label?: string | null;
	business_id_value?: string | null;
	tax_id_label?: string | null;
	tax_id_value?: string | null;
	address?: string | null;
	notes?: string | null;
	logo_file_path?: string | null;
	custom_role_label?: string | null;
	roles?: ContactRole[];
	tags?: string[];
	is_active?: boolean;
	created_at: string;
	updated_at: string;
}

export interface ContactRelationship {
	id: string;
	workspace_id: string;
	from_contact_id: string;
	to_contact_id: string;
	relationship_type: ContactRelationshipType;
	is_primary: boolean;
	notes?: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Protocol for sending heavy computation requests to the Node Sidecar.
 */
export interface EstimationRequest {
	asset_id: string;
	file_path: string; // The vault path to read the file
	material_density: number | null;
}

/**
 * Protocol for receiving results from the Node Sidecar.
 */
export interface EstimationResult {
	success: boolean;
	asset_id: string;
	estimate?: Estimate;
	error?: string;
}

export interface WorkspaceSearchQueryInput {
	query: string;
	limit?: number;
	scope?: string | null;
	workspaceId?: string;
	includeInactive?: boolean;
}

export interface SearchResultRow {
	tableName: string;
	recordType?: string | null;
	scope?: string | null;
	recordId: string;
	title: string;
	subtitle: string | null;
	rank: number;
	fields?: Record<string, string | number | boolean | null>;
}
