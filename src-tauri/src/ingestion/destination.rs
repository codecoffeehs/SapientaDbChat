use crate::storage::AppStorage;
use object_store::{ObjectStore, aws::AmazonS3Builder, path::Path as ObjectPath};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum Destination {
    Local {
        directory: String,
    },
    S3 {
        endpoint: String,
        access_key_id: String,
        secret_access_key: String,
        bucket: String,
        public_base_url: String,
        region: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Input {
    name: String,
    endpoint: String,
    access_key_id: String,
    secret_access_key: String,
    bucket: String,
    public_base_url: String,
    region: Option<String>,
}

fn summary(id: String, name: String, config: &Destination) -> Value {
    match config {
        Destination::Local { directory } => {
            json!({ "id": id, "name": name, "kind": "local", "description": directory })
        }
        Destination::S3 {
            endpoint,
            bucket,
            region,
            ..
        } => {
            json!({ "id": id, "name": name, "kind": "s3", "description": format!("{endpoint}/{bucket}"), "region": region })
        }
    }
}

fn save(name: &str, config: Destination, storage: &AppStorage) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let encoded =
        serde_json::to_string(&config).map_err(|_| "Could not encode storage settings.")?;
    storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?
        .execute(
            "INSERT INTO ingestion_destinations (id, name, config) VALUES (?1, ?2, ?3)",
            params![id, name, encoded],
        )
        .map_err(|_| "Could not save storage settings.")?;
    Ok(summary(id, name.into(), &config))
}

pub fn load(id: &str, storage: &AppStorage) -> Result<Destination, String> {
    let config: String = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?
        .query_row(
            "SELECT config FROM ingestion_destinations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Could not read storage settings.")?
        .ok_or("Choose a saved storage destination.")?;
    serde_json::from_str(&config)
        .map_err(|_| "Saved storage settings are invalid. Add a new destination.".into())
}

#[tauri::command]
pub fn list_ingestion_destinations(storage: State<'_, AppStorage>) -> Result<Vec<Value>, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|_| "Local storage is unavailable.")?;
    let mut statement = connection
        .prepare("SELECT id, name, config FROM ingestion_destinations ORDER BY name")
        .map_err(|_| "Could not read storage destinations.")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "Could not read storage destinations.")?;
    rows.map(|row| {
        let (id, name, config) = row.map_err(|_| "Could not read storage destination.")?;
        let config =
            serde_json::from_str(&config).map_err(|_| "A saved storage destination is invalid.")?;
        Ok(summary(id, name, &config))
    })
    .collect()
}

#[tauri::command]
pub async fn choose_ingestion_folder(
    window: WebviewWindow,
    storage: State<'_, AppStorage>,
) -> Result<Option<Value>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title("Where should Sapienta save your schema catalog?")
        .set_parent(&window)
        .pick_folder(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver
        .await
        .map_err(|_| "The folder picker could not be opened.")?
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|_| "Choose a folder on this device.")?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Local folder")
        .to_string();
    let directory = path
        .to_str()
        .ok_or("This folder path is not supported.")?
        .to_string();
    save(&name, Destination::Local { directory }, &storage).map(Some)
}

#[tauri::command]
pub fn save_s3_destination(
    input: S3Input,
    storage: State<'_, AppStorage>,
) -> Result<Value, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Give this destination a name of up to 80 characters.".into());
    }
    let endpoint = input.endpoint.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(endpoint).map_err(|_| "Enter a valid S3 endpoint URL.")?;
    let public = reqwest::Url::parse(input.public_base_url.trim())
        .map_err(|_| "Enter a valid public base URL.")?;
    for value in [&url, &public] {
        if value.scheme() != "https"
            || value.host_str().is_none()
            || !value.username().is_empty()
            || value.password().is_some()
            || value.query().is_some()
            || value.fragment().is_some()
        {
            return Err(
                "Storage URLs must use HTTPS without credentials, query parameters, or fragments."
                    .into(),
            );
        }
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("Use the S3 service endpoint without a bucket or path.".into());
    }
    let bucket = input.bucket.trim();
    if bucket.len() < 3
        || bucket.len() > 63
        || !bucket
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return Err(
            "Enter a valid S3 bucket name (3–63 lowercase letters, numbers, dots, or hyphens)."
                .into(),
        );
    }
    if input.access_key_id.trim().is_empty() || input.secret_access_key.trim().is_empty() {
        return Err("Both S3 access key fields are required.".into());
    }
    let host = url.host_str().unwrap_or_default();
    let ovh_region = host
        .strip_prefix("s3.")
        .filter(|_| host.ends_with(".cloud.ovh.net") || host.ends_with(".cloud.ovh.us"))
        .and_then(|host| host.split('.').next());
    let region = input.region.as_deref().map(str::trim).filter(|s| !s.is_empty()).or(ovh_region)
        .ok_or("Enter the signing region for this S3 endpoint. OVH regions are detected automatically.")?.to_string();
    save(
        name,
        Destination::S3 {
            endpoint: endpoint.into(),
            access_key_id: input.access_key_id.trim().into(),
            secret_access_key: input.secret_access_key.trim().into(),
            bucket: bucket.into(),
            public_base_url: input.public_base_url.trim().trim_end_matches('/').into(),
            region,
        },
        &storage,
    )
}

pub async fn write(
    config: &Destination,
    workspace_id: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    match config {
        Destination::Local { directory } => {
            let root = std::path::Path::new(directory);
            let target = root.join(format!("sapienta-{workspace_id}.json"));
            let temp = root.join(format!(".sapienta-{}.tmp", uuid::Uuid::new_v4()));
            let result = async {
                let mut options = tokio::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options.open(&temp).await.map_err(
                    |_| "Could not write to this folder. Check permissions and free space.",
                )?;
                file.write_all(&bytes)
                    .await
                    .map_err(|_| "Could not write the schema catalog.")?;
                file.sync_all()
                    .await
                    .map_err(|_| "Could not finish writing the schema catalog.")?;
                drop(file);
                tokio::fs::rename(&temp, &target)
                    .await
                    .map_err(|_| "Could not finalize the schema catalog.")?;
                Ok::<_, String>(target.to_string_lossy().into_owned())
            }
            .await;
            if result.is_err() {
                let _ = tokio::fs::remove_file(&temp).await;
            }
            result
        }
        Destination::S3 {
            endpoint,
            access_key_id,
            secret_access_key,
            bucket,
            region,
            ..
        } => {
            let store = AmazonS3Builder::new()
                .with_endpoint(endpoint)
                .with_region(region)
                .with_bucket_name(bucket)
                .with_access_key_id(access_key_id)
                .with_secret_access_key(secret_access_key)
                .with_virtual_hosted_style_request(false)
                .build()
                .map_err(|_| "Could not configure S3. Check the saved endpoint and region.")?;
            let key = format!("sapienta/{workspace_id}/catalog.json");
            tokio::time::timeout(Duration::from_secs(90), store.put(&ObjectPath::from(key.as_str()), bytes.into())).await
                .map_err(|_| "S3 upload timed out. Your catalog is checkpointed locally; retry saving.")?
                .map_err(|_| "S3 upload failed. Check the endpoint, region, bucket, credentials, and PutObject permission. Your catalog is checkpointed locally.")?;
            Ok(format!("s3://{bucket}/{key}"))
        }
    }
}
