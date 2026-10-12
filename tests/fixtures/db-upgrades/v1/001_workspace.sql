CREATE TABLE workspace_identity (
	id TEXT PRIMARY KEY,
	mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local', 'cloud')),
	bootstrap_completed_at TEXT,
	onboarding_version INTEGER NOT NULL DEFAULT 1,
	cloud_workspace_id TEXT,
	workspace_role TEXT CHECK (
		workspace_role IS NULL OR workspace_role IN ('owner', 'admin', 'member')
	),
	workspace_link_state TEXT CHECK (
		workspace_link_state IS NULL OR workspace_link_state IN ('unlinked', 'pending', 'linked', 'error')
	),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, onboarding_completed_at TEXT);
CREATE TABLE workspace_members (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	account_id TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
	display_name TEXT NOT NULL DEFAULT '',
	email TEXT NOT NULL DEFAULT '',
	avatar_path TEXT NOT NULL DEFAULT '',
	is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
	joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX idx_workspace_members_workspace_account
	ON workspace_members(workspace_id, account_id);
CREATE UNIQUE INDEX idx_workspace_members_primary
	ON workspace_members(workspace_id, is_primary)
	WHERE is_primary = 1;
CREATE TABLE classification_systems (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	code TEXT NOT NULL,
	classification_type TEXT NOT NULL CHECK (classification_type IN ('masterformat', 'uniformat', 'xactimate', 'custom')),
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, aliases_json TEXT NOT NULL DEFAULT '[]');
CREATE UNIQUE INDEX idx_classification_systems_workspace_name
	ON classification_systems(workspace_id, LOWER(TRIM(name)));
CREATE TABLE material_catalog_items (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	category TEXT,
	specification TEXT,
	unit TEXT NOT NULL CHECK (
		unit IN (
			'ea',
			'set',
			'lot',
			'job',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'min',
			'hr',
			'day',
			'week',
			'mm',
			'm',
			'm2',
			'm3',
			'L',
			'kg',
			't',
			'fixed'
		)
	),
	default_rate REAL NOT NULL DEFAULT 0,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, aliases_json TEXT NOT NULL DEFAULT '[]', effective_date TEXT, verified_date TEXT, rate_basis TEXT NOT NULL DEFAULT 'cost' CHECK (rate_basis IN ('cost', 'sell')), lead_time TEXT NOT NULL DEFAULT '', availability TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '', currency_code TEXT);
CREATE UNIQUE INDEX idx_material_catalog_items_workspace_code
	ON material_catalog_items(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_material_catalog_items_workspace_name
	ON material_catalog_items(workspace_id, LOWER(TRIM(name)));
CREATE TABLE cost_component_presets (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	components_json TEXT NOT NULL DEFAULT '[]',
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, aliases_json TEXT NOT NULL DEFAULT '[]');
CREATE UNIQUE INDEX idx_cost_component_presets_workspace_code
	ON cost_component_presets(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_cost_component_presets_workspace_name
	ON cost_component_presets(workspace_id, LOWER(TRIM(name)));
CREATE TABLE estimate_templates (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	estimate_json TEXT NOT NULL DEFAULT '{}',
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, aliases_json TEXT NOT NULL DEFAULT '[]');
CREATE UNIQUE INDEX idx_estimate_templates_workspace_code
	ON estimate_templates(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_estimate_templates_workspace_name
	ON estimate_templates(workspace_id, LOWER(TRIM(name)));
CREATE TABLE project_structure_templates (
	id TEXT PRIMARY KEY NOT NULL,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_structure_templates_workspace
	ON project_structure_templates(workspace_id, name);
CREATE TABLE "contacts" (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	sort_order INTEGER NOT NULL DEFAULT 0,
	name TEXT NOT NULL,
	contact_name TEXT,
	email TEXT,
	phone TEXT,
	abn TEXT,
	address TEXT,
	notes TEXT,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, country_code TEXT NOT NULL DEFAULT 'AU', business_id_label TEXT NOT NULL DEFAULT 'ABN', business_id_value TEXT, tax_id_label TEXT NOT NULL DEFAULT 'GST', tax_id_value TEXT, phone_e164 TEXT NOT NULL DEFAULT '', phone_country_code TEXT NOT NULL DEFAULT 'AU', kind TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'person')), display_name TEXT, company_name TEXT, person_first_name TEXT, person_last_name TEXT, role_title TEXT, linked_company_id TEXT REFERENCES "contacts"(id) ON DELETE SET NULL, is_primary_company_contact INTEGER NOT NULL DEFAULT 0 CHECK (
		is_primary_company_contact IN (0, 1)
	), roles_json TEXT NOT NULL DEFAULT '["customer"]', tags_json TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)), logo_file_path TEXT, custom_role_label TEXT, website TEXT);
CREATE TABLE projects (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	rfq_number TEXT NOT NULL,
	project_name TEXT,
	due_date TEXT,
	priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
	status TEXT NOT NULL DEFAULT 'draft' CHECK (
		status IN ('draft', 'open', 'estimating', 'quoted', 'won', 'lost', 'archived')
	),
	content TEXT,
	note TEXT,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_favourite INTEGER NOT NULL DEFAULT 0 CHECK (is_favourite IN (0, 1))
, contact_id TEXT REFERENCES "contacts"(id) ON DELETE SET NULL, contact_name_snapshot TEXT, requester_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL, requester_name_snapshot TEXT, source_channel TEXT NOT NULL DEFAULT 'manual', source_reference TEXT, quote_round_prices INTEGER NOT NULL DEFAULT 0 CHECK (quote_round_prices IN (0, 1)), received_date TEXT, submission_deadline_at TEXT, estimator_name TEXT NOT NULL DEFAULT '', customer_tender_reference TEXT NOT NULL DEFAULT '', addendum_label TEXT NOT NULL DEFAULT '', addendum_date TEXT, addendum_notes TEXT NOT NULL DEFAULT '', site_address TEXT NOT NULL DEFAULT '', delivery_address TEXT NOT NULL DEFAULT '', quote_recipient_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL, source_email_message_id TEXT, source_email_integration_id TEXT
  REFERENCES workspace_integrations(id) ON DELETE SET NULL);
CREATE INDEX idx_projects_created_at
	ON projects(created_at DESC);
CREATE INDEX idx_projects_due_date
	ON projects(due_date);
CREATE INDEX idx_projects_status
	ON projects(status);
CREATE INDEX idx_projects_workspace_id
	ON projects(workspace_id);
CREATE INDEX idx_projects_workspace_sort_order
	ON projects(workspace_id, sort_order);
CREATE TABLE files (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	asset_id TEXT,
	file_path TEXT NOT NULL,
	original_name TEXT NOT NULL,
	mime_type TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0), content_hash TEXT, checksum_algorithm TEXT NOT NULL DEFAULT 'sha256', document_type TEXT NOT NULL DEFAULT '', revision_label TEXT NOT NULL DEFAULT '', received_at TEXT, source_label TEXT NOT NULL DEFAULT '', source_metadata_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX idx_files_project_id ON files(project_id);
CREATE INDEX idx_files_asset_id ON files(asset_id);
CREATE TABLE assets (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	display_name TEXT NOT NULL,
	thumbnail_file_id TEXT,
	is_selected INTEGER NOT NULL DEFAULT 1,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, quote_quantity INTEGER NOT NULL DEFAULT 1 CHECK (quote_quantity >= 1), is_pdf_included INTEGER NOT NULL DEFAULT 1 CHECK (is_pdf_included IN (0, 1)),
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
	FOREIGN KEY (thumbnail_file_id) REFERENCES files(id) ON DELETE SET NULL
);
CREATE INDEX idx_assets_project_id
	ON assets(project_id);
CREATE INDEX idx_assets_thumbnail_file_id
	ON assets(thumbnail_file_id);
CREATE TABLE cost_codes (
	id TEXT PRIMARY KEY,
	classification_system_id TEXT NOT NULL,
	parent_id TEXT NULL,
	code TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (classification_system_id) REFERENCES classification_systems(id) ON DELETE CASCADE,
	FOREIGN KEY (parent_id) REFERENCES cost_codes(id) ON DELETE CASCADE
);
CREATE INDEX idx_cost_codes_classification
	ON cost_codes(classification_system_id, sort_order);
CREATE UNIQUE INDEX idx_cost_codes_classification_code
	ON cost_codes(classification_system_id, LOWER(TRIM(code)));
CREATE TABLE wbs_nodes (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	parent_id TEXT NULL,
	code TEXT NULL,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('phase', 'level', 'zone', 'room', 'trade', 'custom')),
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
	FOREIGN KEY (parent_id) REFERENCES wbs_nodes(id) ON DELETE CASCADE
);
CREATE INDEX idx_wbs_nodes_project_id
	ON wbs_nodes(project_id, sort_order);
CREATE TABLE estimates (
	asset_id TEXT PRIMARY KEY,
	scope_summary TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	classification_system_id TEXT NULL,
	wbs_root_node_id TEXT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	applied_template_id TEXT NULL,
	applied_template_name TEXT NULL, currency_code TEXT,
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
	FOREIGN KEY (classification_system_id) REFERENCES classification_systems(id) ON DELETE SET NULL,
	FOREIGN KEY (wbs_root_node_id) REFERENCES wbs_nodes(id) ON DELETE SET NULL
);
CREATE TABLE takeoff_items (
	id TEXT PRIMARY KEY,
	estimate_asset_id TEXT NOT NULL,
	parent_id TEXT NULL,
	wbs_node_id TEXT NULL,
	cost_code_id TEXT NULL,
	name TEXT NOT NULL DEFAULT 'Scope Item',
	description TEXT NOT NULL DEFAULT '',
	quantity REAL NOT NULL DEFAULT 1,
	unit TEXT NOT NULL DEFAULT 'ea',
	properties_json TEXT NOT NULL DEFAULT '{}',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	applied_preset_id TEXT NULL,
	applied_preset_name TEXT NULL,
	FOREIGN KEY (estimate_asset_id) REFERENCES estimates(asset_id) ON DELETE CASCADE,
	FOREIGN KEY (parent_id) REFERENCES takeoff_items(id) ON DELETE CASCADE,
	FOREIGN KEY (wbs_node_id) REFERENCES wbs_nodes(id) ON DELETE SET NULL,
	FOREIGN KEY (cost_code_id) REFERENCES cost_codes(id) ON DELETE SET NULL
);
CREATE INDEX idx_takeoff_items_estimate_asset_id
	ON takeoff_items(estimate_asset_id, sort_order);
CREATE TABLE quote_options (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL,
	label TEXT NOT NULL,
	lead_time TEXT NOT NULL DEFAULT '2 weeks',
	markup_percentage REAL NOT NULL DEFAULT 0,
	notes TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')), material_markup_percentage REAL, labour_markup_percentage REAL, equipment_markup_percentage REAL, subcontract_markup_percentage REAL,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_quote_options_project_id
	ON quote_options(project_id);
CREATE INDEX idx_quote_options_project_sort
	ON quote_options(project_id, sort_order);
CREATE TABLE quote_revisions (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL,
	revision_number INTEGER NOT NULL,
	revision_label TEXT NOT NULL,
	rfq_number_snapshot TEXT NOT NULL,
	contact_name_snapshot TEXT NULL,
	project_name_snapshot TEXT NULL,
	business_name_snapshot TEXT NOT NULL,
	business_abn_snapshot TEXT NULL,
	business_address_snapshot TEXT NULL,
	business_email_snapshot TEXT NULL,
	currency_code_snapshot TEXT NOT NULL,
	currency_symbol_snapshot TEXT NOT NULL,
	issued_date TEXT NOT NULL,
	valid_until_date TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')), business_contact_name_snapshot TEXT, business_contact_phone_snapshot TEXT, business_id_label_snapshot TEXT, business_id_value_snapshot TEXT, tax_id_label_snapshot TEXT, tax_id_value_snapshot TEXT, contact_country_code_snapshot TEXT NULL, contact_business_id_label_snapshot TEXT NULL, contact_business_id_value_snapshot TEXT NULL, contact_tax_id_label_snapshot TEXT NULL, contact_tax_id_value_snapshot TEXT NULL, tax_display_label_snapshot TEXT NULL, tax_rate_percentage_snapshot REAL NULL, package_attachments_json TEXT NOT NULL DEFAULT '[]', sent_status TEXT NOT NULL DEFAULT 'exported' CHECK (sent_status IN ('exported', 'sent')), sent_date TEXT, sent_method TEXT NOT NULL DEFAULT 'download', recipient_snapshot_json TEXT NOT NULL DEFAULT '{}', terms_snapshot_json TEXT NOT NULL DEFAULT '{}', quote_number_snapshot TEXT NOT NULL DEFAULT '', revision_reason TEXT NOT NULL DEFAULT '',
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
	UNIQUE (project_id, revision_number)
);
CREATE INDEX idx_quote_revisions_project_id
	ON quote_revisions(project_id);
CREATE INDEX idx_quote_revisions_project_revision
	ON quote_revisions(project_id, revision_number DESC);
CREATE TABLE quote_revision_options (
	id TEXT PRIMARY KEY NOT NULL,
	revision_id TEXT NOT NULL,
	source_quote_option_id TEXT NULL,
	label TEXT NOT NULL,
	lead_time TEXT NOT NULL,
	markup_percentage REAL NOT NULL DEFAULT 0,
	notes TEXT NOT NULL DEFAULT '',
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
	line_items_json TEXT NOT NULL DEFAULT '[]',
	subtotal_amount REAL NOT NULL DEFAULT 0,
	gst_amount REAL NOT NULL DEFAULT 0,
	total_amount REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (revision_id) REFERENCES quote_revisions(id) ON DELETE CASCADE
);
CREATE INDEX idx_quote_revision_options_revision_id
	ON quote_revision_options(revision_id);
CREATE INDEX idx_quote_revision_options_revision_sort
	ON quote_revision_options(revision_id, sort_order);
CREATE TABLE project_structure_template_nodes (
	id TEXT PRIMARY KEY NOT NULL,
	template_id TEXT NOT NULL REFERENCES project_structure_templates(id) ON DELETE CASCADE,
	parent_id TEXT REFERENCES project_structure_template_nodes(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('phase', 'level', 'zone', 'room', 'trade', 'custom')),
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_structure_template_nodes_template
	ON project_structure_template_nodes(template_id, sort_order, name);
CREATE INDEX idx_project_structure_template_nodes_parent
	ON project_structure_template_nodes(parent_id);
CREATE TABLE ai_runs (
	id TEXT PRIMARY KEY NOT NULL,
	asset_id TEXT NOT NULL,
	provider TEXT NOT NULL,
	model_id TEXT NOT NULL,
	status TEXT NOT NULL,
	trigger_source TEXT NOT NULL,
	started_at TEXT NOT NULL,
	completed_at TEXT,
	failed_at TEXT,
	cancelled_at TEXT,
	error_message TEXT,
	usage_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')), prompt_contract_version TEXT NOT NULL DEFAULT '', context_fingerprint TEXT NOT NULL DEFAULT '', failure_kind TEXT NOT NULL DEFAULT '', failure_stage TEXT NOT NULL DEFAULT '',
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_runs_asset_id ON ai_runs(asset_id);
CREATE INDEX idx_ai_runs_status ON ai_runs(status);
CREATE TABLE ai_run_inputs (
	id TEXT PRIMARY KEY NOT NULL,
	run_id TEXT NOT NULL,
	input_kind TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), payload_hash TEXT NOT NULL DEFAULT '', contract_version TEXT NOT NULL DEFAULT '', stage_name TEXT NOT NULL DEFAULT '',
	FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_run_inputs_run_id ON ai_run_inputs(run_id);
CREATE TABLE ai_run_outputs (
	id TEXT PRIMARY KEY NOT NULL,
	run_id TEXT NOT NULL,
	output_kind TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), payload_hash TEXT NOT NULL DEFAULT '', contract_version TEXT NOT NULL DEFAULT '', stage_name TEXT NOT NULL DEFAULT '',
	FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_run_outputs_run_id ON ai_run_outputs(run_id);
CREATE TABLE ai_evidence_cache (
	id TEXT PRIMARY KEY NOT NULL,
	file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
	cache_kind TEXT NOT NULL CHECK (cache_kind IN ('prepared_metadata', 'unit_extraction', 'file_synthesis')),
	source_content_hash TEXT NOT NULL,
	evidence_unit_key TEXT NOT NULL,
	evidence_unit_hash TEXT NOT NULL,
	preparation_version TEXT NOT NULL,
	extraction_version TEXT NOT NULL DEFAULT '',
	synthesis_version TEXT NOT NULL DEFAULT '',
	model_runtime_id TEXT NOT NULL DEFAULT '',
	payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
	artifact_path TEXT,
	byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_ai_evidence_cache_identity ON ai_evidence_cache(
	file_id, cache_kind, source_content_hash, evidence_unit_key, evidence_unit_hash,
	preparation_version, extraction_version, synthesis_version, model_runtime_id
);
CREATE INDEX idx_ai_evidence_cache_file_access ON ai_evidence_cache(file_id, last_accessed_at DESC);
CREATE TABLE ai_evidence_refs (
	id TEXT PRIMARY KEY NOT NULL,
	run_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	file_id TEXT,
	file_name TEXT NOT NULL,
	quote_path TEXT NOT NULL,
	summary TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	artifact_kind TEXT NOT NULL DEFAULT 'text',
	page_number INTEGER,
	view_label TEXT, evidence_identifier TEXT NOT NULL DEFAULT '', locator_json TEXT NOT NULL DEFAULT '{}', draft_entity_kind TEXT NOT NULL DEFAULT '', draft_entity_key TEXT NOT NULL DEFAULT '', confidence_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE,
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
	FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
);
CREATE INDEX idx_ai_evidence_refs_run_id ON ai_evidence_refs(run_id);
CREATE INDEX idx_ai_evidence_refs_asset_id ON ai_evidence_refs(asset_id);
CREATE TABLE ai_review_events (
	id TEXT PRIMARY KEY NOT NULL,
	run_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	event_payload_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE,
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_review_events_run_id ON ai_review_events(run_id);
CREATE INDEX idx_ai_review_events_asset_id ON ai_review_events(asset_id);
CREATE TABLE ai_override_events (
	id TEXT PRIMARY KEY NOT NULL,
	run_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	field_path TEXT NOT NULL,
	original_value_json TEXT NOT NULL,
	final_value_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE,
	FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_override_events_run_id ON ai_override_events(run_id);
CREATE INDEX idx_ai_override_events_asset_id ON ai_override_events(asset_id);
CREATE TRIGGER trg_cost_codes_parent_scope_insert
BEFORE INSERT ON cost_codes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT classification_system_id FROM cost_codes WHERE id = NEW.parent_id) IS NULL THEN
			RAISE(ABORT, 'Selected parent cost code could not be found')
		WHEN (SELECT classification_system_id FROM cost_codes WHERE id = NEW.parent_id) != NEW.classification_system_id THEN
			RAISE(ABORT, 'Parent cost code must belong to the same classification system')
	END;
END;
CREATE TRIGGER trg_cost_codes_parent_scope_update
BEFORE UPDATE ON cost_codes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT classification_system_id FROM cost_codes WHERE id = NEW.parent_id) IS NULL THEN
			RAISE(ABORT, 'Selected parent cost code could not be found')
		WHEN (SELECT classification_system_id FROM cost_codes WHERE id = NEW.parent_id) != NEW.classification_system_id THEN
			RAISE(ABORT, 'Parent cost code must belong to the same classification system')
	END;
END;
CREATE TRIGGER trg_cost_codes_no_cycles_insert
BEFORE INSERT ON cost_codes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	WITH RECURSIVE ancestors(id) AS (
		SELECT NEW.parent_id
		UNION ALL
		SELECT cost_codes.parent_id
		FROM cost_codes
		JOIN ancestors ON cost_codes.id = ancestors.id
		WHERE cost_codes.parent_id IS NOT NULL
	)
	SELECT CASE
		WHEN EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) THEN
			RAISE(ABORT, 'Cost code parent cannot be a descendant of the current code')
	END;
END;
CREATE TRIGGER trg_cost_codes_no_cycles_update
BEFORE UPDATE ON cost_codes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	WITH RECURSIVE ancestors(id) AS (
		SELECT NEW.parent_id
		UNION ALL
		SELECT cost_codes.parent_id
		FROM cost_codes
		JOIN ancestors ON cost_codes.id = ancestors.id
		WHERE cost_codes.parent_id IS NOT NULL
	)
	SELECT CASE
		WHEN EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) THEN
			RAISE(ABORT, 'Cost code parent cannot be a descendant of the current code')
	END;
END;
CREATE TRIGGER trg_wbs_parent_scope_insert
BEFORE INSERT ON wbs_nodes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.parent_id) IS NULL THEN
			RAISE(ABORT, 'Selected parent WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.parent_id) != NEW.project_id THEN
			RAISE(ABORT, 'Parent WBS node must belong to the same project')
	END;
END;
CREATE TRIGGER trg_wbs_parent_scope_update
BEFORE UPDATE ON wbs_nodes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.parent_id) IS NULL THEN
			RAISE(ABORT, 'Selected parent WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.parent_id) != NEW.project_id THEN
			RAISE(ABORT, 'Parent WBS node must belong to the same project')
	END;
END;
CREATE TRIGGER trg_wbs_no_cycles_insert
BEFORE INSERT ON wbs_nodes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	WITH RECURSIVE ancestors(id) AS (
		SELECT NEW.parent_id
		UNION ALL
		SELECT wbs_nodes.parent_id
		FROM wbs_nodes
		JOIN ancestors ON wbs_nodes.id = ancestors.id
		WHERE wbs_nodes.parent_id IS NOT NULL
	)
	SELECT CASE
		WHEN EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) THEN
			RAISE(ABORT, 'WBS parent cannot be a descendant of the current node')
	END;
END;
CREATE TRIGGER trg_wbs_no_cycles_update
BEFORE UPDATE ON wbs_nodes
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
	WITH RECURSIVE ancestors(id) AS (
		SELECT NEW.parent_id
		UNION ALL
		SELECT wbs_nodes.parent_id
		FROM wbs_nodes
		JOIN ancestors ON wbs_nodes.id = ancestors.id
		WHERE wbs_nodes.parent_id IS NOT NULL
	)
	SELECT CASE
		WHEN EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) THEN
			RAISE(ABORT, 'WBS parent cannot be a descendant of the current node')
	END;
END;
CREATE TRIGGER trg_estimates_wbs_project_insert
BEFORE INSERT ON estimates
FOR EACH ROW
WHEN NEW.wbs_root_node_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM assets WHERE id = NEW.asset_id) IS NULL THEN
			RAISE(ABORT, 'Estimate asset could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_root_node_id) IS NULL THEN
			RAISE(ABORT, 'Selected WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_root_node_id) !=
			(SELECT project_id FROM assets WHERE id = NEW.asset_id) THEN
			RAISE(ABORT, 'Estimate WBS root must belong to the same project as the asset')
	END;
END;
CREATE TRIGGER trg_estimates_wbs_project_update
BEFORE UPDATE ON estimates
FOR EACH ROW
WHEN NEW.wbs_root_node_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM assets WHERE id = NEW.asset_id) IS NULL THEN
			RAISE(ABORT, 'Estimate asset could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_root_node_id) IS NULL THEN
			RAISE(ABORT, 'Selected WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_root_node_id) !=
			(SELECT project_id FROM assets WHERE id = NEW.asset_id) THEN
			RAISE(ABORT, 'Estimate WBS root must belong to the same project as the asset')
	END;
END;
CREATE TRIGGER trg_takeoff_items_wbs_project_insert
BEFORE INSERT ON takeoff_items
FOR EACH ROW
WHEN NEW.wbs_node_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM assets WHERE id = NEW.estimate_asset_id) IS NULL THEN
			RAISE(ABORT, 'Estimate asset could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_node_id) IS NULL THEN
			RAISE(ABORT, 'Selected WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_node_id) !=
			(SELECT project_id FROM assets WHERE id = NEW.estimate_asset_id) THEN
			RAISE(ABORT, 'Takeoff item WBS node must belong to the same project as the asset')
	END;
END;
CREATE TRIGGER trg_takeoff_items_wbs_project_update
BEFORE UPDATE ON takeoff_items
FOR EACH ROW
WHEN NEW.wbs_node_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (SELECT project_id FROM assets WHERE id = NEW.estimate_asset_id) IS NULL THEN
			RAISE(ABORT, 'Estimate asset could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_node_id) IS NULL THEN
			RAISE(ABORT, 'Selected WBS node could not be found')
		WHEN (SELECT project_id FROM wbs_nodes WHERE id = NEW.wbs_node_id) !=
			(SELECT project_id FROM assets WHERE id = NEW.estimate_asset_id) THEN
			RAISE(ABORT, 'Takeoff item WBS node must belong to the same project as the asset')
	END;
END;
CREATE TABLE "workspace_profile" (
	workspace_id TEXT PRIMARY KEY REFERENCES workspace_identity(id) ON DELETE CASCADE,
	display_name TEXT NOT NULL DEFAULT 'Kwantflow Workspace',
	country_code TEXT NOT NULL DEFAULT 'AU',
	business_name TEXT NOT NULL DEFAULT '',
	business_id_label TEXT NOT NULL DEFAULT '',
	business_id_value TEXT NOT NULL DEFAULT '',
	tax_id_label TEXT NOT NULL DEFAULT '',
	tax_id_value TEXT NOT NULL DEFAULT '',
	tax_display_label TEXT NOT NULL DEFAULT 'Tax',
	tax_rate_percentage REAL NOT NULL DEFAULT 0,
	abn TEXT NOT NULL DEFAULT '',
	business_address TEXT NOT NULL DEFAULT '',
	business_contact_name TEXT NOT NULL DEFAULT '',
	business_contact_email TEXT NOT NULL DEFAULT '',
	business_contact_phone TEXT NOT NULL DEFAULT '',
	business_contact_phone_e164 TEXT NOT NULL DEFAULT '',
	business_contact_phone_country_code TEXT NOT NULL DEFAULT '',
	currency_code TEXT NOT NULL DEFAULT 'AUD' CHECK (
		currency_code IN (
			'AED', 'AUD', 'BRL', 'CAD', 'CHF', 'DKK', 'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'JPY',
			'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'SEK', 'SGD', 'THB', 'USD', 'VND', 'ZAR'
		)
	),
	currency_symbol TEXT NOT NULL DEFAULT '$',
	measurement_unit TEXT NOT NULL DEFAULT 'Metric' CHECK (
		measurement_unit IN ('Metric', 'Imperial')
	),
	date_format TEXT NOT NULL DEFAULT 'en-AU' CHECK (
		date_format IN ('en-AU', 'en-US', 'en-GB')
	),
	language_locale TEXT NOT NULL DEFAULT 'en-AU' CHECK (
		language_locale IN ('en-AU', 'en-US', 'en-GB')
	),
	number_locale TEXT NOT NULL DEFAULT 'en-AU' CHECK (
		number_locale IN ('en-AU', 'en-US', 'en-GB')
	),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, ai_playbook_text TEXT NOT NULL DEFAULT '', logo_file_path TEXT NOT NULL DEFAULT '', business_contact_first_name TEXT NOT NULL DEFAULT '', business_contact_last_name TEXT NOT NULL DEFAULT '', quote_payment_terms TEXT NOT NULL DEFAULT 'Payment Terms: Due on receipt.', quote_validity_days INTEGER NOT NULL DEFAULT 30 CHECK (quote_validity_days > 0), quote_default_inclusions TEXT NOT NULL DEFAULT '', quote_default_exclusions TEXT NOT NULL DEFAULT '', quote_default_terms TEXT NOT NULL DEFAULT '', quote_number_prefix TEXT NOT NULL DEFAULT 'Q', quote_number_format TEXT NOT NULL DEFAULT '{prefix}-{yyyy}-{seq}', email_signature TEXT NOT NULL DEFAULT '');
CREATE TABLE cost_components (
	id TEXT PRIMARY KEY,
	takeoff_item_id TEXT NOT NULL,
	category TEXT NOT NULL CHECK (
		category IN ('material', 'labour', 'equipment', 'subcontract', 'misc')
	),
	source_type TEXT NOT NULL CHECK (
		source_type IN (
			'manual',
			'material_catalog',
			'labour_rate_card',
			'equipment_rate_card',
			'subcontract_rate_card'
		)
	),
	source_id TEXT NULL,
	name TEXT NOT NULL DEFAULT 'Cost Component',
	description TEXT NOT NULL DEFAULT '',
	quantity REAL NOT NULL DEFAULT 0,
	unit TEXT NOT NULL DEFAULT 'ea',
	unit_rate REAL NOT NULL DEFAULT 0,
	formula_json TEXT NOT NULL DEFAULT '{}',
	metadata_json TEXT NOT NULL DEFAULT '{}',
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, source_unit_rate_decimal TEXT, source_currency_code TEXT, fx_rate_snapshot_id TEXT
        REFERENCES fx_rate_snapshots(id) ON DELETE SET NULL,
	FOREIGN KEY (takeoff_item_id) REFERENCES takeoff_items(id) ON DELETE CASCADE
);
CREATE INDEX idx_cost_components_takeoff_item_id
	ON cost_components(takeoff_item_id, sort_order);
CREATE TABLE contact_relationships (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	from_contact_id TEXT NOT NULL REFERENCES "contacts"(id) ON DELETE CASCADE,
	to_contact_id TEXT NOT NULL REFERENCES "contacts"(id) ON DELETE CASCADE,
	relationship_type TEXT NOT NULL CHECK (
		relationship_type IN ('works_for', 'primary_contact_for')
	),
	is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
	notes TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_contact_relationships_unique_edge
	ON contact_relationships(
		workspace_id,
		from_contact_id,
		to_contact_id,
		relationship_type
	);
CREATE INDEX idx_contact_relationships_from
	ON contact_relationships(from_contact_id, relationship_type);
CREATE INDEX idx_contact_relationships_to
	ON contact_relationships(to_contact_id, relationship_type);
CREATE INDEX idx_projects_contact_id
	ON projects(contact_id);
CREATE INDEX idx_projects_contact_id_rfq_number
	ON projects(contact_id, rfq_number);
CREATE TABLE company_material_links (
	company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
	material_id TEXT NOT NULL REFERENCES material_catalog_items(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (company_id, material_id)
);
CREATE INDEX idx_company_material_links_material
	ON company_material_links(material_id);
CREATE TABLE company_labour_rate_links (
	company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
	labour_rate_id TEXT NOT NULL REFERENCES labour_rate_cards(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (company_id, labour_rate_id)
);
CREATE INDEX idx_company_labour_rate_links_labour_rate
	ON company_labour_rate_links(labour_rate_id);
CREATE TABLE company_equipment_rate_links (
	company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
	equipment_rate_id TEXT NOT NULL REFERENCES equipment_rate_cards(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (company_id, equipment_rate_id)
);
CREATE INDEX idx_company_equipment_rate_links_equipment_rate
	ON company_equipment_rate_links(equipment_rate_id);
CREATE TABLE company_subcontract_rate_links (
	company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
	subcontract_rate_id TEXT NOT NULL REFERENCES subcontract_rate_cards(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (company_id, subcontract_rate_id)
);
CREATE INDEX idx_company_subcontract_rate_links_subcontract_rate
	ON company_subcontract_rate_links(subcontract_rate_id);
CREATE UNIQUE INDEX idx_contacts_workspace_abn_unique
	ON contacts(workspace_id, abn)
	WHERE abn IS NOT NULL AND TRIM(abn) <> '';
CREATE INDEX idx_contacts_workspace_id
	ON contacts(workspace_id);
CREATE INDEX idx_contacts_workspace_sort_order
	ON contacts(workspace_id, sort_order);
CREATE UNIQUE INDEX idx_contacts_workspace_country_business_id_unique
	ON contacts(workspace_id, country_code, business_id_value)
	WHERE business_id_value IS NOT NULL AND TRIM(business_id_value) <> '';
CREATE INDEX idx_contacts_workspace_country_id
	ON contacts(workspace_id, country_code);
CREATE INDEX idx_contacts_workspace_kind
	ON contacts(workspace_id, kind, sort_order);
CREATE INDEX idx_contacts_workspace_display_name
	ON contacts(workspace_id, LOWER(TRIM(display_name)));
CREATE INDEX idx_contacts_linked_company_id
	ON contacts(linked_company_id);
CREATE UNIQUE INDEX idx_projects_contact_rfq_unique
	ON projects(contact_id, rfq_number);
CREATE TABLE runtime_contract_state (
	id TEXT PRIMARY KEY NOT NULL,
	schema_version INTEGER NOT NULL,
	last_opened_app_version TEXT NOT NULL,
	minimum_supported_app_version TEXT,
	contract_status TEXT NOT NULL DEFAULT 'ready' CHECK (
		contract_status IN ('ready', 'update_required', 'repair_required')
	),
	last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO runtime_contract_state (
	id, schema_version, last_opened_app_version, contract_status
) VALUES ('primary', 1, '', 'ready');
CREATE INDEX idx_ai_evidence_refs_file_id
	ON ai_evidence_refs(file_id);
CREATE INDEX idx_cost_codes_parent_id
	ON cost_codes(parent_id);
CREATE INDEX idx_estimates_wbs_root_node_id
	ON estimates(wbs_root_node_id);
CREATE INDEX idx_estimates_classification_system_id
	ON estimates(classification_system_id);
CREATE INDEX idx_projects_requester_contact_id
	ON projects(requester_contact_id);
CREATE INDEX idx_takeoff_items_cost_code_id
	ON takeoff_items(cost_code_id);
CREATE INDEX idx_takeoff_items_wbs_node_id
	ON takeoff_items(wbs_node_id);
CREATE INDEX idx_takeoff_items_parent_id
	ON takeoff_items(parent_id);
CREATE INDEX idx_wbs_nodes_parent_id
	ON wbs_nodes(parent_id);
CREATE INDEX idx_workspace_members_account_id
	ON workspace_members(account_id);
CREATE TABLE quote_option_presets (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    label TEXT NOT NULL,
    lead_time TEXT NOT NULL DEFAULT '2 weeks',
    markup_percentage REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), material_markup_percentage REAL, labour_markup_percentage REAL, equipment_markup_percentage REAL, subcontract_markup_percentage REAL,
    FOREIGN KEY (workspace_id) REFERENCES workspace_identity(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_quote_option_presets_workspace_label
    ON quote_option_presets(workspace_id, LOWER(TRIM(label)));
CREATE INDEX idx_quote_option_presets_workspace_id
    ON quote_option_presets(workspace_id);
CREATE TABLE workspace_ai_knowledge_files (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	file_path TEXT NOT NULL,
	original_name TEXT NOT NULL,
	mime_type TEXT,
	byte_size INTEGER NOT NULL DEFAULT 0,
	extracted_text TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_workspace_ai_knowledge_files_workspace_id
	ON workspace_ai_knowledge_files(workspace_id);
CREATE TABLE workspace_ai_feedback_entries (
	id TEXT PRIMARY KEY NOT NULL,
	workspace_id TEXT NOT NULL,
	run_id TEXT NOT NULL,
	asset_id TEXT,
	estimate_id TEXT,
	feedback_text TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workspace_ai_feedback_entries_workspace_id
	ON workspace_ai_feedback_entries(workspace_id, created_at);
CREATE INDEX idx_workspace_ai_feedback_entries_run_id
	ON workspace_ai_feedback_entries(run_id);
CREATE TABLE "workspace_onboarding_profile" (
	workspace_id TEXT PRIMARY KEY
		REFERENCES workspace_identity(id)
		ON DELETE CASCADE,
	primary_operator_role TEXT NOT NULL DEFAULT 'owner_founder',
	industry TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_projects_quote_recipient_contact_id
	ON projects(quote_recipient_contact_id);
CREATE INDEX idx_ai_runs_context_fingerprint
	ON ai_runs(context_fingerprint)
	WHERE context_fingerprint <> '';
CREATE INDEX idx_ai_runs_failure_kind
	ON ai_runs(failure_kind)
	WHERE failure_kind <> '';
CREATE INDEX idx_ai_run_inputs_stage
	ON ai_run_inputs(run_id, stage_name)
	WHERE stage_name <> '';
CREATE INDEX idx_ai_run_outputs_stage
	ON ai_run_outputs(run_id, stage_name)
	WHERE stage_name <> '';
CREATE INDEX idx_ai_evidence_refs_identifier
	ON ai_evidence_refs(run_id, evidence_identifier)
	WHERE evidence_identifier <> '';
CREATE INDEX idx_ai_evidence_refs_draft_entity
	ON ai_evidence_refs(run_id, draft_entity_kind, draft_entity_key)
	WHERE draft_entity_kind <> '' AND draft_entity_key <> '';
CREATE UNIQUE INDEX idx_contacts_workspace_company_name_unique
	ON contacts(workspace_id, LOWER(TRIM(name)))
	WHERE kind = 'company' AND TRIM(name) <> '';
CREATE UNIQUE INDEX idx_contacts_workspace_person_company_name_unique
	ON contacts(workspace_id, COALESCE(NULLIF(TRIM(linked_company_id), ''), '__unlinked__'), LOWER(TRIM(name)))
	WHERE kind = 'person' AND TRIM(name) <> '';
CREATE TABLE workspace_integrations (
	id TEXT PRIMARY KEY NOT NULL,
	workspace_id TEXT NOT NULL,
	provider TEXT NOT NULL,                       -- 'google_gmail', 'microsoft_outlook', 'xero', etc.
	label TEXT NOT NULL,                           -- User-given name, e.g. "Work Gmail"
	status TEXT NOT NULL DEFAULT 'active'
		CHECK (status IN ('active', 'expired', 'revoked', 'error')),
	external_id TEXT,                              -- Provider account identifier (email, user ID)
	external_name TEXT,                            -- Provider display name
	config TEXT DEFAULT '{}',                      -- Non-secret JSON config (scopes, flags)
	token_expires_at INTEGER,                      -- Unix timestamp (null if unknown)
	last_error TEXT,                               -- User-facing error message
	connected_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	created_at TEXT NOT NULL DEFAULT (datetime('now')), rfq_detection_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (rfq_detection_enabled IN (0, 1)), polling_interval TEXT NOT NULL DEFAULT 'off'
  CHECK (polling_interval IN ('off', '15m', '30m', '1h')), sync_cursor TEXT, last_synced_at TEXT,
	UNIQUE (workspace_id, provider, external_id),
	UNIQUE (workspace_id, label)
);
CREATE INDEX idx_workspace_integrations_workspace
	ON workspace_integrations(workspace_id, status);
CREATE TABLE "labour_rate_cards" (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	category TEXT,
	work_center TEXT,
	unit TEXT NOT NULL CHECK (unit IN ('min', 'hr', 'day', 'shift', 'week', 'fixed', 'm', 'm2', 'm3')),
	default_rate REAL NOT NULL DEFAULT 0,
	aliases_json TEXT NOT NULL DEFAULT '[]',
	metadata_json TEXT NOT NULL DEFAULT '{}',
	effective_date TEXT,
	verified_date TEXT,
	rate_basis TEXT NOT NULL DEFAULT 'cost' CHECK (rate_basis IN ('cost', 'sell')),
	lead_time TEXT NOT NULL DEFAULT '',
	availability TEXT NOT NULL DEFAULT '',
	reference TEXT NOT NULL DEFAULT '',
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, currency_code TEXT);
CREATE UNIQUE INDEX idx_labour_rate_cards_workspace_code
	ON labour_rate_cards(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_labour_rate_cards_workspace_name
	ON labour_rate_cards(workspace_id, LOWER(TRIM(name)));
CREATE TABLE "equipment_rate_cards" (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	category TEXT,
	work_center TEXT,
	unit TEXT NOT NULL CHECK (unit IN ('min', 'hr', 'day', 'shift', 'week', 'fixed', 'm', 'm2', 'm3')),
	default_rate REAL NOT NULL DEFAULT 0,
	aliases_json TEXT NOT NULL DEFAULT '[]',
	metadata_json TEXT NOT NULL DEFAULT '{}',
	effective_date TEXT,
	verified_date TEXT,
	rate_basis TEXT NOT NULL DEFAULT 'cost' CHECK (rate_basis IN ('cost', 'sell')),
	lead_time TEXT NOT NULL DEFAULT '',
	availability TEXT NOT NULL DEFAULT '',
	reference TEXT NOT NULL DEFAULT '',
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, currency_code TEXT);
CREATE UNIQUE INDEX idx_equipment_rate_cards_workspace_code
	ON equipment_rate_cards(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_equipment_rate_cards_workspace_name
	ON equipment_rate_cards(workspace_id, LOWER(TRIM(name)));
CREATE TABLE assistant_action_audit (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	turn_id TEXT NOT NULL,
	action_id TEXT NOT NULL,
	proposal_id TEXT NOT NULL,
	tool_name TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('proposed', 'validated', 'rejected', 'approved', 'executed', 'failed')),
	item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
	issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
	error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
	payload_json TEXT NOT NULL DEFAULT '{}',
	error_message TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_assistant_action_audit_workspace_created_at
	ON assistant_action_audit(workspace_id, created_at DESC);
CREATE INDEX idx_assistant_action_audit_turn
	ON assistant_action_audit(turn_id, created_at DESC);
CREATE INDEX idx_assistant_action_audit_proposal_status
	ON assistant_action_audit(proposal_id, status, created_at DESC);
CREATE TABLE setup_import_audit (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	source_file_name TEXT NOT NULL,
	source_content_hash TEXT NOT NULL,
	imported_sheet_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(imported_sheet_ids_json)),
	duplicate_modes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(duplicate_modes_json)),
	created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
	updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
	skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
	failure_summary TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_setup_import_audit_workspace_created_at
	ON setup_import_audit(workspace_id, created_at DESC);
CREATE TABLE fx_rate_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL
        REFERENCES workspace_identity(id) ON DELETE CASCADE,
    from_currency_code TEXT NOT NULL,
    to_currency_code TEXT NOT NULL,
    rate_decimal TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    effective_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (from_currency_code != to_currency_code)
);
CREATE INDEX idx_fx_snapshots_ws_pair_date
    ON fx_rate_snapshots(
        workspace_id,
        from_currency_code,
        to_currency_code,
        effective_at DESC
    );
CREATE TABLE project_file_page_chunks (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text_content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX idx_project_file_page_chunks_file_page 
ON project_file_page_chunks(file_id, page_number);
CREATE VIRTUAL TABLE project_file_page_chunks_fts USING fts5(
    id UNINDEXED,
    text_content,
    content='project_file_page_chunks',
    content_rowid='rowid'
)
/* project_file_page_chunks_fts(id,text_content) */;
CREATE TRIGGER trg_project_file_page_chunks_ai AFTER INSERT ON project_file_page_chunks BEGIN
  INSERT INTO project_file_page_chunks_fts(rowid, id, text_content)
  VALUES (new.rowid, new.id, new.text_content);
END;
CREATE TRIGGER trg_project_file_page_chunks_ad AFTER DELETE ON project_file_page_chunks BEGIN
  INSERT INTO project_file_page_chunks_fts(project_file_page_chunks_fts, rowid, id, text_content)
  VALUES('delete', old.rowid, old.id, old.text_content);
END;
CREATE TRIGGER trg_project_file_page_chunks_au AFTER UPDATE OF text_content ON project_file_page_chunks BEGIN
  INSERT INTO project_file_page_chunks_fts(project_file_page_chunks_fts, rowid, id, text_content)
  VALUES('delete', old.rowid, old.id, old.text_content);
  INSERT INTO project_file_page_chunks_fts(rowid, id, text_content)
  VALUES (new.rowid, new.id, new.text_content);
END;
CREATE TABLE project_asset_som_grids (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    page_number INTEGER,
    grid_rows INTEGER NOT NULL,
    grid_cols INTEGER NOT NULL,
    grid_data_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX idx_project_asset_som_grids_file ON project_asset_som_grids(file_id);
CREATE INDEX idx_project_asset_som_grids_file_page ON project_asset_som_grids(file_id, page_number);
CREATE TABLE "subcontract_rate_cards" (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
	code TEXT,
	name TEXT NOT NULL,
	category TEXT,
	unit TEXT NOT NULL CHECK (
		unit IN (
			'ea',
			'set',
			'lot',
			'job',
			'sheet',
			'pack',
			'box',
			'bag',
			'roll',
			'min',
			'hr',
			'day',
			'shift',
			'week',
			'mm',
			'm',
			'm2',
			'm3',
			'L',
			'kg',
			't',
			'fixed',
			'point',
			'lump_sum'
		)
	),
	default_rate REAL NOT NULL DEFAULT 0,
	aliases_json TEXT NOT NULL DEFAULT '[]',
	metadata_json TEXT NOT NULL DEFAULT '{}',
	effective_date TEXT,
	verified_date TEXT,
	rate_basis TEXT NOT NULL DEFAULT 'cost' CHECK (rate_basis IN ('cost', 'sell')),
	lead_time TEXT NOT NULL DEFAULT '',
	availability TEXT NOT NULL DEFAULT '',
	reference TEXT NOT NULL DEFAULT '',
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	currency_code TEXT
);
CREATE UNIQUE INDEX idx_subcontract_rate_cards_workspace_code
	ON subcontract_rate_cards(workspace_id, LOWER(TRIM(code)))
	WHERE code IS NOT NULL AND TRIM(code) <> '';
CREATE UNIQUE INDEX idx_subcontract_rate_cards_workspace_name
	ON subcontract_rate_cards(
		workspace_id,
		LOWER(TRIM(name))
	);
CREATE INDEX idx_cost_components_fx_rate_snapshot_id
    ON cost_components(fx_rate_snapshot_id);
CREATE INDEX idx_projects_source_email
  ON projects(source_email_integration_id, source_email_message_id);
CREATE TABLE email_rfq_classifications (
  integration_id TEXT NOT NULL
    REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  classifier_version TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('rfq', 'not_rfq')),
  model_id TEXT NOT NULL,
  classified_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (integration_id, provider_message_id, classifier_version)
);
CREATE INDEX idx_email_rfq_classifications_verdict
  ON email_rfq_classifications(integration_id, verdict, classified_at DESC);
-- Search indexes are part of the clean workspace baseline. They are content-backed FTS5
-- tables maintained by database triggers, so every native and Kysely write stays searchable.
-- Enables rapid offline keyword, prefix, and alias searches across all tables for Kwantflow AI agent loops.

-- ──────────────────────────────────────────────────────────
-- 0. Projects FTS index
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS global_search_index USING fts5(
    id UNINDEXED,
    rfq_number,
    project_name,
    content,
    note,
    content='projects',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS projects_ai AFTER INSERT ON projects BEGIN
  INSERT INTO global_search_index(rowid, id, rfq_number, project_name, content, note)
  VALUES (new.rowid, new.id, new.rfq_number, new.project_name, new.content, new.note);
END;

CREATE TRIGGER IF NOT EXISTS projects_ad AFTER DELETE ON projects BEGIN
  INSERT INTO global_search_index(global_search_index, rowid, id, rfq_number, project_name, content, note)
  VALUES('delete', old.rowid, old.id, old.rfq_number, old.project_name, old.content, old.note);
END;

CREATE TRIGGER IF NOT EXISTS projects_au AFTER UPDATE ON projects BEGIN
  INSERT INTO global_search_index(global_search_index, rowid, id, rfq_number, project_name, content, note)
  VALUES('delete', old.rowid, old.id, old.rfq_number, old.project_name, old.content, old.note);
  INSERT INTO global_search_index(rowid, id, rfq_number, project_name, content, note)
  VALUES (new.rowid, new.id, new.rfq_number, new.project_name, new.content, new.note);
END;


-- ──────────────────────────────────────────────────────────
-- 1. Contacts FTS Table & Triggers (Includes Names, First/Last, Custom Roles, Address, etc.)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    kind,
    display_name,
    name,
    company_name,
    person_first_name,
    person_last_name,
    custom_role_label,
    email,
    phone,
    address,
    notes,
    content='contacts',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_search_index(rowid, id, workspace_id, kind, display_name, name, company_name, person_first_name, person_last_name, custom_role_label, email, phone, address, notes)
  VALUES (new.rowid, new.id, new.workspace_id, new.kind, new.display_name, new.name, new.company_name, new.person_first_name, new.person_last_name, new.custom_role_label, new.email, new.phone, new.address, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_search_index(contacts_search_index, rowid, id, workspace_id, kind, display_name, name, company_name, person_first_name, person_last_name, custom_role_label, email, phone, address, notes)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.kind, old.display_name, old.name, old.company_name, old.person_first_name, old.person_last_name, old.custom_role_label, old.email, old.phone, old.address, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_search_index(contacts_search_index, rowid, id, workspace_id, kind, display_name, name, company_name, person_first_name, person_last_name, custom_role_label, email, phone, address, notes)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.kind, old.display_name, old.name, old.company_name, old.person_first_name, old.person_last_name, old.custom_role_label, old.email, old.phone, old.address, old.notes);
  INSERT INTO contacts_search_index(rowid, id, workspace_id, kind, display_name, name, company_name, person_first_name, person_last_name, custom_role_label, email, phone, address, notes)
  VALUES (new.rowid, new.id, new.workspace_id, new.kind, new.display_name, new.name, new.company_name, new.person_first_name, new.person_last_name, new.custom_role_label, new.email, new.phone, new.address, new.notes);
END;


-- ──────────────────────────────────────────────────────────
-- 2. Material Catalog FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS materials_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    name,
    code,
    category,
    unit,
    specification,
    aliases_json,
    content='material_catalog_items',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS materials_ai AFTER INSERT ON material_catalog_items BEGIN
  INSERT INTO materials_search_index(rowid, id, workspace_id, name, code, category, unit, specification, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.name, new.code, new.category, new.unit, new.specification, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS materials_ad AFTER DELETE ON material_catalog_items BEGIN
  INSERT INTO materials_search_index(materials_search_index, rowid, id, workspace_id, name, code, category, unit, specification, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.name, old.code, old.category, old.unit, old.specification, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS materials_au AFTER UPDATE ON material_catalog_items BEGIN
  INSERT INTO materials_search_index(materials_search_index, rowid, id, workspace_id, name, code, category, unit, specification, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.name, old.code, old.category, old.unit, old.specification, old.aliases_json);
  INSERT INTO materials_search_index(rowid, id, workspace_id, name, code, category, unit, specification, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.name, new.code, new.category, new.unit, new.specification, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 3. Labour Rate Cards FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS labour_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    code,
    name,
    category,
    work_center,
    unit,
    reference,
    aliases_json,
    content='labour_rate_cards',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS labour_ai AFTER INSERT ON labour_rate_cards BEGIN
  INSERT INTO labour_search_index(rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.work_center, new.unit, new.reference, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS labour_ad AFTER DELETE ON labour_rate_cards BEGIN
  INSERT INTO labour_search_index(labour_search_index, rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.work_center, old.unit, old.reference, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS labour_au AFTER UPDATE ON labour_rate_cards BEGIN
  INSERT INTO labour_search_index(labour_search_index, rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.work_center, old.unit, old.reference, old.aliases_json);
  INSERT INTO labour_search_index(rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.work_center, new.unit, new.reference, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 4. Equipment Rate Cards FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS equipment_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    code,
    name,
    category,
    work_center,
    unit,
    reference,
    aliases_json,
    content='equipment_rate_cards',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS equipment_ai AFTER INSERT ON equipment_rate_cards BEGIN
  INSERT INTO equipment_search_index(rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.work_center, new.unit, new.reference, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS equipment_ad AFTER DELETE ON equipment_rate_cards BEGIN
  INSERT INTO equipment_search_index(equipment_search_index, rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.work_center, old.unit, old.reference, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS equipment_au AFTER UPDATE ON equipment_rate_cards BEGIN
  INSERT INTO equipment_search_index(equipment_search_index, rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.work_center, old.unit, old.reference, old.aliases_json);
  INSERT INTO equipment_search_index(rowid, id, workspace_id, code, name, category, work_center, unit, reference, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.work_center, new.unit, new.reference, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 5. Subcontract Rate Cards FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS subcontract_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    code,
    name,
    category,
    unit,
    aliases_json,
    content='subcontract_rate_cards',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS subcontract_ai AFTER INSERT ON subcontract_rate_cards BEGIN
  INSERT INTO subcontract_search_index(rowid, id, workspace_id, code, name, category, unit, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.unit, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS subcontract_ad AFTER DELETE ON subcontract_rate_cards BEGIN
  INSERT INTO subcontract_search_index(subcontract_search_index, rowid, id, workspace_id, code, name, category, unit, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.unit, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS subcontract_au AFTER UPDATE ON subcontract_rate_cards BEGIN
  INSERT INTO subcontract_search_index(subcontract_search_index, rowid, id, workspace_id, code, name, category, unit, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.category, old.unit, old.aliases_json);
  INSERT INTO subcontract_search_index(rowid, id, workspace_id, code, name, category, unit, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.category, new.unit, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 6. Cost Component Presets FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS cost_presets_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    code,
    name,
    description,
    aliases_json,
    content='cost_component_presets',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS cost_presets_ai AFTER INSERT ON cost_component_presets BEGIN
  INSERT INTO cost_presets_search_index(rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.description, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS cost_presets_ad AFTER DELETE ON cost_component_presets BEGIN
  INSERT INTO cost_presets_search_index(cost_presets_search_index, rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.description, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS cost_presets_au AFTER UPDATE ON cost_component_presets BEGIN
  INSERT INTO cost_presets_search_index(cost_presets_search_index, rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.description, old.aliases_json);
  INSERT INTO cost_presets_search_index(rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.description, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 7. Estimate Templates FTS Table & Triggers (Includes Aliases)
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS templates_search_index USING fts5(
    id UNINDEXED,
    workspace_id,
    code,
    name,
    description,
    aliases_json,
    content='estimate_templates',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS templates_ai AFTER INSERT ON estimate_templates BEGIN
  INSERT INTO templates_search_index(rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.description, new.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS templates_ad AFTER DELETE ON estimate_templates BEGIN
  INSERT INTO templates_search_index(templates_search_index, rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.description, old.aliases_json);
END;

CREATE TRIGGER IF NOT EXISTS templates_au AFTER UPDATE ON estimate_templates BEGIN
  INSERT INTO templates_search_index(templates_search_index, rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES('delete', old.rowid, old.id, old.workspace_id, old.code, old.name, old.description, old.aliases_json);
  INSERT INTO templates_search_index(rowid, id, workspace_id, code, name, description, aliases_json)
  VALUES (new.rowid, new.id, new.workspace_id, new.code, new.name, new.description, new.aliases_json);
END;


-- ──────────────────────────────────────────────────────────
-- 8. Estimates FTS Table & Triggers
-- ──────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS estimates_search_index USING fts5(
    asset_id UNINDEXED,
    scope_summary,
    notes,
    content='estimates',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS estimates_ai AFTER INSERT ON estimates BEGIN
  INSERT INTO estimates_search_index(rowid, asset_id, scope_summary, notes)
  VALUES (new.rowid, new.asset_id, new.scope_summary, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS estimates_ad AFTER DELETE ON estimates BEGIN
  INSERT INTO estimates_search_index(estimates_search_index, rowid, asset_id, scope_summary, notes)
  VALUES('delete', old.rowid, old.asset_id, old.scope_summary, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS estimates_au AFTER UPDATE ON estimates BEGIN
  INSERT INTO estimates_search_index(estimates_search_index, rowid, asset_id, scope_summary, notes)
  VALUES('delete', old.rowid, old.asset_id, old.scope_summary, old.notes);
  INSERT INTO estimates_search_index(rowid, asset_id, scope_summary, notes)
  VALUES (new.rowid, new.asset_id, new.scope_summary, new.notes);
END;
