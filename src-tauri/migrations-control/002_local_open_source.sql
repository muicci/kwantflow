-- Existing schema v1 only. DatabaseRuntime runs this on a dedicated connection with foreign keys
-- disabled before BEGIN IMMEDIATE, and validates preserved row counts and foreign keys before commit.
ALTER TABLE control_customer_identity DROP COLUMN plan_state;
DROP TABLE account_entitlement_cache;
DROP TABLE background_maintenance_state;
DROP TABLE install_identity;

CREATE TABLE onboarding_state_v2 (
    id TEXT PRIMARY KEY CHECK (id = 'primary-onboarding'),
    current_step TEXT NOT NULL DEFAULT 'workspace_setup' CHECK (
        current_step IN (
            'workspace_setup', 'setup_import_optional', 'local_ai_optional', 'ready',
            'blocked_setup_error', 'workspace_creation_failed', 'import_failed_retryable',
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
INSERT INTO onboarding_state_v2
SELECT id,
       CASE WHEN current_step <> 'account_link' THEN current_step
            WHEN active_workspace_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM workspace_registry WHERE id = onboarding_state.active_workspace_id
            ) THEN 'workspace_setup'
            WHEN import_decided_at IS NULL THEN 'setup_import_optional'
            WHEN local_ai_decided_at IS NULL THEN 'local_ai_optional'
            ELSE 'ready' END,
       profile_completed_at, first_workspace_created_at, import_decided_at, local_ai_decided_at,
       CASE WHEN current_step = 'account_link'
                 AND active_workspace_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM workspace_registry WHERE id = onboarding_state.active_workspace_id)
                 AND import_decided_at IS NOT NULL AND local_ai_decided_at IS NOT NULL
            THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END,
       active_workspace_id, created_at, updated_at
FROM onboarding_state;
DROP TABLE onboarding_state;
ALTER TABLE onboarding_state_v2 RENAME TO onboarding_state;
UPDATE control_contract_state SET schema_version = 2, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary';
