//! Native transactional DB boundary for the desktop runtime.
//!
//! Frontend Kysely remains the query builder. SQL execution and workspace switching are owned by
//! this Rust runtime. Atomic multi-step workflows must be implemented here as typed Tauri commands
//! backed by SQLx transactions.

pub mod assistant_proposals;
pub mod commands;
pub mod helpers;
pub mod ipc;
pub mod pool;
pub mod runtime;
pub mod types;
pub mod workspace;

pub(crate) use ipc::{
    execute_control_database, execute_workspace_database, query_control_database,
    query_workspace_database,
};

pub use assistant_proposals::execute_approved_record_proposal_set_command;
pub use commands::{
    add_contact_command, add_project_command, add_project_file_command,
    add_project_structure_template_command, apply_project_structure_template_to_project_command,
    apply_setup_import_session_command, assign_files_to_asset_command,
    create_asset_from_files_command, create_project_workspace_command,
    create_quote_revision_command, delete_catalogue_items_command, delete_file_command,
    delete_quote_option_command, describe_workspace_records_command,
    duplicate_project_records_command, execute_approved_contacts_bundle_command,
    get_workspace_record_command, merge_assets_command, remove_file_from_asset_command,
    replace_ai_evidence_refs_command, replace_catalogue_record_company_links_command,
    replace_company_catalogue_links_command, reset_quote_workspace_command, save_estimate_command,
    search_workspace_history_command, set_default_quote_option_command, ungroup_asset_command,
    update_contact_command, update_project_structure_template_command,
    update_project_workspace_command, upsert_local_bootstrap_foundation,
    write_assistant_action_audit_command,
};
pub use workspace::{
    activate_workspace_command, create_workspace_command, delete_workspace_command,
    reset_active_workspace_command,
};
