use crate::storage::AppStorage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub comment: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relationship {
    pub columns: Vec<String>,
    pub target_schema: String,
    pub target_table: String,
    pub target_columns: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    #[serde(default)]
    pub presence_checked: bool,
    #[serde(default)]
    pub excluded: bool,
    #[serde(default)]
    pub is_empty: bool,
    #[serde(default)]
    pub include_empty: bool,
    pub schema: String,
    pub name: String,
    pub status: String,
    pub fields: Vec<Field>,
    pub relationships: Vec<Relationship>,
    pub notes: Vec<String>,
    pub analysis: Option<Value>,
    pub error: Option<String>,
}

impl Entity {
    pub fn new(schema: String, name: String) -> Self {
        Self {
            excluded: false,
            presence_checked: false,
            is_empty: false,
            include_empty: false,
            schema,
            name,
            status: "pending".into(),
            fields: vec![],
            relationships: vec![],
            notes: vec![],
            analysis: None,
            error: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub started_at: u64,
    pub id: String,
    pub workspace_id: String,
    pub database: String,
    pub provider: String,
    pub status: String,
    pub scan_complete: bool,
    pub entities: Vec<Entity>,
    pub current: Option<String>,
    pub error: Option<String>,
    pub destination_id: Option<String>,
    pub location: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub detail: Option<String>,
    pub started_at: u64,
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub scan_complete: bool,
    pub current: Option<String>,
    pub error: Option<String>,
    pub destination_id: Option<String>,
    pub location: Option<String>,
    pub total: usize,
    pub checked: usize,
    pub eligible: usize,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub percent: usize,
    pub items: Vec<Value>,
}

impl Run {
    pub fn save(&self, storage: &AppStorage) -> Result<(), String> {
        let json =
            serde_json::to_string(self).map_err(|_| "Could not record ingestion progress.")?;
        let mut connection = storage
            .connection
            .lock()
            .map_err(|_| "Local storage is unavailable.")?;
        let transaction = connection.transaction().map_err(|_| "Could not start saving progress.")?;
        transaction.execute(
            "INSERT INTO ingestion_runs (id, workspace_id, status, document) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET status = excluded.status, document = excluded.document",
            rusqlite::params![self.id, self.workspace_id, self.status, json],
        ).map_err(|_| "Could not save ingestion progress. Check local disk space.")?;
        crate::catalog::sync(&transaction, self)?;
        transaction.commit().map_err(|_| "Could not save the local catalog.")?;
        Ok(())
    }

    pub fn view(&self) -> RunView {
        let total = self.entities.len();
        let checked = self
            .entities
            .iter()
            .filter(|e| e.status != "pending")
            .count();
        let eligible = self
            .entities
            .iter()
            .filter(|e| {
                !e.excluded
                    && (matches!(e.status.as_str(), "data" | "processing" | "done" | "failed")
                        || (e.status == "empty" && e.include_empty))
            })
            .count();
        let succeeded = self.entities.iter().filter(|e| e.status == "done" && !e.excluded).count();
        let failed = self
            .entities
            .iter()
            .filter(|e| e.status == "failed" || e.status == "error")
            .count();
        let skipped = self
            .entities
            .iter()
            .filter(|e| e.excluded || (e.status == "empty" && !e.include_empty))
            .count();
        let processed = succeeded
            + self
                .entities
                .iter()
                .filter(|e| e.status == "failed" && !e.excluded)
                .count();
        let percent = if !self.scan_complete {
            checked * 100 / total.max(1)
        } else {
            succeeded * 100 / eligible.max(1)
        };
        RunView {
            detail: self.detail.clone(),
            started_at: self.started_at,
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            status: self.status.clone(),
            scan_complete: self.scan_complete,
            current: self.current.clone(),
            error: self.error.clone(),
            destination_id: self.destination_id.clone(),
            location: self.location.clone(),
            total,
            checked,
            eligible,
            processed,
            succeeded,
            failed,
            skipped,
            percent,
            items: self
                .entities
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "schema": e.schema, "name": e.name, "status": e.status, "excluded": e.excluded,
                        "fieldCount": e.fields.len(), "error": e.error,
                        "summary": e.analysis.as_ref().and_then(|a| a.pointer("/mapping/summary")),
                        "confidence": e.analysis.as_ref().and_then(|a| a.pointer("/mapping/confidence")),
                        "uncertainties": e.analysis.as_ref().and_then(|a| a.pointer("/mapping/uncertainties")),
                        "notes": e.notes,
                        "isEmpty": e.is_empty || e.status == "empty", "includeEmpty": e.include_empty,
                    })
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(entities: Vec<Entity>) -> Run {
        Run {
            detail: None,
            started_at: 0,
            id: "test".into(),
            workspace_id: "test".into(),
            database: "test".into(),
            provider: "postgres".into(),
            status: "ready".into(),
            scan_complete: true,
            entities,
            current: None,
            error: None,
            destination_id: None,
            location: None,
        }
    }

    #[test]
    fn clearing_populated_tables_removes_them_from_eligible_count() {
        let mut table = Entity::new("public".into(), "orders".into());
        table.status = "data".into();
        let mut run = scan(vec![table]);
        assert_eq!(run.view().eligible, 1);
        run.entities[0].excluded = true;
        assert_eq!(run.view().eligible, 0);
        assert_eq!(run.view().skipped, 1);
        run.entities[0].excluded = false;
        assert_eq!(run.view().eligible, 1);
    }

    #[test]
    fn older_saved_tables_remain_included_by_default() {
        let mut table = Entity::new("public".into(), "orders".into());
        table.status = "data".into();
        let mut json = serde_json::to_value(table).unwrap();
        json.as_object_mut().unwrap().remove("excluded");
        let restored: Entity = serde_json::from_value(json).unwrap();
        assert!(!restored.excluded);
        assert_eq!(scan(vec![restored]).view().eligible, 1);
    }

    #[test]
    fn empty_tables_only_count_when_selected() {
        let mut table = Entity::new("public".into(), "orders".into());
        table.status = "empty".into();
        let mut run = scan(vec![table]);
        assert_eq!(run.view().eligible, 0);
        run.entities[0].include_empty = true;
        assert_eq!(run.view().eligible, 1);
        run.entities[0].excluded = true;
        assert_eq!(run.view().eligible, 0);
        assert_eq!(run.view().skipped, 1);
    }
    #[test]
    fn progress_uses_selected_tables_and_does_not_mark_failures_ready() {
        let mut entities = Vec::new();
        for status in ["done", "done", "failed", "failed", "failed", "empty", "data"] {
            let mut entity = Entity::new("public".into(), format!("table_{}", entities.len()));
            entity.status = status.into();
            entity.excluded = status == "data";
            entities.push(entity);
        }
        let mut run = scan(entities);
        run.status = "partial".into();
        let view = run.view();
        assert_eq!(view.eligible, 5);
        assert_eq!(view.succeeded, 2);
        assert_eq!(view.eligible - view.succeeded, 3);
        assert_eq!(view.percent, 40);
        assert_eq!(view.skipped, 2);
        run.entities[2].status = "done".into();
        assert_eq!(run.view().percent, 60);
    }

}
