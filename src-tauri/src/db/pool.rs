use tauri::{AppHandle, Manager};

use super::runtime::{DatabaseRuntime, WorkspacePoolLease};

pub(crate) async fn transactional_sqlite_pool(
    app: &AppHandle,
) -> Result<WorkspacePoolLease, String> {
    app.try_state::<DatabaseRuntime>().ok_or("Local data needs recovery before this action can run.")?.workspace_pool().await
}
