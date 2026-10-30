pub(crate) mod ai;
pub mod destination;
mod diagnostics;
pub(crate) mod models;
pub(crate) mod map_edits;
mod mongo;
mod postgres;
pub(crate) mod source;
mod sql_server;

use crate::storage::AppStorage;
use models::{Run, RunView};
use rusqlite::{params, OptionalExtension};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct IngestionState {
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

pub struct Operation {
    token: CancellationToken,
    workspace: String,
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.workspace);
        }
    }
}
impl IngestionState {
    pub fn acquire(&self, workspace: &str) -> Result<Operation, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Database operations are unavailable. Restart the app.")?;
        if active.contains_key("__ai-settings__")
            || (workspace == "__ai-settings__" && !active.is_empty())
        {
            return Err("Wait for the current operation to finish before changing AI settings or starting ingestion.".into());
        }
        if active.contains_key(workspace) {
            return Err("An operation is already running for this workspace. Please wait.".into());
        }
        let token = CancellationToken::new();
        active.insert(workspace.into(), token.clone());
        Ok(Operation {
            token,
            workspace: workspace.into(),
            active: self.active.clone(),
        })
    }
    pub fn is_active(&self) -> bool {
        self.active
            .lock()
            .map(|active| !active.is_empty())
            .unwrap_or(true)
    }
}

pub(crate) fn load_run(id: &str, storage: &AppStorage) -> Result<Run, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?;
    let (json, status): (String, String) = connection
        .query_row(
            "SELECT document, status FROM ingestion_runs WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Could not read ingestion progress.")?
        .ok_or("This ingestion run no longer exists.")?;
    let mut run: Run = serde_json::from_str(&json)
        .map_err(|_| "Saved ingestion progress is invalid. Scan again.")?;
    run.status = status;
    // Older builds called a scan with no discovered objects successful.
    if run.status == "ready" && run.entities.is_empty() {
        run.status = "failed".into();
        run.scan_complete = false;
        run.error = Some(format!(
            "No user tables were found in database ‘{}’. Check the database name in your connection and your table permissions, then scan again.",
            run.database
        ));
    }
    if run.status == "interrupted" {
        run.error =
            Some("The app closed before this run finished. Completed items were preserved.".into());
    }
    Ok(run)
}

#[tauri::command]
pub fn get_ingestion(
    workspace_id: String,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<Option<RunView>, String> {
    let id: Option<String> = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?
        .query_row("SELECT id FROM ingestion_runs WHERE workspace_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1", params![workspace_id], |row| row.get(0))
        .optional().map_err(|_| "Could not read ingestion progress.")?;
    id.map(|id| {
        let mut run = load_run(&id, &storage)?;
        let active = jobs.active.lock().map_err(|_| "Database operations are unavailable.")?.contains_key(&workspace_id);
        if !active && matches!(run.status.as_str(), "scanning" | "ingesting" | "saving") {
            run.status = "interrupted".into();
            run.error = Some("This operation stopped before its final checkpoint was saved. Check free disk space and retry.".into());
        }
        Ok(run.view())
    }).transpose()
}

#[tauri::command]
pub fn scan_workspace(
    workspace_id: String,
    app: AppHandle,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<RunView, String> {
    let operation = jobs.acquire(&workspace_id)?;
    let (provider, uri, database): (String, String, String) = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?
        .query_row(
            "SELECT provider, connection_string, database_name FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Could not read the saved connection.")?
        .ok_or("This workspace no longer exists.")?;
    let mut run = Run {
        detail: Some("Connecting and discovering tables and collections".into()),
        started_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id,
        database,
        provider,
        status: "scanning".into(),
        scan_complete: false,
        entities: vec![],
        current: None,
        error: None,
        destination_id: None,
        location: None,
    };
    run.save(&storage)?;
    let view = run.view();
    tauri::async_runtime::spawn(async move {
        let _operation = operation;
        let storage = app.state::<AppStorage>();
        let token = _operation.token.clone();
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => Err("Scanning stopped. Scan again when you are ready.".into()),
            result = scan(&mut run, &uri, &storage) => result,
        };
        if let Err(error) = result {
            run.status = if token.is_cancelled() {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            run.error = Some(error);
            run.current = None;
        }
        let _ = run.save(&storage);
    });
    Ok(view)
}

async fn scan(run: &mut Run, uri: &str, storage: &AppStorage) -> Result<(), String> {
    let mut source = source::Source::open(&run.provider, uri).await?;
    run.entities = tokio::time::timeout(Duration::from_secs(30), source.list())
        .await
        .map_err(|_| "Listing database objects timed out.")??;
    if run.entities.is_empty() {
        return Err(format!(
            "No tables or collections were found in database ‘{}’. Check that your connection points to the database containing your data. SQL views and system tables are not included in this scan.",
            run.database
        ));
    }
    run.save(storage)?;
    if run.provider != "mongodb" {
        run.detail = Some("Reading columns and relationships for all tables together".into());
        run.save(storage)?;
        tokio::time::timeout(Duration::from_secs(30), source.metadata(&mut run.entities))
            .await
            .map_err(|_| "Bulk table metadata timed out. Please retry the scan.")??;
        run.save(storage)?;

        // Bound query size for large catalogs. Only failed batches are subdivided;
        // successful tables never need individual database round trips.
        let mut batches: std::collections::VecDeque<_> = (0..run.entities.len())
            .step_by(128)
            .map(|start| (start, (start + 128).min(run.entities.len())))
            .collect();
        while let Some((start, end)) = batches.pop_front() {
            run.detail = Some(format!(
                "Checking tables {}–{} of {} together",
                start + 1,
                end,
                run.entities.len()
            ));
            run.save(storage)?;
            let result = tokio::time::timeout(Duration::from_secs(25), async {
                match &mut source {
                    source::Source::Postgres(db) => {
                        postgres::presence(&db.client, &run.entities[start..end]).await
                    }
                    source::Source::SqlServer(db) => {
                        sql_server::presence(db, &run.entities[start..end]).await
                    }
                    _ => unreachable!(),
                }
            })
            .await;
            if let Ok(Ok(presence)) = result {
                for (entity, present) in run.entities[start..end].iter_mut().zip(presence) {
                    entity.is_empty = !present;
                    entity.presence_checked = true;
                    entity.status = if present { "data" } else { "empty" }.into();
                }
            } else {
                if end - start > 1 {
                    let middle = start + (end - start) / 2;
                    batches.push_front((middle, end));
                    batches.push_front((start, middle));
                } else {
                    run.entities[start].status = "error".into();
                    run.entities[start].error = Some("Could not check this table. Check SELECT permissions, locks and availability. It was not classified as empty.".into());
                }
                // A cancelled driver query may leave its connection unusable.
                source = source::Source::open(&run.provider, uri).await?;
            }
            run.save(storage)?;
        }
    }
    if let source::Source::Mongo(database) = &source {
        for start in (0..run.entities.len()).step_by(4) {
            let end = (start + 4).min(run.entities.len());
            run.current = None;
            run.detail = Some(format!(
                "Checking collections {}–{} of {} together",
                start + 1,
                end,
                run.entities.len()
            ));
            run.save(storage)?;
            let mut tasks = tokio::task::JoinSet::new();
            for index in start..end {
                let database = database.clone();
                let mut entity = run.entities[index].clone();
                tasks.spawn(async move {
                    let result = tokio::time::timeout(
                        Duration::from_secs(25),
                        mongo::inspect(&database, &mut entity),
                    )
                    .await
                    .map_err(|_| "Collection scan timed out.".to_string())
                    .and_then(|result| result);
                    (index, entity, result)
                });
            }
            while let Some(result) = tasks.join_next().await {
                let (index, mut entity, result) =
                    result.map_err(|_| "Collection scan stopped unexpectedly.")?;
                if let Err(error) = result {
                    entity.status = "error".into();
                    entity.error = Some(error);
                }
                run.current = Some(entity.name.clone());
                run.entities[index] = entity;
                run.save(storage)?;
            }
        }
    }
    run.current = None;
    run.scan_complete = true;
    run.status = "ready".into();
    run.detail = Some("Review empty items and choose what to include".into());
    Ok(())
}

#[tauri::command]
pub async fn start_ingestion(
    run_id: String,
    destination_id: String,
    window: WebviewWindow,
    app: AppHandle,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<Option<RunView>, String> {
    let mut run = load_run(&run_id, &storage)?;
    let operation = jobs.acquire(&run.workspace_id)?;
    if !run.scan_complete {
        return Err(
            "Complete the table scan before ingestion. If it was interrupted, scan again.".into(),
        );
    }
    if run.view().eligible == 0 {
        return Err("Select at least one readable table or collection to ingest.".into());
    }
    crate::credentials::read_ai_key().await?;
    let destination = destination::load(&destination_id, &storage)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().message(format!(
        "Process {} selected tables or collections?\n\nSchema metadata will be analyzed by AI. Row values and connection credentials will not be sent. {} unselected tables or collections will be skipped. Progress is saved locally. Do not close or quit Sapienta until ingestion and saving finish.",
        run.view().eligible, run.view().skipped,
    )).title("Start schema ingestion?").kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Start ingestion".into(), "Cancel".into())).parent(&window)
        .show(move |confirmed| { let _ = sender.send(confirmed); });
    if !receiver
        .await
        .map_err(|_| "Could not show the confirmation dialog.")?
    {
        return Ok(None);
    }
    let diagnostics = diagnostics::Diagnostics::open(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        &run.id,
        crate::credentials::read_ai_key().await?,
    )?;
    diagnostics.record(
        "attempt_started",
        serde_json::json!({"selected": run.view().eligible}),
    )?;
    run.destination_id = Some(destination_id);
    run.error = None;
    run.location = None;
    run.status = "ingesting".into();
    run.started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    run.detail = Some("Preparing AI analysis".into());
    for entity in &mut run.entities {
        if (entity.status == "done"
            && entity
                .analysis
                .as_ref()
                .and_then(|value| value.get("semanticVersion"))
                .and_then(serde_json::Value::as_u64)
                != Some(2))
            || matches!(entity.status.as_str(), "failed" | "processing")
            || (entity.status == "empty" && entity.include_empty)
        {
            entity.status = "data".into();
            entity.error = None;
        }
    }
    run.save(&storage)?;
    let view = run.view();
    tauri::async_runtime::spawn(async move {
        let _operation = operation;
        let storage = app.state::<AppStorage>();
        if let Err(error) = ingest(
            &mut run,
            &destination,
            &storage,
            &_operation.token,
            &diagnostics,
        )
        .await
        {
            run.status = if _operation.token.is_cancelled() {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            run.error = Some(error);
            run.current = None;
        }
        if let Err(error) = diagnostics.record(
            "attempt_finished",
            serde_json::json!({"status": run.status, "error": run.error}),
        ) {
            run.error = Some(error);
        }
        let _ = run.save(&storage);
    });
    Ok(Some(view))
}

async fn ingest(
    run: &mut Run,
    destination: &destination::Destination,
    storage: &AppStorage,
    token: &CancellationToken,
    diagnostics: &diagnostics::Diagnostics,
) -> Result<(), String> {
    if run
        .entities
        .iter()
        .any(|entity| entity.status == "data" && !entity.excluded)
    {
        let ai = tokio::select! {
            biased;
            _ = token.cancelled() => return Err("Ingestion stopped. Completed tables are saved; you can continue later.".into()),
            result = ai::Ai::new() => result?,
        }.with_diagnostics(diagnostics.clone());
        for index in 0..run.entities.len() {
            if run.entities[index].excluded || run.entities[index].status != "data" {
                continue;
            }
            run.entities[index].status = "processing".into();
            run.current = Some(format!(
                "{}{}{}",
                run.entities[index].schema,
                if run.entities[index].schema.is_empty() {
                    ""
                } else {
                    "."
                },
                run.entities[index].name
            ));
            run.save(storage)?;
            let entity = run.entities[index].clone();
            run.detail = Some(format!(
                "Understanding {} fields and their relationships · one table at a time",
                entity.fields.len()
            ));
            run.save(storage)?;
            diagnostics.record("table_started", serde_json::json!({"schema": entity.schema, "table": entity.name, "fieldCount": entity.fields.len()}))?;
            let result = tokio::select! {
                biased;
                _ = token.cancelled() => return Err("Ingestion stopped. Completed tables are saved; you can continue later.".into()),
                result = ai.analyze(&entity, &run.database, &run.provider, &run.entities) => result,
            };
            diagnostics.record("table_finished", serde_json::json!({"schema": entity.schema, "table": entity.name, "success": result.is_ok(), "error": result.as_ref().err()}))?;
            match result {
                Ok(analysis) => {
                    run.entities[index].analysis = Some(analysis);
                    run.entities[index].status = "done".into();
                }
                Err(error) => {
                    run.entities[index].error = Some(error);
                    run.entities[index].status = "failed".into();
                }
            }
            run.save(storage)?;
        }
    }
    if run.view().succeeded == 0 {
        return Err("No items could be analyzed. Review the per-item errors and retry.".into());
    }
    if token.is_cancelled() {
        return Err("Ingestion stopped before saving. Completed tables are preserved; continue later to save the guide.".into());
    }
    run.status = "saving".into();
    run.detail = Some("Writing your catalog to the selected destination".into());
    run.current = None;
    run.save(storage)?;
    let mut summary = run.view();
    summary.status = if summary.failed > 0 {
        "partial"
    } else {
        "completed"
    }
    .into();
    let document = serde_json::json!({
        "formatVersion": 2, "runId": run.id, "workspaceId": run.workspace_id, "database": run.database,
        "provider": run.provider, "requiresSemanticReview": true,
        "generatedAtUnixMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
        "summary": summary,
        "entities": run.entities.iter().filter(|entity| entity.status != "empty" && !entity.excluded).collect::<Vec<_>>(),
        "skippedItems": run.entities.iter().filter(|entity| entity.status == "empty" || entity.excluded).map(|entity| serde_json::json!({"schema": entity.schema, "name": entity.name, "reason": "not_selected"})).collect::<Vec<_>>(),
    });
    let bytes =
        serde_json::to_vec_pretty(&document).map_err(|_| "Could not create the schema catalog.")?;
    run.location = Some(destination::write(destination, &run.workspace_id, bytes).await?);
    run.status = if run.view().failed > 0 {
        "partial"
    } else {
        "completed"
    }
    .into();
    Ok(())
}

#[tauri::command]
pub fn select_ingestion_items(
    run_id: String,
    indices: Vec<usize>,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<RunView, String> {
    let mut run = load_run(&run_id, &storage)?;
    let _operation = jobs.acquire(&run.workspace_id)?;
    if run.status != "ready" {
        return Err("Choose tables after the scan finishes and before ingestion starts.".into());
    }
    if indices.iter().any(|&index| {
        run.entities
            .get(index)
            .is_none_or(|entity| !matches!(entity.status.as_str(), "data" | "empty"))
    }) {
        return Err("The selection no longer matches this scan. Refresh and try again.".into());
    }
    for (index, entity) in run.entities.iter_mut().enumerate() {
        if matches!(entity.status.as_str(), "data" | "empty") {
            entity.excluded = !indices.contains(&index);
            if entity.status == "empty" {
                entity.include_empty = !entity.excluded;
            }
        }
    }
    run.save(&storage)?;
    Ok(run.view())
}

#[tauri::command]
pub fn active_ingestions(
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<Vec<RunView>, String> {
    let workspaces: Vec<String> = jobs
        .active
        .lock()
        .map_err(|_| "Database operations are unavailable.")?
        .keys()
        .cloned()
        .collect();
    let mut runs = Vec::new();
    for workspace in workspaces {
        let id: Option<String> = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?
            .query_row("SELECT id FROM ingestion_runs WHERE workspace_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1", params![workspace], |row| row.get(0))
            .optional().map_err(|_| "Could not read ingestion progress.")?;
        if let Some(id) = id {
            let run = load_run(&id, &storage)?;
            if matches!(run.status.as_str(), "scanning" | "ingesting" | "saving") {
                runs.push(run.view());
            }
        }
    }
    Ok(runs)
}

#[tauri::command]
pub fn get_database_map(
    workspace_id: String,
    storage: State<'_, AppStorage>,
) -> Result<serde_json::Value, String> {
    let id: String = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?
        .query_row("SELECT id FROM ingestion_runs WHERE workspace_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1", params![workspace_id], |row| row.get(0))
        .optional().map_err(|_| "Could not read your database map.")?.ok_or("Ingest this database before opening its map.")?;
    let run = load_run(&id, &storage)?;
    if run.view().succeeded == 0 {
        return Err(
            "No tables are ready yet. Open ingestion results to see errors and retry.".into(),
        );
    }
    Ok(
        serde_json::json!({ "runId": run.id, "database": run.database, "provider": run.provider,
        "entities": run.entities.iter().filter(|entity| entity.status == "done" && !entity.excluded).collect::<Vec<_>>() }),
    )
}

#[tauri::command]
pub async fn confirm_map_override(window: WebviewWindow) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().message("You are replacing the map’s description or relationship with your own interpretation. Check that it is correct before continuing. This changes only your map in this app session; it does not change the database or the saved guide. Closing Sapienta will discard these edits.")
        .title("Apply your own interpretation?").kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Override map".into(), "Keep original".into())).parent(&window)
        .show(move |confirmed| { let _ = sender.send(confirmed); });
    receiver
        .await
        .map_err(|_| "Could not show the override confirmation.".into())
}

#[tauri::command]
pub async fn stop_ingestion(
    workspace_id: String,
    window: WebviewWindow,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<bool, String> {
    let token = jobs
        .active
        .lock()
        .map_err(|_| "Database operations are unavailable.")?
        .get(&workspace_id)
        .cloned()
        .ok_or("There is no active task to stop.")?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().message("Stop this task? Completed table descriptions will be kept so you can continue ingestion later. An unfinished scan must be started again. A file already being saved is allowed to finish.")
        .title("Stop database setup?").kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Stop task".into(), "Keep running".into())).parent(&window)
        .show(move |confirmed| { let _ = sender.send(confirmed); });
    if !receiver.await.map_err(|_| "Could not show confirmation.")? {
        return Ok(false);
    }
    let saving: bool = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?
        .query_row("SELECT EXISTS(SELECT 1 FROM ingestion_runs WHERE workspace_id = ?1 AND status = 'saving')", params![workspace_id], |row| row.get(0))
        .map_err(|_| "Could not check progress.")?;
    if saving {
        return Err("Your guide is being saved. Please let this final step finish.".into());
    }
    token.cancel();
    Ok(true)
}
