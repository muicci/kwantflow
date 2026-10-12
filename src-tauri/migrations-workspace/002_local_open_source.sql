-- Existing schema v1 only. Foreign keys MUST be disabled before the migration transaction.
-- Rebuild into new tables, drop the old tables without cascading, then rename into their original
-- names. Every business foreign key keeps the same workspace/member IDs and is checked before commit.
CREATE TABLE workspace_identity_v2 (
    id TEXT PRIMARY KEY,
    bootstrap_completed_at TEXT,
    onboarding_version INTEGER NOT NULL DEFAULT 1,
    workspace_role TEXT CHECK (workspace_role IS NULL OR workspace_role IN ('owner', 'admin', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    onboarding_completed_at TEXT
);
INSERT INTO workspace_identity_v2
SELECT id, bootstrap_completed_at, onboarding_version, workspace_role,
       created_at, updated_at, onboarding_completed_at FROM workspace_identity;
DROP TABLE workspace_identity;
ALTER TABLE workspace_identity_v2 RENAME TO workspace_identity;

CREATE TABLE workspace_members_v2 (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace_identity(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    avatar_path TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT ''
);
INSERT INTO workspace_members_v2
SELECT id, workspace_id, role, display_name, email, avatar_path, is_primary, joined_at,
       created_at, updated_at, first_name, last_name FROM workspace_members;
DROP TABLE workspace_members;
ALTER TABLE workspace_members_v2 RENAME TO workspace_members;
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE UNIQUE INDEX idx_workspace_members_primary ON workspace_members(workspace_id, is_primary)
    WHERE is_primary = 1;
UPDATE runtime_contract_state SET schema_version = 2, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary';
