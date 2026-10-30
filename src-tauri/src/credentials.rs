use keyring::{Entry, Error};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

fn entry() -> Result<Entry, String> {
    Entry::new("com.sapienta.db-chat", "ai-api-key")
        .map_err(|_| "Could not access your operating system’s credential store.".into())
}

fn read() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(
            "Could not read secure storage. Unlock your keychain or credential store and retry."
                .into(),
        ),
    }
}

pub async fn read_ai_key() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(read)
        .await
        .map_err(|_| "Secure storage is unavailable.")??
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "Add your AI API key before starting ingestion.".into())
}

#[tauri::command]
pub async fn has_ai_key() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        read().map(|key| key.is_some_and(|key| !key.trim().is_empty()))
    })
    .await
    .map_err(|_| "Secure storage is unavailable.")?
}

#[tauri::command]
pub async fn save_ai_key(
    key: String,
    jobs: tauri::State<'_, crate::ingestion::IngestionState>,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    let _operation = jobs.acquire("__ai-settings__")?;
    let key = key.trim().to_owned();
    if key.is_empty() || key.len() > 8192 || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Enter the API key only, without a Bearer prefix or spaces.".into());
    }
    if has_ai_key().await? {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window.dialog().message("Replace the saved API key for all workspaces? The previous key will no longer be stored by Sapienta. This does not revoke it with the AI provider.")
            .title("Replace API key?").parent(&window)
            .buttons(MessageDialogButtons::OkCancelCustom("Replace key".into(), "Cancel".into()))
            .show(move |confirmed| { let _ = sender.send(confirmed); });
        if !receiver.await.map_err(|_| "Could not show confirmation.")? {
            return Ok(false);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Update the single app-wide entry; no previous key or per-workspace copies are retained.
        entry()?.set_password(&key).map_err(|_| {
            "Could not save the API key securely. Unlock your credential store and retry."
                .to_string()
        })
    })
    .await
    .map_err(|_| "Secure storage is unavailable.")??;
    Ok(true)
}
