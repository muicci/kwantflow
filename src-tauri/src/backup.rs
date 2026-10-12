use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock, RwLockReadGuard};
use tauri::{AppHandle, Manager};

use crate::db::runtime::WORKSPACE_SCHEMA_VERSION;
use crate::integrations::{validate_provider_settings, EmailProviderSettings};

const VAULT_ROOT: &str = "Kwantflow";
const BACKUP_MANIFEST_VERSION: u32 = 4;
const LEGACY_BACKUP_MANIFEST_VERSION: u32 = 3;
const RESTORE_JOURNAL_FILE: &str = "restore-journal.json";
const DISK_RESERVE_BYTES: u64 = 64 * 1024 * 1024;
static BACKUP_OPERATIONS: Mutex<()> = Mutex::new(());
static BACKUP_FILE_ACCESS: RwLock<()> = RwLock::new(());

pub(crate) fn backup_file_mutation_guard() -> Result<RwLockReadGuard<'static, ()>, String> {
    BACKUP_FILE_ACCESS
        .read()
        .map_err(|_| "Backup file access lock is unavailable.".to_string())
}
const BACKUP_STORE_DIR: &str = "backup-store";
const SNAPSHOTS_DIR: &str = "snapshots";
const PENDING_DIR: &str = "pending";
const PENDING_RESTORE_FILE: &str = "pending-restore.json";

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackupReason {
    Auto,
    Manual,
    /// Snapshots created by the removed auto-updater (0.12.x). Kept so old
    /// backup stores still list and restore them like any other snapshot.
    PreUpdate,
    PreRestore,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub id: String,
    pub reason: BackupReason,
    pub created_at: String,
    pub app_version: String,
    pub schema_version: u32,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_backup: Option<BackupSummary>,
    pub last_automatic_backup: Option<BackupSummary>,
    pub recent_snapshots: Vec<BackupSummary>,
    pub retained_recovery_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspection {
    pub summary: BackupSummary,
    pub workspace_display_name: Option<String>,
    pub workspace_count: usize,
    pub external_references: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreStageResult {
    pub summary: BackupSummary,
    pub safety_snapshot_created: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupDeleteResult {
    pub summary: BackupSummary,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    manifest_version: u32,
    workspace_display_name: Option<String>,
    summary: BackupSummary,
    entries: Vec<BackupManifestEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupManifestEntry {
    path: String,
    byte_size: u64,
    #[serde(default)]
    sha256: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestoreRequest {
    kind: PendingRestoreKind,
    snapshot_id: Option<String>,
    #[serde(default)]
    preserve_raw_originals: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum PendingRestoreKind {
    Snapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArchiveResult {
    pub summary: BackupSummary,
    pub path: String,
}

#[derive(Clone)]
struct BackupRoots {
    config: PathBuf,
    local: PathBuf,
    documents: PathBuf,
}

impl BackupRoots {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            config: app_config_root(app)?,
            local: app_local_data_root(app)?,
            documents: document_root(app)?.join(VAULT_ROOT),
        })
    }

    fn pending(&self) -> PathBuf {
        self.local.join(BACKUP_STORE_DIR).join(PENDING_DIR)
    }

    fn restore_targets(&self, stage: &Path, token: &str) -> Result<Vec<RestoreMove>, String> {
        let mut pairs = vec![
            (
                stage.join("documents/workspaces"),
                self.documents.join("workspaces"),
            ),
            (
                stage.join("app-local/workspaces"),
                self.local.join("workspaces"),
            ),
            (stage.join("app-local/account"), self.local.join("account")),
            (
                stage.join("app-config/store.json"),
                self.config.join("store.json"),
            ),
            (
                stage.join("app-config/kwantflow-control.db"),
                self.config.join("kwantflow-control.db"),
            ),
            (
                stage.join("app-config/kwantflow-control.db-wal"),
                self.config.join("kwantflow-control.db-wal"),
            ),
            (
                stage.join("app-config/kwantflow-control.db-shm"),
                self.config.join("kwantflow-control.db-shm"),
            ),
        ];
        // Older snapshots have no provider settings. Leave the installation's
        // registrations untouched instead of treating absence as a deletion.
        let provider_source = stage.join("app-local/email-provider-settings.json");
        if provider_source.exists() {
            pairs.push((
                provider_source,
                self.local.join("email-provider-settings.json"),
            ));
        }
        let mut targets: Vec<RestoreMove> = Vec::new();
        let stage_result = (|| -> Result<(), String> {
            for (source, live) in pairs {
                let parent = live.parent().ok_or("Restore destination has no parent.")?;
                ensure_dir(parent)?;
                reject_symlink_path(&live)?;
                let name = live
                    .file_name()
                    .ok_or("Restore destination has no name.")?
                    .to_string_lossy();
                let staged = parent.join(format!(".kwantflow-{token}-{name}-stage"));
                let rollback = parent.join(format!(".kwantflow-{token}-{name}-rollback"));
                if staged.exists() || rollback.exists() {
                    return Err(
                        "Restore staging already exists; recover it before retrying.".to_string(),
                    );
                }
                let bytes = tree_bytes(&source)?;
                let available = fs2::available_space(parent)
                    .map_err(|e| format!("Check restore disk space: {e}"))?;
                if available < bytes.saturating_add(DISK_RESERVE_BYTES) {
                    return Err(format!(
                        "Not enough free space to restore {}.",
                        live.display()
                    ));
                }
                let existed = live.exists();
                targets.push(RestoreMove {
                    live,
                    staged: staged.clone(),
                    rollback,
                    existed,
                    phase: MovePhase::Planned,
                });
                if source.is_dir() {
                    copy_tree_with_reuse(&source, &staged, None, false)?;
                } else if source.is_file() {
                    fs::copy(&source, &staged).map_err(|e| format!("Stage restore file: {e}"))?;
                }
                sync_tree(&staged)?;
            }
            Ok(())
        })();
        if let Err(error) = stage_result {
            for entry in &targets {
                let _ = remove_path(&entry.staged);
            }
            return Err(error);
        }
        Ok(targets)
    }
}

fn require_restore_identity(identifier: &str) -> Result<(), String> {
    if identifier != "com.kwantflow.desktop" {
        return Err("Backup and restore are unavailable for this application identity. Use the installed Kwantflow application.".to_string());
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MovePhase {
    Planned,
    OldMoveIntent,
    OldMoved,
    NewMoveIntent,
    NewMoved,
    RollbackIntent,
    RolledBack,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreMove {
    live: PathBuf,
    staged: PathBuf,
    rollback: PathBuf,
    existed: bool,
    phase: MovePhase,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreJournal {
    version: u32,
    token: String,
    committed: bool,
    #[serde(default)]
    retain_originals: bool,
    moves: Vec<RestoreMove>,
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Open backup file: {e}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Read backup file: {e}"))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn reject_symlink_path(path: &Path) -> Result<(), String> {
    let mut current = Some(path);
    while let Some(part) = current {
        if let Ok(metadata) = fs::symlink_metadata(part) {
            if metadata.file_type().is_symlink() {
                return Err("Backup paths must not contain symlinks.".to_string());
            }
        }
        current = part.parent();
    }
    Ok(())
}

fn tree_bytes(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Read backup metadata: {e}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Backup contains a symlink.".to_string());
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0u64;
    for entry in fs::read_dir(path).map_err(|e| format!("Read backup directory: {e}"))? {
        total = total.saturating_add(tree_bytes(&entry.map_err(|e| e.to_string())?.path())?);
    }
    Ok(total)
}

fn sync_tree(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_file() {
        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                fs::set_permissions(path, permissions)
                    .map_err(|e| format!("Prepare staged backup file for flushing: {e}"))?;
            }
        }
        #[cfg(windows)]
        let file = fs::OpenOptions::new().read(true).write(true).open(path);
        #[cfg(not(windows))]
        let file = fs::File::open(path);
        file.and_then(|file| file.sync_all())
            .map_err(|e| format!("Flush staged backup file: {e}"))?;
    } else {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            sync_tree(&entry.map_err(|e| e.to_string())?.path())?;
        }
        sync_directory(path)?;
    }
    Ok(())
}

fn durable_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|e| format!("Encode restore state: {e}"))?;
    let temporary = path.with_extension("json.new");
    let mut file =
        fs::File::create(&temporary).map_err(|e| format!("Create restore state: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Write restore state: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Flush restore state: {e}"))?;
    drop(file);
    durable_rename(&temporary, path)
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("Flush restore directory: {e}"))?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn app_config_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))
}

fn app_config_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_root(app)?.join("store.json"))
}

fn document_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::document_root(app)
}

fn workspace_containers_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(document_root(app)?.join(VAULT_ROOT).join("workspaces"))
}

fn app_local_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))
}

fn workspace_databases_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_root(app)?.join("workspaces"))
}

fn control_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_root(app)?.join("kwantflow-control.db"))
}

fn account_assets_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_root(app)?.join("account"))
}

fn backup_store_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_root(app)?.join(BACKUP_STORE_DIR))
}

fn snapshots_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(backup_store_root(app)?.join(SNAPSHOTS_DIR))
}

fn pending_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(backup_store_root(app)?.join(PENDING_DIR))
}

fn snapshot_payload_root(snapshot_dir: &Path) -> PathBuf {
    snapshot_dir.join("payload")
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Create directory {}: {}", path.display(), e))
}

const BACKUP_RETENTION_LIMIT: usize = 7;

fn validate_snapshot_id(snapshot_id: &str) -> Result<(), String> {
    let suffix = snapshot_id
        .strip_prefix("backup-")
        .ok_or_else(|| "Invalid backup snapshot ID.".to_string())?;
    uuid::Uuid::parse_str(suffix)
        .map(|_| ())
        .map_err(|_| "Invalid backup snapshot ID.".to_string())
}

fn snapshot_dir_for_id(app: &AppHandle, snapshot_id: &str) -> Result<PathBuf, String> {
    validate_snapshot_id(snapshot_id)?;
    Ok(snapshots_root(app)?.join(snapshot_id))
}

fn append_file_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<BackupManifestEntry>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(current).map_err(|e| format!("Read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Read directory entry: {}", e))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Read file type {}: {}", path.display(), e))?;

        if file_type.is_symlink() {
            return Err(format!("Backup contains a symlink: {}", path.display()));
        }

        if file_type.is_dir() {
            append_file_entries(root, &path, entries, total_bytes)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| format!("Read metadata {}: {}", path.display(), e))?;

        let relative = path
            .strip_prefix(root)
            .map_err(|e| format!("Resolve relative path: {}", e))?
            .to_string_lossy()
            .into_owned();
        #[cfg(windows)]
        let relative = relative.replace('\\', "/");
        let byte_size = metadata.len();
        *total_bytes += byte_size;
        entries.push(BackupManifestEntry {
            path: relative,
            byte_size,
            sha256: Some(hash_file(&path)?),
        });
    }

    Ok(())
}

fn try_reuse_file(
    source: &Path,
    destination: &Path,
    previous: Option<&Path>,
) -> Result<bool, String> {
    let Some(previous) = previous else {
        return Ok(false);
    };
    if !previous.exists() {
        return Ok(false);
    }

    let source_metadata =
        fs::metadata(source).map_err(|e| format!("Read source metadata: {}", e))?;
    let previous_metadata =
        fs::metadata(previous).map_err(|e| format!("Read previous metadata: {}", e))?;

    if source_metadata.len() != previous_metadata.len() {
        return Ok(false);
    }

    let source_modified = source_metadata.modified().ok();
    let previous_modified = previous_metadata.modified().ok();
    if source_modified.is_some()
        && previous_modified.is_some()
        && source_modified != previous_modified
    {
        return Ok(false);
    }

    if hash_file(source)? != hash_file(previous)? {
        return Ok(false);
    }

    match fs::hard_link(previous, destination) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

fn copy_tree_with_reuse(
    source_root: &Path,
    destination_root: &Path,
    previous_root: Option<&Path>,
    snapshot_databases: bool,
) -> Result<(), String> {
    if fs::symlink_metadata(source_root).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("Backup source root must not be a symlink.".to_string());
    }
    if !source_root.exists() {
        return Ok(());
    }

    ensure_dir(destination_root)?;

    for entry in fs::read_dir(source_root).map_err(|e| format!("Read source tree: {}", e))? {
        let entry = entry.map_err(|e| format!("Read source tree entry: {}", e))?;
        let source_path = entry.path();
        let destination_path = destination_root.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Read source tree file type: {}", e))?;

        if file_type.is_symlink() {
            return Err(format!(
                "Backup contains a symlink: {}",
                source_path.display()
            ));
        }

        // Staging starts empty. An existing child can be a case or normalization alias on
        // the destination volume; never merge directories or overwrite different bytes.
        match fs::symlink_metadata(&destination_path) {
            Ok(_) => {
                return Err(format!(
                    "Backup paths conflict on the destination filesystem: {}",
                    destination_path.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Check backup destination: {error}")),
        }

        if file_type.is_dir() {
            let next_previous = previous_root.map(|root| root.join(entry.file_name()));
            copy_tree_with_reuse(
                &source_path,
                &destination_path,
                next_previous.as_deref(),
                snapshot_databases,
            )?;
            continue;
        }

        if !file_type.is_file() || (snapshot_databases && is_sqlite_sidecar(&source_path)) {
            continue;
        }

        if snapshot_databases
            && source_path
                .extension()
                .and_then(|extension| extension.to_str())
                == Some("db")
        {
            sqlite_backup_to_path(&source_path, &destination_path)?;
            continue;
        }

        let previous_candidate = previous_root.map(|root| root.join(entry.file_name()));
        if try_reuse_file(
            &source_path,
            &destination_path,
            previous_candidate.as_deref(),
        )? {
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            ensure_dir(parent)?;
        }
        fs::copy(&source_path, &destination_path)
            .map_err(|e| format!("Copy file {}: {}", source_path.display(), e))?;
    }

    Ok(())
}

fn snapshot_workspace_display_name(control_db_path: &Path) -> Result<Option<String>, String> {
    if !control_db_path.exists() {
        return Ok(None);
    }

    let connection =
        Connection::open(control_db_path).map_err(|e| format!("Open backup DB: {}", e))?;
    let mut statement = connection
        .prepare(
            "SELECT workspace_registry.display_name
             FROM workspace_registry
             LEFT JOIN onboarding_state ON onboarding_state.active_workspace_id = workspace_registry.id
             ORDER BY CASE WHEN onboarding_state.active_workspace_id = workspace_registry.id THEN 0 ELSE 1 END,
                      workspace_registry.is_default DESC,
                      workspace_registry.created_at ASC
             LIMIT 1",
        )
        .map_err(|e| format!("Prepare workspace display name query: {}", e))?;
    let value = statement
        .query_row([], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|e| format!("Read workspace display name: {}", e))?;
    Ok(value.filter(|entry| !entry.trim().is_empty()))
}

fn sqlite_backup_to_path(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    if let Some(parent) = destination_path.parent() {
        ensure_dir(parent)?;
    }
    if destination_path.exists() {
        fs::remove_file(destination_path)
            .map_err(|e| format!("Remove previous DB backup file: {}", e))?;
    }

    let source =
        Connection::open(source_path).map_err(|e| format!("Open source SQLite DB: {}", e))?;
    let mut destination = Connection::open(destination_path)
        .map_err(|e| format!("Open destination SQLite DB: {}", e))?;
    let backup = rusqlite::backup::Backup::new(&source, &mut destination)
        .map_err(|e| format!("Create SQLite backup: {}", e))?;
    let result = backup
        .step(-1)
        .map_err(|e| format!("Run SQLite backup: {}", e))?;
    if !matches!(result, rusqlite::backup::StepResult::Done) {
        return Err("SQLite backup did not finish; no restore point was accepted.".to_string());
    }
    Ok(())
}

fn previous_snapshot_payload(app: &AppHandle, backup_id: &str) -> Result<Option<PathBuf>, String> {
    let summaries = load_snapshot_manifests(app)?;
    let snapshots_dir = snapshots_root(app)?;
    let previous = summaries
        .into_iter()
        .find(|manifest| manifest.summary.id != backup_id)
        .map(|manifest| snapshot_payload_root(&snapshots_dir.join(manifest.summary.id)));
    Ok(previous)
}

fn write_manifest(snapshot_dir: &Path, manifest: &BackupManifest) -> Result<(), String> {
    durable_json(&snapshot_dir.join("manifest.json"), manifest)
}

fn read_manifest_from_snapshot(snapshot_dir: &Path) -> Result<BackupManifest, String> {
    let bytes = fs::read(snapshot_dir.join("manifest.json"))
        .map_err(|e| format!("Read backup manifest: {}", e))?;
    serde_json::from_slice::<BackupManifest>(&bytes)
        .map_err(|e| format!("Decode backup manifest: {}", e))
}

fn ensure_restorable_manifest(manifest: &BackupManifest) -> Result<(), String> {
    if matches!(
        manifest.manifest_version,
        BACKUP_MANIFEST_VERSION | LEGACY_BACKUP_MANIFEST_VERSION
    ) {
        return Ok(());
    }
    Err(
        "This backup was created by an unsupported backup engine and cannot be safely restored."
            .to_string(),
    )
}

fn is_sqlite_sidecar(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".db-wal") || name.ends_with(".db-shm"))
        .unwrap_or(false)
}

fn load_snapshot_manifests(app: &AppHandle) -> Result<Vec<BackupManifest>, String> {
    let snapshots_dir = snapshots_root(app)?;
    if !snapshots_dir.exists() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    for entry in fs::read_dir(&snapshots_dir).map_err(|e| format!("Read snapshots dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Read snapshot entry: {}", e))?;
        let snapshot_dir = entry.path();
        if !snapshot_dir.is_dir() {
            continue;
        }
        if snapshot_dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".tmp-backup-"))
        {
            continue;
        }

        match read_manifest_from_snapshot(&snapshot_dir) {
            Ok(manifest) => {
                let Some(dir_name) = snapshot_dir.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if validate_snapshot_id(dir_name).is_err() || manifest.summary.id != dir_name {
                    log::warn!(
                        "[backup] Skipping backup snapshot with invalid manifest ID at {}",
                        snapshot_dir.display()
                    );
                    continue;
                }
                manifests.push(manifest)
            }
            Err(error) => {
                log::warn!(
                    "[backup] Skipping unreadable snapshot manifest at {}: {}",
                    snapshot_dir.display(),
                    error
                );
            }
        }
    }

    manifests.sort_by(|a, b| b.summary.created_at.cmp(&a.summary.created_at));
    Ok(manifests)
}

fn prune_snapshots(app: &AppHandle, _reason: BackupReason) -> Result<(), String> {
    let manifests = load_snapshot_manifests(app)?;
    let mut matching = manifests;
    if matching.len() <= BACKUP_RETENTION_LIMIT {
        return Ok(());
    }

    let request_path = pending_root(app)?.join(PENDING_RESTORE_FILE);
    let pending_id = if request_path.exists() {
        let request: PendingRestoreRequest =
            serde_json::from_slice(&fs::read(request_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        request.snapshot_id
    } else {
        None
    };
    matching.sort_by(|a, b| b.summary.created_at.cmp(&a.summary.created_at));
    for manifest in matching.into_iter().skip(BACKUP_RETENTION_LIMIT) {
        if pending_id.as_deref() == Some(manifest.summary.id.as_str()) {
            continue;
        }
        let snapshot_dir = snapshot_dir_for_id(app, &manifest.summary.id)?;
        if snapshot_dir.exists() {
            fs::remove_dir_all(&snapshot_dir).map_err(|e| {
                format!(
                    "Remove old backup snapshot {}: {}",
                    snapshot_dir.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn safe_payload_path(raw: &str) -> Result<PathBuf, String> {
    safe_snapshot_payload_path(raw, true)
}

fn safe_snapshot_payload_path(raw: &str, portable: bool) -> Result<PathBuf, String> {
    // A backslash is a literal Unix filename character. Only portable archives and Windows
    // snapshots interpret it as a separator, so they must reject it rather than retarget it.
    if ((portable || cfg!(windows)) && raw.contains('\\'))
        || raw.contains('\0')
        || raw.starts_with('/')
    {
        return Err("Backup contains an unsafe path.".to_string());
    }
    let segments: Vec<_> = raw.split('/').collect();
    if segments
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == ".." || ((portable || cfg!(windows)) && part.contains(':')))
    {
        return Err("Backup contains an unsafe path.".to_string());
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Err("Backup paths must be relative.".to_string());
    }
    let allowed = raw == "app-config/store.json"
        || raw == "app-config/kwantflow-control.db"
        || raw == "app-local/email-provider-settings.json"
        || raw.starts_with("app-local/workspaces/")
        || raw.starts_with("app-local/account/")
        || raw.starts_with("documents/workspaces/");
    if !allowed || raw.ends_with(".db-wal") || raw.ends_with(".db-shm") {
        return Err("Backup contains files outside the supported data roots.".to_string());
    }
    Ok(path)
}

fn validate_portable_name(raw: &str) -> Result<(), String> {
    for part in raw.split('/') {
        let stem = part.split('.').next().unwrap_or_default().to_uppercase();
        if part.ends_with([' ', '.'])
            || part.chars().any(|c| c < ' ' || "<>:\"|?*\\".contains(c))
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(
                    &stem[3..],
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                ))
        {
            return Err(format!(
                "Backup path cannot be transferred to Windows: {raw}"
            ));
        }
    }
    Ok(())
}

fn register_payload_name(
    raw: &str,
    names: &mut HashMap<String, (String, bool)>,
    portable: bool,
) -> Result<(), String> {
    let segments: Vec<_> = raw.split('/').collect();
    for index in 0..segments.len() {
        let prefix = segments[..=index].join("/");
        let is_file = index + 1 == segments.len();
        let key = if portable || cfg!(windows) {
            prefix.to_lowercase()
        } else {
            prefix.clone()
        };
        if let Some((previous, previous_is_file)) = names.get(&key) {
            if previous != &prefix || *previous_is_file || is_file {
                return Err("Backup contains duplicate or conflicting paths.".to_string());
            }
        } else {
            names.insert(key, (prefix, is_file));
        }
    }
    Ok(())
}

fn inspect_payload(payload: &Path, summary: BackupSummary) -> Result<BackupInspection, String> {
    inspect_data_roots(
        &BackupRoots {
            config: payload.join("app-config"),
            local: payload.join("app-local"),
            documents: payload.join("documents"),
        },
        summary,
    )
}

fn inspect_data_roots(
    roots: &BackupRoots,
    summary: BackupSummary,
) -> Result<BackupInspection, String> {
    let store_path = roots.config.join("store.json");
    if store_path.exists() {
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(&store_path).map_err(|e| format!("Read backup settings: {e}"))?,
        )
        .map_err(|e| format!("Backup settings are invalid JSON: {e}"))?;
        if !settings.is_object() {
            return Err("Backup settings must be a JSON object.".to_string());
        }
    }
    let provider_path = roots.local.join("email-provider-settings.json");
    if provider_path.exists() {
        reject_symlink_path(&provider_path)?;
        let settings: EmailProviderSettings = serde_json::from_slice(
            &fs::read(&provider_path)
                .map_err(|e| format!("Read backup email provider settings: {e}"))?,
        )
        .map_err(|_| "Backup email provider settings are invalid.".to_string())?;
        validate_provider_settings(settings)?;
    }
    let control = Connection::open_with_flags(
        roots.config.join("kwantflow-control.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("Open backup control database: {e}"))?;
    validate_database(&control, "control_contract_state")?;
    let mut statement = control
        .prepare("SELECT id, db_path, vault_root_path FROM workspace_registry ORDER BY id")
        .map_err(|e| format!("Inspect backup workspace registry: {e}"))?;
    let workspaces: Vec<(String, String, String)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut external_references = Vec::new();
    for (id, db_path, vault_path) in &workspaces {
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || db_path != &format!("workspaces/{id}/workspace.db")
            || vault_path != &format!("Kwantflow/workspaces/{id}/vault")
        {
            return Err(
                "Backup workspace registry contains unsupported or unsafe paths.".to_string(),
            );
        }
        let database = roots.local.join(db_path);
        let connection =
            Connection::open_with_flags(&database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Open backup workspace {id}: {e}"))?;
        validate_database(&connection, "runtime_contract_state")?;
        inspect_managed_references(&connection, roots, id, &mut external_references)?;
    }
    external_references.sort();
    external_references.dedup();
    Ok(BackupInspection {
        workspace_display_name: snapshot_workspace_display_name(
            &roots.config.join("kwantflow-control.db"),
        )?,
        workspace_count: workspaces.len(),
        external_references,
        summary,
    })
}

fn validate_database(connection: &Connection, contract_table: &str) -> Result<(), String> {
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("Check backup database: {e}"))?;
    if result != "ok" {
        return Err("Backup database integrity check failed.".to_string());
    }
    let violations: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("Check backup relationships: {e}"))?;
    if violations != 0 {
        return Err("Backup database contains broken relationships.".to_string());
    }
    let version: u32 = connection
        .query_row(
            &format!("SELECT schema_version FROM {contract_table} LIMIT 1"),
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Backup database contract is unsupported: {e}"))?;
    if version != 1 && version != WORKSPACE_SCHEMA_VERSION as u32 {
        return Err(format!("Backup schema version {version} is unsupported."));
    }
    Ok(())
}

const MANAGED_PATH_COLUMNS: &[(&str, &str)] = &[
    ("files", "file_path"),
    ("workspace_members", "avatar_path"),
    ("contacts", "logo_file_path"),
    ("workspace_profile", "logo_file_path"),
    ("workspace_ai_knowledge_files", "file_path"),
];

fn normalize_managed_reference_separators(path: &str) -> String {
    // Match the native resolver: preserve canonical Unix suffixes, while recognizing the
    // old Windows managed hierarchy even when its backup is inspected on a Unix host.
    if cfg!(windows) || path.starts_with("workspaces\\") || path.starts_with("account\\") {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

fn inspect_managed_references(
    connection: &Connection,
    roots: &BackupRoots,
    workspace_id: &str,
    external: &mut Vec<String>,
) -> Result<(), String> {
    for (table, column) in MANAGED_PATH_COLUMNS {
        let mut statement = connection
            .prepare(&format!(
                "SELECT {column} FROM {table} WHERE {column} IS NOT NULL AND {column} <> ''"
            ))
            .map_err(|e| format!("Inspect backup {table}: {e}"))?;
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for path in paths {
            let path = normalize_managed_reference_separators(&path.map_err(|e| e.to_string())?);
            if is_absolute_path(&path) {
                external.push(path);
                continue;
            }
            if path
                .split('/')
                .any(|part| part == "." || part == ".." || part.is_empty())
            {
                return Err("Backup record contains an unsafe managed-file path.".to_string());
            }
            let target = if path.starts_with(&format!("workspaces/{workspace_id}/vault/")) {
                roots.documents.join(&path)
            } else if path.starts_with("account/") {
                roots.local.join(&path)
            } else {
                external.push(path);
                continue;
            };
            if !target.is_file() {
                return Err(format!("Backup is missing a referenced file: {path}"));
            }
        }
    }
    Ok(())
}

fn is_absolute_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("file:")
        || (path.len() >= 2 && path.as_bytes()[1] == b':')
}

fn normalize_copied_managed_paths(payload: &Path, roots: &BackupRoots) -> Result<(), String> {
    let local_prefix = format!("{}/", normalize_managed_reference_separators(&roots.local.to_string_lossy()));
    let document_prefix = format!("{}/", normalize_managed_reference_separators(&roots.documents.to_string_lossy()));
    let control = Connection::open(payload.join("app-config/kwantflow-control.db"))
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = control
        .prepare("SELECT id FROM workspace_registry")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    for id in ids {
        let connection = Connection::open(
            payload
                .join("app-local/workspaces")
                .join(&id)
                .join("workspace.db"),
        )
        .map_err(|e| e.to_string())?;
        for (table, column) in MANAGED_PATH_COLUMNS {
            let values: Vec<(i64, String)> = connection.prepare(&format!("SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL AND {column} <> ''"))
                .map_err(|e| format!("Inspect managed backup paths: {e}"))?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?
                .collect::<Result<_, _>>().map_err(|e| e.to_string())?;
            for (rowid, path) in values {
                let normalized = normalize_managed_reference_separators(
                    path.strip_prefix("file://").unwrap_or(&path),
                );
                let relative = normalized
                    .strip_prefix(&document_prefix)
                    .filter(|part| payload.join("documents").join(part).is_file())
                    .or_else(|| {
                        normalized
                            .strip_prefix(&local_prefix)
                            .filter(|part| payload.join("app-local").join(part).is_file())
                    });
                let value = relative.unwrap_or(&normalized);
                if value != path {
                    connection
                        .execute(
                            &format!("UPDATE {table} SET {column} = ? WHERE rowid = ?"),
                            rusqlite::params![value, rowid],
                        )
                        .map_err(|e| format!("Normalize managed backup path: {e}"))?;
                }
            }
        }
    }
    Ok(())
}

fn validate_snapshot_payload(
    snapshot: &Path,
    manifest: &BackupManifest,
    portable: bool,
) -> Result<BackupInspection, String> {
    ensure_restorable_manifest(manifest)?;
    if portable && manifest.manifest_version != BACKUP_MANIFEST_VERSION {
        return Err("Portable archives require the current backup format.".to_string());
    }
    let payload = snapshot_payload_root(snapshot);
    validate_payload_manifest(&payload)?;
    let mut actual = Vec::new();
    let mut total = 0;
    append_file_entries(&payload, &payload, &mut actual, &mut total)?;
    let mut expected = HashMap::new();
    let mut names = HashMap::new();
    for entry in &manifest.entries {
        if portable || cfg!(windows) {
            validate_portable_name(&entry.path)?;
        }
        safe_snapshot_payload_path(&entry.path, portable)?;
        register_payload_name(&entry.path, &mut names, portable)?;
        if expected.insert(entry.path.clone(), entry).is_some() {
            return Err("Backup contains duplicate or conflicting paths.".to_string());
        }
        if manifest.manifest_version == BACKUP_MANIFEST_VERSION
            && entry
                .sha256
                .as_ref()
                .map(|value| value.len() != 64)
                .unwrap_or(true)
        {
            return Err("Backup manifest is missing file checksums.".to_string());
        }
    }
    if actual.len() != expected.len()
        || manifest.summary.file_count != actual.len()
        || manifest.summary.total_bytes != total
    {
        return Err("Backup payload does not match its complete manifest.".to_string());
    }
    for entry in &actual {
        let expected = expected
            .get(&entry.path)
            .ok_or("Backup contains an unlisted file.")?;
        if expected.byte_size != entry.byte_size
            || (manifest.manifest_version == BACKUP_MANIFEST_VERSION
                && expected.sha256 != entry.sha256)
        {
            return Err(format!(
                "Backup file failed integrity verification: {}",
                entry.path
            ));
        }
    }
    inspect_payload(&payload, manifest.summary.clone())
}

fn lock_snapshot_databases(roots: &BackupRoots) -> Result<Vec<Connection>, String> {
    let control_path = roots.config.join("kwantflow-control.db");
    if !control_path.exists() {
        return Err("Create a local workspace before making a backup.".to_string());
    }
    let control = Connection::open(&control_path).map_err(|e| e.to_string())?;
    control
        .busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    control
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("Pause control database writes for backup: {e}"))?;
    let paths: Vec<String> = control
        .prepare("SELECT db_path FROM workspace_registry")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut locks = vec![control];
    for relative in paths {
        let normalized = crate::db::workspace::normalize_workspace_db_relative_path(&relative)?;
        let path = roots.local.join(normalized);
        reject_symlink_path(&path)?;
        let connection =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
                .map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| format!("Pause workspace writes for backup: {e}"))?;
        locks.push(connection);
    }
    Ok(locks)
}

fn create_snapshot_inner(app: &AppHandle, reason: BackupReason) -> Result<BackupManifest, String> {
    require_restore_identity(&app.config().identifier)?;
    let _file_guard = BACKUP_FILE_ACCESS
        .write()
        .map_err(|_| "Backup file access lock is unavailable.".to_string())?;
    let roots = BackupRoots::from_app(app)?;
    let _database_locks = lock_snapshot_databases(&roots)?;
    let snapshots_dir = snapshots_root(app)?;
    ensure_dir(&snapshots_dir)?;

    let backup_id = format!("backup-{}", uuid::Uuid::new_v4());
    let snapshot_dir = snapshots_dir.join(&backup_id);
    let temp_dir = snapshots_dir.join(format!(".tmp-{}", backup_id));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("Remove temp backup dir: {}", e))?;
    }
    ensure_dir(&temp_dir)?;
    let result = (|| -> Result<BackupManifest, String> {
        let payload_root = snapshot_payload_root(&temp_dir);
        let previous_payload = previous_snapshot_payload(app, &backup_id)?;

        let store_source = app_config_store_path(app)?;
        let store_destination_root = payload_root.join("app-config");
        ensure_dir(&store_destination_root)?;
        if store_source.exists() {
            let store_destination = store_destination_root.join("store.json");
            if !try_reuse_file(
                &store_source,
                &store_destination,
                previous_payload
                    .as_ref()
                    .map(|root| root.join("app-config").join("store.json"))
                    .as_deref(),
            )? {
                fs::copy(&store_source, &store_destination)
                    .map_err(|e| format!("Copy store file: {}", e))?;
            }
        }

        let control_db_source = control_db_path(app)?;
        let control_db_destination = payload_root.join("app-config").join("kwantflow-control.db");
        if control_db_source.exists() {
            sqlite_backup_to_path(&control_db_source, &control_db_destination)?;
        }

        copy_tree_with_reuse(
            &workspace_containers_root(app)?,
            &payload_root.join("documents").join("workspaces"),
            previous_payload
                .as_ref()
                .map(|root| root.join("documents").join("workspaces"))
                .as_deref(),
            false,
        )?;

        copy_tree_with_reuse(
            &workspace_databases_root(app)?,
            &payload_root.join("app-local").join("workspaces"),
            previous_payload
                .as_ref()
                .map(|root| root.join("app-local").join("workspaces"))
                .as_deref(),
            true,
        )?;

        copy_tree_with_reuse(
            &account_assets_root(app)?,
            &payload_root.join("app-local").join("account"),
            previous_payload
                .as_ref()
                .map(|root| root.join("app-local").join("account"))
                .as_deref(),
            false,
        )?;

        reject_symlink_path(&roots.local.join("email-provider-settings.json"))?;
        let provider_settings = crate::integrations::read_provider_settings(app)?;
        ensure_dir(&payload_root.join("app-local"))?;
        durable_json(
            &payload_root.join("app-local/email-provider-settings.json"),
            &provider_settings,
        )?;

        normalize_copied_managed_paths(&payload_root, &roots)?;
        let mut entries = Vec::new();
        let mut total_bytes = 0_u64;
        append_file_entries(&payload_root, &payload_root, &mut entries, &mut total_bytes)?;

        let workspace_display_name = snapshot_workspace_display_name(&control_db_destination)?;
        let schema_version = Connection::open_with_flags(
            &control_db_destination,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT schema_version FROM control_contract_state LIMIT 1",
            [],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|e| format!("Read backup schema version: {e}"))?;
        let summary = BackupSummary {
            id: backup_id.clone(),
            reason,
            created_at: now_iso(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version,
            file_count: entries.len(),
            total_bytes,
        };

        let manifest = BackupManifest {
            manifest_version: BACKUP_MANIFEST_VERSION,
            workspace_display_name,
            summary,
            entries,
        };
        write_manifest(&temp_dir, &manifest)?;
        validate_snapshot_payload(&temp_dir, &manifest, false)?;
        sync_tree(&temp_dir)?;

        if snapshot_dir.exists() {
            fs::remove_dir_all(&snapshot_dir)
                .map_err(|e| format!("Replace snapshot dir: {}", e))?;
        }
        durable_rename(&temp_dir, &snapshot_dir)?;
        if reason != BackupReason::PreRestore {
            prune_snapshots(app, reason)?;
        }

        Ok(manifest)
    })();
    if result.is_err() {
        let _ = remove_path(&temp_dir);
    }
    result
}

fn clear_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path).map_err(|e| format!("Remove directory {}: {}", path.display(), e))
}

fn clear_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|e| format!("Remove file {}: {}", path.display(), e))
}

fn validate_payload_manifest(payload_root: &Path) -> Result<(), String> {
    if fs::symlink_metadata(payload_root).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("Backup payload root must not be a symlink.".to_string());
    }
    if !payload_root.is_dir() {
        return Err("Backup payload is missing.".to_string());
    }
    validate_payload_tree(payload_root)
}

fn validate_payload_tree(current: &Path) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| format!("Read backup payload: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
            return Err("Backup payload contains an unsupported file or symlink.".to_string());
        }
        if kind.is_dir() {
            validate_payload_tree(&entry.path())?;
        }
    }
    Ok(())
}

fn durable_rename(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| format!("Move restore data: {e}"))?;
    }
    #[cfg(not(windows))]
    fs::rename(source, destination).map_err(|e| format!("Move restore data: {e}"))?;
    if let Some(parent) = source.parent() {
        sync_directory(parent)?;
    }
    if destination.parent() != source.parent() {
        if let Some(parent) = destination.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    reject_symlink_path(path)?;
    if path.is_dir() {
        clear_directory(path)
    } else {
        clear_file(path)
    }
}

fn validate_journal(roots: &BackupRoots, journal: &RestoreJournal) -> Result<(), String> {
    if journal.version != 1
        || uuid::Uuid::parse_str(&journal.token).is_err()
        || !matches!(journal.moves.len(), 7 | 8)
    {
        return Err(
            "Restore journal is unsupported; retained recovery data was not changed.".to_string(),
        );
    }
    let live = [
        roots.documents.join("workspaces"),
        roots.local.join("workspaces"),
        roots.local.join("account"),
        roots.config.join("store.json"),
        roots.config.join("kwantflow-control.db"),
        roots.config.join("kwantflow-control.db-wal"),
        roots.config.join("kwantflow-control.db-shm"),
        roots.local.join("email-provider-settings.json"),
    ];
    for (entry, expected) in journal.moves.iter().zip(live) {
        let parent = expected.parent().ok_or("Invalid restore target.")?;
        let name = expected
            .file_name()
            .ok_or("Invalid restore target name.")?
            .to_string_lossy();
        if entry.live != expected
            || entry.staged != parent.join(format!(".kwantflow-{}-{name}-stage", journal.token))
            || entry.rollback
                != parent.join(format!(".kwantflow-{}-{name}-rollback", journal.token))
        {
            return Err("Restore journal contains unsafe paths; recovery was stopped.".to_string());
        }
        reject_symlink_path(&entry.live)?;
        reject_symlink_path(&entry.staged)?;
        reject_symlink_path(&entry.rollback)?;
    }
    Ok(())
}

fn begin_rollback(path: &Path, journal: &mut RestoreJournal) -> Result<(), String> {
    // A failed commit write may have reached disk. Persist the rollback decision
    // before moving any originals so restart cannot mistake mixed trees for a commit.
    journal.committed = false;
    durable_json(path, journal)
}

fn rollback_journal(path: &Path, journal: &mut RestoreJournal) -> Result<(), String> {
    begin_rollback(path, journal)?;
    for index in (0..journal.moves.len()).rev() {
        let previous = journal.moves[index].phase;
        if previous == MovePhase::RolledBack {
            continue;
        }
        if previous == MovePhase::Planned {
            remove_path(&journal.moves[index].staged)?;
            journal.moves[index].phase = MovePhase::RolledBack;
            durable_json(path, journal)?;
            continue;
        }
        journal.moves[index].phase = MovePhase::RollbackIntent;
        durable_json(path, journal)?;
        let entry = &journal.moves[index];
        if entry.rollback.exists() {
            remove_path(&entry.live)?;
            durable_rename(&entry.rollback, &entry.live)?;
        } else if entry.existed {
            if !entry.live.exists()
                || !matches!(
                    previous,
                    MovePhase::OldMoveIntent | MovePhase::RollbackIntent
                )
            {
                return Err("Original restore data is unavailable; recovery was stopped without deleting retained data.".to_string());
            }
        } else if matches!(
            previous,
            MovePhase::NewMoveIntent | MovePhase::NewMoved | MovePhase::RollbackIntent
        ) {
            remove_path(&entry.live)?;
        }
        remove_path(&entry.staged)?;
        journal.moves[index].phase = MovePhase::RolledBack;
        durable_json(path, journal)?;
    }
    clear_file(path)?;
    sync_directory(path.parent().ok_or("Restore journal has no parent.")?)
}

fn recover_restore_journal(roots: &BackupRoots) -> Result<bool, String> {
    let path = roots.pending().join(RESTORE_JOURNAL_FILE);
    if !path.exists() {
        return Ok(false);
    }
    reject_symlink_path(&path)?;
    let mut journal: RestoreJournal =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Read restore journal: {e}"))?;
    validate_journal(roots, &journal)?;
    if journal.committed {
        validate_live_restore(roots)?;
        if journal.retain_originals {
            let quarantine = roots.local.join(BACKUP_STORE_DIR).join("quarantine");
            ensure_dir(&quarantine)?;
            durable_json(
                &quarantine.join(format!("{}.json", journal.token)),
                &journal,
            )?;
        }
        for entry in &journal.moves {
            if !journal.retain_originals {
                remove_path(&entry.rollback)?;
            }
            remove_path(&entry.staged)?;
        }
        clear_file(&roots.pending().join(PENDING_RESTORE_FILE))?;
        clear_file(&path)?;
        sync_directory(&roots.pending())?;
        return Ok(true);
    }
    rollback_journal(&path, &mut journal)?;
    Ok(false)
}

fn retained_recovery_paths(roots: &BackupRoots) -> Result<Vec<String>, String> {
    let quarantine = roots.local.join(BACKUP_STORE_DIR).join("quarantine");
    if !quarantine.exists() {
        return Ok(Vec::new());
    }
    reject_symlink_path(&quarantine)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(&quarantine).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        reject_symlink_path(&path)?;
        let journal: RestoreJournal =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Read retained recovery record: {e}"))?;
        validate_journal(roots, &journal)?;
        if !journal.committed || !journal.retain_originals {
            return Err("Retained recovery record is invalid.".to_string());
        }
        for target in journal.moves {
            if target.existed && target.rollback.exists() {
                paths.push(target.rollback.to_string_lossy().to_string());
            }
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn validate_live_restore(roots: &BackupRoots) -> Result<(), String> {
    tauri::async_runtime::block_on(crate::db::runtime::migrate_and_validate_local_databases(
        &roots.config.join("kwantflow-control.db"),
        &roots.local.join("workspaces"),
        &roots.pending().join("migration-recovery"),
    ))?;
    inspect_data_roots(
        roots,
        BackupSummary {
            id: "restore-validation".to_string(),
            reason: BackupReason::PreRestore,
            created_at: now_iso(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version: WORKSPACE_SCHEMA_VERSION as u32,
            file_count: 0,
            total_bytes: 0,
        },
    )?;
    Ok(())
}

fn checkpoint_live_control(roots: &BackupRoots) -> Result<(), String> {
    let path = roots.config.join("kwantflow-control.db");
    if !path.exists() {
        return Ok(());
    }
    let connection = Connection::open(&path).map_err(|e| e.to_string())?;
    let (busy, _, _): (i64, i64, i64) = connection
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| format!("Checkpoint control database before restore: {e}"))?;
    if busy != 0 {
        return Err("Control database is busy; restore was not applied.".to_string());
    }
    drop(connection);
    clear_file(&path.with_extension("db-wal"))?;
    clear_file(&path.with_extension("db-shm"))?;
    Ok(())
}

fn apply_snapshot_restore_from_payload(
    roots: &BackupRoots,
    payload_root: &Path,
    retain_originals: bool,
) -> Result<(), String> {
    let pending = roots.pending();
    ensure_dir(&pending)?;
    let stage = pending.join(format!("validated-payload-{}", uuid::Uuid::new_v4()));
    let required = tree_bytes(payload_root)?
        .saturating_mul(2)
        .saturating_add(DISK_RESERVE_BYTES);
    if fs2::available_space(&pending).map_err(|e| e.to_string())? < required {
        return Err("Not enough free disk space to validate and stage this restore.".to_string());
    }
    let copied = copy_tree_with_reuse(payload_root, &stage, None, false);
    if let Err(error) = copied {
        let _ = remove_path(&stage);
        return Err(error);
    }
    let prepare = (|| -> Result<(), String> {
        tauri::async_runtime::block_on(crate::db::runtime::migrate_and_validate_local_databases(
            &stage.join("app-config/kwantflow-control.db"),
            &stage.join("app-local/workspaces"),
            &pending.join("migration-recovery"),
        ))?;
        inspect_payload(
            &stage,
            BackupSummary {
                id: "restore-validation".to_string(),
                reason: BackupReason::PreRestore,
                created_at: now_iso(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                schema_version: WORKSPACE_SCHEMA_VERSION as u32,
                file_count: 0,
                total_bytes: 0,
            },
        )?;
        if !retain_originals {
            checkpoint_live_control(roots)?;
        }
        Ok(())
    })();
    if let Err(error) = prepare {
        let _ = remove_path(&stage);
        return Err(error);
    }
    let token = uuid::Uuid::new_v4().to_string();
    let moves = match roots.restore_targets(&stage, &token) {
        Ok(moves) => moves,
        Err(error) => {
            let _ = remove_path(&stage);
            return Err(error);
        }
    };
    if let Err(error) = remove_path(&stage) {
        for entry in &moves {
            let _ = remove_path(&entry.staged);
        }
        return Err(error);
    }
    let journal_path = pending.join(RESTORE_JOURNAL_FILE);
    let mut journal = RestoreJournal {
        version: 1,
        token,
        committed: false,
        retain_originals,
        moves,
    };
    if let Err(error) = durable_json(&journal_path, &journal) {
        for entry in &journal.moves {
            let _ = remove_path(&entry.staged);
        }
        return Err(error);
    }
    let apply = (|| -> Result<(), String> {
        for index in 0..journal.moves.len() {
            journal.moves[index].phase = MovePhase::OldMoveIntent;
            durable_json(&journal_path, &journal)?;
            if journal.moves[index].existed {
                durable_rename(&journal.moves[index].live, &journal.moves[index].rollback)?;
            }
            journal.moves[index].phase = MovePhase::OldMoved;
            durable_json(&journal_path, &journal)?;
            journal.moves[index].phase = MovePhase::NewMoveIntent;
            durable_json(&journal_path, &journal)?;
            if journal.moves[index].staged.exists() {
                durable_rename(&journal.moves[index].staged, &journal.moves[index].live)?;
            }
            journal.moves[index].phase = MovePhase::NewMoved;
            durable_json(&journal_path, &journal)?;
        }
        validate_live_restore(roots)?;
        journal.committed = true;
        durable_json(&journal_path, &journal)?;
        Ok(())
    })();
    if let Err(error) = apply {
        return match rollback_journal(&journal_path, &mut journal) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error} Recovery requires attention: {rollback}")),
        };
    }
    recover_restore_journal(roots)?;
    Ok(())
}

fn validate_supported_snapshot(
    snapshot: &Path,
    manifest: &BackupManifest,
    portable: bool,
) -> Result<BackupInspection, String> {
    // Verify the immutable input first, then prove exact schema compatibility on a disposable copy.
    let inspection = validate_snapshot_payload(snapshot, manifest, portable)?;
    let validation = snapshot
        .parent()
        .ok_or("Backup snapshot has no parent.")?
        .join(format!(".restore-validation-{}", uuid::Uuid::new_v4()));
    if fs2::available_space(snapshot).map_err(|e| e.to_string())?
        < manifest
            .summary
            .total_bytes
            .saturating_mul(2)
            .saturating_add(DISK_RESERVE_BYTES)
    {
        return Err(
            "Not enough free disk space to validate this backup's database upgrade.".to_string(),
        );
    }
    let result = (|| -> Result<(), String> {
        copy_tree_with_reuse(
            &snapshot_payload_root(snapshot),
            &validation.join("payload"),
            None,
            false,
        )?;
        let payload = validation
            .join("payload")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::block_on(crate::db::runtime::migrate_and_validate_local_databases(
            &payload.join("app-config/kwantflow-control.db"),
            &payload.join("app-local/workspaces"),
            &validation.join("migration-recovery"),
        ))?;
        inspect_payload(&payload, manifest.summary.clone())?;
        Ok(())
    })();
    let cleanup = remove_path(&validation);
    result?;
    cleanup?;
    Ok(inspection)
}

fn apply_pending_restore(app: &AppHandle) -> Result<(), String> {
    let _operation = BACKUP_OPERATIONS
        .lock()
        .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
    let pending_dir = pending_root(app)?;
    if !pending_dir.join(RESTORE_JOURNAL_FILE).exists()
        && !pending_dir.join(PENDING_RESTORE_FILE).exists()
    {
        return Ok(());
    }
    require_restore_identity(&app.config().identifier)?;
    let roots = BackupRoots::from_app(app)?;
    if recover_restore_journal(&roots)? {
        return Ok(());
    }
    let request_path = pending_dir.join(PENDING_RESTORE_FILE);
    if !request_path.exists() {
        return Ok(());
    }

    let bytes =
        fs::read(&request_path).map_err(|e| format!("Read pending restore request: {}", e))?;
    let request = serde_json::from_slice::<PendingRestoreRequest>(&bytes)
        .map_err(|e| format!("Decode pending restore request: {}", e))?;

    let snapshot_id = match request.kind {
        PendingRestoreKind::Snapshot => request
            .snapshot_id
            .ok_or_else(|| "Pending snapshot restore is missing snapshot ID.".to_string())?,
    };
    let snapshot_dir = snapshot_dir_for_id(app, &snapshot_id)?;
    let manifest = read_manifest_from_snapshot(&snapshot_dir)?;
    validate_snapshot_payload(&snapshot_dir, &manifest, false)?;
    let payload_root = snapshot_payload_root(&snapshot_dir);

    let retain_originals = if request.preserve_raw_originals {
        true
    } else {
        match create_snapshot_inner(app, BackupReason::PreRestore) {
            Ok(_) => false,
            Err(error) => {
                log::warn!("[backup] Current profile cannot form a validated safety snapshot. Raw originals, including SQLite sidecars, will be retained after recovery: {error}");
                true
            }
        }
    };
    let restore_result =
        apply_snapshot_restore_from_payload(&roots, &payload_root, retain_originals);

    if restore_result.is_ok() {
        let _ = fs::remove_file(&request_path);
        if let Err(error) = prune_snapshots(app, BackupReason::PreRestore) {
            log::warn!(
                "[backup] Failed to prune snapshots after restore: {}",
                error
            );
        }
    }

    restore_result
}

#[tauri::command]
pub fn get_backup_status(app: AppHandle) -> Result<BackupStatus, String> {
    let manifests = load_snapshot_manifests(&app)?;
    let mut status = BackupStatus::default();
    status.last_backup = manifests.first().map(|manifest| manifest.summary.clone());
    status.last_automatic_backup = manifests
        .iter()
        .find(|manifest| manifest.summary.reason == BackupReason::Auto)
        .map(|manifest| manifest.summary.clone());
    status.recent_snapshots = manifests
        .iter()
        .map(|manifest| manifest.summary.clone())
        .collect();
    status.retained_recovery_paths = retained_recovery_paths(&BackupRoots::from_app(&app)?)?;
    Ok(status)
}

#[tauri::command]
pub async fn create_backup_snapshot(
    app: AppHandle,
    reason: BackupReason,
) -> Result<BackupSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
    if app
        .try_state::<crate::db::runtime::DatabaseRuntime>()
        .is_none()
    {
        return Err("The current profile needs recovery. Import a validated backup before creating a new snapshot.".to_string());
    }
    let _operation = BACKUP_OPERATIONS
        .lock()
        .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
    Ok(create_snapshot_inner(&app, reason)?.summary)
    }).await.map_err(|error| format!("Backup creation worker failed. Restart Kwantflow before retrying: {error}"))?
}

#[tauri::command]
pub async fn inspect_backup_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<BackupInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        let snapshot_dir = snapshot_dir_for_id(&app, &snapshot_id)?;
        if !snapshot_dir.exists() {
            return Err("Selected backup snapshot no longer exists.".to_string());
        }

        let manifest = read_manifest_from_snapshot(&snapshot_dir)?;
        validate_supported_snapshot(&snapshot_dir, &manifest, false)
    })
    .await
    .map_err(|error| {
        format!("Backup inspection worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

#[tauri::command]
pub async fn delete_backup_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<BackupDeleteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        let snapshot_dir = snapshot_dir_for_id(&app, &snapshot_id)?;
        if !snapshot_dir.exists() {
            return Err("Selected backup snapshot no longer exists.".to_string());
        }

        let manifest = read_manifest_from_snapshot(&snapshot_dir)?;
        let pending_request = pending_root(&app)?.join(PENDING_RESTORE_FILE);
        if pending_request.exists() {
            let request: PendingRestoreRequest =
                serde_json::from_slice(&fs::read(pending_request).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if request.snapshot_id.as_deref() == Some(snapshot_id.as_str()) {
                return Err("This backup is pending restoration and cannot be deleted.".to_string());
            }
        }
        fs::remove_dir_all(&snapshot_dir).map_err(|e| format!("Delete backup snapshot: {}", e))?;

        Ok(BackupDeleteResult {
            summary: manifest.summary,
        })
    })
    .await
    .map_err(|error| {
        format!("Backup deletion worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

#[tauri::command]
pub async fn stage_backup_restore_from_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Result<BackupRestoreStageResult, String> {
    tauri::async_runtime::spawn_blocking(move || stage_snapshot_restore(&app, snapshot_id))
        .await
        .map_err(|error| {
            format!("Backup staging worker failed. Restart Kwantflow before retrying: {error}")
        })?
}

fn stage_snapshot_restore(
    app: &AppHandle,
    snapshot_id: String,
) -> Result<BackupRestoreStageResult, String> {
    require_restore_identity(&app.config().identifier)?;
    let _operation = BACKUP_OPERATIONS
        .lock()
        .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
    let snapshot_dir = snapshot_dir_for_id(app, &snapshot_id)?;
    if !snapshot_dir.exists() {
        return Err("Selected backup snapshot no longer exists.".to_string());
    }

    let manifest = read_manifest_from_snapshot(&snapshot_dir)?;
    validate_supported_snapshot(&snapshot_dir, &manifest, false)?;

    stage_snapshot_restore_request(app, snapshot_id, manifest.summary)
}

// Callers hold BACKUP_OPERATIONS from validation through this durable request write.
fn stage_snapshot_restore_request(
    app: &AppHandle,
    snapshot_id: String,
    summary: BackupSummary,
) -> Result<BackupRestoreStageResult, String> {
    let pending_dir = pending_root(app)?;
    ensure_dir(&pending_dir)?;
    if pending_dir.join(RESTORE_JOURNAL_FILE).exists() {
        return Err("An interrupted restore must finish recovery before another backup can replace it. Retained originals were not changed.".to_string());
    }
    let request = PendingRestoreRequest {
        kind: PendingRestoreKind::Snapshot,
        snapshot_id: Some(snapshot_id),
        preserve_raw_originals: app
            .try_state::<crate::db::runtime::DatabaseRuntime>()
            .is_none(),
    };
    durable_json(&pending_dir.join(PENDING_RESTORE_FILE), &request)?;

    Ok(BackupRestoreStageResult {
        summary,
        safety_snapshot_created: false,
    })
}

fn approved_archive_destination(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("Choose an absolute .zip destination for the portable backup.".to_string());
    }
    if path.exists() {
        crate::resolve_allowed_file_path(&path, app)?;
        reject_symlink_path(&path)?;
    }
    let parent = path
        .parent()
        .ok_or("Backup destination has no parent.")?
        .canonicalize()
        .map_err(|e| format!("Resolve backup destination: {e}"))?;
    let mut allowed = vec![
        app.path().home_dir().map_err(|e| e.to_string())?,
        std::env::temp_dir(),
    ];
    #[cfg(target_os = "macos")]
    allowed.push(PathBuf::from("/Volumes"));
    #[cfg(windows)]
    for drive in b'D'..=b'Z' {
        allowed.push(PathBuf::from(format!("{}:\\", drive as char)));
    }
    if !allowed
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| parent.starts_with(root))
    {
        return Err(
            "Backup destination must be within home, temporary storage, or an external drive."
                .to_string(),
        );
    }
    Ok(parent.join(
        path.file_name()
            .ok_or("Backup destination has no file name.")?,
    ))
}

fn write_portable_archive(
    snapshot: &Path,
    manifest: &BackupManifest,
    destination: &Path,
) -> Result<(), String> {
    validate_snapshot_payload(snapshot, manifest, true)?;
    let parent = destination
        .parent()
        .ok_or("Archive destination has no parent.")?;
    let available = fs2::available_space(parent).map_err(|e| e.to_string())?;
    if available
        < manifest
            .summary
            .total_bytes
            .saturating_add(DISK_RESERVE_BYTES)
    {
        return Err("Not enough free disk space to export this backup.".to_string());
    }
    let temporary = parent.join(format!(
        ".kwantflow-backup-{}.zip.tmp",
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> Result<(), String> {
        let file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .unix_permissions(0o600)
            .large_file(true);
        zip.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for entry in &manifest.entries {
            zip.start_file(format!("payload/{}", entry.path), options)
                .map_err(|e| e.to_string())?;
            let mut source = fs::File::open(snapshot_payload_root(snapshot).join(&entry.path))
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut zip).map_err(|e| e.to_string())?;
        }
        let file = zip.finish().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        durable_rename(&temporary, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn extract_portable_archive(source: &Path, destination: &Path) -> Result<BackupManifest, String> {
    ensure_dir(destination)?;
    let file = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Open portable backup: {e}"))?;
    let manifest = {
        let entry = archive
            .by_name("manifest.json")
            .map_err(|_| "Archive is missing its backup manifest.".to_string())?;
        if entry.size() > 16 * 1024 * 1024 {
            return Err("Backup manifest is too large.".to_string());
        }
        let bytes = entry
            .bytes()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        serde_json::from_slice::<BackupManifest>(&bytes)
            .map_err(|e| format!("Read portable backup manifest: {e}"))?
    };
    if manifest.manifest_version != BACKUP_MANIFEST_VERSION {
        return Err("Portable backup version is unsupported.".to_string());
    }
    validate_snapshot_id(&manifest.summary.id)?;
    let mut expected = HashMap::new();
    let mut names = HashMap::new();
    let mut total = 0u64;
    for entry in &manifest.entries {
        safe_payload_path(&entry.path)?;
        validate_portable_name(&entry.path)?;
        register_payload_name(&entry.path, &mut names, true)?;
        if expected
            .insert(format!("payload/{}", entry.path), entry)
            .is_some()
        {
            return Err("Backup contains duplicate or conflicting paths.".to_string());
        }
        total = total
            .checked_add(entry.byte_size)
            .ok_or("Backup size is invalid.")?;
    }
    if total != manifest.summary.total_bytes
        || expected.len() != manifest.summary.file_count
        || archive.len() != expected.len() + 1
    {
        return Err("Portable backup does not match its complete manifest.".to_string());
    }
    if fs2::available_space(destination).map_err(|e| e.to_string())?
        < total.saturating_add(DISK_RESERVE_BYTES)
    {
        return Err("Not enough disk space to inspect or import this backup.".to_string());
    }
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !seen.insert(name.clone())
            || entry.is_dir()
            || entry
                .unix_mode()
                .map(|mode| mode & 0o170000 == 0o120000)
                .unwrap_or(false)
        {
            return Err("Portable backup contains duplicate entries or symlinks.".to_string());
        }
        if name == "manifest.json" {
            continue;
        }
        let descriptor = expected
            .get(&name)
            .ok_or("Portable backup contains an unlisted file.")?;
        if entry.size() != descriptor.byte_size {
            return Err("Portable backup file size does not match its manifest.".to_string());
        }
        let relative = safe_payload_path(&descriptor.path)?;
        let target = destination.join("payload").join(relative);
        ensure_dir(target.parent().ok_or("Invalid archive path.")?)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| format!("Extract backup file: {e}"))?;
        let copied = std::io::copy(
            &mut entry.by_ref().take(descriptor.byte_size.saturating_add(1)),
            &mut output,
        )
        .map_err(|e| e.to_string())?;
        if copied != descriptor.byte_size {
            return Err("Portable backup contains a truncated or oversized file.".to_string());
        }
        output.sync_all().map_err(|e| e.to_string())?;
    }
    write_manifest(destination, &manifest)?;
    validate_snapshot_payload(destination, &manifest, true)?;
    Ok(manifest)
}

#[tauri::command]
pub async fn export_backup_archive(
    app: AppHandle,
    destination_path: String,
) -> Result<BackupArchiveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app
            .try_state::<crate::db::runtime::DatabaseRuntime>()
            .is_none()
        {
            return Err(
                "The current profile needs recovery. Import a validated backup before exporting."
                    .to_string(),
            );
        }
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        let destination = approved_archive_destination(&app, &destination_path)?;
        let manifest = create_snapshot_inner(&app, BackupReason::Manual)?;
        write_portable_archive(
            &snapshot_dir_for_id(&app, &manifest.summary.id)?,
            &manifest,
            &destination,
        )?;
        Ok(BackupArchiveResult {
            summary: manifest.summary,
            path: destination.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|error| {
        format!("Backup export worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

#[tauri::command]
pub async fn inspect_backup_archive(
    app: AppHandle,
    source_path: String,
) -> Result<BackupInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        let source = crate::resolve_allowed_file_path(Path::new(&source_path), &app)?;
        let temporary =
            pending_root(&app)?.join(format!("archive-inspect-{}", uuid::Uuid::new_v4()));
        let result = extract_portable_archive(&source, &temporary)
            .and_then(|manifest| validate_supported_snapshot(&temporary, &manifest, true));
        let cleanup = remove_path(&temporary);
        let inspection = result?;
        cleanup?;
        Ok(inspection)
    })
    .await
    .map_err(|error| {
        format!("Archive inspection worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

#[tauri::command]
pub async fn stage_backup_restore_from_archive(
    app: AppHandle,
    source_path: String,
) -> Result<BackupRestoreStageResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        require_restore_identity(&app.config().identifier)?;
        let source = crate::resolve_allowed_file_path(Path::new(&source_path), &app)?;
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        if pending_root(&app)?.join(RESTORE_JOURNAL_FILE).exists() {
            return Err("An interrupted restore must finish recovery before another backup can replace it. Retained originals were not changed.".to_string());
        }
        let manifest = import_validated_archive_snapshot(&source, &snapshots_root(&app)?)?;
        stage_snapshot_restore_request(&app, manifest.summary.id.clone(), manifest.summary)
    })
    .await
    .map_err(|error| {
        format!("Archive staging worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

fn import_validated_archive_snapshot(
    source: &Path,
    snapshots: &Path,
) -> Result<BackupManifest, String> {
    reject_symlink_path(snapshots)?;
    ensure_dir(snapshots)?;
    let snapshot_id = format!("backup-{}", uuid::Uuid::new_v4());
    let temporary = snapshots.join(format!(".tmp-{snapshot_id}"));
    let snapshot = snapshots.join(&snapshot_id);
    let result = (|| -> Result<BackupManifest, String> {
        let mut manifest = extract_portable_archive(source, &temporary)?;
        manifest.summary.id = snapshot_id;
        write_manifest(&temporary, &manifest)?;
        // Invalid or interrupted imports never enter the retained snapshot namespace. Exact
        // schema validation and legacy migration run on a disposable copy before promotion.
        validate_supported_snapshot(&temporary, &manifest, true)?;
        sync_tree(&temporary)?;
        durable_rename(&temporary, &snapshot)?;
        Ok(manifest)
    })();
    if result.is_err() {
        let _ = remove_path(&temporary);
    }
    result
}

#[tauri::command]
pub async fn cancel_pending_backup_restore(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = BACKUP_OPERATIONS
            .lock()
            .map_err(|_| "Backup operation lock is unavailable.".to_string())?;
        let pending = pending_root(&app)?;
        if pending.join(RESTORE_JOURNAL_FILE).exists() {
            return Err(
                "Restore application has started; retained recovery data cannot be cancelled."
                    .to_string(),
            );
        }
        clear_file(&pending.join(PENDING_RESTORE_FILE))?;
        if pending.exists() {
            sync_directory(&pending)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| {
        format!("Restore cancellation worker failed. Restart Kwantflow before retrying: {error}")
    })?
}

pub fn apply_pending_restore_if_needed(app: &AppHandle) -> Result<(), String> {
    apply_pending_restore(app)
}

trait OptionalRow<T> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error>;
}

impl<T> OptionalRow<T> for Result<T, rusqlite::Error> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_snapshot(root: &Path) -> (PathBuf, BackupManifest) {
        let snapshot = root.join("snapshot");
        let payload = snapshot.join("payload");
        ensure_dir(&payload.join("app-config")).unwrap();
        ensure_dir(&payload.join("app-local/workspaces/ws")).unwrap();
        let control = Connection::open(payload.join("app-config/kwantflow-control.db")).unwrap();
        control
            .execute_batch(include_str!("../migrations-control/001_control.sql"))
            .unwrap();
        control.execute_batch("PRAGMA foreign_keys = ON; INSERT INTO profile_identity(id) VALUES('primary-profile'); INSERT INTO control_customer_identity(id,profile_id) VALUES('primary-customer','primary-profile'); INSERT INTO workspace_registry(id,customer_id,display_name,slug,db_path,vault_root_path) VALUES('ws','primary-customer','Fixture','fixture','workspaces/ws/workspace.db','Kwantflow/workspaces/ws/vault');").unwrap();
        drop(control);
        let workspace =
            Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        workspace
            .execute_batch(include_str!("../migrations-workspace/001_workspace.sql"))
            .unwrap();
        workspace
            .execute_batch("INSERT INTO workspace_identity(id) VALUES('ws');")
            .unwrap();
        drop(workspace);
        ensure_dir(&payload.join("documents/workspaces/ws/vault")).unwrap();
        fs::write(
            payload.join("documents/workspaces/ws/vault/fixture.txt"),
            b"original",
        )
        .unwrap();
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        append_file_entries(&payload, &payload, &mut entries, &mut total_bytes).unwrap();
        let manifest = BackupManifest {
            manifest_version: BACKUP_MANIFEST_VERSION,
            workspace_display_name: Some("Fixture".to_string()),
            summary: BackupSummary {
                id: format!("backup-{}", uuid::Uuid::new_v4()),
                reason: BackupReason::Manual,
                created_at: now_iso(),
                app_version: "test".to_string(),
                schema_version: WORKSPACE_SCHEMA_VERSION as u32,
                file_count: entries.len(),
                total_bytes,
            },
            entries,
        };
        write_manifest(&snapshot, &manifest).unwrap();
        (snapshot, manifest)
    }

    #[test]
    fn validate_snapshot_id_accepts_only_internal_backup_ids() {
        let valid_id = format!("backup-{}", uuid::Uuid::new_v4());

        assert!(validate_snapshot_id(&valid_id).is_ok());
        assert!(validate_snapshot_id("../backup-123").is_err());
        assert!(validate_snapshot_id("backup-not-a-uuid").is_err());
        assert!(validate_snapshot_id("manual-backup-123").is_err());
        assert!(require_restore_identity("com.kwantflow.desktop").is_ok());
        assert!(require_restore_identity("com.kwantflow.dev").is_err());
        assert!(require_restore_identity("com.kwantflow.qa").is_err());
    }

    #[test]
    fn portable_archive_round_trip_preserves_complete_payload_and_excludes_unlisted_secrets() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, manifest) = fixture_snapshot(temp.path());
        let archive = temp.path().join("backup.zip");
        write_portable_archive(&snapshot, &manifest, &archive).unwrap();
        let restored = temp.path().join("imported");
        let imported = extract_portable_archive(&archive, &restored).unwrap();
        let inspection = validate_snapshot_payload(&restored, &imported, true).unwrap();
        assert_eq!(inspection.workspace_count, 1);
        assert_eq!(
            fs::read(restored.join("payload/documents/workspaces/ws/vault/fixture.txt")).unwrap(),
            b"original"
        );
        assert!(!restored
            .join("payload/app-local/secure_store.json")
            .exists());
    }

    #[test]
    fn provider_registrations_and_explicit_defaults_survive_portable_archive_restore() {
        let configured = EmailProviderSettings {
            google_client_id: "synthetic-client.apps.googleusercontent.com".to_string(),
            microsoft_client_id: "11111111-2222-4333-8444-555555555555".to_string(),
            microsoft_tenant: "consumers".to_string(),
        };
        let installed = EmailProviderSettings {
            google_client_id: "previous-client.apps.googleusercontent.com".to_string(),
            microsoft_client_id: "66666666-7777-4888-8999-aaaaaaaaaaaa".to_string(),
            microsoft_tenant: "organizations".to_string(),
        };
        for settings in [EmailProviderSettings::default(), configured.clone()] {
            let temp = tempfile::tempdir().unwrap();
            let base = temp.path().canonicalize().unwrap();
            let (snapshot, mut manifest) = fixture_snapshot(&base.join("source"));
            let payload = snapshot.join("payload");
            durable_json(
                &payload.join("app-local/email-provider-settings.json"),
                &settings,
            )
            .unwrap();
            manifest.entries.clear();
            manifest.summary.total_bytes = 0;
            append_file_entries(
                &payload,
                &payload,
                &mut manifest.entries,
                &mut manifest.summary.total_bytes,
            )
            .unwrap();
            manifest.summary.file_count = manifest.entries.len();
            write_manifest(&snapshot, &manifest).unwrap();
            let provider_entry = manifest
                .entries
                .iter()
                .find(|entry| entry.path == "app-local/email-provider-settings.json")
                .unwrap();
            let provider_hash = hash_file(&payload.join(&provider_entry.path)).unwrap();
            assert_eq!(
                provider_entry.sha256.as_deref(),
                Some(provider_hash.as_str())
            );
            let archive = base.join("public-settings.zip");
            write_portable_archive(&snapshot, &manifest, &archive).unwrap();
            let imported = base.join("imported");
            let imported_manifest = extract_portable_archive(&archive, &imported).unwrap();
            validate_supported_snapshot(&imported, &imported_manifest, true).unwrap();
            let roots = BackupRoots {
                config: base.join("live/config"),
                local: base.join("live/local"),
                documents: base.join("live/documents"),
            };
            ensure_dir(&roots.local).unwrap();
            durable_json(
                &roots.local.join("email-provider-settings.json"),
                &installed,
            )
            .unwrap();
            fs::write(
                roots.local.join("secure_store.json"),
                b"synthetic credential sentinel",
            )
            .unwrap();
            apply_snapshot_restore_from_payload(&roots, &imported.join("payload"), false).unwrap();
            let restored: EmailProviderSettings = serde_json::from_slice(
                &fs::read(roots.local.join("email-provider-settings.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(restored, settings);
            assert_eq!(
                fs::read(roots.local.join("secure_store.json")).unwrap(),
                b"synthetic credential sentinel"
            );
            assert!(!roots.pending().join(RESTORE_JOURNAL_FILE).exists());
            assert!(!imported
                .join("payload/app-local/secure_store.json")
                .exists());
            assert_eq!(
                fs::read(roots.documents.join("workspaces/ws/vault/fixture.txt")).unwrap(),
                b"original"
            );
        }
    }

    #[test]
    fn legacy_portable_restore_preserves_existing_registrations_or_their_absence() {
        for existing in [
            None,
            Some(EmailProviderSettings {
                google_client_id: "legacy-installation.apps.googleusercontent.com".to_string(),
                microsoft_client_id: String::new(),
                microsoft_tenant: "common".to_string(),
            }),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let base = temp.path().canonicalize().unwrap();
            let (snapshot, manifest) = fixture_snapshot(&base.join("legacy"));
            let archive = base.join("legacy.zip");
            write_portable_archive(&snapshot, &manifest, &archive).unwrap();
            let imported = base.join("imported");
            let imported_manifest = extract_portable_archive(&archive, &imported).unwrap();
            validate_supported_snapshot(&imported, &imported_manifest, true).unwrap();
            let roots = BackupRoots {
                config: base.join("live/config"),
                local: base.join("live/local"),
                documents: base.join("live/documents"),
            };
            ensure_dir(&roots.local).unwrap();
            let live_settings = roots.local.join("email-provider-settings.json");
            if let Some(settings) = &existing {
                durable_json(&live_settings, settings).unwrap();
            }
            let original = fs::read(&live_settings).ok();
            apply_snapshot_restore_from_payload(&roots, &imported.join("payload"), false).unwrap();
            assert_eq!(fs::read(&live_settings).ok(), original);
            assert!(!roots.pending().join(RESTORE_JOURNAL_FILE).exists());
            assert_eq!(
                fs::read(roots.documents.join("workspaces/ws/vault/fixture.txt")).unwrap(),
                b"original"
            );
        }
    }

    #[test]
    fn invalid_or_secret_bearing_provider_settings_fail_before_live_restore_or_archive_acceptance()
    {
        for invalid in [
            "not JSON",
            "[]",
            r#"{"googleClientId":"","microsoftClientId":"","microsoftTenant":"common","clientSecret":"synthetic secret"}"#,
            r#"{"googleClientId":"","microsoftClientId":"","microsoftTenant":"common","refreshToken":"synthetic token"}"#,
            r#"{"googleClientId":"invalid","microsoftClientId":"","microsoftTenant":"common"}"#,
            r#"{"googleClientId":"","microsoftClientId":"invalid","microsoftTenant":"common"}"#,
            r#"{"googleClientId":"","microsoftClientId":"","microsoftTenant":"invalid"}"#,
        ] {
            let temp = tempfile::tempdir().unwrap();
            let base = temp.path().canonicalize().unwrap();
            let (snapshot, mut manifest) = fixture_snapshot(&base.join("source"));
            let payload = snapshot.join("payload");
            fs::write(
                payload.join("app-local/email-provider-settings.json"),
                invalid,
            )
            .unwrap();
            manifest.entries.clear();
            manifest.summary.total_bytes = 0;
            append_file_entries(
                &payload,
                &payload,
                &mut manifest.entries,
                &mut manifest.summary.total_bytes,
            )
            .unwrap();
            manifest.summary.file_count = manifest.entries.len();
            write_manifest(&snapshot, &manifest).unwrap();
            let roots = BackupRoots {
                config: base.join("live/config"),
                local: base.join("live/local"),
                documents: base.join("live/documents"),
            };
            ensure_dir(&roots.config).unwrap();
            ensure_dir(&roots.local).unwrap();
            fs::write(
                roots.config.join("kwantflow-control.db"),
                b"untouched live database",
            )
            .unwrap();
            durable_json(
                &roots.local.join("email-provider-settings.json"),
                &EmailProviderSettings::default(),
            )
            .unwrap();
            let original = fs::read(roots.local.join("email-provider-settings.json")).unwrap();
            assert!(
                apply_snapshot_restore_from_payload(&roots, &payload, false).is_err(),
                "{invalid}"
            );
            assert_eq!(
                fs::read(roots.config.join("kwantflow-control.db")).unwrap(),
                b"untouched live database"
            );
            assert_eq!(
                fs::read(roots.local.join("email-provider-settings.json")).unwrap(),
                original
            );
            assert!(!roots.pending().join(RESTORE_JOURNAL_FILE).exists());
            let rejected_export = base.join("rejected.zip");
            assert!(write_portable_archive(&snapshot, &manifest, &rejected_export).is_err());
            assert!(!rejected_export.exists());
            // A hostile archive can have valid checksums for invalid settings. Exercise
            // the real extractor with those bytes rather than only a corrupt digest.
            let archive = base.join("invalid-settings.zip");
            let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(&serde_json::to_vec(&manifest).unwrap())
                .unwrap();
            for entry in &manifest.entries {
                zip.start_file(format!("payload/{}", entry.path), options)
                    .unwrap();
                zip.write_all(&fs::read(payload.join(&entry.path)).unwrap())
                    .unwrap();
            }
            zip.finish().unwrap();
            assert!(
                extract_portable_archive(&archive, &base.join("extracted")).is_err(),
                "{invalid}"
            );
            assert_eq!(
                fs::read(roots.local.join("email-provider-settings.json")).unwrap(),
                original
            );
        }
    }

    #[test]
    fn provider_restore_journal_accepts_only_the_exact_optional_eighth_target() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let roots = BackupRoots {
            config: base.join("config"),
            local: base.join("local"),
            documents: base.join("documents"),
        };
        let source = base.join("payload");
        ensure_dir(&source.join("app-local")).unwrap();
        durable_json(
            &source.join("app-local/email-provider-settings.json"),
            &EmailProviderSettings::default(),
        )
        .unwrap();
        let token = uuid::Uuid::new_v4().to_string();
        let mut journal = RestoreJournal {
            version: 1,
            token: token.clone(),
            committed: false,
            retain_originals: false,
            moves: roots.restore_targets(&source, &token).unwrap(),
        };
        assert_eq!(journal.moves.len(), 8);
        validate_journal(&roots, &journal).unwrap();
        journal.moves[7].live = roots.local.join("secure_store.json");
        assert!(validate_journal(&roots, &journal).is_err());
        journal.moves[7].live = roots.local.join("email-provider-settings.json");
        journal.moves.swap(6, 7);
        assert!(validate_journal(&roots, &journal).is_err());
        journal.moves.swap(6, 7);
        journal.moves.pop();
        validate_journal(&roots, &journal).unwrap();
        journal.moves.pop();
        assert!(validate_journal(&roots, &journal).is_err());
    }

    #[test]
    fn rejected_archive_imports_cannot_enter_or_displace_retained_snapshots() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let snapshots = base.join("retained");
        ensure_dir(&snapshots).unwrap();
        let mut retained = Vec::new();
        for index in 0..BACKUP_RETENTION_LIMIT {
            let (source, manifest) = fixture_snapshot(&base.join(format!("good-{index}")));
            let destination = snapshots.join(&manifest.summary.id);
            durable_rename(&source, &destination).unwrap();
            retained.push((destination, serde_json::to_vec(&manifest).unwrap()));
        }
        let (invalid, mut manifest) = fixture_snapshot(&base.join("invalid"));
        let payload = invalid.join("payload");
        let connection =
            Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        connection
            .execute_batch("CREATE TABLE unknown_schema(value TEXT)")
            .unwrap();
        drop(connection);
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        append_file_entries(&payload, &payload, &mut entries, &mut total_bytes).unwrap();
        manifest.entries = entries;
        manifest.summary.file_count = manifest.entries.len();
        manifest.summary.total_bytes = total_bytes;
        manifest.summary.created_at = "9999-12-31T23:59:59Z".to_string();
        write_manifest(&invalid, &manifest).unwrap();
        let archive = base.join("invalid-schema.zip");
        // Checksums and lightweight archive contracts are valid, but the exact DB schema is not.
        write_portable_archive(&invalid, &manifest, &archive).unwrap();
        for _ in 0..BACKUP_RETENTION_LIMIT {
            let error = import_validated_archive_snapshot(&archive, &snapshots)
                .err()
                .expect("Unknown schema must fail before promotion");
            assert!(error.contains("schema does not match"), "{error}");
            assert_eq!(
                fs::read_dir(&snapshots).unwrap().count(),
                BACKUP_RETENTION_LIMIT
            );
        }
        for (path, original) in retained {
            assert_eq!(
                serde_json::to_vec(&read_manifest_from_snapshot(&path).unwrap()).unwrap(),
                original
            );
            let manifest = read_manifest_from_snapshot(&path).unwrap();
            validate_snapshot_payload(&path, &manifest, true).unwrap();
        }
        // A crash-created incomplete staging directory is also outside the backup ID namespace.
        let interrupted = snapshots.join(format!(".tmp-backup-{}", uuid::Uuid::new_v4()));
        ensure_dir(&interrupted).unwrap();
        assert!(validate_snapshot_id(interrupted.file_name().unwrap().to_str().unwrap()).is_err());
    }

    #[test]
    fn valid_archive_import_is_promoted_only_after_exact_database_validation() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let (source, manifest) = fixture_snapshot(&base.join("source"));
        let archive = base.join("valid.zip");
        write_portable_archive(&source, &manifest, &archive).unwrap();
        let snapshots = base.join("retained");
        let imported = import_validated_archive_snapshot(&archive, &snapshots).unwrap();
        assert_ne!(imported.summary.id, manifest.summary.id);
        assert_eq!(fs::read_dir(&snapshots).unwrap().count(), 1);
        validate_supported_snapshot(&snapshots.join(&imported.summary.id), &imported, true).unwrap();
    }

    #[test]
    fn manifest_rejects_same_length_corruption_missing_files_and_case_collisions() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, mut manifest) = fixture_snapshot(temp.path());
        let file = snapshot.join("payload/documents/workspaces/ws/vault/fixture.txt");
        fs::write(&file, b"modified").unwrap();
        assert!(validate_snapshot_payload(&snapshot, &manifest, true)
            .unwrap_err()
            .contains("integrity"));
        fs::remove_file(&file).unwrap();
        assert!(validate_snapshot_payload(&snapshot, &manifest, true)
            .unwrap_err()
            .contains("complete manifest"));
        let duplicate = manifest
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("fixture.txt"))
            .unwrap()
            .clone();
        let mut conflicting = duplicate.clone();
        conflicting.path = duplicate.path.replace("fixture.txt", "FIXTURE.txt");
        manifest.entries.push(conflicting);
        assert!(validate_snapshot_payload(&snapshot, &manifest, true)
            .unwrap_err()
            .contains("conflicting"));
    }

    #[test]
    fn manifest_and_archive_paths_reject_traversal_credentials_and_windows_reserved_names() {
        assert!(safe_payload_path("app-local/email-provider-settings.json").is_ok());
        for path in [
            "../escape",
            "/absolute",
            "app-local/account/../secret",
            "app-local/secure_store.json",
            "app-local/oauth_tokens.json",
            "app-local/email-provider-settings.json.new",
            "app-local/email-provider-settings.json/token",
            "app-local/account/a\\b",
            "app-local/account/C:/x",
        ] {
            assert!(safe_payload_path(path).is_err(), "{path}");
        }
        for path in [
            "documents/workspaces/ws/vault/CON.txt",
            "documents/workspaces/ws/vault/COM².txt",
            "documents/workspaces/ws/vault/file.",
            "documents/workspaces/ws/vault/a?.pdf",
        ] {
            assert!(validate_portable_name(path).is_err(), "{path}");
        }
    }

    #[test]
    fn archive_directory_case_aliases_and_file_directory_conflicts_are_rejected() {
        let mut names = HashMap::new();
        register_payload_name("app-local/account/Profile/avatar.png", &mut names, true).unwrap();
        assert!(
            register_payload_name("app-local/account/profile/knowledge.pdf", &mut names, true).is_err()
        );
        let mut names = HashMap::new();
        register_payload_name("app-local/account/path", &mut names, true).unwrap();
        assert!(register_payload_name("app-local/account/path/file", &mut names, true).is_err());
    }

    #[test]
    fn missing_managed_attachment_is_rejected_before_restore() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, manifest) = fixture_snapshot(temp.path());
        let connection =
            Connection::open(snapshot.join("payload/app-local/workspaces/ws/workspace.db"))
                .unwrap();
        connection.execute("INSERT INTO workspace_members(id,workspace_id,role,avatar_path) VALUES('member','ws','owner','account/missing-avatar.png')", []).unwrap();
        drop(connection);
        let error = inspect_payload(&snapshot.join("payload"), manifest.summary).unwrap_err();
        assert!(error.contains("missing a referenced file"));
    }

    #[cfg(unix)]
    #[test]
    fn local_backup_restores_exact_unix_colon_and_case_distinct_references() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let (snapshot, mut manifest) = fixture_snapshot(&base.join("source"));
        let payload = snapshot.join("payload");
        let mut files = vec![("colon", "part:1.step", b"colon bytes".as_slice())];
        let vault = payload.join("documents/workspaces/ws/vault");
        fs::write(vault.join("part.step"), b"lowercase bytes").unwrap();
        match fs::OpenOptions::new().write(true).create_new(true).open(vault.join("PART.step")) {
            Ok(mut upper) => {
                upper.write_all(b"uppercase bytes").unwrap();
                drop(upper);
                files.push(("lower", "part.step", b"lowercase bytes"));
                files.push(("upper", "PART.step", b"uppercase bytes"));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // This host cannot hold both names. The separate name-registry test still
                // exercises local case-distinct validation without depending on its volume.
                eprintln!("Case-distinct file restore requires a case-sensitive test volume.");
            }
            Err(error) => panic!("Create case-distinct fixture: {error}"),
        }
        let connection = Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        connection.execute_batch("INSERT INTO projects(id,workspace_id,rfq_number) VALUES('project','ws','RFQ');").unwrap();
        for (id, name, bytes) in &files {
            let relative = format!("workspaces/ws/vault/{name}");
            fs::write(vault.join(name), bytes).unwrap();
            connection.execute("INSERT INTO files(id,project_id,file_path,original_name) VALUES(?,'project',?,?)", rusqlite::params![id, relative, name]).unwrap();
        }
        drop(connection);
        let source_roots = BackupRoots {
            config: payload.join("app-config"),
            local: payload.join("app-local"),
            documents: payload.join("documents"),
        };
        normalize_copied_managed_paths(&payload, &source_roots).unwrap();
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        append_file_entries(&payload, &payload, &mut entries, &mut total_bytes).unwrap();
        manifest.entries = entries;
        manifest.summary.file_count = manifest.entries.len();
        manifest.summary.total_bytes = total_bytes;
        validate_supported_snapshot(&snapshot, &manifest, false).unwrap();
        let archive = base.join("nonportable.zip");
        assert!(write_portable_archive(&snapshot, &manifest, &archive).is_err());
        assert!(!archive.exists());
        let restored = BackupRoots {
            config: base.join("restored/config"),
            local: base.join("restored/local"),
            documents: base.join("restored/documents"),
        };
        apply_snapshot_restore_from_payload(&restored, &payload, false).unwrap();
        let connection = Connection::open(restored.local.join("workspaces/ws/workspace.db")).unwrap();
        for (id, name, expected) in files {
            let stored: String = connection.query_row("SELECT file_path FROM files WHERE id=?", [id], |row| row.get(0)).unwrap();
            assert_eq!(stored, format!("workspaces/ws/vault/{name}"));
            let relative = crate::normalize_safe_relative_path(&stored).unwrap();
            let resolved = crate::resolve_existing_path_within_root(&restored.documents.join(relative), &restored.documents).unwrap();
            assert_eq!(fs::read(resolved).unwrap(), expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn local_backup_name_registry_preserves_case_but_rejects_exact_conflicts() {
        let mut names = HashMap::new();
        register_payload_name("app-local/account/Profile/avatar.png", &mut names, false).unwrap();
        register_payload_name("app-local/account/profile/avatar.png", &mut names, false).unwrap();
        register_payload_name("app-local/account/Profile/AVATAR.png", &mut names, false).unwrap();
        assert!(register_payload_name("app-local/account/Profile/avatar.png", &mut names, false).is_err());
        assert!(register_payload_name("app-local/account/Profile/avatar.png/child", &mut names, false).is_err());
    }

    #[test]
    fn backup_staging_rejects_existing_child_paths_without_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        for directory in [false, true] {
            let source = temp.path().join(format!("source-{directory}"));
            let destination = temp.path().join(format!("destination-{directory}"));
            ensure_dir(&source).unwrap();
            ensure_dir(&destination).unwrap();
            let source_file = if directory {
                ensure_dir(&source.join("child")).unwrap();
                ensure_dir(&destination.join("child")).unwrap();
                fs::write(destination.join("child/original"), b"retained bytes").unwrap();
                source.join("child/new")
            } else {
                fs::write(destination.join("child"), b"retained bytes").unwrap();
                source.join("child")
            };
            fs::write(source_file, b"incoming bytes").unwrap();
            assert!(copy_tree_with_reuse(&source, &destination, None, false).is_err());
            let retained = if directory { destination.join("child/original") } else { destination.join("child") };
            assert_eq!(fs::read(retained).unwrap(), b"retained bytes");
            if directory { assert!(!destination.join("child/new").exists()); }
        }
    }

    #[cfg(unix)]
    #[test]
    fn local_backup_preserves_literal_unix_backslash_and_distinct_slash_file() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, _) = fixture_snapshot(temp.path());
        let payload = snapshot.join("payload");
        let original = "workspaces/ws/vault/part\\A.step";
        fs::write(
            payload.join("documents").join(original),
            b"literal backslash",
        )
        .unwrap();
        ensure_dir(&payload.join("documents/workspaces/ws/vault/part")).unwrap();
        fs::write(
            payload.join("documents/workspaces/ws/vault/part/A.step"),
            b"different slash",
        )
        .unwrap();
        let connection =
            Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO projects(id,workspace_id,rfq_number) VALUES('project','ws','RFQ');",
            )
            .unwrap();
        connection.execute("INSERT INTO files(id,project_id,file_path,original_name) VALUES('file','project',?,'part')", [original]).unwrap();
        drop(connection);
        let roots = BackupRoots {
            config: payload.join("app-config"),
            local: payload.join("app-local"),
            documents: payload.join("documents"),
        };
        normalize_copied_managed_paths(&payload, &roots).unwrap();
        let connection =
            Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        let stored: String = connection
            .query_row("SELECT file_path FROM files WHERE id='file'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            stored, original,
            "A snapshot must not retarget a Unix filename to different bytes"
        );
        drop(connection);
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        append_file_entries(&payload, &payload, &mut entries, &mut total_bytes).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.path == format!("documents/{original}")));
        let mut manifest = read_manifest_from_snapshot(&snapshot).unwrap();
        manifest.entries = entries;
        manifest.summary.file_count = manifest.entries.len();
        manifest.summary.total_bytes = total_bytes;
        validate_snapshot_payload(&snapshot, &manifest, false).unwrap();
        assert!(validate_snapshot_payload(&snapshot, &manifest, true).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn local_backup_resolves_recognized_legacy_windows_reference_on_unix() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, mut manifest) = fixture_snapshot(temp.path());
        let payload = snapshot.join("payload");
        let connection =
            Connection::open(payload.join("app-local/workspaces/ws/workspace.db")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO projects(id,workspace_id,rfq_number) VALUES('project','ws','RFQ');",
            )
            .unwrap();
        connection.execute("INSERT INTO files(id,project_id,file_path,original_name) VALUES('file','project',?,'fixture.txt')", ["workspaces\\ws\\vault\\fixture.txt"]).unwrap();
        drop(connection);
        let roots = BackupRoots {
            config: payload.join("app-config"),
            local: payload.join("app-local"),
            documents: payload.join("documents"),
        };
        normalize_copied_managed_paths(&payload, &roots).unwrap();
        let mut entries = Vec::new();
        let mut total_bytes = 0;
        append_file_entries(&payload, &payload, &mut entries, &mut total_bytes).unwrap();
        manifest.entries = entries;
        manifest.summary.file_count = manifest.entries.len();
        manifest.summary.total_bytes = total_bytes;
        validate_snapshot_payload(&snapshot, &manifest, true).unwrap();
    }

    #[test]
    fn schema_compatibility_is_proven_on_a_copy_before_restore_staging() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let (snapshot, mut manifest) = fixture_snapshot(&base);
        let database = snapshot.join("payload/app-local/workspaces/ws/workspace.db");
        let original = fs::read(&database).unwrap();
        assert_eq!(
            validate_supported_snapshot(&snapshot, &manifest, true)
                .unwrap()
                .workspace_count,
            1
        );
        assert_eq!(fs::read(&database).unwrap(), original);
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch("CREATE TABLE unknown_schema(value TEXT)")
            .unwrap();
        drop(connection);
        let modified = fs::read(&database).unwrap();
        manifest.entries.clear();
        manifest.summary.total_bytes = 0;
        append_file_entries(
            &snapshot.join("payload"),
            &snapshot.join("payload"),
            &mut manifest.entries,
            &mut manifest.summary.total_bytes,
        )
        .unwrap();
        manifest.summary.file_count = manifest.entries.len();
        assert!(validate_supported_snapshot(&snapshot, &manifest, true).is_err());
        assert_eq!(fs::read(&database).unwrap(), modified);
        assert!(!base.read_dir().unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".restore-validation-")));
    }

    #[test]
    fn invalid_settings_are_rejected_before_live_data_is_touched() {
        let temp = tempfile::tempdir().unwrap();
        let (snapshot, manifest) = fixture_snapshot(temp.path());
        fs::write(snapshot.join("payload/app-config/store.json"), b"[]").unwrap();
        assert!(inspect_payload(&snapshot.join("payload"), manifest.summary)
            .unwrap_err()
            .contains("JSON object"));
    }

    #[test]
    fn managed_database_snapshot_never_falls_back_to_an_incomplete_file_copy() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        ensure_dir(&source).unwrap();
        fs::write(source.join("workspace.db"), b"invalid database").unwrap();
        assert!(copy_tree_with_reuse(&source, &temp.path().join("snapshot"), None, true).is_err());
        copy_tree_with_reuse(&source, &temp.path().join("document-copy"), None, false).unwrap();
        assert_eq!(
            fs::read(temp.path().join("document-copy/workspace.db")).unwrap(),
            b"invalid database"
        );
    }

    #[test]
    fn sqlite_backup_reads_committed_wal_while_writer_lock_is_held() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.db");
        let writer = Connection::open(&source).unwrap();
        writer.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES('committed'); BEGIN IMMEDIATE;").unwrap();
        sqlite_backup_to_path(&source, &temp.path().join("backup.db")).unwrap();
        let backup = Connection::open(temp.path().join("backup.db")).unwrap();
        let value: String = backup
            .query_row("SELECT value FROM records", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "committed");
    }

    #[test]
    fn interrupted_restore_recovers_original_data_at_every_move_phase_and_retry() {
        for (include_provider_settings, target_count, had_provider_settings) in
            [(false, 7, true), (true, 8, true), (true, 8, false)]
        {
            let first_index = if had_provider_settings { 0 } else { 7 };
            for interrupted_index in first_index..target_count {
                for phase in [
                    MovePhase::OldMoveIntent,
                    MovePhase::OldMoved,
                    MovePhase::NewMoveIntent,
                    MovePhase::NewMoved,
                    MovePhase::RollbackIntent,
                ] {
                    let temp = tempfile::tempdir().unwrap();
                    let base = temp.path().canonicalize().unwrap();
                    let roots = BackupRoots {
                        config: base.join("config"),
                        local: base.join("local"),
                        documents: base.join("documents"),
                    };
                    ensure_dir(&roots.pending()).unwrap();
                    let source = base.join("payload");
                    for relative in [
                        "documents/workspaces/sentinel",
                        "app-local/workspaces/sentinel",
                        "app-local/account/sentinel",
                        "app-config/store.json",
                        "app-config/kwantflow-control.db",
                        "app-config/kwantflow-control.db-wal",
                        "app-config/kwantflow-control.db-shm",
                    ] {
                        let file = source.join(relative);
                        ensure_dir(file.parent().unwrap()).unwrap();
                        fs::write(file, b"new").unwrap();
                    }
                    for target in [
                        roots.documents.join("workspaces/sentinel"),
                        roots.local.join("workspaces/sentinel"),
                        roots.local.join("account/sentinel"),
                        roots.config.join("store.json"),
                        roots.config.join("kwantflow-control.db"),
                        roots.config.join("kwantflow-control.db-wal"),
                        roots.config.join("kwantflow-control.db-shm"),
                    ] {
                        ensure_dir(target.parent().unwrap()).unwrap();
                        fs::write(target, b"old").unwrap();
                    }
                    let live_provider = roots.local.join("email-provider-settings.json");
                    if had_provider_settings {
                        durable_json(
                            &live_provider,
                            &EmailProviderSettings {
                                google_client_id: "original-client.apps.googleusercontent.com"
                                    .to_string(),
                                microsoft_client_id: String::new(),
                                microsoft_tenant: "common".to_string(),
                            },
                        )
                        .unwrap();
                    }
                    let original_provider = fs::read(&live_provider).ok();
                    if include_provider_settings {
                        durable_json(
                            &source.join("app-local/email-provider-settings.json"),
                            &EmailProviderSettings::default(),
                        )
                        .unwrap();
                    }
                    let token = uuid::Uuid::new_v4().to_string();
                    let mut journal = RestoreJournal {
                        version: 1,
                        token: token.clone(),
                        committed: false,
                        retain_originals: false,
                        moves: roots.restore_targets(&source, &token).unwrap(),
                    };
                    assert_eq!(journal.moves.len(), target_count);
                    for index in 0..=interrupted_index {
                        let entry = &mut journal.moves[index];
                        if entry.existed
                            && (index < interrupted_index || phase != MovePhase::OldMoveIntent)
                        {
                            fs::rename(&entry.live, &entry.rollback).unwrap();
                        }
                        if index < interrupted_index
                            || matches!(phase, MovePhase::NewMoved | MovePhase::RollbackIntent)
                        {
                            fs::rename(&entry.staged, &entry.live).unwrap();
                        }
                        entry.phase = if index < interrupted_index {
                            MovePhase::NewMoved
                        } else {
                            phase
                        };
                    }
                    durable_json(&roots.pending().join(RESTORE_JOURNAL_FILE), &journal).unwrap();
                    assert!(!recover_restore_journal(&roots).unwrap());
                    assert!(!recover_restore_journal(&roots).unwrap());
                    for target in [
                        roots.documents.join("workspaces/sentinel"),
                        roots.local.join("workspaces/sentinel"),
                        roots.local.join("account/sentinel"),
                        roots.config.join("store.json"),
                        roots.config.join("kwantflow-control.db"),
                        roots.config.join("kwantflow-control.db-wal"),
                        roots.config.join("kwantflow-control.db-shm"),
                    ] {
                        assert_eq!(fs::read(target).unwrap(), b"old");
                    }
                    assert_eq!(fs::read(&live_provider).ok(), original_provider);
                    assert!(journal
                        .moves
                        .iter()
                        .all(|entry| entry.staged.parent() == entry.live.parent()
                            && entry.rollback.parent() == entry.live.parent()));
                }
            }
        }
    }

    #[test]
    fn failed_commit_record_cannot_leave_a_committed_journal_during_rollback() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let roots = BackupRoots {
            config: base.join("config"),
            local: base.join("local"),
            documents: base.join("documents"),
        };
        ensure_dir(&roots.pending()).unwrap();
        let source = base.join("payload");
        for relative in [
            "documents/workspaces/sentinel",
            "app-local/workspaces/sentinel",
            "app-local/account/sentinel",
            "app-config/store.json",
            "app-config/kwantflow-control.db",
            "app-config/kwantflow-control.db-wal",
            "app-config/kwantflow-control.db-shm",
        ] {
            let file = source.join(relative);
            ensure_dir(file.parent().unwrap()).unwrap();
            fs::write(file, b"new").unwrap();
        }
        for target in [
            roots.documents.join("workspaces/sentinel"),
            roots.local.join("workspaces/sentinel"),
            roots.local.join("account/sentinel"),
            roots.config.join("store.json"),
            roots.config.join("kwantflow-control.db"),
            roots.config.join("kwantflow-control.db-wal"),
            roots.config.join("kwantflow-control.db-shm"),
        ] {
            ensure_dir(target.parent().unwrap()).unwrap();
            fs::write(target, b"old").unwrap();
        }
        let token = uuid::Uuid::new_v4().to_string();
        let mut journal = RestoreJournal {
            version: 1,
            token: token.clone(),
            committed: true,
            retain_originals: false,
            moves: roots.restore_targets(&source, &token).unwrap(),
        };
        for entry in &mut journal.moves {
            durable_rename(&entry.live, &entry.rollback).unwrap();
            durable_rename(&entry.staged, &entry.live).unwrap();
            entry.phase = MovePhase::NewMoved;
        }
        let path = roots.pending().join(RESTORE_JOURNAL_FILE);
        durable_json(&path, &journal).unwrap();
        // A commit-record fsync error can leave committed=true in memory and on disk.
        // The rollback decision must reach disk before even the first reverse move.
        begin_rollback(&path, &mut journal).unwrap();
        let on_disk: RestoreJournal = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(!on_disk.committed);
        let last = journal.moves.last_mut().unwrap();
        remove_path(&last.live).unwrap();
        durable_rename(&last.rollback, &last.live).unwrap();
        last.phase = MovePhase::RollbackIntent;
        durable_json(&path, &journal).unwrap();
        assert!(!recover_restore_journal(&roots).unwrap());
        for target in [
            roots.documents.join("workspaces/sentinel"),
            roots.local.join("workspaces/sentinel"),
            roots.local.join("account/sentinel"),
            roots.config.join("store.json"),
            roots.config.join("kwantflow-control.db"),
            roots.config.join("kwantflow-control.db-wal"),
            roots.config.join("kwantflow-control.db-shm"),
        ] {
            assert_eq!(fs::read(target).unwrap(), b"old");
        }
    }

    #[test]
    fn damaged_live_profile_restore_preserves_raw_main_and_committed_wal_without_replaying_it() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let roots = BackupRoots {
            config: base.join("config"),
            local: base.join("local"),
            documents: base.join("documents"),
        };
        ensure_dir(&roots.config).unwrap();
        ensure_dir(&roots.local).unwrap();
        let (selected, selected_manifest) = fixture_snapshot(&base.join("selected"));
        validate_supported_snapshot(&selected, &selected_manifest, true).unwrap();
        let (old, _) = fixture_snapshot(&base.join("old-generator"));
        let old_control = old.join("payload/app-config/kwantflow-control.db");
        let writer = Connection::open(&old_control).unwrap();
        writer.execute_batch("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE workspace_registry SET display_name = 'Old business'; CREATE TABLE manual_notes(value TEXT); INSERT INTO manual_notes VALUES('preserve my business data');").unwrap();
        for suffix in ["", "-wal", "-shm"] {
            fs::copy(
                old_control.with_file_name(format!("kwantflow-control.db{suffix}")),
                roots.config.join(format!("kwantflow-control.db{suffix}")),
            )
            .unwrap();
        }
        let old_main = fs::read(roots.config.join("kwantflow-control.db")).unwrap();
        let old_wal = fs::read(roots.config.join("kwantflow-control.db-wal")).unwrap();
        assert!(!old_wal.is_empty());
        copy_tree_with_reuse(
            &old.join("payload/app-local/workspaces"),
            &roots.local.join("workspaces"),
            None,
            false,
        )
        .unwrap();
        copy_tree_with_reuse(
            &old.join("payload/documents/workspaces"),
            &roots.documents.join("workspaces"),
            None,
            false,
        )
        .unwrap();
        fs::write(
            roots.config.join("store.json"),
            b"{\"originalSettings\":true}",
        )
        .unwrap();
        apply_snapshot_restore_from_payload(&roots, &selected.join("payload"), true).unwrap();
        let restored = Connection::open(roots.config.join("kwantflow-control.db")).unwrap();
        let name: String = restored
            .query_row(
                "SELECT display_name FROM workspace_registry WHERE id='ws'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Fixture");
        drop(restored);
        let paths = retained_recovery_paths(&roots).unwrap();
        let raw_main = paths
            .iter()
            .find(|path| path.ends_with("kwantflow-control.db-rollback"))
            .unwrap();
        let raw_wal = paths
            .iter()
            .find(|path| path.ends_with("kwantflow-control.db-wal-rollback"))
            .unwrap();
        assert_eq!(fs::read(raw_main).unwrap(), old_main);
        assert_eq!(fs::read(raw_wal).unwrap(), old_wal);
        let recovered = base.join("raw-recovered");
        ensure_dir(&recovered).unwrap();
        for suffix in ["", "-wal", "-shm"] {
            let source = paths
                .iter()
                .find(|path| path.ends_with(&format!("kwantflow-control.db{suffix}-rollback")))
                .unwrap();
            fs::copy(
                source,
                recovered.join(format!("kwantflow-control.db{suffix}")),
            )
            .unwrap();
        }
        let recovered = Connection::open(recovered.join("kwantflow-control.db")).unwrap();
        let value: String = recovered
            .query_row("SELECT value FROM manual_notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "preserve my business data");
        assert!(!roots.pending().join(RESTORE_JOURNAL_FILE).exists());
        drop(writer);
    }
}
