mod catalog;
mod chat;
mod credentials;
mod database;
mod ingestion;
mod storage;
#[cfg(desktop)]
mod tray;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ingestion::IngestionState::default())
        .manage(chat::ChatRequests::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<ingestion::IngestionState>().is_active() {
                    api.prevent_close();
                    window.dialog().message("A database operation is still running. Keep Sapienta open until scanning, ingestion, or saving finishes.")
                        .title("Keep Sapienta open").show(|_| {});
                }
            }
        })
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            app.manage(storage::AppStorage::open(&directory)?);
            #[cfg(desktop)]
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog::get_chat_state,
            catalog::create_conversation,
            chat::ask_database,
            chat::cancel_chat,
            credentials::has_ai_key,
            credentials::save_ai_key,
            storage::test_connection,
            storage::save_workspace,
            storage::delete_workspace,
            storage::get_app_data,
            storage::set_theme,
            ingestion::scan_workspace,
            ingestion::get_ingestion,
            ingestion::get_database_map,
            ingestion::confirm_map_override,
            ingestion::map_edits::save_map_edit,
            ingestion::start_ingestion,
            ingestion::stop_ingestion,
            ingestion::select_ingestion_items,
            ingestion::active_ingestions,
            ingestion::destination::list_ingestion_destinations,
            ingestion::destination::choose_ingestion_folder,
            ingestion::destination::save_s3_destination,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<ingestion::IngestionState>().is_active() {
                    api.prevent_exit();
                    app.dialog().message("A database operation is running. Please keep Sapienta open until it finishes.")
                        .title("Keep Sapienta open").show(|_| {});
                }
            }
        });
}
