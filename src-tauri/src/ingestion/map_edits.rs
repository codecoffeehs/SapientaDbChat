use super::{load_run, models::Relationship, IngestionState};
use crate::storage::AppStorage;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEdit {
    table: Option<(String, String)>,
    description: Option<String>,
    links: Option<Vec<Link>>,
    #[serde(default)]
    affected_tables: Vec<(String, String)>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    source_table: (String, String),
    target_table: (String, String),
    source_columns: Vec<String>,
    target_columns: Vec<String>,
    description: String,
    cardinality: String,
    manual: Option<bool>,
    id: String,
    source: String,
    target: String,
    cautions: Vec<String>,
}
#[tauri::command]
pub async fn save_map_edit(
    run_id: String,
    edit: MapEdit,
    window: WebviewWindow,
    storage: State<'_, AppStorage>,
    jobs: State<'_, IngestionState>,
) -> Result<bool, String> {
    let mut run = load_run(&run_id, &storage)?;
    let _operation = jobs.acquire(&run.workspace_id)?;
    let latest: String = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?.query_row("SELECT id FROM ingestion_runs WHERE workspace_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1", [&run.workspace_id], |row|row.get(0)).map_err(|e|e.to_string())?;
    if latest != run_id {
        return Err("This map has been replaced by a new scan. Reopen the current map.".into());
    }
    if let Some((schema, name)) = &edit.table {
        let entity = run
            .entities
            .iter_mut()
            .find(|e| &e.schema == schema && &e.name == name && e.status == "done" && !e.excluded)
            .ok_or("Only ingested tables can be edited.")?;
        let description = edit.description.as_deref().unwrap_or("").trim();
        if description.is_empty() || description.chars().count() > 6000 {
            return Err("Enter a description of up to 6,000 characters.".into());
        }
        let analysis = entity
            .analysis
            .as_mut()
            .ok_or("This table has no semantic map.")?;
        analysis["mapping"]["summary"] = json!(description);
        analysis["userEdited"] = json!(true);
    } else if let Some(links) = &edit.links {
        if links.len() > 10000 {
            return Err("Too many map relationships.".into());
        }
        for link in links {
            let source = run
                .entities
                .iter()
                .find(|e| (e.schema.clone(), e.name.clone()) == link.source_table)
                .ok_or("Unknown source table.")?;
            let target = run
                .entities
                .iter()
                .find(|e| (e.schema.clone(), e.name.clone()) == link.target_table)
                .ok_or("Unknown target table.")?;
            if link.source_columns.is_empty()
                || link.source_columns.len() != link.target_columns.len()
                || link.description.trim().is_empty()
                || link.description.chars().count() > 6000
                || !link
                    .source_columns
                    .iter()
                    .all(|c| source.fields.iter().any(|f| &f.name == c))
                || !link
                    .target_columns
                    .iter()
                    .all(|c| target.fields.iter().any(|f| &f.name == c))
            {
                return Err(
                    "Choose existing matching fields and a description for every relationship."
                        .into(),
                );
            }
        }
        for entity in run
            .entities
            .iter_mut()
            .filter(|e| e.status == "done" && !e.excluded)
        {
            let outgoing: Vec<_> = links
                .iter()
                .filter(|l| l.source_table == (entity.schema.clone(), entity.name.clone()))
                .collect();
            let relationships: Vec<_> = outgoing
                .iter()
                .map(|l| Relationship {
                    columns: l.source_columns.clone(),
                    target_schema: l.target_table.0.clone(),
                    target_table: l.target_table.1.clone(),
                    target_columns: l.target_columns.clone(),
                })
                .collect();
            let analysis = entity.analysis.as_mut().ok_or("Missing semantic map.")?;
            let saved: Vec<Value> = outgoing.iter().map(|l|json!({"id":l.id,"source":l.source,"target":l.target,"sourceColumns":l.source_columns,"targetColumns":l.target_columns,"description":l.description,"cardinality":l.cardinality,"manual":l.manual.unwrap_or(false),"cautions":l.cautions})).collect();
            if edit
                .affected_tables
                .contains(&(entity.schema.clone(), entity.name.clone()))
            {
                analysis["userEdited"] = json!(true);
            }
            entity.relationships = relationships;
            analysis["savedMapLinks"] = json!(saved);
            analysis["declaredRelationships"] = json!(outgoing.iter().enumerate().map(|(i,l)|json!({"id":format!("r{i}"),"direction":"outgoing","source":{"schema":entity.schema,"table":entity.name,"columns":l.source_columns},"target":{"schema":l.target_table.0,"table":l.target_table.1,"columns":l.target_columns},"evidence":if l.manual.unwrap_or(false) {"user_confirmed"} else {"declared_foreign_key"}})).collect::<Vec<_>>());
            analysis["mapping"]["relationships"] = json!(outgoing.iter().enumerate().map(|(i,l)|json!({"id":format!("r{i}"),"description":l.description,"cardinality":l.cardinality,"cautions":l.cautions})).collect::<Vec<_>>());
        }
    } else {
        return Err("No map changes were supplied.".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().message("Save these edits to the local semantic catalog? Future questions will use your descriptions and relationships. The map will be marked User edited until a new scan and ingestion rebuild it. Your source database and previously exported files will not change.")
        .title("Save map edits?").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancelCustom("Save edits".into(),"Cancel".into())).parent(&window).show(move |yes|{let _=sender.send(yes);});
    if !receiver.await.map_err(|_| "Could not confirm map edits.")? {
        return Ok(false);
    }
    run.save(&storage)?;
    Ok(true)
}
