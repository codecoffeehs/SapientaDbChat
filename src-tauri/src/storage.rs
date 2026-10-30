use crate::database::{self, ConnectionRequest, DatabaseKind};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

pub struct AppStorage {
    pub(crate) connection: Mutex<Connection>,
    tested_connection: Mutex<Option<TestedConnection>>,
}

struct TestedConnection {
    id: String,
    request: ConnectionRequest,
    database_name: String,
    verified_at: i64,
    expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    id: String,
    name: String,
    provider: String,
    database_name: String,
    created_at: i64,
    last_tested_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    workspaces: Vec<Workspace>,
    theme: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    test_id: String,
    database_name: String,
    elapsed_ms: u64,
}

impl AppStorage {
    pub fn open(directory: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(directory)?;
        let path = directory.join("sapienta.sqlite3");

        // The file contains connection credentials. Restrict access to this OS user on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(&path)?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }

        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(3))?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL CHECK (provider IN ('postgres', 'sqlserver', 'mongodb')),
                connection_string TEXT NOT NULL,
                database_name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_tested_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS ingestion_destinations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                config TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ingestion_runs (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                document TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS ingestion_workspace ON ingestion_runs(workspace_id, created_at);
            UPDATE ingestion_runs SET status = 'interrupted'
                WHERE status IN ('scanning', 'ingesting', 'saving');",
        )?;

        crate::catalog::initialize(&connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
            tested_connection: Mutex::new(None),
        })
    }
}

#[tauri::command]
pub async fn test_connection(
    request: ConnectionRequest,
    storage: State<'_, AppStorage>,
) -> Result<TestConnectionResult, String> {
    let result = database::verify_connection(&request).await?;
    let test_id = Uuid::new_v4().to_string();
    let verified_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Your system clock could not be read.".to_string())?
        .as_millis() as i64;

    // Saving uses this exact tested connection, never an unverified string from the frontend.
    *storage
        .tested_connection
        .lock()
        .map_err(|_| "Could not retain the connection check.".to_string())? =
        Some(TestedConnection {
            id: test_id.clone(),
            request,
            database_name: result.database.clone(),
            verified_at,
            expires_at: Instant::now() + Duration::from_secs(600),
        });

    Ok(TestConnectionResult {
        test_id,
        database_name: result.database,
        elapsed_ms: result.elapsed_ms,
    })
}

#[tauri::command]
pub fn save_workspace(
    name: String,
    test_id: String,
    storage: State<'_, AppStorage>,
) -> Result<Workspace, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Give your workspace a name between 1 and 80 characters.".into());
    }

    let mut tested = storage
        .tested_connection
        .lock()
        .map_err(|_| "Could not read the connection check. Please test again.".to_string())?;
    let verified = tested
        .as_ref()
        .filter(|value| value.id == test_id && Instant::now() < value.expires_at)
        .ok_or_else(|| {
            "Please test this connection again before saving. Checks are valid for 10 minutes."
                .to_string()
        })?;
    let provider = match verified.request.database {
        DatabaseKind::Postgres => "postgres",
        DatabaseKind::SqlServer => "sqlserver",
        DatabaseKind::Mongodb => "mongodb",
    };
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Your system clock could not be read.".to_string())?
        .as_millis() as i64;
    let workspace = Workspace {
        id: verified.id.clone(),
        name: name.to_string(),
        provider: provider.into(),
        database_name: verified.database_name.clone(),
        created_at,
        last_tested_at: verified.verified_at,
    };
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable. Restart Sapienta and try again.".to_string())?;
    connection.execute(
        "INSERT INTO workspaces (id, name, provider, connection_string, database_name, created_at, last_tested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![workspace.id, workspace.name, workspace.provider,
            verified.request.connection_string.trim(), workspace.database_name,
            workspace.created_at, workspace.last_tested_at],
    ).map_err(|_| "Could not save the workspace to local storage. Check available disk space and try again.".to_string())?;

    *tested = None;
    Ok(workspace)
}

#[tauri::command]
pub async fn delete_workspace(
    id: String,
    window: tauri::WebviewWindow,
    storage: State<'_, AppStorage>,
    jobs: State<'_, crate::ingestion::IngestionState>,
) -> Result<bool, String> {
    let _operation = jobs.acquire(&id)?;
    let name: String = {
        let connection = storage
            .connection
            .lock()
            .map_err(|_| "Local storage is unavailable.".to_string())?;
        connection
            .query_row(
                "SELECT name FROM workspaces WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Could not read the workspace.".to_string())?
            .ok_or_else(|| "This workspace no longer exists.".to_string())?
    };

    // Release SQLite while the user decides, and keep the native dialog off the blocking path.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog()
        .message(format!("Delete “{name}” and its saved connection from this device?\n\nYour database and its data will not be deleted. This cannot be undone."))
        .title("Delete workspace?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Delete workspace".into(), "Cancel".into()))
        .parent(&window)
        .show(move |confirmed| { let _ = sender.send(confirmed); });
    if !receiver
        .await
        .map_err(|_| "Could not confirm workspace deletion.".to_string())?
    {
        return Ok(false);
    }

    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.".to_string())?;
    connection
        .execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|_| "Could not delete the workspace. Please try again.".to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_app_data(storage: State<'_, AppStorage>) -> Result<AppData, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable. Restart Sapienta and try again.".to_string())?;
    // Connection strings are deliberately excluded from workspace listings.
    let mut statement = connection
        .prepare(
            "SELECT id, name, provider, database_name, created_at, last_tested_at
         FROM workspaces ORDER BY created_at DESC, id",
        )
        .map_err(|_| "Could not read your saved workspaces.".to_string())?;
    let workspaces = statement
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                provider: row.get(2)?,
                database_name: row.get(3)?,
                created_at: row.get(4)?,
                last_tested_at: row.get(5)?,
            })
        })
        .map_err(|_| "Could not read your saved workspaces.".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Could not read one of your saved workspaces.".to_string())?;
    let theme = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'theme'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Could not read your appearance preference.".to_string())?;

    Ok(AppData { workspaces, theme })
}

#[tauri::command]
pub fn set_theme(theme: String, storage: State<'_, AppStorage>) -> Result<(), String> {
    if theme != "light" && theme != "dark" {
        return Err("Choose light or dark appearance.".into());
    }
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.".to_string())?;
    connection
        .execute(
            "INSERT INTO settings (key, value) VALUES ('theme', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![theme],
        )
        .map_err(|_| "Could not save your appearance preference.".to_string())?;
    Ok(())
}
