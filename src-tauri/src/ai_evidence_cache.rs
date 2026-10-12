use crate::db::runtime::DatabaseRuntime;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub(crate) const AI_EVIDENCE_CACHE_DIR: &str = "ai-evidence";
pub(crate) const AI_EVIDENCE_PREPARATION_VERSION: &str = "prepared-v1";
const AI_EVIDENCE_CACHE_HARD_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

static AI_EVIDENCE_CACHE_PINS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
static AI_EVIDENCE_CACHE_IO_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn ai_evidence_cache_pins() -> &'static Mutex<HashSet<PathBuf>> {
    AI_EVIDENCE_CACHE_PINS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ai_evidence_cache_io_lock() -> &'static tokio::sync::Mutex<()> {
    AI_EVIDENCE_CACHE_IO_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[derive(Debug, PartialEq, Eq)]
struct PreparedArtifactIdentity {
    workspace_id: String,
    file_id: String,
    source_content_hash: String,
    preparation_version: String,
    evidence_unit_key: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct EvidenceCacheSweepResult {
    pub removed_rows: u64,
    pub removed_files: u64,
}

fn is_safe_cache_component(component: &OsStr) -> bool {
    component.to_str().is_some_and(|value| {
        !value.is_empty()
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    })
}

pub(crate) fn validate_ai_evidence_cache_relative_path(
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.contains('\\') {
        return Err("AI evidence cache paths must use forward slashes.".to_string());
    }
    let relative = Path::new(relative_path);
    let components = relative.components().collect::<Vec<_>>();
    if relative.is_absolute()
        || components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(value) if is_safe_cache_component(value)))
        || components.first().and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        }) != Some(AI_EVIDENCE_CACHE_DIR)
    {
        return Err("Invalid AI evidence cache path.".to_string());
    }
    Ok(relative.to_path_buf())
}

fn parse_prepared_artifact_path(relative_path: &str) -> Result<PreparedArtifactIdentity, String> {
    let relative = validate_ai_evidence_cache_relative_path(relative_path)?;
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_string_lossy().to_string(),
            _ => unreachable!("validated cache paths contain only normal components"),
        })
        .collect::<Vec<_>>();
    if components.len() < 6 {
        return Err("Prepared AI evidence cache paths must include workspace, file, source, version, and unit key.".to_string());
    }
    let preparation_version = components[4].clone();
    if preparation_version != AI_EVIDENCE_PREPARATION_VERSION {
        return Err(format!(
            "Obsolete AI evidence preparation version: {preparation_version}."
        ));
    }
    Ok(PreparedArtifactIdentity {
        workspace_id: components[1].clone(),
        file_id: components[2].clone(),
        source_content_hash: components[3].clone(),
        preparation_version,
        evidence_unit_key: components[5..].join("/"),
    })
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| format!("Resolve application cache directory: {error}"))
}

fn resolve_ai_evidence_cache_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(validate_ai_evidence_cache_relative_path(relative_path)?))
}

fn collect_ai_evidence_cache_files(directory: &Path, files: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_ai_evidence_cache_files(&path, files);
        } else if metadata.is_file() {
            files.push((
                path,
                metadata.len(),
                metadata
                    .accessed()
                    .or_else(|_| metadata.modified())
                    .unwrap_or(UNIX_EPOCH),
            ));
        }
    }
}

pub(crate) fn plan_ai_evidence_cache_evictions(
    files: &[(PathBuf, u64, SystemTime)],
    incoming_path: &Path,
    incoming_bytes: u64,
    budget: u64,
    pins: &HashSet<PathBuf>,
) -> Option<Vec<PathBuf>> {
    if incoming_bytes > budget {
        return None;
    }
    let existing_target_bytes = files
        .iter()
        .find(|(path, _, _)| path == incoming_path)
        .map(|(_, bytes, _)| *bytes)
        .unwrap_or(0);
    let mut total = files.iter().map(|(_, bytes, _)| *bytes).sum::<u64>() - existing_target_bytes
        + incoming_bytes;
    let mut candidates = files.to_vec();
    candidates.sort_by_key(|(_, _, modified)| *modified);
    let mut evictions = Vec::new();
    for (path, bytes, _) in candidates {
        if total <= budget {
            break;
        }
        if path == incoming_path || pins.contains(&path) {
            continue;
        }
        total = total.saturating_sub(bytes);
        evictions.push(path);
    }
    (total <= budget).then_some(evictions)
}

fn prune_cache_before_write(
    root: &Path,
    incoming_path: &Path,
    incoming_bytes: u64,
    budget: u64,
    pins: &HashSet<PathBuf>,
) -> Result<bool, String> {
    let evidence_root = root.join(AI_EVIDENCE_CACHE_DIR);
    fs::create_dir_all(&evidence_root)
        .map_err(|error| format!("Create AI evidence cache directory: {error}"))?;
    let mut files = Vec::new();
    collect_ai_evidence_cache_files(&evidence_root, &mut files);
    let Some(evictions) =
        plan_ai_evidence_cache_evictions(&files, incoming_path, incoming_bytes, budget, pins)
    else {
        return Ok(false);
    };
    for path in evictions {
        fs::remove_file(path).map_err(|error| format!("Prune AI evidence cache entry: {error}"))?;
    }
    Ok(true)
}

fn temporary_sibling(path: &Path, marker: &str) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "AI evidence cache path has no valid filename.".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(path.with_file_name(format!(".{file_name}.{marker}-{nonce}")))
}

fn replace_with_temporary(temporary: &Path, destination: &Path) -> Result<(), String> {
    match fs::rename(temporary, destination) {
        Ok(()) => Ok(()),
        Err(_) if destination.is_file() => {
            fs::remove_file(destination)
                .map_err(|error| format!("Replace AI evidence cache entry: {error}"))?;
            fs::rename(temporary, destination)
                .map_err(|error| format!("Commit AI evidence cache entry: {error}"))
        }
        Err(error) => Err(format!("Commit AI evidence cache entry: {error}")),
    }
}

fn remove_file_if_present(path: &Path) -> Result<bool, String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Remove AI evidence cache entry: {error}")),
    }
}

async fn assert_artifact_owner(
    pool: &SqlitePool,
    identity: &PreparedArtifactIdentity,
) -> Result<(), String> {
    let workspace_id: String =
        sqlx::query_scalar("SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1")
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Read AI evidence cache workspace owner: {error}"))?;
    if workspace_id != identity.workspace_id {
        return Err(
            "Prepared AI evidence cache path does not belong to the active workspace.".to_string(),
        );
    }
    let file_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM files WHERE id = ?)")
        .bind(&identity.file_id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Validate AI evidence cache file owner: {error}"))?;
    if !file_exists {
        return Err("Prepared AI evidence source file does not exist.".to_string());
    }
    Ok(())
}

async fn register_prepared_artifact(
    pool: &SqlitePool,
    root: &Path,
    relative_path: &str,
    value: &[u8],
    budget: u64,
    pins: &HashSet<PathBuf>,
) -> Result<bool, String> {
    let relative = validate_ai_evidence_cache_relative_path(relative_path)?;
    let identity = parse_prepared_artifact_path(relative_path)?;
    assert_artifact_owner(pool, &identity).await?;
    let path = root.join(&relative);
    if !prune_cache_before_write(root, &path, value.len() as u64, budget, pins)? {
        return Ok(false);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "AI evidence cache path has no parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Create AI evidence cache parent directory: {error}"))?;
    let temporary = temporary_sibling(&path, "tmp")?;
    fs::write(&temporary, value)
        .map_err(|error| format!("Write AI evidence cache temporary entry: {error}"))?;
    let backup = if path.is_file() {
        let backup = temporary_sibling(&path, "backup")?;
        fs::copy(&path, &backup)
            .map_err(|error| format!("Back up AI evidence cache entry: {error}"))?;
        Some(backup)
    } else {
        None
    };
    if let Err(error) = replace_with_temporary(&temporary, &path) {
        let _ = remove_file_if_present(&temporary);
        if let Some(backup) = backup.as_ref() {
            let _ = replace_with_temporary(backup, &path);
        }
        return Err(error);
    }

    let evidence_unit_hash = format!("{:x}", Sha256::digest(value));
    let old_artifact_paths = sqlx::query_scalar::<_, Option<String>>(
        "SELECT artifact_path FROM ai_evidence_cache
         WHERE file_id = ? AND cache_kind = 'prepared_metadata' AND evidence_unit_key = ?",
    )
    .bind(&identity.file_id)
    .bind(&identity.evidence_unit_key)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read replaced AI evidence cache artifacts: {error}"));

    let registration = async {
        let old_artifact_paths = old_artifact_paths?;
        let mut tx = pool
            .begin()
            .await
            .map_err(|error| format!("Begin AI evidence cache registration: {error}"))?;
        sqlx::query(
            "DELETE FROM ai_evidence_cache
             WHERE file_id = ? AND cache_kind = 'prepared_metadata' AND evidence_unit_key = ?",
        )
        .bind(&identity.file_id)
        .bind(&identity.evidence_unit_key)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Replace AI evidence cache registration: {error}"))?;
        sqlx::query(
            "INSERT INTO ai_evidence_cache (
                id, file_id, cache_kind, source_content_hash, evidence_unit_key,
                evidence_unit_hash, preparation_version, extraction_version, synthesis_version,
                model_runtime_id, payload_json, artifact_path, byte_size, created_at, last_accessed_at
             ) VALUES (?, ?, 'prepared_metadata', ?, ?, ?, ?, '', '', '', '{}', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&identity.file_id)
        .bind(&identity.source_content_hash)
        .bind(&identity.evidence_unit_key)
        .bind(&evidence_unit_hash)
        .bind(&identity.preparation_version)
        .bind(relative_path)
        .bind(value.len() as i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Register AI evidence cache artifact: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit AI evidence cache registration: {error}"))?;
        Ok::<_, String>(old_artifact_paths)
    }
    .await;

    let old_artifact_paths = match registration {
        Ok(paths) => paths,
        Err(error) => {
            let _ = remove_file_if_present(&path);
            if let Some(backup) = backup.as_ref() {
                let _ = replace_with_temporary(backup, &path);
            }
            return Err(error);
        }
    };
    if let Some(backup) = backup.as_ref() {
        let _ = remove_file_if_present(backup);
    }
    for old_relative in old_artifact_paths.into_iter().flatten() {
        if old_relative == relative_path {
            continue;
        }
        if let Ok(old_relative) = validate_ai_evidence_cache_relative_path(&old_relative) {
            let _ = remove_file_if_present(&root.join(old_relative));
        }
    }
    Ok(true)
}

async fn read_registered_artifact(
    app: &AppHandle,
    relative_path: &str,
) -> Result<Option<Vec<u8>>, String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    let identity = parse_prepared_artifact_path(relative_path)?;
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    if runtime.active_workspace_id().await.as_deref() != Some(identity.workspace_id.as_str()) {
        return Err(
            "Prepared AI evidence cache path does not belong to the active workspace.".to_string(),
        );
    }
    let pool = runtime.workspace_pool().await?;
    let row = sqlx::query(
        "SELECT id, byte_size FROM ai_evidence_cache
         WHERE cache_kind = 'prepared_metadata' AND preparation_version = ? AND artifact_path = ?
         LIMIT 1",
    )
    .bind(AI_EVIDENCE_PREPARATION_VERSION)
    .bind(relative_path)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read AI evidence cache registration: {error}"))?;
    let path = resolve_ai_evidence_cache_path(app, relative_path)?;
    let Some(row) = row else {
        let _ = remove_file_if_present(&path);
        return Ok(None);
    };
    let id: String = row.get("id");
    let expected_bytes: i64 = row.get("byte_size");
    let metadata = match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() && metadata.len() == expected_bytes as u64 => metadata,
        Ok(_) | Err(_) => {
            sqlx::query("DELETE FROM ai_evidence_cache WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
                .map_err(|error| {
                    format!("Remove invalid AI evidence cache registration: {error}")
                })?;
            let _ = remove_file_if_present(&path);
            return Ok(None);
        }
    };
    let _ = metadata;
    let bytes =
        fs::read(&path).map_err(|error| format!("Read AI evidence cache entry: {error}"))?;
    sqlx::query("UPDATE ai_evidence_cache SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|error| format!("Touch AI evidence cache registration: {error}"))?;
    if let Ok(file) = fs::OpenOptions::new().write(true).open(&path) {
        let _ = file.set_times(fs::FileTimes::new().set_modified(SystemTime::now()));
    }
    Ok(Some(bytes))
}

fn remove_empty_directories(directory: &Path, keep_root: bool) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            remove_empty_directories(&entry.path(), false);
        }
    }
    if !keep_root {
        let _ = fs::remove_dir(directory);
    }
}

async fn sweep_workspace_cache(
    root: &Path,
    workspace_id: &str,
    pool: &SqlitePool,
) -> Result<EvidenceCacheSweepResult, String> {
    let workspace_relative = validate_ai_evidence_cache_relative_path(&format!(
        "{AI_EVIDENCE_CACHE_DIR}/{workspace_id}"
    ))?;
    let workspace_root = root.join(workspace_relative);
    let rows = sqlx::query(
        "SELECT id, file_id, source_content_hash, evidence_unit_key, preparation_version,
                artifact_path, byte_size
         FROM ai_evidence_cache
         WHERE cache_kind = 'prepared_metadata'",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Inspect AI evidence cache registrations: {error}"))?;
    let mut valid_paths = HashSet::new();
    let mut stale_ids = Vec::new();
    let mut result = EvidenceCacheSweepResult::default();
    for row in rows {
        let id: String = row.get("id");
        let file_id: String = row.get("file_id");
        let source_content_hash: String = row.get("source_content_hash");
        let evidence_unit_key: String = row.get("evidence_unit_key");
        let preparation_version: String = row.get("preparation_version");
        let artifact_path: Option<String> = row.get("artifact_path");
        let byte_size: i64 = row.get("byte_size");
        let safe_path = artifact_path
            .as_deref()
            .and_then(|path| validate_ai_evidence_cache_relative_path(path).ok())
            .filter(|path| path.starts_with(Path::new(AI_EVIDENCE_CACHE_DIR).join(workspace_id)))
            .map(|path| root.join(path));
        let identity_matches = artifact_path
            .as_deref()
            .and_then(|path| parse_prepared_artifact_path(path).ok())
            .is_some_and(|identity| {
                identity.workspace_id == workspace_id
                    && identity.file_id == file_id
                    && identity.source_content_hash == source_content_hash
                    && identity.evidence_unit_key == evidence_unit_key
                    && identity.preparation_version == preparation_version
            });
        let is_valid = preparation_version == AI_EVIDENCE_PREPARATION_VERSION
            && identity_matches
            && safe_path.as_ref().is_some_and(|path| {
                fs::metadata(path)
                    .is_ok_and(|metadata| metadata.is_file() && metadata.len() == byte_size as u64)
            });
        if is_valid {
            valid_paths.insert(safe_path.expect("validated path"));
        } else {
            stale_ids.push(id);
            if let Some(path) = safe_path {
                if remove_file_if_present(&path)? {
                    result.removed_files += 1;
                }
            }
        }
    }
    if !stale_ids.is_empty() {
        let mut tx = pool
            .begin()
            .await
            .map_err(|error| format!("Begin AI evidence cache sweep: {error}"))?;
        for id in &stale_ids {
            sqlx::query("DELETE FROM ai_evidence_cache WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("Delete obsolete AI evidence cache row: {error}"))?;
        }
        tx.commit()
            .await
            .map_err(|error| format!("Commit AI evidence cache sweep: {error}"))?;
        result.removed_rows = stale_ids.len() as u64;
    }
    let mut disk_files = Vec::new();
    collect_ai_evidence_cache_files(&workspace_root, &mut disk_files);
    for (path, _, _) in disk_files {
        if !valid_paths.contains(&path) && remove_file_if_present(&path)? {
            result.removed_files += 1;
        }
    }
    remove_empty_directories(&workspace_root, true);
    Ok(result)
}

pub(crate) async fn sweep_ai_evidence_cache_for_workspace(
    app: &AppHandle,
    workspace_id: &str,
    pool: &SqlitePool,
) -> Result<EvidenceCacheSweepResult, String> {
    sweep_workspace_cache(&cache_root(app)?, workspace_id, pool).await
}

fn sweep_unregistered_workspace_directories_at_root(
    root: &Path,
    registered_workspace_ids: &HashSet<String>,
) -> Result<u64, String> {
    let evidence_root = root.join(AI_EVIDENCE_CACHE_DIR);
    let Ok(entries) = fs::read_dir(&evidence_root) else {
        return Ok(0);
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let registered = entry
            .file_name()
            .to_str()
            .is_some_and(|name| registered_workspace_ids.contains(name));
        if path.is_dir() && registered {
            let mut files = Vec::new();
            collect_ai_evidence_cache_files(&path, &mut files);
            for (artifact_path, _, _) in files {
                let current_contract = artifact_path
                    .strip_prefix(root)
                    .ok()
                    .and_then(Path::to_str)
                    .is_some_and(|relative| parse_prepared_artifact_path(relative).is_ok());
                if !current_contract && remove_file_if_present(&artifact_path)? {
                    removed += 1;
                }
            }
            remove_empty_directories(&path, true);
            continue;
        }
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("Remove orphan AI evidence workspace cache: {error}"))?;
        } else if path.is_file() {
            fs::remove_file(&path)
                .map_err(|error| format!("Remove orphan AI evidence cache entry: {error}"))?;
        } else {
            continue;
        }
        removed += 1;
    }
    Ok(removed)
}

pub(crate) async fn sweep_unregistered_ai_evidence_workspaces(
    app: &AppHandle,
    runtime: &DatabaseRuntime,
) -> Result<u64, String> {
    let registered_workspace_ids =
        sqlx::query_scalar::<_, String>("SELECT id FROM workspace_registry")
            .fetch_all(&runtime.control_pool())
            .await
            .map_err(|error| {
                format!("Read registered workspaces for AI evidence cache sweep: {error}")
            })?
            .into_iter()
            .collect::<HashSet<_>>();
    let _guard = ai_evidence_cache_io_lock().lock().await;
    sweep_unregistered_workspace_directories_at_root(&cache_root(app)?, &registered_workspace_ids)
}

fn remove_cache_prefix_at_root(root: &Path, relative_prefix: &str) -> Result<(), String> {
    let relative = validate_ai_evidence_cache_relative_path(relative_prefix)?;
    let path = root.join(relative);
    if path.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Remove AI evidence cache directory: {error}"))?;
    } else if path.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("Remove AI evidence cache entry: {error}"))?;
    }
    Ok(())
}

pub(crate) async fn remove_ai_evidence_cache_for_file(
    app: &AppHandle,
    workspace_id: &str,
    file_id: &str,
) -> Result<(), String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    remove_cache_prefix_at_root(
        &cache_root(app)?,
        &format!("{AI_EVIDENCE_CACHE_DIR}/{workspace_id}/{file_id}"),
    )
}

pub(crate) async fn remove_ai_evidence_cache_for_workspace(
    app: &AppHandle,
    workspace_id: &str,
) -> Result<(), String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    remove_cache_prefix_at_root(
        &cache_root(app)?,
        &format!("{AI_EVIDENCE_CACHE_DIR}/{workspace_id}"),
    )
}

#[tauri::command]
pub(crate) fn get_ai_evidence_cache_budget(app: AppHandle) -> Result<u64, String> {
    let cache_dir = cache_root(&app)?;
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Create application cache directory: {error}"))?;
    let available = fs2::available_space(&cache_dir)
        .map_err(|error| format!("Inspect available cache disk space: {error}"))?;
    Ok(AI_EVIDENCE_CACHE_HARD_LIMIT_BYTES.min(available / 20))
}

fn active_cache_budget(root: &Path) -> Result<u64, String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Create application cache directory: {error}"))?;
    let available = fs2::available_space(root)
        .map_err(|error| format!("Inspect available cache disk space: {error}"))?;
    Ok(AI_EVIDENCE_CACHE_HARD_LIMIT_BYTES.min(available / 20))
}

#[tauri::command]
pub(crate) async fn read_ai_evidence_cache_text(
    app: AppHandle,
    relative_path: String,
) -> Result<Option<String>, String> {
    read_registered_artifact(&app, &relative_path)
        .await?
        .map(|bytes| {
            String::from_utf8(bytes)
                .map_err(|error| format!("Decode AI evidence cache text entry: {error}"))
        })
        .transpose()
}

#[tauri::command]
pub(crate) async fn read_ai_evidence_cache_bytes(
    app: AppHandle,
    relative_path: String,
) -> Result<Option<Vec<u8>>, String> {
    read_registered_artifact(&app, &relative_path).await
}

#[tauri::command]
pub(crate) async fn write_ai_evidence_cache_text(
    app: AppHandle,
    relative_path: String,
    value: String,
) -> Result<bool, String> {
    write_registered_artifact(&app, &relative_path, value.as_bytes()).await
}

#[tauri::command]
pub(crate) async fn write_ai_evidence_cache_bytes(
    app: AppHandle,
    relative_path: String,
    value: Vec<u8>,
) -> Result<bool, String> {
    write_registered_artifact(&app, &relative_path, &value).await
}

async fn write_registered_artifact(
    app: &AppHandle,
    relative_path: &str,
    value: &[u8],
) -> Result<bool, String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    let identity = parse_prepared_artifact_path(relative_path)?;
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    if runtime.active_workspace_id().await.as_deref() != Some(identity.workspace_id.as_str()) {
        return Err(
            "Prepared AI evidence cache path does not belong to the active workspace.".to_string(),
        );
    }
    let pool = runtime.workspace_pool().await?;
    let root = cache_root(app)?;
    let pins = ai_evidence_cache_pins()
        .lock()
        .map_err(|_| "AI evidence cache pin lock is poisoned.".to_string())?
        .clone();
    register_prepared_artifact(
        &pool,
        &root,
        relative_path,
        value,
        active_cache_budget(&root)?,
        &pins,
    )
    .await
}

#[tauri::command]
pub(crate) async fn set_ai_evidence_cache_pin(
    app: AppHandle,
    relative_path: String,
    pinned: bool,
) -> Result<(), String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    let path = resolve_ai_evidence_cache_path(&app, &relative_path)?;
    let mut pins = ai_evidence_cache_pins()
        .lock()
        .map_err(|_| "AI evidence cache pin lock is poisoned.".to_string())?;
    if pinned {
        pins.insert(path);
    } else {
        pins.remove(&path);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remove_ai_evidence_cache_prefix(
    app: AppHandle,
    relative_prefix: String,
) -> Result<(), String> {
    let _guard = ai_evidence_cache_io_lock().lock().await;
    let relative = validate_ai_evidence_cache_relative_path(&relative_prefix)?;
    let workspace_id = relative
        .components()
        .nth(1)
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        });
    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?;
    if runtime.active_workspace_id().await.as_deref() == workspace_id {
        let pool = runtime.workspace_pool().await?;
        sqlx::query(
            "DELETE FROM ai_evidence_cache
             WHERE artifact_path = ?
                OR substr(artifact_path, 1, length(?) + 1) = ? || '/'",
        )
        .bind(&relative_prefix)
        .bind(&relative_prefix)
        .bind(&relative_prefix)
        .execute(&pool)
        .await
        .map_err(|error| format!("Remove AI evidence cache registrations: {error}"))?;
    }
    let absolute_prefix = cache_root(&app)?.join(&relative);
    if let Ok(mut pins) = ai_evidence_cache_pins().lock() {
        pins.retain(|path| !path.starts_with(&absolute_prefix));
    }
    remove_cache_prefix_at_root(&cache_root(&app)?, &relative_prefix)
}

pub(crate) fn prune_ai_evidence_cache_on_startup(app: &AppHandle) -> Result<(), String> {
    let root = cache_root(app)?;
    let evidence_root = root.join(AI_EVIDENCE_CACHE_DIR);
    let sentinel = evidence_root.join(".startup-prune");
    let pins = ai_evidence_cache_pins()
        .lock()
        .map_err(|_| "AI evidence cache pin lock is poisoned.".to_string())?
        .clone();
    let _ = prune_cache_before_write(&root, &sentinel, 0, active_cache_budget(&root)?, &pins)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        register_prepared_artifact, remove_cache_prefix_at_root,
        sweep_unregistered_workspace_directories_at_root, sweep_workspace_cache,
        AI_EVIDENCE_PREPARATION_VERSION,
    };
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
    use std::{collections::HashSet, fs};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE workspace_identity (id TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE files (id TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE ai_evidence_cache (
                id TEXT PRIMARY KEY NOT NULL,
                file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                cache_kind TEXT NOT NULL,
                source_content_hash TEXT NOT NULL,
                evidence_unit_key TEXT NOT NULL,
                evidence_unit_hash TEXT NOT NULL,
                preparation_version TEXT NOT NULL,
                extraction_version TEXT NOT NULL DEFAULT '',
                synthesis_version TEXT NOT NULL DEFAULT '',
                model_runtime_id TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                artifact_path TEXT,
                byte_size INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO workspace_identity (id) VALUES ('workspace-1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO files (id) VALUES ('file-1')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    fn artifact_path(version: &str, name: &str) -> String {
        format!("ai-evidence/workspace-1/file-1/source-hash/{version}/{name}")
    }

    #[tokio::test]
    async fn prepared_artifact_write_registers_relative_path_and_byte_size() {
        let root = tempfile::tempdir().unwrap();
        let pool = test_pool().await;
        let relative = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "pdf.json");

        let retained = register_prepared_artifact(
            &pool,
            root.path(),
            &relative,
            br#"{"version":1}"#,
            1024,
            &HashSet::new(),
        )
        .await
        .unwrap();

        assert!(retained);
        assert_eq!(
            fs::read(root.path().join(&relative)).unwrap(),
            br#"{"version":1}"#
        );
        let row: (String, i64, String) = sqlx::query_as(
            "SELECT artifact_path, byte_size, preparation_version FROM ai_evidence_cache",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, relative);
        assert_eq!(row.1, 13);
        assert_eq!(row.2, AI_EVIDENCE_PREPARATION_VERSION);
    }

    #[tokio::test]
    async fn prepared_artifact_write_removes_new_file_when_registration_fails() {
        let root = tempfile::tempdir().unwrap();
        let pool = test_pool().await;
        sqlx::raw_sql(
            "CREATE TRIGGER reject_cache_insert BEFORE INSERT ON ai_evidence_cache
             BEGIN SELECT RAISE(FAIL, 'registration rejected'); END;",
        )
        .execute(&pool)
        .await
        .unwrap();
        let relative = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "pdf.json");

        let error = register_prepared_artifact(
            &pool,
            root.path(),
            &relative,
            b"prepared",
            1024,
            &HashSet::new(),
        )
        .await
        .unwrap_err();

        assert!(error.contains("Register AI evidence cache artifact"));
        assert!(!root.path().join(relative).exists());
    }

    #[tokio::test]
    async fn startup_sweep_removes_orphans_obsolete_versions_and_missing_rows() {
        let root = tempfile::tempdir().unwrap();
        let pool = test_pool().await;
        let valid = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "valid.json");
        let obsolete = artifact_path("prepared-v0", "obsolete.json");
        let missing = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "missing.json");
        let orphan = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "orphan.json");
        for (relative, value) in [
            (&valid, b"valid".as_slice()),
            (&obsolete, b"old".as_slice()),
            (&orphan, b"orphan".as_slice()),
        ] {
            let path = root.path().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, value).unwrap();
        }
        for (id, relative, version, bytes) in [
            ("valid", &valid, AI_EVIDENCE_PREPARATION_VERSION, 5_i64),
            ("obsolete", &obsolete, "prepared-v0", 3_i64),
            ("missing", &missing, AI_EVIDENCE_PREPARATION_VERSION, 7_i64),
        ] {
            sqlx::query(
                "INSERT INTO ai_evidence_cache (id, file_id, cache_kind, source_content_hash, evidence_unit_key, evidence_unit_hash, preparation_version, artifact_path, byte_size) VALUES (?, 'file-1', 'prepared_metadata', 'source-hash', ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(format!("{id}.json"))
            .bind(format!("{id}-hash"))
            .bind(version)
            .bind(relative)
            .bind(bytes)
            .execute(&pool)
            .await
            .unwrap();
        }

        let result = sweep_workspace_cache(root.path(), "workspace-1", &pool)
            .await
            .unwrap();

        assert_eq!(result.removed_rows, 2);
        assert_eq!(result.removed_files, 2);
        assert!(root.path().join(valid).exists());
        assert!(!root.path().join(obsolete).exists());
        assert!(!root.path().join(orphan).exists());
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM ai_evidence_cache ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(ids, vec!["valid"]);
    }

    #[tokio::test]
    async fn source_file_deletion_cascades_registration_and_sweep_removes_disk_artifact() {
        let root = tempfile::tempdir().unwrap();
        let pool = test_pool().await;
        let relative = artifact_path(AI_EVIDENCE_PREPARATION_VERSION, "pdf.json");
        register_prepared_artifact(
            &pool,
            root.path(),
            &relative,
            b"prepared",
            1024,
            &HashSet::new(),
        )
        .await
        .unwrap();

        sqlx::query("DELETE FROM files WHERE id = 'file-1'")
            .execute(&pool)
            .await
            .unwrap();
        let result = sweep_workspace_cache(root.path(), "workspace-1", &pool)
            .await
            .unwrap();

        assert_eq!(result.removed_files, 1);
        assert!(!root.path().join(relative).exists());
        let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ai_evidence_cache")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row_count, 0);
    }

    #[test]
    fn workspace_prefix_cleanup_removes_only_the_owned_workspace_cache() {
        let root = tempfile::tempdir().unwrap();
        let removed = root
            .path()
            .join("ai-evidence/workspace-1/file-1/hash/prepared-v1/a.json");
        let retained = root
            .path()
            .join("ai-evidence/workspace-2/file-2/hash/prepared-v1/b.json");
        fs::create_dir_all(removed.parent().unwrap()).unwrap();
        fs::create_dir_all(retained.parent().unwrap()).unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&retained, b"retained").unwrap();

        remove_cache_prefix_at_root(root.path(), "ai-evidence/workspace-1").unwrap();

        assert!(!removed.exists());
        assert!(retained.exists());
    }

    #[test]
    fn startup_registry_sweep_removes_only_unregistered_workspace_directories() {
        let root = tempfile::tempdir().unwrap();
        let registered = root
            .path()
            .join("ai-evidence/workspace-1/file-1/hash/prepared-v1/cache.json");
        let obsolete = root
            .path()
            .join("ai-evidence/workspace-1/file-1/hash/prepared-v0/cache.json");
        let orphan = root
            .path()
            .join("ai-evidence/workspace-orphan/file-1/hash/prepared-v1/cache.json");
        fs::create_dir_all(registered.parent().unwrap()).unwrap();
        fs::create_dir_all(obsolete.parent().unwrap()).unwrap();
        fs::create_dir_all(orphan.parent().unwrap()).unwrap();
        fs::write(&registered, b"registered").unwrap();
        fs::write(&obsolete, b"obsolete").unwrap();
        fs::write(&orphan, b"orphan").unwrap();

        let removed = sweep_unregistered_workspace_directories_at_root(
            root.path(),
            &HashSet::from(["workspace-1".to_string()]),
        )
        .unwrap();

        assert_eq!(removed, 2);
        assert!(registered.exists());
        assert!(!obsolete.exists());
        assert!(!orphan.exists());
    }
}
