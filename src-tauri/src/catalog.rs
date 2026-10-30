use crate::{
    ingestion::{
        self,
        models::{Entity, Run},
    },
    storage::AppStorage,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

pub fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS catalog_entries (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
        entity_index INTEGER NOT NULL, body TEXT NOT NULL, document TEXT NOT NULL,
        UNIQUE(run_id, entity_index));
        CREATE VIRTUAL TABLE IF NOT EXISTS catalog_search USING fts5(body, content='catalog_entries', content_rowid='id');
        CREATE TRIGGER IF NOT EXISTS catalog_insert AFTER INSERT ON catalog_entries BEGIN
          INSERT INTO catalog_search(rowid, body) VALUES (new.id, new.body); END;
        CREATE TRIGGER IF NOT EXISTS catalog_delete AFTER DELETE ON catalog_entries BEGIN
          INSERT INTO catalog_search(catalog_search, rowid, body) VALUES ('delete', old.id, old.body); END;
        CREATE TRIGGER IF NOT EXISTS catalog_update AFTER UPDATE ON catalog_entries BEGIN
          INSERT INTO catalog_search(catalog_search, rowid, body) VALUES ('delete', old.id, old.body);
          INSERT INTO catalog_search(rowid, body) VALUES (new.id, new.body); END;
        CREATE TABLE IF NOT EXISTS catalog_runs (
          run_id TEXT PRIMARY KEY REFERENCES ingestion_runs(id) ON DELETE CASCADE, header TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS chat_turns (
          id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
          question TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));")?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'New conversation', created_at INTEGER NOT NULL DEFAULT (unixepoch()));")?;
    let has_column = connection.prepare("PRAGMA table_info(chat_turns)")?.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?.iter().any(|name| name == "conversation_id");
    if !has_column { connection.execute_batch("ALTER TABLE chat_turns ADD COLUMN conversation_id TEXT;")?; }
    connection.execute_batch("CREATE INDEX IF NOT EXISTS chat_conversation ON chat_turns(conversation_id,id);")
}

pub fn sync(connection: &Connection, run: &Run) -> Result<(), String> {
    let mut header = run.clone();
    header.entities.clear();
    let header =
        serde_json::to_string(&header).map_err(|_| "Could not encode catalog metadata.")?;
    connection.execute("INSERT INTO catalog_runs(run_id,header) VALUES (?1,?2) ON CONFLICT(run_id) DO UPDATE SET header=excluded.header", params![run.id,header])
        .map_err(|error| format!("Could not save catalog metadata: {error}"))?;
    for (index, entity) in run.entities.iter().enumerate() {
        if entity.status != "done" || entity.excluded || entity.analysis.is_none() {
            connection
                .execute(
                    "DELETE FROM catalog_entries WHERE run_id=?1 AND entity_index=?2",
                    params![run.id, index as i64],
                )
                .map_err(|_| "Could not update the local search catalog.")?;
            continue;
        }
        let document =
            serde_json::to_string(entity).map_err(|_| "Could not encode the catalog.")?;
        let mapping = entity.analysis.as_ref().and_then(|a| a.get("mapping"));
        let mut terms = vec![entity.schema.clone(), entity.name.clone()];
        terms.extend(entity.fields.iter().map(|f| f.name.clone()));
        fn collect_text(value: &Value, words: &mut Vec<String>) {
            match value {
                Value::String(text) => words.push(text.clone()),
                Value::Array(values) => {
                    for value in values {
                        collect_text(value, words);
                    }
                }
                Value::Object(values) => {
                    for value in values.values() {
                        collect_text(value, words);
                    }
                }
                _ => {}
            }
        }
        if let Some(mapping) = mapping {
            collect_text(mapping, &mut terms);
        }
        let body = terms.join(" ").replace('_', " ");
        connection.execute("INSERT INTO catalog_entries(run_id,entity_index,body,document) VALUES (?1,?2,?3,?4)
            ON CONFLICT(run_id,entity_index) DO UPDATE SET body=excluded.body,document=excluded.document
            WHERE catalog_entries.document != excluded.document OR catalog_entries.body != excluded.body", params![run.id,index as i64,body,document])
            .map_err(|_| "Could not index the table descriptions on this device.")?;
    }
    Ok(())
}

pub fn latest(workspace: &str, storage: &AppStorage) -> Result<Run, String> {
    let id: String = storage.connection.lock().map_err(|_| "Local storage is unavailable.")?
        .query_row("SELECT id FROM ingestion_runs WHERE workspace_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1", [workspace], |row| row.get(0))
        .optional().map_err(|_| "Could not read the catalog.")?.ok_or("Scan and ingest your database first.")?;
    let header: Option<String> = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?
        .query_row(
            "SELECT header FROM catalog_runs WHERE run_id=?1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read catalog metadata: {error}"))?;
    if let Some(header) = header {
        return serde_json::from_str(&header)
            .map_err(|_| "Catalog metadata is invalid. Scan again.".into());
    }
    // One-time migration for runs produced before the searchable catalog existed.
    let mut run = ingestion::load_run(&id, storage)?;
    {
        let mut connection = storage
            .connection
            .lock()
            .map_err(|_| "Local storage is unavailable.")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "Could not open catalog migration.")?;
        sync(&transaction, &run)?;
        transaction
            .commit()
            .map_err(|_| "Could not save catalog migration.")?;
    }
    run.entities.clear();
    Ok(run)
}

pub fn retrieve(connection: &Connection, run: &Run, terms: &str) -> Result<Vec<usize>, String> {
    let words: Vec<String> = terms
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() > 1)
        .take(40)
        .map(|s| format!("\"{}\"", s))
        .collect();
    let mut indices = Vec::new();
    if !words.is_empty() {
        let mut statement = connection.prepare("SELECT c.entity_index FROM catalog_search JOIN catalog_entries c ON c.id=catalog_search.rowid
            WHERE catalog_search MATCH ?1 AND c.run_id=?2 ORDER BY bm25(catalog_search) LIMIT 8")
            .map_err(|_| "Could not search your table descriptions.")?;
        indices = statement
            .query_map(params![words.join(" OR "), run.id], |row| {
                row.get::<_, i64>(0).map(|value| value as usize)
            })
            .map_err(|_| "Could not search your table descriptions.")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Could not read search results.")?;
    }
    if indices.is_empty() {
        let mut statement=connection.prepare("SELECT entity_index FROM catalog_entries WHERE run_id=?1 ORDER BY entity_index LIMIT 13").map_err(|error|format!("Could not read catalog: {error}"))?;
        let ready = statement
            .query_map([&run.id], |row| row.get::<_, i64>(0).map(|i| i as usize))
            .map_err(|error| format!("Could not read catalog: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Invalid catalog index.")?;
        if ready.len() <= 12 {
            indices = ready;
        }
    }
    for _ in 0..2 {
        let previous = indices.clone();
        let mut statement=connection.prepare("SELECT s.entity_index,t.entity_index FROM catalog_entries s, json_each(s.document,'$.relationships') r
            JOIN catalog_entries t ON t.run_id=s.run_id AND json_extract(t.document,'$.schema')=json_extract(r.value,'$.targetSchema') AND json_extract(t.document,'$.name')=json_extract(r.value,'$.targetTable')
            WHERE s.run_id=?1 AND (s.entity_index=?2 OR t.entity_index=?2)").map_err(|error|format!("Could not read catalog relationships: {error}"))?;
        for i in previous {
            let pairs = statement
                .query_map(params![run.id, i as i64], |row| {
                    Ok((
                        row.get::<_, i64>(0)? as usize,
                        row.get::<_, i64>(1)? as usize,
                    ))
                })
                .map_err(|error| format!("Could not read relationships: {error}"))?;
            for pair in pairs {
                let (source, target) = pair.map_err(|_| "Invalid catalog relationship.")?;
                for index in [source, target] {
                    if indices.len() < 16 && !indices.contains(&index) {
                        indices.push(index);
                    }
                }
            }
        }
    }
    Ok(indices)
}

pub fn history(connection: &Connection, conversation_id: &str) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare("SELECT question,answer FROM (SELECT id,question,answer FROM chat_turns WHERE conversation_id=?1 ORDER BY id DESC LIMIT 30) ORDER BY id")
        .map_err(|_| "Could not open conversation history.")?;
    let turns = statement
        .query_map([conversation_id], |row| {
            let question: String = row.get(0)?;
            let answer: String = row.get(1)?;
            let answer: Value = serde_json::from_str(&answer).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(json!({"question":question,"answer":answer}))
        })
        .map_err(|_| "Could not read conversations.")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Could not read conversations.".to_string())?;
    Ok(turns)
}

#[tauri::command]
pub fn get_chat_state(
    workspace_id: String,
    conversation_id: Option<String>,
    storage: tauri::State<'_, AppStorage>,
) -> Result<Value, String> {
    let run = latest(&workspace_id, &storage)?;
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?;
    let ready = ready_count(&connection, &run.id)?;
    let mut stmt = connection.prepare("SELECT id,title FROM conversations WHERE workspace_id=?1 ORDER BY created_at DESC,rowid DESC").map_err(|e|e.to_string())?;
    let conversations = stmt.query_map([&workspace_id], |row| Ok(json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?}))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    let selected = conversation_id.or_else(|| conversations.first().and_then(|c|c["id"].as_str()).map(str::to_owned));
    let turns = if let Some(id) = &selected { validate_conversation(&connection, &workspace_id, id)?; history(&connection,id)? } else { Vec::new() };
    Ok(json!({"runId":run.id,"ready":ready,"conversationId":selected,"conversations":conversations,"turns":turns}))
}

pub fn ready_count(connection: &Connection, run_id: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT count(*) FROM catalog_entries WHERE run_id=?1",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count indexed tables: {error}"))
}

pub fn load_context(
    connection: &Connection,
    run: &mut Run,
    indices: &[usize],
) -> Result<(), String> {
    let size = indices.iter().max().map(|i| i + 1).unwrap_or(0);
    if size > 5000 {
        return Err("Catalog table index is invalid. Scan again.".into());
    }
    run.entities = vec![Entity::new(String::new(), String::new()); size];
    let mut statement = connection
        .prepare("SELECT document FROM catalog_entries WHERE run_id=?1 AND entity_index=?2")
        .map_err(|error| format!("Could not open catalog records: {error}"))?;
    for &index in indices {
        let text: String = statement
            .query_row(params![run.id, index as i64], |row| row.get(0))
            .map_err(|_| "A selected catalog record is missing. Retry your question.")?;
        run.entities[index] =
            serde_json::from_str(&text).map_err(|_| "A catalog record is invalid. Scan again.")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::plan::tests::fixture;
    #[test]
    fn search_is_scoped_to_run_expands_relationships_and_removes_excluded_tables() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE ingestion_runs(id TEXT PRIMARY KEY);INSERT INTO ingestion_runs VALUES('run-a'),('run-b');").unwrap();
        initialize(&connection).unwrap();
        let mut run = fixture();
        sync(&connection, &run).unwrap();
        let found = retrieve(&connection, &run, "sales invoices").unwrap();
        assert!(found.contains(&0) && found.contains(&1));
        let mut other = fixture();
        other.id = "run-b".into();
        other.entities[0].name = "secret_table".into();
        sync(&connection, &other).unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM catalog_entries WHERE run_id='run-a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
        run.entities[0].excluded = true;
        sync(&connection, &run).unwrap();
        assert!(
            !retrieve(&connection, &run, "sales invoices")
                .unwrap()
                .contains(&0)
        );
        run.entities[1].status = "failed".into();
        sync(&connection, &run).unwrap();
        assert!(retrieve(&connection, &run, "customer").unwrap().is_empty());
        connection
            .execute("DELETE FROM ingestion_runs WHERE id='run-b'", [])
            .unwrap();
        let remaining: i64 = connection
            .query_row("SELECT count(*) FROM catalog_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }
}

pub fn validate_conversation(connection: &Connection, workspace: &str, id: &str) -> Result<(), String> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1 AND workspace_id=?2)", params![id,workspace], |r|r.get(0)).map_err(|e|e.to_string())?;
    if exists { Ok(()) } else { Err("This conversation is not in this workspace.".into()) }
}
#[tauri::command]
pub fn create_conversation(workspace_id: String, storage: tauri::State<'_, AppStorage>) -> Result<String,String> {
    let id = uuid::Uuid::new_v4().to_string();
    storage.connection.lock().map_err(|_|"Local storage is unavailable.")?.execute("INSERT INTO conversations(id,workspace_id) VALUES (?1,?2)",params![id,workspace_id]).map_err(|e|e.to_string())?;
    Ok(id)
}
