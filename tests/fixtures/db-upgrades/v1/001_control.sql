-- Setup import audit is workspace-owned because import outcomes describe workspace-local business
-- records; the control database intentionally keeps no setup import audit table.
CREATE TABLE profile_identity (
	id TEXT PRIMARY KEY CHECK (id = 'primary-profile'),
	display_name TEXT NOT NULL DEFAULT '',
	email TEXT,
	phone TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '');
CREATE TABLE control_contract_state (
	id TEXT PRIMARY KEY CHECK (id = 'primary'),
	schema_version INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO control_contract_state (id, schema_version) VALUES ('primary', 1);
CREATE TABLE control_customer_identity (
	id TEXT PRIMARY KEY CHECK (id = 'primary-customer'),
	profile_id TEXT NOT NULL REFERENCES profile_identity(id) ON DELETE CASCADE,
	display_name TEXT NOT NULL DEFAULT '',
	plan_state TEXT NOT NULL DEFAULT 'free_local',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE workspace_registry (
	id TEXT PRIMARY KEY,
	customer_id TEXT NOT NULL REFERENCES control_customer_identity(id) ON DELETE CASCADE,
	display_name TEXT NOT NULL,
	slug TEXT NOT NULL,
	db_path TEXT NOT NULL,
	vault_root_path TEXT NOT NULL,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	last_opened_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_workspace_registry_customer_slug
	ON workspace_registry(customer_id, slug);
CREATE UNIQUE INDEX idx_workspace_registry_default
	ON workspace_registry(customer_id, is_default)
	WHERE is_default = 1;
CREATE TABLE account_entitlement_cache (
	account_scope_key TEXT PRIMARY KEY,
	plan_code TEXT NOT NULL DEFAULT 'free_local',
	status TEXT NOT NULL DEFAULT 'active',
	lease_expires_at TEXT,
	polar_customer_id TEXT,
	refreshed_at TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, trial_started_at TEXT, trial_expires_at TEXT, last_known_time TEXT, workspace_limit INTEGER, ai_access TEXT, device_limit INTEGER, polar_subscription_id TEXT, active_rfq_limit INTEGER, current_period_ends_at TEXT, email_integration_limit INTEGER);
CREATE TABLE background_maintenance_state (
	task_key TEXT PRIMARY KEY,
	last_checked_at TEXT,
	last_submitted_at TEXT,
	last_fingerprint TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE install_identity (
	id TEXT PRIMARY KEY NOT NULL DEFAULT 'primary-install',
	install_id TEXT NOT NULL UNIQUE,
	device_label TEXT,
	platform TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "onboarding_state" (
	id TEXT PRIMARY KEY CHECK (id = 'primary-onboarding'),
	current_step TEXT NOT NULL DEFAULT 'account_link' CHECK (
		current_step IN (
			'account_link',
			'workspace_setup',
			'setup_import_optional',
			'local_ai_optional',
			'ready',
			'blocked_setup_error',
			'workspace_creation_failed',
			'import_failed_retryable',
			'local_ai_setup_attention'
		)
	),
	profile_completed_at TEXT,
	first_workspace_created_at TEXT,
	import_decided_at TEXT,
	local_ai_decided_at TEXT,
	completed_at TEXT,
	active_workspace_id TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_customer_identity_profile_id
	ON control_customer_identity(profile_id);
-- Control baseline intentionally remains separate from workspace-owned AI evidence caches.
