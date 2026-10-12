mod ai_evidence_cache;
mod backup;
mod db;
mod integrations;
pub mod local_ai;
mod secure_store;

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

use std::ffi::OsStr;
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use crate::ai_evidence_cache::{
    get_ai_evidence_cache_budget, prune_ai_evidence_cache_on_startup, read_ai_evidence_cache_bytes,
    read_ai_evidence_cache_text, remove_ai_evidence_cache_prefix, set_ai_evidence_cache_pin,
    sweep_unregistered_ai_evidence_workspaces, write_ai_evidence_cache_bytes,
    write_ai_evidence_cache_text,
};
use crate::backup::{
    apply_pending_restore_if_needed, backup_file_mutation_guard, cancel_pending_backup_restore, create_backup_snapshot, delete_backup_snapshot,
    export_backup_archive, inspect_backup_archive, stage_backup_restore_from_archive,
    get_backup_status, inspect_backup_snapshot,
    stage_backup_restore_from_snapshot,
};
use crate::db::runtime::DatabaseRuntime;
use crate::db::{
    activate_workspace_command, add_contact_command, add_project_command, add_project_file_command,
    add_project_structure_template_command, apply_project_structure_template_to_project_command,
    apply_setup_import_session_command, assign_files_to_asset_command,
    create_asset_from_files_command, create_project_workspace_command,
    create_quote_revision_command, create_workspace_command, delete_catalogue_items_command,
    delete_file_command, delete_quote_option_command, delete_workspace_command,
    describe_workspace_records_command, duplicate_project_records_command,
    execute_approved_contacts_bundle_command, execute_approved_record_proposal_set_command,
    execute_control_database, execute_workspace_database, get_workspace_record_command,
    merge_assets_command, query_control_database, query_workspace_database,
    remove_file_from_asset_command, replace_ai_evidence_refs_command,
    replace_catalogue_record_company_links_command, replace_company_catalogue_links_command,
    reset_active_workspace_command, reset_quote_workspace_command, save_estimate_command,
    search_workspace_history_command, set_default_quote_option_command, ungroup_asset_command,
    update_contact_command, update_project_structure_template_command,
    update_project_workspace_command, upsert_local_bootstrap_foundation,
    write_assistant_action_audit_command,
};
use crate::integrations::{
    cancel_integration_oauth, complete_integration_oauth, download_email_attachment,
    get_email_provider_settings, set_email_provider_settings,
    get_email_message, list_email_messages, list_email_rfq_classifications, restore_integrations,
    revoke_integration, save_email_rfq_classification, send_email_message,
    set_email_message_read_status, start_integration_oauth, synchronize_email_messages,
    update_email_connection_settings,
};
use crate::local_ai::{
    abort_active_local_ai_completion, cancel_local_ai_download, cancel_local_ai_runtime,
    cleanup_local_ai_runtime, download_local_ai_model, end_local_ai_conversation,
    ensure_local_ai_ready, evaluate_estimate_expression, get_local_ai_capabilities_command,
    get_local_ai_conversation_tokens, get_local_ai_status, probe_local_ai_native_tools,
    remove_local_ai_model, run_local_ai_completion, run_local_ai_completion_stream,
    send_local_ai_message, start_local_ai_conversation, unload_local_ai_runtime,
    validate_manifest_consistency, verify_local_ai_install, LocalAiRuntimeManager,
};
use pdfium_render::prelude::*;

const VAULT_ROOT: &str = "Kwantflow";
const SUPPORT_DIAGNOSTICS_BUNDLE_MAX_BYTES: usize = 5_000_000;
const SUPPORT_DIAGNOSTICS_LOG_RETENTION_COUNT: usize = 10;
const SUPPORT_LOG_FILE_MAX_BYTES: u64 = 2_000_000;
static SUPPORT_LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
const SUPPORT_DIAGNOSTICS_MANIFEST_VERSION: u32 = 1;
const NATIVE_APP_MENU_ACTION_EVENT: &str = "native-app-menu-action";
const MENU_ACTION_OPEN_SETTINGS: &str = "open-settings";
const MENU_ACTION_OPEN_HELP: &str = "open-help";
const MENU_ACTION_SHOW_MAIN_WINDOW: &str = "show-main-window";
const MENU_ACTION_BRING_ALL_TO_FRONT: &str = "bring-all-to-front";
const TRAY_ACTION_QUIT: &str = "quit";

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsContextPayload {
    app_version: String,
    platform: String,
    current_route: String,
    submitted_at: String,
    health_status: String,
    diagnostics_status: String,
    diagnostics_failure_reason: Option<String>,
    last_error: Option<String>,
    active_project_id: Option<String>,
    active_project_rfq_number: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportDiagnosticsBundleRequest {
    context: DiagnosticsContextPayload,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SupportDiagnosticsLogManifestEntry {
    name: String,
    byte_size: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SupportDiagnosticsManifest {
    manifest_version: u32,
    generated_at: String,
    redacted: bool,
    log_file_count: usize,
    omitted_log_file_count: usize,
    context: DiagnosticsContextPayload,
    logs: Vec<SupportDiagnosticsLogManifestEntry>,
}

#[derive(Clone)]
struct SupportDiagnosticsLogCandidate {
    name: String,
    byte_size: usize,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportDiagnosticsBundleResult {
    kind: String,
    name: String,
    mime_type: String,
    byte_size: usize,
    manifest_version: u32,
    log_file_count: usize,
    omitted_log_file_count: usize,
    redacted: bool,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfTextExtractionResult {
    text: String,
    page_count: usize,
}

// The lock is held outside all restorable directories for the application's lifetime.
struct ProfileRuntimeLock {
    _file: fs::File,
    _vault_file: fs::File,
}

struct LocalStartupFailure {
    message: String,
}

fn acquire_profile_runtime_lock(path: &Path) -> Result<fs::File, String> {
    let parent = path.parent().ok_or("Invalid profile lock location.")?;
    fs::create_dir_all(parent).map_err(|error| format!("Create profile lock directory: {error}"))?;
    let file = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(path).map_err(|error| format!("Open profile lock: {error}"))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .map_err(|_| "Kwantflow is already using this local profile. Quit the other Kwantflow window completely, then reopen it.".to_string())?;
    Ok(file)
}

// ── Helpers ──────────────────────────────────────────────────────────

fn document_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if app.config().identifier == "com.kwantflow.desktop" {
        app.path().document_dir().map_err(|e| format!("Failed to get document dir: {e}"))
    } else {
        Ok(app_local_data_root(app)?.join("qa-documents"))
    }
}

#[tauri::command]
fn get_local_documents_root(app: AppHandle) -> Result<String, String> {
    Ok(document_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_local_startup_failure(app: AppHandle) -> Option<String> {
    app.try_state::<LocalStartupFailure>().map(|failure| failure.message.clone())
}

fn app_local_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))
}

fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("Canonicalize path: {}", e))
}

fn resolve_existing_file_path(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err("Selected file does not exist.".to_string());
    }

    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Read metadata: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Err("Symlink files are not allowed.".to_string());
    }
    if !metadata.is_file() {
        return Err("Selected path must be a file.".to_string());
    }

    canonicalize_existing_path(path)
}

fn resolve_allowed_file_path(path: &Path, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Build list of allowed root directories.
    // A file must reside within at least one of these roots to be readable.
    let mut allowed_roots: Vec<PathBuf> = Vec::new();

    // 1. Always allow the user's home directory.
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to resolve home directory: {}", e))?;
    allowed_roots.push(home);

    // 2. Always allow the system temporary directory.
    allowed_roots.push(std::env::temp_dir());

    // 3. On macOS, allow /Volumes so external / removable drives are readable.
    #[cfg(target_os = "macos")]
    allowed_roots.push(PathBuf::from("/Volumes"));

    // 4. On Windows, allow active drive letters D:\ through Z:\ for external / secondary drives.
    #[cfg(target_os = "windows")]
    {
        for c in b'D'..=b'Z' {
            let drive_path = PathBuf::from(format!("{}:\\", c as char));
            if drive_path.exists() {
                allowed_roots.push(drive_path);
            }
        }
    }

    resolve_file_within_roots(path, &allowed_roots)
}

fn resolve_file_within_roots(path: &Path, allowed_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let resolved = resolve_existing_file_path(path)?;
    // Canonicalize both sides so starts_with works
    // after symlink resolution (e.g., /tmp -> /private/tmp on macOS).
    for root in allowed_roots {
        if let Ok(canonical_root) = canonicalize_existing_path(root) {
            if resolved.starts_with(&canonical_root) {
                return Ok(resolved);
            }
        }
    }

    Err("File must be within an allowed directory (home, temp, or external drives).".to_string())
}

fn normalize_safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    // Preserve literal Unix filename characters while reading legacy Windows vault references.
    if raw.starts_with('\\') || (raw.as_bytes().get(1) == Some(&b':') && raw.as_bytes()[0].is_ascii_alphabetic()) {
        return Err("Absolute paths are not allowed.".to_string());
    }
    let normalized_raw = if cfg!(windows) || raw.starts_with("workspaces\\") || raw.starts_with("account\\") {
        raw.replace('\\', "/")
    } else {
        raw.to_string()
    };
    let path = Path::new(&normalized_raw);
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Parent traversal is not allowed.".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute paths are not allowed.".to_string());
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("Path is empty.".to_string());
    }

    Ok(normalized)
}

pub(crate) fn resolve_safe_path_segment(raw: &str, label: &str) -> Result<String, String> {
    if raw.contains('/') || raw.contains('\\') {
        return Err(format!("{} must be a single safe path segment.", label));
    }
    let normalized = normalize_safe_relative_path(raw)?;
    if normalized.components().count() != 1 {
        return Err(format!("{} must be a single safe path segment.", label));
    }

    Ok(normalized.to_string_lossy().to_string())
}

fn resolve_existing_path_within_root(path: &Path, allowed_root: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err("Selected path does not exist.".to_string());
    }

    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Read metadata: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Err("Symlink paths are not allowed.".to_string());
    }

    let canonical_root = canonicalize_existing_path(allowed_root)?;
    let canonical_path = canonicalize_existing_path(path)?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Path is outside the allowed root.".to_string());
    }

    Ok(canonical_path)
}

fn diagnostics_bundle_file_name(submitted_at: &str) -> String {
    let safe_timestamp = submitted_at.replace([':', 'T', '.'], "-");
    format!("kwantflow-diagnostics-{}.zip", safe_timestamp)
}

fn app_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get app log dir: {}", e))
}

fn append_support_log_line(path: &Path, line: &str, max_bytes: u64) {
    let Ok(_guard) = SUPPORT_LOG_WRITE_LOCK.lock() else {
        return;
    };

    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }

    let incoming_bytes = u64::try_from(line.len()).unwrap_or(u64::MAX);
    let existing_bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if existing_bytes > 0 && existing_bytes.saturating_add(incoming_bytes) > max_bytes {
        let Some(file_name) = path.file_name().and_then(OsStr::to_str) else {
            return;
        };
        let rotated_path = path.with_file_name(format!("{file_name}.1"));
        let _ = fs::remove_file(&rotated_path);
        if fs::rename(path, &rotated_path).is_err() {
            return;
        }
    }

    let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = file.write_all(line.as_bytes());
}

fn sorted_log_file_paths(log_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !log_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(log_dir).map_err(|e| format!("Read log dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Read log dir entry: {}", e))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Read log file metadata: {}", e))?;
        if !metadata.is_file() {
            continue;
        }

        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push((path, modified));
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(entries.into_iter().map(|(path, _)| path).collect())
}

fn prune_support_log_retention(app: &tauri::AppHandle) -> Result<(), String> {
    let log_dir = app_log_dir(app)?;
    for path in sorted_log_file_paths(&log_dir)?
        .into_iter()
        .skip(SUPPORT_DIAGNOSTICS_LOG_RETENTION_COUNT)
    {
        fs::remove_file(&path).map_err(|e| format!("Remove old log file: {}", e))?;
    }
    Ok(())
}

fn read_support_log_candidates(
    app: &tauri::AppHandle,
) -> Result<Vec<SupportDiagnosticsLogCandidate>, String> {
    let log_dir = app_log_dir(app)?;
    let mut candidates = Vec::new();

    for path in sorted_log_file_paths(&log_dir)?
        .into_iter()
        .take(SUPPORT_DIAGNOSTICS_LOG_RETENTION_COUNT)
    {
        let bytes = fs::read(&path).map_err(|e| format!("Read log file: {}", e))?;
        let name = path
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or_else(|| "Log file name is not valid UTF-8.".to_string())?
            .to_string();
        candidates.push(SupportDiagnosticsLogCandidate {
            name,
            byte_size: bytes.len(),
            bytes,
        });
    }

    Ok(candidates)
}

fn build_support_diagnostics_manifest(
    context: DiagnosticsContextPayload,
    logs: &[SupportDiagnosticsLogCandidate],
    omitted_log_file_count: usize,
) -> SupportDiagnosticsManifest {
    SupportDiagnosticsManifest {
        manifest_version: SUPPORT_DIAGNOSTICS_MANIFEST_VERSION,
        generated_at: context.submitted_at.clone(),
        redacted: true,
        log_file_count: logs.len(),
        omitted_log_file_count,
        context,
        logs: logs
            .iter()
            .map(|log| SupportDiagnosticsLogManifestEntry {
                name: log.name.clone(),
                byte_size: log.byte_size,
            })
            .collect(),
    }
}

fn encode_support_diagnostics_bundle(
    manifest: &SupportDiagnosticsManifest,
    logs: &[SupportDiagnosticsLogCandidate],
) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("manifest.json", options)
        .map_err(|e| format!("Start diagnostics manifest entry: {}", e))?;
    let manifest_bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Serialize diagnostics manifest: {}", e))?;
    zip.write_all(&manifest_bytes)
        .map_err(|e| format!("Write diagnostics manifest: {}", e))?;

    for log in logs {
        zip.start_file(format!("logs/{}", log.name), options)
            .map_err(|e| format!("Start diagnostics log entry: {}", e))?;
        zip.write_all(&log.bytes)
            .map_err(|e| format!("Write diagnostics log entry: {}", e))?;
    }

    zip.finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|e| format!("Finish diagnostics bundle: {}", e))
}

#[tauri::command]
async fn save_quote_pdf(
    app: tauri::AppHandle,
    rfq_number: String,
    bytes: Vec<u8>,
    open_file: bool,
) -> Result<String, String> {
    let safe_rfq_number = resolve_safe_path_segment(&rfq_number, "RFQ number")?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Downloads dir: {}", e))?;
    let filename = format!("Quote-{}.pdf", safe_rfq_number);
    let out_path = downloads.join(&filename);

    {
        let _file_guard = backup_file_mutation_guard()?;
        fs::write(&out_path, bytes).map_err(|e| format!("Write file: {}", e))?;
    }

    use tauri_plugin_opener::OpenerExt;
    if open_file {
        app.opener()
            .open_path(out_path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|e| format!("Open file: {}", e))?;
    }

    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_quote_xlsx(
    app: tauri::AppHandle,
    rfq_number: String,
    bytes: Vec<u8>,
    open_file: bool,
) -> Result<String, String> {
    let safe_rfq_number = resolve_safe_path_segment(&rfq_number, "RFQ number")?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("Downloads dir: {}", e))?;
    let filename = format!("Quote-{}.xlsx", safe_rfq_number);
    let out_path = downloads.join(&filename);

    {
        let _file_guard = backup_file_mutation_guard()?;
        fs::write(&out_path, bytes).map_err(|e| format!("Write file: {}", e))?;
    }

    use tauri_plugin_opener::OpenerExt;
    if open_file {
        app.opener()
            .open_path(out_path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|e| format!("Open file: {}", e))?;
    }

    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
fn allow_external_file_read(window: tauri::Window, path: String) -> Result<String, String> {
    let resolved = resolve_allowed_file_path(Path::new(&path), window.app_handle())?;
    if let Some(fs_scope) = window.try_fs_scope() {
        fs_scope
            .allow_file(&resolved)
            .map_err(|error| format!("Allow file in fs scope: {}", error))?;
    }

    window
        .state::<tauri::scope::Scopes>()
        .allow_file(&resolved)
        .map_err(|error| format!("Allow file in Tauri scope: {}", error))?;

    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
async fn ingest_file(
    app: tauri::AppHandle,
    project_id: String,
    source_path: String,
) -> Result<String, String> {
    let safe_project_id = resolve_safe_path_segment(&project_id, "Project ID")?;
    let source = resolve_allowed_file_path(Path::new(&source_path), &app)?;

    let runtime = app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before files can be imported.")?;
    let workspace_id = runtime
        .active_workspace_id()
        .await
        .ok_or_else(|| "No active workspace database.".to_string())?;

    // Resolve the active workspace vault. File storage follows the same
    // workspace boundary as SQLite; project IDs alone are not globally unique.
    let document_dir = document_root(&app)?;

    let vault_root = document_dir.join(VAULT_ROOT);
    let relative_directory = PathBuf::from("workspaces")
        .join(&workspace_id)
        .join("vault")
        .join("workspace")
        .join(&safe_project_id);

    let relative_path = tauri::async_runtime::spawn_blocking(move || {
        let _file_guard = backup_file_mutation_guard()?;
        copy_file_into_vault(&source, &vault_root, &relative_directory)
    })
    .await
    .map_err(|error| format!("Import file task failed: {error}"))??;

    // original_name is stored separately; this unique path belongs only to this import.
    #[cfg(windows)]
    return Ok(relative_path.to_string_lossy().replace('\\', "/"));
    #[cfg(not(windows))]
    Ok(relative_path.to_string_lossy().into_owned())
}

fn copy_file_into_vault(
    source: &Path,
    vault_root: &Path,
    relative_directory: &Path,
) -> Result<PathBuf, String> {
    let source = resolve_existing_file_path(source)?;
    let mut input = fs::File::open(&source)
        .map_err(|error| format!("Open import file: {error}"))?;
    let mut directory = resolve_existing_path_within_root(vault_root, vault_root)?;
    for component in relative_directory.components() {
        let Component::Normal(segment) = component else {
            return Err("Import directory must stay inside the local vault.".to_string());
        };
        directory.push(segment);
        match fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("Create import directory: {error}")),
        }
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| format!("Read import directory: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Import directory must be a real directory inside the local vault.".to_string());
        }
    }

    let mut filename = std::ffi::OsString::from(uuid::Uuid::new_v4().to_string());
    if let Some(extension) = source.extension().filter(|extension| !extension.is_empty()) {
        filename.push(".");
        filename.push(extension);
    }
    let destination = directory.join(&filename);
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| format!("Create unique import file: {error}"))?;
    let copied = std::io::copy(&mut input, &mut output)
        .and_then(|_| output.sync_all());
    drop(output);
    if let Err(error) = copied {
        let cleanup = fs::remove_file(&destination);
        return Err(match cleanup {
            Ok(()) => format!("Copy import file: {error}"),
            Err(cleanup_error) => format!("Copy import file: {error}; remove partial import: {cleanup_error}"),
        });
    }
    Ok(relative_directory.join(filename))
}

/// Health check — confirms the Rust backend is responsive.
#[tauri::command]
fn health() -> serde_json::Value {
    serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "build_profile": if cfg!(debug_assertions) { "debug" } else { "release" },
    })
}

#[tauri::command]
fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn emit_native_menu_action(app: &AppHandle, action: &str) {
    let _ = app.emit(NATIVE_APP_MENU_ACTION_EVENT, action);
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        main.show()?;
        main.set_focus()?;
    }

    Ok(())
}

fn log_window_inventory(app: &AppHandle, context: &str) {
    let labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
    let summary = if labels.is_empty() {
        "<none>".to_string()
    } else {
        labels.join(", ")
    };
    log::info!(
        "[tauri] {}: {} registered webview window(s): {}",
        context,
        labels.len(),
        summary
    );
    #[cfg(debug_assertions)]
    debug_stderr(format!(
        "[tauri][debug] {}: {} registered webview window(s): {}",
        context,
        labels.len(),
        summary
    ));
}

#[cfg(debug_assertions)]
fn debug_stderr(message: String) {
    let _ = writeln!(std::io::stderr(), "{message}");
}

fn ensure_main_window_registered(app: &AppHandle) -> Result<bool, String> {
    if app.get_webview_window("main").is_some() {
        return Ok(false);
    }

    let window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| "Main window config is missing.".to_string())?;

    match WebviewWindowBuilder::from_config(app, &window_config)
        .map_err(|error| format!("Create main window builder from config: {}", error))
        .and_then(|builder| {
            builder
                .build()
                .map_err(|error| format!("Build main window from config: {}", error))
        }) {
        Ok(_) => {}
        Err(config_error) => {
            #[cfg(debug_assertions)]
            debug_stderr(format!(
                "[tauri][debug] main window recreation from config failed: {}. Falling back to minimal builder.",
                config_error
            ));

            WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Kwantflow")
                .inner_size(800.0, 600.0)
                .build()
                .map_err(|error| {
                    format!(
                        "Build main window from fallback builder after config failure ({}): {}",
                        config_error, error
                    )
                })?;
        }
    }

    Ok(true)
}

fn apply_vibrancy_to_window(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::Sidebar,
            Some(window_vibrancy::NSVisualEffectState::Active),
            None,
        );
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_mica(window, None);
    }
}

fn recover_main_window(app: &AppHandle, context: &str) -> Result<(), String> {
    log_window_inventory(app, &format!("{context}:before"));

    if ensure_main_window_registered(app)? {
        log::warn!(
            "[tauri] {}: main window was missing from the runtime inventory; recreated it from config.",
            context
        );
        #[cfg(debug_assertions)]
        debug_stderr(format!(
            "[tauri][debug] {}: main window was missing from the runtime inventory; recreated it from config.",
            context
        ));
    }

    if let Some(main) = app.get_webview_window("main") {
        apply_vibrancy_to_window(&main);
    }

    // Do not show the main window during initial setup or run_ready startup hooks.
    // The frontend handles displaying the window once the HTML content and splash screen are ready.
    if context != "setup" && context != "run_ready" {
        show_main_window(app).map_err(|error| error.to_string())?;
    }
    log_window_inventory(app, &format!("{context}:after"));

    Ok(())
}

#[tauri::command]
fn finalize_startup_window(app: AppHandle) -> Result<(), String> {
    log::info!("[tauri] finalize_startup_window invoked.");
    log::info!("[tauri] Ensuring main window is shown and focused.");
    recover_main_window(&app, "finalize_startup_window")?;
    log::info!("[tauri] Main window shown and focused.");

    Ok(())
}

#[tauri::command]
fn retarget_detached_preview_window(
    app: AppHandle,
    route: String,
    title: String,
) -> Result<bool, String> {
    let Some(preview) = app.get_webview_window("asset-preview") else {
        return Ok(false);
    };

    let route_script = serde_json::to_string(&route)
        .map_err(|error| format!("Serialize preview route: {}", error))?;
    preview
        .eval(format!("window.location.replace({route_script});"))
        .map_err(|error| format!("Retarget detached preview window: {}", error))?;
    preview
        .set_title(&title)
        .map_err(|error| format!("Update detached preview title: {}", error))?;
    let _ = preview.unminimize();
    preview
        .show()
        .map_err(|error| format!("Show detached preview window: {}", error))?;
    preview
        .set_focus()
        .map_err(|error| format!("Focus detached preview window: {}", error))?;

    Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalDocumentKind { Help, License, Notices, EmailSetup }

#[tauri::command]
fn open_local_documentation(app: AppHandle, kind: LocalDocumentKind) -> Result<String, String> {
    let relative_path = match kind {
        LocalDocumentKind::Help => "docs/user/README.md",
        LocalDocumentKind::License => "LICENSE",
        LocalDocumentKind::Notices => "THIRD_PARTY_NOTICES.md",
        LocalDocumentKind::EmailSetup => "docs/user/EMAIL_SETUP.md",
    };
    let path = app.path().resource_dir().map_err(|error| error.to_string())?.join(relative_path);
    fs::read_to_string(&path).map_err(|error| format!("Read bundled documentation: {error}"))
}

#[tauri::command]
fn create_support_diagnostics_bundle(
    app: AppHandle,
    request: SupportDiagnosticsBundleRequest,
) -> Result<SupportDiagnosticsBundleResult, String> {
    log::info!("[support] create_support_diagnostics_bundle invoked.");
    prune_support_log_retention(&app)?;
    let candidates = read_support_log_candidates(&app)?;
    let total_candidate_count = candidates.len();
    let mut included = Vec::new();
    let mut omitted_log_file_count = 0;

    for candidate in candidates {
        let mut trial_logs = included.clone();
        trial_logs.push(candidate.clone());
        let manifest = build_support_diagnostics_manifest(
            request.context.clone(),
            &trial_logs,
            total_candidate_count.saturating_sub(trial_logs.len()),
        );
        let bytes = encode_support_diagnostics_bundle(&manifest, &trial_logs)?;
        if bytes.len() <= SUPPORT_DIAGNOSTICS_BUNDLE_MAX_BYTES {
            included = trial_logs;
            omitted_log_file_count = total_candidate_count.saturating_sub(included.len());
        } else {
            omitted_log_file_count += 1;
        }
    }

    let manifest = build_support_diagnostics_manifest(
        request.context.clone(),
        &included,
        omitted_log_file_count,
    );
    let bytes = encode_support_diagnostics_bundle(&manifest, &included)?;
    if bytes.len() > SUPPORT_DIAGNOSTICS_BUNDLE_MAX_BYTES {
        return Err("Diagnostic logs exceeded the upload limit.".to_string());
    }

    log::info!(
        "[support] Diagnostics bundle generated with {} log files ({} omitted).",
        included.len(),
        omitted_log_file_count
    );

    Ok(SupportDiagnosticsBundleResult {
        kind: "diagnostics_bundle".to_string(),
        name: diagnostics_bundle_file_name(&request.context.submitted_at),
        mime_type: "application/zip".to_string(),
        byte_size: bytes.len(),
        manifest_version: SUPPORT_DIAGNOSTICS_MANIFEST_VERSION,
        log_file_count: included.len(),
        omitted_log_file_count,
        redacted: true,
        bytes,
    })
}

#[tauri::command]
fn extract_pdf_text(app: AppHandle, file_path: String) -> Result<PdfTextExtractionResult, String> {
    let normalized = normalize_safe_relative_path(&file_path)?;
    let first_segment = normalized
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .unwrap_or_default();
    let allowed_root = if first_segment == "account" {
        app_local_data_root(&app)?
    } else {
        document_root(&app)?.join(VAULT_ROOT)
    };
    let absolute_path = allowed_root.join(&normalized);
    let resolved = resolve_existing_path_within_root(&absolute_path, &allowed_root)?;
    let pdfium = init_pdfium(&app)?;
    let document = pdfium
        .load_pdf_from_file(&resolved, None)
        .map_err(|error| format!("Load PDF file: {error:?}"))?;
    let page_count = document.pages().len() as usize;
    let mut page_text = Vec::with_capacity(page_count);
    for page_index in 0..page_count {
        let page = document
            .pages()
            .get(page_index as i32)
            .map_err(|error| format!("Get PDF page {}: {error:?}", page_index + 1))?;
        let text = page
            .text()
            .map_err(|error| format!("Extract PDF page {} text: {error:?}", page_index + 1))?
            .all();
        if !text.trim().is_empty() {
            page_text.push(text);
        }
    }
    let text = page_text.join("\n\n");

    Ok(PdfTextExtractionResult { text, page_count })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfPageTextResult {
    page_number: u32,
    text_content: String,
}

#[tauri::command]
fn extract_pdf_pages_text(
    app: AppHandle,
    file_path: String,
) -> Result<Vec<PdfPageTextResult>, String> {
    let normalized = normalize_safe_relative_path(&file_path)?;
    let first_segment = normalized
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .unwrap_or_default();
    let allowed_root = if first_segment == "account" {
        app_local_data_root(&app)?
    } else {
        document_root(&app)?.join(VAULT_ROOT)
    };
    let absolute_path = allowed_root.join(&normalized);
    let resolved = resolve_existing_path_within_root(&absolute_path, &allowed_root)?;

    let pdfium = init_pdfium(&app)?;
    let document = pdfium
        .load_pdf_from_file(&resolved, None)
        .map_err(|error| format!("Load PDF file: {:?}", error))?;

    let total_pages = document.pages().len();
    let mut results = Vec::with_capacity(total_pages as usize);

    for page_index in 0..total_pages {
        let page_num = (page_index + 1) as u32;
        let page = document
            .pages()
            .get(page_index as i32)
            .map_err(|error| format!("Get PDF page {}: {:?}", page_num, error))?;

        let page_text = page
            .text()
            .map_err(|error| format!("Extract PDF page {} text: {error:?}", page_num))?
            .all();

        results.push(PdfPageTextResult {
            page_number: page_num,
            text_content: page_text.trim().to_string(),
        });
    }

    Ok(results)
}

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

fn initialize_once<T, F>(cell: &OnceLock<Result<T, String>>, initializer: F) -> Result<&T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    cell.get_or_init(initializer)
        .as_ref()
        .map_err(ToOwned::to_owned)
}

fn init_pdfium(app: &AppHandle) -> Result<&'static Pdfium, String> {
    initialize_once(&PDFIUM, || load_pdfium(app))
}

fn load_pdfium(app: &AppHandle) -> Result<Pdfium, String> {
    #[cfg(target_os = "windows")]
    let lib_name = "pdfium.dll";
    #[cfg(target_os = "macos")]
    let lib_name = "libpdfium.dylib";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let lib_name = "libpdfium.so";

    // 1. Try resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("local-ai").join("native").join(lib_name);
        if path.exists() {
            if let Ok(bindings) = Pdfium::bind_to_library(path.to_string_lossy().to_string()) {
                return Ok(Pdfium::new(bindings));
            }
        }
    }

    // 2. Try current exe directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let path = exe_dir.join(lib_name);
            if path.exists() {
                if let Ok(bindings) = Pdfium::bind_to_library(path.to_string_lossy().to_string()) {
                    return Ok(Pdfium::new(bindings));
                }
            }
        }
    }

    // 3. Try standard system library search
    #[cfg(debug_assertions)]
    if let Ok(bindings) = Pdfium::bind_to_system_library() {
        return Ok(Pdfium::new(bindings));
    }

    // 4. Try explicit standard developer paths on mac
    #[cfg(all(debug_assertions, target_os = "macos"))]
    for path in &[
        "/opt/homebrew/lib/libpdfium.dylib",
        "/usr/local/lib/libpdfium.dylib",
    ] {
        let p = Path::new(path);
        if p.exists() {
            if let Ok(bindings) = Pdfium::bind_to_library(p.to_string_lossy().to_string()) {
                return Ok(Pdfium::new(bindings));
            }
        }
    }

    Err(format!(
        "Could not locate or load {}. Please verify Pdfium is installed or bundled correctly.",
        lib_name
    ))
}

#[tauri::command]
fn rasterize_pdf_pages(
    app: AppHandle,
    file_path: String,
    pages: Vec<u32>,
) -> Result<Vec<String>, String> {
    let normalized = normalize_safe_relative_path(&file_path)?;
    let first_segment = normalized
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .unwrap_or_default();
    let allowed_root = if first_segment == "account" {
        app_local_data_root(&app)?
    } else {
        document_root(&app)?.join(VAULT_ROOT)
    };
    let absolute_path = allowed_root.join(&normalized);
    let resolved = resolve_existing_path_within_root(&absolute_path, &allowed_root)?;

    let pdfium = init_pdfium(&app)?;
    let document = pdfium
        .load_pdf_from_file(&resolved, None)
        .map_err(|error| format!("Load PDF file: {:?}", error))?;

    let mut base64_pages = Vec::new();
    let total_pages = document.pages().len();

    for page_num in pages {
        if page_num == 0 || page_num > total_pages as u32 {
            return Err(format!(
                "Page number {} is out of bounds (1-{})",
                page_num, total_pages
            ));
        }
        let page_index = page_num - 1;
        let page = document
            .pages()
            .get(page_index as i32)
            .map_err(|error| format!("Get PDF page {}: {:?}", page_num, error))?;

        let width = page.width().value;
        let height = page.height().value;
        let longest_edge = width.max(height);

        let (target_width, target_height) = if longest_edge <= 1280.0 {
            (width as u32, height as u32)
        } else {
            let scale = 1280.0 / longest_edge;
            ((width * scale) as u32, (height * scale) as u32)
        };

        let render_config = PdfRenderConfig::new()
            .set_target_width(target_width as i32)
            .set_maximum_height(target_height as i32);

        let bitmap = page
            .render_with_config(&render_config)
            .map_err(|error| format!("Render PDF page {}: {:?}", page_num, error))?;

        let dynamic_image = bitmap.as_image().map_err(|error| {
            format!("Convert bitmap to image on page {}: {:?}", page_num, error)
        })?;

        let rgb_image = dynamic_image.into_rgb8();
        let mut jpeg_bytes = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_bytes);

        rgb_image
            .write_to(&mut cursor, image::ImageFormat::Jpeg)
            .map_err(|error| format!("Encode JPEG on page {}: {:?}", page_num, error))?;

        use base64::Engine;
        let b64_string = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
        base64_pages.push(b64_string);
    }

    Ok(base64_pages)
}

fn parse_robust_quadrant(input: &str) -> Result<(f32, f32), String> {
    let normalized = input.trim().to_uppercase();

    let mut col_char: Option<char> = None;
    let mut number_start_idx: Option<usize> = None;

    for (i, c) in normalized.char_indices() {
        if c >= 'A' && c <= 'J' {
            col_char = Some(c);
            number_start_idx = Some(i + 1);
            break;
        }
    }

    let col = col_char.ok_or_else(|| "Could not find grid column (A-J) in input.".to_string())?;
    let start = number_start_idx.unwrap();
    if start >= normalized.len() {
        return Err("No row index found after grid column.".to_string());
    }

    let digit_chars: String = normalized[start..]
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();

    if digit_chars.is_empty() {
        return Err("Could not find grid row number (1-10) in input.".to_string());
    }

    let row_num: u32 = digit_chars
        .parse::<u32>()
        .map_err(|_| "Failed to parse grid row number.".to_string())?;

    if row_num < 1 || row_num > 10 {
        return Err(format!(
            "Grid row number {} is out of bounds (1-10).",
            row_num
        ));
    }

    let col_idx = (col as u32 - 'A' as u32) as f32;
    let row_idx = (row_num - 1) as f32;

    Ok((col_idx, row_idx))
}

fn render_pdf_page_at_8k(
    app: &AppHandle,
    resolved_path: &Path,
    page_num: u32,
) -> Result<image::DynamicImage, String> {
    let pdfium = init_pdfium(app)?;
    let document = pdfium
        .load_pdf_from_file(resolved_path, None)
        .map_err(|error| format!("Load PDF file: {:?}", error))?;

    let total_pages = document.pages().len();
    if page_num == 0 || page_num > total_pages as u32 {
        return Err(format!(
            "Page number {} is out of bounds (1-{})",
            page_num, total_pages
        ));
    }
    let page_index = page_num - 1;
    let page = document
        .pages()
        .get(page_index as i32)
        .map_err(|error| format!("Get PDF page {}: {:?}", page_num, error))?;

    let natural_width = page.width().value;
    let natural_height = page.height().value;

    let target_width = 8192.0_f32;
    let scale_factor = target_width / natural_width;
    let target_height = (natural_height * scale_factor) as u32;

    let render_config = PdfRenderConfig::new()
        .set_target_width(target_width as i32)
        .set_maximum_height(target_height as i32);

    let bitmap = page
        .render_with_config(&render_config)
        .map_err(|error| format!("Render PDF page: {:?}", error))?;

    let dynamic_image = bitmap
        .as_image()
        .map_err(|error| format!("Convert bitmap to image: {:?}", error))?;

    Ok(dynamic_image)
}

struct CachedPdfPage {
    file_path: String,
    page_num: u32,
    image: image::DynamicImage,
}

static LAST_RENDERED_PAGE: std::sync::Mutex<Option<CachedPdfPage>> = std::sync::Mutex::new(None);

#[tauri::command]
fn crop_pdf_subquadrant(
    app: AppHandle,
    file_path: String,
    page_num: u32,
    quadrant: String,
) -> Result<String, String> {
    let normalized = normalize_safe_relative_path(&file_path)?;
    let first_segment = normalized
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(segment) => segment.to_str(),
            _ => None,
        })
        .unwrap_or_default();
    let allowed_root = if first_segment == "account" {
        app_local_data_root(&app)?
    } else {
        document_root(&app)?.join(VAULT_ROOT)
    };
    let absolute_path = allowed_root.join(&normalized);
    let resolved = resolve_existing_path_within_root(&absolute_path, &allowed_root)?;

    // Parse the alphanumeric grid quadrant robustly
    let (col_idx, row_idx) = parse_robust_quadrant(&quadrant)?;

    let crop_xmin = col_idx / 10.0;
    let crop_ymin = row_idx / 10.0;
    let crop_width = 0.1;
    let crop_height = 0.1;

    // Retrieve or populate cache
    let dynamic_image = {
        let mut cache = LAST_RENDERED_PAGE
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(ref cached) = *cache {
            if cached.file_path == file_path && cached.page_num == page_num {
                cached.image.clone()
            } else {
                let img = render_pdf_page_at_8k(&app, &resolved, page_num)?;
                *cache = Some(CachedPdfPage {
                    file_path: file_path.clone(),
                    page_num,
                    image: img.clone(),
                });
                img
            }
        } else {
            let img = render_pdf_page_at_8k(&app, &resolved, page_num)?;
            *cache = Some(CachedPdfPage {
                file_path: file_path.clone(),
                page_num,
                image: img.clone(),
            });
            img
        }
    };

    let img_width = dynamic_image.width() as f32;
    let img_height = dynamic_image.height() as f32;

    let crop_x = (crop_xmin * img_width).round() as u32;
    let crop_y = (crop_ymin * img_height).round() as u32;
    let crop_w = (crop_width * img_width).round() as u32;
    let crop_h = (crop_height * img_height).round() as u32;

    let cropped_image = dynamic_image.crop_imm(crop_x, crop_y, crop_w, crop_h);
    let resized_image =
        cropped_image.resize_exact(1024, 1024, image::imageops::FilterType::Lanczos3);

    let rgb_image = resized_image.into_rgb8();
    let mut jpeg_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_bytes);

    rgb_image
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|error| format!("Encode JPEG: {:?}", error))?;

    use base64::Engine;
    let b64_string = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    Ok(b64_string)
}

fn handle_app_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().0.as_str() {
        MENU_ACTION_OPEN_SETTINGS => {
            let _ = show_main_window(app);
            emit_native_menu_action(app, MENU_ACTION_OPEN_SETTINGS);
        }
        MENU_ACTION_OPEN_HELP => {
            let _ = show_main_window(app);
            emit_native_menu_action(app, MENU_ACTION_OPEN_HELP);
        }
        MENU_ACTION_SHOW_MAIN_WINDOW => {
            let _ = show_main_window(app);
            emit_native_menu_action(app, MENU_ACTION_SHOW_MAIN_WINDOW);
        }
        MENU_ACTION_BRING_ALL_TO_FRONT => {
            let _ = show_main_window(app);
        }
        TRAY_ACTION_QUIT => app.exit(0),
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn configure_native_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Kwantflow"))
        .version(Some(env!("CARGO_PKG_VERSION").to_string()))
        .copyright(Some("Copyright © 2026 Mikhail Eremeev and Kwantflow contributors. GPL-3.0-only."))
        .build();

    let settings_item = MenuItem::with_id(
        app,
        MENU_ACTION_OPEN_SETTINGS,
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let help_item = MenuItem::with_id(
        app,
        MENU_ACTION_OPEN_HELP,
        "Kwantflow Help",
        true,
        None::<&str>,
    )?;
    let show_main_window_item = MenuItem::with_id(
        app,
        MENU_ACTION_SHOW_MAIN_WINDOW,
        "Show Kwantflow",
        true,
        None::<&str>,
    )?;
    let bring_all_to_front_item = MenuItem::with_id(
        app,
        MENU_ACTION_BRING_ALL_TO_FRONT,
        "Bring All to Front",
        true,
        None::<&str>,
    )?;
    let app_menu = SubmenuBuilder::new(app, "Kwantflow")
        .about_with_text("About Kwantflow", Some(about_metadata))
        .separator()
        .services()
        .separator()
        .item(&settings_item)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&show_main_window_item)
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .separator()
        .item(&bring_all_to_front_item)
        .item(&show_main_window_item)
        .build()?;
    window_menu.set_as_windows_menu_for_nsapp()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&help_item)
        .build()?;
    help_menu.set_as_help_menu_for_nsapp()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;

    Ok(())
}

pub fn run() {
    // ── Stale harness-log cleanup ─────────────────────────────────────────
    // Harness-safe logging writes to /tmp/kwantflow-harness-logs/. Over many sessions
    // these accumulate. Remove files older than 7 days on every startup.
    {
        let harness_log_dir = std::env::temp_dir().join("kwantflow-harness-logs");
        if harness_log_dir.exists() {
            let cutoff =
                std::time::SystemTime::now() - std::time::Duration::from_secs(7 * 24 * 60 * 60);
            if let Ok(entries) = std::fs::read_dir(&harness_log_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if modified < cutoff {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Global panic hook for diagnostics ─────────────────────────────────
    // The fern logging backend can abort in edge cases while writing to stdout,
    // stderr, or file targets. Keep the panic hook file-only so crash diagnostics
    // never recurse through stdio logging while the app is already panicking.
    std::panic::set_hook(Box::new(move |info| {
        // Write timestamped crash file AND update the quick-access link.
        let crash_dir = std::env::temp_dir();
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let crash_path = crash_dir.join(format!("kwantflow-crash-{}.txt", now_secs));
        let crash_link = crash_dir.join("kwantflow-last-crash.txt");
        let msg = format!("Kwantflow crash at {}s: {}\n", now_secs, info);
        // Best-effort write; ignore errors so we do not double-panic.
        let _ = std::fs::write(&crash_path, &msg);
        let _ = std::fs::write(&crash_link, &msg);
    }));

    let support_log_path = Arc::new(OnceLock::<PathBuf>::new());
    let support_log_target_path = Arc::clone(&support_log_path);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin({
            // ── Log target setup ──────────────────────────────────────────
            // Avoid the plugin's rotating stdout/stderr/LogDir targets: their I/O
            // errors can reach fern::backup_logging and abort the process. The
            // custom dispatch is best-effort, bounded, and never returns an I/O
            // error to fern, while Webview remains the live QA stream.
            let file_dispatch = tauri_plugin_log::fern::Dispatch::new().chain(
                tauri_plugin_log::fern::Output::call(move |record| {
                    let Some(path) = support_log_target_path.get() else {
                        return;
                    };
                    let timestamp = SystemTime::now()
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .map(|duration| duration.as_secs())
                        .unwrap_or(0);
                    let line = format!(
                        "[{timestamp}][{}][{}] {}\n",
                        record.level(),
                        record.target(),
                        record.args()
                    );
                    append_support_log_line(path, &line, SUPPORT_LOG_FILE_MAX_BYTES);
                }),
            );
            let log_targets = vec![
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Dispatch(
                    file_dispatch,
                )),
            ];

            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets(log_targets)
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .level_for("tungstenite", log::LevelFilter::Warn)
                .level_for("tokio_tungstenite", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for(
                    "sqlx::query",
                    if cfg!(debug_assertions) {
                        log::LevelFilter::Info
                    } else {
                        log::LevelFilter::Warn
                    },
                )
                .build()
        });

    let app = builder
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                        let app_handle = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            cleanup_local_ai_runtime(&app_handle).await;
                        });
                    }
                    tauri::WindowEvent::Destroyed => {
                        let app_handle = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            cleanup_local_ai_runtime(&app_handle).await;
                        });
                    }
                    _ => {}
                }
            }
        })
        // App commands are scoped by capability so the main window keeps the full product
        // surface while detached preview stays read-only and cannot invoke mutation workflows.
        .invoke_handler(tauri::generate_handler![
            get_backup_status,
            create_backup_snapshot,
            export_backup_archive,
            inspect_backup_archive,
            stage_backup_restore_from_archive,
            cancel_pending_backup_restore,
            delete_backup_snapshot,
            inspect_backup_snapshot,
            stage_backup_restore_from_snapshot,
            ingest_file,
            health,
            get_local_startup_failure,
            get_local_documents_root,
            generate_uuid,
            allow_external_file_read,
            add_project_command,
            create_project_workspace_command,
            update_project_workspace_command,
            upsert_local_bootstrap_foundation,
            reset_active_workspace_command,
            replace_ai_evidence_refs_command,
            create_asset_from_files_command,
            add_project_file_command,
            delete_file_command,
            search_workspace_history_command,
            describe_workspace_records_command,
            get_workspace_record_command,
            assign_files_to_asset_command,
            merge_assets_command,
            ungroup_asset_command,
            remove_file_from_asset_command,
            add_contact_command,
            update_contact_command,
            execute_approved_contacts_bundle_command,
            write_assistant_action_audit_command,
            execute_approved_record_proposal_set_command,
            create_quote_revision_command,
            delete_quote_option_command,
            delete_catalogue_items_command,
            replace_catalogue_record_company_links_command,
            replace_company_catalogue_links_command,
            set_default_quote_option_command,
            save_estimate_command,
            reset_quote_workspace_command,
            add_project_structure_template_command,
            update_project_structure_template_command,
            apply_project_structure_template_to_project_command,
            apply_setup_import_session_command,
            duplicate_project_records_command,
            create_workspace_command,
            activate_workspace_command,
            delete_workspace_command,
            save_quote_pdf,
            save_quote_xlsx,
            create_support_diagnostics_bundle,
            open_local_documentation,
            finalize_startup_window,
            retarget_detached_preview_window,
            extract_pdf_text,
			extract_pdf_pages_text,
			get_ai_evidence_cache_budget,
			read_ai_evidence_cache_text,
			read_ai_evidence_cache_bytes,
			write_ai_evidence_cache_text,
			write_ai_evidence_cache_bytes,
			set_ai_evidence_cache_pin,
			remove_ai_evidence_cache_prefix,
            rasterize_pdf_pages,
            crop_pdf_subquadrant,
            get_local_ai_capabilities_command,
            get_local_ai_status,
            download_local_ai_model,
            cancel_local_ai_download,
            cancel_local_ai_runtime,
            unload_local_ai_runtime,
            remove_local_ai_model,
            verify_local_ai_install,
            ensure_local_ai_ready,
            probe_local_ai_native_tools,
            run_local_ai_completion,
            run_local_ai_completion_stream,
            abort_active_local_ai_completion,
            evaluate_estimate_expression,
            start_local_ai_conversation,
            send_local_ai_message,
            end_local_ai_conversation,
            get_local_ai_conversation_tokens,
            get_email_provider_settings,
            set_email_provider_settings,
            start_integration_oauth,
            cancel_integration_oauth,
            complete_integration_oauth,
            revoke_integration,
            restore_integrations,
            update_email_connection_settings,
            list_email_rfq_classifications,
            save_email_rfq_classification,
            list_email_messages,
            synchronize_email_messages,
            get_email_message,
            download_email_attachment,
            set_email_message_read_status,
            send_email_message,
            query_control_database,
            execute_control_database,
            query_workspace_database,
            execute_workspace_database,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let lock_parent = config_dir.parent().ok_or_else(|| std::io::Error::other("Invalid profile directory."))?;
            let lock_path = lock_parent.join(format!(".{}.profile-lock", app.config().identifier));
            let profile_lock = acquire_profile_runtime_lock(&lock_path).map_err(std::io::Error::other)?;
            let vault_lock_path = document_root(&app_handle).map_err(std::io::Error::other)?.join(".kwantflow-vault.lock");
            let vault_lock = acquire_profile_runtime_lock(&vault_lock_path).map_err(std::io::Error::other)?;
            app.manage(ProfileRuntimeLock { _file: profile_lock, _vault_file: vault_lock });
			if let Ok(log_dir) = app.path().app_log_dir() {
				let _ = fs::create_dir_all(&log_dir);
				let _ = support_log_path.set(log_dir.join("kwantflow.log"));
			}
			if let Err(error) = prune_ai_evidence_cache_on_startup(&app_handle) {
				log::warn!("[ai-evidence-cache] Startup pruning failed: {error}");
			}

            let database_result: Result<DatabaseRuntime, String> = (|| {
                apply_pending_restore_if_needed(&app_handle)?;
                let control_path = app.path().app_config_dir().map_err(|error| error.to_string())?.join("kwantflow-control.db");
                let local = app_local_data_root(&app_handle)?;
                tauri::async_runtime::block_on(DatabaseRuntime::open(
                    control_path,
                    local.join("workspaces"),
                    local.join("schema-recovery"),
                ))
            })();
            match database_result {
                Ok(database_runtime) => {
                    if let Err(error) = tauri::async_runtime::block_on(
                        sweep_unregistered_ai_evidence_workspaces(&app_handle, &database_runtime),
                    ) {
                        log::warn!("[ai-evidence-cache] Workspace ownership sweep failed: {error}");
                    }
                    app.manage(database_runtime);
                }
                Err(message) => {
                    log::error!("[startup] Local data recovery required: {message}");
                    app.manage(LocalStartupFailure { message });
                }
            }
            app.manage(LocalAiRuntimeManager::default());
            if let Err(error) = validate_manifest_consistency() {
                log::error!("[startup] Manifest consistency check failed: {}", error);
            }
            if let Err(error) = prune_support_log_retention(&app_handle) {
                log::warn!("[support] Failed to prune log retention: {}", error);
            }

            app.on_menu_event(handle_app_menu_event);

            #[cfg(target_os = "macos")]
            {
                configure_native_app_menu(&app_handle)?;
            }

            #[cfg(not(target_os = "macos"))]
            {
                let show_i = tauri::menu::MenuItem::with_id(
                    app,
                    MENU_ACTION_SHOW_MAIN_WINDOW,
                    "Show Kwantflow",
                    true,
                    None::<&str>,
                )?;
                let quit_i = tauri::menu::MenuItem::with_id(
                    app,
                    TRAY_ACTION_QUIT,
                    "Quit",
                    true,
                    None::<&str>,
                )?;
                let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

                let tray_builder = tauri::tray::TrayIconBuilder::new()
                    .menu(&menu)
                    .on_menu_event(handle_app_menu_event);

                let _tray = if let Some(icon) = app.default_window_icon() {
                    tray_builder.icon(icon.clone()).build(app)?
                } else {
                    tray_builder.build(app)?
                };
            }

            if let Err(error) = recover_main_window(&app_handle, "setup") {
                log::error!("[tauri] setup recovery failed: {}", error);
                #[cfg(debug_assertions)]
                debug_stderr(format!("[tauri][debug] setup recovery failed: {}", error));
            }

            #[cfg(debug_assertions)]
            {
                let startup_watchdog_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    for attempt in 1..=20 {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if startup_watchdog_handle.webview_windows().is_empty() {
                            if let Err(error) = recover_main_window(
                                &startup_watchdog_handle,
                                &format!("setup_watchdog_attempt_{attempt}"),
                            ) {
                                debug_stderr(format!(
                                    "[tauri][debug] setup_watchdog_attempt_{} recovery failed: {}",
                                    attempt, error
                                ));
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("kwant-asset", |ctx, request, responder| {
            // "kwant-asset://localhost/workspace/project-id/part.step"
            // the `uri()` will be "kwant-asset://localhost/workspace/project-id/part.step"
            // We strip "kwant-asset://localhost/" and resolve it against the AppData directory.

            let relative_path_str =
                percent_decode_str(request.uri().path().trim_start_matches('/'))
                    .decode_utf8_lossy()
                    .to_string();

            let vault_root = match document_root(ctx.app_handle()) {
                Ok(dir) => dir.join(VAULT_ROOT),
                Err(e) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(500)
                            .body(format!("Failed to get vault root: {}", e).into_bytes())
                            .unwrap(),
                    );
                    return;
                }
            };

            let relative_path = match normalize_safe_relative_path(&relative_path_str) {
                Ok(path) => path,
                Err(error) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(403)
                            .body(error.into_bytes())
                            .unwrap(),
                    );
                    return;
                }
            };

            let is_allowed_asset_path = relative_path
                .components()
                .next()
                .map(|component| component == Component::Normal(OsStr::new("workspaces")))
                .unwrap_or(false);
            if !is_allowed_asset_path {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(403)
                        .body(
                            "Only allowed image vault paths are allowed."
                                .as_bytes()
                                .to_vec(),
                        )
                        .unwrap(),
                );
                return;
            }

            let vault_path = match document_root(ctx.app_handle()) {
                Ok(dir) => dir.join(VAULT_ROOT).join(&relative_path),
                Err(error) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(500)
                            .body(error.into_bytes())
                            .unwrap(),
                    );
                    return;
                }
            };

            let absolute_path = match resolve_existing_path_within_root(&vault_path, &vault_root) {
                Ok(path) => path,
                Err(error) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(403)
                            .body(error.into_bytes())
                            .unwrap(),
                    );
                    return;
                }
            };

            match std::fs::read(&absolute_path) {
                Ok(data) => {
                    let mime_type = match absolute_path.extension().and_then(|ext| ext.to_str()) {
                        Some("png") => "image/png",
                        Some("jpg") | Some("jpeg") => "image/jpeg",
                        Some("svg") => "image/svg+xml",
                        Some("webp") => "image/webp",
                        Some("gif") => "image/gif",
                        Some("bmp") => "image/bmp",
                        _ => {
                            responder.respond(
                                tauri::http::Response::builder()
                                    .status(415)
                                    .body(
                                        "Only image assets are allowed through kwant-asset."
                                            .as_bytes()
                                            .to_vec(),
                                    )
                                    .unwrap(),
                            );
                            return;
                        }
                    };

                    responder.respond(
                        tauri::http::Response::builder()
                            .status(200)
                            .header("Cache-Control", "no-store")
                            .header("Content-Type", mime_type)
                            .header("X-Content-Type-Options", "nosniff")
                            .body(data)
                            .unwrap(),
                    );
                }
                Err(e) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(404)
                            .body(format!("File not found: {}", e).into_bytes())
                            .unwrap(),
                    );
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // ── Startup diagnostics ────────────────────────────────────────────
    // Log the boot configuration so every session leaves a trace of its mode.
    log::info!(
        "boot: mode={} log_target=webview+bounded_file log_level={} rust_version={}",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "info"
        },
        option_env!("CARGO_PKG_RUST_VERSION").unwrap_or("unknown"),
    );

    app.run(|app_handle, event| match event {
        RunEvent::Ready => {
            if let Err(error) = recover_main_window(app_handle, "run_ready") {
                log::error!("[tauri] run_ready recovery failed: {}", error);
                #[cfg(debug_assertions)]
                debug_stderr(format!(
                    "[tauri][debug] run_ready recovery failed: {}",
                    error
                ));
            }
        }
        RunEvent::Exit | RunEvent::ExitRequested { .. } => {
            tauri::async_runtime::block_on(cleanup_local_ai_runtime(app_handle));
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_profile_runtime_lock,
        append_support_log_line, copy_file_into_vault, initialize_once,
        normalize_safe_relative_path, resolve_existing_file_path, resolve_file_within_roots,
        resolve_existing_path_within_root, resolve_safe_path_segment,
    };
    use crate::ai_evidence_cache::{
        plan_ai_evidence_cache_evictions, validate_ai_evidence_cache_relative_path,
    };
    use pdfium_render::prelude::Pdfium;
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::SystemTime;

    #[test]
    #[ignore = "subprocess helper, invoked by profile_runtime_lock_excludes_other_processes"]
    fn profile_runtime_lock_subprocess_probe() {
        let Ok(path) = std::env::var("KWANTFLOW_TEST_PROFILE_LOCK_PATH") else { return; };
        let expected_locked = std::env::var("KWANTFLOW_TEST_PROFILE_IS_LOCKED").unwrap() == "1";
        assert_eq!(acquire_profile_runtime_lock(Path::new(&path)).is_err(), expected_locked);
    }

    #[test]
    fn profile_runtime_lock_excludes_other_processes() {
        let directory = std::env::temp_dir().join(format!("kwantflow-profile-lock-{}", uuid::Uuid::new_v4()));
        let path = directory.join("profile.lock");
        let lock = acquire_profile_runtime_lock(&path).unwrap();
        let probe = |expected_locked: bool| {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "tests::profile_runtime_lock_subprocess_probe", "--ignored"])
                .env("KWANTFLOW_TEST_PROFILE_LOCK_PATH", &path)
                .env("KWANTFLOW_TEST_PROFILE_IS_LOCKED", if expected_locked { "1" } else { "0" })
                .status().unwrap();
            assert!(status.success());
        };
        probe(true);
        drop(lock);
        probe(false);
        fs::remove_dir_all(directory).unwrap();
    }

    fn temp_path(label: &str) -> PathBuf {
        let root = std::env::temp_dir()
            .join("kwantflow-security-tests")
            .join(format!("{}-{}", label, uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn support_log_writer_appends_and_rotates_without_fern_io_errors() {
        let root = temp_path("support-log-writer");
        let path = root.join("kwantflow.log");

        append_support_log_line(&path, "first\n", 10);
        append_support_log_line(&path, "second\n", 10);

        assert_eq!(fs::read_to_string(&path).unwrap(), "second\n");
        assert_eq!(
            fs::read_to_string(root.join("kwantflow.log.1")).unwrap(),
            "first\n"
        );
    }

    #[test]
    fn support_log_writer_fails_closed_when_parent_is_not_a_directory() {
        let root = temp_path("support-log-invalid-parent");
        let blocked_parent = root.join("blocked");
        fs::write(&blocked_parent, "not a directory").unwrap();

        append_support_log_line(&blocked_parent.join("kwantflow.log"), "line\n", 10);

        assert!(blocked_parent.is_file());
    }

    #[test]
    fn normalize_safe_relative_path_rejects_traversal() {
        assert!(normalize_safe_relative_path("../secret.txt").is_err());
        assert!(normalize_safe_relative_path("/tmp/secret.txt").is_err());
        assert!(normalize_safe_relative_path("workspaces\\id\\..\\secret.txt").is_err());
        assert!(normalize_safe_relative_path("C:\\secret.txt").is_err());
        assert!(normalize_safe_relative_path("\\\\server\\share\\secret.txt").is_err());
        assert_eq!(normalize_safe_relative_path("workspaces\\id\\vault\\part.step").unwrap(), Path::new("workspaces/id/vault/part.step"));
    }

    #[test]
    #[cfg(unix)]
    fn local_vault_paths_preserve_literal_backslashes_in_unix_filenames() {
        let directory = tempfile::tempdir().unwrap();
        let relative = normalize_safe_relative_path("workspaces/id/vault/part\\A.step").unwrap();
        let target = directory.path().join(&relative);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, b"fixture").unwrap();
        assert_eq!(fs::read(directory.path().join(relative)).unwrap(), b"fixture");
        assert_eq!(target.file_name().unwrap(), "part\\A.step");
    }

    #[test]
    fn vault_imports_preserve_same_named_and_legacy_attachments() {
        let root = tempfile::tempdir().unwrap();
        let vault = root.path().join("vault");
        let relative = Path::new("workspaces/ws/vault/workspace/project");
        fs::create_dir_all(vault.join(relative)).unwrap();
        let legacy = vault.join(relative).join("part.step");
        fs::write(&legacy, b"previous attachment").unwrap();
        let first_source = root.path().join("supplier-a").join("part.step");
        let second_source = root.path().join("supplier-b").join("part.step");
        fs::create_dir_all(first_source.parent().unwrap()).unwrap();
        fs::create_dir_all(second_source.parent().unwrap()).unwrap();
        fs::write(&first_source, b"supplier A").unwrap();
        fs::write(&second_source, b"supplier B").unwrap();

        let first = copy_file_into_vault(&first_source, &vault, relative).unwrap();
        let second = copy_file_into_vault(&second_source, &vault, relative).unwrap();
        let repeated = copy_file_into_vault(&first_source, &vault, relative).unwrap();
        assert_ne!(first, second);
        assert_ne!(first, repeated);
        assert_eq!(first.extension().unwrap(), "step");
        assert_eq!(fs::read(vault.join(&first)).unwrap(), b"supplier A");
        assert_eq!(fs::read(vault.join(&second)).unwrap(), b"supplier B");
        fs::remove_file(vault.join(repeated)).unwrap();
        assert_eq!(fs::read(vault.join(first)).unwrap(), b"supplier A");
        assert_eq!(fs::read(legacy).unwrap(), b"previous attachment");
    }

    #[test]
    fn vault_imports_reject_invalid_sources_without_creating_attachments() {
        let root = tempfile::tempdir().unwrap();
        let vault = root.path().join("vault");
        fs::create_dir(&vault).unwrap();
        assert!(copy_file_into_vault(root.path(), &vault, Path::new("project")).is_err());
        assert!(copy_file_into_vault(&root.path().join("missing.pdf"), &vault, Path::new("project")).is_err());
        assert_eq!(fs::read_dir(vault).unwrap().count(), 0);
    }

    #[test]
    fn vault_imports_reject_parent_traversal_without_writing_a_file() {
        let root = tempfile::tempdir().unwrap();
        let vault = root.path().join("vault");
        fs::create_dir(&vault).unwrap();
        let source = root.path().join("drawing.pdf");
        fs::write(&source, b"fixture").unwrap();
        assert!(copy_file_into_vault(&source, &vault, Path::new("../outside")).is_err());
        assert_eq!(fs::read_dir(vault).unwrap().count(), 0);
    }

    #[test]
    #[cfg(unix)]
    fn vault_imports_reject_symlink_directories_before_writing_outside_the_vault() {
        let root = tempfile::tempdir().unwrap();
        let vault = root.path().join("vault");
        let outside = root.path().join("outside");
        fs::create_dir(&vault).unwrap();
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, vault.join("workspaces")).unwrap();
        let source = root.path().join("drawing.pdf");
        fs::write(&source, b"fixture").unwrap();
        assert!(copy_file_into_vault(&source, &vault, Path::new("workspaces/ws")).is_err());
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
    }

    #[test]
    fn ai_evidence_cache_paths_are_confined_to_the_cache_namespace() {
        assert!(validate_ai_evidence_cache_relative_path(
            "ai-evidence/workspace-1/file-1/hash/text.json"
        )
        .is_ok());
        assert!(validate_ai_evidence_cache_relative_path("../ai-evidence/secret").is_err());
        assert!(validate_ai_evidence_cache_relative_path("generated-previews/file").is_err());
        assert!(validate_ai_evidence_cache_relative_path("ai-evidence\\..\\secret").is_err());
    }

    #[test]
    fn ai_evidence_cache_pruning_accounts_for_incoming_bytes_and_active_pins() {
        let old = PathBuf::from("/cache/old");
        let pinned = PathBuf::from("/cache/pinned");
        let incoming = PathBuf::from("/cache/new");
        let files = vec![
            (old.clone(), 40, SystemTime::UNIX_EPOCH),
            (
                pinned.clone(),
                40,
                SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1),
            ),
        ];
        let pins = HashSet::from([pinned.clone()]);
        assert_eq!(
            plan_ai_evidence_cache_evictions(&files, &incoming, 30, 70, &pins),
            Some(vec![old])
        );
        assert_eq!(
            plan_ai_evidence_cache_evictions(&files, &incoming, 80, 70, &pins),
            None
        );
        assert_eq!(
            plan_ai_evidence_cache_evictions(&files, &incoming, 60, 70, &pins),
            None
        );
    }

    #[test]
    fn resolve_safe_path_segment_rejects_malicious_inputs() {
        // Traversal
        assert!(resolve_safe_path_segment("../evil", "test").is_err());
        assert!(resolve_safe_path_segment("..", "test").is_err());

        // Multiple segments
        assert!(resolve_safe_path_segment("evil/sub", "test").is_err());

        // Absolute/Root
        assert!(resolve_safe_path_segment("/evil", "test").is_err());

        // Empty/Current
        assert!(resolve_safe_path_segment("", "test").is_err());
        assert!(resolve_safe_path_segment(".", "test").is_err());

        // Valid
        assert_eq!(
            resolve_safe_path_segment("valid-rfq-123", "test").unwrap(),
            "valid-rfq-123"
        );
    }

    #[test]
    fn resolve_existing_path_within_root_allows_in_root_files() {
        let root = temp_path("workspace-root");
        let file_path = root.join("workspace").join("project-1").join("drawing.pdf");
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(&file_path, b"ok").unwrap();

        let resolved = resolve_existing_path_within_root(&file_path, &root).unwrap();
        assert_eq!(resolved, file_path.canonicalize().unwrap());
    }

    #[test]
    fn resolve_existing_path_within_root_rejects_symlinks_that_escape_root() {
        let root = temp_path("workspace-symlink");
        let workspace_root = root.join("workspace");
        fs::create_dir_all(&workspace_root).unwrap();

        let outside = temp_path("outside-target").join("secret.txt");
        fs::write(&outside, b"secret").unwrap();

        let symlink_path = workspace_root.join("linked.txt");
        create_test_symlink(&outside, &symlink_path);

        assert!(resolve_existing_path_within_root(&symlink_path, &workspace_root).is_err());
    }

    #[test]
    fn resolve_existing_file_path_rejects_directories_and_symlinks() {
        let root = temp_path("ingest-source");
        let directory_path = root.join("folder");
        fs::create_dir_all(&directory_path).unwrap();
        assert!(resolve_existing_file_path(&directory_path).is_err());

        let outside = temp_path("ingest-outside").join("drawing.pdf");
        fs::write(&outside, b"secret").unwrap();
        let symlink_path = root.join("linked.pdf");
        create_test_symlink(&outside, &symlink_path);

        assert!(resolve_existing_file_path(&symlink_path).is_err());
    }

    #[test]
    fn file_read_roots_allow_selected_local_files_and_reject_outside_files() {
        let root = temp_path("approved-import-root");
        let allowed = root.join("allowed");
        fs::create_dir_all(&allowed).unwrap();
        let selected = allowed.join("drawing.step");
        fs::write(&selected, b"selected drawing").unwrap();
        let outside = root.join("outside.step");
        fs::write(&outside, b"outside drawing").unwrap();
        assert_eq!(
            resolve_file_within_roots(&selected, std::slice::from_ref(&allowed)).unwrap(),
            fs::canonicalize(&selected).unwrap()
        );
        assert!(resolve_file_within_roots(&outside, &[allowed]).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    fn create_test_symlink(target: &PathBuf, link: &PathBuf) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn create_test_symlink(target: &PathBuf, link: &PathBuf) {
        std::os::windows::fs::symlink_file(target, link).unwrap();
    }

    #[test]
    fn initialize_once_reuses_the_first_successful_value() {
        let cell = OnceLock::new();
        let first = initialize_once(&cell, || Ok::<_, String>(42)).unwrap();
        let second = initialize_once(&cell, || Err("initializer ran twice".to_string())).unwrap();

        assert_eq!(*first, 42);
        assert!(std::ptr::eq(first, second));
    }

    #[test]
    fn test_rasterize_pdf_sample_specification() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let pdf_path = manifest_dir
            .parent()
            .unwrap()
            .join("tests/fixtures/local-ai-benchmark/source/pdf/sample-specification.pdf");
        assert!(
            pdf_path.exists(),
            "Sample PDF path does not exist: {:?}",
            pdf_path
        );

        let library = Pdfium::pdfium_platform_library_name_at_path(
            &manifest_dir.join("native-runtime"),
        );
        let bindings = Pdfium::bind_to_library(library)
            .expect("Bundled Pdfium must bind for native PDF evidence tests");
        {
            let pdfium = pdfium_render::prelude::Pdfium::new(bindings);
            let document = pdfium.load_pdf_from_file(&pdf_path, None).unwrap();
            let total_pages = document.pages().len();
            assert_eq!(total_pages, 1);

            let page = document.pages().get(0).unwrap();
            assert!(!page.text().unwrap().all().trim().is_empty());
            let width = page.width().value;
            let height = page.height().value;
            assert!(width > 0.0);
            assert!(height > 0.0);

            let render_config = pdfium_render::prelude::PdfRenderConfig::new()
                .set_target_width(width as i32)
                .set_maximum_height(height as i32);

            let bitmap = page.render_with_config(&render_config).unwrap();
            let dynamic_image = bitmap.as_image().unwrap();
            let rgb_image = dynamic_image.into_rgb8();

            let mut jpeg_bytes = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
            rgb_image
                .write_to(&mut cursor, image::ImageFormat::Jpeg)
                .unwrap();

            assert!(!jpeg_bytes.is_empty());
        }
    }
}
