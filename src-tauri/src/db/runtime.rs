use futures_util::{future::BoxFuture, stream::BoxStream};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Either, Execute, Executor, SqlStr, Sqlite, SqlitePool,
};
use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{OwnedRwLockReadGuard, RwLock};

pub(crate) const CONTROL_SCHEMA_VERSION: i64 = 2;
pub(crate) const WORKSPACE_SCHEMA_VERSION: i64 = 2;

#[derive(Clone, Debug)]
struct WorkspaceConnection {
    id: String,
    pool: SqlitePool,
}

pub struct DatabaseRuntime {
    control: SqlitePool,
    active_workspace: Arc<RwLock<Option<WorkspaceConnection>>>,
}

#[derive(Debug)]
pub(crate) struct WorkspacePoolLease {
    pool: SqlitePool,
    _guard: OwnedRwLockReadGuard<Option<WorkspaceConnection>>,
}

impl std::ops::Deref for WorkspacePoolLease {
    type Target = SqlitePool;

    fn deref(&self) -> &Self::Target {
        &self.pool
    }
}

impl<'c> Executor<'c> for &'c WorkspacePoolLease {
    type Database = Sqlite;

    fn fetch_many<'e, 'q: 'e, E>(
        self,
        query: E,
    ) -> BoxStream<
        'e,
        Result<Either<sqlx::sqlite::SqliteQueryResult, sqlx::sqlite::SqliteRow>, sqlx::Error>,
    >
    where
        'c: 'e,
        E: 'q + Execute<'q, Self::Database>,
    {
        (&self.pool).fetch_many(query)
    }

    fn fetch_optional<'e, 'q: 'e, E>(
        self,
        query: E,
    ) -> BoxFuture<'e, Result<Option<sqlx::sqlite::SqliteRow>, sqlx::Error>>
    where
        'c: 'e,
        E: 'q + Execute<'q, Self::Database>,
    {
        (&self.pool).fetch_optional(query)
    }

    fn prepare_with<'e>(
        self,
        sql: SqlStr,
        parameters: &'e [sqlx::sqlite::SqliteTypeInfo],
    ) -> BoxFuture<'e, Result<sqlx::sqlite::SqliteStatement, sqlx::Error>>
    where
        'c: 'e,
    {
        (&self.pool).prepare_with(sql, parameters)
    }
}

impl DatabaseRuntime {
    pub async fn open(
        control_path: PathBuf,
        workspace_root: PathBuf,
        recovery_root: PathBuf,
    ) -> Result<Self, String> {
        if control_path.is_file() {
            migrate_and_validate_local_databases(&control_path, &workspace_root, &recovery_root)
                .await?;
        } else {
            validate_empty_new_profile(&control_path, &workspace_root, &recovery_root)?;
        }
        let control = open_pool(&control_path, true).await?;
        prepare_control_schema(&control).await?;
        assert_database_integrity(&control, "control").await?;
        Ok(Self {
            control,
            active_workspace: Arc::new(RwLock::new(None)),
        })
    }

    pub fn control_pool(&self) -> SqlitePool {
        self.control.clone()
    }

    pub async fn workspace_pool(&self) -> Result<WorkspacePoolLease, String> {
        let guard = self.active_workspace.clone().read_owned().await;
        let pool = guard
            .as_ref()
            .map(|workspace| workspace.pool.clone())
            .ok_or_else(|| "No active workspace database.".to_string())?;
        Ok(WorkspacePoolLease {
            pool,
            _guard: guard,
        })
    }

    pub async fn active_workspace_id(&self) -> Option<String> {
        self.active_workspace
            .read()
            .await
            .as_ref()
            .map(|workspace| workspace.id.clone())
    }

    pub(crate) async fn create_workspace_pool(path: &PathBuf) -> Result<SqlitePool, String> {
        if path.exists() {
            return Err(format!(
                "Workspace database already exists at {}.",
                path.display()
            ));
        }
        let pool = open_pool(path, true).await?;
        prepare_workspace_schema(&pool).await?;
        assert_database_integrity(&pool, "workspace").await?;
        Ok(pool)
    }

    pub(crate) async fn open_workspace_pool(path: &PathBuf) -> Result<SqlitePool, String> {
        if !path.is_file() {
            return Err(format!(
                "Registered workspace database is missing at {}.",
                path.display()
            ));
        }
        let pool = open_pool(path, false).await?;
        prepare_workspace_schema(&pool).await?;
        assert_database_integrity(&pool, "workspace").await?;
        Ok(pool)
    }

    pub(crate) async fn activate_workspace_pool(&self, id: String, pool: SqlitePool) {
        let next = WorkspaceConnection { id, pool };
        let previous = self
            .active_workspace
            .clone()
            .write_owned()
            .await
            .replace(next);
        if let Some(previous) = previous {
            previous.pool.close().await;
        }
    }

    pub(crate) async fn clear_active_workspace_pool(&self, expected_id: Option<&str>) {
        let mut guard = self.active_workspace.clone().write_owned().await;
        let should_clear = match (expected_id, guard.as_ref()) {
            (Some(expected), Some(active)) => active.id == expected,
            (Some(_), None) => false,
            (None, Some(_)) => true,
            (None, None) => false,
        };
        if should_clear {
            if let Some(previous) = guard.take() {
                previous.pool.close().await;
            }
        }
    }
}

async fn has_user_tables(pool: &SqlitePool) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Inspect SQLite schema: {error}"))?;
    Ok(count > 0)
}

async fn prepare_control_schema(pool: &SqlitePool) -> Result<(), String> {
    if !has_user_tables(pool).await? {
        let mut tx = pool
            .begin()
            .await
            .map_err(|error| format!("Begin control baseline: {error}"))?;
        sqlx::raw_sql(include_str!("../../migrations-control/001_control.sql"))
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Prepare control database: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit control baseline: {error}"))?;
    }
    let version: i64 = sqlx::query_scalar(
        "SELECT schema_version FROM control_contract_state WHERE id = 'primary' LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Validate control database contract: {error}"))?;
    if version != CONTROL_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported control database schema version {version}; expected {CONTROL_SCHEMA_VERSION}."
        ));
    }
    Ok(())
}

async fn prepare_workspace_schema(pool: &SqlitePool) -> Result<(), String> {
    if !has_user_tables(pool).await? {
        let mut tx = pool
            .begin()
            .await
            .map_err(|error| format!("Begin workspace baseline: {error}"))?;
        sqlx::raw_sql(include_str!("../../migrations-workspace/001_workspace.sql"))
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Prepare workspace database: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("Commit workspace baseline: {error}"))?;
    }
    let version: i64 = sqlx::query_scalar(
        "SELECT schema_version FROM runtime_contract_state WHERE id = 'primary' LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Validate workspace database contract: {error}"))?;
    if version != WORKSPACE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported workspace database schema version {version}; expected {WORKSPACE_SCHEMA_VERSION}."
        ));
    }
    Ok(())
}

pub(crate) async fn assert_database_integrity(
    pool: &SqlitePool,
    label: &str,
) -> Result<(), String> {
    let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Check {label} database integrity: {error}"))?;
    if quick_check != "ok" {
        return Err(format!(
            "{label} database integrity check failed: {quick_check}"
        ));
    }
    let foreign_key_errors: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Check {label} database foreign keys: {error}"))?;
    if foreign_key_errors != 0 {
        return Err(format!(
            "{label} database has {foreign_key_errors} foreign-key violation(s)."
        ));
    }
    Ok(())
}

/// Upgrade only disposable/staged or managed profile databases, before any normal pool opens.
/// Every registered workspace is validated up front; a complete SQLite recovery set is durable
/// before the first transaction. Per-database commits are resumable after an interrupted startup.
pub(crate) async fn migrate_and_validate_local_databases(
    control_path: &Path,
    workspace_root: &Path,
    recovery_root: &Path,
) -> Result<(), String> {
    let control_path = control_path.to_path_buf();
    let workspace_root = workspace_root.to_path_buf();
    let recovery_root = recovery_root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        migrate_profile_databases(&control_path, &workspace_root, &recovery_root)
    })
    .await
    .map_err(|error| format!("Database upgrade worker failed: {error}"))?
}

#[derive(Clone, Copy)]
enum DatabaseKind {
    Control,
    Workspace,
}

impl DatabaseKind {
    fn contract_table(self) -> &'static str {
        match self {
            Self::Control => "control_contract_state",
            Self::Workspace => "runtime_contract_state",
        }
    }

    fn baseline(self) -> &'static str {
        match self {
            Self::Control => include_str!("../../migrations-control/001_control.sql"),
            Self::Workspace => include_str!("../../migrations-workspace/001_workspace.sql"),
        }
    }

    fn legacy_baseline(self) -> &'static str {
        // Immutable synthetic schema-v1 fixtures are the exact supported upgrade source contract.
        match self {
            Self::Control => include_str!("../../../tests/fixtures/db-upgrades/v1/001_control.sql"),
            Self::Workspace => {
                include_str!("../../../tests/fixtures/db-upgrades/v1/001_workspace.sql")
            }
        }
    }

    fn upgrade(self) -> &'static str {
        match self {
            Self::Control => include_str!("../../migrations-control/002_local_open_source.sql"),
            Self::Workspace => include_str!("../../migrations-workspace/002_local_open_source.sql"),
        }
    }
}

fn reject_symlink_components(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("Database upgrade path must not contain parent traversal.".to_string());
        }
        current.push(component.as_os_str());
        // A Windows prefix such as `\\?\C:` is not a file-system object: stat-ing it fails with
        // "Incorrect function". Prefixes and roots cannot be symlinks, so only inspect entries.
        if !matches!(component, std::path::Component::Normal(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Database upgrade path contains a symlink: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect database upgrade path: {error}")),
        }
    }
    Ok(())
}

fn validate_empty_new_profile(
    control_path: &Path,
    workspace_root: &Path,
    recovery_root: &Path,
) -> Result<(), String> {
    reject_symlink_components(control_path)?;
    let config = control_path
        .parent()
        .ok_or("Control database has no parent directory.")?;
    let local = workspace_root
        .parent()
        .ok_or("Workspace root has no parent directory.")?;
    let recovery_error = |path: &Path| {
        format!("Local profile needs recovery: the control database is missing or invalid while managed profile data exists at {}. Existing files were preserved; import a verified backup before continuing.", path.display())
    };
    for path in [
        control_path.to_path_buf(),
        control_path.with_extension("db-wal"),
        control_path.with_extension("db-shm"),
        config.join("store.json"),
    ] {
        reject_symlink_components(&path)?;
        if path
            .try_exists()
            .map_err(|error| format!("Inspect new profile data: {error}"))?
        {
            return Err(recovery_error(&path));
        }
    }
    for path in [
        workspace_root.to_path_buf(),
        recovery_root.to_path_buf(),
        local.join("account"),
        local.join("backup-store"),
    ] {
        reject_symlink_components(&path)?;
        match fs::read_dir(&path) {
            Ok(mut entries) => {
                if entries
                    .next()
                    .transpose()
                    .map_err(|error| format!("Inspect new profile directory: {error}"))?
                    .is_some()
                {
                    return Err(recovery_error(&path));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Inspect local profile before initialization: {error}"
                ))
            }
        }
    }
    Ok(())
}

fn open_upgrade_connection(path: &Path) -> Result<rusqlite::Connection, String> {
    reject_symlink_components(path)?;
    if !path.is_file() {
        return Err(format!(
            "Registered database is missing: {}",
            path.display()
        ));
    }
    let connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Open dedicated database upgrade connection: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(|error| format!("Set database upgrade busy timeout: {error}"))?;
    Ok(connection)
}

fn database_version(connection: &rusqlite::Connection, kind: DatabaseKind) -> Result<i64, String> {
    let version = connection
        .query_row(
            &format!(
                "SELECT schema_version FROM {} WHERE id = 'primary'",
                kind.contract_table()
            ),
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Validate database upgrade contract: {error}"))?;
    if version != 1 && version != 2 {
        return Err(format!("Unsupported database schema version {version}; supported versions are 1 and 2. No data was reset."));
    }
    Ok(version)
}

fn connection_integrity(connection: &rusqlite::Connection) -> Result<(), String> {
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("Check upgrade database integrity: {error}"))?;
    if quick_check != "ok" {
        return Err(format!("Database integrity check failed: {quick_check}"));
    }
    let violations: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Check upgrade database foreign keys: {error}"))?;
    if violations != 0 {
        return Err(format!(
            "Database has {violations} foreign-key violation(s)."
        ));
    }
    Ok(())
}

fn schema_columns(
    connection: &rusqlite::Connection,
) -> Result<
    std::collections::BTreeMap<String, Vec<(String, String, i64, Option<String>, i64)>>,
    String,
> {
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map_err(|error| format!("Inspect upgrade database tables: {error}"))?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Read upgrade database tables: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read upgrade database table name: {error}"))?;
    tables
        .into_iter()
        .map(|table| {
            let mut statement = connection
                .prepare(&format!(
                    "PRAGMA table_info(\"{}\")",
                    table.replace('"', "\"\"")
                ))
                .map_err(|error| format!("Inspect upgrade database columns: {error}"))?;
            let columns = statement
                .query_map([], |row| {
                    Ok((
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .map_err(|error| format!("Read upgrade database columns: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Read upgrade database column: {error}"))?;
            Ok((table, columns))
        })
        .collect()
}

fn validate_database_schema(
    connection: &rusqlite::Connection,
    kind: DatabaseKind,
    version: i64,
) -> Result<(), String> {
    let expected = rusqlite::Connection::open_in_memory()
        .map_err(|error| format!("Create schema validation database: {error}"))?;
    expected
        .execute_batch(if version == 1 {
            kind.legacy_baseline()
        } else {
            kind.baseline()
        })
        .map_err(|error| format!("Load schema validation baseline: {error}"))?;
    if schema_columns(connection)? != schema_columns(&expected)?
        || schema_objects(connection)? != schema_objects(&expected)?
    {
        return Err(format!(
            "Database schema does not match the supported schema v{version}. No data was reset."
        ));
    }
    Ok(())
}

fn schema_objects(
    connection: &rusqlite::Connection,
) -> Result<std::collections::BTreeMap<(String, String, String), String>, String> {
    let mut statement = connection.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name"
    ).map_err(|error| format!("Inspect upgrade database schema objects: {error}"))?;
    let objects = statement
        .query_map([], |row| {
            let sql: String = row.get(3)?;
            // SQLite adds identifier quotes when renaming rebuilt tables. Ignore those quotes
            // and formatting outside string literals, preserving constraints and trigger bodies.
            let mut quoted_literal = false;
            let normalized = sql
                .chars()
                .filter_map(|character| {
                    if character == '\'' {
                        quoted_literal = !quoted_literal;
                        Some(character)
                    } else if quoted_literal {
                        Some(character)
                    } else if character.is_whitespace() || character == '"' {
                        None
                    } else {
                        Some(character.to_ascii_uppercase())
                    }
                })
                .collect();
            Ok(((row.get(0)?, row.get(1)?, row.get(2)?), normalized))
        })
        .map_err(|error| format!("Read upgrade database schema objects: {error}"))?
        .collect::<Result<_, _>>()
        .map_err(|error| format!("Read upgrade database schema object: {error}"));
    objects
}

fn preserved_row_counts(
    connection: &rusqlite::Connection,
    kind: DatabaseKind,
) -> Result<Vec<(String, i64)>, String> {
    let removed_tables = match kind {
        DatabaseKind::Control => &[
            "account_entitlement_cache",
            "background_maintenance_state",
            "install_identity",
        ][..],
        DatabaseKind::Workspace => &[][..],
    };
    schema_columns(connection)?
        .into_keys()
        .filter(|table| !removed_tables.contains(&table.as_str()))
        .map(|table| {
            let count = connection
                .query_row(
                    &format!("SELECT COUNT(*) FROM \"{}\"", table.replace('"', "\"\"")),
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| format!("Count preserved rows in {table}: {error}"))?;
            Ok((table, count))
        })
        .collect()
}

fn migrate_one_database(
    connection: &mut rusqlite::Connection,
    kind: DatabaseKind,
) -> Result<(), String> {
    if database_version(connection, kind)? == 2 {
        validate_database_schema(connection, kind, 2)?;
        return connection_integrity(connection);
    }
    connection_integrity(connection)?;
    validate_database_schema(connection, kind, 1)?;
    apply_database_upgrade(connection, kind, kind.upgrade())
}

fn apply_database_upgrade(
    connection: &mut rusqlite::Connection,
    kind: DatabaseKind,
    upgrade_sql: &str,
) -> Result<(), String> {
    let original_counts = preserved_row_counts(connection, kind)?;
    // This MUST happen on the dedicated connection before BEGIN. Changing this inside a SQLite
    // transaction is ineffective and would cascade-delete business records when rebuilding identity.
    connection
        .pragma_update(None, "foreign_keys", false)
        .map_err(|error| format!("Disable foreign keys for table rebuild: {error}"))?;
    let result = (|| {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| format!("Begin schema v1-to-v2 transaction: {error}"))?;
        transaction
            .execute_batch(upgrade_sql)
            .map_err(|error| format!("Apply schema v1-to-v2 upgrade: {error}"))?;
        if database_version(&transaction, kind)? != 2 {
            return Err("Schema upgrade did not advance its contract atomically.".to_string());
        }
        if preserved_row_counts(&transaction, kind)? != original_counts {
            return Err("Schema upgrade changed preserved business row counts; transaction was rolled back.".to_string());
        }
        validate_database_schema(&transaction, kind, 2)?;
        connection_integrity(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("Commit schema v1-to-v2 upgrade: {error}"))
    })();
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|error| format!("Re-enable foreign keys after schema upgrade: {error}"))?;
    result
}

fn snapshot_upgrade_database(
    connection: &rusqlite::Connection,
    destination: &Path,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Create schema recovery directory: {error}"))?;
    }
    let mut snapshot = rusqlite::Connection::open(destination)
        .map_err(|error| format!("Create schema recovery database: {error}"))?;
    {
        let backup = rusqlite::backup::Backup::new(connection, &mut snapshot)
            .map_err(|error| format!("Start SQLite schema recovery snapshot: {error}"))?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .map_err(|error| format!("Write SQLite schema recovery snapshot: {error}"))?;
    }
    connection_integrity(&snapshot)?;
    snapshot
        .close()
        .map_err(|(_, error)| format!("Close schema recovery database: {error}"))?;
    fs::OpenOptions::new().read(true).write(true).open(destination)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Flush schema recovery database: {error}"))?;
    #[cfg(unix)]
    if let Some(parent) = destination.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Flush schema recovery database directory: {error}"))?;
    }
    Ok(())
}

fn migrate_profile_databases(
    control_path: &Path,
    workspace_root: &Path,
    recovery_root: &Path,
) -> Result<(), String> {
    use fs2::FileExt;
    reject_symlink_components(workspace_root)?;
    reject_symlink_components(recovery_root)?;
    let parent = control_path
        .parent()
        .ok_or("Control database has no parent directory.")?;
    reject_symlink_components(parent)?;
    let lock_path = parent.join(".schema-upgrade.lock");
    reject_symlink_components(&lock_path)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("Open schema upgrade lock: {error}"))?;
    lock.try_lock_exclusive().map_err(|error| {
        format!("Another process is upgrading this profile; close it and retry: {error}")
    })?;

    let mut control = open_upgrade_connection(control_path)?;
    let control_version = database_version(&control, DatabaseKind::Control)?;
    connection_integrity(&control)?;
    validate_database_schema(&control, DatabaseKind::Control, control_version)?;
    let mut statement = control
        .prepare("SELECT id, db_path FROM workspace_registry ORDER BY id")
        .map_err(|error| format!("Read registered workspace upgrade paths: {error}"))?;
    let registry = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Read workspace upgrade registry: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read registered workspace upgrade entry: {error}"))?;
    drop(statement);
    let mut workspaces = Vec::new();
    for (id, relative_path) in registry {
        if id.is_empty()
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            || relative_path != format!("workspaces/{id}/workspace.db")
        {
            return Err(format!(
                "Invalid managed database path for workspace {id}. No data was changed."
            ));
        }
        let path = workspace_root.join(&id).join("workspace.db");
        let connection = open_upgrade_connection(&path)?;
        let version = database_version(&connection, DatabaseKind::Workspace)?;
        connection_integrity(&connection)?;
        validate_database_schema(&connection, DatabaseKind::Workspace, version)?;
        workspaces.push((id, connection, version));
    }
    if control_version == 1 || workspaces.iter().any(|(_, _, version)| *version == 1) {
        let snapshot_root = recovery_root.join(format!("v1-to-v2-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&snapshot_root)
            .map_err(|error| format!("Create complete schema recovery set: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&snapshot_root, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Protect schema recovery directory: {error}"))?;
        }
        snapshot_upgrade_database(&control, &snapshot_root.join("kwantflow-control.db"))?;
        for (id, connection, _) in &workspaces {
            snapshot_upgrade_database(
                connection,
                &snapshot_root
                    .join("workspaces")
                    .join(id)
                    .join("workspace.db"),
            )?;
        }
        #[cfg(unix)]
        if !workspaces.is_empty() {
            fs::File::open(snapshot_root.join("workspaces"))
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("Flush schema recovery workspace directory: {error}"))?;
        }
        let receipt = snapshot_root.join("complete.json");
        fs::write(&receipt, serde_json::to_vec(&serde_json::json!({
            "upgrade": "v1-to-v2", "controlSchemaVersion": control_version,
            "workspaces": workspaces.iter().map(|(id, _, version)| serde_json::json!({"id": id, "schemaVersion": version})).collect::<Vec<_>>()
        })).map_err(|error| format!("Serialize schema recovery receipt: {error}"))?)
            .map_err(|error| format!("Write complete schema recovery receipt: {error}"))?;
        fs::OpenOptions::new().read(true).write(true).open(&receipt)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("Flush schema recovery receipt: {error}"))?;
        #[cfg(unix)]
        for directory in [
            Some(snapshot_root.as_path()),
            Some(recovery_root),
            recovery_root.parent(),
        ]
        .into_iter()
        .flatten()
        {
            fs::File::open(directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("Flush schema recovery directory: {error}"))?;
        }
        // Control upgrades last. A crash leaves the original registry available for resumption.
        for (_, connection, _) in &mut workspaces {
            migrate_one_database(connection, DatabaseKind::Workspace)?;
        }
        migrate_one_database(&mut control, DatabaseKind::Control)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::DatabaseRuntime;
    use std::{sync::Arc, time::Duration};
    use tempfile::tempdir;

    fn legacy_profile(
        root: &std::path::Path,
    ) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root = root.canonicalize().unwrap();
        let control_path = root.join("config/kwantflow-control.db");
        let workspace_root = root.join("local/workspaces");
        let recovery_root = root.join("local/schema-recovery");
        std::fs::create_dir_all(control_path.parent().unwrap()).unwrap();
        let control = rusqlite::Connection::open(&control_path).unwrap();
        control
            .execute_batch(super::DatabaseKind::Control.legacy_baseline())
            .unwrap();
        control.pragma_update(None, "foreign_keys", true).unwrap();
        control.execute_batch("INSERT INTO profile_identity (id, display_name, email, first_name, last_name) VALUES ('primary-profile', 'Sam Owner', 'sam@example.test', 'Sam', 'Owner');
            INSERT INTO control_customer_identity (id, profile_id, display_name, plan_state) VALUES ('primary-customer', 'primary-profile', '精密 Fabrication', 'kwantflow_annual');
            INSERT INTO account_entitlement_cache (account_scope_key, plan_code, trial_started_at, trial_expires_at, lease_expires_at, workspace_limit) VALUES ('hosted-account', 'kwantflow_annual', '2020-01-01', '2020-01-15', '2020-01-15', 1);
            INSERT INTO install_identity (install_id) VALUES ('legacy-device');
            INSERT INTO background_maintenance_state (task_key) VALUES ('legacy-usage');
            INSERT INTO onboarding_state (id, current_step, active_workspace_id, import_decided_at, local_ai_decided_at) VALUES ('primary-onboarding', 'account_link', 'workspace-b', '2026-01-01', '2026-01-01');").unwrap();
        for id in ["workspace-a", "workspace-b"] {
            let path = workspace_root.join(id).join("workspace.db");
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let workspace = rusqlite::Connection::open(path).unwrap();
            workspace
                .execute_batch(super::DatabaseKind::Workspace.legacy_baseline())
                .unwrap();
            workspace.pragma_update(None, "foreign_keys", true).unwrap();
            workspace.execute("INSERT INTO workspace_identity (id, mode, cloud_workspace_id, workspace_link_state, workspace_role, bootstrap_completed_at) VALUES (?1, 'cloud', 'hosted-workspace', 'linked', 'owner', '2026-01-01')", [id]).unwrap();
            workspace.execute("INSERT INTO workspace_members (id, workspace_id, account_id, role, display_name, first_name, last_name, email, is_primary) VALUES ('local-member', ?1, 'hosted-account', 'owner', 'Sam Owner', 'Sam', 'Owner', 'sam@example.test', 1)", [id]).unwrap();
            workspace.execute("INSERT INTO workspace_profile (workspace_id, business_name, business_id_value, logo_file_path, ai_playbook_text) VALUES (?1, '精密 Fabrication', '12345678901', 'logos/logo.png', 'Keep the original playbook')", [id]).unwrap();
            workspace.execute("INSERT INTO material_catalog_items (id, workspace_id, name, unit, default_rate) VALUES ('material', ?1, 'Steel', 'kg', 12.34)", [id]).unwrap();
            workspace.execute("INSERT INTO contacts (id, workspace_id, name, email) VALUES ('contact', ?1, 'Customer', 'customer@example.test')", [id]).unwrap();
            workspace.execute("INSERT INTO projects (id, workspace_id, rfq_number, project_name, contact_id) VALUES ('project', ?1, 'RFQ-42', 'Existing project', 'contact')", [id]).unwrap();
            workspace.execute_batch(r#"INSERT INTO assets (id, project_id, display_name) VALUES ('asset', 'project', 'Drawing');
                INSERT INTO files (id, project_id, asset_id, file_path, original_name, byte_size, content_hash) VALUES ('file', 'project', 'asset', 'workspaces/example/vault/drawing.pdf', 'drawing.pdf', 10, 'preserved-hash');
                INSERT INTO estimates (asset_id, notes) VALUES ('asset', 'Preserve estimate');
                INSERT INTO takeoff_items (id, estimate_asset_id, quantity) VALUES ('takeoff', 'asset', 2);
                INSERT INTO cost_components (id, takeoff_item_id, category, source_type, quantity, unit_rate) VALUES ('component', 'takeoff', 'material', 'manual', 2, 12.34);
                INSERT INTO quote_revisions (id, project_id, revision_number, revision_label, rfq_number_snapshot, business_name_snapshot, currency_code_snapshot, currency_symbol_snapshot, issued_date, valid_until_date, recipient_snapshot_json, package_attachments_json) VALUES ('revision', 'project', 1, 'R1', 'RFQ-42', '精密 Fabrication', 'AUD', '$', '2026-01-01', '2026-02-01', '{"email":"customer@example.test"}', '[{"fileId":"file"}]');
                INSERT INTO quote_revision_options (id, revision_id, label, lead_time, total_amount, line_items_json) VALUES ('revision-option', 'revision', 'Standard', '2 weeks', 27.148, '[{"id":"takeoff","quantity":2}]');
                INSERT INTO ai_runs (id, asset_id, provider, model_id, status, trigger_source, started_at) VALUES ('run', 'asset', 'local_litert_lm', 'model', 'succeeded', 'manual', '2026-01-01');
                INSERT INTO ai_evidence_refs (id, run_id, asset_id, file_id, file_name, quote_path, summary) VALUES ('evidence', 'run', 'asset', 'file', 'drawing.pdf', 'page 1', 'Preserved evidence');"#).unwrap();
            control.execute("INSERT INTO workspace_registry (id, customer_id, display_name, slug, db_path, vault_root_path, is_default) VALUES (?1, 'primary-customer', ?1, ?1, ?2, ?3, ?4)", rusqlite::params![id, format!("workspaces/{id}/workspace.db"), format!("Kwantflow/workspaces/{id}/vault"), i64::from(id == "workspace-a")]).unwrap();
        }
        (control_path, workspace_root, recovery_root)
    }

    #[tokio::test]
    async fn startup_upgrades_all_registered_workspaces_without_cascading_business_data() {
        let root = tempdir().unwrap();
        let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
        let runtime = DatabaseRuntime::open(
            control_path.clone(),
            workspace_root.clone(),
            recovery_root.clone(),
        )
        .await
        .unwrap();
        assert_eq!(runtime.active_workspace_id().await, None);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT schema_version FROM control_contract_state")
                .fetch_one(&runtime.control_pool())
                .await
                .unwrap(),
            2
        );
        let control = super::open_upgrade_connection(&control_path).unwrap();
        let control_tables = super::schema_columns(&control).unwrap();
        for removed in [
            "account_entitlement_cache",
            "background_maintenance_state",
            "install_identity",
        ] {
            assert!(!control_tables.contains_key(removed));
        }
        assert_eq!(
            control
                .query_row("SELECT current_step FROM onboarding_state", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "ready"
        );
        assert_eq!(
            control
                .query_row(
                    "SELECT display_name FROM control_customer_identity",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "精密 Fabrication"
        );
        for id in ["workspace-a", "workspace-b"] {
            let workspace =
                super::open_upgrade_connection(&workspace_root.join(id).join("workspace.db"))
                    .unwrap();
            super::validate_database_schema(&workspace, super::DatabaseKind::Workspace, 2).unwrap();
            super::connection_integrity(&workspace).unwrap();
            assert_eq!(
                workspace
                    .query_row("SELECT id FROM workspace_members", [], |row| row
                        .get::<_, String>(0))
                    .unwrap(),
                "local-member"
            );
            assert_eq!(
                workspace
                    .query_row("SELECT email FROM workspace_members", [], |row| row
                        .get::<_, String>(0))
                    .unwrap(),
                "sam@example.test"
            );
            assert_eq!(
                workspace
                    .query_row(
                        "SELECT total_amount FROM quote_revision_options",
                        [],
                        |row| row.get::<_, f64>(0)
                    )
                    .unwrap(),
                27.148
            );
            assert_eq!(
                workspace
                    .query_row("SELECT content_hash FROM files", [], |row| row
                        .get::<_, String>(0))
                    .unwrap(),
                "preserved-hash"
            );
            assert_eq!(
                workspace
                    .query_row("SELECT COUNT(*) FROM cost_components", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                workspace
                    .query_row("SELECT COUNT(*) FROM ai_evidence_refs", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                workspace
                    .query_row(
                        "SELECT business_id_value FROM workspace_profile",
                        [],
                        |row| row.get::<_, String>(0)
                    )
                    .unwrap(),
                "12345678901"
            );
        }
        let snapshots = std::fs::read_dir(&recovery_root)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(snapshots.len(), 1);
        let snapshot = snapshots[0].path();
        assert!(snapshot.join("complete.json").is_file());
        let old_control =
            super::open_upgrade_connection(&snapshot.join("kwantflow-control.db")).unwrap();
        assert_eq!(
            super::database_version(&old_control, super::DatabaseKind::Control).unwrap(),
            1
        );
        assert_eq!(
            old_control
                .query_row(
                    "SELECT COUNT(*) FROM account_entitlement_cache",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        for id in ["workspace-a", "workspace-b"] {
            let old_workspace = super::open_upgrade_connection(
                &snapshot.join("workspaces").join(id).join("workspace.db"),
            )
            .unwrap();
            assert_eq!(
                super::database_version(&old_workspace, super::DatabaseKind::Workspace).unwrap(),
                1
            );
            assert_eq!(
                old_workspace
                    .query_row("SELECT account_id FROM workspace_members", [], |row| row
                        .get::<_, String>(
                        0
                    ))
                    .unwrap(),
                "hosted-account"
            );
        }
        runtime.control.close().await;
        super::migrate_and_validate_local_databases(&control_path, &workspace_root, &recovery_root)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_dir(&recovery_root).unwrap().count(),
            1,
            "Already upgraded profiles must not create repeated recovery snapshots"
        );
    }

    #[tokio::test]
    async fn missing_control_database_preserves_existing_profile_and_requires_recovery() {
        for evidence in [
            "workspace",
            "settings",
            "avatar",
            "recovery",
            "backup",
            "wal",
            "shm",
        ] {
            let root = tempdir().unwrap();
            let root_path = root.path().canonicalize().unwrap();
            let control_path = root_path.join("config/kwantflow-control.db");
            let workspace_root = root_path.join("local/workspaces");
            let recovery_root = root_path.join("local/schema-recovery");
            let preserved_path = match evidence {
                "workspace" => workspace_root.join("ws/workspace.db"),
                "settings" => root_path.join("config/store.json"),
                "avatar" => root_path.join("local/account/primary/avatar.png"),
                "recovery" => recovery_root.join("prior/kwantflow-control.db"),
                "wal" => control_path.with_extension("db-wal"),
                "shm" => control_path.with_extension("db-shm"),
                _ => root_path.join("local/backup-store/snapshots/prior/manifest.json"),
            };
            std::fs::create_dir_all(preserved_path.parent().unwrap()).unwrap();
            std::fs::write(&preserved_path, b"synthetic existing profile bytes").unwrap();
            let result =
                DatabaseRuntime::open(control_path.clone(), workspace_root, recovery_root).await;
            let error = match result {
                Ok(runtime) => {
                    runtime.control_pool().close().await;
                    panic!("Missing control database must not initialize over {evidence} evidence")
                }
                Err(error) => error,
            };
            assert!(error.contains("recovery"), "{error}");
            assert!(
                !control_path.exists(),
                "A missing registry must remain untouched"
            );
            assert_eq!(
                std::fs::read(preserved_path).unwrap(),
                b"synthetic existing profile bytes"
            );
        }
    }

    #[tokio::test]
    async fn genuinely_empty_profile_can_initialize_with_empty_managed_directories() {
        let root = tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let control_path = root_path.join("config/kwantflow-control.db");
        let workspace_root = root_path.join("local/workspaces");
        let recovery_root = root_path.join("local/schema-recovery");
        for directory in [
            &workspace_root,
            &recovery_root,
            &root_path.join("local/account"),
            &root_path.join("local/backup-store"),
        ] {
            std::fs::create_dir_all(directory).unwrap();
        }
        let runtime = DatabaseRuntime::open(control_path.clone(), workspace_root, recovery_root)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM workspace_registry")
                .fetch_one(&runtime.control_pool())
                .await
                .unwrap(),
            0
        );
        assert!(control_path.is_file());
        runtime.control_pool().close().await;
    }

    #[tokio::test]
    async fn interrupted_profile_upgrade_resumes_from_per_database_versions() {
        let root = tempdir().unwrap();
        let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
        let mut first =
            super::open_upgrade_connection(&workspace_root.join("workspace-a/workspace.db"))
                .unwrap();
        super::migrate_one_database(&mut first, super::DatabaseKind::Workspace).unwrap();
        drop(first);
        super::migrate_and_validate_local_databases(&control_path, &workspace_root, &recovery_root)
            .await
            .unwrap();
        for id in ["workspace-a", "workspace-b"] {
            let workspace =
                super::open_upgrade_connection(&workspace_root.join(id).join("workspace.db"))
                    .unwrap();
            assert_eq!(
                super::database_version(&workspace, super::DatabaseKind::Workspace).unwrap(),
                2
            );
            assert_eq!(
                workspace
                    .query_row("SELECT COUNT(*) FROM projects", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
    }

    #[tokio::test]
    async fn missing_unknown_or_damaged_workspace_blocks_upgrade_before_any_data_changes() {
        for condition in ["missing", "unknown", "foreign_keys", "corrupt"] {
            let root = tempdir().unwrap();
            let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
            let second_path = workspace_root.join("workspace-b/workspace.db");
            match condition {
                "missing" => std::fs::remove_file(&second_path).unwrap(),
                "corrupt" => {
                    std::fs::write(&second_path, b"synthetic corrupt SQLite file").unwrap()
                }
                _ => {
                    let second = super::open_upgrade_connection(&second_path).unwrap();
                    second.pragma_update(None, "foreign_keys", false).unwrap();
                    second
                        .execute(
                            if condition == "unknown" {
                                "UPDATE runtime_contract_state SET schema_version = 99"
                            } else {
                                "UPDATE projects SET contact_id = 'missing-contact'"
                            },
                            [],
                        )
                        .unwrap();
                }
            }
            let error = super::migrate_and_validate_local_databases(
                &control_path,
                &workspace_root,
                &recovery_root,
            )
            .await
            .unwrap_err();
            assert!(error.contains(match condition {
                "missing" => "missing",
                "unknown" => "Unsupported",
                "foreign_keys" => "foreign-key",
                _ => "not a database",
            }));
            assert!(!recovery_root.exists());
            let first =
                super::open_upgrade_connection(&workspace_root.join("workspace-a/workspace.db"))
                    .unwrap();
            assert_eq!(
                super::database_version(&first, super::DatabaseKind::Workspace).unwrap(),
                1
            );
            let control = super::open_upgrade_connection(&control_path).unwrap();
            assert_eq!(
                super::database_version(&control, super::DatabaseKind::Control).unwrap(),
                1
            );
        }
    }

    #[tokio::test]
    async fn unknown_columns_and_failed_recovery_never_remove_local_data() {
        for schema_changed in [false, true] {
            let root = tempdir().unwrap();
            let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
            if schema_changed {
                let first = super::open_upgrade_connection(
                    &workspace_root.join("workspace-a/workspace.db"),
                )
                .unwrap();
                first
                    .execute(
                        "ALTER TABLE workspace_members ADD COLUMN customer_note TEXT",
                        [],
                    )
                    .unwrap();
            } else {
                std::fs::create_dir_all(recovery_root.parent().unwrap()).unwrap();
                std::fs::write(&recovery_root, "occupied").unwrap();
            }
            let error = super::migrate_and_validate_local_databases(
                &control_path,
                &workspace_root,
                &recovery_root,
            )
            .await
            .unwrap_err();
            assert!(error.contains(if schema_changed {
                "schema v1"
            } else {
                "recovery"
            }));
            let control = super::open_upgrade_connection(&control_path).unwrap();
            assert_eq!(
                super::database_version(&control, super::DatabaseKind::Control).unwrap(),
                1
            );
            assert_eq!(
                control
                    .query_row("SELECT COUNT(*) FROM workspace_registry", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                2
            );
        }
    }

    #[tokio::test]
    async fn unknown_triggers_and_missing_indexes_are_rejected_before_upgrade() {
        for sql in [
            "CREATE TRIGGER customer_trigger AFTER UPDATE ON workspace_identity BEGIN UPDATE projects SET project_name = 'changed'; END;",
            "DROP INDEX idx_workspace_members_primary;",
        ] {
            let root = tempdir().unwrap();
            let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
            let workspace_path = workspace_root.join("workspace-a/workspace.db");
            let workspace = super::open_upgrade_connection(&workspace_path).unwrap();
            workspace.execute_batch(sql).unwrap();
            drop(workspace);
            let error = super::migrate_and_validate_local_databases(
                &control_path,
                &workspace_root,
                &recovery_root,
            ).await.unwrap_err();
            assert!(error.contains("schema v1"));
            assert!(!recovery_root.exists());
            let workspace = super::open_upgrade_connection(&workspace_path).unwrap();
            assert_eq!(super::database_version(&workspace, super::DatabaseKind::Workspace).unwrap(), 1);
            assert_eq!(workspace.query_row("SELECT project_name FROM projects", [], |row| row.get::<_, String>(0)).unwrap(), "Existing project");
        }
    }

    #[test]
    fn migration_failure_rolls_back_table_removal_and_version_together() {
        let root = tempdir().unwrap();
        let (control_path, _, _) = legacy_profile(root.path());
        let mut control = super::open_upgrade_connection(&control_path).unwrap();
        super::validate_database_schema(&control, super::DatabaseKind::Control, 1).unwrap();
        let injected_failure = format!(
            "{}\nSELECT * FROM synthetic_interruption;",
            super::DatabaseKind::Control.upgrade()
        );
        let error = super::apply_database_upgrade(
            &mut control,
            super::DatabaseKind::Control,
            &injected_failure,
        )
        .unwrap_err();
        assert!(error.contains("synthetic_interruption"));
        assert_eq!(
            super::database_version(&control, super::DatabaseKind::Control).unwrap(),
            1
        );
        assert_eq!(
            control
                .query_row(
                    "SELECT plan_state FROM control_customer_identity",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "kwantflow_annual"
        );
        assert_eq!(
            control
                .query_row(
                    "SELECT COUNT(*) FROM account_entitlement_cache",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            control
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn legacy_account_link_maps_to_actual_remaining_local_setup_step() {
        for (has_workspace, imported, ai_decided, original_step, expected) in [
            (false, false, false, "account_link", "workspace_setup"),
            (true, false, false, "account_link", "setup_import_optional"),
            (true, true, false, "account_link", "local_ai_optional"),
            (true, true, true, "account_link", "ready"),
            (true, false, false, "ready", "ready"),
        ] {
            let root = tempdir().unwrap();
            let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
            let control = super::open_upgrade_connection(&control_path).unwrap();
            control.execute("UPDATE onboarding_state SET current_step = ?1, active_workspace_id = ?2, import_decided_at = ?3, local_ai_decided_at = ?4", rusqlite::params![original_step, has_workspace.then_some("workspace-a"), imported.then_some("2026-01-01"), ai_decided.then_some("2026-01-01")]).unwrap();
            drop(control);
            super::migrate_and_validate_local_databases(
                &control_path,
                &workspace_root,
                &recovery_root,
            )
            .await
            .unwrap();
            let control = super::open_upgrade_connection(&control_path).unwrap();
            assert_eq!(
                control
                    .query_row("SELECT current_step FROM onboarding_state", [], |row| {
                        row.get::<_, String>(0)
                    })
                    .unwrap(),
                expected
            );
            if original_step == "account_link" && expected == "ready" {
                assert!(control
                    .query_row("SELECT completed_at FROM onboarding_state", [], |row| {
                        row.get::<_, Option<String>>(0)
                    })
                    .unwrap()
                    .is_some());
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn registry_traversal_and_symlinked_databases_are_rejected() {
        for symlink in [false, true] {
            let root = tempdir().unwrap();
            let (control_path, workspace_root, recovery_root) = legacy_profile(root.path());
            if symlink {
                let path = workspace_root.join("workspace-b/workspace.db");
                let target = root.path().canonicalize().unwrap().join("outside.db");
                std::fs::rename(&path, &target).unwrap();
                std::os::unix::fs::symlink(&target, &path).unwrap();
            } else {
                let control = super::open_upgrade_connection(&control_path).unwrap();
                control.execute("UPDATE workspace_registry SET db_path = '../outside.db' WHERE id = 'workspace-b'", []).unwrap();
            }
            let error = super::migrate_and_validate_local_databases(
                &control_path,
                &workspace_root,
                &recovery_root,
            )
            .await
            .unwrap_err();
            assert!(error.contains(if symlink {
                "symlink"
            } else {
                "Invalid managed"
            }));
            assert!(!recovery_root.exists());
        }
    }

    #[tokio::test]
    async fn workspace_access_has_no_control_database_fallback() {
        let root = tempdir().unwrap();
        let runtime = DatabaseRuntime::open(
            root.path()
                .canonicalize()
                .unwrap()
                .join("kwantflow-control.db"),
            root.path().canonicalize().unwrap().join("workspaces"),
            root.path().canonicalize().unwrap().join("schema-recovery"),
        )
        .await
        .unwrap();
        assert_eq!(
            runtime.workspace_pool().await.unwrap_err(),
            "No active workspace database."
        );
    }

    #[tokio::test]
    async fn bundled_sqlite_contains_the_wal_reset_fix() {
        let root = tempdir().unwrap();
        let runtime = DatabaseRuntime::open(
            root.path()
                .canonicalize()
                .unwrap()
                .join("kwantflow-control.db"),
            root.path().canonicalize().unwrap().join("workspaces"),
            root.path().canonicalize().unwrap().join("schema-recovery"),
        )
        .await
        .unwrap();
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(&runtime.control_pool())
            .await
            .unwrap();
        assert!(version.as_str() >= "3.51.3", "SQLite {version} is too old");
    }

    #[tokio::test]
    async fn activation_is_explicit() {
        let root = tempdir().unwrap();
        let runtime = DatabaseRuntime::open(
            root.path()
                .canonicalize()
                .unwrap()
                .join("kwantflow-control.db"),
            root.path().canonicalize().unwrap().join("workspaces"),
            root.path().canonicalize().unwrap().join("schema-recovery"),
        )
        .await
        .unwrap();
        let pool = DatabaseRuntime::create_workspace_pool(
            &root.path().canonicalize().unwrap().join("workspace.db"),
        )
        .await
        .unwrap();
        runtime
            .activate_workspace_pool("workspace-a".to_string(), pool)
            .await;
        assert_eq!(
            runtime.active_workspace_id().await.as_deref(),
            Some("workspace-a")
        );
    }

    #[tokio::test]
    async fn activation_waits_for_in_flight_workspace_lease() {
        let root = tempdir().unwrap();
        let runtime = Arc::new(
            DatabaseRuntime::open(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .join("kwantflow-control.db"),
                root.path().canonicalize().unwrap().join("workspaces"),
                root.path().canonicalize().unwrap().join("schema-recovery"),
            )
            .await
            .unwrap(),
        );
        let first = DatabaseRuntime::create_workspace_pool(
            &root.path().canonicalize().unwrap().join("first.db"),
        )
        .await
        .unwrap();
        runtime
            .activate_workspace_pool("workspace-a".to_string(), first)
            .await;
        let lease = runtime.workspace_pool().await.unwrap();
        let second = DatabaseRuntime::create_workspace_pool(
            &root.path().canonicalize().unwrap().join("second.db"),
        )
        .await
        .unwrap();
        let switching_runtime = runtime.clone();
        let switch = tokio::spawn(async move {
            switching_runtime
                .activate_workspace_pool("workspace-b".to_string(), second)
                .await;
        });

        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!switch.is_finished());
        drop(lease);
        switch.await.unwrap();
        assert_eq!(
            runtime.active_workspace_id().await.as_deref(),
            Some("workspace-b")
        );
    }

    #[tokio::test]
    async fn clearing_active_workspace_waits_for_in_flight_workspace_lease() {
        let root = tempdir().unwrap();
        let runtime = Arc::new(
            DatabaseRuntime::open(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .join("kwantflow-control.db"),
                root.path().canonicalize().unwrap().join("workspaces"),
                root.path().canonicalize().unwrap().join("schema-recovery"),
            )
            .await
            .unwrap(),
        );
        let pool = DatabaseRuntime::create_workspace_pool(
            &root.path().canonicalize().unwrap().join("workspace.db"),
        )
        .await
        .unwrap();
        runtime
            .activate_workspace_pool("workspace-a".to_string(), pool)
            .await;
        let lease = runtime.workspace_pool().await.unwrap();
        let clearing_runtime = runtime.clone();
        let clear = tokio::spawn(async move {
            clearing_runtime
                .clear_active_workspace_pool(Some("workspace-a"))
                .await;
        });

        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!clear.is_finished());
        drop(lease);
        clear.await.unwrap();
        assert_eq!(runtime.active_workspace_id().await, None);
        assert_eq!(
            runtime.workspace_pool().await.unwrap_err(),
            "No active workspace database."
        );
    }

    #[tokio::test]
    async fn clean_baselines_reopen_without_reapplying_create_table_statements() {
        let root = tempdir().unwrap();
        let control_path = root
            .path()
            .canonicalize()
            .unwrap()
            .join("kwantflow-control.db");
        let first_runtime = DatabaseRuntime::open(
            control_path.clone(),
            root.path().canonicalize().unwrap().join("workspaces"),
            root.path().canonicalize().unwrap().join("schema-recovery"),
        )
        .await
        .unwrap();
        first_runtime.control.close().await;
        let second_runtime = DatabaseRuntime::open(
            control_path,
            root.path().canonicalize().unwrap().join("workspaces"),
            root.path().canonicalize().unwrap().join("schema-recovery"),
        )
        .await
        .unwrap();
        second_runtime.control.close().await;

        let workspace_path = root.path().canonicalize().unwrap().join("workspace.db");
        let first_workspace = DatabaseRuntime::create_workspace_pool(&workspace_path)
            .await
            .unwrap();
        first_workspace.close().await;
        let second_workspace = DatabaseRuntime::open_workspace_pool(&workspace_path)
            .await
            .unwrap();
        second_workspace.close().await;
    }

    #[tokio::test]
    async fn nonempty_unknown_database_is_rejected_instead_of_partially_bootstrapped() {
        let root = tempdir().unwrap();
        let path = root.path().canonicalize().unwrap().join("unknown.db");
        let pool = super::open_pool(&path, true).await.unwrap();
        sqlx::query("CREATE TABLE unrelated (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let error = DatabaseRuntime::open_workspace_pool(&path)
            .await
            .unwrap_err();
        assert!(error.contains("Validate workspace database contract"));
    }

    #[tokio::test]
    async fn activation_open_never_creates_a_missing_registered_database() {
        let root = tempdir().unwrap();
        let path = root.path().canonicalize().unwrap().join("missing.db");

        let error = DatabaseRuntime::open_workspace_pool(&path)
            .await
            .unwrap_err();

        assert!(error.contains("Registered workspace database is missing"));
        assert!(!path.exists());
    }
}

async fn open_pool(path: &PathBuf, create_if_missing: bool) -> Result<SqlitePool, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Create database directory: {error}"))?;
    }
    // A URL cannot carry every native path (Windows `\\?\` prefixes, `?`, `#`), so hand the
    // path to SQLite directly instead of formatting a `sqlite://` connection string.
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(create_if_missing)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10));
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|error| format!("Open SQLite database: {error}"))
}
