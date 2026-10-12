use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use tauri::AppHandle;

use super::helpers::{
    json_array, json_bool_or_default, json_f64_optional, json_f64_required, json_field_to_string,
    json_i64_or_default, json_i64_required, json_string_optional, json_string_or_default,
    json_string_required, prefer_existing_text, should_keep_existing_number,
    supports_separate_tax_identifier, sync_asset_thumbnail_tx, sync_contact_relationships_tx_json,
};
use super::pool::transactional_sqlite_pool;
use super::types::WriteAssistantActionAuditInput;
use super::types::{
    AddProjectFileInput, AddProjectInput, ApplyProjectStructureTemplateInput,
    AssignFilesToAssetInput, AssistantApprovedContactsBundleInput,
    AssistantApprovedContactsBundleResult, BootstrapFoundationInput, CatalogueCompanyLinkScope,
    CatalogueRecordCompanyLinksResult, CompanyCatalogueLinksResult, ContactWriteInput,
    CreateAssetFromFilesInput, CreateProjectWorkspaceInput, CreateQuoteRevisionInput,
    CreateQuoteRevisionResult, DeleteCatalogueItemsInput, DeleteFileInput, DeleteFileResult,
    DeleteQuoteOptionInput, DuplicateProjectInput, LinkedCatalogueRecordSummary,
    LinkedCompanySummary, MergeAssetsInput, MergeAssetsResult, ProjectStructureTemplateBundleInput,
    RemoveFileFromAssetInput, ReplaceAiEvidenceRefsInput, ReplaceCatalogueRecordCompanyLinksInput,
    ReplaceCompanyCatalogueLinksInput, ResetQuoteWorkspaceInput, SaveEstimateInput,
    SetDefaultQuoteOptionInput, SetupImportSessionInput, UngroupAssetInput, UngroupAssetResult,
    UpdateProjectWorkspaceInput,
};
#[cfg(test)]
use super::types::{
    SetupImportAuditInput, SetupImportClassificationSystemOperationInput,
    SetupImportEntityOperationInput,
};
use crate::ai_evidence_cache::remove_ai_evidence_cache_for_file;

pub(crate) async fn begin_immediate(
    pool: &sqlx::SqlitePool,
) -> Result<sqlx::Transaction<'static, sqlx::Sqlite>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("ROLLBACK").execute(&mut *tx).await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *tx).await?;
    Ok(tx)
}

#[tauri::command]
pub async fn add_project_file_command(
    app: AppHandle,
    input: AddProjectFileInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin add project file transaction: {}", e))?;

    if let Some(asset_id) = input.asset_id.as_deref() {
        let asset_row = sqlx::query("SELECT project_id FROM assets WHERE id = ?")
            .bind(asset_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("Load asset before adding project file: {}", e))?;

        let Some(asset_row) = asset_row else {
            return Err("Selected asset could not be found".to_string());
        };

        let asset_project_id: String = asset_row.get("project_id");
        if asset_project_id != input.project_id {
            return Err("File asset must belong to the same project".to_string());
        }
    }

    sqlx::query(
        "INSERT INTO files (id, project_id, asset_id, file_path, original_name, mime_type)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.file_id)
    .bind(&input.project_id)
    .bind(&input.asset_id)
    .bind(&input.file_path)
    .bind(&input.original_name)
    .bind(&input.mime_type)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert project file: {}", e))?;

    if let Some(asset_id) = input.asset_id.as_deref() {
        sync_asset_thumbnail_tx(&mut tx, asset_id).await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit add project file transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_file_command(
    app: AppHandle,
    input: DeleteFileInput,
) -> Result<DeleteFileResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin delete file transaction: {}", e))?;

    let file_row = sqlx::query("SELECT asset_id, file_path FROM files WHERE id = ?")
        .bind(&input.file_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Load file before delete: {}", e))?;

    let Some(file_row) = file_row else {
        tx.rollback()
            .await
            .map_err(|e| format!("Rollback delete file transaction: {}", e))?;
        return Ok(DeleteFileResult { file_path: None });
    };

    let asset_id: Option<String> = file_row.get("asset_id");
    let file_path: String = file_row.get("file_path");
    let workspace_id: String =
        sqlx::query_scalar("SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Read workspace identity before file delete: {}", e))?;

    sqlx::query("DELETE FROM files WHERE id = ?")
        .bind(&input.file_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete file row: {}", e))?;

    if let Some(asset_id) = asset_id.as_deref() {
        sync_asset_thumbnail_tx(&mut tx, asset_id).await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit delete file transaction: {}", e))?;
    if let Err(error) = remove_ai_evidence_cache_for_file(&app, &workspace_id, &input.file_id).await
    {
        log::warn!(
            "[ai-evidence-cache] Deleted file {} left recreatable cache artifacts: {}",
            input.file_id,
            error
        );
    }

    Ok(DeleteFileResult {
        file_path: Some(file_path),
    })
}

#[tauri::command]
pub async fn delete_catalogue_items_command(
    app: AppHandle,
    input: DeleteCatalogueItemsInput,
) -> Result<(), String> {
    let ids = unique_trimmed_ids(&input.ids);
    if ids.is_empty() {
        return Ok(());
    }
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin delete catalogue transaction: {}", e))?;

    let workspace_id: String =
        sqlx::query_scalar("SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                format!(
                    "Read active workspace identity before catalogue delete: {}",
                    e
                )
            })?;

    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve catalogue delete timestamp: {}", e))?;

    for id in ids {
        delete_catalogue_item_tx(&mut tx, input.scope, &workspace_id, &id, &now).await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit delete catalogue transaction: {}", e))?;

    Ok(())
}

async fn delete_catalogue_item_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    scope: CatalogueCompanyLinkScope,
    workspace_id: &str,
    id: &str,
    now: &str,
) -> Result<(), String> {
    let (table_name, source_type, label) = match scope {
        CatalogueCompanyLinkScope::Materials => (
            "material_catalog_items",
            "material_catalog",
            "material catalogue item",
        ),
        CatalogueCompanyLinkScope::LabourRates => {
            ("labour_rate_cards", "labour_rate_card", "labour rate card")
        }
        CatalogueCompanyLinkScope::EquipmentRates => (
            "equipment_rate_cards",
            "equipment_rate_card",
            "equipment rate card",
        ),
        CatalogueCompanyLinkScope::SubcontractRates => (
            "subcontract_rate_cards",
            "subcontract_rate_card",
            "subcontract rate card",
        ),
    };

    let exists_sql = format!("SELECT id FROM {table_name} WHERE id = ? AND workspace_id = ?");
    let target: Option<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(exists_sql.as_str()))
        .bind(id)
        .bind(workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("Load {label} before delete: {e}"))?;
    if target.is_none() {
        return Ok(());
    }

    sqlx::query(
        "UPDATE cost_components
         SET source_type = 'manual', source_id = NULL, updated_at = ?
         WHERE source_type = ? AND source_id = ?",
    )
    .bind(now)
    .bind(source_type)
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Clear linked {label} cost components: {e}"))?;

    let delete_sql = format!("DELETE FROM {table_name} WHERE id = ? AND workspace_id = ?");
    sqlx::query(sqlx::AssertSqlSafe(delete_sql.as_str()))
        .bind(id)
        .bind(workspace_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Delete {label}: {e}"))?;

    Ok(())
}

fn unique_trimmed_ids(ids: &[String]) -> Vec<String> {
    let mut output = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if trimmed.is_empty() || output.iter().any(|existing| existing == trimmed) {
            continue;
        }
        output.push(trimmed.to_string());
    }
    output
}

async fn active_workspace_id_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
) -> Result<String, String> {
    sqlx::query_scalar("SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1")
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("Read active workspace identity: {}", e))
}

async fn validate_company_ids_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    workspace_id: &str,
    company_ids: &[String],
) -> Result<(), String> {
    if company_ids.is_empty() {
        return Ok(());
    }

    let mut query_builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
        "SELECT id FROM contacts WHERE kind = 'company' AND workspace_id = ",
    );
    query_builder.push_bind(workspace_id);
    query_builder.push(" AND id IN (");

    let mut separated = query_builder.separated(", ");
    for id in company_ids.iter() {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");

    let existing_ids: std::collections::HashSet<String> = query_builder
        .build_query_scalar::<String>()
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("Validate linked companies: {}", e))?
        .into_iter()
        .collect();

    if existing_ids.len() != company_ids.len() {
        for id in company_ids {
            if !existing_ids.contains(id) {
                return Err(format!(
                    "Linked company \"{}\" was not found in this workspace",
                    id
                ));
            }
        }
    }

    Ok(())
}

async fn validate_catalogue_record_exists_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    workspace_id: &str,
    scope: CatalogueCompanyLinkScope,
    record_id: &str,
) -> Result<(), String> {
    let exists: Option<String> = match scope {
        CatalogueCompanyLinkScope::Materials => {
            sqlx::query_scalar(
                "SELECT id FROM material_catalog_items WHERE id = ? AND workspace_id = ?",
            )
            .bind(record_id)
            .bind(workspace_id)
            .fetch_optional(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::LabourRates => {
            sqlx::query_scalar("SELECT id FROM labour_rate_cards WHERE id = ? AND workspace_id = ?")
                .bind(record_id)
                .bind(workspace_id)
                .fetch_optional(&mut **tx)
                .await
        }
        CatalogueCompanyLinkScope::EquipmentRates => {
            sqlx::query_scalar(
                "SELECT id FROM equipment_rate_cards WHERE id = ? AND workspace_id = ?",
            )
            .bind(record_id)
            .bind(workspace_id)
            .fetch_optional(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::SubcontractRates => {
            sqlx::query_scalar(
                "SELECT id FROM subcontract_rate_cards WHERE id = ? AND workspace_id = ?",
            )
            .bind(record_id)
            .bind(workspace_id)
            .fetch_optional(&mut **tx)
            .await
        }
    }
    .map_err(|e| format!("Validate catalogue record: {}", e))?;
    if exists.is_none() {
        return Err(format!(
            "Selected {:?} record \"{}\" was not found in this workspace",
            scope, record_id
        ));
    }
    Ok(())
}

async fn replace_link_table_rows_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    workspace_id: &str,
    scope: CatalogueCompanyLinkScope,
    record_id: &str,
    company_ids: &[String],
) -> Result<(), String> {
    validate_catalogue_record_exists_tx(tx, workspace_id, scope, record_id).await?;
    validate_company_ids_tx(tx, workspace_id, company_ids).await?;
    match scope {
        CatalogueCompanyLinkScope::Materials => {
            sqlx::query("DELETE FROM company_material_links WHERE material_id = ?")
                .bind(record_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Clear material company links: {}", e))?;

            if !company_ids.is_empty() {
                let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
                    "INSERT INTO company_material_links (company_id, material_id) ",
                );
                qb.push_values(company_ids, |mut b, company_id| {
                    b.push_bind(company_id).push_bind(record_id);
                });
                qb.build()
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Insert material company links: {}", e))?;
            }
        }
        CatalogueCompanyLinkScope::LabourRates => {
            sqlx::query("DELETE FROM company_labour_rate_links WHERE labour_rate_id = ?")
                .bind(record_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Clear labour-rate company links: {}", e))?;

            if !company_ids.is_empty() {
                let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
                    "INSERT INTO company_labour_rate_links (company_id, labour_rate_id) ",
                );
                qb.push_values(company_ids, |mut b, company_id| {
                    b.push_bind(company_id).push_bind(record_id);
                });
                qb.build()
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Insert labour-rate company links: {}", e))?;
            }
        }
        CatalogueCompanyLinkScope::EquipmentRates => {
            sqlx::query("DELETE FROM company_equipment_rate_links WHERE equipment_rate_id = ?")
                .bind(record_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Clear equipment-rate company links: {}", e))?;

            if !company_ids.is_empty() {
                let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
                    "INSERT INTO company_equipment_rate_links (company_id, equipment_rate_id) ",
                );
                qb.push_values(company_ids, |mut b, company_id| {
                    b.push_bind(company_id).push_bind(record_id);
                });
                qb.build()
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Insert equipment-rate company links: {}", e))?;
            }
        }
        CatalogueCompanyLinkScope::SubcontractRates => {
            sqlx::query("DELETE FROM company_subcontract_rate_links WHERE subcontract_rate_id = ?")
                .bind(record_id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("Clear subcontract-rate company links: {}", e))?;

            if !company_ids.is_empty() {
                let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
                    "INSERT INTO company_subcontract_rate_links (company_id, subcontract_rate_id) ",
                );
                qb.push_values(company_ids, |mut b, company_id| {
                    b.push_bind(company_id).push_bind(record_id);
                });
                qb.build()
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Insert subcontract-rate company links: {}", e))?;
            }
        }
    }
    Ok(())
}

async fn insert_company_catalogue_link_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    workspace_id: &str,
    scope: CatalogueCompanyLinkScope,
    record_id: &str,
    company_id: &str,
) -> Result<(), String> {
    validate_company_ids_tx(tx, workspace_id, &[company_id.to_string()]).await?;
    validate_catalogue_record_exists_tx(tx, workspace_id, scope, record_id).await?;
    match scope {
        CatalogueCompanyLinkScope::Materials => {
            sqlx::query("INSERT OR IGNORE INTO company_material_links (company_id, material_id) VALUES (?, ?)")
                .bind(company_id)
                .bind(record_id)
                .execute(&mut **tx)
                .await
        }
        CatalogueCompanyLinkScope::LabourRates => {
            sqlx::query("INSERT OR IGNORE INTO company_labour_rate_links (company_id, labour_rate_id) VALUES (?, ?)")
                .bind(company_id)
                .bind(record_id)
                .execute(&mut **tx)
                .await
        }
        CatalogueCompanyLinkScope::EquipmentRates => {
            sqlx::query("INSERT OR IGNORE INTO company_equipment_rate_links (company_id, equipment_rate_id) VALUES (?, ?)")
                .bind(company_id)
                .bind(record_id)
                .execute(&mut **tx)
                .await
        }
        CatalogueCompanyLinkScope::SubcontractRates => {
            sqlx::query("INSERT OR IGNORE INTO company_subcontract_rate_links (company_id, subcontract_rate_id) VALUES (?, ?)")
                .bind(company_id)
                .bind(record_id)
                .execute(&mut **tx)
                .await
        }
    }
    .map_err(|e| format!("Link imported catalogue record to company: {}", e))?;
    Ok(())
}

async fn linked_companies_for_record_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    scope: CatalogueCompanyLinkScope,
    record_id: &str,
) -> Result<Vec<LinkedCompanySummary>, String> {
    let rows = match scope {
        CatalogueCompanyLinkScope::Materials => {
            sqlx::query(
                "SELECT c.id, c.display_name FROM company_material_links AS link INNER JOIN contacts AS c ON c.id = link.company_id WHERE link.material_id = ? ORDER BY c.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::LabourRates => {
            sqlx::query(
                "SELECT c.id, c.display_name FROM company_labour_rate_links AS link INNER JOIN contacts AS c ON c.id = link.company_id WHERE link.labour_rate_id = ? ORDER BY c.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::EquipmentRates => {
            sqlx::query(
                "SELECT c.id, c.display_name FROM company_equipment_rate_links AS link INNER JOIN contacts AS c ON c.id = link.company_id WHERE link.equipment_rate_id = ? ORDER BY c.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::SubcontractRates => {
            sqlx::query(
                "SELECT c.id, c.display_name FROM company_subcontract_rate_links AS link INNER JOIN contacts AS c ON c.id = link.company_id WHERE link.subcontract_rate_id = ? ORDER BY c.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(&mut **tx)
            .await
        }
    }
    .map_err(|e| format!("Load linked companies: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|row| LinkedCompanySummary {
            id: row.get("id"),
            display_name: row.get("display_name"),
        })
        .collect())
}

async fn linked_records_for_company_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    scope: CatalogueCompanyLinkScope,
    company_id: &str,
) -> Result<Vec<LinkedCatalogueRecordSummary>, String> {
    let rows = match scope {
        CatalogueCompanyLinkScope::Materials => {
            sqlx::query(
                "SELECT record.id, record.name FROM company_material_links AS link INNER JOIN material_catalog_items AS record ON record.id = link.material_id WHERE link.company_id = ? ORDER BY record.name COLLATE NOCASE",
            )
            .bind(company_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::LabourRates => {
            sqlx::query(
                "SELECT record.id, record.name FROM company_labour_rate_links AS link INNER JOIN labour_rate_cards AS record ON record.id = link.labour_rate_id WHERE link.company_id = ? ORDER BY record.name COLLATE NOCASE",
            )
            .bind(company_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::EquipmentRates => {
            sqlx::query(
                "SELECT record.id, record.name FROM company_equipment_rate_links AS link INNER JOIN equipment_rate_cards AS record ON record.id = link.equipment_rate_id WHERE link.company_id = ? ORDER BY record.name COLLATE NOCASE",
            )
            .bind(company_id)
            .fetch_all(&mut **tx)
            .await
        }
        CatalogueCompanyLinkScope::SubcontractRates => {
            sqlx::query(
                "SELECT record.id, record.name FROM company_subcontract_rate_links AS link INNER JOIN subcontract_rate_cards AS record ON record.id = link.subcontract_rate_id WHERE link.company_id = ? ORDER BY record.name COLLATE NOCASE",
            )
            .bind(company_id)
            .fetch_all(&mut **tx)
            .await
        }
    }
    .map_err(|e| format!("Load linked catalogue records: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|row| LinkedCatalogueRecordSummary {
            id: row.get("id"),
            name: row.get("name"),
        })
        .collect())
}

#[tauri::command]
pub async fn replace_catalogue_record_company_links_command(
    app: AppHandle,
    input: ReplaceCatalogueRecordCompanyLinksInput,
) -> Result<CatalogueRecordCompanyLinksResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin replace catalogue company links transaction: {}", e))?;
    let workspace_id = active_workspace_id_tx(&mut tx).await?;
    let company_ids = unique_trimmed_ids(&input.company_ids);
    replace_link_table_rows_tx(
        &mut tx,
        &workspace_id,
        input.scope,
        input.record_id.trim(),
        &company_ids,
    )
    .await?;
    let companies =
        linked_companies_for_record_tx(&mut tx, input.scope, input.record_id.trim()).await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit replace catalogue company links transaction: {}", e))?;
    Ok(CatalogueRecordCompanyLinksResult {
        scope: input.scope,
        record_id: input.record_id.trim().to_string(),
        companies,
    })
}

#[tauri::command]
pub async fn replace_company_catalogue_links_command(
    app: AppHandle,
    input: ReplaceCompanyCatalogueLinksInput,
) -> Result<CompanyCatalogueLinksResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin replace company catalogue links transaction: {}", e))?;
    let workspace_id = active_workspace_id_tx(&mut tx).await?;
    let company_id = input.company_id.trim().to_string();
    validate_company_ids_tx(&mut tx, &workspace_id, std::slice::from_ref(&company_id)).await?;

    sqlx::query("DELETE FROM company_material_links WHERE company_id = ?")
        .bind(&company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Clear company material links: {}", e))?;
    let material_ids = unique_trimmed_ids(&input.material_ids);
    for record_id in &material_ids {
        validate_catalogue_record_exists_tx(
            &mut tx,
            &workspace_id,
            CatalogueCompanyLinkScope::Materials,
            &record_id,
        )
        .await?;
    }

    if !material_ids.is_empty() {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "INSERT INTO company_material_links (company_id, material_id) ",
        );
        qb.push_values(&material_ids, |mut b, record_id| {
            b.push_bind(&company_id).push_bind(record_id);
        });
        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert company material links: {}", e))?;
    }

    sqlx::query("DELETE FROM company_labour_rate_links WHERE company_id = ?")
        .bind(&company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Clear company labour-rate links: {}", e))?;
    let labour_rate_ids = unique_trimmed_ids(&input.labour_rate_ids);
    for record_id in &labour_rate_ids {
        validate_catalogue_record_exists_tx(
            &mut tx,
            &workspace_id,
            CatalogueCompanyLinkScope::LabourRates,
            &record_id,
        )
        .await?;
    }

    if !labour_rate_ids.is_empty() {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "INSERT INTO company_labour_rate_links (company_id, labour_rate_id) ",
        );
        qb.push_values(&labour_rate_ids, |mut b, record_id| {
            b.push_bind(&company_id).push_bind(record_id);
        });
        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert company labour-rate links: {}", e))?;
    }

    sqlx::query("DELETE FROM company_equipment_rate_links WHERE company_id = ?")
        .bind(&company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Clear company equipment-rate links: {}", e))?;
    let equipment_rate_ids = unique_trimmed_ids(&input.equipment_rate_ids);
    for record_id in &equipment_rate_ids {
        validate_catalogue_record_exists_tx(
            &mut tx,
            &workspace_id,
            CatalogueCompanyLinkScope::EquipmentRates,
            &record_id,
        )
        .await?;
    }

    if !equipment_rate_ids.is_empty() {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "INSERT INTO company_equipment_rate_links (company_id, equipment_rate_id) ",
        );
        qb.push_values(&equipment_rate_ids, |mut b, record_id| {
            b.push_bind(&company_id).push_bind(record_id);
        });
        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert company equipment-rate links: {}", e))?;
    }

    sqlx::query("DELETE FROM company_subcontract_rate_links WHERE company_id = ?")
        .bind(&company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Clear company subcontract-rate links: {}", e))?;
    let subcontract_rate_ids = unique_trimmed_ids(&input.subcontract_rate_ids);
    for record_id in &subcontract_rate_ids {
        validate_catalogue_record_exists_tx(
            &mut tx,
            &workspace_id,
            CatalogueCompanyLinkScope::SubcontractRates,
            &record_id,
        )
        .await?;
    }

    if !subcontract_rate_ids.is_empty() {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "INSERT INTO company_subcontract_rate_links (company_id, subcontract_rate_id) ",
        );
        qb.push_values(&subcontract_rate_ids, |mut b, record_id| {
            b.push_bind(&company_id).push_bind(record_id);
        });
        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert company subcontract-rate links: {}", e))?;
    }

    let materials =
        linked_records_for_company_tx(&mut tx, CatalogueCompanyLinkScope::Materials, &company_id)
            .await?;
    let labour_rates =
        linked_records_for_company_tx(&mut tx, CatalogueCompanyLinkScope::LabourRates, &company_id)
            .await?;
    let equipment_rates = linked_records_for_company_tx(
        &mut tx,
        CatalogueCompanyLinkScope::EquipmentRates,
        &company_id,
    )
    .await?;
    let subcontract_rates = linked_records_for_company_tx(
        &mut tx,
        CatalogueCompanyLinkScope::SubcontractRates,
        &company_id,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit replace company catalogue links transaction: {}", e))?;

    Ok(CompanyCatalogueLinksResult {
        company_id,
        materials,
        labour_rates,
        equipment_rates,
        subcontract_rates,
    })
}

#[tauri::command]
pub async fn delete_quote_option_command(
    app: AppHandle,
    input: DeleteQuoteOptionInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin delete quote option transaction: {}", e))?;

    let target_row = sqlx::query(
        "SELECT id, project_id, is_default, sort_order, updated_at
         FROM quote_options
         WHERE id = ?",
    )
    .bind(&input.option_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Load quote option before delete: {}", e))?;

    let Some(target_row) = target_row else {
        tx.rollback()
            .await
            .map_err(|e| format!("Rollback delete quote option transaction: {}", e))?;
        return Ok(());
    };

    let project_id: String = target_row.get("project_id");
    let target_is_default = target_row.get::<i64, _>("is_default") != 0;

    let project_rows = sqlx::query(
        "SELECT id, is_default, sort_order, updated_at
         FROM quote_options
         WHERE project_id = ?
         ORDER BY sort_order ASC, created_at ASC",
    )
    .bind(&project_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("Load project quote options before delete: {}", e))?;

    if project_rows.len() <= 1 {
        tx.rollback()
            .await
            .map_err(|e| format!("Rollback single-option delete quote transaction: {}", e))?;
        return Ok(());
    }

    sqlx::query("DELETE FROM quote_options WHERE id = ?")
        .bind(&input.option_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete quote option row: {}", e))?;

    let remaining_rows = project_rows
        .into_iter()
        .filter(|row| row.get::<String, _>("id") != input.option_id)
        .collect::<Vec<_>>();

    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve quote option delete timestamp: {}", e))?;

    for (index, row) in remaining_rows.iter().enumerate() {
        let row_id: String = row.get("id");
        let row_is_default = row.get::<i64, _>("is_default") != 0;
        let row_sort_order: i64 = row.get("sort_order");
        let row_updated_at: String = row.get("updated_at");
        let next_is_default = if target_is_default {
            index == 0
        } else {
            row_is_default
        };
        let next_updated_at = if row_sort_order != index as i64
            || (target_is_default && row_is_default != (index == 0))
        {
            now.as_str()
        } else {
            row_updated_at.as_str()
        };

        sqlx::query(
            "UPDATE quote_options
             SET sort_order = ?, is_default = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(index as i64)
        .bind(if next_is_default { 1 } else { 0 })
        .bind(next_updated_at)
        .bind(&row_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Reindex quote option after delete: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit delete quote option transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn set_default_quote_option_command(
    app: AppHandle,
    input: SetDefaultQuoteOptionInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin set default quote option transaction: {}", e))?;

    let option_row = sqlx::query("SELECT project_id FROM quote_options WHERE id = ?")
        .bind(&input.option_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Load quote option before set default: {}", e))?;

    let Some(option_row) = option_row else {
        return Err("Quote option could not be found".to_string());
    };

    let project_id: String = option_row.get("project_id");
    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve set default quote option timestamp: {}", e))?;

    sqlx::query("UPDATE quote_options SET is_default = 0 WHERE project_id = ? AND id != ?")
        .bind(&project_id)
        .bind(&input.option_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Clear sibling default quote options: {}", e))?;

    sqlx::query("UPDATE quote_options SET is_default = 1, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&input.option_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Persist default quote option: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit set default quote option transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn upsert_local_bootstrap_foundation(
    app: AppHandle,
    input: BootstrapFoundationInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    upsert_local_bootstrap_foundation_on_pool(&pool, input).await
}

pub(crate) async fn upsert_local_bootstrap_foundation_on_pool(
    pool: &sqlx::SqlitePool,
    input: BootstrapFoundationInput,
) -> Result<(), String> {
    let mut tx = begin_immediate(pool)
        .await
        .map_err(|e| format!("Begin bootstrap foundation transaction: {}", e))?;

    let existing_workspace = sqlx::query(
        "SELECT bootstrap_completed_at, onboarding_completed_at, workspace_role FROM workspace_identity WHERE id = ?",
    )
    .bind(&input.workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Load workspace identity during bootstrap: {}", e))?;

    if let Some(row) = existing_workspace {
        let bootstrap_completed_at = row
            .get::<Option<String>, _>("bootstrap_completed_at")
            .unwrap_or_else(|| input.now.clone());
        let onboarding_completed_at = row
            .get::<Option<String>, _>("onboarding_completed_at")
            .or(input.onboarding_completed_at.clone());
        let workspace_role = row
            .get::<Option<String>, _>("workspace_role")
            .unwrap_or_else(|| input.workspace_role.clone());

        sqlx::query(
            "UPDATE workspace_identity
             SET bootstrap_completed_at = ?,
                 onboarding_completed_at = ?,
                 onboarding_version = ?,
                 workspace_role = ?,
                 updated_at = ?
             WHERE id = ?",
        )
        .bind(bootstrap_completed_at)
        .bind(onboarding_completed_at)
        .bind(input.onboarding_version)
        .bind(workspace_role)
        .bind(&input.now)
        .bind(&input.workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update workspace identity during bootstrap: {}", e))?;
    } else {
        sqlx::query(
            "INSERT INTO workspace_identity
             (id, bootstrap_completed_at, onboarding_completed_at, onboarding_version, workspace_role)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&input.workspace_id)
        .bind(&input.now)
        .bind(&input.onboarding_completed_at)
        .bind(input.onboarding_version)
        .bind(&input.workspace_role)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert workspace identity during bootstrap: {}", e))?;
    }

    let existing_profile = sqlx::query(
        "SELECT display_name, country_code, business_name, logo_file_path, business_id_label, business_id_value, tax_id_label, tax_id_value, tax_display_label, tax_rate_percentage, business_contact_name, business_contact_first_name, business_contact_last_name, business_contact_email, business_contact_phone, business_contact_phone_e164, business_contact_phone_country_code, currency_code, currency_symbol, measurement_unit, date_format, language_locale, number_locale FROM workspace_profile WHERE workspace_id = ?",
    )
    .bind(&input.workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Load workspace profile during bootstrap: {}", e))?;

    if let Some(row) = existing_profile {
        sqlx::query(
            "UPDATE workspace_profile
             SET display_name = ?,
                 country_code = ?,
                 business_name = ?,
                 logo_file_path = ?,
                 business_id_label = ?,
                 business_id_value = ?,
                 tax_id_label = ?,
                 tax_id_value = ?,
                 tax_display_label = ?,
                 tax_rate_percentage = ?,
                 business_contact_name = ?,
                 business_contact_first_name = ?,
                 business_contact_last_name = ?,
                 business_contact_email = ?,
                 business_contact_phone = ?,
                 business_contact_phone_e164 = ?,
                 business_contact_phone_country_code = ?,
                 currency_code = ?,
                 currency_symbol = ?,
                 measurement_unit = ?,
                 date_format = ?,
                 language_locale = ?,
                 number_locale = ?,
                 updated_at = ?
             WHERE workspace_id = ?",
        )
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("display_name").as_deref(),
            &input.display_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("country_code").as_deref(),
            &input.country_code,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_name").as_deref(),
            &input.business_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("logo_file_path").as_deref(),
            &input.logo_file_path,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_id_label").as_deref(),
            &input.business_id_label,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_id_value").as_deref(),
            &input.business_id_value,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("tax_id_label").as_deref(),
            &input.tax_id_label,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("tax_id_value").as_deref(),
            &input.tax_id_value,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("tax_display_label").as_deref(),
            &input.tax_display_label,
        ))
        .bind(
            if should_keep_existing_number(row.get::<Option<f64>, _>("tax_rate_percentage")) {
                row.get::<Option<f64>, _>("tax_rate_percentage")
                    .unwrap_or(input.tax_rate_percentage)
            } else {
                input.tax_rate_percentage
            },
        )
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_name")
                .as_deref(),
            &input.business_contact_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_first_name")
                .as_deref(),
            &input.business_contact_first_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_last_name")
                .as_deref(),
            &input.business_contact_last_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_email")
                .as_deref(),
            &input.business_contact_email,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_phone")
                .as_deref(),
            &input.business_contact_phone,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_phone_e164")
                .as_deref(),
            &input.business_contact_phone_e164,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("business_contact_phone_country_code")
                .as_deref(),
            &input.business_contact_phone_country_code,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("currency_code").as_deref(),
            &input.currency_code,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("currency_symbol").as_deref(),
            &input.currency_symbol,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("measurement_unit").as_deref(),
            &input.measurement_unit,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("date_format").as_deref(),
            &input.date_format,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("language_locale").as_deref(),
            &input.language_locale,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("number_locale").as_deref(),
            &input.number_locale,
        ))
        .bind(&input.now)
        .bind(&input.workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update workspace profile during bootstrap: {}", e))?;
    } else {
        sqlx::query(
            "INSERT INTO workspace_profile
             (workspace_id, display_name, country_code, business_name, logo_file_path, business_id_label, business_id_value, tax_id_label, tax_id_value, tax_display_label, tax_rate_percentage, abn, business_address, business_contact_name, business_contact_first_name, business_contact_last_name, business_contact_email, business_contact_phone, business_contact_phone_e164, business_contact_phone_country_code, currency_code, currency_symbol, measurement_unit, date_format, language_locale, number_locale)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.workspace_id)
        .bind(&input.display_name)
        .bind(&input.country_code)
        .bind(&input.business_name)
        .bind(&input.logo_file_path)
        .bind(&input.business_id_label)
        .bind(&input.business_id_value)
        .bind(&input.tax_id_label)
        .bind(&input.tax_id_value)
        .bind(&input.tax_display_label)
        .bind(input.tax_rate_percentage)
        .bind(if input.business_id_label == "ABN" {
            input.business_id_value.clone()
        } else {
            String::new()
        })
        .bind(&input.business_contact_name)
        .bind(&input.business_contact_first_name)
        .bind(&input.business_contact_last_name)
        .bind(&input.business_contact_email)
        .bind(&input.business_contact_phone)
        .bind(&input.business_contact_phone_e164)
        .bind(&input.business_contact_phone_country_code)
        .bind(&input.currency_code)
        .bind(&input.currency_symbol)
        .bind(&input.measurement_unit)
        .bind(&input.date_format)
        .bind(&input.language_locale)
        .bind(&input.number_locale)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert workspace profile during bootstrap: {}", e))?;
    }

    let existing_onboarding_profile =
        sqlx::query("SELECT workspace_id FROM workspace_onboarding_profile WHERE workspace_id = ?")
            .bind(&input.workspace_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("Load workspace onboarding profile during bootstrap: {}", e))?;

    if existing_onboarding_profile.is_none() {
        sqlx::query(
            "INSERT INTO workspace_onboarding_profile
             (workspace_id, primary_operator_role, industry)
             VALUES (?, ?, ?)",
        )
        .bind(&input.workspace_id)
        .bind(&input.primary_operator_role)
        .bind(&input.industry)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            format!(
                "Insert workspace onboarding profile during bootstrap: {}",
                e
            )
        })?;
    }

    let existing_member = sqlx::query(
        "SELECT role, display_name, first_name, last_name, email, avatar_path FROM workspace_members WHERE id = ?",
    )
    .bind(&input.primary_member_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Load workspace member during bootstrap: {}", e))?;

    if let Some(row) = existing_member {
        sqlx::query(
            "UPDATE workspace_members
             SET role = ?,
                 display_name = ?,
                 first_name = ?,
                 last_name = ?,
                 email = ?,
                 avatar_path = ?,
                 updated_at = ?
             WHERE id = ?",
        )
        .bind(
            row.get::<Option<String>, _>("role")
                .unwrap_or_else(|| input.workspace_role.clone()),
        )
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("display_name").as_deref(),
            &input.business_contact_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("first_name").as_deref(),
            &input.business_contact_first_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("last_name").as_deref(),
            &input.business_contact_last_name,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("email").as_deref(),
            &input.member_email,
        ))
        .bind(prefer_existing_text(
            row.get::<Option<String>, _>("avatar_path").as_deref(),
            &input.avatar_path,
        ))
        .bind(&input.now)
        .bind(&input.primary_member_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update workspace member during bootstrap: {}", e))?;
    } else {
        sqlx::query(
            "INSERT INTO workspace_members
             (id, workspace_id, role, display_name, first_name, last_name, email, avatar_path, is_primary, joined_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(&input.primary_member_id)
        .bind(&input.workspace_id)
        .bind(&input.workspace_role)
        .bind(&input.business_contact_name)
        .bind(&input.business_contact_first_name)
        .bind(&input.business_contact_last_name)
        .bind(&input.member_email)
        .bind(&input.avatar_path)
        .bind(&input.now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert workspace member during bootstrap: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit bootstrap foundation transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn replace_ai_evidence_refs_command(
    app: AppHandle,
    input: ReplaceAiEvidenceRefsInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin AI evidence replace transaction: {}", e))?;

    sqlx::query("DELETE FROM ai_evidence_refs WHERE run_id = ?")
        .bind(&input.run_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete AI evidence refs: {}", e))?;

    for chunk in input.refs.chunks(50) {
        let mut query_builder = QueryBuilder::new(
            "INSERT INTO ai_evidence_refs
             (id, run_id, asset_id, file_id, file_name, artifact_kind, page_number, view_label, evidence_identifier, locator_json, draft_entity_kind, draft_entity_key, confidence_json, quote_path, summary) "
        );

        query_builder.push_values(chunk, |mut b, entry| {
            b.push_bind(uuid::Uuid::new_v4().to_string())
                .push_bind(&input.run_id)
                .push_bind(&input.asset_id)
                .push_bind(&entry.file_id)
                .push_bind(&entry.file_name)
                .push_bind(
                    entry
                        .artifact_kind
                        .clone()
                        .unwrap_or_else(|| "text".to_string()),
                )
                .push_bind(entry.page_number)
                .push_bind(&entry.view_label)
                .push_bind(entry.evidence_identifier.clone().unwrap_or_default())
                .push_bind(
                    entry
                        .locator_json
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({}))
                        .to_string(),
                )
                .push_bind(entry.draft_entity_kind.clone().unwrap_or_default())
                .push_bind(entry.draft_entity_key.clone().unwrap_or_default())
                .push_bind(
                    entry
                        .confidence_json
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({}))
                        .to_string(),
                )
                .push_bind(&entry.quote_path)
                .push_bind(&entry.summary);
        });

        query_builder
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert AI evidence refs chunk: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit AI evidence replace transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn create_asset_from_files_command(
    app: AppHandle,
    input: CreateAssetFromFilesInput,
) -> Result<(), String> {
    if input.file_ids.is_empty() {
        return Ok(());
    }

    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin create asset from files transaction: {}", e))?;

    let mut file_query =
        QueryBuilder::<Sqlite>::new("SELECT id, asset_id FROM files WHERE project_id = ");
    file_query.push_bind(&input.project_id).push(" AND id IN (");
    {
        let mut separated = file_query.separated(", ");
        for file_id in &input.file_ids {
            separated.push_bind(file_id);
        }
    }
    file_query.push(")");

    let file_rows = file_query
        .build()
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("Load files for create asset from files: {}", e))?;

    if file_rows.len() != input.file_ids.len() {
        return Err("One or more files could not be found for this project".to_string());
    }
    if file_rows
        .iter()
        .any(|row| row.get::<Option<String>, _>("asset_id").is_some())
    {
        return Err("Only review-pool files can be grouped into a new asset".to_string());
    }

    sqlx::query(
        "INSERT INTO assets (id, project_id, display_name, is_selected, quote_quantity, is_pdf_included, thumbnail_file_id)
         VALUES (?, ?, ?, 1, 1, 1, NULL)",
    )
    .bind(&input.asset_id)
    .bind(&input.project_id)
    .bind(&input.display_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert asset during create asset from files: {}", e))?;

    let mut update_query = QueryBuilder::<Sqlite>::new("UPDATE files SET asset_id = ");
    update_query
        .push_bind(&input.asset_id)
        .push(" WHERE project_id = ")
        .push_bind(&input.project_id)
        .push(" AND id IN (");
    {
        let mut separated = update_query.separated(", ");
        for file_id in &input.file_ids {
            separated.push_bind(file_id);
        }
    }
    update_query.push(")");
    update_query
        .build()
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Assign files during create asset from files: {}", e))?;

    sync_asset_thumbnail_tx(&mut tx, &input.asset_id).await?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit create asset from files transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn assign_files_to_asset_command(
    app: AppHandle,
    input: AssignFilesToAssetInput,
) -> Result<(), String> {
    if input.file_ids.is_empty() {
        return Ok(());
    }

    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin assign files to asset transaction: {}", e))?;

    let asset_row =
        sqlx::query("SELECT thumbnail_file_id FROM assets WHERE id = ? AND project_id = ?")
            .bind(&input.asset_id)
            .bind(&input.project_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("Load asset before assigning files: {}", e))?;
    let Some(asset_row) = asset_row else {
        return Err("Target asset could not be found for this project".to_string());
    };
    let thumbnail_file_id: Option<String> = asset_row.get("thumbnail_file_id");

    let mut file_query =
        QueryBuilder::<Sqlite>::new("SELECT id, asset_id FROM files WHERE project_id = ");
    file_query.push_bind(&input.project_id).push(" AND id IN (");
    {
        let mut separated = file_query.separated(", ");
        for file_id in &input.file_ids {
            separated.push_bind(file_id);
        }
    }
    file_query.push(")");
    let file_rows = file_query
        .build()
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("Load files before assigning to asset: {}", e))?;

    if file_rows.len() != input.file_ids.len() {
        return Err("One or more files could not be found for this project".to_string());
    }
    if file_rows
        .iter()
        .any(|row| row.get::<Option<String>, _>("asset_id").is_some())
    {
        return Err("Only review-pool files can be added to an existing asset".to_string());
    }

    let mut update_query = QueryBuilder::<Sqlite>::new("UPDATE files SET asset_id = ");
    update_query
        .push_bind(&input.asset_id)
        .push(" WHERE project_id = ")
        .push_bind(&input.project_id)
        .push(" AND id IN (");
    {
        let mut separated = update_query.separated(", ");
        for file_id in &input.file_ids {
            separated.push_bind(file_id);
        }
    }
    update_query.push(")");
    update_query
        .build()
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Assign files to asset: {}", e))?;

    if thumbnail_file_id.is_none() {
        sync_asset_thumbnail_tx(&mut tx, &input.asset_id).await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit assign files to asset transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn merge_assets_command(
    app: AppHandle,
    input: MergeAssetsInput,
) -> Result<MergeAssetsResult, String> {
    if input.source_asset_ids.is_empty() {
        return Ok(MergeAssetsResult {
            estimates_discarded: false,
        });
    }

    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin merge assets transaction: {}", e))?;

    let mut estimate_query =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*) as count FROM estimates WHERE asset_id IN (");
    {
        let mut separated = estimate_query.separated(", ");
        for asset_id in &input.source_asset_ids {
            separated.push_bind(asset_id);
        }
    }
    estimate_query.push(")");
    let estimate_count: i64 = estimate_query
        .build_query_scalar()
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Count source estimates during merge assets: {}", e))?;

    let mut update_files = QueryBuilder::<Sqlite>::new("UPDATE files SET asset_id = ");
    update_files
        .push_bind(&input.target_asset_id)
        .push(" WHERE asset_id IN (");
    {
        let mut separated = update_files.separated(", ");
        for asset_id in &input.source_asset_ids {
            separated.push_bind(asset_id);
        }
    }
    update_files.push(")");
    update_files
        .build()
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Move files during merge assets: {}", e))?;

    if let Some(name) = input.new_name {
        sqlx::query("UPDATE assets SET display_name = ? WHERE id = ?")
            .bind(name)
            .bind(&input.target_asset_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Rename target asset during merge assets: {}", e))?;
    }

    sync_asset_thumbnail_tx(&mut tx, &input.target_asset_id).await?;

    let mut delete_assets = QueryBuilder::<Sqlite>::new("DELETE FROM assets WHERE id IN (");
    {
        let mut separated = delete_assets.separated(", ");
        for asset_id in &input.source_asset_ids {
            separated.push_bind(asset_id);
        }
    }
    delete_assets.push(")");
    delete_assets
        .build()
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete merged source assets: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit merge assets transaction: {}", e))?;

    Ok(MergeAssetsResult {
        estimates_discarded: estimate_count > 0,
    })
}

#[tauri::command]
pub async fn ungroup_asset_command(
    app: AppHandle,
    input: UngroupAssetInput,
) -> Result<UngroupAssetResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin ungroup asset transaction: {}", e))?;

    let estimate_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM estimates WHERE asset_id = ?")
            .bind(&input.asset_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Check estimate before ungroup asset: {}", e))?;

    sqlx::query(
        "DELETE FROM workspace_ai_feedback_entries
         WHERE asset_id = ?
            OR run_id IN (SELECT id FROM ai_runs WHERE asset_id = ?)",
    )
    .bind(&input.asset_id)
    .bind(&input.asset_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Delete AI feedback during ungroup asset: {}", e))?;

    sqlx::query("UPDATE files SET asset_id = NULL WHERE asset_id = ?")
        .bind(&input.asset_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Detach files during ungroup asset: {}", e))?;
    sqlx::query("DELETE FROM assets WHERE id = ?")
        .bind(&input.asset_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete asset during ungroup asset: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit ungroup asset transaction: {}", e))?;

    Ok(UngroupAssetResult {
        had_estimate: estimate_count > 0,
    })
}

#[tauri::command]
pub async fn remove_file_from_asset_command(
    app: AppHandle,
    input: RemoveFileFromAssetInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin remove file from asset transaction: {}", e))?;

    let file_row = sqlx::query("SELECT asset_id FROM files WHERE id = ?")
        .bind(&input.file_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("Load file before removing from asset: {}", e))?;
    let Some(file_row) = file_row else {
        tx.commit()
            .await
            .map_err(|e| format!("Commit empty remove file from asset transaction: {}", e))?;
        return Ok(());
    };
    let asset_id: Option<String> = file_row.get("asset_id");
    let Some(asset_id) = asset_id else {
        tx.commit()
            .await
            .map_err(|e| format!("Commit no-op remove file from asset transaction: {}", e))?;
        return Ok(());
    };

    let file_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM files WHERE asset_id = ?")
        .bind(&asset_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Count files before removing from asset: {}", e))?;
    if file_count <= 1 {
        return Err("Use ungroup asset to return the final file to review".to_string());
    }

    sqlx::query("UPDATE files SET asset_id = NULL WHERE id = ?")
        .bind(&input.file_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Detach file from asset: {}", e))?;
    sync_asset_thumbnail_tx(&mut tx, &asset_id).await?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit remove file from asset transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn create_quote_revision_command(
    app: AppHandle,
    input: CreateQuoteRevisionInput,
) -> Result<CreateQuoteRevisionResult, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin quote revision transaction: {}", e))?;

    let latest_revision: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(revision_number), 0) FROM quote_revisions WHERE project_id = ?",
    )
    .bind(&input.project_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Load latest quote revision number: {}", e))?;
    let revision_number = latest_revision + 1;
    let revision_id = uuid::Uuid::new_v4().to_string();
    let revision_label = format!("Rev {}", revision_number);
    let quote_number_snapshot = input
        .quote_number
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{}-{}", input.rfq_number, revision_label));
    let revision_reason = input.revision_reason.clone().unwrap_or_default();
    let now: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve quote revision timestamp: {}", e))?;

    let contact_country_code = input
        .contact
        .as_ref()
        .and_then(|contact| contact.country_code.clone())
        .or_else(|| input.business.country_code.clone());
    let business_country_code = input
        .business
        .country_code
        .clone()
        .or_else(|| contact_country_code.clone());
    let contact_tax_id_label = if supports_separate_tax_identifier(contact_country_code.as_deref())
    {
        input
            .contact
            .as_ref()
            .and_then(|contact| contact.tax_id_label.clone())
    } else {
        None
    };
    let contact_tax_id_value = if supports_separate_tax_identifier(contact_country_code.as_deref())
    {
        input
            .contact
            .as_ref()
            .and_then(|contact| contact.tax_id_value.clone())
    } else {
        None
    };
    let business_tax_id_label =
        if supports_separate_tax_identifier(business_country_code.as_deref()) {
            input.business.tax_id_label.clone()
        } else {
            None
        };
    let business_tax_id_value =
        if supports_separate_tax_identifier(business_country_code.as_deref()) {
            input.business.tax_id_value.clone()
        } else {
            None
        };

    let sent_status = input
        .sent
        .as_ref()
        .and_then(|sent| sent.status.clone())
        .unwrap_or_else(|| "exported".to_string());
    let sent_date = input
        .sent
        .as_ref()
        .and_then(|sent| sent.date.clone())
        .or_else(|| Some(input.issued_date.clone()));
    let sent_method = input
        .sent
        .as_ref()
        .and_then(|sent| sent.method.clone())
        .unwrap_or_else(|| "download".to_string());
    let recipient_snapshot_json = input
        .recipient_snapshot
        .as_ref()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".to_string());
    let terms_snapshot_json = input
        .terms_snapshot
        .as_ref()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".to_string());

    sqlx::query(
        "INSERT INTO quote_revisions
         (id, project_id, revision_number, revision_label, rfq_number_snapshot, quote_number_snapshot, revision_reason, contact_name_snapshot, contact_country_code_snapshot, contact_business_id_label_snapshot, contact_business_id_value_snapshot, contact_tax_id_label_snapshot, contact_tax_id_value_snapshot, project_name_snapshot, business_name_snapshot, business_id_label_snapshot, business_id_value_snapshot, tax_id_label_snapshot, tax_id_value_snapshot, tax_display_label_snapshot, tax_rate_percentage_snapshot, business_abn_snapshot, business_address_snapshot, business_email_snapshot, business_contact_name_snapshot, business_contact_phone_snapshot, currency_code_snapshot, currency_symbol_snapshot, issued_date, valid_until_date, sent_status, sent_date, sent_method, recipient_snapshot_json, terms_snapshot_json, package_attachments_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&revision_id)
    .bind(&input.project_id)
    .bind(revision_number)
    .bind(&revision_label)
    .bind(&input.rfq_number)
    .bind(&quote_number_snapshot)
    .bind(&revision_reason)
    .bind(&input.contact_name)
    .bind(&contact_country_code)
    .bind(input.contact.as_ref().and_then(|contact| contact.business_id_label.clone()))
    .bind(input.contact.as_ref().and_then(|contact| contact.business_id_value.clone()))
    .bind(contact_tax_id_label)
    .bind(contact_tax_id_value)
    .bind(&input.project_name)
    .bind(&input.business.name)
    .bind(
        input.business
            .business_id_label
            .clone()
            .or_else(|| input.business.abn.as_ref().map(|_| "ABN".to_string())),
    )
    .bind(
        input.business
            .business_id_value
            .clone()
            .or_else(|| input.business.abn.clone()),
    )
    .bind(business_tax_id_label)
    .bind(business_tax_id_value)
    .bind(&input.business.tax_display_label)
    .bind(input.business.tax_rate_percentage)
    .bind(
        if input.business.business_id_label.as_deref() == Some("ABN") {
            input.business.business_id_value.clone()
        } else {
            input.business.abn.clone()
        },
    )
    .bind(&input.business.address)
    .bind(&input.business.contact_email)
    .bind(&input.business.contact_name)
    .bind(&input.business.contact_phone)
    .bind(&input.business.currency_code)
    .bind(&input.business.currency_symbol)
    .bind(&input.issued_date)
    .bind(&input.valid_until_date)
    .bind(&sent_status)
    .bind(&sent_date)
    .bind(&sent_method)
    .bind(&recipient_snapshot_json)
    .bind(&terms_snapshot_json)
    .bind(&input.package_attachments_json)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert quote revision: {}", e))?;

    if !input.options.is_empty() {
        let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "INSERT INTO quote_revision_options
             (id, revision_id, source_quote_option_id, label, lead_time, markup_percentage, notes, sort_order, is_default, is_selected, line_items_json, subtotal_amount, gst_amount, total_amount, created_at, updated_at) "
        );

        query_builder.push_values(input.options, |mut b, option| {
            b.push_bind(uuid::Uuid::new_v4().to_string())
                .push_bind(revision_id.clone())
                .push_bind(option.source_quote_option_id)
                .push_bind(option.label)
                .push_bind(option.lead_time)
                .push_bind(option.markup_percentage)
                .push_bind(option.notes)
                .push_bind(option.sort_order)
                .push_bind(option.is_default)
                .push_bind(option.is_selected)
                .push_bind(option.line_items_json)
                .push_bind(option.subtotal_amount)
                .push_bind(option.gst_amount)
                .push_bind(option.total_amount)
                .push_bind(now.clone())
                .push_bind(now.clone());
        });

        query_builder
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Bulk insert quote revision options: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit quote revision transaction: {}", e))?;

    Ok(CreateQuoteRevisionResult { revision_id })
}

#[tauri::command]
pub async fn add_project_command(app: AppHandle, input: AddProjectInput) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin add project transaction: {}", e))?;

    sqlx::query(
        "INSERT INTO projects
         (id, workspace_id, sort_order, is_favourite, quote_round_prices, rfq_number, contact_id, contact_name_snapshot, requester_contact_id, requester_name_snapshot, quote_recipient_contact_id, project_name, due_date, received_date, submission_deadline_at, estimator_name, customer_tender_reference, addendum_label, addendum_date, addendum_notes, site_address, delivery_address, source_channel, source_reference, source_email_message_id, source_email_integration_id, priority, status, content, note, updated_at)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.workspace_id)
    .bind(input.sort_order)
    .bind(&input.rfq_number)
    .bind(&input.contact_id)
    .bind(&input.contact_name_snapshot)
    .bind(&input.requester_contact_id)
    .bind(&input.requester_name_snapshot)
    .bind(&input.quote_recipient_contact_id)
    .bind(&input.project_name)
    .bind(&input.due_date)
    .bind(&input.received_date)
    .bind(&input.submission_deadline_at)
    .bind(&input.estimator_name)
    .bind(&input.customer_tender_reference)
    .bind(&input.addendum_label)
    .bind(&input.addendum_date)
    .bind(&input.addendum_notes)
    .bind(&input.site_address)
    .bind(&input.delivery_address)
    .bind(&input.source_channel)
    .bind(&input.source_reference)
    .bind(&input.source_email_message_id)
    .bind(&input.source_email_integration_id)
    .bind(&input.priority)
    .bind(&input.status)
    .bind(&input.content)
    .bind(&input.note)
    .bind(&input.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert project: {}", e))?;

    sqlx::query(
        "INSERT INTO quote_options
         (id, project_id, label, lead_time, markup_percentage, notes, sort_order, is_default)
         VALUES (?, ?, 'Standard', '2 weeks', 0, '', 0, 1)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&input.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert default quote option: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit add project transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn create_project_workspace_command(
    app: AppHandle,
    input: CreateProjectWorkspaceInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin create project workspace transaction: {}", e))?;

    sqlx::query(
        "INSERT INTO projects
         (id, workspace_id, sort_order, is_favourite, quote_round_prices, rfq_number, contact_id, contact_name_snapshot, requester_contact_id, requester_name_snapshot, quote_recipient_contact_id, project_name, due_date, received_date, submission_deadline_at, estimator_name, customer_tender_reference, addendum_label, addendum_date, addendum_notes, site_address, delivery_address, source_channel, source_reference, source_email_message_id, source_email_integration_id, priority, status, content, note, updated_at)
         VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.project.id)
    .bind(&input.project.workspace_id)
    .bind(input.project.sort_order)
    .bind(&input.project.rfq_number)
    .bind(&input.project.contact_id)
    .bind(&input.project.contact_name_snapshot)
    .bind(&input.project.requester_contact_id)
    .bind(&input.project.requester_name_snapshot)
    .bind(&input.project.quote_recipient_contact_id)
    .bind(&input.project.project_name)
    .bind(&input.project.due_date)
    .bind(&input.project.received_date)
    .bind(&input.project.submission_deadline_at)
    .bind(&input.project.estimator_name)
    .bind(&input.project.customer_tender_reference)
    .bind(&input.project.addendum_label)
    .bind(&input.project.addendum_date)
    .bind(&input.project.addendum_notes)
    .bind(&input.project.site_address)
    .bind(&input.project.delivery_address)
    .bind(&input.project.source_channel)
    .bind(&input.project.source_reference)
    .bind(&input.project.source_email_message_id)
    .bind(&input.project.source_email_integration_id)
    .bind(&input.project.priority)
    .bind(&input.project.status)
    .bind(&input.project.content)
    .bind(&input.project.note)
    .bind(&input.project.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert project workspace project: {}", e))?;

    sqlx::query(
        "INSERT INTO quote_options
         (id, project_id, label, lead_time, markup_percentage, notes, sort_order, is_default)
         VALUES (?, ?, 'Standard', '2 weeks', 0, '', 0, 1)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&input.project.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert default quote option for project workspace: {}", e))?;

    if !input.files.is_empty() {
        QueryBuilder::<Sqlite>::new("INSERT INTO files (id, project_id, asset_id, file_path, original_name, mime_type, byte_size, content_hash, document_type, revision_label, received_at, source_label, source_metadata_json) ")
            .push_values(input.files, |mut b, file| {
                b.push_bind(file.id)
                    .push_bind(&input.project.id)
                    .push_bind(None::<String>)
                    .push_bind(file.file_path)
                    .push_bind(file.original_name)
                    .push_bind(file.mime_type)
                    .push_bind(file.byte_size.unwrap_or(0))
                    .push_bind(file.content_hash)
                    .push_bind(file.document_type.unwrap_or_else(|| "".to_string()))
                    .push_bind(file.revision_label.unwrap_or_else(|| "".to_string()))
                    .push_bind(file.received_at)
                    .push_bind(file.source_label.unwrap_or_else(|| "manual_upload".to_string()))
                    .push_bind(file.source_metadata_json.unwrap_or_else(|| "{}".to_string()));
            })
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert project workspace files: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit create project workspace transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn update_project_workspace_command(
    app: AppHandle,
    input: UpdateProjectWorkspaceInput,
) -> Result<(), String> {
    let removed_file_ids = input.removed_file_ids.clone();
    let pool = transactional_sqlite_pool(&app).await?;
    let workspace_id = if removed_file_ids.is_empty() {
        None
    } else {
        Some(
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM workspace_identity ORDER BY rowid ASC LIMIT 1",
            )
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("Read workspace identity before file removal: {}", e))?,
        )
    };
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin update project workspace transaction: {}", e))?;

    sqlx::query(
        "UPDATE projects
         SET rfq_number = ?, contact_id = ?, contact_name_snapshot = ?, requester_contact_id = ?, requester_name_snapshot = ?, quote_recipient_contact_id = ?, project_name = ?, due_date = ?, received_date = ?, submission_deadline_at = ?, estimator_name = ?, customer_tender_reference = ?, addendum_label = ?, addendum_date = ?, addendum_notes = ?, site_address = ?, delivery_address = ?, source_channel = ?, source_reference = ?, source_email_message_id = ?, source_email_integration_id = ?, priority = ?, status = ?, content = ?, note = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.rfq_number)
    .bind(&input.contact_id)
    .bind(&input.contact_name_snapshot)
    .bind(&input.requester_contact_id)
    .bind(&input.requester_name_snapshot)
    .bind(&input.quote_recipient_contact_id)
    .bind(&input.project_name)
    .bind(&input.due_date)
    .bind(&input.received_date)
    .bind(&input.submission_deadline_at)
    .bind(&input.estimator_name)
    .bind(&input.customer_tender_reference)
    .bind(&input.addendum_label)
    .bind(&input.addendum_date)
    .bind(&input.addendum_notes)
    .bind(&input.site_address)
    .bind(&input.delivery_address)
    .bind(&input.source_channel)
    .bind(&input.source_reference)
    .bind(&input.source_email_message_id)
    .bind(&input.source_email_integration_id)
    .bind(&input.priority)
    .bind(&input.status)
    .bind(&input.content)
    .bind(&input.note)
    .bind(&input.updated_at)
    .bind(&input.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Update project workspace: {}", e))?;

    if !input.new_files.is_empty() {
        QueryBuilder::<Sqlite>::new("INSERT INTO files (id, project_id, asset_id, file_path, original_name, mime_type, byte_size, content_hash, document_type, revision_label, received_at, source_label, source_metadata_json) ")
            .push_values(input.new_files, |mut b, file| {
                b.push_bind(file.id)
                    .push_bind(&input.id)
                    .push_bind(None::<String>)
                    .push_bind(file.file_path)
                    .push_bind(file.original_name)
                    .push_bind(file.mime_type)
                    .push_bind(file.byte_size.unwrap_or(0))
                    .push_bind(file.content_hash)
                    .push_bind(file.document_type.unwrap_or_else(|| "".to_string()))
                    .push_bind(file.revision_label.unwrap_or_else(|| "".to_string()))
                    .push_bind(file.received_at)
                    .push_bind(file.source_label.unwrap_or_else(|| "manual_upload".to_string()))
                    .push_bind(file.source_metadata_json.unwrap_or_else(|| "{}".to_string()));
            })
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert new project workspace files: {}", e))?;
    }

    if !input.removed_file_ids.is_empty() {
        let mut delete_files = QueryBuilder::<Sqlite>::new("DELETE FROM files WHERE id IN (");
        {
            let mut separated = delete_files.separated(", ");
            for file_id in &input.removed_file_ids {
                separated.push_bind(file_id);
            }
        }
        delete_files.push(")");
        delete_files
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Delete removed project workspace files: {}", e))?;
    }

    for asset_id in input.removed_asset_ids {
        sync_asset_thumbnail_tx(&mut tx, &asset_id).await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit update project workspace transaction: {}", e))?;
    if let Some(workspace_id) = workspace_id {
        for file_id in removed_file_ids {
            if let Err(error) =
                remove_ai_evidence_cache_for_file(&app, &workspace_id, &file_id).await
            {
                log::warn!(
                    "[ai-evidence-cache] Removed file {} left recreatable cache artifacts: {}",
                    file_id,
                    error
                );
            }
        }
    }
    Ok(())
}

pub(crate) async fn insert_contact_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    workspace_id: &str,
    sort_order: i64,
    data: &serde_json::Value,
) -> Result<(), String> {
    let workspace_country = sqlx::query_scalar::<_, String>(
        "SELECT country_code FROM workspace_profile WHERE workspace_id = ?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut **tx)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "AU".to_string());

    sqlx::query(
        "INSERT INTO contacts
         (id, workspace_id, sort_order, kind, display_name, name, company_name, person_first_name, person_last_name, role_title, linked_company_id, is_primary_company_contact, country_code, contact_name, email, website, phone, phone_e164, phone_country_code, abn, business_id_label, business_id_value, tax_id_label, tax_id_value, address, notes, logo_file_path, custom_role_label, roles_json, tags_json, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(workspace_id)
    .bind(sort_order)
    .bind(json_string_or_default(data, "kind", "company"))
    .bind(
        json_string_optional(data, "display_name")
            .or_else(|| json_string_optional(data, "name"))
            .ok_or_else(|| "Missing required field: display_name or name".to_string())?,
    )
    .bind(
        json_string_optional(data, "name")
            .or_else(|| json_string_optional(data, "display_name"))
            .ok_or_else(|| "Missing required field: name or display_name".to_string())?,
    )
    .bind(json_string_optional(data, "company_name"))
    .bind(json_string_optional(data, "person_first_name"))
    .bind(json_string_optional(data, "person_last_name"))
    .bind(json_string_optional(data, "role_title"))
    .bind(json_string_optional(data, "linked_company_id"))
    .bind(if json_bool_or_default(data, "is_primary_company_contact", false) {
        1
    } else {
        0
    })
    .bind(json_string_or_default(data, "country_code", &workspace_country))
    .bind(json_string_optional(data, "contact_name"))
    .bind(json_string_optional(data, "email"))
    .bind(json_string_optional(data, "website"))
    .bind(json_string_optional(data, "phone"))
    .bind(json_string_or_default(data, "phone_e164", ""))
    .bind(
        json_string_optional(data, "phone_country_code")
            .or_else(|| json_string_optional(data, "country_code"))
            .unwrap_or_else(|| workspace_country.clone()),
    )
    .bind(json_string_optional(data, "abn"))
    .bind(json_string_or_default(data, "business_id_label", "Business ID"))
    .bind(json_string_optional(data, "business_id_value"))
    .bind(json_string_or_default(data, "tax_id_label", "Tax ID"))
    .bind(json_string_optional(data, "tax_id_value"))
    .bind(json_string_optional(data, "address"))
    .bind(json_string_optional(data, "notes"))
    .bind(json_string_optional(data, "logo_file_path"))
    .bind(json_string_optional(data, "custom_role_label"))
    .bind(json_field_to_string(data, "roles", serde_json::json!([]))?)
    .bind(json_field_to_string(data, "tags", serde_json::json!([]))?)
    .bind(if json_bool_or_default(data, "is_active", true) {
        1
    } else {
        0
    })
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Insert contact: {}", e))?;

    sync_contact_relationships_tx_json(tx, id, workspace_id, data).await?;
    Ok(())
}

async fn update_contact_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    workspace_id: &str,
    updated_at: &str,
    data: &serde_json::Value,
) -> Result<u64, String> {
    let workspace_country = sqlx::query_scalar::<_, String>(
        "SELECT country_code FROM workspace_profile WHERE workspace_id = ?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut **tx)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "AU".to_string());

    let result = sqlx::query(
        "UPDATE contacts
         SET kind = ?, display_name = ?, name = ?, company_name = ?, person_first_name = ?, person_last_name = ?, role_title = ?, linked_company_id = ?, is_primary_company_contact = ?, country_code = ?, contact_name = ?, email = ?, website = ?, phone = ?, phone_e164 = ?, phone_country_code = ?, abn = ?, business_id_label = ?, business_id_value = ?, tax_id_label = ?, tax_id_value = ?, address = ?, notes = ?, logo_file_path = ?, custom_role_label = ?, roles_json = ?, tags_json = ?, is_active = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?",
    )
    .bind(json_string_or_default(data, "kind", "company"))
    .bind(
        json_string_optional(data, "display_name")
            .or_else(|| json_string_optional(data, "name"))
            .ok_or_else(|| "Missing required field: display_name or name".to_string())?,
    )
    .bind(
        json_string_optional(data, "name")
            .or_else(|| json_string_optional(data, "display_name"))
            .ok_or_else(|| "Missing required field: name or display_name".to_string())?,
    )
    .bind(json_string_optional(data, "company_name"))
    .bind(json_string_optional(data, "person_first_name"))
    .bind(json_string_optional(data, "person_last_name"))
    .bind(json_string_optional(data, "role_title"))
    .bind(json_string_optional(data, "linked_company_id"))
    .bind(if json_bool_or_default(data, "is_primary_company_contact", false) {
        1
    } else {
        0
    })
    .bind(json_string_or_default(data, "country_code", &workspace_country))
    .bind(json_string_optional(data, "contact_name"))
    .bind(json_string_optional(data, "email"))
    .bind(json_string_optional(data, "website"))
    .bind(json_string_optional(data, "phone"))
    .bind(json_string_or_default(data, "phone_e164", ""))
    .bind(
        json_string_optional(data, "phone_country_code")
            .or_else(|| json_string_optional(data, "country_code"))
            .unwrap_or_else(|| workspace_country.clone()),
    )
    .bind(json_string_optional(data, "abn"))
    .bind(json_string_or_default(data, "business_id_label", "Business ID"))
    .bind(json_string_optional(data, "business_id_value"))
    .bind(json_string_or_default(data, "tax_id_label", "Tax ID"))
    .bind(json_string_optional(data, "tax_id_value"))
    .bind(json_string_optional(data, "address"))
    .bind(json_string_optional(data, "notes"))
    .bind(json_string_optional(data, "logo_file_path"))
    .bind(json_string_optional(data, "custom_role_label"))
    .bind(json_field_to_string(data, "roles", serde_json::json!([]))?)
    .bind(json_field_to_string(data, "tags", serde_json::json!([]))?)
    .bind(if json_bool_or_default(data, "is_active", true) {
        1
    } else {
        0
    })
    .bind(updated_at)
    .bind(id)
    .bind(workspace_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Update contact: {}", e))?;

    sync_contact_relationships_tx_json(tx, id, workspace_id, data).await?;
    Ok(result.rows_affected())
}

async fn insert_assistant_action_audit_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    input: &AssistantApprovedContactsBundleInput,
    status: &str,
    error_count: i64,
    error_message: Option<&str>,
) -> Result<(), String> {
    let payload_json = serde_json::to_string(&input.actions)
        .map_err(|e| format!("Serialize assistant action audit payload: {}", e))?;
    sqlx::query(
        "INSERT INTO assistant_action_audit
         (id, workspace_id, turn_id, action_id, proposal_id, tool_name, status, item_count, issue_count, error_count, payload_json, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&input.workspace_id)
    .bind(&input.turn_id)
    .bind(&input.proposal_id)
    .bind(&input.proposal_id)
    .bind(&input.tool_name)
    .bind(status)
    .bind(input.actions.len() as i64)
    .bind(error_count)
    .bind(payload_json)
    .bind(error_message)
    .bind(&input.updated_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Insert assistant action audit: {}", e))?;
    Ok(())
}

async fn insert_assistant_action_audit_pool(
    pool: &sqlx::SqlitePool,
    input: &AssistantApprovedContactsBundleInput,
    status: &str,
    error_count: i64,
    error_message: Option<&str>,
) -> Result<(), String> {
    let mut tx = begin_immediate(pool)
        .await
        .map_err(|e| format!("Begin assistant action audit transaction: {}", e))?;
    insert_assistant_action_audit_tx(&mut tx, input, status, error_count, error_message).await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit assistant action audit transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn write_assistant_action_audit_command(
    app: AppHandle,
    input: WriteAssistantActionAuditInput,
) -> Result<(), String> {
    let pool = super::pool::transactional_sqlite_pool(&app).await?;

    let payload_json = input.payload_json.unwrap_or_else(|| "{}".to_string());

    sqlx::query(
        "INSERT INTO assistant_action_audit
         (id, workspace_id, turn_id, action_id, proposal_id, tool_name, status, item_count, issue_count, error_count, payload_json, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&input.workspace_id)
    .bind(&input.turn_id)
    .bind(&input.action_id)
    .bind(&input.action_id)
    .bind(&input.tool_name)
    .bind(&input.status)
    .bind(input.item_count)
    .bind(input.issue_count)
    .bind(input.error_count)
    .bind(&payload_json)
    .bind(&input.error_message)
    .execute(&pool)
    .await
    .map_err(|e| format!("Insert assistant action audit: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn add_contact_command(app: AppHandle, input: ContactWriteInput) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin add contact transaction: {}", e))?;
    let sort_order = input
        .sort_order
        .ok_or_else(|| "Missing contact sort order for create.".to_string())?;
    insert_contact_tx(
        &mut tx,
        &input.id,
        &input.workspace_id,
        sort_order,
        &input.data,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit add contact transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn update_contact_command(
    app: AppHandle,
    input: ContactWriteInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin update contact transaction: {}", e))?;
    update_contact_tx(
        &mut tx,
        &input.id,
        &input.workspace_id,
        &input.updated_at,
        &input.data,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit update contact transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn execute_approved_contacts_bundle_command(
    app: AppHandle,
    input: AssistantApprovedContactsBundleInput,
) -> Result<AssistantApprovedContactsBundleResult, String> {
    if input.actions.is_empty() {
        return Err("Assistant contact bundle must include at least one action".to_string());
    }
    if input.actions.len() > 25 {
        return Err("Assistant contact bundle exceeds the 25 action limit".to_string());
    }

    let pool = transactional_sqlite_pool(&app).await?;
    insert_assistant_action_audit_pool(&pool, &input, "approved", 0, None).await?;

    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin approved contacts bundle transaction: {}", e))?;

    let execution_result: Result<i64, String> = async {
        let mut next_sort_order = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM contacts WHERE workspace_id = ?",
        )
        .bind(&input.workspace_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve next contact sort order: {}", e))?;

        let mut actions = input.actions.iter().collect::<Vec<_>>();
        actions.sort_by_key(|action| {
            if json_string_or_default(&action.data, "kind", "company") == "company" {
                0
            } else {
                1
            }
        });

        for action in actions {
            match action.action.as_str() {
                "create" => {
                    let mut data = action.data.clone();
                    let linked_company_id = json_string_optional(&data, "linked_company_id");
                    if json_string_or_default(&data, "kind", "company") == "person"
                        && linked_company_id.is_some()
                        && !json_bool_or_default(&data, "is_primary_company_contact", false)
                    {
                        let existing_primary_or_active_person = sqlx::query_scalar::<_, i64>(
                            "SELECT COUNT(*) FROM contacts
                             WHERE workspace_id = ?
                               AND kind = 'person'
                               AND linked_company_id = ?
                               AND is_active = 1
                             LIMIT 1",
                        )
                        .bind(&input.workspace_id)
                        .bind(linked_company_id.as_deref().unwrap_or_default())
                        .fetch_one(&mut *tx)
                        .await
                        .map_err(|e| format!("Check existing company people: {}", e))?;
                        if existing_primary_or_active_person == 0 {
                            data["is_primary_company_contact"] = serde_json::Value::Bool(true);
                        }
                    }
                    insert_contact_tx(
                        &mut tx,
                        &action.id,
                        &input.workspace_id,
                        next_sort_order,
                        &data,
                    )
                    .await?;
                    next_sort_order += 1;
                }
                "update" => {
                    let record_id = action
                        .record_id
                        .as_deref()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or(action.id.as_str());
                    let rows_affected = update_contact_tx(
                        &mut tx,
                        record_id,
                        &input.workspace_id,
                        &input.updated_at,
                        &action.data,
                    )
                    .await?;
                    if rows_affected == 0 {
                        return Err(format!(
                            "Contact update target was not found: {}",
                            record_id
                        ));
                    }
                }
                other => return Err(format!("Unsupported contact action: {}", other)),
            }
        }

        insert_assistant_action_audit_tx(&mut tx, &input, "executed", 0, None).await?;
        Ok(input.actions.len() as i64)
    }
    .await;

    match execution_result {
        Ok(success_count) => {
            tx.commit()
                .await
                .map_err(|e| format!("Commit approved contacts bundle transaction: {}", e))?;
            Ok(AssistantApprovedContactsBundleResult {
                status: "succeeded".to_string(),
                success_count,
                failure_count: 0,
                errors: Vec::new(),
            })
        }
        Err(error) => {
            let _ = tx.rollback().await;
            insert_assistant_action_audit_pool(&pool, &input, "failed", 1, Some(&error)).await?;
            Ok(AssistantApprovedContactsBundleResult {
                status: "failed".to_string(),
                success_count: 0,
                failure_count: 1,
                errors: vec![error],
            })
        }
    }
}

#[tauri::command]
pub async fn save_estimate_command(app: AppHandle, input: SaveEstimateInput) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin save estimate transaction: {}", e))?;
    let estimate = &input.estimate;

    sqlx::query(
        "INSERT INTO estimates
         (asset_id, scope_summary, notes, classification_system_id, wbs_root_node_id, applied_template_id, applied_template_name, currency_code, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
            scope_summary = excluded.scope_summary,
            notes = excluded.notes,
            classification_system_id = excluded.classification_system_id,
            wbs_root_node_id = excluded.wbs_root_node_id,
            applied_template_id = excluded.applied_template_id,
            applied_template_name = excluded.applied_template_name,
            currency_code = excluded.currency_code,
            updated_at = excluded.updated_at",
    )
    .bind(&input.asset_id)
    .bind(json_string_or_default(estimate, "scope_summary", ""))
    .bind(json_string_or_default(estimate, "notes", ""))
    .bind(json_string_optional(estimate, "classification_system_id"))
    .bind(json_string_optional(estimate, "wbs_root_node_id"))
    .bind(json_string_optional(estimate, "applied_template_id"))
    .bind(json_string_optional(estimate, "applied_template_name"))
    .bind(json_string_optional(estimate, "currency_code"))
    .bind(&input.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Upsert estimate: {}", e))?;

    sqlx::query("DELETE FROM takeoff_items WHERE estimate_asset_id = ?")
        .bind(&input.asset_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete estimate takeoff items: {}", e))?;

    struct ParsedTakeoffItem {
        id: String,
        estimate_asset_id: String,
        parent_id: Option<String>,
        wbs_node_id: Option<String>,
        cost_code_id: Option<String>,
        applied_preset_id: Option<String>,
        applied_preset_name: Option<String>,
        name: String,
        description: String,
        quantity: f64,
        unit: String,
        properties_json: String,
        sort_order: i64,
    }

    struct ParsedCostComponent {
        id: String,
        takeoff_item_id: String,
        category: String,
        source_type: String,
        source_id: Option<String>,
        name: String,
        description: String,
        quantity: f64,
        unit: String,
        unit_rate: f64,
        source_unit_rate_decimal: Option<String>,
        source_currency_code: Option<String>,
        fx_rate_snapshot_id: Option<String>,
        formula_json: String,
        metadata_json: String,
        sort_order: i64,
    }

    let raw_takeoff_items = json_array(estimate, "takeoff_items");
    let mut parsed_items: Vec<ParsedTakeoffItem> = Vec::with_capacity(raw_takeoff_items.len());
    let mut parsed_components: Vec<ParsedCostComponent> = Vec::new();

    for item in raw_takeoff_items {
        let item_id = json_string_required(item, "id")?;

        parsed_items.push(ParsedTakeoffItem {
            id: item_id.clone(),
            estimate_asset_id: input.asset_id.clone(),
            parent_id: json_string_optional(item, "parent_id"),
            wbs_node_id: json_string_optional(item, "wbs_node_id"),
            cost_code_id: json_string_optional(item, "cost_code_id"),
            applied_preset_id: json_string_optional(item, "applied_preset_id"),
            applied_preset_name: json_string_optional(item, "applied_preset_name"),
            name: json_string_required(item, "name")?,
            description: json_string_or_default(item, "description", ""),
            quantity: json_f64_required(item, "quantity")?,
            unit: json_string_required(item, "unit")?,
            properties_json: json_field_to_string(item, "properties", serde_json::json!({}))?,
            sort_order: json_i64_required(item, "sort_order")?,
        });

        for component in json_array(item, "cost_components") {
            let estimate_currency = json_string_optional(estimate, "currency_code");
            let src_unit_rate = json_string_optional(component, "source_unit_rate_decimal");
            let src_currency = json_string_optional(component, "source_currency_code");
            let fx_snapshot = json_string_optional(component, "fx_rate_snapshot_id");

            parsed_components.push(ParsedCostComponent {
                id: json_string_required(component, "id")?,
                takeoff_item_id: item_id.clone(),
                category: json_string_required(component, "category")?,
                source_type: json_string_required(component, "source_type")?,
                source_id: json_string_optional(component, "source_id"),
                name: json_string_required(component, "name")?,
                description: json_string_or_default(component, "description", ""),
                quantity: json_f64_required(component, "quantity")?,
                unit: json_string_required(component, "unit")?,
                unit_rate: json_f64_required(component, "unit_rate")?,
                source_unit_rate_decimal: src_unit_rate.or_else(|| {
                    // Domestic omission: derive canonical text from incoming unit_rate
                    json_f64_required(component, "unit_rate")
                        .ok()
                        .map(|r| format!("{}", r))
                }),
                source_currency_code: src_currency.or_else(|| estimate_currency.clone()),
                fx_rate_snapshot_id: fx_snapshot,
                formula_json: json_field_to_string(component, "formula", serde_json::json!({}))?,
                metadata_json: json_field_to_string(component, "metadata", serde_json::json!({}))?,
                sort_order: json_i64_or_default(component, "sort_order", 0),
            });
        }
    }

    if !parsed_items.is_empty() {
        // Chunk inserts to avoid sqlite max variable limits.
        // A single row has 13 bindings. 999 is a safe conservative limit for total bound variables in older sqlite, but modern is 32766.
        // We will chunk at 200 items (200 * 13 = 2600 variables, well within standard SQLite limits).
        for chunk in parsed_items.chunks(200) {
            let mut qb = sqlx::QueryBuilder::<Sqlite>::new(
                "INSERT INTO takeoff_items
                 (id, estimate_asset_id, parent_id, wbs_node_id, cost_code_id, applied_preset_id, applied_preset_name, name, description, quantity, unit, properties_json, sort_order) "
            );

            qb.push_values(chunk, |mut b, item| {
                b.push_bind(item.id.clone())
                    .push_bind(item.estimate_asset_id.clone())
                    .push_bind(item.parent_id.clone())
                    .push_bind(item.wbs_node_id.clone())
                    .push_bind(item.cost_code_id.clone())
                    .push_bind(item.applied_preset_id.clone())
                    .push_bind(item.applied_preset_name.clone())
                    .push_bind(item.name.clone())
                    .push_bind(item.description.clone())
                    .push_bind(item.quantity)
                    .push_bind(item.unit.clone())
                    .push_bind(item.properties_json.clone())
                    .push_bind(item.sort_order);
            });

            qb.build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Batch insert takeoff item: {}", e))?;
        }
    }

    if !parsed_components.is_empty() {
        for chunk in parsed_components.chunks(200) {
            let mut qb = sqlx::QueryBuilder::<Sqlite>::new(
                "INSERT INTO cost_components
                 (id, takeoff_item_id, category, source_type, source_id, name, description, quantity, unit, unit_rate, source_unit_rate_decimal, source_currency_code, fx_rate_snapshot_id, formula_json, metadata_json, sort_order) "
            );

            qb.push_values(chunk, |mut b, comp| {
                b.push_bind(comp.id.clone())
                    .push_bind(comp.takeoff_item_id.clone())
                    .push_bind(comp.category.clone())
                    .push_bind(comp.source_type.clone())
                    .push_bind(comp.source_id.clone())
                    .push_bind(comp.name.clone())
                    .push_bind(comp.description.clone())
                    .push_bind(comp.quantity)
                    .push_bind(comp.unit.clone())
                    .push_bind(comp.unit_rate)
                    .push_bind(comp.source_unit_rate_decimal.clone())
                    .push_bind(comp.source_currency_code.clone())
                    .push_bind(comp.fx_rate_snapshot_id.clone())
                    .push_bind(comp.formula_json.clone())
                    .push_bind(comp.metadata_json.clone())
                    .push_bind(comp.sort_order);
            });

            qb.build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Batch insert cost component: {}", e))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit save estimate transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn reset_quote_workspace_command(
    app: AppHandle,
    input: ResetQuoteWorkspaceInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin reset quote workspace transaction: {}", e))?;

    if !input.asset_ids.is_empty() {
        let mut delete_estimates =
            QueryBuilder::<Sqlite>::new("DELETE FROM estimates WHERE asset_id IN (");
        {
            let mut separated = delete_estimates.separated(", ");
            for asset_id in &input.asset_ids {
                separated.push_bind(asset_id);
            }
        }
        delete_estimates.push(")");
        delete_estimates
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Delete project estimates during quote reset: {}", e))?;
    }

    sqlx::query("DELETE FROM quote_options WHERE project_id = ?")
        .bind(&input.project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete quote options during quote reset: {}", e))?;

    if !input.quote_options.is_empty() {
        let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "INSERT INTO quote_options (id, project_id, label, lead_time, markup_percentage, material_markup_percentage, labour_markup_percentage, equipment_markup_percentage, subcontract_markup_percentage, notes, sort_order, is_default) "
        );

        query_builder.push_values(input.quote_options.into_iter(), |mut b, option| {
            b.push_bind(option.id)
                .push_bind(input.project_id.clone())
                .push_bind(option.label)
                .push_bind(option.lead_time)
                .push_bind(option.markup_percentage)
                .push_bind(option.material_markup_percentage)
                .push_bind(option.labour_markup_percentage)
                .push_bind(option.equipment_markup_percentage)
                .push_bind(option.subcontract_markup_percentage)
                .push_bind(option.notes)
                .push_bind(option.sort_order)
                .push_bind(if option.is_default { 1 } else { 0 });
        });

        query_builder
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert quote options during quote reset: {}", e))?;
    }

    sqlx::query("UPDATE projects SET quote_round_prices = 0, updated_at = ? WHERE id = ?")
        .bind(&input.updated_at)
        .bind(&input.project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Reset project quote round prices: {}", e))?;

    sqlx::query("UPDATE assets SET quote_quantity = 1, is_pdf_included = 1 WHERE project_id = ?")
        .bind(&input.project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Reset project asset quote defaults: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit reset quote workspace transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_project_structure_template_command(
    app: AppHandle,
    input: ProjectStructureTemplateBundleInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin add project structure template transaction: {}", e))?;

    sqlx::query(
        "INSERT INTO project_structure_templates
         (id, workspace_id, code, name, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.workspace_id)
    .bind(&input.code)
    .bind(&input.name)
    .bind(&input.description)
    .bind(if input.is_active { 1 } else { 0 })
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert project structure template: {}", e))?;

    if !input.nodes.is_empty() {
        for chunk in input.nodes.chunks(50) {
            let mut qb = sqlx::QueryBuilder::new(
                "INSERT INTO project_structure_template_nodes
                 (id, template_id, parent_id, code, name, type, sort_order) ",
            );
            qb.push_values(chunk, |mut b, node| {
                b.push_bind(&node.id)
                    .push_bind(&input.id)
                    .push_bind(&node.parent_id)
                    .push_bind(&node.code)
                    .push_bind(&node.name)
                    .push_bind(&node.node_type)
                    .push_bind(node.sort_order);
            });
            qb.build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Insert project structure template node: {}", e))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit add project structure template transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn update_project_structure_template_command(
    app: AppHandle,
    input: ProjectStructureTemplateBundleInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin update project structure template transaction: {}", e))?;

    let updated = sqlx::query(
        "UPDATE project_structure_templates
         SET code = ?, name = ?, description = ?, is_active = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?",
    )
    .bind(&input.code)
    .bind(&input.name)
    .bind(&input.description)
    .bind(if input.is_active { 1 } else { 0 })
    .bind(&input.updated_at)
    .bind(&input.id)
    .bind(&input.workspace_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Update project structure template: {}", e))?;
    if updated.rows_affected() == 0 {
        return Err("Selected project structure template could not be found".to_string());
    }

    sqlx::query("DELETE FROM project_structure_template_nodes WHERE template_id = ?")
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete existing template nodes before update: {}", e))?;

    if !input.nodes.is_empty() {
        for chunk in input.nodes.chunks(50) {
            let mut qb = sqlx::QueryBuilder::new(
                "INSERT INTO project_structure_template_nodes
                 (id, template_id, parent_id, code, name, type, sort_order) ",
            );
            qb.push_values(chunk, |mut b, node| {
                b.push_bind(&node.id)
                    .push_bind(&input.id)
                    .push_bind(&node.parent_id)
                    .push_bind(&node.code)
                    .push_bind(&node.name)
                    .push_bind(&node.node_type)
                    .push_bind(node.sort_order);
            });
            qb.build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Insert updated project structure template node: {}", e))?;
        }
    }

    tx.commit().await.map_err(|e| {
        format!(
            "Commit update project structure template transaction: {}",
            e
        )
    })?;
    Ok(())
}

#[tauri::command]
pub async fn apply_project_structure_template_to_project_command(
    app: AppHandle,
    input: ApplyProjectStructureTemplateInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin apply project structure template transaction: {}", e))?;

    let existing_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM wbs_nodes WHERE project_id = ?")
            .bind(&input.project_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Count existing WBS nodes before template apply: {}", e))?;
    if existing_count > 0 {
        return Err(
            "Project structure templates can only be applied to empty projects".to_string(),
        );
    }

    let mut node_id_map = std::collections::HashMap::new();
    for node in &input.nodes {
        node_id_map.insert(node.id.clone(), uuid::Uuid::new_v4().to_string());
    }

    if !input.nodes.is_empty() {
        for chunk in input.nodes.chunks(50) {
            let mut qb = sqlx::QueryBuilder::new(
                "INSERT INTO wbs_nodes
                 (id, project_id, parent_id, code, name, type, sort_order) ",
            );
            qb.push_values(chunk, |mut b, node| {
                let id = node_id_map.get(&node.id).cloned();
                let parent_id = node
                    .parent_id
                    .as_ref()
                    .and_then(|parent_id| node_id_map.get(parent_id).cloned());
                b.push_bind(id)
                    .push_bind(&input.project_id)
                    .push_bind(parent_id)
                    .push_bind(&node.code)
                    .push_bind(&node.name)
                    .push_bind(&node.node_type)
                    .push_bind(node.sort_order);
            });
            qb.build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Insert WBS node from project structure template: {}", e))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit apply project structure template transaction: {}", e))?;
    Ok(())
}

struct ParsedClassificationSystem {
    id: String,
    mapped_fields: Vec<String>,
    name: String,
    code: String,
    type_: String,
    aliases_json: String,
    is_default: bool,
}

fn setup_import_field_is_mapped(fields: &[String], field: &str) -> bool {
    fields.iter().any(|candidate| candidate == field)
}

async fn validate_setup_import_update_id_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Sqlite>,
    workspace_id: &str,
    scope: &str,
    id: &str,
) -> Result<(), String> {
    let sql = match scope {
        "contacts" => "SELECT c.id FROM contacts c WHERE c.id = ? AND c.workspace_id = ?",
        "materials" => "SELECT r.id FROM material_catalog_items r WHERE r.id = ? AND r.workspace_id = ?",
        "labour_rates" => "SELECT r.id FROM labour_rate_cards r WHERE r.id = ? AND r.workspace_id = ?",
        "equipment_rates" => "SELECT r.id FROM equipment_rate_cards r WHERE r.id = ? AND r.workspace_id = ?",
        "subcontract_rates" => "SELECT r.id FROM subcontract_rate_cards r WHERE r.id = ? AND r.workspace_id = ?",
        "cost_presets" => "SELECT r.id FROM cost_component_presets r WHERE r.id = ? AND r.workspace_id = ?",
        "estimate_templates" => "SELECT r.id FROM estimate_templates r WHERE r.id = ? AND r.workspace_id = ?",
        "project_structure_templates" => "SELECT r.id FROM project_structure_templates r WHERE r.id = ? AND r.workspace_id = ?",
        "classification_systems" => "SELECT r.id FROM classification_systems r WHERE r.id = ? AND r.workspace_id = ?",
        "cost_codes" => "SELECT c.id FROM cost_codes c INNER JOIN classification_systems s ON s.id = c.classification_system_id WHERE c.id = ? AND s.workspace_id = ?",
        _ => return Err(format!("Unsupported setup import update scope: {scope}")),
    };
    let found = sqlx::query_scalar::<_, String>(sql)
        .bind(id)
        .bind(workspace_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("Validate setup import {scope} update: {e}"))?;
    if found.is_none() {
        return Err(format!(
            "Setup import {scope} record \"{id}\" was not found in the active workspace"
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_setup_import_session_command(
    app: AppHandle,
    input: SetupImportSessionInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    apply_setup_import_session_tx(&pool, input).await
}

async fn apply_setup_import_session_tx(
    pool: &sqlx::SqlitePool,
    input: SetupImportSessionInput,
) -> Result<(), String> {
    let mut tx = begin_immediate(pool)
        .await
        .map_err(|e| format!("Begin setup import session transaction: {}", e))?;

    let workspace_id = sqlx::query_scalar::<_, String>("SELECT id FROM workspace_identity LIMIT 1")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve active setup import workspace: {}", e))?;
    let now = sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Resolve setup import timestamp: {}", e))?;

    let workspace_country = sqlx::query_scalar::<_, String>(
        "SELECT country_code FROM workspace_profile WHERE workspace_id = ?",
    )
    .bind(&workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .unwrap_or(None)
    .unwrap_or_else(|| "AU".to_string());

    let mut next_contact_sort_order = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM contacts WHERE workspace_id = ?",
    )
    .bind(&workspace_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Resolve setup import contact order: {}", e))?;

    for operation in input.contacts {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO contacts
                 (id, workspace_id, sort_order, kind, display_name, name, company_name, person_first_name, person_last_name, role_title, linked_company_id, is_primary_company_contact, country_code, contact_name, email, website, phone, phone_e164, phone_country_code, abn, business_id_label, business_id_value, tax_id_label, tax_id_value, address, notes, logo_file_path, custom_role_label, roles_json, tags_json, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(next_contact_sort_order)
            .bind(json_string_or_default(data, "kind", "company"))
            .bind(
                json_string_optional(data, "display_name")
                    .or_else(|| json_string_optional(data, "name"))
                    .ok_or_else(|| "Missing required field: display_name or name".to_string())?,
            )
            .bind(
                json_string_optional(data, "name")
                    .or_else(|| json_string_optional(data, "display_name"))
                    .ok_or_else(|| "Missing required field: name or display_name".to_string())?,
            )
            .bind(json_string_optional(data, "company_name"))
            .bind(json_string_optional(data, "person_first_name"))
            .bind(json_string_optional(data, "person_last_name"))
            .bind(json_string_optional(data, "role_title"))
            .bind(json_string_optional(data, "linked_company_id"))
            .bind(if json_bool_or_default(data, "is_primary_company_contact", false) { 1 } else { 0 })
            .bind(json_string_or_default(data, "country_code", &workspace_country))
            .bind(json_string_optional(data, "contact_name"))
            .bind(json_string_optional(data, "email"))
            .bind(json_string_optional(data, "website"))
            .bind(json_string_optional(data, "phone"))
            .bind(json_string_or_default(data, "phone_e164", ""))
            .bind(
                json_string_optional(data, "phone_country_code")
                    .or_else(|| json_string_optional(data, "country_code"))
                    .unwrap_or_else(|| workspace_country.clone()),
            )
            .bind(json_string_optional(data, "abn"))
            .bind(json_string_or_default(data, "business_id_label", "Business ID"))
            .bind(json_string_optional(data, "business_id_value"))
            .bind(json_string_or_default(data, "tax_id_label", "Tax ID"))
            .bind(json_string_optional(data, "tax_id_value"))
            .bind(json_string_optional(data, "address"))
            .bind(json_string_optional(data, "notes"))
            .bind(json_string_optional(data, "logo_file_path"))
            .bind(json_string_optional(data, "custom_role_label"))
            .bind(json_field_to_string(data, "roles", serde_json::json!([]))?)
            .bind(json_field_to_string(data, "tags", serde_json::json!([]))?)
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import contact: {}", e))?;
            next_contact_sort_order += 1;
        } else {
            validate_setup_import_update_id_tx(&mut tx, &workspace_id, "contacts", &operation.id)
                .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE contacts SET
                 kind = CASE WHEN 'kind' IN mapped THEN ? ELSE kind END,
                 display_name = CASE WHEN 'display_name' IN mapped THEN ? ELSE display_name END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 company_name = CASE WHEN 'company_name' IN mapped THEN ? ELSE company_name END,
                 person_first_name = CASE WHEN 'person_first_name' IN mapped THEN ? ELSE person_first_name END,
                 person_last_name = CASE WHEN 'person_last_name' IN mapped THEN ? ELSE person_last_name END,
                 role_title = CASE WHEN 'role_title' IN mapped THEN ? ELSE role_title END,
                 linked_company_id = CASE WHEN 'linked_company_id' IN mapped THEN ? ELSE linked_company_id END,
                 is_primary_company_contact = CASE WHEN 'is_primary_company_contact' IN mapped THEN ? ELSE is_primary_company_contact END,
                 country_code = CASE WHEN 'country_code' IN mapped THEN ? ELSE country_code END,
                 contact_name = CASE WHEN 'contact_name' IN mapped THEN ? ELSE contact_name END,
                 email = CASE WHEN 'email' IN mapped THEN ? ELSE email END,
                 website = CASE WHEN 'website' IN mapped THEN ? ELSE website END,
                 phone = CASE WHEN 'phone' IN mapped THEN ? ELSE phone END,
                 phone_e164 = CASE WHEN 'phone' IN mapped THEN ? ELSE phone_e164 END,
                 phone_country_code = CASE WHEN 'phone' IN mapped OR 'country_code' IN mapped THEN ? ELSE phone_country_code END,
                 abn = CASE WHEN 'business_id_value' IN mapped THEN ? ELSE abn END,
                 business_id_label = CASE WHEN 'business_id_value' IN mapped THEN ? ELSE business_id_label END,
                 business_id_value = CASE WHEN 'business_id_value' IN mapped THEN ? ELSE business_id_value END,
                 tax_id_label = CASE WHEN 'tax_id_value' IN mapped THEN ? ELSE tax_id_label END,
                 tax_id_value = CASE WHEN 'tax_id_value' IN mapped THEN ? ELSE tax_id_value END,
                 address = CASE WHEN 'address' IN mapped THEN ? ELSE address END,
                 notes = CASE WHEN 'notes' IN mapped THEN ? ELSE notes END,
                 custom_role_label = CASE WHEN 'custom_role_label' IN mapped THEN ? ELSE custom_role_label END,
                 roles_json = CASE WHEN 'roles' IN mapped THEN ? ELSE roles_json END,
                 tags_json = CASE WHEN 'tags' IN mapped THEN ? ELSE tags_json END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_or_default(data, "kind", "company"))
            .bind(
                json_string_optional(data, "display_name")
                    .or_else(|| json_string_optional(data, "name"))
                    .ok_or_else(|| "Missing required field: display_name or name".to_string())?,
            )
            .bind(
                json_string_optional(data, "name")
                    .or_else(|| json_string_optional(data, "display_name"))
                    .ok_or_else(|| "Missing required field: name or display_name".to_string())?,
            )
            .bind(json_string_optional(data, "company_name"))
            .bind(json_string_optional(data, "person_first_name"))
            .bind(json_string_optional(data, "person_last_name"))
            .bind(json_string_optional(data, "role_title"))
            .bind(json_string_optional(data, "linked_company_id"))
            .bind(if json_bool_or_default(data, "is_primary_company_contact", false) { 1 } else { 0 })
            .bind(json_string_or_default(data, "country_code", &workspace_country))
            .bind(json_string_optional(data, "contact_name"))
            .bind(json_string_optional(data, "email"))
            .bind(json_string_optional(data, "website"))
            .bind(json_string_optional(data, "phone"))
            .bind(json_string_or_default(data, "phone_e164", ""))
            .bind(
                json_string_optional(data, "phone_country_code")
                    .or_else(|| json_string_optional(data, "country_code"))
                    .unwrap_or_else(|| workspace_country.clone()),
            )
            .bind(json_string_optional(data, "abn"))
            .bind(json_string_or_default(data, "business_id_label", "Business ID"))
            .bind(json_string_optional(data, "business_id_value"))
            .bind(json_string_or_default(data, "tax_id_label", "Tax ID"))
            .bind(json_string_optional(data, "tax_id_value"))
            .bind(json_string_optional(data, "address"))
            .bind(json_string_optional(data, "notes"))
            .bind(json_string_optional(data, "custom_role_label"))
            .bind(json_field_to_string(data, "roles", serde_json::json!([]))?)
            .bind(json_field_to_string(data, "tags", serde_json::json!([]))?)
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import contact: {}", e))?;
        }

        if operation.action == "create"
            || setup_import_field_is_mapped(&operation.mapped_fields, "linked_company_id")
            || setup_import_field_is_mapped(&operation.mapped_fields, "is_primary_company_contact")
        {
            sync_contact_relationships_tx_json(&mut tx, &operation.id, &workspace_id, data).await?;
        }
    }

    for operation in input.materials {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO material_catalog_items
                 (id, workspace_id, code, name, category, specification, aliases_json, unit, default_rate, metadata_json, currency_code, effective_date, verified_date, rate_basis, lead_time, availability, reference, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "specification"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import material: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(&mut tx, &workspace_id, "materials", &operation.id)
                .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?))
                 UPDATE material_catalog_items SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 category = CASE WHEN 'category' IN mapped THEN ? ELSE category END,
                 specification = CASE WHEN 'specification' IN mapped THEN ? ELSE specification END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 unit = CASE WHEN 'unit' IN mapped THEN ? ELSE unit END,
                 default_rate = CASE WHEN 'default_rate' IN mapped THEN ? ELSE default_rate END,
                 currency_code = CASE WHEN 'currency_code' IN mapped THEN ? ELSE currency_code END,
                 effective_date = CASE WHEN 'effective_date' IN mapped THEN ? ELSE effective_date END,
                 verified_date = CASE WHEN 'verified_date' IN mapped THEN ? ELSE verified_date END,
                 rate_basis = CASE WHEN 'rate_basis' IN mapped THEN ? ELSE rate_basis END,
                 lead_time = CASE WHEN 'lead_time' IN mapped THEN ? ELSE lead_time END,
                 availability = CASE WHEN 'availability' IN mapped THEN ? ELSE availability END,
                 reference = CASE WHEN 'reference' IN mapped THEN ? ELSE reference END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "specification"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import material: {}", e))?;
        }
    }

    for operation in input.labour_rates {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO labour_rate_cards
                 (id, workspace_id, code, name, category, work_center, aliases_json, unit, default_rate, metadata_json, currency_code, effective_date, verified_date, rate_basis, lead_time, availability, reference, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "work_center"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import labour rate: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "labour_rates",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE labour_rate_cards SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 category = CASE WHEN 'category' IN mapped THEN ? ELSE category END,
                 work_center = CASE WHEN 'work_center' IN mapped THEN ? ELSE work_center END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 unit = CASE WHEN 'unit' IN mapped THEN ? ELSE unit END,
                 default_rate = CASE WHEN 'default_rate' IN mapped THEN ? ELSE default_rate END,
                 currency_code = CASE WHEN 'currency_code' IN mapped THEN ? ELSE currency_code END,
                 effective_date = CASE WHEN 'effective_date' IN mapped THEN ? ELSE effective_date END,
                 verified_date = CASE WHEN 'verified_date' IN mapped THEN ? ELSE verified_date END,
                 rate_basis = CASE WHEN 'rate_basis' IN mapped THEN ? ELSE rate_basis END,
                 lead_time = CASE WHEN 'lead_time' IN mapped THEN ? ELSE lead_time END,
                 availability = CASE WHEN 'availability' IN mapped THEN ? ELSE availability END,
                 reference = CASE WHEN 'reference' IN mapped THEN ? ELSE reference END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "work_center"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import labour rate: {}", e))?;
        }
    }

    for operation in input.equipment_rates {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO equipment_rate_cards
                 (id, workspace_id, code, name, category, work_center, aliases_json, unit, default_rate, metadata_json, currency_code, effective_date, verified_date, rate_basis, lead_time, availability, reference, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "work_center"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import equipment rate: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "equipment_rates",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE equipment_rate_cards SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 category = CASE WHEN 'category' IN mapped THEN ? ELSE category END,
                 work_center = CASE WHEN 'work_center' IN mapped THEN ? ELSE work_center END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 unit = CASE WHEN 'unit' IN mapped THEN ? ELSE unit END,
                 default_rate = CASE WHEN 'default_rate' IN mapped THEN ? ELSE default_rate END,
                 currency_code = CASE WHEN 'currency_code' IN mapped THEN ? ELSE currency_code END,
                 effective_date = CASE WHEN 'effective_date' IN mapped THEN ? ELSE effective_date END,
                 verified_date = CASE WHEN 'verified_date' IN mapped THEN ? ELSE verified_date END,
                 rate_basis = CASE WHEN 'rate_basis' IN mapped THEN ? ELSE rate_basis END,
                 lead_time = CASE WHEN 'lead_time' IN mapped THEN ? ELSE lead_time END,
                 availability = CASE WHEN 'availability' IN mapped THEN ? ELSE availability END,
                 reference = CASE WHEN 'reference' IN mapped THEN ? ELSE reference END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_string_optional(data, "work_center"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import equipment rate: {}", e))?;
        }
    }

    for operation in input.subcontract_rates {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO subcontract_rate_cards
                 (id, workspace_id, code, name, category, aliases_json, unit, default_rate, metadata_json, currency_code, effective_date, verified_date, rate_basis, lead_time, availability, reference, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import subcontract rate: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "subcontract_rates",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE subcontract_rate_cards SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 category = CASE WHEN 'category' IN mapped THEN ? ELSE category END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 unit = CASE WHEN 'unit' IN mapped THEN ? ELSE unit END,
                 default_rate = CASE WHEN 'default_rate' IN mapped THEN ? ELSE default_rate END,
                 currency_code = CASE WHEN 'currency_code' IN mapped THEN ? ELSE currency_code END,
                 effective_date = CASE WHEN 'effective_date' IN mapped THEN ? ELSE effective_date END,
                 verified_date = CASE WHEN 'verified_date' IN mapped THEN ? ELSE verified_date END,
                 rate_basis = CASE WHEN 'rate_basis' IN mapped THEN ? ELSE rate_basis END,
                 lead_time = CASE WHEN 'lead_time' IN mapped THEN ? ELSE lead_time END,
                 availability = CASE WHEN 'availability' IN mapped THEN ? ELSE availability END,
                 reference = CASE WHEN 'reference' IN mapped THEN ? ELSE reference END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_optional(data, "category"))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_string_required(data, "unit")?)
            .bind(json_f64_required(data, "default_rate")?)
            .bind(json_string_optional(data, "currency_code"))
            .bind(json_string_optional(data, "effective_date"))
            .bind(json_string_optional(data, "verified_date"))
            .bind(json_string_or_default(data, "rate_basis", "cost"))
            .bind(json_string_or_default(data, "lead_time", ""))
            .bind(json_string_or_default(data, "availability", ""))
            .bind(json_string_or_default(data, "reference", ""))
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import subcontract rate: {}", e))?;
        }
    }

    for operation in input.cost_presets {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO cost_component_presets
                 (id, workspace_id, code, name, description, aliases_json, components_json, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_field_to_string(
                data,
                "components_json",
                serde_json::json!([]),
            )?)
            .bind(if json_bool_or_default(data, "is_active", true) {
                1
            } else {
                0
            })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import cost preset: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "cost_presets",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE cost_component_presets SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 description = CASE WHEN 'description' IN mapped THEN ? ELSE description END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 components_json = CASE WHEN 'components_json' IN mapped THEN ? ELSE components_json END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_field_to_string(data, "components_json", serde_json::json!([]))?)
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import cost preset: {}", e))?;
        }
    }

    for operation in input.estimate_templates {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO estimate_templates
                 (id, workspace_id, code, name, description, aliases_json, estimate_json, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(json_field_to_string(
                data,
                "aliases",
                serde_json::json!([]),
            )?)
            .bind(json_field_to_string(
                data,
                "estimate_json",
                serde_json::json!({"scope_summary":"","notes":"","takeoff_items":[]}),
            )?)
            .bind(if json_bool_or_default(data, "is_active", true) {
                1
            } else {
                0
            })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import estimate template: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "estimate_templates",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE estimate_templates SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 description = CASE WHEN 'description' IN mapped THEN ? ELSE description END,
                 aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
                 estimate_json = CASE WHEN 'estimate_json' IN mapped THEN ? ELSE estimate_json END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(json_field_to_string(data, "aliases", serde_json::json!([]))?)
            .bind(json_field_to_string(
                data,
                "estimate_json",
                serde_json::json!({"scope_summary":"","notes":"","takeoff_items":[]}),
            )?)
            .bind(if json_bool_or_default(data, "is_active", true) { 1 } else { 0 })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import estimate template: {}", e))?;
        }
    }

    for operation in input.project_structure_templates {
        let data = &operation.data;
        if operation.action == "create" {
            sqlx::query(
                "INSERT INTO project_structure_templates
                 (id, workspace_id, code, name, description, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&operation.id)
            .bind(&workspace_id)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(if json_bool_or_default(data, "is_active", true) {
                1
            } else {
                0
            })
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import project structure template: {}", e))?;
        } else {
            validate_setup_import_update_id_tx(
                &mut tx,
                &workspace_id,
                "project_structure_templates",
                &operation.id,
            )
            .await?;
            sqlx::query(
                "WITH mapped(value) AS (SELECT value FROM json_each(?))
                 UPDATE project_structure_templates SET
                 code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
                 name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
                 description = CASE WHEN 'description' IN mapped THEN ? ELSE description END,
                 is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
                 updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
            .bind(json_string_optional(data, "code"))
            .bind(json_string_required(data, "name")?)
            .bind(json_string_or_default(data, "description", ""))
            .bind(if json_bool_or_default(data, "is_active", true) {
                1
            } else {
                0
            })
            .bind(&now)
            .bind(&operation.id)
            .bind(&workspace_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update setup import project structure template: {}", e))?;
        }
    }

    let mut class_creates = Vec::new();
    let mut class_updates = Vec::new();
    let mut default_class_ids = Vec::new();

    for operation in input.classification_systems {
        let data = &operation.data;
        let is_default = json_bool_or_default(data, "is_default", false);

        let parsed = ParsedClassificationSystem {
            id: operation.id.clone(),
            mapped_fields: operation.mapped_fields,
            name: json_string_required(data, "name")?,
            code: json_string_or_default(data, "code", ""),
            type_: json_string_required(data, "classification_type")?,
            aliases_json: json_field_to_string(data, "aliases", serde_json::json!([]))?,
            is_default,
        };

        if is_default {
            default_class_ids.push(parsed.id.clone());
        }

        if operation.action == "create" {
            class_creates.push(parsed);
        } else {
            class_updates.push(parsed);
        }
    }

    if !default_class_ids.is_empty() {
        let mut qb = sqlx::QueryBuilder::new(
            "UPDATE classification_systems SET is_default = 0 WHERE workspace_id = ",
        );
        qb.push_bind(&workspace_id);
        qb.push(" AND id NOT IN (");
        let mut separated = qb.separated(", ");
        for id in &default_class_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(") AND is_default = 1");

        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Clear other default classification systems: {}", e))?;
    }

    if !class_creates.is_empty() {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO classification_systems (id, workspace_id, name, code, classification_type, aliases_json, is_default) "
        );
        qb.push_values(class_creates, |mut b, class| {
            b.push_bind(class.id)
                .push_bind(&workspace_id)
                .push_bind(class.name)
                .push_bind(class.code)
                .push_bind(class.type_)
                .push_bind(class.aliases_json)
                .push_bind(if class.is_default { 1 } else { 0 });
        });

        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import classification system: {}", e))?;
    }

    for class in class_updates {
        validate_setup_import_update_id_tx(
            &mut tx,
            &workspace_id,
            "classification_systems",
            &class.id,
        )
        .await?;
        sqlx::query(
            "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE classification_systems SET
             name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
             code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
             classification_type = CASE WHEN 'classification_type' IN mapped THEN ? ELSE classification_type END,
             aliases_json = CASE WHEN 'aliases' IN mapped THEN ? ELSE aliases_json END,
             is_default = CASE WHEN 'is_default' IN mapped THEN ? ELSE is_default END
             WHERE id = ? AND workspace_id = ?",
        )
        .bind(serde_json::to_string(&class.mapped_fields).map_err(|e| e.to_string())?)
        .bind(class.name)
        .bind(class.code)
        .bind(class.type_)
        .bind(class.aliases_json)
        .bind(if class.is_default { 1 } else { 0 })
        .bind(class.id)
        .bind(&workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update setup import classification system: {}", e))?;
    }

    let mut cost_codes_to_create = Vec::new();
    let mut cost_codes_to_update = Vec::new();

    for operation in input.cost_codes {
        if operation.action == "create" {
            cost_codes_to_create.push(operation);
        } else {
            cost_codes_to_update.push(operation);
        }
    }

    for chunk in cost_codes_to_create.chunks(250) {
        let mut qb = sqlx::QueryBuilder::new(
            "INSERT INTO cost_codes (id, classification_system_id, parent_id, code, name, description, is_active, sort_order) "
        );
        let mut has_error = None;
        qb.push_values(chunk, |mut b, operation| {
            let data = &operation.data;
            let code_result = json_string_required(data, "code");
            let name_result = json_string_required(data, "name");
            let sort_order_result = json_i64_required(data, "sort_order");

            if code_result.is_err() || name_result.is_err() || sort_order_result.is_err() {
                has_error = Some(
                    code_result
                        .err()
                        .or(name_result.err())
                        .or(sort_order_result.err())
                        .unwrap(),
                );
                return;
            }

            b.push_bind(&operation.id)
                .push_bind(&operation.classification_system_id)
                .push_bind(json_string_optional(data, "parent_id"))
                .push_bind(code_result.unwrap())
                .push_bind(name_result.unwrap())
                .push_bind(json_string_or_default(data, "description", ""))
                .push_bind(if json_bool_or_default(data, "is_active", true) {
                    1
                } else {
                    0
                })
                .push_bind(sort_order_result.unwrap());
        });

        if let Some(err) = has_error {
            return Err(err);
        }

        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert setup import cost code chunk: {}", e))?;
    }

    for operation in cost_codes_to_update {
        validate_setup_import_update_id_tx(&mut tx, &workspace_id, "cost_codes", &operation.id)
            .await?;
        let data = &operation.data;
        sqlx::query(
            "WITH mapped(value) AS (SELECT value FROM json_each(?)) UPDATE cost_codes SET
             parent_id = CASE WHEN 'parent_id' IN mapped THEN ? ELSE parent_id END,
             code = CASE WHEN 'code' IN mapped THEN ? ELSE code END,
             name = CASE WHEN 'name' IN mapped THEN ? ELSE name END,
             description = CASE WHEN 'description' IN mapped THEN ? ELSE description END,
             is_active = CASE WHEN 'is_active' IN mapped THEN ? ELSE is_active END,
             sort_order = CASE WHEN 'sort_order' IN mapped THEN ? ELSE sort_order END
             WHERE id = ? AND classification_system_id = ?",
        )
        .bind(serde_json::to_string(&operation.mapped_fields).map_err(|e| e.to_string())?)
        .bind(json_string_optional(data, "parent_id"))
        .bind(json_string_required(data, "code")?)
        .bind(json_string_required(data, "name")?)
        .bind(json_string_or_default(data, "description", ""))
        .bind(if json_bool_or_default(data, "is_active", true) {
            1
        } else {
            0
        })
        .bind(json_i64_required(data, "sort_order")?)
        .bind(&operation.id)
        .bind(&operation.classification_system_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update setup import cost code: {}", e))?;
    }

    for link in input.company_catalogue_links {
        insert_company_catalogue_link_tx(
            &mut tx,
            &workspace_id,
            link.scope,
            &link.record_id,
            &link.company_id,
        )
        .await?;
    }

    let imported_sheet_ids_json = serde_json::to_string(&input.audit.imported_sheet_ids)
        .map_err(|e| format!("Serialize setup import sheet ids: {e}"))?;
    if serde_json::from_str::<serde_json::Value>(&input.audit.duplicate_modes_json).is_err() {
        return Err("Setup import duplicate modes must be valid JSON".into());
    }
    sqlx::query(
		"INSERT INTO setup_import_audit
		 (id, workspace_id, source_file_name, source_content_hash, imported_sheet_ids_json, duplicate_modes_json, created_count, updated_count, skipped_count, failure_summary, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
	.bind(&input.audit.id)
	.bind(&workspace_id)
	.bind(&input.audit.source_file_name)
	.bind(&input.audit.source_content_hash)
	.bind(imported_sheet_ids_json)
	.bind(&input.audit.duplicate_modes_json)
	.bind(input.audit.created_count)
	.bind(input.audit.updated_count)
	.bind(input.audit.skipped_count)
	.bind(&input.audit.failure_summary)
	.bind(&now)
	.execute(&mut *tx)
	.await
	.map_err(|e| format!("Insert setup import audit: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit setup import session transaction: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn duplicate_project_records_command(
    app: AppHandle,
    input: DuplicateProjectInput,
) -> Result<(), String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut tx = begin_immediate(&pool)
        .await
        .map_err(|e| format!("Begin duplicate project records transaction: {}", e))?;

    let project = &input.project;
    sqlx::query(
        "INSERT INTO projects
         (id, workspace_id, sort_order, is_favourite, quote_round_prices, rfq_number, contact_id, contact_name_snapshot, requester_contact_id, quote_recipient_contact_id, requester_name_snapshot, project_name, due_date, received_date, submission_deadline_at, estimator_name, customer_tender_reference, addendum_label, addendum_date, addendum_notes, site_address, delivery_address, source_channel, source_reference, priority, status, content, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(json_string_required(project, "id")?)
    .bind(json_string_required(project, "workspace_id")?)
    .bind(json_i64_required(project, "sort_order")?)
    .bind(if json_bool_or_default(project, "is_favourite", false) { 1 } else { 0 })
    .bind(if json_bool_or_default(project, "quote_round_prices", false) { 1 } else { 0 })
    .bind(json_string_required(project, "rfq_number")?)
    .bind(json_string_optional(project, "contact_id"))
    .bind(json_string_optional(project, "contact_name_snapshot"))
    .bind(json_string_optional(project, "requester_contact_id"))
    .bind(json_string_optional(project, "quote_recipient_contact_id"))
    .bind(json_string_optional(project, "requester_name_snapshot"))
    .bind(json_string_optional(project, "project_name"))
    .bind(json_string_optional(project, "due_date"))
    .bind(json_string_optional(project, "received_date"))
    .bind(json_string_optional(project, "submission_deadline_at"))
    .bind(json_string_optional(project, "estimator_name"))
    .bind(json_string_optional(project, "customer_tender_reference"))
    .bind(json_string_optional(project, "addendum_label"))
    .bind(json_string_optional(project, "addendum_date"))
    .bind(json_string_optional(project, "addendum_notes"))
    .bind(json_string_optional(project, "site_address"))
    .bind(json_string_optional(project, "delivery_address"))
    .bind(json_string_or_default(project, "source_channel", "manual"))
    .bind(json_string_optional(project, "source_reference"))
    .bind(json_string_required(project, "priority")?)
    .bind(json_string_required(project, "status")?)
    .bind(json_string_optional(project, "content"))
    .bind(json_string_optional(project, "note"))
    .bind(json_string_required(project, "updated_at")?)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Insert duplicated project: {}", e))?;

    if !input.quote_options.is_empty() {
        struct ParsedOption {
            id: String,
            project_id: String,
            label: String,
            lead_time: String,
            markup_percentage: f64,
            material_markup_percentage: Option<f64>,
            labour_markup_percentage: Option<f64>,
            equipment_markup_percentage: Option<f64>,
            subcontract_markup_percentage: Option<f64>,
            notes: String,
            sort_order: i64,
            is_default: i32,
        }

        let mut parsed_options = Vec::with_capacity(input.quote_options.len());
        for option in input.quote_options {
            parsed_options.push(ParsedOption {
                id: json_string_required(&option, "id")?,
                project_id: json_string_required(&option, "project_id")?,
                label: json_string_required(&option, "label")?,
                lead_time: json_string_required(&option, "lead_time")?,
                markup_percentage: json_f64_required(&option, "markup_percentage")?,
                material_markup_percentage: json_f64_optional(
                    &option,
                    "material_markup_percentage",
                )?,
                labour_markup_percentage: json_f64_optional(&option, "labour_markup_percentage")?,
                equipment_markup_percentage: json_f64_optional(
                    &option,
                    "equipment_markup_percentage",
                )?,
                subcontract_markup_percentage: json_f64_optional(
                    &option,
                    "subcontract_markup_percentage",
                )?,
                notes: json_string_or_default(&option, "notes", ""),
                sort_order: json_i64_required(&option, "sort_order")?,
                is_default: if json_bool_or_default(&option, "is_default", false) {
                    1
                } else {
                    0
                },
            });
        }

        let mut query_builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "INSERT INTO quote_options (id, project_id, label, lead_time, markup_percentage, material_markup_percentage, labour_markup_percentage, equipment_markup_percentage, subcontract_markup_percentage, notes, sort_order, is_default) "
        );

        query_builder.push_values(parsed_options, |mut b, option| {
            b.push_bind(option.id)
                .push_bind(option.project_id)
                .push_bind(option.label)
                .push_bind(option.lead_time)
                .push_bind(option.markup_percentage)
                .push_bind(option.material_markup_percentage)
                .push_bind(option.labour_markup_percentage)
                .push_bind(option.equipment_markup_percentage)
                .push_bind(option.subcontract_markup_percentage)
                .push_bind(option.notes)
                .push_bind(option.sort_order)
                .push_bind(option.is_default);
        });

        query_builder
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert duplicated quote options: {}", e))?;
    }

    for node in input.wbs_nodes {
        sqlx::query(
            "INSERT INTO wbs_nodes
             (id, project_id, parent_id, code, name, type, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(json_string_required(&node, "id")?)
        .bind(json_string_required(&node, "project_id")?)
        .bind(json_string_optional(&node, "parent_id"))
        .bind(json_string_optional(&node, "code"))
        .bind(json_string_required(&node, "name")?)
        .bind(json_string_required(&node, "type")?)
        .bind(json_i64_required(&node, "sort_order")?)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert duplicated WBS node: {}", e))?;
    }

    if !input.assets.is_empty() {
        for chunk in input.assets.chunks(100) {
            let mut query_builder = QueryBuilder::<Sqlite>::new(
                "INSERT INTO assets (id, project_id, display_name, thumbnail_file_id, is_selected, quote_quantity, is_pdf_included) "
            );

            // We need to return error if parsing fails, but push_values closure doesn't allow returning Result.
            // So we first parse all values, then pass to push_values.
            let mut parsed_assets = Vec::with_capacity(chunk.len());
            for asset in chunk {
                parsed_assets.push((
                    json_string_required(asset, "id")?,
                    json_string_required(asset, "project_id")?,
                    json_string_required(asset, "display_name")?,
                    json_string_optional(asset, "thumbnail_file_id"),
                    if json_bool_or_default(asset, "is_selected", false) {
                        1
                    } else {
                        0
                    },
                    json_f64_required(asset, "quote_quantity")?,
                    if json_bool_or_default(asset, "is_pdf_included", true) {
                        1
                    } else {
                        0
                    },
                ));
            }

            query_builder.push_values(
                parsed_assets,
                |mut b,
                 (
                    id,
                    project_id,
                    display_name,
                    thumbnail_file_id,
                    is_selected,
                    quote_quantity,
                    is_pdf_included,
                )| {
                    b.push_bind(id)
                        .push_bind(project_id)
                        .push_bind(display_name)
                        .push_bind(thumbnail_file_id)
                        .push_bind(is_selected)
                        .push_bind(quote_quantity)
                        .push_bind(is_pdf_included);
                },
            );

            query_builder
                .build()
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Insert duplicated asset: {}", e))?;
        }
    }

    let max_files_per_insert = 100;

    for chunk in input.files.chunks(max_files_per_insert) {
        if chunk.is_empty() {
            continue;
        }

        let mut builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "INSERT INTO files (id, project_id, asset_id, file_path, original_name, mime_type) ",
        );
        let mut first_err = None;
        builder.push_values(chunk.iter(), |mut b, file| {
            let id = json_string_required(file, "id");
            let project_id = json_string_required(file, "project_id");
            let file_path = json_string_required(file, "file_path");
            let original_name = json_string_required(file, "original_name");

            if let Err(ref e) = id {
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
            }
            if let Err(ref e) = project_id {
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
            }
            if let Err(ref e) = file_path {
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
            }
            if let Err(ref e) = original_name {
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
            }

            b.push_bind(id.unwrap_or_default())
                .push_bind(project_id.unwrap_or_default())
                .push_bind(json_string_optional(file, "asset_id"))
                .push_bind(file_path.unwrap_or_default())
                .push_bind(original_name.unwrap_or_default())
                .push_bind(json_string_optional(file, "mime_type"));
        });

        if let Some(err) = first_err {
            return Err(err);
        }

        builder
            .build()
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert duplicated file: {}", e))?;
    }

    for asset_update in input.asset_thumbnail_updates {
        sqlx::query("UPDATE assets SET thumbnail_file_id = ? WHERE id = ?")
            .bind(json_string_optional(&asset_update, "thumbnail_file_id"))
            .bind(json_string_required(&asset_update, "asset_id")?)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Update duplicated asset thumbnail: {}", e))?;
    }

    for estimate in input.estimates {
        let next_asset_id = json_string_required(&estimate, "asset_id")?;
        sqlx::query(
            "INSERT INTO estimates
             (asset_id, scope_summary, notes, classification_system_id, wbs_root_node_id, applied_template_id, applied_template_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&next_asset_id)
        .bind(json_string_or_default(&estimate, "scope_summary", ""))
        .bind(json_string_or_default(&estimate, "notes", ""))
        .bind(json_string_optional(&estimate, "classification_system_id"))
        .bind(json_string_optional(&estimate, "wbs_root_node_id"))
        .bind(json_string_optional(&estimate, "applied_template_id"))
        .bind(json_string_optional(&estimate, "applied_template_name"))
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Insert duplicated estimate: {}", e))?;

        for item in json_array(&estimate, "takeoff_items") {
            let takeoff_id = json_string_required(item, "id")?;
            sqlx::query(
                "INSERT INTO takeoff_items
                 (id, estimate_asset_id, parent_id, wbs_node_id, cost_code_id, applied_preset_id, applied_preset_name, name, description, quantity, unit, properties_json, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&takeoff_id)
            .bind(&next_asset_id)
            .bind(json_string_optional(item, "parent_id"))
            .bind(json_string_optional(item, "wbs_node_id"))
            .bind(json_string_optional(item, "cost_code_id"))
            .bind(json_string_optional(item, "applied_preset_id"))
            .bind(json_string_optional(item, "applied_preset_name"))
            .bind(json_string_required(item, "name")?)
            .bind(json_string_or_default(item, "description", ""))
            .bind(json_f64_required(item, "quantity")?)
            .bind(json_string_required(item, "unit")?)
            .bind(json_field_to_string(item, "properties", serde_json::json!({}))?)
            .bind(json_i64_required(item, "sort_order")?)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Insert duplicated takeoff item: {}", e))?;

            let components = json_array(item, "cost_components");
            if !components.is_empty() {
                let mut parsed_components = Vec::with_capacity(components.len());
                for component in components {
                    parsed_components.push((
                        json_string_required(component, "id")?,
                        json_string_required(component, "category")?,
                        json_string_required(component, "source_type")?,
                        json_string_optional(component, "source_id"),
                        json_string_required(component, "name")?,
                        json_string_or_default(component, "description", ""),
                        json_f64_required(component, "quantity")?,
                        json_string_required(component, "unit")?,
                        json_f64_required(component, "unit_rate")?,
                        json_string_optional(component, "source_unit_rate_decimal"),
                        json_string_optional(component, "source_currency_code"),
                        json_string_optional(component, "fx_rate_snapshot_id"),
                        json_field_to_string(component, "formula", serde_json::json!({}))?,
                        json_field_to_string(component, "metadata", serde_json::json!({}))?,
                        json_i64_or_default(component, "sort_order", 0),
                    ));
                }

                for chunk in parsed_components.chunks(50) {
                    let mut qb = QueryBuilder::<Sqlite>::new(
                        "INSERT INTO cost_components
                         (id, takeoff_item_id, category, source_type, source_id, name, description, quantity, unit, unit_rate, source_unit_rate_decimal, source_currency_code, fx_rate_snapshot_id, formula_json, metadata_json, sort_order) ",
                    );

                    qb.push_values(chunk, |mut b, component| {
                        b.push_bind(&component.0)
                            .push_bind(&takeoff_id)
                            .push_bind(&component.1)
                            .push_bind(&component.2)
                            .push_bind(&component.3)
                            .push_bind(&component.4)
                            .push_bind(&component.5)
                            .push_bind(component.6)
                            .push_bind(&component.7)
                            .push_bind(component.8)
                            .push_bind(&component.9)
                            .push_bind(&component.10)
                            .push_bind(&component.11)
                            .push_bind(&component.12)
                            .push_bind(&component.13)
                            .push_bind(component.14);
                    });

                    qb.build()
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| format!("Insert duplicated cost component: {}", e))?;
                }
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit duplicate project records transaction: {}", e))?;
    Ok(())
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchQueryInput {
    pub query: String,
    pub browse: Option<bool>,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub include_inactive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultRow {
    pub table_name: String,
    pub record_type: Option<String>,
    pub scope: Option<String>,
    pub record_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub rank: f64,
    pub fields: serde_json::Value,
}

#[derive(Clone, Copy)]
enum FieldType {
    Text,
    Real,
    Integer,
}

#[derive(Clone, Copy)]
enum SearchKind {
    FtsNoJoin {
        fts_table: &'static str,
        base_table: &'static str,
        join_clause: Option<&'static str>,
        workspace_id_col: &'static str,
        id_col: &'static str,
        title_col: &'static str,
        subtitle_col: Option<&'static str>,
    },
    FtsWithJoin {
        fts_table: &'static str,
        base_table: &'static str,
        title_col: &'static str,
        subtitle_col: Option<&'static str>,
        extra_fields: &'static [(&'static str, FieldType)],
        has_is_active: bool,
    },
    LikeSearch {
        base_table: &'static str,
        join_clause: Option<&'static str>,
        workspace_id_col: &'static str,
        like_cols: &'static [&'static str],
        title_col: &'static str,
        subtitle_col: Option<&'static str>,
        extra_fields: &'static [(&'static str, FieldType)],
        has_is_active: bool,
        order_col: &'static str,
    },
}

struct SearchScopeConfig {
    scope_name: &'static str,
    table_name: &'static str,
    record_type: Option<&'static str>,
    kind: SearchKind,
}

static SEARCH_SCOPES: &[SearchScopeConfig] = &[
    SearchScopeConfig {
        scope_name: "projects",
        table_name: "projects",
        record_type: None,
        kind: SearchKind::FtsNoJoin {
            fts_table: "global_search_index",
            base_table: "projects",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            id_col: "id",
            title_col: "project_name",
            subtitle_col: Some("rfq_number"),
        },
    },
    SearchScopeConfig {
        scope_name: "contacts",
        table_name: "contacts",
        record_type: Some("contacts"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "contacts_search_index",
            base_table: "contacts",
            title_col: "display_name",
            subtitle_col: Some("company_name"),
            extra_fields: &[
                ("kind", FieldType::Text),
                ("email", FieldType::Text),
                ("phone", FieldType::Text),
            ],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "materials",
        table_name: "material_catalog_items",
        record_type: Some("materials"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "materials_search_index",
            base_table: "material_catalog_items",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[
                ("category", FieldType::Text),
                ("unit", FieldType::Text),
                ("default_rate", FieldType::Real),
                ("currency_code", FieldType::Text),
                ("rate_basis", FieldType::Text),
            ],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "labour_rates",
        table_name: "labour_rate_cards",
        record_type: Some("labour_rates"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "labour_search_index",
            base_table: "labour_rate_cards",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[
                ("unit", FieldType::Text),
                ("default_rate", FieldType::Real),
                ("currency_code", FieldType::Text),
                ("rate_basis", FieldType::Text),
            ],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "equipment_rates",
        table_name: "equipment_rate_cards",
        record_type: Some("equipment_rates"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "equipment_search_index",
            base_table: "equipment_rate_cards",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[
                ("unit", FieldType::Text),
                ("default_rate", FieldType::Real),
                ("currency_code", FieldType::Text),
                ("rate_basis", FieldType::Text),
            ],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "subcontract_rates",
        table_name: "subcontract_rate_cards",
        record_type: Some("subcontract_rates"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "subcontract_search_index",
            base_table: "subcontract_rate_cards",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[
                ("unit", FieldType::Text),
                ("default_rate", FieldType::Real),
                ("currency_code", FieldType::Text),
                ("rate_basis", FieldType::Text),
            ],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "cost_component_presets",
        table_name: "cost_component_presets",
        record_type: Some("cost_component_presets"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "cost_presets_search_index",
            base_table: "cost_component_presets",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "estimate_templates",
        table_name: "estimate_templates",
        record_type: Some("estimate_templates"),
        kind: SearchKind::FtsWithJoin {
            fts_table: "templates_search_index",
            base_table: "estimate_templates",
            title_col: "name",
            subtitle_col: Some("code"),
            extra_fields: &[],
            has_is_active: true,
        },
    },
    SearchScopeConfig {
        scope_name: "classifications",
        table_name: "classification_systems",
        record_type: Some("classifications"),
        kind: SearchKind::LikeSearch {
            base_table: "classification_systems",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            like_cols: &[
                "base.name",
                "base.code",
                "base.classification_type",
            ],
            title_col: "base.name",
            subtitle_col: Some("base.code"),
            extra_fields: &[("classification_type", FieldType::Text)],
            has_is_active: false,
            order_col: "base.name ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "cost_codes",
        table_name: "cost_codes",
        record_type: Some("cost_codes"),
        kind: SearchKind::LikeSearch {
            base_table: "cost_codes",
            join_clause: Some("JOIN classification_systems cs ON cs.id = base.classification_system_id"),
            workspace_id_col: "cs.workspace_id",
            like_cols: &["base.name", "base.code", "base.description"],
            title_col: "base.name",
            subtitle_col: Some("base.code"),
            extra_fields: &[
                ("classification_system_id", FieldType::Text),
                ("parent_id", FieldType::Text),
            ],
            has_is_active: true,
            order_col: "base.code ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "quote_option_presets",
        table_name: "quote_option_presets",
        record_type: Some("quote_option_presets"),
        kind: SearchKind::LikeSearch {
            base_table: "quote_option_presets",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            like_cols: &[
                "base.label",
                "base.lead_time",
                "base.notes",
            ],
            title_col: "base.label",
            subtitle_col: Some("base.lead_time"),
            extra_fields: &[
                ("markup_percentage", FieldType::Real),
                ("notes", FieldType::Text),
            ],
            has_is_active: false,
            order_col: "base.label ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "project_structure_templates",
        table_name: "project_structure_templates",
        record_type: Some("project_structure_templates"),
        kind: SearchKind::LikeSearch {
            base_table: "project_structure_templates",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            like_cols: &[
                "base.name",
                "base.code",
                "base.description",
            ],
            title_col: "base.name",
            subtitle_col: Some("base.code"),
            extra_fields: &[("description", FieldType::Text)],
            has_is_active: true,
            order_col: "base.name ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "wbs_nodes",
        table_name: "wbs_nodes",
        record_type: Some("wbs_nodes"),
        kind: SearchKind::LikeSearch {
            base_table: "wbs_nodes",
            join_clause: Some("JOIN projects project ON project.id = base.project_id"),
            workspace_id_col: "project.workspace_id",
            like_cols: &["base.name", "base.code", "base.type"],
            title_col: "base.name",
            subtitle_col: Some("base.code"),
            extra_fields: &[
                ("project_id", FieldType::Text),
                ("parent_id", FieldType::Text),
                ("type", FieldType::Text),
            ],
            has_is_active: false,
            order_col: "base.sort_order ASC, base.name ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "template_nodes",
        table_name: "project_structure_template_nodes",
        record_type: Some("template_nodes"),
        kind: SearchKind::LikeSearch {
            base_table: "project_structure_template_nodes",
            join_clause: Some("JOIN project_structure_templates template ON template.id = base.template_id"),
            workspace_id_col: "template.workspace_id",
            like_cols: &[
                "base.name",
                "base.code",
                "base.type",
            ],
            title_col: "base.name",
            subtitle_col: Some("base.code"),
            extra_fields: &[
                ("template_id", FieldType::Text),
                ("parent_id", FieldType::Text),
                ("type", FieldType::Text),
            ],
            has_is_active: false,
            order_col: "base.sort_order ASC, base.name ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "assets",
        table_name: "assets",
        record_type: Some("assets"),
        kind: SearchKind::LikeSearch {
            base_table: "assets",
            join_clause: Some("JOIN projects project ON project.id = base.project_id"),
            workspace_id_col: "project.workspace_id",
            like_cols: &["base.display_name"],
            title_col: "base.display_name",
            subtitle_col: Some("base.project_id"),
            extra_fields: &[("project_id", FieldType::Text)],
            has_is_active: false,
            order_col: "base.display_name ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "quote_options",
        table_name: "quote_options",
        record_type: Some("quote_options"),
        kind: SearchKind::LikeSearch {
            base_table: "quote_options",
            join_clause: Some("JOIN projects project ON project.id = base.project_id"),
            workspace_id_col: "project.workspace_id",
            like_cols: &[
                "base.label",
                "base.lead_time",
                "base.notes",
            ],
            title_col: "base.label",
            subtitle_col: Some("base.lead_time"),
            extra_fields: &[
                ("project_id", FieldType::Text),
                ("markup_percentage", FieldType::Real),
            ],
            has_is_active: false,
            order_col: "base.sort_order ASC, base.label ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "contact_relationships",
        table_name: "contact_relationships",
        record_type: Some("contact_relationships"),
        kind: SearchKind::LikeSearch {
            base_table: "contact_relationships",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            like_cols: &[
                "base.relationship_type",
                "base.notes",
            ],
            title_col: "base.relationship_type",
            subtitle_col: Some("base.notes"),
            extra_fields: &[
                ("from_contact_id", FieldType::Text),
                ("to_contact_id", FieldType::Text),
                ("relationship_type", FieldType::Text),
            ],
            has_is_active: false,
            order_col: "base.relationship_type ASC",
        },
    },
    SearchScopeConfig {
        scope_name: "estimates",
        table_name: "estimates",
        record_type: None,
        kind: SearchKind::FtsNoJoin {
            fts_table: "estimates_search_index",
            base_table: "estimates",
            join_clause: Some(
                "JOIN assets asset ON asset.id = base.asset_id JOIN projects project ON project.id = asset.project_id",
            ),
            workspace_id_col: "project.workspace_id",
            id_col: "asset_id",
            title_col: "scope_summary",
            subtitle_col: None,
        },
    },
];

#[derive(Clone, Copy)]
struct RecordFieldConfig {
    name: &'static str,
    field_type: FieldType,
}

struct RecordScopeContract {
    scope: &'static str,
    label: &'static str,
    description: &'static str,
    searchable_fields: &'static [&'static str],
    detail_fields: &'static [RecordFieldConfig],
    supported_filters: &'static [&'static str],
    base_table: &'static str,
    join_clause: Option<&'static str>,
    workspace_id_col: &'static str,
    project_id_col: Option<&'static str>,
    id_col: &'static str,
    title_col: &'static str,
    subtitle_col: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordFieldDescription {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordScopeDescription {
    pub scope: String,
    pub label: String,
    pub description: String,
    pub searchable_fields: Vec<String>,
    pub detail_fields: Vec<RecordFieldDescription>,
    pub supported_filters: Vec<String>,
}

const CONTACT_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "kind",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "display_name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "company_name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "email",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "phone",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "role_title",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "custom_role_label",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "linked_company_id",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "is_primary_company_contact",
        field_type: FieldType::Integer,
    },
    RecordFieldConfig {
        name: "address",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "notes",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "is_active",
        field_type: FieldType::Integer,
    },
];
const RATE_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "code",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "category",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "unit",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "default_rate",
        field_type: FieldType::Real,
    },
    RecordFieldConfig {
        name: "currency_code",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "rate_basis",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "is_active",
        field_type: FieldType::Integer,
    },
];
const PROJECT_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "rfq_number",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "project_name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "contact_id",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "contact_name_snapshot",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "status",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "due_date",
        field_type: FieldType::Text,
    },
];
const GENERIC_NAME_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "code",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "description",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "is_active",
        field_type: FieldType::Integer,
    },
];
const CLASSIFICATION_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "code",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "classification_type",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "is_default",
        field_type: FieldType::Integer,
    },
];
const NODE_FIELDS: &[RecordFieldConfig] = &[
    RecordFieldConfig {
        name: "code",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "name",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "type",
        field_type: FieldType::Text,
    },
    RecordFieldConfig {
        name: "parent_id",
        field_type: FieldType::Text,
    },
];

fn record_scope_contract(scope: &str) -> Option<RecordScopeContract> {
    let contract = match scope {
        "projects" => RecordScopeContract {
            scope: "projects",
            label: "RFQs",
            description: "RFQ and project records.",
            searchable_fields: &["rfq_number", "project_name", "content", "note"],
            detail_fields: PROJECT_FIELDS,
            supported_filters: &[],
            base_table: "projects",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            project_id_col: Some("base.id"),
            id_col: "id",
            title_col: "project_name",
            subtitle_col: Some("rfq_number"),
        },
        "contacts" => RecordScopeContract {
            scope: "contacts",
            label: "Contacts",
            description: "Companies and people in the workspace CRM.",
            searchable_fields: &["display_name", "company_name", "email", "phone", "address", "notes"],
            detail_fields: CONTACT_FIELDS,
            supported_filters: &["includeInactive"],
            base_table: "contacts",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            project_id_col: None,
            id_col: "id",
            title_col: "display_name",
            subtitle_col: Some("company_name"),
        },
        "materials" => rate_scope_contract(
            "materials", "Materials", "Material catalogue records.", "material_catalog_items",
        ),
        "labour_rates" => rate_scope_contract(
            "labour_rates", "Labour rates", "Labour and trade rate cards.", "labour_rate_cards",
        ),
        "equipment_rates" => rate_scope_contract(
            "equipment_rates", "Equipment rates", "Plant and equipment rate cards.", "equipment_rate_cards",
        ),
        "subcontract_rates" => rate_scope_contract(
            "subcontract_rates", "Subcontract rates", "Subcontract and supplier rate cards.", "subcontract_rate_cards",
        ),
        "classifications" => RecordScopeContract {
            scope: "classifications",
            label: "Classification systems",
            description: "Classification systems.",
            searchable_fields: &["name", "code", "classification_type"],
            detail_fields: CLASSIFICATION_FIELDS,
            supported_filters: &[],
            base_table: "classification_systems",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            project_id_col: None,
            id_col: "id",
            title_col: "name",
            subtitle_col: Some("code"),
        },
        "cost_codes" => named_scope_contract(
            "cost_codes", "Cost codes", "Cost codes within classification systems.", "cost_codes",
            Some("JOIN classification_systems cs ON cs.id = base.classification_system_id"),
            "cs.workspace_id", None,
        ),
        "cost_component_presets" => named_scope_contract(
            "cost_component_presets", "Cost presets", "Reusable cost component presets.", "cost_component_presets",
            None, "base.workspace_id", None,
        ),
        "estimate_templates" => named_scope_contract(
            "estimate_templates", "Estimate templates", "Reusable estimate templates.", "estimate_templates",
            None, "base.workspace_id", None,
        ),
        "quote_option_presets" => RecordScopeContract {
            scope: "quote_option_presets",
            label: "Quote option presets",
            description: "Reusable quote pricing and lead-time presets.",
            searchable_fields: &["label", "lead_time", "notes"],
            detail_fields: &[
                RecordFieldConfig { name: "label", field_type: FieldType::Text },
                RecordFieldConfig { name: "lead_time", field_type: FieldType::Text },
                RecordFieldConfig { name: "markup_percentage", field_type: FieldType::Real },
                RecordFieldConfig { name: "notes", field_type: FieldType::Text },
            ],
            supported_filters: &[],
            base_table: "quote_option_presets",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            project_id_col: None,
            id_col: "id",
            title_col: "label",
            subtitle_col: Some("lead_time"),
        },
        "project_structure_templates" => named_scope_contract(
            "project_structure_templates", "Project structure templates",
            "Reusable project structure templates.", "project_structure_templates",
            None, "base.workspace_id", None,
        ),
        "wbs_nodes" => node_scope_contract(
            "wbs_nodes",
            "WBS nodes",
            "Project work-breakdown structure nodes.",
            "wbs_nodes",
            Some("JOIN projects project ON project.id = base.project_id"),
            "project.workspace_id",
            Some("base.project_id"),
        ),
        "template_nodes" => node_scope_contract(
            "template_nodes",
            "Template nodes",
            "Nodes within reusable project structure templates.",
            "project_structure_template_nodes",
            Some("JOIN project_structure_templates template ON template.id = base.template_id"),
            "template.workspace_id",
            None,
        ),
        "assets" => RecordScopeContract {
            scope: "assets",
            label: "Assets",
            description: "Project estimating assets.",
            searchable_fields: &["display_name"],
            detail_fields: &[
                RecordFieldConfig { name: "display_name", field_type: FieldType::Text },
                RecordFieldConfig { name: "project_id", field_type: FieldType::Text },
            ],
            supported_filters: &["projectId"],
            base_table: "assets",
            join_clause: Some("JOIN projects project ON project.id = base.project_id"),
            workspace_id_col: "project.workspace_id",
            project_id_col: Some("base.project_id"),
            id_col: "id",
            title_col: "display_name",
            subtitle_col: Some("project_id"),
        },
        "quote_options" => RecordScopeContract {
            scope: "quote_options",
            label: "Quote options",
            description: "Commercial quote options attached to RFQs.",
            searchable_fields: &["label", "lead_time", "notes"],
            detail_fields: &[
                RecordFieldConfig { name: "label", field_type: FieldType::Text },
                RecordFieldConfig { name: "lead_time", field_type: FieldType::Text },
                RecordFieldConfig { name: "markup_percentage", field_type: FieldType::Real },
                RecordFieldConfig { name: "project_id", field_type: FieldType::Text },
                RecordFieldConfig { name: "notes", field_type: FieldType::Text },
            ],
            supported_filters: &["projectId"],
            base_table: "quote_options",
            join_clause: Some("JOIN projects project ON project.id = base.project_id"),
            workspace_id_col: "project.workspace_id",
            project_id_col: Some("base.project_id"),
            id_col: "id",
            title_col: "label",
            subtitle_col: Some("lead_time"),
        },
        "contact_relationships" => RecordScopeContract {
            scope: "contact_relationships",
            label: "Contact relationships",
            description: "Relationships between workspace contacts.",
            searchable_fields: &["relationship_type", "notes"],
            detail_fields: &[
                RecordFieldConfig { name: "from_contact_id", field_type: FieldType::Text },
                RecordFieldConfig { name: "to_contact_id", field_type: FieldType::Text },
                RecordFieldConfig { name: "relationship_type", field_type: FieldType::Text },
                RecordFieldConfig { name: "notes", field_type: FieldType::Text },
            ],
            supported_filters: &[],
            base_table: "contact_relationships",
            join_clause: None,
            workspace_id_col: "base.workspace_id",
            project_id_col: None,
            id_col: "id",
            title_col: "relationship_type",
            subtitle_col: Some("notes"),
        },
        "estimates" => RecordScopeContract {
            scope: "estimates",
            label: "Estimates",
            description: "Estimate headers attached to project assets.",
            searchable_fields: &["scope_summary", "notes"],
            detail_fields: &[
                RecordFieldConfig { name: "asset_id", field_type: FieldType::Text },
                RecordFieldConfig { name: "scope_summary", field_type: FieldType::Text },
                RecordFieldConfig { name: "notes", field_type: FieldType::Text },
                RecordFieldConfig { name: "currency_code", field_type: FieldType::Text },
            ],
            supported_filters: &["projectId"],
            base_table: "estimates",
            join_clause: Some(
                "JOIN assets asset ON asset.id = base.asset_id JOIN projects project ON project.id = asset.project_id",
            ),
            workspace_id_col: "project.workspace_id",
            project_id_col: Some("asset.project_id"),
            id_col: "asset_id",
            title_col: "scope_summary",
            subtitle_col: None,
        },
        _ => return None,
    };
    Some(contract)
}

fn rate_scope_contract(
    scope: &'static str,
    label: &'static str,
    description: &'static str,
    base_table: &'static str,
) -> RecordScopeContract {
    RecordScopeContract {
        scope,
        label,
        description,
        searchable_fields: &["name", "code", "category", "unit", "reference", "aliases"],
        detail_fields: RATE_FIELDS,
        supported_filters: &["includeInactive"],
        base_table,
        join_clause: None,
        workspace_id_col: "base.workspace_id",
        project_id_col: None,
        id_col: "id",
        title_col: "name",
        subtitle_col: Some("code"),
    }
}

fn named_scope_contract(
    scope: &'static str,
    label: &'static str,
    description: &'static str,
    base_table: &'static str,
    join_clause: Option<&'static str>,
    workspace_id_col: &'static str,
    project_id_col: Option<&'static str>,
) -> RecordScopeContract {
    RecordScopeContract {
        scope,
        label,
        description,
        searchable_fields: &["name", "code", "description"],
        detail_fields: GENERIC_NAME_FIELDS,
        supported_filters: if project_id_col.is_some() {
            &["projectId"]
        } else {
            &[]
        },
        base_table,
        join_clause,
        workspace_id_col,
        project_id_col,
        id_col: "id",
        title_col: "name",
        subtitle_col: Some("code"),
    }
}

fn node_scope_contract(
    scope: &'static str,
    label: &'static str,
    description: &'static str,
    base_table: &'static str,
    join_clause: Option<&'static str>,
    workspace_id_col: &'static str,
    project_id_col: Option<&'static str>,
) -> RecordScopeContract {
    RecordScopeContract {
        scope,
        label,
        description,
        searchable_fields: &["name", "code", "type"],
        detail_fields: NODE_FIELDS,
        supported_filters: if project_id_col.is_some() {
            &["projectId"]
        } else {
            &[]
        },
        base_table,
        join_clause,
        workspace_id_col,
        project_id_col,
        id_col: "id",
        title_col: "name",
        subtitle_col: Some("code"),
    }
}

fn find_record_scope(scope: &str) -> Option<RecordScopeContract> {
    if !SEARCH_SCOPES
        .iter()
        .any(|config| config.scope_name == scope)
    {
        return None;
    }
    record_scope_contract(scope)
}

fn record_scope_descriptions() -> Vec<RecordScopeDescription> {
    SEARCH_SCOPES
        .iter()
        .filter_map(|config| find_record_scope(config.scope_name))
        .map(|contract| RecordScopeDescription {
            scope: contract.scope.to_string(),
            label: contract.label.to_string(),
            description: contract.description.to_string(),
            searchable_fields: contract
                .searchable_fields
                .iter()
                .map(|value| value.to_string())
                .collect(),
            detail_fields: contract
                .detail_fields
                .iter()
                .map(|field| RecordFieldDescription {
                    name: field.name.to_string(),
                    kind: match field.field_type {
                        FieldType::Text => "text",
                        FieldType::Real => "number",
                        FieldType::Integer => "integer",
                    }
                    .to_string(),
                })
                .collect(),
            supported_filters: contract
                .supported_filters
                .iter()
                .map(|value| value.to_string())
                .collect(),
        })
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkspaceRecordInput {
    pub scope: String,
    pub record_id: String,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecordDetail {
    pub scope: String,
    pub record_id: String,
    pub label: String,
    pub subtitle: Option<String>,
    pub fields: serde_json::Value,
}

fn field_value(row: &sqlx::sqlite::SqliteRow, field: RecordFieldConfig) -> serde_json::Value {
    match field.field_type {
        FieldType::Text => {
            serde_json::to_value(row.try_get::<Option<String>, _>(field.name).unwrap_or(None))
                .unwrap_or(serde_json::Value::Null)
        }
        FieldType::Real => {
            serde_json::to_value(row.try_get::<Option<f64>, _>(field.name).unwrap_or(None))
                .unwrap_or(serde_json::Value::Null)
        }
        FieldType::Integer => {
            serde_json::to_value(row.try_get::<Option<i64>, _>(field.name).unwrap_or(None))
                .unwrap_or(serde_json::Value::Null)
        }
    }
}

async fn linked_company_values_for_record(
    pool: &SqlitePool,
    scope: &str,
    record_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let rows = match scope {
        "materials" => {
            sqlx::query(
                "SELECT company.id, company.display_name \
             FROM company_material_links AS link \
             INNER JOIN contacts AS company ON company.id = link.company_id \
             WHERE link.material_id = ? \
             ORDER BY company.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(pool)
            .await
        }
        "labour_rates" => {
            sqlx::query(
                "SELECT company.id, company.display_name \
             FROM company_labour_rate_links AS link \
             INNER JOIN contacts AS company ON company.id = link.company_id \
             WHERE link.labour_rate_id = ? \
             ORDER BY company.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(pool)
            .await
        }
        "equipment_rates" => {
            sqlx::query(
                "SELECT company.id, company.display_name \
             FROM company_equipment_rate_links AS link \
             INNER JOIN contacts AS company ON company.id = link.company_id \
             WHERE link.equipment_rate_id = ? \
             ORDER BY company.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(pool)
            .await
        }
        "subcontract_rates" => {
            sqlx::query(
                "SELECT company.id, company.display_name \
             FROM company_subcontract_rate_links AS link \
             INNER JOIN contacts AS company ON company.id = link.company_id \
             WHERE link.subcontract_rate_id = ? \
             ORDER BY company.display_name COLLATE NOCASE",
            )
            .bind(record_id)
            .fetch_all(pool)
            .await
        }
        _ => return Ok(None),
    }
    .map_err(|error| format!("Failed to get linked companies: {error}"))?;

    let linked_companies = rows
        .into_iter()
        .map(|company| {
            serde_json::json!({
                "id": company.try_get::<Option<String>, _>("id").unwrap_or(None),
                "display_name": company.try_get::<Option<String>, _>("display_name").unwrap_or(None),
            })
        })
        .collect::<Vec<_>>();
    Ok(Some(serde_json::Value::Array(linked_companies)))
}

#[tauri::command]
pub fn describe_workspace_records_command(
    scope: Option<String>,
) -> Result<Vec<RecordScopeDescription>, String> {
    let descriptions = record_scope_descriptions();
    let Some(scope) = scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(descriptions);
    };
    let description = descriptions
        .into_iter()
        .find(|candidate| candidate.scope == scope)
        .ok_or_else(|| format!("Unknown business record scope: {scope}"))?;
    Ok(vec![description])
}

#[tauri::command]
pub async fn get_workspace_record_command(
    app: AppHandle,
    input: GetWorkspaceRecordInput,
) -> Result<Option<WorkspaceRecordDetail>, String> {
    let scope = input.scope.trim();
    let record_id = input.record_id.trim();
    if record_id.is_empty() {
        return Err("recordId is required.".to_string());
    }
    let contract = find_record_scope(scope)
        .ok_or_else(|| format!("Unknown business record scope: {scope}"))?;
    let workspace_id = input
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local-workspace");

    let field_select = contract
        .detail_fields
        .iter()
        .map(|field| format!(", base.{} AS {}", field.name, field.name))
        .collect::<String>();
    let project_filter = if input.project_id.is_some() {
        contract
            .project_id_col
            .map(|column| format!(" AND {column} = ?"))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT base.{} AS record_id, base.{} AS label, {} AS subtitle{} \
         FROM {} base {} \
         WHERE base.{} = ? AND {} = ?{} LIMIT 1",
        contract.id_col,
        contract.title_col,
        contract
            .subtitle_col
            .map(|column| format!("base.{column}"))
            .unwrap_or_else(|| "NULL".to_string()),
        field_select,
        contract.base_table,
        contract.join_clause.unwrap_or(""),
        contract.id_col,
        contract.workspace_id_col,
        project_filter,
    );

    let pool = transactional_sqlite_pool(&app).await?;
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(record_id)
        .bind(workspace_id);
    if let (Some(project_id), Some(_)) = (input.project_id.as_deref(), contract.project_id_col) {
        query = query.bind(project_id.trim());
    }
    let row = query
        .fetch_optional(&pool)
        .await
        .map_err(|error| format!("Failed to get {scope} record: {error}"))?;
    let Some(row) = row else {
        return Ok(None);
    };

    let mut fields = serde_json::Map::new();
    for field in contract.detail_fields {
        fields.insert(field.name.to_string(), field_value(&row, *field));
    }
    if let Some(linked_companies) =
        linked_company_values_for_record(&pool, scope, record_id).await?
    {
        fields.insert("linked_companies".to_string(), linked_companies);
    }
    if scope == "contacts" {
        let contact_kind = row.try_get::<Option<String>, _>("kind").unwrap_or(None);
        if contact_kind.as_deref() == Some("company") {
            let linked_people_rows = sqlx::query(
                "SELECT id, display_name, email, phone, role_title, custom_role_label, is_primary_company_contact, is_active \
                 FROM contacts \
                 WHERE workspace_id = ? AND kind = 'person' AND linked_company_id = ? \
                 ORDER BY is_primary_company_contact DESC, display_name ASC",
            )
            .bind(workspace_id)
            .bind(record_id)
            .fetch_all(&pool)
            .await
            .map_err(|error| format!("Failed to get linked contact people: {error}"))?;

            let linked_people = linked_people_rows
                .into_iter()
                .map(|person| {
                    serde_json::json!({
                        "id": person.try_get::<Option<String>, _>("id").unwrap_or(None),
                        "display_name": person.try_get::<Option<String>, _>("display_name").unwrap_or(None),
                        "email": person.try_get::<Option<String>, _>("email").unwrap_or(None),
                        "phone": person.try_get::<Option<String>, _>("phone").unwrap_or(None),
                        "role_title": person
                            .try_get::<Option<String>, _>("role_title")
                            .unwrap_or(None)
                            .or_else(|| person.try_get::<Option<String>, _>("custom_role_label").unwrap_or(None)),
                        "custom_role_label": person.try_get::<Option<String>, _>("custom_role_label").unwrap_or(None),
                        "is_primary_company_contact": person.try_get::<Option<i64>, _>("is_primary_company_contact").unwrap_or(None),
                        "is_active": person.try_get::<Option<i64>, _>("is_active").unwrap_or(None),
                    })
                })
                .collect::<Vec<_>>();
            fields.insert(
                "linked_people".to_string(),
                serde_json::Value::Array(linked_people),
            );
        }
    }
    Ok(Some(WorkspaceRecordDetail {
        scope: scope.to_string(),
        record_id: row.try_get("record_id").unwrap_or_default(),
        label: row
            .try_get::<Option<String>, _>("label")
            .unwrap_or(None)
            .unwrap_or_default(),
        subtitle: row.try_get("subtitle").unwrap_or(None),
        fields: serde_json::Value::Object(fields),
    }))
}

async fn execute_search_scope(
    conn: &mut sqlx::SqliteConnection,
    config: &SearchScopeConfig,
    match_term: &str,
    like_term: &str,
    workspace_id: &str,
    project_id: Option<&str>,
    include_inactive: bool,
    limit: i64,
) -> Result<Vec<SearchResultRow>, sqlx::Error> {
    let mut results = Vec::new();
    match &config.kind {
        SearchKind::FtsNoJoin {
            fts_table,
            base_table,
            join_clause,
            workspace_id_col,
            id_col,
            title_col,
            subtitle_col,
        } => {
            let project_col =
                find_record_scope(config.scope_name).and_then(|scope| scope.project_id_col);
            let project_filter = if project_id.is_some() && project_col.is_some() {
                format!("AND {} = ?", project_col.unwrap_or_default())
            } else {
                String::new()
            };
            let subtitle_select = subtitle_col
                .map(|column| format!("idx.{column}"))
                .unwrap_or_else(|| "NULL".to_string());
            let sql = format!(
                "SELECT idx.{} AS id, idx.{} AS title, {} AS subtitle, idx.rank \
                 FROM {} idx \
                 JOIN {} base ON base.rowid = idx.rowid \
                 {} \
                 WHERE {} MATCH ? \
                 AND {} = ? \
                 {} \
                 ORDER BY rank ASC LIMIT ?",
                id_col,
                title_col,
                subtitle_select,
                fts_table,
                base_table,
                join_clause.unwrap_or(""),
                fts_table,
                workspace_id_col,
                project_filter,
            );
            let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
                .bind(match_term)
                .bind(workspace_id);
            if project_id.is_some() && project_col.is_some() {
                query = query.bind(project_id.unwrap_or_default());
            }
            let rows = query.bind(limit).fetch_all(conn).await?;
            for row in rows {
                let id: String = row.try_get("id").unwrap_or_default();
                let title_opt: Option<String> = row.try_get("title").unwrap_or(None);
                let title = title_opt.unwrap_or_else(|| {
                    if config.scope_name == "projects" {
                        "Untitled Project".to_string()
                    } else if config.scope_name == "estimates" {
                        "Empty Estimate Scope".to_string()
                    } else {
                        "".to_string()
                    }
                });
                let subtitle: Option<String> = row.try_get("subtitle").unwrap_or(None);
                let rank: f64 = row.try_get("rank").unwrap_or(1000.0);
                results.push(SearchResultRow {
                    table_name: config.table_name.to_string(),
                    record_type: config.record_type.map(|s| s.to_string()),
                    scope: Some(config.scope_name.to_string()),
                    record_id: id,
                    title,
                    subtitle,
                    rank,
                    fields: serde_json::json!({}),
                });
            }
        }
        SearchKind::FtsWithJoin {
            fts_table,
            base_table,
            title_col,
            subtitle_col,
            extra_fields,
            has_is_active,
        } => {
            let mut extra_select = String::new();
            for &(name, _) in *extra_fields {
                extra_select.push_str(&format!(", base.{} AS {}", name, name));
            }
            let active_filter = if *has_is_active {
                "AND (? OR base.is_active = 1)"
            } else {
                ""
            };
            let sql = format!(
                "SELECT idx.id AS id, idx.{} AS title, idx.{} AS subtitle, idx.rank AS rank{} \
                 FROM {} idx \
                 JOIN {} base ON base.rowid = idx.rowid \
                 WHERE {} MATCH ? \
                 AND base.workspace_id = ? \
                 {} \
                 ORDER BY idx.rank ASC LIMIT ?",
                title_col,
                subtitle_col.unwrap_or("NULL"),
                extra_select,
                fts_table,
                base_table,
                fts_table,
                active_filter
            );
            let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
                .bind(match_term)
                .bind(workspace_id);
            if *has_is_active {
                query = query.bind(include_inactive);
            }
            let rows = query.bind(limit).fetch_all(conn).await?;
            for row in rows {
                let id: String = row.try_get("id").unwrap_or_default();
                let title_opt: Option<String> = row.try_get("title").unwrap_or(None);
                let title = title_opt.unwrap_or_default();
                let subtitle: Option<String> = row.try_get("subtitle").unwrap_or(None);
                let rank: f64 = row.try_get("rank").unwrap_or(1000.0);

                let mut fields_map = serde_json::Map::new();
                for &(name, field_type) in *extra_fields {
                    match field_type {
                        FieldType::Text => {
                            let val: Option<String> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                        FieldType::Real => {
                            let val: Option<f64> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                        FieldType::Integer => {
                            let val: Option<i64> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                    }
                }

                results.push(SearchResultRow {
                    table_name: config.table_name.to_string(),
                    record_type: config.record_type.map(|s| s.to_string()),
                    scope: Some(config.scope_name.to_string()),
                    record_id: id,
                    title,
                    subtitle,
                    rank,
                    fields: serde_json::Value::Object(fields_map),
                });
            }
        }
        SearchKind::LikeSearch {
            base_table,
            join_clause,
            workspace_id_col,
            like_cols,
            title_col,
            subtitle_col,
            extra_fields,
            has_is_active,
            order_col,
        } => {
            let mut extra_select = String::new();
            for &(name, _) in *extra_fields {
                extra_select.push_str(&format!(", base.{} AS {}", name, name));
            }
            let active_filter = if *has_is_active {
                "AND (? OR base.is_active = 1)"
            } else {
                ""
            };
            let join_str = join_clause.unwrap_or("");
            let project_col =
                find_record_scope(config.scope_name).and_then(|scope| scope.project_id_col);
            let project_filter = if project_id.is_some() && project_col.is_some() {
                format!("AND {} = ?", project_col.unwrap_or_default())
            } else {
                String::new()
            };
            let mut like_filter = String::new();
            for (i, col) in like_cols.iter().enumerate() {
                if i > 0 {
                    like_filter.push_str(" OR ");
                }
                like_filter.push_str(&format!("{} LIKE ? ESCAPE '\\'", col));
            }
            let sql = format!(
                "SELECT base.id AS id, {} AS title, {} AS subtitle, 1000.0 AS rank{} \
                 FROM {} base \
                 {} \
                 WHERE {} = ? \
                 {} \
                 {} \
                 AND ({}) \
                 ORDER BY {} LIMIT ?",
                title_col,
                subtitle_col.unwrap_or("NULL"),
                extra_select,
                base_table,
                join_str,
                workspace_id_col,
                active_filter,
                project_filter,
                like_filter,
                order_col
            );
            let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str())).bind(workspace_id);
            if *has_is_active {
                query = query.bind(include_inactive);
            }
            if project_id.is_some() && project_col.is_some() {
                query = query.bind(project_id.unwrap_or_default());
            }
            for _ in *like_cols {
                query = query.bind(like_term);
            }
            let rows = query.bind(limit).fetch_all(conn).await?;
            for row in rows {
                let id: String = row.try_get("id").unwrap_or_default();
                let title_opt: Option<String> = row.try_get("title").unwrap_or(None);
                let title = title_opt.unwrap_or_default();
                let subtitle: Option<String> = row.try_get("subtitle").unwrap_or(None);
                let rank: f64 = row.try_get("rank").unwrap_or(1000.0);

                let mut fields_map = serde_json::Map::new();
                for &(name, field_type) in *extra_fields {
                    match field_type {
                        FieldType::Text => {
                            let val: Option<String> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                        FieldType::Real => {
                            let val: Option<f64> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                        FieldType::Integer => {
                            let val: Option<i64> = row.try_get(name).unwrap_or(None);
                            fields_map.insert(
                                name.to_string(),
                                serde_json::to_value(&val).unwrap_or(serde_json::Value::Null),
                            );
                        }
                    }
                }

                results.push(SearchResultRow {
                    table_name: config.table_name.to_string(),
                    record_type: config.record_type.map(|s| s.to_string()),
                    scope: Some(config.scope_name.to_string()),
                    record_id: id,
                    title,
                    subtitle,
                    rank,
                    fields: serde_json::Value::Object(fields_map),
                });
            }
        }
    }
    Ok(results)
}

async fn execute_browse_scope(
    conn: &mut sqlx::SqliteConnection,
    config: &SearchScopeConfig,
    workspace_id: &str,
    include_inactive: bool,
    limit: i64,
) -> Result<Vec<SearchResultRow>, sqlx::Error> {
    let SearchKind::FtsWithJoin {
        base_table,
        title_col,
        subtitle_col,
        extra_fields,
        has_is_active,
        ..
    } = &config.kind
    else {
        return Ok(Vec::new());
    };
    let mut extra_select = String::new();
    for &(name, _) in *extra_fields {
        extra_select.push_str(&format!(", base.{} AS {}", name, name));
    }
    let active_filter = if *has_is_active {
        "AND (? OR base.is_active = 1)"
    } else {
        ""
    };
    let sql = format!(
        "SELECT base.id AS id, base.{} AS title, base.{} AS subtitle, 1000.0 AS rank{} \
         FROM {} base WHERE base.workspace_id = ? {} ORDER BY base.{} COLLATE NOCASE ASC LIMIT ?",
        title_col,
        subtitle_col.unwrap_or("id"),
        extra_select,
        base_table,
        active_filter,
        title_col
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.as_str())).bind(workspace_id);
    if *has_is_active {
        query = query.bind(include_inactive);
    }
    let rows = query.bind(limit).fetch_all(conn).await?;
    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        let mut fields_map = serde_json::Map::new();
        for &(name, field_type) in *extra_fields {
            let value = match field_type {
                FieldType::Text => {
                    serde_json::to_value(row.try_get::<Option<String>, _>(name).unwrap_or(None))
                }
                FieldType::Real => {
                    serde_json::to_value(row.try_get::<Option<f64>, _>(name).unwrap_or(None))
                }
                FieldType::Integer => {
                    serde_json::to_value(row.try_get::<Option<i64>, _>(name).unwrap_or(None))
                }
            }
            .unwrap_or(serde_json::Value::Null);
            fields_map.insert(name.to_string(), value);
        }
        results.push(SearchResultRow {
            table_name: config.table_name.to_string(),
            record_type: config.record_type.map(|value| value.to_string()),
            scope: Some(config.scope_name.to_string()),
            record_id: row.try_get("id").unwrap_or_default(),
            title: row
                .try_get::<Option<String>, _>("title")
                .unwrap_or(None)
                .unwrap_or_default(),
            subtitle: row.try_get("subtitle").unwrap_or(None),
            rank: 1000.0,
            fields: serde_json::Value::Object(fields_map),
        });
    }
    Ok(results)
}

#[tauri::command]
pub async fn search_workspace_history_command(
    app: AppHandle,
    input: WorkspaceSearchQueryInput,
) -> Result<Vec<SearchResultRow>, String> {
    let pool = transactional_sqlite_pool(&app).await?;
    let mut results = Vec::new();
    let limit = input.limit.unwrap_or(30) as i64;
    let scope = input
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let workspace_id = input
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("local-workspace");
    let include_inactive = input.include_inactive.unwrap_or(true);
    let browse = input.browse.unwrap_or(false);
    let project_id = input
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(scope) = scope {
        if find_record_scope(scope).is_none() {
            return Err(format!("Unknown business record scope: {scope}"));
        }
    }

    let safe_query = input.query.trim().to_string();
    if safe_query.is_empty() && !browse {
        return Ok(results);
    }

    // Match term for prefix search: "term*"
    let match_term = format!("{}*", safe_query.replace("\"", "").replace("'", ""));
    let like_term = format!("%{}%", safe_query.replace("%", "\\%").replace("_", "\\_"));

    // Acquire read connection
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire DB connection for search: {}", e))?;

    if browse {
        for config in SEARCH_SCOPES {
            if scope.is_none() || scope == Some(config.scope_name) {
                let mut scope_results =
                    execute_browse_scope(&mut *conn, config, workspace_id, include_inactive, limit)
                        .await
                        .map_err(|error| {
                            format!("Failed to browse scope {}: {}", config.scope_name, error)
                        })?;
                results.append(&mut scope_results);
            }
        }
        results.truncate(limit as usize);
        return Ok(results);
    }

    for config in SEARCH_SCOPES {
        if scope.is_none() || scope == Some(config.scope_name) {
            match execute_search_scope(
                &mut *conn,
                config,
                &match_term,
                &like_term,
                workspace_id,
                project_id,
                include_inactive,
                limit,
            )
            .await
            {
                Ok(mut scope_results) => {
                    results.append(&mut scope_results);
                }
                Err(e) => {
                    println!("Error searching scope {}: {}", config.scope_name, e);
                }
            }
        }
    }

    // Sort all gathered results by BM25 rank ascending (best match first)
    results.sort_by(|a, b| {
        a.rank
            .partial_cmp(&b.rank)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Limit to requested result count
    results.truncate(limit as usize);

    Ok(results)
}

#[cfg(test)]
mod structured_record_tests {
    use super::*;

    async fn relationship_test_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open relationship test database");
        sqlx::raw_sql(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE contacts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, display_name TEXT NOT NULL);
             CREATE TABLE material_catalog_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE labour_rate_cards (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE equipment_rate_cards (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE subcontract_rate_cards (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE cost_components (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT, updated_at TEXT);
             CREATE TABLE company_material_links (company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, material_id TEXT NOT NULL REFERENCES material_catalog_items(id) ON DELETE CASCADE, PRIMARY KEY (company_id, material_id));
             CREATE TABLE company_labour_rate_links (company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, labour_rate_id TEXT NOT NULL REFERENCES labour_rate_cards(id) ON DELETE CASCADE, PRIMARY KEY (company_id, labour_rate_id));
             CREATE TABLE company_equipment_rate_links (company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, equipment_rate_id TEXT NOT NULL REFERENCES equipment_rate_cards(id) ON DELETE CASCADE, PRIMARY KEY (company_id, equipment_rate_id));
             CREATE TABLE company_subcontract_rate_links (company_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, subcontract_rate_id TEXT NOT NULL REFERENCES subcontract_rate_cards(id) ON DELETE CASCADE, PRIMARY KEY (company_id, subcontract_rate_id));",
        )
        .execute(&pool)
        .await
        .expect("create relationship tables");
        for (id, kind) in [
            ("company-a", "company"),
            ("company-b", "company"),
            ("person-a", "person"),
        ] {
            sqlx::query("INSERT INTO contacts (id, workspace_id, kind, display_name) VALUES (?, 'workspace-a', ?, ?)")
                .bind(id)
                .bind(kind)
                .bind(id)
                .execute(&pool)
                .await
                .expect("insert contact");
        }
        for (table, id) in [
            ("material_catalog_items", "material-a"),
            ("labour_rate_cards", "labour-a"),
            ("equipment_rate_cards", "equipment-a"),
            ("subcontract_rate_cards", "subcontract-a"),
        ] {
            let sql = format!(
                "INSERT INTO {table} (id, workspace_id, name) VALUES (?, 'workspace-a', ?)"
            );
            sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
                .bind(id)
                .bind(id)
                .execute(&pool)
                .await
                .expect("insert catalogue record");
        }
        pool
    }

    async fn setup_import_test_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open setup import test database");
        sqlx::raw_sql(include_str!("../../migrations-workspace/001_workspace.sql"))
            .execute(&pool)
            .await
            .expect("apply workspace baseline");
        sqlx::raw_sql(
            "INSERT INTO workspace_identity (id) VALUES ('workspace-a');
             INSERT INTO workspace_profile (workspace_id, currency_code) VALUES ('workspace-a', 'AUD');",
        )
        .execute(&pool)
        .await
        .expect("seed workspace identity");
        pool
    }

    fn setup_import_input() -> SetupImportSessionInput {
        SetupImportSessionInput {
            audit: SetupImportAuditInput {
                id: "audit-a".into(),
                source_file_name: "setup.xlsx".into(),
                source_content_hash: "abc123".into(),
                imported_sheet_ids: vec!["materials".into()],
                duplicate_modes_json: "{\"materials\":\"keep_existing\"}".into(),
                created_count: 1,
                updated_count: 0,
                skipped_count: 0,
                failure_summary: None,
            },
            contacts: vec![],
            materials: vec![],
            labour_rates: vec![],
            equipment_rates: vec![],
            subcontract_rates: vec![],
            cost_presets: vec![],
            estimate_templates: vec![],
            project_structure_templates: vec![],
            classification_systems: vec![],
            cost_codes: vec![],
            company_catalogue_links: vec![],
        }
    }

    #[tokio::test]
    async fn setup_import_persists_audit_inside_the_successful_transaction() {
        let pool = setup_import_test_pool().await;
        let input = setup_import_input();

        apply_setup_import_session_tx(&pool, input)
            .await
            .expect("apply setup import transaction");

        let row = sqlx::query(
			"SELECT source_file_name, source_content_hash, imported_sheet_ids_json, created_count FROM setup_import_audit WHERE id = 'audit-a'",
		)
		.fetch_one(&pool)
		.await
		.expect("load setup import audit");
        assert_eq!(row.get::<String, _>("source_file_name"), "setup.xlsx");
        assert_eq!(row.get::<String, _>("source_content_hash"), "abc123");
        assert_eq!(
            row.get::<String, _>("imported_sheet_ids_json"),
            "[\"materials\"]"
        );
        assert_eq!(row.get::<i64, _>("created_count"), 1);
    }

    #[tokio::test]
    async fn setup_import_persists_classification_currency_and_patch_updates() {
        let pool = setup_import_test_pool().await;
        let mut input = setup_import_input();
        input.materials = vec![
            SetupImportEntityOperationInput {
                id: "material-a".into(),
                action: "create".into(),
                mapped_fields: vec![
                    "name".into(),
                    "unit".into(),
                    "default_rate".into(),
                    "currency_code".into(),
                    "category".into(),
                ],
                data: serde_json::json!({"name":"Steel Plate","unit":"kg","default_rate":4.85,"currency_code":"NZD","category":"Steel","is_active":true}),
            },
            SetupImportEntityOperationInput {
                id: "material-a".into(),
                action: "update".into(),
                mapped_fields: vec!["default_rate".into()],
                data: serde_json::json!({"name":"Wrong Name","unit":"ea","default_rate":5.55,"currency_code":"AUD","category":"Wrong","is_active":false}),
            },
        ];
        input.classification_systems = vec![
            SetupImportClassificationSystemOperationInput {
                id: "classification-a".into(),
                action: "create".into(),
                mapped_fields: vec!["name".into(), "classification_type".into()],
                _client_key: "classification-a".into(),
                data: serde_json::json!({"name":"Custom Codes","code":"CC","classification_type":"custom","aliases":[],"is_default":false}),
            },
            SetupImportClassificationSystemOperationInput {
                id: "classification-a".into(),
                action: "update".into(),
                mapped_fields: vec!["classification_type".into()],
                _client_key: "classification-a".into(),
                data: serde_json::json!({"name":"Wrong Name","code":"BAD","classification_type":"uniformat","aliases":[],"is_default":true}),
            },
        ];

        apply_setup_import_session_tx(&pool, input)
            .await
            .expect("apply setup import transaction");

        let material = sqlx::query("SELECT name, category, default_rate, currency_code, is_active FROM material_catalog_items WHERE id = 'material-a'")
            .fetch_one(&pool)
            .await
            .expect("load material");
        assert_eq!(material.get::<String, _>("name"), "Steel Plate");
        assert_eq!(material.get::<String, _>("category"), "Steel");
        assert_eq!(material.get::<f64, _>("default_rate"), 5.55);
        assert_eq!(material.get::<String, _>("currency_code"), "NZD");
        assert_eq!(material.get::<i64, _>("is_active"), 1);

        let classification = sqlx::query("SELECT name, classification_type FROM classification_systems WHERE id = 'classification-a'")
            .fetch_one(&pool)
            .await
            .expect("load classification");
        assert_eq!(classification.get::<String, _>("name"), "Custom Codes");
        assert_eq!(
            classification.get::<String, _>("classification_type"),
            "uniformat"
        );
    }

    #[tokio::test]
    async fn setup_import_rolls_back_prior_creates_when_a_later_update_is_invalid() {
        let pool = setup_import_test_pool().await;
        let mut input = setup_import_input();
        input.materials = vec![
            SetupImportEntityOperationInput {
                id: "material-created-before-error".into(),
                action: "create".into(),
                mapped_fields: vec!["name".into(), "unit".into()],
                data: serde_json::json!({"name":"Temporary Plate","unit":"kg","default_rate":0,"is_active":true}),
            },
            SetupImportEntityOperationInput {
                id: "missing-material".into(),
                action: "update".into(),
                mapped_fields: vec!["default_rate".into()],
                data: serde_json::json!({"name":"Missing","unit":"kg","default_rate":12,"is_active":true}),
            },
        ];

        let error = apply_setup_import_session_tx(&pool, input)
            .await
            .expect_err("invalid update must fail the complete import");
        assert!(error.contains("active workspace"));

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM material_catalog_items WHERE id = 'material-created-before-error'",
        )
        .fetch_one(&pool)
        .await
        .expect("count rolled back material");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn setup_import_persists_rate_details_and_project_structure_templates() {
        let pool = setup_import_test_pool().await;
        let fields = vec![
            "name".into(),
            "unit".into(),
            "default_rate".into(),
            "currency_code".into(),
            "effective_date".into(),
            "verified_date".into(),
            "rate_basis".into(),
            "lead_time".into(),
            "availability".into(),
            "reference".into(),
        ];
        let rate_data = serde_json::json!({
            "name":"Imported rate",
            "unit":"hr",
            "default_rate":125.5,
            "currency_code":"NZD",
            "effective_date":"2026-01-01",
            "verified_date":"2026-02-01",
            "rate_basis":"sell",
            "lead_time":"2 weeks",
            "availability":"available",
            "reference":"QUOTE-12",
            "is_active":true
        });
        let mut input = setup_import_input();
        input.labour_rates = vec![SetupImportEntityOperationInput {
            id: "labour-import".into(),
            action: "create".into(),
            mapped_fields: fields.clone(),
            data: rate_data.clone(),
        }];
        input.equipment_rates = vec![SetupImportEntityOperationInput {
            id: "equipment-import".into(),
            action: "create".into(),
            mapped_fields: fields.clone(),
            data: rate_data.clone(),
        }];
        input.subcontract_rates = vec![SetupImportEntityOperationInput {
            id: "subcontract-import".into(),
            action: "create".into(),
            mapped_fields: fields,
            data: rate_data,
        }];
        input.project_structure_templates = vec![SetupImportEntityOperationInput {
            id: "project-template-import".into(),
            action: "create".into(),
            mapped_fields: vec!["code".into(), "name".into(), "description".into()],
            data: serde_json::json!({
                "code":"WBS-FAB",
                "name":"Fabrication",
                "description":"Standard fabrication structure",
                "is_active":true
            }),
        }];

        apply_setup_import_session_tx(&pool, input)
            .await
            .expect("apply rate and project template import");

        for (table, id) in [
            ("labour_rate_cards", "labour-import"),
            ("equipment_rate_cards", "equipment-import"),
            ("subcontract_rate_cards", "subcontract-import"),
        ] {
            let sql = format!(
                "SELECT default_rate, currency_code, effective_date, verified_date, rate_basis, lead_time, availability, reference FROM {table} WHERE id = ?"
            );
            let row = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("load imported rate");
            assert_eq!(row.get::<f64, _>("default_rate"), 125.5);
            assert_eq!(row.get::<String, _>("currency_code"), "NZD");
            assert_eq!(row.get::<String, _>("effective_date"), "2026-01-01");
            assert_eq!(row.get::<String, _>("verified_date"), "2026-02-01");
            assert_eq!(row.get::<String, _>("rate_basis"), "sell");
            assert_eq!(row.get::<String, _>("lead_time"), "2 weeks");
            assert_eq!(row.get::<String, _>("availability"), "available");
            assert_eq!(row.get::<String, _>("reference"), "QUOTE-12");
        }

        let template_name: String = sqlx::query_scalar(
            "SELECT name FROM project_structure_templates WHERE id = 'project-template-import'",
        )
        .fetch_one(&pool)
        .await
        .expect("load imported project structure template");
        assert_eq!(template_name, "Fabrication");
    }

    #[tokio::test]
    async fn catalogue_relationships_support_multiple_companies_and_all_four_scopes() {
        let pool = relationship_test_pool().await;
        let mut tx = pool.begin().await.expect("begin");
        replace_link_table_rows_tx(
            &mut tx,
            "workspace-a",
            CatalogueCompanyLinkScope::Materials,
            "material-a",
            &["company-a".into(), "company-b".into()],
        )
        .await
        .expect("link material companies");
        for (scope, record_id) in [
            (CatalogueCompanyLinkScope::LabourRates, "labour-a"),
            (CatalogueCompanyLinkScope::EquipmentRates, "equipment-a"),
            (CatalogueCompanyLinkScope::SubcontractRates, "subcontract-a"),
        ] {
            insert_company_catalogue_link_tx(&mut tx, "workspace-a", scope, record_id, "company-a")
                .await
                .expect("link company catalogue record");
        }
        tx.commit().await.expect("commit");

        let material_links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM company_material_links")
            .fetch_one(&pool)
            .await
            .expect("count material links");
        assert_eq!(material_links, 2);
        for table in [
            "company_labour_rate_links",
            "company_equipment_rate_links",
            "company_subcontract_rate_links",
        ] {
            let sql = format!("SELECT COUNT(*) FROM {table} WHERE company_id = 'company-a'");
            let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(sql.as_str()))
                .fetch_one(&pool)
                .await
                .expect("count company links");
            assert_eq!(count, 1, "missing link in {table}");
        }
    }

    #[tokio::test]
    async fn invalid_company_replacement_preserves_existing_links_and_cascades_on_delete() {
        let pool = relationship_test_pool().await;
        sqlx::query("INSERT INTO company_material_links (company_id, material_id) VALUES ('company-a', 'material-a')")
            .execute(&pool)
            .await
            .expect("seed link");
        let mut tx = pool.begin().await.expect("begin");
        let error = replace_link_table_rows_tx(
            &mut tx,
            "workspace-a",
            CatalogueCompanyLinkScope::Materials,
            "material-a",
            &["person-a".into()],
        )
        .await
        .expect_err("person must be rejected");
        assert!(error.contains("not found in this workspace"));
        tx.rollback().await.expect("rollback");
        let preserved: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM company_material_links WHERE company_id = 'company-a'",
        )
        .fetch_one(&pool)
        .await
        .expect("count preserved links");
        assert_eq!(preserved, 1);

        sqlx::query("DELETE FROM contacts WHERE id = 'company-a'")
            .execute(&pool)
            .await
            .expect("delete company");
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM company_material_links")
            .fetch_one(&pool)
            .await
            .expect("count cascade links");
        assert_eq!(remaining, 0);
        let material_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM material_catalog_items WHERE id = 'material-a'",
        )
        .fetch_one(&pool)
        .await
        .expect("count material");
        assert_eq!(material_count, 1);
    }

    #[tokio::test]
    async fn catalogue_delete_clears_cost_sources_deletes_rows_and_cascades_links() {
        let pool = relationship_test_pool().await;
        for (source_type, source_id) in [
            ("material_catalog", "material-a"),
            ("labour_rate_card", "labour-a"),
            ("equipment_rate_card", "equipment-a"),
            ("subcontract_rate_card", "subcontract-a"),
        ] {
            sqlx::query("INSERT INTO cost_components (id, source_type, source_id, updated_at) VALUES (?, ?, ?, 'old')")
                .bind(format!("component-{source_id}"))
                .bind(source_type)
                .bind(source_id)
                .execute(&pool)
                .await
                .expect("insert component");
        }
        sqlx::query("INSERT INTO company_material_links (company_id, material_id) VALUES ('company-a', 'material-a')")
            .execute(&pool)
            .await
            .expect("insert material link");

        let mut tx = pool.begin().await.expect("begin");
        delete_catalogue_item_tx(
            &mut tx,
            CatalogueCompanyLinkScope::Materials,
            "workspace-a",
            "material-a",
            "now",
        )
        .await
        .expect("delete material");
        for (scope, id) in [
            (CatalogueCompanyLinkScope::LabourRates, "labour-a"),
            (CatalogueCompanyLinkScope::EquipmentRates, "equipment-a"),
            (CatalogueCompanyLinkScope::SubcontractRates, "subcontract-a"),
        ] {
            delete_catalogue_item_tx(&mut tx, scope, "workspace-a", id, "now")
                .await
                .expect("delete rate record");
        }
        tx.commit().await.expect("commit");

        for table in [
            "material_catalog_items",
            "labour_rate_cards",
            "equipment_rate_cards",
            "subcontract_rate_cards",
            "company_material_links",
        ] {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(sql.as_str()))
                .fetch_one(&pool)
                .await
                .expect("count deleted rows");
            assert_eq!(count, 0, "expected {table} to be empty");
        }

        let manual_components: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM cost_components WHERE source_type = 'manual' AND source_id IS NULL AND updated_at = 'now'",
        )
        .fetch_one(&pool)
        .await
        .expect("count cleared components");
        assert_eq!(manual_components, 4);
    }

    #[tokio::test]
    async fn catalogue_delete_rolls_back_cost_source_cleanup_with_transaction() {
        let pool = relationship_test_pool().await;
        sqlx::query("INSERT INTO cost_components (id, source_type, source_id, updated_at) VALUES ('component-a', 'material_catalog', 'material-a', 'old')")
            .execute(&pool)
            .await
            .expect("insert component");
        let mut tx = pool.begin().await.expect("begin");
        delete_catalogue_item_tx(
            &mut tx,
            CatalogueCompanyLinkScope::Materials,
            "workspace-a",
            "material-a",
            "now",
        )
        .await
        .expect("delete material");
        tx.rollback().await.expect("rollback");

        let material_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM material_catalog_items WHERE id = 'material-a'",
        )
        .fetch_one(&pool)
        .await
        .expect("count material");
        assert_eq!(material_count, 1);
        let component = sqlx::query("SELECT source_type, source_id, updated_at FROM cost_components WHERE id = 'component-a'")
            .fetch_one(&pool)
            .await
            .expect("load component");
        assert_eq!(
            component.get::<String, _>("source_type"),
            "material_catalog"
        );
        assert_eq!(component.get::<String, _>("source_id"), "material-a");
        assert_eq!(component.get::<String, _>("updated_at"), "old");
    }

    #[test]
    fn business_record_scopes_include_projects_and_estimates() {
        let scopes = record_scope_descriptions();
        assert!(scopes.iter().any(|scope| scope.scope == "projects"));
        assert!(scopes.iter().any(|scope| scope.scope == "estimates"));
    }

    #[test]
    fn business_record_scopes_exclude_internal_tables() {
        let scopes = record_scope_descriptions();
        for forbidden in [
            "auth_audit_events",
            "assistant_action_audit",
            "runtime_contract_state",
            "_migrations",
            "ai_runs",
        ] {
            assert!(!scopes.iter().any(|scope| scope.scope == forbidden));
        }
    }

    #[test]
    fn rate_scopes_return_rate_currency_basis_and_unit() {
        for scope_name in [
            "materials",
            "labour_rates",
            "equipment_rates",
            "subcontract_rates",
        ] {
            let scope = find_record_scope(scope_name).expect("rate scope");
            for field in ["default_rate", "currency_code", "rate_basis", "unit"] {
                assert!(
                    scope
                        .detail_fields
                        .iter()
                        .any(|candidate| candidate.name == field),
                    "{scope_name} is missing {field}"
                );
            }
        }
    }

    #[test]
    fn contact_scope_exposes_custom_role_label_for_linked_people_reasoning() {
        let scope = find_record_scope("contacts").expect("contacts scope");
        assert!(
            scope
                .detail_fields
                .iter()
                .any(|candidate| candidate.name == "custom_role_label"),
            "contacts detail records must expose custom_role_label so assistant role questions can use the same role source as contact writes"
        );
    }

    #[test]
    fn assistant_mutations_use_one_typed_record_proposal_set_command() {
        let proposal_source = include_str!("assistant_proposals.rs");
        let legacy_source = include_str!("commands.rs");
        assert!(proposal_source.contains("execute_approved_record_proposal_set_command"));
        assert!(
            !proposal_source.contains(&["execute_approved_record", "_proposal_command",].concat())
        );
        assert!(!legacy_source.contains(&["execute_approved", "proposal_bundle_command"].concat()));
        assert!(!legacy_source
            .contains(&["Assistant proposal bundle", " exceeds the 25 action limit",].concat()));
    }

    #[test]
    fn assistant_mutations_do_not_keep_dormant_bundle_adapters() {
        let source = include_str!("assistant_proposals.rs");
        for forbidden in [
            ["\"projects\"", " =>"].concat(),
            ["\"estimates\"", " =>"].concat(),
            ["\"estimate_templates\"", " =>"].concat(),
            ["\"quote_option_presets\"", " =>"].concat(),
            ["\"project_structure_templates\"", " =>"].concat(),
            ["\"cost_component_presets\"", " =>"].concat(),
            ["resolve_project", "_id"].concat(),
            ["resolved_action", "_ids"].concat(),
        ] {
            assert!(
                !source.contains(&forbidden),
                "dormant mutation path remains: {forbidden}"
            );
        }
    }
}
