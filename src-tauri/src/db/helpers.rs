use sqlx::{Row, Sqlite};

pub(crate) fn has_non_empty_text(value: Option<&str>) -> bool {
    value.map(|entry| !entry.trim().is_empty()).unwrap_or(false)
}

pub(crate) fn prefer_existing_text(existing: Option<&str>, fallback: &str) -> String {
    if has_non_empty_text(existing) {
        existing.unwrap_or_default().to_string()
    } else {
        fallback.to_string()
    }
}

pub(crate) fn should_keep_existing_number(existing: Option<f64>) -> bool {
    existing.is_some()
}

pub(crate) fn supports_separate_tax_identifier(country_code: Option<&str>) -> bool {
    !matches!(country_code.unwrap_or_default(), "AU" | "NZ")
}

pub(crate) fn thumbnail_priority(file_path: &str) -> Option<i32> {
    match file_path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => Some(400),
        "step" | "stp" | "iges" | "igs" | "stl" | "obj" | "3mf" | "dxf" => Some(300),
        "png" | "jpg" | "jpeg" | "svg" | "webp" | "gif" | "bmp" => Some(200),
        "docx" | "xlsx" => Some(125),
        "txt" | "csv" | "md" | "log" | "json" | "xml" => Some(100),
        _ => None,
    }
}

pub(crate) async fn sync_asset_thumbnail_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    asset_id: &str,
) -> Result<(), String> {
    let asset_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM assets WHERE id = ?")
        .bind(asset_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("Check asset before thumbnail sync: {}", e))?;

    if asset_exists == 0 {
        return Ok(());
    }

    let file_rows = sqlx::query(
        "SELECT id, file_path, created_at FROM files WHERE asset_id = ? ORDER BY created_at ASC",
    )
    .bind(asset_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("Load asset files for thumbnail sync: {}", e))?;

    let mut next_file_id: Option<String> = None;
    let mut best_priority = i32::MIN;
    let mut best_created_at = String::new();

    for row in file_rows {
        let file_path: String = row.get("file_path");
        let Some(priority) = thumbnail_priority(&file_path) else {
            continue;
        };
        let created_at: String = row.get("created_at");
        if next_file_id.is_none()
            || priority > best_priority
            || (priority == best_priority && created_at < best_created_at)
        {
            next_file_id = Some(row.get("id"));
            best_priority = priority;
            best_created_at = created_at;
        }
    }

    sqlx::query("UPDATE assets SET thumbnail_file_id = ? WHERE id = ?")
        .bind(next_file_id)
        .bind(asset_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Persist asset thumbnail sync: {}", e))?;

    Ok(())
}

pub(crate) fn json_string_required(value: &serde_json::Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required string field: {}", key))
}

pub(crate) fn json_string_optional(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
}

pub(crate) fn json_string_or_default(
    value: &serde_json::Value,
    key: &str,
    default: &str,
) -> String {
    json_string_optional(value, key).unwrap_or_else(|| default.to_string())
}

pub(crate) fn json_bool_or_default(value: &serde_json::Value, key: &str, default: bool) -> bool {
    value
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(default)
}

pub(crate) fn json_f64_required(value: &serde_json::Value, key: &str) -> Result<f64, String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| format!("Missing required numeric field: {}", key))
}

pub(crate) fn json_f64_optional(
    value: &serde_json::Value,
    key: &str,
) -> Result<Option<f64>, String> {
    match value.get(key) {
        Some(v) if !v.is_null() => Ok(v.as_f64()),
        _ => Ok(None),
    }
}

pub(crate) fn json_i64_required(value: &serde_json::Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| format!("Missing required integer field: {}", key))
}

pub(crate) fn json_i64_or_default(value: &serde_json::Value, key: &str, default: i64) -> i64 {
    value
        .get(key)
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(default)
}

pub(crate) fn json_array<'a>(value: &'a serde_json::Value, key: &str) -> &'a [serde_json::Value] {
    value
        .get(key)
        .and_then(serde_json::Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub(crate) fn json_field_to_string(
    value: &serde_json::Value,
    key: &str,
    fallback: serde_json::Value,
) -> Result<String, String> {
    let target = value.get(key).cloned().unwrap_or(fallback);
    serde_json::to_string(&target).map_err(|e| format!("Serialize JSON field {}: {}", key, e))
}

pub(crate) async fn sync_contact_relationships_tx_json(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    contact_id: &str,
    workspace_id: &str,
    data: &serde_json::Value,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM contact_relationships
         WHERE workspace_id = ?
           AND from_contact_id = ?
           AND relationship_type IN ('works_for', 'primary_contact_for')",
    )
    .bind(workspace_id)
    .bind(contact_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Delete contact relationships: {}", e))?;

    if json_string_or_default(data, "kind", "company") != "person" {
        return Ok(());
    }

    let Some(linked_company_id) = json_string_optional(data, "linked_company_id") else {
        return Ok(());
    };

    let is_primary = json_bool_or_default(data, "is_primary_company_contact", false);
    sqlx::query(
        "INSERT INTO contact_relationships (
            id, workspace_id, from_contact_id, to_contact_id, relationship_type, is_primary, notes
         ) VALUES (?, ?, ?, ?, 'works_for', ?, NULL)",
    )
    .bind(format!("{}:works_for", contact_id))
    .bind(workspace_id)
    .bind(contact_id)
    .bind(&linked_company_id)
    .bind(if is_primary { 1 } else { 0 })
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Insert works_for relationship: {}", e))?;

    if is_primary {
        sqlx::query(
            "INSERT INTO contact_relationships (
                id, workspace_id, from_contact_id, to_contact_id, relationship_type, is_primary, notes
             ) VALUES (?, ?, ?, ?, 'primary_contact_for', 1, NULL)",
        )
        .bind(format!("{}:primary_contact_for", contact_id))
        .bind(workspace_id)
        .bind(contact_id)
        .bind(&linked_company_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Insert primary_contact_for relationship: {}", e))?;
    }

    Ok(())
}
