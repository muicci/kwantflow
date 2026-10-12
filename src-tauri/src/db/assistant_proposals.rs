use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::collections::HashSet;
use tauri::AppHandle;

use super::commands::{begin_immediate, insert_contact_tx};
use super::pool::transactional_sqlite_pool;
use super::types::{
    AssistantApprovedContactsBundleResult, AssistantApprovedRecordProposalInput,
    AssistantApprovedRecordProposalSetInput, AssistantApprovedRecordProposalSetItemInput,
    AssistantRecordProposalAction, AssistantRecordProposalScope,
};

const CONTACT_FIELDS: &[&str] = &[
    "kind",
    "name",
    "display_name",
    "person_first_name",
    "person_last_name",
    "linked_company_id",
    "email",
    "phone",
    "address",
    "role_title",
    "custom_role_label",
    "notes",
    "is_active",
];
const MATERIAL_FIELDS: &[&str] = &[
    "code",
    "name",
    "category",
    "specification",
    "unit",
    "default_rate",
    "currency_code",
    "rate_basis",
    "lead_time",
    "availability",
    "reference",
    "aliases",
    "is_active",
];
const WORK_RATE_FIELDS: &[&str] = &[
    "code",
    "name",
    "category",
    "work_center",
    "unit",
    "default_rate",
    "currency_code",
    "rate_basis",
    "aliases",
    "is_active",
];
const SUBCONTRACT_RATE_FIELDS: &[&str] = &[
    "code",
    "name",
    "category",
    "unit",
    "default_rate",
    "currency_code",
    "rate_basis",
    "aliases",
    "is_active",
];
const WBS_FIELDS: &[&str] = &[
    "project_id",
    "parent_id",
    "code",
    "name",
    "type",
    "sort_order",
];
const QUOTE_OPTION_FIELDS: &[&str] = &[
    "project_id",
    "label",
    "lead_time",
    "markup_percentage",
    "notes",
    "sort_order",
];
const ASSET_FIELDS: &[&str] = &["project_id", "name"];

fn fields(input: &AssistantApprovedRecordProposalInput) -> Result<&Map<String, Value>, String> {
    let fields = input
        .fields
        .as_object()
        .ok_or_else(|| "Proposal fields must be an object".to_string())?;
    if fields.is_empty() {
        return Err("Proposal must change at least one field".to_string());
    }
    Ok(fields)
}

fn allowed_fields(scope: AssistantRecordProposalScope) -> &'static [&'static str] {
    match scope {
        AssistantRecordProposalScope::Contacts => CONTACT_FIELDS,
        AssistantRecordProposalScope::Materials => MATERIAL_FIELDS,
        AssistantRecordProposalScope::LabourRates
        | AssistantRecordProposalScope::EquipmentRates => WORK_RATE_FIELDS,
        AssistantRecordProposalScope::SubcontractRates => SUBCONTRACT_RATE_FIELDS,
        AssistantRecordProposalScope::WbsNodes => WBS_FIELDS,
        AssistantRecordProposalScope::QuoteOptions => QUOTE_OPTION_FIELDS,
        AssistantRecordProposalScope::Assets => ASSET_FIELDS,
    }
}

fn validate_field_names(
    scope: AssistantRecordProposalScope,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    let allowed = allowed_fields(scope);
    let rejected = fields
        .keys()
        .filter(|key| !allowed.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if rejected.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Unsupported proposal fields: {}",
            rejected.join(", ")
        ))
    }
}

fn required_string(fields: &Map<String, Value>, key: &str) -> Result<String, String> {
    optional_string(fields, key)?.ok_or_else(|| format!("Missing required field: {key}"))
}

fn optional_string(fields: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Field {key} must be a non-empty string"))?;
    Ok(Some(value.to_string()))
}

fn optional_non_negative_f64(
    fields: &Map<String, Value>,
    key: &str,
) -> Result<Option<f64>, String> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    let number = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
        .filter(|number| number.is_finite() && *number >= 0.0)
        .ok_or_else(|| format!("Field {key} must be a finite non-negative number"))?;
    Ok(Some(number))
}

fn optional_non_negative_i64(
    fields: &Map<String, Value>,
    key: &str,
) -> Result<Option<i64>, String> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    let number = value
        .as_i64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
        .filter(|number| *number >= 0)
        .ok_or_else(|| format!("Field {key} must be a non-negative integer"))?;
    Ok(Some(number))
}

fn optional_bool_int(fields: &Map<String, Value>, key: &str) -> Result<Option<i64>, String> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    value
        .as_bool()
        .map(|value| if value { 1 } else { 0 })
        .ok_or_else(|| format!("Field {key} must be true or false"))
        .map(Some)
}

fn optional_json_array(fields: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    let Some(value) = fields.get(key) else {
        return Ok(None);
    };
    if !value.as_array().is_some_and(|values| {
        values
            .iter()
            .all(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
    }) {
        return Err(format!("Field {key} must be an array of non-empty strings"));
    }
    serde_json::to_string(value)
        .map(Some)
        .map_err(|error| format!("Serialize {key}: {error}"))
}

fn validate_create_fields(
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    if !matches!(input.action, AssistantRecordProposalAction::Create) {
        return Ok(());
    }
    let required: &[&str] = match input.scope {
        AssistantRecordProposalScope::Contacts => &["name"],
        AssistantRecordProposalScope::Materials
        | AssistantRecordProposalScope::LabourRates
        | AssistantRecordProposalScope::EquipmentRates
        | AssistantRecordProposalScope::SubcontractRates => &["name", "unit", "default_rate"],
        AssistantRecordProposalScope::WbsNodes => &["project_id", "name", "type"],
        AssistantRecordProposalScope::QuoteOptions => &["project_id", "label", "markup_percentage"],
        AssistantRecordProposalScope::Assets => &["project_id", "name"],
    };
    for field in required {
        if !fields.contains_key(*field) {
            return Err(format!("Missing required field: {field}"));
        }
    }
    Ok(())
}

async fn ensure_company_in_workspace(
    tx: &mut Transaction<'_, Sqlite>,
    contact_id: &str,
    workspace_id: &str,
) -> Result<(), String> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM contacts WHERE id = ? AND workspace_id = ? AND kind = 'company'",
    )
    .bind(contact_id)
    .bind(workspace_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("Validate linked company ownership: {error}"))?;
    if exists == 1 {
        Ok(())
    } else {
        Err("Linked company was not found in this workspace".to_string())
    }
}

async fn ensure_project_in_workspace(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    workspace_id: &str,
) -> Result<(), String> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM projects WHERE id = ? AND workspace_id = ?",
    )
    .bind(project_id)
    .bind(workspace_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("Validate project ownership: {error}"))?;
    if exists == 1 {
        Ok(())
    } else {
        Err("Referenced project was not found in this workspace".to_string())
    }
}

async fn ensure_wbs_parent_in_project(
    tx: &mut Transaction<'_, Sqlite>,
    parent_id: &str,
    project_id: &str,
) -> Result<(), String> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM wbs_nodes WHERE id = ? AND project_id = ?",
    )
    .bind(parent_id)
    .bind(project_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("Validate WBS parent ownership: {error}"))?;
    if exists == 1 {
        Ok(())
    } else {
        Err("WBS parent was not found in the selected project".to_string())
    }
}

async fn ensure_wbs_parent_not_descendant(
    tx: &mut Transaction<'_, Sqlite>,
    record_id: &str,
    parent_id: &str,
) -> Result<(), String> {
    let descendant_count = sqlx::query_scalar::<_, i64>(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM wbs_nodes WHERE parent_id = ?
            UNION ALL
            SELECT child.id FROM wbs_nodes child
            JOIN descendants parent ON child.parent_id = parent.id
         )
         SELECT COUNT(*) FROM descendants WHERE id = ?",
    )
    .bind(record_id)
    .bind(parent_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("Validate WBS parent cycle: {error}"))?;
    if descendant_count == 0 {
        Ok(())
    } else {
        Err("A WBS node cannot use one of its descendants as its parent".to_string())
    }
}

async fn execute_contact(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    if let Some(linked_company_id) = optional_string(fields, "linked_company_id")? {
        ensure_company_in_workspace(tx, &linked_company_id, &input.workspace_id).await?;
    }
    if let Some(kind) = optional_string(fields, "kind")? {
        if !matches!(kind.as_str(), "company" | "person") {
            return Err("Contact kind must be company or person".to_string());
        }
    }

    match input.action {
        AssistantRecordProposalAction::Create => {
            let name = required_string(fields, "name")?;
            let kind = optional_string(fields, "kind")?.unwrap_or_else(|| "company".to_string());
            let linked_company_id =
                optional_string(fields, "linked_company_id")?.unwrap_or_default();
            let duplicate = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM contacts
                 WHERE workspace_id = ? AND kind = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
                   AND COALESCE(linked_company_id, '') = ?",
            )
            .bind(&input.workspace_id)
            .bind(&kind)
            .bind(&name)
            .bind(&linked_company_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Check duplicate contact: {error}"))?;
            if duplicate > 0 {
                return Err("A matching contact already exists in this workspace".to_string());
            }
            let sort_order = sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM contacts WHERE workspace_id = ?",
            )
            .bind(&input.workspace_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Resolve contact sort order: {error}"))?;
            insert_contact_tx(
                tx,
                &input.record_id,
                &input.workspace_id,
                sort_order,
                &input.fields,
            )
            .await
        }
        AssistantRecordProposalAction::Update => {
            let name = optional_string(fields, "name")?;
            let display_name = optional_string(fields, "display_name")?;
            let changed = sqlx::query(
                "UPDATE contacts SET
                    kind = COALESCE(?, kind),
                    name = COALESCE(?, name),
                    display_name = COALESCE(?, display_name),
                    person_first_name = COALESCE(?, person_first_name),
                    person_last_name = COALESCE(?, person_last_name),
                    linked_company_id = COALESCE(?, linked_company_id),
                    email = COALESCE(?, email),
                    phone = COALESCE(?, phone),
                    address = COALESCE(?, address),
                    role_title = COALESCE(?, role_title),
                    custom_role_label = COALESCE(?, custom_role_label),
                    notes = COALESCE(?, notes),
                    is_active = COALESCE(?, is_active),
                    updated_at = ?
                 WHERE id = ? AND workspace_id = ?",
            )
            .bind(optional_string(fields, "kind")?)
            .bind(name.clone().or_else(|| display_name.clone()))
            .bind(display_name.or(name))
            .bind(optional_string(fields, "person_first_name")?)
            .bind(optional_string(fields, "person_last_name")?)
            .bind(optional_string(fields, "linked_company_id")?)
            .bind(optional_string(fields, "email")?)
            .bind(optional_string(fields, "phone")?)
            .bind(optional_string(fields, "address")?)
            .bind(optional_string(fields, "role_title")?)
            .bind(optional_string(fields, "custom_role_label")?)
            .bind(optional_string(fields, "notes")?)
            .bind(optional_bool_int(fields, "is_active")?)
            .bind(&input.updated_at)
            .bind(&input.record_id)
            .bind(&input.workspace_id)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Update contact proposal: {error}"))?
            .rows_affected();
            if changed == 1 {
                Ok(())
            } else {
                Err("Contact proposal target was not found in this workspace".to_string())
            }
        }
    }
}

async fn execute_material(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    if let Some(rate_basis) = optional_string(fields, "rate_basis")? {
        if !matches!(rate_basis.as_str(), "cost" | "sell") {
            return Err("Rate basis must be cost or sell".to_string());
        }
    }

    match input.action {
        AssistantRecordProposalAction::Create => {
            let name = required_string(fields, "name")?;
            let duplicate = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM material_catalog_items WHERE workspace_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))",
            )
            .bind(&input.workspace_id)
            .bind(&name)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Check duplicate material: {error}"))?;
            if duplicate > 0 {
                return Err(
                    "A material with this name already exists in this workspace".to_string()
                );
            }
            sqlx::query(
                "INSERT INTO material_catalog_items
                 (id, workspace_id, code, name, category, specification, unit, default_rate, currency_code, rate_basis, lead_time, availability, reference, aliases_json, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&input.record_id)
            .bind(&input.workspace_id)
            .bind(optional_string(fields, "code")?)
            .bind(name)
            .bind(optional_string(fields, "category")?)
            .bind(optional_string(fields, "specification")?)
            .bind(required_string(fields, "unit")?)
            .bind(optional_non_negative_f64(fields, "default_rate")?.ok_or_else(|| "Missing required field: default_rate".to_string())?)
            .bind(optional_string(fields, "currency_code")?)
            .bind(optional_string(fields, "rate_basis")?.unwrap_or_else(|| "cost".to_string()))
            .bind(optional_string(fields, "lead_time")?.unwrap_or_default())
            .bind(optional_string(fields, "availability")?.unwrap_or_default())
            .bind(optional_string(fields, "reference")?.unwrap_or_default())
            .bind(optional_json_array(fields, "aliases")?.unwrap_or_else(|| "[]".to_string()))
            .bind(optional_bool_int(fields, "is_active")?.unwrap_or(1))
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Insert material proposal: {error}"))?;
            Ok(())
        }
        AssistantRecordProposalAction::Update => {
            let changed = sqlx::query(
                "UPDATE material_catalog_items SET
                    code = COALESCE(?, code),
                    name = COALESCE(?, name), category = COALESCE(?, category),
                    specification = COALESCE(?, specification), unit = COALESCE(?, unit),
                    default_rate = COALESCE(?, default_rate), currency_code = COALESCE(?, currency_code),
                    rate_basis = COALESCE(?, rate_basis), lead_time = COALESCE(?, lead_time),
                    availability = COALESCE(?, availability), reference = COALESCE(?, reference),
                    aliases_json = COALESCE(?, aliases_json), is_active = COALESCE(?, is_active),
                    updated_at = ?
                 WHERE id = ? AND workspace_id = ?",
            )
            .bind(optional_string(fields, "code")?)
            .bind(optional_string(fields, "name")?)
            .bind(optional_string(fields, "category")?)
            .bind(optional_string(fields, "specification")?)
            .bind(optional_string(fields, "unit")?)
            .bind(optional_non_negative_f64(fields, "default_rate")?)
            .bind(optional_string(fields, "currency_code")?)
            .bind(optional_string(fields, "rate_basis")?)
            .bind(optional_string(fields, "lead_time")?)
            .bind(optional_string(fields, "availability")?)
            .bind(optional_string(fields, "reference")?)
            .bind(optional_json_array(fields, "aliases")?)
            .bind(optional_bool_int(fields, "is_active")?)
            .bind(&input.updated_at)
            .bind(&input.record_id)
            .bind(&input.workspace_id)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Update material proposal: {error}"))?
            .rows_affected();
            if changed == 1 {
                Ok(())
            } else {
                Err("Material proposal target was not found in this workspace".to_string())
            }
        }
    }
}

async fn execute_rate(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
    table: &str,
    detail_column: Option<&str>,
) -> Result<(), String> {
    if !matches!(
        table,
        "labour_rate_cards" | "equipment_rate_cards" | "subcontract_rate_cards"
    ) {
        return Err("Invalid table".to_string());
    }
    if let Some(col) = detail_column {
        if !matches!(col, "work_center") {
            return Err("Invalid detail column".to_string());
        }
    }
    if let Some(rate_basis) = optional_string(fields, "rate_basis")? {
        if !matches!(rate_basis.as_str(), "cost" | "sell") {
            return Err("Rate basis must be cost or sell".to_string());
        }
    }
    let detail = match detail_column {
        Some(column) => optional_string(fields, column)?,
        None => None,
    };

    match input.action {
        AssistantRecordProposalAction::Create => {
            let name = required_string(fields, "name")?;
            let duplicate_sql =
                format!("SELECT COUNT(*) FROM {table} WHERE workspace_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))");
            if sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(duplicate_sql.as_str()))
                .bind(&input.workspace_id)
                .bind(&name)
                .fetch_one(&mut **tx)
                .await
                .map_err(|error| format!("Check duplicate rate: {error}"))?
                > 0
            {
                return Err("A matching rate already exists in this workspace".to_string());
            }
            if let Some(detail_column) = detail_column {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "INSERT INTO {table}
                     (id, workspace_id, code, name, category, {detail_column}, unit, default_rate, currency_code, rate_basis, aliases_json, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )))
                .bind(&input.record_id)
                .bind(&input.workspace_id)
                .bind(optional_string(fields, "code")?)
                .bind(name)
                .bind(optional_string(fields, "category")?)
                .bind(detail)
                .bind(required_string(fields, "unit")?)
                .bind(optional_non_negative_f64(fields, "default_rate")?.ok_or_else(|| "Missing required field: default_rate".to_string())?)
                .bind(optional_string(fields, "currency_code")?)
                .bind(optional_string(fields, "rate_basis")?.unwrap_or_else(|| "cost".to_string()))
                .bind(optional_json_array(fields, "aliases")?.unwrap_or_else(|| "[]".to_string()))
                .bind(optional_bool_int(fields, "is_active")?.unwrap_or(1))
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("Insert rate proposal: {error}"))?;
            } else {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "INSERT INTO {table}
                     (id, workspace_id, code, name, category, unit, default_rate, currency_code, rate_basis, aliases_json, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )))
                .bind(&input.record_id)
                .bind(&input.workspace_id)
                .bind(optional_string(fields, "code")?)
                .bind(name)
                .bind(optional_string(fields, "category")?)
                .bind(required_string(fields, "unit")?)
                .bind(optional_non_negative_f64(fields, "default_rate")?.ok_or_else(|| "Missing required field: default_rate".to_string())?)
                .bind(optional_string(fields, "currency_code")?)
                .bind(optional_string(fields, "rate_basis")?.unwrap_or_else(|| "cost".to_string()))
                .bind(optional_json_array(fields, "aliases")?.unwrap_or_else(|| "[]".to_string()))
                .bind(optional_bool_int(fields, "is_active")?.unwrap_or(1))
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("Insert rate proposal: {error}"))?;
            }
            Ok(())
        }
        AssistantRecordProposalAction::Update => {
            let changed = if let Some(detail_column) = detail_column {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "UPDATE {table} SET
                        code = COALESCE(?, code), name = COALESCE(?, name),
                        category = COALESCE(?, category), {detail_column} = COALESCE(?, {detail_column}),
                        unit = COALESCE(?, unit), default_rate = COALESCE(?, default_rate),
                        currency_code = COALESCE(?, currency_code), rate_basis = COALESCE(?, rate_basis),
                        aliases_json = COALESCE(?, aliases_json), is_active = COALESCE(?, is_active),
                        updated_at = ?
                     WHERE id = ? AND workspace_id = ?"
                )))
                .bind(optional_string(fields, "code")?)
                .bind(optional_string(fields, "name")?)
                .bind(optional_string(fields, "category")?)
                .bind(detail)
                .bind(optional_string(fields, "unit")?)
                .bind(optional_non_negative_f64(fields, "default_rate")?)
                .bind(optional_string(fields, "currency_code")?)
                .bind(optional_string(fields, "rate_basis")?)
                .bind(optional_json_array(fields, "aliases")?)
                .bind(optional_bool_int(fields, "is_active")?)
                .bind(&input.updated_at)
                .bind(&input.record_id)
                .bind(&input.workspace_id)
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("Update rate proposal: {error}"))?
                .rows_affected()
            } else {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "UPDATE {table} SET
                        code = COALESCE(?, code), name = COALESCE(?, name),
                        category = COALESCE(?, category), unit = COALESCE(?, unit),
                        default_rate = COALESCE(?, default_rate), currency_code = COALESCE(?, currency_code),
                        rate_basis = COALESCE(?, rate_basis), aliases_json = COALESCE(?, aliases_json),
                        is_active = COALESCE(?, is_active), updated_at = ?
                     WHERE id = ? AND workspace_id = ?"
                )))
                .bind(optional_string(fields, "code")?)
                .bind(optional_string(fields, "name")?)
                .bind(optional_string(fields, "category")?)
                .bind(optional_string(fields, "unit")?)
                .bind(optional_non_negative_f64(fields, "default_rate")?)
                .bind(optional_string(fields, "currency_code")?)
                .bind(optional_string(fields, "rate_basis")?)
                .bind(optional_json_array(fields, "aliases")?)
                .bind(optional_bool_int(fields, "is_active")?)
                .bind(&input.updated_at)
                .bind(&input.record_id)
                .bind(&input.workspace_id)
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("Update rate proposal: {error}"))?
                .rows_affected()
            };
            if changed == 1 {
                Ok(())
            } else {
                Err("Rate proposal target was not found in this workspace".to_string())
            }
        }
    }
}

async fn execute_wbs(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    let existing = if matches!(input.action, AssistantRecordProposalAction::Update) {
        sqlx::query(
            "SELECT w.project_id, w.parent_id FROM wbs_nodes w JOIN projects p ON p.id = w.project_id WHERE w.id = ? AND p.workspace_id = ?",
        )
        .bind(&input.record_id)
        .bind(&input.workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("Load WBS proposal target: {error}"))?
    } else {
        None
    };
    if matches!(input.action, AssistantRecordProposalAction::Update) && existing.is_none() {
        return Err("WBS proposal target was not found in this workspace".to_string());
    }
    let requested_project_id = optional_string(fields, "project_id")?;
    if let (Some(existing), Some(requested_project_id)) =
        (existing.as_ref(), requested_project_id.as_ref())
    {
        let existing_project_id = existing.get::<String, _>("project_id");
        if existing_project_id != *requested_project_id {
            return Err("An existing WBS node cannot be moved to another project".to_string());
        }
    }
    let project_id = requested_project_id
        .or_else(|| {
            existing
                .as_ref()
                .map(|row| row.get::<String, _>("project_id"))
        })
        .ok_or_else(|| "Missing required field: project_id".to_string())?;
    ensure_project_in_workspace(tx, &project_id, &input.workspace_id).await?;
    let parent_id = optional_string(fields, "parent_id")?.or_else(|| {
        existing
            .as_ref()
            .and_then(|row| row.get::<Option<String>, _>("parent_id"))
    });
    if let Some(parent_id) = parent_id.as_deref() {
        if parent_id == input.record_id {
            return Err("A WBS node cannot be its own parent".to_string());
        }
        ensure_wbs_parent_in_project(tx, parent_id, &project_id).await?;
        if matches!(input.action, AssistantRecordProposalAction::Update) {
            ensure_wbs_parent_not_descendant(tx, &input.record_id, parent_id).await?;
        }
    }

    match input.action {
        AssistantRecordProposalAction::Create => {
            let name = required_string(fields, "name")?;
            let duplicate = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM wbs_nodes WHERE project_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND COALESCE(parent_id, '') = COALESCE(?, '')",
            )
            .bind(&project_id)
            .bind(&name)
            .bind(parent_id.as_deref())
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Check duplicate WBS node: {error}"))?;
            if duplicate > 0 {
                return Err("A matching WBS item already exists in this project".to_string());
            }
            sqlx::query(
                "INSERT INTO wbs_nodes (id, project_id, parent_id, code, name, type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&input.record_id)
            .bind(project_id)
            .bind(parent_id)
            .bind(optional_string(fields, "code")?)
            .bind(name)
            .bind(required_string(fields, "type")?)
            .bind(optional_non_negative_i64(fields, "sort_order")?.unwrap_or(0))
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Insert WBS proposal: {error}"))?;
        }
        AssistantRecordProposalAction::Update => {
            sqlx::query(
                "UPDATE wbs_nodes SET project_id = ?, parent_id = ?, code = COALESCE(?, code), name = COALESCE(?, name), type = COALESCE(?, type), sort_order = COALESCE(?, sort_order) WHERE id = ?",
            )
            .bind(project_id)
            .bind(parent_id)
            .bind(optional_string(fields, "code")?)
            .bind(optional_string(fields, "name")?)
            .bind(optional_string(fields, "type")?)
            .bind(optional_non_negative_i64(fields, "sort_order")?)
            .bind(&input.record_id)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Update WBS proposal: {error}"))?;
        }
    }
    Ok(())
}

async fn execute_quote_option(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    let existing_project = if matches!(input.action, AssistantRecordProposalAction::Update) {
        sqlx::query_scalar::<_, String>(
            "SELECT q.project_id FROM quote_options q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND p.workspace_id = ?",
        )
        .bind(&input.record_id)
        .bind(&input.workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("Load quote-option proposal target: {error}"))?
    } else {
        None
    };
    if matches!(input.action, AssistantRecordProposalAction::Update) && existing_project.is_none() {
        return Err("Quote-option proposal target was not found in this workspace".to_string());
    }
    let project_id = optional_string(fields, "project_id")?
        .or(existing_project)
        .ok_or_else(|| "Missing required field: project_id".to_string())?;
    ensure_project_in_workspace(tx, &project_id, &input.workspace_id).await?;

    match input.action {
        AssistantRecordProposalAction::Create => {
            let label = required_string(fields, "label")?;
            let duplicate = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quote_options WHERE project_id = ? AND LOWER(TRIM(label)) = LOWER(TRIM(?))",
            )
            .bind(&project_id)
            .bind(&label)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Check duplicate quote option: {error}"))?;
            if duplicate > 0 {
                return Err(
                    "A quote option with this label already exists in the project".to_string(),
                );
            }
            sqlx::query(
                "INSERT INTO quote_options (id, project_id, label, lead_time, markup_percentage, notes, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(&input.record_id)
            .bind(project_id)
            .bind(label)
            .bind(optional_string(fields, "lead_time")?.unwrap_or_else(|| "Standard".to_string()))
            .bind(optional_non_negative_f64(fields, "markup_percentage")?.ok_or_else(|| "Missing required field: markup_percentage".to_string())?)
            .bind(optional_string(fields, "notes")?.unwrap_or_default())
            .bind(optional_non_negative_i64(fields, "sort_order")?.unwrap_or(0))
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Insert quote-option proposal: {error}"))?;
        }
        AssistantRecordProposalAction::Update => {
            sqlx::query(
                "UPDATE quote_options SET project_id = ?, label = COALESCE(?, label), lead_time = COALESCE(?, lead_time), markup_percentage = COALESCE(?, markup_percentage), notes = COALESCE(?, notes), sort_order = COALESCE(?, sort_order), updated_at = ? WHERE id = ?",
            )
            .bind(project_id)
            .bind(optional_string(fields, "label")?)
            .bind(optional_string(fields, "lead_time")?)
            .bind(optional_non_negative_f64(fields, "markup_percentage")?)
            .bind(optional_string(fields, "notes")?)
            .bind(optional_non_negative_i64(fields, "sort_order")?)
            .bind(&input.updated_at)
            .bind(&input.record_id)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Update quote-option proposal: {error}"))?;
        }
    }
    Ok(())
}

async fn execute_asset(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    fields: &Map<String, Value>,
) -> Result<(), String> {
    let existing_project = if matches!(input.action, AssistantRecordProposalAction::Update) {
        sqlx::query_scalar::<_, String>(
            "SELECT a.project_id FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND p.workspace_id = ?",
        )
        .bind(&input.record_id)
        .bind(&input.workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("Load asset proposal target: {error}"))?
    } else {
        None
    };
    if matches!(input.action, AssistantRecordProposalAction::Update) && existing_project.is_none() {
        return Err("Asset proposal target was not found in this workspace".to_string());
    }
    let project_id = optional_string(fields, "project_id")?
        .or(existing_project)
        .ok_or_else(|| "Missing required field: project_id".to_string())?;
    ensure_project_in_workspace(tx, &project_id, &input.workspace_id).await?;

    match input.action {
        AssistantRecordProposalAction::Create => {
            let name = required_string(fields, "name")?;
            let duplicate = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM assets WHERE project_id = ? AND LOWER(TRIM(display_name)) = LOWER(TRIM(?))",
            )
            .bind(&project_id)
            .bind(&name)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("Check duplicate asset: {error}"))?;
            if duplicate > 0 {
                return Err("An asset with this name already exists in the project".to_string());
            }
            sqlx::query("INSERT INTO assets (id, project_id, display_name) VALUES (?, ?, ?)")
                .bind(&input.record_id)
                .bind(project_id)
                .bind(name)
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("Insert asset proposal: {error}"))?;
        }
        AssistantRecordProposalAction::Update => {
            sqlx::query(
                "UPDATE assets SET project_id = ?, display_name = COALESCE(?, display_name) WHERE id = ?",
            )
            .bind(project_id)
            .bind(optional_string(fields, "name")?)
            .bind(&input.record_id)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("Update asset proposal: {error}"))?;
        }
    }
    Ok(())
}

async fn execute_record_change(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
) -> Result<(), String> {
    let fields = fields(input)?;
    validate_field_names(input.scope, fields)?;
    validate_create_fields(input, fields)?;
    match input.scope {
        AssistantRecordProposalScope::Contacts => execute_contact(tx, input, fields).await,
        AssistantRecordProposalScope::Materials => execute_material(tx, input, fields).await,
        AssistantRecordProposalScope::LabourRates => {
            execute_rate(tx, input, fields, "labour_rate_cards", Some("work_center")).await
        }
        AssistantRecordProposalScope::EquipmentRates => {
            execute_rate(
                tx,
                input,
                fields,
                "equipment_rate_cards",
                Some("work_center"),
            )
            .await
        }
        AssistantRecordProposalScope::SubcontractRates => {
            execute_rate(tx, input, fields, "subcontract_rate_cards", None).await
        }
        AssistantRecordProposalScope::WbsNodes => execute_wbs(tx, input, fields).await,
        AssistantRecordProposalScope::QuoteOptions => execute_quote_option(tx, input, fields).await,
        AssistantRecordProposalScope::Assets => execute_asset(tx, input, fields).await,
    }
}

fn record_storage(
    scope: AssistantRecordProposalScope,
) -> (&'static str, &'static str, &'static str) {
    match scope {
        AssistantRecordProposalScope::Contacts => ("contacts", "", "base.workspace_id"),
        AssistantRecordProposalScope::Materials => {
            ("material_catalog_items", "", "base.workspace_id")
        }
        AssistantRecordProposalScope::LabourRates => ("labour_rate_cards", "", "base.workspace_id"),
        AssistantRecordProposalScope::EquipmentRates => {
            ("equipment_rate_cards", "", "base.workspace_id")
        }
        AssistantRecordProposalScope::SubcontractRates => {
            ("subcontract_rate_cards", "", "base.workspace_id")
        }
        AssistantRecordProposalScope::WbsNodes => (
            "wbs_nodes",
            "JOIN projects owner ON owner.id = base.project_id",
            "owner.workspace_id",
        ),
        AssistantRecordProposalScope::QuoteOptions => (
            "quote_options",
            "JOIN projects owner ON owner.id = base.project_id",
            "owner.workspace_id",
        ),
        AssistantRecordProposalScope::Assets => (
            "assets",
            "JOIN projects owner ON owner.id = base.project_id",
            "owner.workspace_id",
        ),
    }
}

fn stored_field(scope: AssistantRecordProposalScope, field: &str) -> &str {
    match (scope, field) {
        (AssistantRecordProposalScope::Assets, "name") => "display_name",
        (
            AssistantRecordProposalScope::Materials
            | AssistantRecordProposalScope::LabourRates
            | AssistantRecordProposalScope::EquipmentRates
            | AssistantRecordProposalScope::SubcontractRates,
            "aliases",
        ) => "aliases_json",
        _ => field,
    }
}

fn verified_field_value(
    row: &sqlx::sqlite::SqliteRow,
    field: &str,
    expected: &Value,
) -> Result<Value, String> {
    if expected.is_boolean() {
        return row
            .try_get::<Option<i64>, _>(field)
            .map(|value| {
                value
                    .map(|value| Value::Bool(value != 0))
                    .unwrap_or(Value::Null)
            })
            .map_err(|error| format!("Read back boolean field {field}: {error}"));
    }
    if expected.is_number() {
        return row
            .try_get::<Option<f64>, _>(field)
            .map(|value| {
                value
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            })
            .map_err(|error| format!("Read back numeric field {field}: {error}"));
    }
    if expected.is_array() || expected.is_object() {
        return row
            .try_get::<Option<String>, _>(field)
            .map_err(|error| format!("Read back JSON field {field}: {error}"))?
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|error| format!("Parse read-back JSON field {field}: {error}"))
            })
            .transpose()
            .map(|value| value.unwrap_or(Value::Null));
    }
    row.try_get::<Option<String>, _>(field)
        .map(|value| value.map(Value::String).unwrap_or(Value::Null))
        .map_err(|error| format!("Read back text field {field}: {error}"))
}

async fn verify_record_change(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
) -> Result<(), String> {
    let proposal_fields = fields(input)?;
    let (table, join, workspace_column) = record_storage(input.scope);
    if !matches!(
        table,
        "contacts"
            | "material_catalog_items"
            | "labour_rate_cards"
            | "equipment_rate_cards"
            | "subcontract_rate_cards"
            | "wbs_nodes"
            | "quote_options"
            | "assets"
    ) {
        return Err("Invalid table name".to_string());
    }
    if !matches!(
        workspace_column,
        "base.workspace_id" | "owner.workspace_id" | "COALESCE(base.workspace_id, c.workspace_id)"
    ) {
        return Err("Invalid workspace column".to_string());
    }
    let selected = proposal_fields
        .keys()
        .map(|field| format!("base.{} AS \"{}\"", stored_field(input.scope, field), field))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {selected} FROM {table} base {join} WHERE base.id = ? AND {workspace_column} = ? LIMIT 1"
    );
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(&input.record_id)
        .bind(&input.workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("Read back approved proposal: {error}"))?
        .ok_or_else(|| "Approved proposal record was not found during readback".to_string())?;

    for (field, expected) in proposal_fields {
        let actual = verified_field_value(&row, field, expected)?;
        let matches = if let (Some(expected), Some(actual)) = (expected.as_f64(), actual.as_f64()) {
            (expected - actual).abs() < f64::EPSILON
        } else {
            expected == &actual
        };
        if !matches {
            return Err(format!(
                "Approved proposal readback mismatch for field {field}"
            ));
        }
    }
    Ok(())
}

async fn insert_audit(
    tx: &mut Transaction<'_, Sqlite>,
    input: &AssistantApprovedRecordProposalInput,
    action_id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let payload = serde_json::to_string(input)
        .map_err(|serialize_error| format!("Serialize proposal audit: {serialize_error}"))?;
    sqlx::query(
        "INSERT INTO assistant_action_audit
         (id, workspace_id, turn_id, action_id, proposal_id, tool_name, status, item_count, issue_count, error_count, payload_json, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, 'records_proposal_set', ?, 1, 0, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&input.workspace_id)
    .bind(&input.turn_id)
    .bind(action_id)
    .bind(&input.proposal_id)
    .bind(status)
    .bind(if error.is_some() { 1 } else { 0 })
    .bind(payload)
    .bind(error)
    .bind(&input.updated_at)
    .execute(&mut **tx)
    .await
    .map_err(|audit_error| format!("Write proposal {status} audit: {audit_error}"))?;
    Ok(())
}

fn proposal_set_record_input(
    set: &AssistantApprovedRecordProposalSetInput,
    item: &AssistantApprovedRecordProposalSetItemInput,
    workspace_id: &str,
    updated_at: &str,
) -> Result<AssistantApprovedRecordProposalInput, String> {
    let record_id = match (&item.action, &item.record_id) {
        (AssistantRecordProposalAction::Update, None) => {
            return Err("Update proposals require an exact record ID".to_string())
        }
        (_, Some(record_id)) => record_id.clone(),
        (AssistantRecordProposalAction::Create, None) => item.proposal_id.clone(),
    };
    Ok(AssistantApprovedRecordProposalInput {
        proposal_id: item.proposal_id.clone(),
        turn_id: set.turn_id.clone(),
        workspace_id: workspace_id.to_string(),
        updated_at: updated_at.to_string(),
        scope: item.scope,
        action: item.action,
        record_id,
        fields: item.fields.clone(),
    })
}

pub(crate) async fn execute_approved_record_proposal_set(
    pool: &SqlitePool,
    input: &AssistantApprovedRecordProposalSetInput,
) -> Result<AssistantApprovedContactsBundleResult, String> {
    if input.items.is_empty() {
        return Err("A proposal set must contain at least one item".to_string());
    }
    let mut proposal_ids = HashSet::new();
    if input.proposal_set_id.trim().is_empty()
        || input.turn_id.trim().is_empty()
        || input.items.iter().any(|item| {
            item.proposal_id.trim().is_empty() || !proposal_ids.insert(&item.proposal_id)
        })
    {
        return Err("Proposal sets require non-empty, unique proposal identities".to_string());
    }
    let workspace_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Resolve active workspace for proposal set: {error}"))?
    .ok_or_else(|| "The active workspace identity is unavailable".to_string())?;
    let updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let records = input
        .items
        .iter()
        .map(|item| proposal_set_record_input(input, item, &workspace_id, &updated_at))
        .collect::<Result<Vec<_>, _>>()?;
    for record in &records {
        let proposal_fields = fields(record)?;
        validate_field_names(record.scope, proposal_fields)?;
        validate_create_fields(record, proposal_fields)?;
    }

    let mut tx = begin_immediate(pool)
        .await
        .map_err(|error| format!("Begin approved proposal-set transaction: {error}"))?;
    let mut executed_count = 0_i64;
    for record in &records {
        let history = sqlx::query(
            "SELECT action_id, payload_json FROM assistant_action_audit WHERE workspace_id = ? AND proposal_id = ? AND status = 'executed'",
        )
        .bind(&record.workspace_id)
        .bind(&record.proposal_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|error| format!("Check proposal-set idempotency: {error}"))?;
        if history.len() > 1 {
            return Err("Proposal has inconsistent repeated execution history".to_string());
        }
        if let Some(previous) = history.first() {
            let action_id: String = previous
                .try_get("action_id")
                .map_err(|error| error.to_string())?;
            let payload: String = previous
                .try_get("payload_json")
                .map_err(|error| error.to_string())?;
            let mut stored: Value = serde_json::from_str(&payload)
                .map_err(|error| format!("Read previous proposal approval: {error}"))?;
            let mut expected = serde_json::to_value(record)
                .map_err(|error| format!("Validate repeated proposal approval: {error}"))?;
            // The backend generates a new timestamp for a retry. Every approved
            // identity and business field must still match the prior execution.
            for value in [&mut stored, &mut expected] {
                value
                    .as_object_mut()
                    .ok_or("Previous proposal approval is invalid")?
                    .remove("updatedAt");
            }
            if action_id != input.proposal_set_id || stored != expected {
                return Err(
                    "Proposal identity was already executed with different approved changes"
                        .to_string(),
                );
            }
            executed_count += 1;
        }
    }
    if executed_count == records.len() as i64 {
        tx.rollback()
            .await
            .map_err(|error| format!("Close duplicate proposal-set transaction: {error}"))?;
        return Ok(AssistantApprovedContactsBundleResult {
            status: "succeeded".to_string(),
            success_count: records.len() as i64,
            failure_count: 0,
            errors: Vec::new(),
        });
    }
    if executed_count > 0 {
        let _ = tx.rollback().await;
        return Err("Proposal set has inconsistent partial execution history".to_string());
    }

    for record in &records {
        insert_audit(&mut tx, record, &input.proposal_set_id, "approved", None).await?;
        if let Err(error) = execute_record_change(&mut tx, record).await {
            let _ = tx.rollback().await;
            let mut audit_tx = begin_immediate(pool)
                .await
                .map_err(|audit_error| format!("Begin failed proposal-set audit: {audit_error}"))?;
            insert_audit(
                &mut audit_tx,
                record,
                &input.proposal_set_id,
                "failed",
                Some(&error),
            )
            .await?;
            audit_tx.commit().await.map_err(|audit_error| {
                format!("Commit failed proposal-set audit: {audit_error}")
            })?;
            return Ok(AssistantApprovedContactsBundleResult {
                status: "failed".to_string(),
                success_count: 0,
                failure_count: records.len() as i64,
                errors: vec![error],
            });
        }
        if let Err(error) = verify_record_change(&mut tx, record).await {
            let _ = tx.rollback().await;
            let mut audit_tx = begin_immediate(pool)
                .await
                .map_err(|audit_error| format!("Begin failed proposal-set audit: {audit_error}"))?;
            insert_audit(
                &mut audit_tx,
                record,
                &input.proposal_set_id,
                "failed",
                Some(&error),
            )
            .await?;
            audit_tx.commit().await.map_err(|audit_error| {
                format!("Commit failed proposal-set audit: {audit_error}")
            })?;
            return Ok(AssistantApprovedContactsBundleResult {
                status: "failed".to_string(),
                success_count: 0,
                failure_count: records.len() as i64,
                errors: vec![error],
            });
        }
        insert_audit(&mut tx, record, &input.proposal_set_id, "executed", None).await?;
    }
    tx.commit()
        .await
        .map_err(|error| format!("Commit approved proposal set: {error}"))?;
    Ok(AssistantApprovedContactsBundleResult {
        status: "succeeded".to_string(),
        success_count: records.len() as i64,
        failure_count: 0,
        errors: Vec::new(),
    })
}

#[tauri::command]
pub async fn execute_approved_record_proposal_set_command(
    app: AppHandle,
    input: AssistantApprovedRecordProposalSetInput,
) -> Result<AssistantApprovedContactsBundleResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    execute_approved_record_proposal_set(&pool, &input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("test sqlite pool");
        for statement in [
            "PRAGMA foreign_keys = ON",
            "CREATE TABLE workspace_identity (id TEXT PRIMARY KEY)",
            "CREATE TABLE workspace_profile (workspace_id TEXT PRIMARY KEY, country_code TEXT NOT NULL DEFAULT 'AU')",
            "CREATE TABLE contacts (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT 'company', display_name TEXT, name TEXT NOT NULL,
                company_name TEXT, person_first_name TEXT, person_last_name TEXT, role_title TEXT,
                linked_company_id TEXT, is_primary_company_contact INTEGER NOT NULL DEFAULT 0,
                country_code TEXT NOT NULL DEFAULT 'AU', contact_name TEXT, email TEXT, website TEXT,
                phone TEXT, phone_e164 TEXT NOT NULL DEFAULT '', phone_country_code TEXT NOT NULL DEFAULT 'AU',
                abn TEXT, business_id_label TEXT NOT NULL DEFAULT 'Business ID', business_id_value TEXT,
                tax_id_label TEXT NOT NULL DEFAULT 'Tax ID', tax_id_value TEXT, address TEXT, notes TEXT,
                logo_file_path TEXT, custom_role_label TEXT, roles_json TEXT NOT NULL DEFAULT '[]',
                tags_json TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE contact_relationships (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, from_contact_id TEXT NOT NULL,
                to_contact_id TEXT NOT NULL, relationship_type TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
                notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE material_catalog_items (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL,
                category TEXT, specification TEXT, unit TEXT NOT NULL, default_rate REAL NOT NULL DEFAULT 0,
                currency_code TEXT, rate_basis TEXT NOT NULL DEFAULT 'cost', lead_time TEXT NOT NULL DEFAULT '',
                availability TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '', aliases_json TEXT NOT NULL DEFAULT '[]',
                metadata_json TEXT NOT NULL DEFAULT '{}', is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE labour_rate_cards (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL,
                category TEXT, work_center TEXT, unit TEXT NOT NULL, default_rate REAL NOT NULL DEFAULT 0,
                currency_code TEXT, rate_basis TEXT NOT NULL DEFAULT 'cost', aliases_json TEXT NOT NULL DEFAULT '[]',
                is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE equipment_rate_cards (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL,
                category TEXT, work_center TEXT, unit TEXT NOT NULL, default_rate REAL NOT NULL DEFAULT 0,
                currency_code TEXT, rate_basis TEXT NOT NULL DEFAULT 'cost', aliases_json TEXT NOT NULL DEFAULT '[]',
                is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE subcontract_rate_cards (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL,
                category TEXT, unit TEXT NOT NULL, default_rate REAL NOT NULL DEFAULT 0,
                currency_code TEXT, rate_basis TEXT NOT NULL DEFAULT 'cost', aliases_json TEXT NOT NULL DEFAULT '[]',
                is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE wbs_nodes (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, code TEXT, name TEXT NOT NULL,
                type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE quote_options (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL, lead_time TEXT NOT NULL DEFAULT 'Standard',
                markup_percentage REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            "CREATE TABLE assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, display_name TEXT NOT NULL)",
            "CREATE TABLE assistant_action_audit (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, turn_id TEXT NOT NULL, action_id TEXT NOT NULL,
                proposal_id TEXT NOT NULL, tool_name TEXT NOT NULL, status TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0,
                issue_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
                payload_json TEXT NOT NULL DEFAULT '{}', error_message TEXT, created_at TEXT NOT NULL
            )",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create proposal test schema");
        }
        sqlx::query("INSERT INTO workspace_identity (id) VALUES ('workspace-1'), ('workspace-2')")
            .execute(&pool)
            .await
            .expect("seed workspaces");
        sqlx::query("INSERT INTO workspace_profile (workspace_id, country_code) VALUES ('workspace-1', 'AU'), ('workspace-2', 'AU')")
            .execute(&pool)
            .await
            .expect("seed workspace profiles");
        sqlx::query("INSERT INTO projects (id, workspace_id) VALUES ('project-1', 'workspace-1'), ('project-2', 'workspace-2')")
            .execute(&pool)
            .await
            .expect("seed projects");
        pool
    }

    fn proposal(
        proposal_id: &str,
        scope: AssistantRecordProposalScope,
        action: AssistantRecordProposalAction,
        record_id: &str,
        fields: Value,
    ) -> AssistantApprovedRecordProposalInput {
        AssistantApprovedRecordProposalInput {
            proposal_id: proposal_id.to_string(),
            turn_id: proposal_id.to_string(),
            workspace_id: "workspace-1".to_string(),
            updated_at: "2026-06-27T00:00:00Z".to_string(),
            scope,
            action,
            record_id: record_id.to_string(),
            fields,
        }
    }

    fn proposal_set(
        input: &AssistantApprovedRecordProposalInput,
    ) -> AssistantApprovedRecordProposalSetInput {
        AssistantApprovedRecordProposalSetInput {
            proposal_set_id: input.proposal_id.clone(),
            turn_id: input.turn_id.clone(),
            items: vec![AssistantApprovedRecordProposalSetItemInput {
                proposal_id: input.proposal_id.clone(),
                scope: input.scope,
                action: input.action,
                record_id: Some(input.record_id.clone()),
                fields: input.fields.clone(),
            }],
        }
    }

    async fn execute_single(
        pool: &SqlitePool,
        input: &AssistantApprovedRecordProposalInput,
    ) -> AssistantApprovedContactsBundleResult {
        execute_approved_record_proposal_set(pool, &proposal_set(input))
            .await
            .expect("proposal command result")
    }

    async fn assert_succeeded(pool: &SqlitePool, input: &AssistantApprovedRecordProposalInput) {
        let result = execute_single(pool, input).await;
        assert_eq!(result.status, "succeeded", "{:?}", result.errors);
    }

    #[test]
    fn proposal_scope_deserialization_rejects_dormant_mutations() {
        for scope in [
            "projects",
            "estimates",
            "quote_option_presets",
            "estimate_templates",
            "project_structure_templates",
            "cost_component_presets",
        ] {
            let payload = serde_json::json!({
                "proposalId": "proposal-1",
                "turnId": "turn-1",
                "workspaceId": "workspace-1",
                "updatedAt": "2026-06-27T00:00:00Z",
                "scope": scope,
                "action": "create",
                "recordId": "record-1",
                "fields": { "name": "Unsupported" }
            });
            assert!(
                serde_json::from_value::<AssistantApprovedRecordProposalInput>(payload).is_err()
            );
        }
    }

    #[test]
    fn proposal_scope_deserialization_accepts_supported_mutations() {
        for scope in [
            "contacts",
            "materials",
            "labour_rates",
            "equipment_rates",
            "subcontract_rates",
            "wbs_nodes",
            "quote_options",
            "assets",
        ] {
            let payload = serde_json::json!({
                "proposalId": "proposal-1",
                "turnId": "turn-1",
                "workspaceId": "workspace-1",
                "updatedAt": "2026-06-27T00:00:00Z",
                "scope": scope,
                "action": "update",
                "recordId": "record-1",
                "fields": { "name": "Supported" }
            });
            assert!(
                serde_json::from_value::<AssistantApprovedRecordProposalInput>(payload).is_ok()
            );
        }
    }

    #[tokio::test]
    async fn sql_identifier_allowlists_reject_unexpected_inputs() {
        let pool = test_pool().await;
        let input = proposal(
            "p-invalid-identifiers",
            AssistantRecordProposalScope::LabourRates,
            AssistantRecordProposalAction::Create,
            "rate-1",
            serde_json::json!({}),
        );
        let fields = input.fields.as_object().expect("proposal fields object");
        let mut tx = pool.begin().await.expect("begin test transaction");

        let invalid_table = execute_rate(
            &mut tx,
            &input,
            fields,
            "not_a_rate_table",
            Some("work_center"),
        )
        .await
        .expect_err("unexpected table should be rejected");
        assert_eq!(invalid_table, "Invalid table");

        let invalid_column = execute_rate(
            &mut tx,
            &input,
            fields,
            "labour_rate_cards",
            Some("not_a_column"),
        )
        .await
        .expect_err("unexpected detail column should be rejected");
        assert_eq!(invalid_column, "Invalid detail column");
    }

    #[tokio::test]
    async fn supported_scopes_create_and_patch_without_erasing_omitted_fields() {
        let pool = test_pool().await;
        let creates = [
            proposal(
                "p-contact-create",
                AssistantRecordProposalScope::Contacts,
                AssistantRecordProposalAction::Create,
                "contact-1",
                serde_json::json!({"kind":"company","name":"Steel Co","email":"steel@example.invalid"}),
            ),
            proposal(
                "p-material-create",
                AssistantRecordProposalScope::Materials,
                AssistantRecordProposalAction::Create,
                "material-1",
                serde_json::json!({"name":"Steel Plate","unit":"kg","default_rate":4.85,"currency_code":"AUD","category":"Steel"}),
            ),
            proposal(
                "p-labour-create",
                AssistantRecordProposalScope::LabourRates,
                AssistantRecordProposalAction::Create,
                "labour-1",
                serde_json::json!({"name":"Estimator","unit":"hr","default_rate":120,"currency_code":"AUD","work_center":"Office"}),
            ),
            proposal(
                "p-equipment-create",
                AssistantRecordProposalScope::EquipmentRates,
                AssistantRecordProposalAction::Create,
                "equipment-1",
                serde_json::json!({"name":"Crane","unit":"hr","default_rate":350,"currency_code":"AUD","work_center":"Site"}),
            ),
            proposal(
                "p-subcontract-create",
                AssistantRecordProposalScope::SubcontractRates,
                AssistantRecordProposalAction::Create,
                "subcontract-1",
                serde_json::json!({"name":"Scaffold Crew","unit":"day","default_rate":1280,"currency_code":"AUD"}),
            ),
            proposal(
                "p-wbs-create",
                AssistantRecordProposalScope::WbsNodes,
                AssistantRecordProposalAction::Create,
                "wbs-1",
                serde_json::json!({"project_id":"project-1","name":"Structure","type":"trade","code":"STR"}),
            ),
            proposal(
                "p-quote-create",
                AssistantRecordProposalScope::QuoteOptions,
                AssistantRecordProposalAction::Create,
                "quote-1",
                serde_json::json!({"project_id":"project-1","label":"Base","markup_percentage":15,"notes":"Original"}),
            ),
            proposal(
                "p-asset-create",
                AssistantRecordProposalScope::Assets,
                AssistantRecordProposalAction::Create,
                "asset-1",
                serde_json::json!({"project_id":"project-1","name":"Canopy"}),
            ),
        ];
        for input in &creates {
            assert_succeeded(&pool, input).await;
        }

        let updates = [
            proposal(
                "p-contact-update",
                AssistantRecordProposalScope::Contacts,
                AssistantRecordProposalAction::Update,
                "contact-1",
                serde_json::json!({"notes":"Preferred supplier"}),
            ),
            proposal(
                "p-material-update",
                AssistantRecordProposalScope::Materials,
                AssistantRecordProposalAction::Update,
                "material-1",
                serde_json::json!({"default_rate":5.25}),
            ),
            proposal(
                "p-labour-update",
                AssistantRecordProposalScope::LabourRates,
                AssistantRecordProposalAction::Update,
                "labour-1",
                serde_json::json!({"default_rate":125}),
            ),
            proposal(
                "p-equipment-update",
                AssistantRecordProposalScope::EquipmentRates,
                AssistantRecordProposalAction::Update,
                "equipment-1",
                serde_json::json!({"default_rate":375}),
            ),
            proposal(
                "p-subcontract-update",
                AssistantRecordProposalScope::SubcontractRates,
                AssistantRecordProposalAction::Update,
                "subcontract-1",
                serde_json::json!({"default_rate":1320}),
            ),
            proposal(
                "p-wbs-update",
                AssistantRecordProposalScope::WbsNodes,
                AssistantRecordProposalAction::Update,
                "wbs-1",
                serde_json::json!({"name":"Structural steel"}),
            ),
            proposal(
                "p-quote-update",
                AssistantRecordProposalScope::QuoteOptions,
                AssistantRecordProposalAction::Update,
                "quote-1",
                serde_json::json!({"notes":"Updated"}),
            ),
            proposal(
                "p-asset-update",
                AssistantRecordProposalScope::Assets,
                AssistantRecordProposalAction::Update,
                "asset-1",
                serde_json::json!({"name":"Main canopy"}),
            ),
        ];
        for input in &updates {
            assert_succeeded(&pool, input).await;
        }

        let material = sqlx::query("SELECT name, unit, default_rate, currency_code, category FROM material_catalog_items WHERE id = 'material-1'")
            .fetch_one(&pool).await.expect("material");
        assert_eq!(material.get::<String, _>("name"), "Steel Plate");
        assert_eq!(material.get::<String, _>("unit"), "kg");
        assert_eq!(material.get::<f64, _>("default_rate"), 5.25);
        assert_eq!(material.get::<String, _>("currency_code"), "AUD");
        assert_eq!(material.get::<String, _>("category"), "Steel");

        let contact = sqlx::query("SELECT email, notes FROM contacts WHERE id = 'contact-1'")
            .fetch_one(&pool)
            .await
            .expect("contact");
        assert_eq!(contact.get::<String, _>("email"), "steel@example.invalid");
        assert_eq!(contact.get::<String, _>("notes"), "Preferred supplier");

        let wbs = sqlx::query("SELECT project_id, type, name FROM wbs_nodes WHERE id = 'wbs-1'")
            .fetch_one(&pool)
            .await
            .expect("wbs");
        assert_eq!(wbs.get::<String, _>("project_id"), "project-1");
        assert_eq!(wbs.get::<String, _>("type"), "trade");
        assert_eq!(wbs.get::<String, _>("name"), "Structural steel");
    }

    #[tokio::test]
    async fn duplicate_create_cross_workspace_reference_and_double_approval_are_safe() {
        let pool = test_pool().await;
        let create = proposal(
            "p-material-create",
            AssistantRecordProposalScope::Materials,
            AssistantRecordProposalAction::Create,
            "material-1",
            serde_json::json!({"name":"Steel Plate","unit":"kg","default_rate":4.85,"currency_code":"AUD"}),
        );
        assert_succeeded(&pool, &create).await;
        assert_succeeded(&pool, &create).await;
        let executed_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM assistant_action_audit WHERE proposal_id = 'p-material-create' AND status = 'executed'",
        )
        .fetch_one(&pool)
        .await
        .expect("executed audit count");
        assert_eq!(executed_count, 1);

        let duplicate = proposal(
            "p-material-duplicate",
            AssistantRecordProposalScope::Materials,
            AssistantRecordProposalAction::Create,
            "material-2",
            serde_json::json!({"name":"Steel Plate","unit":"kg","default_rate":99,"currency_code":"AUD"}),
        );
        let duplicate_result = execute_single(&pool, &duplicate).await;
        assert_eq!(duplicate_result.status, "failed");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM material_catalog_items")
                .fetch_one(&pool)
                .await
                .expect("material count"),
            1
        );

        sqlx::query("INSERT INTO contacts (id, workspace_id, name) VALUES ('other-contact', 'workspace-2', 'Other')")
            .execute(&pool).await.expect("other workspace contact");
        let cross_workspace = proposal(
            "p-cross-workspace",
            AssistantRecordProposalScope::Contacts,
            AssistantRecordProposalAction::Create,
            "person-cross-workspace",
            serde_json::json!({"kind":"person","name":"Cross Workspace Person","linked_company_id":"other-contact"}),
        );
        let cross_result = execute_single(&pool, &cross_workspace).await;
        assert_eq!(cross_result.status, "failed");
        assert!(cross_result.errors[0].contains("workspace"));

        let cross_project = proposal(
            "p-cross-project",
            AssistantRecordProposalScope::Assets,
            AssistantRecordProposalAction::Create,
            "asset-other",
            serde_json::json!({"project_id":"project-2","name":"Other asset"}),
        );
        let cross_project_result = execute_single(&pool, &cross_project).await;
        assert_eq!(cross_project_result.status, "failed");

        let cross_company = proposal(
            "p-cross-company",
            AssistantRecordProposalScope::Contacts,
            AssistantRecordProposalAction::Create,
            "person-other",
            serde_json::json!({"kind":"person","name":"Mina Hart","linked_company_id":"other-contact"}),
        );
        let cross_company_result = execute_single(&pool, &cross_company).await;
        assert_eq!(cross_company_result.status, "failed");

        let parent = proposal(
            "p-wbs-parent",
            AssistantRecordProposalScope::WbsNodes,
            AssistantRecordProposalAction::Create,
            "wbs-parent",
            serde_json::json!({"project_id":"project-1","name":"Parent","type":"trade"}),
        );
        let child = proposal(
            "p-wbs-child",
            AssistantRecordProposalScope::WbsNodes,
            AssistantRecordProposalAction::Create,
            "wbs-child",
            serde_json::json!({"project_id":"project-1","parent_id":"wbs-parent","name":"Child","type":"item"}),
        );
        assert_succeeded(&pool, &parent).await;
        assert_succeeded(&pool, &child).await;
        let cycle = proposal(
            "p-wbs-cycle",
            AssistantRecordProposalScope::WbsNodes,
            AssistantRecordProposalAction::Update,
            "wbs-parent",
            serde_json::json!({"parent_id":"wbs-child"}),
        );
        let cycle_result = execute_single(&pool, &cycle).await;
        assert_eq!(cycle_result.status, "failed");
        assert!(cycle_result.errors[0].contains("descendant"));
    }

    #[tokio::test]
    async fn proposal_replay_rejects_changed_approved_payload() {
        let pool = test_pool().await;
        let create = proposal(
            "p-replay-identity",
            AssistantRecordProposalScope::Materials,
            AssistantRecordProposalAction::Create,
            "material-replay",
            serde_json::json!({"name":"Replay Plate","unit":"kg","default_rate":4.85}),
        );
        assert_succeeded(&pool, &create).await;
        for change in ["fields", "record", "scope", "action", "turn", "set"] {
            let mut replay = proposal_set(&create);
            match change {
                "fields" => replay.items[0].fields["default_rate"] = serde_json::json!(99),
                "record" => replay.items[0].record_id = Some("another-material".to_string()),
                "scope" => replay.items[0].scope = AssistantRecordProposalScope::LabourRates,
                "action" => replay.items[0].action = AssistantRecordProposalAction::Update,
                "turn" => replay.turn_id = "another-turn".to_string(),
                "set" => replay.proposal_set_id = "another-set".to_string(),
                _ => unreachable!(),
            }
            assert!(
                execute_approved_record_proposal_set(&pool, &replay)
                    .await
                    .is_err(),
                "accepted changed approval identity: {change}",
            );
        }
        assert_eq!(
            sqlx::query_scalar::<_, f64>(
                "SELECT default_rate FROM material_catalog_items WHERE id = 'material-replay'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            4.85,
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM assistant_action_audit WHERE status = 'executed'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1,
        );
    }

    #[tokio::test]
    async fn proposal_set_rejects_duplicate_item_identity_before_writing_or_replaying() {
        let pool = test_pool().await;
        let create = proposal(
            "p-duplicate-item",
            AssistantRecordProposalScope::Materials,
            AssistantRecordProposalAction::Create,
            "material-first-item",
            serde_json::json!({"name":"First Plate","unit":"kg","default_rate":4.85}),
        );
        let mut input = proposal_set(&create);
        input
            .items
            .push(AssistantApprovedRecordProposalSetItemInput {
                proposal_id: create.proposal_id.clone(),
                scope: create.scope,
                action: create.action,
                record_id: Some("material-second-item".to_string()),
                fields: serde_json::json!({"name":"Second Plate","unit":"kg","default_rate":5.25}),
            });
        assert!(execute_approved_record_proposal_set(&pool, &input)
            .await
            .is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM material_catalog_items")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0,
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM assistant_action_audit")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0,
        );
        assert_succeeded(&pool, &create).await;
        assert!(execute_approved_record_proposal_set(&pool, &input)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn proposal_aliases_reject_non_string_or_blank_members_without_creating_records() {
        let pool = test_pool().await;
        for (index, aliases) in [
            serde_json::json!(["plate", {"invalid":"object"}]),
            serde_json::json!([12]),
            serde_json::json!([true]),
            serde_json::json!([null]),
            serde_json::json!(["  "]),
        ]
        .into_iter()
        .enumerate()
        {
            let input = proposal(
                &format!("p-invalid-alias-{index}"),
                AssistantRecordProposalScope::Materials,
                AssistantRecordProposalAction::Create,
                &format!("material-invalid-alias-{index}"),
                serde_json::json!({"name":format!("Plate {index}"),"unit":"kg","default_rate":4.85,"aliases":aliases}),
            );
            let result = execute_single(&pool, &input).await;
            assert_eq!(result.status, "failed");
            assert!(result.errors[0].contains("aliases"));
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM material_catalog_items")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0,
        );
        let valid = proposal(
            "p-valid-alias",
            AssistantRecordProposalScope::Materials,
            AssistantRecordProposalAction::Create,
            "material-valid-alias",
            serde_json::json!({"name":"Valid Plate","unit":"kg","default_rate":4.85,"aliases":["plate","ms plate"]}),
        );
        assert_succeeded(&pool, &valid).await;
    }

    #[tokio::test]
    async fn proposal_set_rolls_back_every_item_when_a_later_item_fails() {
        let pool = test_pool().await;
        let input: AssistantApprovedRecordProposalSetInput =
            serde_json::from_value(serde_json::json!({
                "proposalSetId": "set-rollback",
                "turnId": "turn-rollback",
                "workspaceId": "workspace-1",
                "updatedAt": "2026-06-27T00:00:00Z",
                "items": [
                    {
                        "proposalId": "proposal-material-1",
                        "scope": "materials",
                        "action": "create",
                        "recordId": "material-rollback-1",
                        "fields": {"name":"Atomic Plate","unit":"kg","default_rate":4.85}
                    },
                    {
                        "proposalId": "proposal-material-2",
                        "scope": "materials",
                        "action": "create",
                        "recordId": "material-rollback-2",
                        "fields": {"name":"Atomic Plate","unit":"kg","default_rate":5.25}
                    }
                ]
            }))
            .expect("proposal set input");

        let result = execute_approved_record_proposal_set(&pool, &input)
            .await
            .expect("proposal set result");

        assert_eq!(result.status, "failed");
        assert_eq!(result.success_count, 0);
        assert_eq!(result.failure_count, 2);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM material_catalog_items")
                .fetch_one(&pool)
                .await
                .expect("material count"),
            0
        );
    }

    #[test]
    fn proposal_set_wire_input_does_not_trust_frontend_workspace_or_timestamp() {
        let input: AssistantApprovedRecordProposalSetInput =
            serde_json::from_value(serde_json::json!({
                "proposalSetId": "set-wire",
                "turnId": "turn-wire",
                "items": [{
                    "proposalId": "proposal-wire",
                    "scope": "materials",
                    "action": "create",
                    "fields": {"name":"Wire Plate","unit":"kg","default_rate":4.85}
                }]
            }))
            .expect("proposal set wire input");

        assert_eq!(input.proposal_set_id, "set-wire");
        assert_eq!(input.turn_id, "turn-wire");
        assert_eq!(input.items.len(), 1);
    }

    #[tokio::test]
    async fn proposal_set_commits_ordered_dependencies_once() {
        let pool = test_pool().await;
        let input: AssistantApprovedRecordProposalSetInput =
            serde_json::from_value(serde_json::json!({
                "proposalSetId": "set-dependent",
                "turnId": "turn-dependent",
                "workspaceId": "workspace-1",
                "updatedAt": "2026-06-27T00:00:00Z",
                "items": [
                    {
                        "proposalId": "company-dependent",
                        "scope": "contacts",
                        "action": "create",
                        "fields": {"kind":"company","name":"Atomic Steel Pty Ltd"}
                    },
                    {
                        "proposalId": "person-dependent",
                        "scope": "contacts",
                        "action": "create",
                        "fields": {
                            "kind":"person",
                            "name":"Mina Hart",
                            "linked_company_id":"company-dependent"
                        }
                    }
                ]
            }))
            .expect("dependent proposal set input");

        let first = execute_approved_record_proposal_set(&pool, &input)
            .await
            .expect("first proposal set result");
        let second = execute_approved_record_proposal_set(&pool, &input)
            .await
            .expect("idempotent proposal set result");

        assert_eq!(first.status, "succeeded");
        assert_eq!(first.success_count, 2);
        assert_eq!(second.status, "succeeded");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM contacts")
                .fetch_one(&pool)
                .await
                .expect("contact count"),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM assistant_action_audit WHERE action_id = 'set-dependent' AND status = 'executed'",
            )
            .fetch_one(&pool)
            .await
            .expect("executed audit count"),
            2
        );
    }
}
