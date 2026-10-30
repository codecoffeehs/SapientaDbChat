use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

/// Local ingestion-only diagnostics. Never attach this logger to chat requests.
#[derive(Clone)]
pub struct Diagnostics {
    file: Arc<Mutex<File>>,
    run_id: String,
    secret: String,
}

impl Diagnostics {
    pub fn open(directory: &Path, run_id: &str, secret: String) -> Result<Self, String> {
        let directory = directory.join("logs");
        std::fs::create_dir_all(&directory)
            .map_err(|e| format!("Could not create ingestion log folder: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Could not protect ingestion log folder: {e}"))?;
        }
        // A fresh file for every attempt, including retries of the same run.
        let path = directory.join(format!("ingestion-{}.jsonl", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(path)
            .map_err(|e| format!("Could not open ingestion diagnostic log: {e}"))?;
        Ok(Self {
            file: Arc::new(Mutex::new(file)),
            run_id: run_id.into(),
            secret,
        })
    }

    pub fn record(&self, event: &str, data: Value) -> Result<(), String> {
        let entry = json!({"timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(), "runId": self.run_id, "event": event, "data": data});
        let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        if !self.secret.is_empty() {
            // Redact both raw and JSON-escaped occurrences, including provider echoes.
            let escaped = serde_json::to_string(&self.secret).map_err(|e| e.to_string())?;
            line = line
                .replace(&escaped[1..escaped.len() - 1], "[redacted]")
                .replace(&self.secret, "[redacted]");
        }
        let mut file = self
            .file
            .lock()
            .map_err(|_| "Could not lock ingestion diagnostic log.")?;
        writeln!(file, "{line}")
            .and_then(|_| file.flush())
            .map_err(|e| format!("Could not write ingestion diagnostic log: {e}"))
    }
}
