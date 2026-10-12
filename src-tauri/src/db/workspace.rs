use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::{
    commands::upsert_local_bootstrap_foundation_on_pool,
    runtime::{assert_database_integrity, DatabaseRuntime},
    types::BootstrapFoundationInput,
};
use crate::ai_evidence_cache::{
    remove_ai_evidence_cache_for_workspace, sweep_ai_evidence_cache_for_workspace,
};
use crate::integrations::delete_workspace_token_bundles;

const WORKSPACES_DB_ROOT: &str = "workspaces";
const VAULT_ROOT: &str = "Kwantflow";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateWorkspaceInput {
    pub workspace_id: String,
    pub customer_id: String,
    pub display_name: String,
    pub slug: String,
    pub is_default: bool,
    pub last_opened_at: String,
    pub foundation: BootstrapFoundationInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceIdInput {
    pub workspace_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceRegistryEntry {
    pub id: String,
    pub customer_id: String,
    pub display_name: String,
    pub slug: String,
    pub db_path: String,
    pub vault_root_path: String,
    pub is_default: bool,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id.is_empty()
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Workspace ID must contain only letters, numbers, '-' or '_'.".to_string());
    }
    Ok(())
}

fn workspace_db_relative_path(workspace_id: &str) -> String {
    format!("{WORKSPACES_DB_ROOT}/{workspace_id}/workspace.db")
}

fn workspace_vault_relative_path(workspace_id: &str) -> String {
    format!("{VAULT_ROOT}/workspaces/{workspace_id}/vault")
}

fn workspace_db_directory(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Resolve application data directory: {error}"))?
        .join(WORKSPACES_DB_ROOT)
        .join(workspace_id))
}

fn workspace_db_path(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    Ok(workspace_db_directory(app, workspace_id)?.join("workspace.db"))
}

fn workspace_vault_path(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    Ok(crate::document_root(app)?
        .join(VAULT_ROOT)
        .join("workspaces")
        .join(workspace_id)
        .join("vault"))
}

fn remove_workspace_files(db_directory: &Path, vault_path: &Path) {
    if let Err(error) = std::fs::remove_dir_all(db_directory) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "[database] Failed to remove workspace database staging directory {}: {}",
                db_directory.display(),
                error
            );
        }
    }
    if let Some(vault_container) = vault_path.parent() {
        if let Err(error) = std::fs::remove_dir_all(vault_container) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "[database] Failed to remove workspace vault staging directory {}: {}",
                    vault_container.display(),
                    error
                );
            }
        }
    }
}

fn stage_directory_for_delete(path: &Path, token: &str) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Resolve deletion staging parent for {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Resolve deletion staging name for {}", path.display()))?;
    let staged = parent.join(format!(".{file_name}.deleting-{token}"));
    std::fs::rename(path, &staged).map_err(|error| {
        format!(
            "Stage workspace path {} for deletion: {error}",
            path.display()
        )
    })?;
    Ok(Some(staged))
}

fn restore_staged_directory(live: &Path, staged: Option<&PathBuf>) -> Result<(), String> {
    let Some(staged) = staged else {
        return Ok(());
    };
    if staged.exists() {
        std::fs::rename(staged, live).map_err(|error| {
            format!(
                "Restore staged workspace path {} to {}: {error}",
                staged.display(),
                live.display()
            )
        })?;
    }
    Ok(())
}

fn map_registry_row(row: sqlx::sqlite::SqliteRow) -> WorkspaceRegistryEntry {
    WorkspaceRegistryEntry {
        id: row.get("id"),
        customer_id: row.get("customer_id"),
        display_name: row.get("display_name"),
        slug: row.get("slug"),
        db_path: row.get("db_path"),
        vault_root_path: row.get("vault_root_path"),
        is_default: row.get::<i64, _>("is_default") != 0,
        last_opened_at: row.get("last_opened_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[tauri::command]
pub async fn create_workspace_command(
    app: AppHandle,
    input: CreateWorkspaceInput,
) -> Result<WorkspaceRegistryEntry, String> {
    validate_workspace_id(&input.workspace_id)?;
    if input.workspace_id != input.foundation.workspace_id {
        return Err("Workspace lifecycle input does not match foundation workspace.".to_string());
    }

    let db_relative_path = workspace_db_relative_path(&input.workspace_id);
    let vault_relative_path = workspace_vault_relative_path(&input.workspace_id);
    let db_directory = workspace_db_directory(&app, &input.workspace_id)?;
    let db_path = workspace_db_path(&app, &input.workspace_id)?;
    let vault_path = workspace_vault_path(&app, &input.workspace_id)?;
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    let control_pool = runtime.control_pool();

    let already_registered: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_registry WHERE id = ?)")
            .bind(&input.workspace_id)
            .fetch_one(&control_pool)
            .await
            .map_err(|error| format!("Check workspace registry before create: {error}"))?;
    let vault_container = vault_path
        .parent()
        .ok_or_else(|| "Resolve workspace vault container: missing parent.".to_string())?;
    if already_registered || db_directory.exists() || vault_container.exists() {
        return Err("Workspace already exists or has staged local data.".to_string());
    }

    std::fs::create_dir_all(&db_directory)
        .map_err(|error| format!("Create workspace database directory: {error}"))?;
    if let Err(error) = std::fs::create_dir_all(&vault_path) {
        remove_workspace_files(&db_directory, &vault_path);
        return Err(format!("Create workspace vault directory: {error}"));
    }

    let workspace_pool = match DatabaseRuntime::create_workspace_pool(&db_path).await {
        Ok(pool) => pool,
        Err(error) => {
            remove_workspace_files(&db_directory, &vault_path);
            return Err(error);
        }
    };

    if let Err(error) =
        upsert_local_bootstrap_foundation_on_pool(&workspace_pool, input.foundation).await
    {
        workspace_pool.close().await;
        remove_workspace_files(&db_directory, &vault_path);
        return Err(error);
    }

    if let Err(error) = assert_database_integrity(&workspace_pool, "workspace").await {
        workspace_pool.close().await;
        remove_workspace_files(&db_directory, &vault_path);
        return Err(error);
    }

    let registry_result: Result<WorkspaceRegistryEntry, String> = async {
        let mut tx = control_pool
            .begin()
            .await
            .map_err(|error| format!("Begin workspace registry transaction: {error}"))?;

        if input.is_default {
            sqlx::query(
            "UPDATE workspace_registry
             SET is_default = 0, updated_at = CURRENT_TIMESTAMP
             WHERE customer_id = ? AND id != ?",
            )
            .bind(&input.customer_id)
            .bind(&input.workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Clear default workspace flag: {error}"))?;
        }

        sqlx::query(
        "INSERT INTO workspace_registry (
            id, customer_id, display_name, slug, db_path, vault_root_path, is_default, last_opened_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
        .bind(&input.workspace_id)
        .bind(&input.customer_id)
        .bind(&input.display_name)
        .bind(&input.slug)
        .bind(&db_relative_path)
        .bind(&vault_relative_path)
        .bind(if input.is_default { 1 } else { 0 })
        .bind(&input.last_opened_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Register workspace: {error}"))?;

        sqlx::query(
        "INSERT INTO onboarding_state (id, active_workspace_id)
         VALUES ('primary-onboarding', ?)
         ON CONFLICT(id) DO UPDATE SET
            active_workspace_id = excluded.active_workspace_id,
            updated_at = CURRENT_TIMESTAMP",
    )
        .bind(&input.workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Set active workspace in control database: {error}"))?;

        let row = sqlx::query("SELECT * FROM workspace_registry WHERE id = ? LIMIT 1")
            .bind(&input.workspace_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("Read registered workspace: {error}"))?;
        let entry = map_registry_row(row);
        tx.commit()
            .await
            .map_err(|error| format!("Commit workspace registry transaction: {error}"))?;
        Ok(entry)
    }
    .await;

    let entry = match registry_result {
        Ok(entry) => entry,
        Err(error) => {
            workspace_pool.close().await;
            remove_workspace_files(&db_directory, &vault_path);
            return Err(error);
        }
    };

    if let Err(error) =
        sweep_ai_evidence_cache_for_workspace(&app, &entry.id, &workspace_pool).await
    {
        log::warn!(
            "[ai-evidence-cache] Workspace {} startup sweep failed: {}",
            entry.id,
            error
        );
    }
    runtime
        .activate_workspace_pool(input.workspace_id, workspace_pool)
        .await;
    log::info!("[database] Created and activated workspace {}", entry.id);
    Ok(entry)
}

#[tauri::command]
pub async fn activate_workspace_command(
    app: AppHandle,
    input: WorkspaceIdInput,
) -> Result<WorkspaceRegistryEntry, String> {
    validate_workspace_id(&input.workspace_id)?;
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    let control_pool = runtime.control_pool();
    let row = sqlx::query("SELECT * FROM workspace_registry WHERE id = ? LIMIT 1")
        .bind(&input.workspace_id)
        .fetch_optional(&control_pool)
        .await
        .map_err(|error| format!("Load workspace registry entry: {error}"))?
        .ok_or_else(|| "Workspace not found.".to_string())?;
    let mut entry = map_registry_row(row);
    if runtime.active_workspace_id().await.as_deref() == Some(input.workspace_id.as_str()) {
        log::debug!("[database] Workspace {} is already active", entry.id);
        return Ok(entry);
    }
    let db_path = resolve_workspace_db_path(&app, &entry.db_path)?;
    let workspace_pool = DatabaseRuntime::open_workspace_pool(&db_path).await?;
    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&control_pool)
        .await
        .map_err(|error| format!("Resolve workspace activation timestamp: {error}"))?;
    let activation_result: Result<(), String> = async {
        let mut tx = control_pool
            .begin()
            .await
            .map_err(|error| format!("Begin workspace activation transaction: {error}"))?;
        sqlx::query(
        "UPDATE workspace_registry SET last_opened_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
        .bind(&now)
        .bind(&input.workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Update workspace last opened timestamp: {error}"))?;
        sqlx::query(
        "INSERT INTO onboarding_state (id, active_workspace_id)
         VALUES ('primary-onboarding', ?)
         ON CONFLICT(id) DO UPDATE SET
            active_workspace_id = excluded.active_workspace_id,
            updated_at = CURRENT_TIMESTAMP",
    )
        .bind(&input.workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Set active workspace in control database: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit workspace activation transaction: {error}"))?;
        Ok(())
    }
    .await;
    if let Err(error) = activation_result {
        workspace_pool.close().await;
        return Err(error);
    }

    if let Err(error) =
        sweep_ai_evidence_cache_for_workspace(&app, &entry.id, &workspace_pool).await
    {
        log::warn!(
            "[ai-evidence-cache] Workspace {} startup sweep failed: {}",
            entry.id,
            error
        );
    }
    runtime
        .activate_workspace_pool(input.workspace_id, workspace_pool)
        .await;
    entry.last_opened_at = Some(now);
    log::info!("[database] Active workspace switched to {}", entry.id);
    Ok(entry)
}

#[tauri::command]
pub async fn delete_workspace_command(
    app: AppHandle,
    input: WorkspaceIdInput,
) -> Result<Option<WorkspaceRegistryEntry>, String> {
    validate_workspace_id(&input.workspace_id)?;
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    let control_pool = runtime.control_pool();
    let entries =
        sqlx::query("SELECT * FROM workspace_registry ORDER BY is_default DESC, created_at ASC")
            .fetch_all(&control_pool)
            .await
            .map_err(|error| format!("Load workspace registry before delete: {error}"))?;
    if entries.len() <= 1 {
        return Err("At least one workspace is required.".to_string());
    }
    let entries = entries
        .into_iter()
        .map(map_registry_row)
        .collect::<Vec<_>>();
    let target = entries
        .iter()
        .find(|entry| entry.id == input.workspace_id)
        .cloned()
        .ok_or_else(|| "Workspace not found.".to_string())?;
    let active_workspace_id = runtime
        .active_workspace_id()
        .await
        .ok_or_else(|| "No active workspace database.".to_string())?;
    let target_is_active = active_workspace_id == input.workspace_id;
    let target_db_path = resolve_workspace_db_path(&app, &target.db_path)?;
    let integration_ids = if target_is_active {
        let pool = runtime.workspace_pool().await?;
        let ids = sqlx::query_scalar::<_, String>("SELECT id FROM workspace_integrations")
            .fetch_all(&pool)
            .await
            .map_err(|error| format!("Read workspace credentials before delete: {error}"))?;
        drop(pool);
        ids
    } else {
        let pool = DatabaseRuntime::open_workspace_pool(&target_db_path).await?;
        let ids = sqlx::query_scalar::<_, String>("SELECT id FROM workspace_integrations")
            .fetch_all(&pool)
            .await
            .map_err(|error| format!("Read workspace credentials before delete: {error}"))?;
        pool.close().await;
        ids
    };
    let next = if target_is_active {
        entries
            .iter()
            .find(|entry| entry.id != input.workspace_id)
            .cloned()
    } else {
        entries
            .iter()
            .find(|entry| entry.id == active_workspace_id)
            .cloned()
            .or_else(|| {
                entries
                    .iter()
                    .find(|entry| entry.id != input.workspace_id)
                    .cloned()
            })
    };

    let replacement_pool = if target_is_active {
        let next_entry = next
            .as_ref()
            .ok_or_else(|| "No replacement workspace is available.".to_string())?;
        let next_db_path = resolve_workspace_db_path(&app, &next_entry.db_path)?;
        Some(DatabaseRuntime::open_workspace_pool(&next_db_path).await?)
    } else {
        None
    };

    if let (Some(next_entry), Some(next_pool)) = (next.as_ref(), replacement_pool) {
        runtime
            .activate_workspace_pool(next_entry.id.clone(), next_pool)
            .await;
    }

    let db_directory = workspace_db_directory(&app, &target.id)?;
    let vault_parent = workspace_vault_path(&app, &target.id)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Resolve workspace vault container: missing parent.".to_string())?;
    let staging_token = uuid::Uuid::new_v4().to_string();
    let staged_db = match stage_directory_for_delete(&db_directory, &staging_token) {
        Ok(staged) => staged,
        Err(error) => {
            if target_is_active {
                let target_pool =
                    DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?)
                        .await?;
                runtime
                    .activate_workspace_pool(target.id.clone(), target_pool)
                    .await;
            }
            return Err(error);
        }
    };
    let staged_vault = match stage_directory_for_delete(&vault_parent, &staging_token) {
        Ok(staged) => staged,
        Err(error) => {
            restore_staged_directory(&db_directory, staged_db.as_ref())?;
            if target_is_active {
                let target_pool =
                    DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?)
                        .await?;
                runtime
                    .activate_workspace_pool(target.id.clone(), target_pool)
                    .await;
            }
            return Err(error);
        }
    };

    let delete_result: Result<(), String> = async {
        let mut tx = control_pool
            .begin()
            .await
            .map_err(|error| format!("Begin workspace delete transaction: {error}"))?;
        sqlx::query("DELETE FROM workspace_registry WHERE id = ?")
            .bind(&input.workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Delete workspace registry entry: {error}"))?;
        sqlx::query(
        "UPDATE onboarding_state SET active_workspace_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary-onboarding'",
    )
        .bind(next.as_ref().map(|entry| entry.id.as_str()))
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Update active workspace after delete: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit workspace delete transaction: {error}"))?;
        Ok(())
    }
    .await;
    if let Err(error) = delete_result {
        restore_staged_directory(&db_directory, staged_db.as_ref())?;
        restore_staged_directory(&vault_parent, staged_vault.as_ref())?;
        if target_is_active {
            let target_pool =
                DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?).await?;
            runtime
                .activate_workspace_pool(target.id.clone(), target_pool)
                .await;
        }
        return Err(error);
    }

    for staged in [staged_db.as_ref(), staged_vault.as_ref()]
        .into_iter()
        .flatten()
    {
        if let Err(error) = std::fs::remove_dir_all(staged) {
            log::warn!(
                "[database] Workspace was deleted but staged files remain at {}: {}",
                staged.display(),
                error
            );
        }
    }
    if let Err(error) = delete_workspace_token_bundles(&app, &integration_ids) {
        log::warn!("[credentials] Workspace data changed, but mailbox credentials could not be removed: {error}");
    }
    if let Err(error) = remove_ai_evidence_cache_for_workspace(&app, &target.id).await {
        log::warn!(
            "[ai-evidence-cache] Deleted workspace {} left recreatable cache artifacts: {}",
            target.id,
            error
        );
    }

    log::info!("[database] Deleted workspace {}", target.id);
    Ok(next)
}

#[tauri::command]
pub async fn reset_active_workspace_command(app: AppHandle) -> Result<(), String> {
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    let control_pool = runtime.control_pool();
    let active_workspace_id = runtime
        .active_workspace_id()
        .await
        .ok_or_else(|| "No active workspace database.".to_string())?;
    let row = sqlx::query("SELECT * FROM workspace_registry WHERE id = ? LIMIT 1")
        .bind(&active_workspace_id)
        .fetch_optional(&control_pool)
        .await
        .map_err(|error| format!("Load active workspace before reset: {error}"))?
        .ok_or_else(|| "Active workspace is missing from the control registry.".to_string())?;
    let target = map_registry_row(row);
    let pool = runtime.workspace_pool().await?;
    let integration_ids = sqlx::query_scalar::<_, String>("SELECT id FROM workspace_integrations")
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("Read workspace credentials before reset: {error}"))?;
    drop(pool);

    runtime
        .clear_active_workspace_pool(Some(&active_workspace_id))
        .await;

    let db_directory = workspace_db_directory(&app, &target.id)?;
    let vault_parent = workspace_vault_path(&app, &target.id)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Resolve workspace vault container: missing parent.".to_string())?;
    let staging_token = uuid::Uuid::new_v4().to_string();
    let staged_db = match stage_directory_for_delete(&db_directory, &staging_token) {
        Ok(staged) => staged,
        Err(error) => {
            let target_pool =
                DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?).await?;
            runtime
                .activate_workspace_pool(target.id.clone(), target_pool)
                .await;
            return Err(error);
        }
    };
    let staged_vault = match stage_directory_for_delete(&vault_parent, &staging_token) {
        Ok(staged) => staged,
        Err(error) => {
            restore_staged_directory(&db_directory, staged_db.as_ref())?;
            let target_pool =
                DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?).await?;
            runtime
                .activate_workspace_pool(target.id.clone(), target_pool)
                .await;
            return Err(error);
        }
    };

    let reset_result: Result<(), String> = async {
        let mut tx = control_pool
            .begin()
            .await
            .map_err(|error| format!("Begin active workspace reset transaction: {error}"))?;
        sqlx::query("DELETE FROM workspace_registry WHERE id = ?")
            .bind(&target.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Delete reset workspace registry entry: {error}"))?;
        sqlx::query(
            "UPDATE onboarding_state
             SET active_workspace_id = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = 'primary-onboarding'",
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Clear active workspace after reset: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit active workspace reset transaction: {error}"))?;
        Ok(())
    }
    .await;
    if let Err(error) = reset_result {
        restore_staged_directory(&db_directory, staged_db.as_ref())?;
        restore_staged_directory(&vault_parent, staged_vault.as_ref())?;
        let target_pool =
            DatabaseRuntime::open_workspace_pool(&workspace_db_path(&app, &target.id)?).await?;
        runtime
            .activate_workspace_pool(target.id.clone(), target_pool)
            .await;
        return Err(error);
    }

    for staged in [staged_db.as_ref(), staged_vault.as_ref()]
        .into_iter()
        .flatten()
    {
        if let Err(error) = std::fs::remove_dir_all(staged) {
            log::warn!(
                "[database] Workspace was reset but staged files remain at {}: {}",
                staged.display(),
                error
            );
        }
    }
    if let Err(error) = delete_workspace_token_bundles(&app, &integration_ids) {
        log::warn!("[credentials] Workspace data changed, but mailbox credentials could not be removed: {error}");
    }
    if let Err(error) = remove_ai_evidence_cache_for_workspace(&app, &target.id).await {
        log::warn!(
            "[ai-evidence-cache] Reset workspace {} left recreatable cache artifacts: {}",
            target.id,
            error
        );
    }

    log::info!("[database] Reset active workspace {}", target.id);
    Ok(())
}

pub(crate) fn normalize_workspace_db_relative_path(path: &str) -> Result<PathBuf, String> {
    if path.contains('\\') {
        return Err("Backslashes are not allowed in workspace database paths.".to_string());
    }
    let path = Path::new(path);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(
                    "Parent traversal is not allowed for workspace database paths.".to_string(),
                )
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute workspace database paths are not allowed.".to_string())
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Workspace database path is empty.".to_string());
    }
    if normalized.extension().and_then(|value| value.to_str()) != Some("db") {
        return Err("Workspace database path must end with .db".to_string());
    }
    Ok(normalized)
}

pub(crate) fn resolve_workspace_db_path(
    app: &AppHandle,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_workspace_db_relative_path(relative_path)?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Resolve application data directory: {error}"))?;
    Ok(root.join(normalized))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_workspace_db_relative_path, restore_staged_directory, stage_directory_for_delete,
    };
    use tempfile::tempdir;

    #[test]
    fn workspace_paths_are_relative_database_files() {
        assert!(normalize_workspace_db_relative_path("workspaces/acme/workspace.db").is_ok());
        assert!(normalize_workspace_db_relative_path("../workspace.db").is_err());
        assert!(normalize_workspace_db_relative_path("/tmp/workspace.db").is_err());
        assert!(normalize_workspace_db_relative_path("workspace").is_err());
        assert!(normalize_workspace_db_relative_path("workspaces\\acme\\workspace.db").is_err());
    }

    #[test]
    fn staged_workspace_directory_can_be_restored_after_failed_delete() {
        let root = tempdir().unwrap();
        let live = root.path().join("workspace-a");
        std::fs::create_dir_all(&live).unwrap();
        std::fs::write(live.join("workspace.db"), b"test").unwrap();

        let staged = stage_directory_for_delete(&live, "test-token")
            .unwrap()
            .unwrap();
        assert!(!live.exists());
        assert!(staged.exists());

        restore_staged_directory(&live, Some(&staged)).unwrap();
        assert!(live.join("workspace.db").exists());
        assert!(!staged.exists());
    }
}
