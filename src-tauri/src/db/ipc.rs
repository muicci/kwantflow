use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef};
use tauri::{State, WebviewWindow};

use super::runtime::DatabaseRuntime;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteDatabaseResult {
    rows_affected: u64,
    last_insert_id: i64,
}

fn bind_value<'q>(
    query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments>,
    value: &'q Value,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(i64::from(*value)),
        Value::Number(value) if value.is_i64() => query.bind(value.as_i64()),
        Value::Number(value) if value.is_u64() => query.bind(value.as_u64().map(|v| v as i64)),
        Value::Number(value) => query.bind(value.as_f64()),
        Value::String(value) => query.bind(value),
        value => query.bind(value.to_string()),
    }
}

fn row_value(row: &sqlx::sqlite::SqliteRow, index: usize) -> Result<Value, String> {
    let raw_value = row.try_get_raw(index).map_err(|error| error.to_string())?;
    if raw_value.is_null() {
        return Ok(Value::Null);
    }
    let type_name = raw_value.type_info().name().to_ascii_uppercase();
    if type_name.contains("INT") {
        return row
            .try_get::<Option<i64>, _>(index)
            .map(|value| value.map(Value::from).unwrap_or(Value::Null))
            .map_err(|error| error.to_string());
    }
    if type_name.contains("REAL") || type_name.contains("FLOA") || type_name.contains("DOUB") {
        return row
            .try_get::<Option<f64>, _>(index)
            .map(|value| {
                value
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            })
            .map_err(|error| error.to_string());
    }
    if type_name.contains("BLOB") {
        return row
            .try_get::<Option<Vec<u8>>, _>(index)
            .map(|value| {
                value
                    .map(|bytes| Value::Array(bytes.into_iter().map(Value::from).collect()))
                    .unwrap_or(Value::Null)
            })
            .map_err(|error| error.to_string());
    }
    row.try_get::<Option<String>, _>(index)
        .map(|value| value.map(Value::String).unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

async fn query_database(
    pool: &SqlitePool,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
    for value in &params {
        query = bind_value(query, value);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    rows.into_iter()
        .map(|row| {
            let mut value = Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                value.insert(column.name().to_string(), row_value(&row, index)?);
            }
            Ok(Value::Object(value))
        })
        .collect()
}

async fn execute_database(
    pool: &SqlitePool,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecuteDatabaseResult, String> {
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
    for value in &params {
        query = bind_value(query, value);
    }
    let result = query
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ExecuteDatabaseResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == "main")
        .then_some(())
        .ok_or_else(|| "Database mutations are restricted to the main window.".to_string())
}

#[tauri::command]
pub(crate) async fn query_control_database(
    runtime: State<'_, DatabaseRuntime>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    query_database(&runtime.control_pool(), sql, params).await
}

#[tauri::command]
pub(crate) async fn execute_control_database(
    window: WebviewWindow,
    runtime: State<'_, DatabaseRuntime>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecuteDatabaseResult, String> {
    require_main_window(&window)?;
    execute_database(&runtime.control_pool(), sql, params).await
}

#[tauri::command]
pub(crate) async fn query_workspace_database(
    runtime: State<'_, DatabaseRuntime>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let workspace = runtime.workspace_pool().await?;
    query_database(&workspace, sql, params).await
}

#[tauri::command]
pub(crate) async fn execute_workspace_database(
    window: WebviewWindow,
    runtime: State<'_, DatabaseRuntime>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecuteDatabaseResult, String> {
    require_main_window(&window)?;
    let workspace = runtime.workspace_pool().await?;
    execute_database(&workspace, sql, params).await
}

#[cfg(test)]
mod tests {
    use super::query_database;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn query_database_decodes_dynamic_sqlite_expression_types() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        let rows = query_database(
            &pool,
            "SELECT 1 AS count_value, 2.5 AS rate_value, 'ready' AS status_value, NULL AS empty_value"
                .to_string(),
            vec![],
        )
        .await
        .unwrap();

        assert_eq!(
            rows,
            vec![json!({
                "count_value": 1,
                "rate_value": 2.5,
                "status_value": "ready",
                "empty_value": null
            })]
        );
    }
}
