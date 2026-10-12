use std::fs;
use std::path::{Path, PathBuf};

use tauri_build::{AppManifest, Attributes};

#[path = "src/native_runtime_fingerprint.rs"]
mod native_runtime_fingerprint;

const APP_COMMANDS: &[&str] = &[
    "open_local_documentation",
    "get_local_startup_failure",
    "get_local_documents_root",
    "get_email_provider_settings",
    "set_email_provider_settings",
    "query_control_database",
    "execute_control_database",
    "query_workspace_database",
    "execute_workspace_database",
    "get_backup_status",
    "export_backup_archive",
    "inspect_backup_archive",
    "stage_backup_restore_from_archive",
    "cancel_pending_backup_restore",
    "create_backup_snapshot",
    "delete_backup_snapshot",
    "inspect_backup_snapshot",
    "stage_backup_restore_from_snapshot",
    "ingest_file",
    "generate_uuid",
    "allow_external_file_read",
    "add_project_command",
    "create_project_workspace_command",
    "update_project_workspace_command",
    "upsert_local_bootstrap_foundation",
    "reset_active_workspace_command",
    "replace_ai_evidence_refs_command",
    "create_asset_from_files_command",
    "add_project_file_command",
    "delete_file_command",
    "assign_files_to_asset_command",
    "merge_assets_command",
    "ungroup_asset_command",
    "remove_file_from_asset_command",
    "add_contact_command",
    "update_contact_command",
    "write_assistant_action_audit_command",
    "execute_approved_contacts_bundle_command",
    "execute_approved_record_proposal_set_command",
    "create_quote_revision_command",
    "delete_quote_option_command",
    "delete_catalogue_items_command",
    "replace_catalogue_record_company_links_command",
    "replace_company_catalogue_links_command",
    "set_default_quote_option_command",
    "save_estimate_command",
    "reset_quote_workspace_command",
    "add_project_structure_template_command",
    "update_project_structure_template_command",
    "apply_project_structure_template_to_project_command",
    "apply_setup_import_session_command",
    "duplicate_project_records_command",
    "create_workspace_command",
    "activate_workspace_command",
    "delete_workspace_command",
    "save_quote_pdf",
    "create_support_diagnostics_bundle",
    "finalize_startup_window",
    "retarget_detached_preview_window",
    "extract_pdf_text",
    "rasterize_pdf_pages",
    "get_local_ai_capabilities_command",
    "get_local_ai_status",
    "download_local_ai_model",
    "cancel_local_ai_download",
    "cancel_local_ai_runtime",
    "unload_local_ai_runtime",
    "remove_local_ai_model",
    "verify_local_ai_install",
    "ensure_local_ai_ready",
    "probe_local_ai_native_tools",
    "run_local_ai_completion",
    "run_local_ai_completion_stream",
    "abort_active_local_ai_completion",
    "start_local_ai_conversation",
    "send_local_ai_message",
    "end_local_ai_conversation",
    "get_local_ai_conversation_tokens",
    "evaluate_estimate_expression",
    "extract_pdf_pages_text",
    "get_ai_evidence_cache_budget",
    "read_ai_evidence_cache_text",
    "read_ai_evidence_cache_bytes",
    "write_ai_evidence_cache_text",
    "write_ai_evidence_cache_bytes",
    "set_ai_evidence_cache_pin",
    "remove_ai_evidence_cache_prefix",
    "crop_pdf_subquadrant",
    "start_integration_oauth",
    "cancel_integration_oauth",
    "complete_integration_oauth",
    "revoke_integration",
    "restore_integrations",
    "update_email_connection_settings",
    "list_email_rfq_classifications",
    "save_email_rfq_classification",
    "list_email_messages",
    "synchronize_email_messages",
    "get_email_message",
    "download_email_attachment",
    "set_email_message_read_status",
    "send_email_message",
    "save_quote_xlsx",
    "health",
    "search_workspace_history_command",
    "describe_workspace_records_command",
    "get_workspace_record_command",
];

fn main() {
    println!("cargo::rustc-check-cfg=cfg(litert_lm_native)");
    let build_profile = std::env::var("PROFILE").unwrap_or_default();
    let is_release_profile = build_profile == "release";
    // The executable loader and native dispatch both need the exact current inputs.
    // Derived copies are owner-writable so tauri-build can refresh resources later.
    let out_dir = std::env::var("OUT_DIR").expect("Cargo must provide OUT_DIR");
    let out_path = PathBuf::from(out_dir);
    let target_dir = out_path
        .ancestors()
        .nth(3)
        .expect("Cargo OUT_DIR must contain a target profile");
    let native_runtime_dir = Path::new("native-runtime");
    if native_runtime_dir.exists() {
        let entries = fs::read_dir(native_runtime_dir).expect("Cannot read staged native runtime");
        for entry in entries {
            let path = entry
                .expect("Cannot inspect staged native runtime entry")
                .path();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if !matches!(extension, "dylib" | "dll" | "lib") {
                continue;
            }
            let name = path
                .file_name()
                .expect("Native library must have a filename");
            copy_managed_native_library(&path, &target_dir.join(name));
            let resource_dest = target_dir.join("local-ai").join("native").join(name);
            make_managed_native_writable(&resource_dest);
            if !is_release_profile {
                // Release resources are copied by tauri-build from tauri.conf.json.
                copy_managed_native_library(&path, &resource_dest);
            }
        }
    }

    println!("cargo:rerun-if-env-changed=KWANTFLOW_REQUIRE_LITERT_LM_NATIVE");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=native");
    println!("cargo:rerun-if-changed=native/engine.h");
    println!("cargo:rerun-if-changed=native/conversation.h");
    println!("cargo:rerun-if-changed=native/litert_lm_bridge.h");
    println!("cargo:rerun-if-changed=native/litert_lm_bridge_litert.cc");
    println!("cargo:rerun-if-changed=native/litert_lm_bridge_stub.cc");
    println!("cargo:rerun-if-changed=native-runtime");
    println!("cargo:rerun-if-changed=src/native_runtime_fingerprint.rs");

    // The checked-in header and staged native-runtime directory are one atomic,
    // pinned LiteRT-LM v0.16 closure. Build-time overrides would allow compiling
    // against a different ABI than the bundle ships.
    let include_dir = "native";
    let lib_dir = "native-runtime";

    // Check if the local workspace contains a linkable real (non-LFS) native library.
    let has_real_library = {
        let candidates = native_library_candidates(lib_dir, "litert_lm_c");
        let existing_candidate = candidates.iter().find(|candidate| candidate.exists());
        let exists = existing_candidate.is_some_and(|candidate| !is_git_lfs_pointer(candidate));
        exists
            && Path::new(&include_dir).join("engine.h").exists()
            && Path::new(&include_dir).join("conversation.h").exists()
    };

    let explicit_native_env = std::env::var("KWANTFLOW_REQUIRE_LITERT_LM_NATIVE").ok();
    let require_native_litert = if is_release_profile {
        if explicit_native_env.as_deref() == Some("0") {
            panic!("Release builds cannot disable the native LiteRT-LM engine.");
        }
        true
    } else if let Some(val) = explicit_native_env.as_deref() {
        val == "1"
    } else {
        // Auto-detect based on presence of real native library files.
        // This ensures local development (tauri dev) uses the native GPU engine automatically
        // when the real library is placed in native-runtime/.
        has_real_library
    };

    if require_native_litert {
        let engine_header = Path::new(&include_dir).join("engine.h");
        if !engine_header.exists() {
            panic!(
                "LiteRT-LM include directory must contain engine.h: {}",
                engine_header.display()
            );
        }
        let conversation_header = Path::new(&include_dir).join("conversation.h");
        if !conversation_header.exists() {
            panic!(
                "LiteRT-LM include directory must contain conversation.h: {}",
                conversation_header.display()
            );
        }
        if !Path::new(&lib_dir).exists() {
            panic!("LiteRT-LM library directory does not exist: {lib_dir}");
        }
        let candidates = native_library_candidates(lib_dir, "litert_lm_c");
        let existing_candidate = candidates.iter().find(|candidate| candidate.exists());
        if let Some(candidate) = existing_candidate {
            if is_git_lfs_pointer(candidate) {
                panic!(
                    "LiteRT-LM native library is still a Git LFS pointer, not a real binary: {}",
                    candidate.display()
                );
            }
        } else {
            panic!(
                "native-runtime must contain a linkable LiteRT-LM C API library: {}",
                candidates
                    .iter()
                    .map(|candidate| candidate.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }

    let mut bridge = cc::Build::new();
    bridge.cpp(true).std("c++17");

    if require_native_litert {
        println!("cargo:rustc-cfg=litert_lm_native");
        bridge
            .include(&include_dir)
            .include("native")
            .file("native/litert_lm_bridge_litert.cc");
        println!("cargo:rustc-link-search=native={lib_dir}");
        if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("macos") {
            println!(
                "cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources/local-ai/native"
            );
            // In dev mode the dylib is copied next to the binary in target/debug/,
            // so add @executable_path/ as an additional search path.
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/");
        }
        println!("cargo:rustc-link-lib=litert_lm_c");
    } else {
        bridge.include("native");
        bridge.file("native/litert_lm_bridge_stub.cc");
    }

    bridge.compile("kwantflow_litert_lm_bridge");

    let native_fingerprint = if require_native_litert {
        native_runtime_fingerprint::fingerprint_native_runtime(Path::new("."))
            .expect("Cannot fingerprint the staged native runtime and bridge")
    } else {
        "unknown".to_string()
    };
    println!("cargo:rustc-env=KWANTFLOW_NATIVE_RUNTIME_SHA256={native_fingerprint}");

    let attributes = Attributes::new().app_manifest(AppManifest::new().commands(APP_COMMANDS));
    if let Err(error) = tauri_build::try_build(attributes) {
        eprintln!("failed to run tauri build script:\n{error:#}");
        std::process::exit(1);
    }
}

fn native_library_candidates(lib_dir: &str, lib_name: &str) -> Vec<PathBuf> {
    let normalized_name = lib_name
        .trim()
        .strip_prefix("lib")
        .unwrap_or_else(|| lib_name.trim());
    [
        format!("lib{normalized_name}.dylib"),
        format!("lib{normalized_name}.a"),
        format!("{normalized_name}.dylib"),
        format!("{normalized_name}.a"),
        format!("{normalized_name}.lib"),
        format!("lib{normalized_name}.lib"),
        format!("{normalized_name}.dll"),
        format!("lib{normalized_name}.dll"),
    ]
    .into_iter()
    .map(|file_name| Path::new(lib_dir).join(file_name))
    .collect()
}

fn is_git_lfs_pointer(path: &Path) -> bool {
    fs::read_to_string(path)
        .map(|source| source.starts_with("version https://git-lfs.github.com/spec/v1"))
        .unwrap_or(false)
}

fn make_managed_native_writable(path: &Path) {
    if !path.exists() {
        return;
    }
    let mut permissions = fs::metadata(path)
        .expect("Cannot inspect derived native library permissions")
        .permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(permissions.mode() | 0o200);
    }
    #[cfg(not(unix))]
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions)
        .expect("Cannot make derived native library owner-writable");
}

fn copy_managed_native_library(source: &Path, destination: &Path) {
    fs::create_dir_all(
        destination
            .parent()
            .expect("Native destination requires a parent"),
    )
    .expect("Cannot create derived native runtime directory");
    make_managed_native_writable(destination);
    fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "Cannot stage native library {} to {}: {error}",
            source.display(),
            destination.display()
        )
    });
    make_managed_native_writable(destination);
}
