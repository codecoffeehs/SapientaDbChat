use crate::{ingestion, storage::AppStorage};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

// A template image lets macOS choose the correct light/dark menu bar color.
fn menu_bar_icon() -> tauri::image::Image<'static> {
    let size = 36usize;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let px = x as f64 - 17.5;
            let py = y as f64;
            let ellipse =
                |cy: f64| ((px / 12.0).powi(2) + ((py - cy) / 4.0).powi(2) - 1.0).abs() < 0.35;
            let sides = (px.abs() - 12.0).abs() < 1.2 && (9.0..=27.0).contains(&py);
            if ellipse(9.0)
                || (ellipse(18.0) && py >= 18.0)
                || (ellipse(27.0) && py >= 27.0)
                || sides
            {
                rgba[(y * size + x) * 4 + 3] = 255;
            }
        }
    }
    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let status = MenuItem::with_id(
        app,
        "progress-status",
        "Sapienta · No task running",
        false,
        None::<&str>,
    )?;
    let detail = MenuItem::with_id(
        app,
        "progress-detail",
        "Start database setup in Sapienta",
        false,
        None::<&str>,
    )?;
    let timing = MenuItem::with_id(
        app,
        "progress-timing",
        "You can minimize the app while it works",
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "show-sapienta", "Open Sapienta", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &detail, &timing, &separator, &open])?;
    let builder = TrayIconBuilder::with_id("ingestion-progress")
        .menu(&menu)
        .icon(menu_bar_icon())
        .icon_as_template(true)
        .tooltip("Sapienta · No task running")
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "show-sapienta" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    let tray = builder.build(app)?;
    let app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let result = ingestion::active_ingestions(
                app.state::<AppStorage>(),
                app.state::<ingestion::IngestionState>(),
            );
            match result {
                Ok(runs) if !runs.is_empty() => {
                    let run = &runs[0];
                    let phase = match run.status.as_str() {
                        "scanning" => "Checking database",
                        "saving" => "Saving guide",
                        _ => "Preparing database",
                    };
                    let elapsed = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                        .saturating_sub(run.started_at);
                    let heading = format!("{} · {}%", phase, run.percent);
                    let remaining = if run.status == "scanning" {
                        run.total.saturating_sub(run.checked)
                    } else {
                        run.eligible.saturating_sub(run.succeeded)
                    };
                    let time = if run.status == "scanning" {
                        format!("{} of {} tables checked · {}m {}s", run.checked, run.total, elapsed / 60, elapsed % 60)
                    } else {
                        format!("{} selected · {} ready · {} remaining", run.eligible, run.succeeded, remaining)
                    };
                    let _ = status.set_text(&heading);
                    let _ = detail.set_text(
                        run.current
                            .as_deref()
                            .unwrap_or("Getting things ready…")
                            .chars()
                            .take(80)
                            .collect::<String>(),
                    );
                    let _ = timing.set_text(&time);
                    let _ = tray.set_tooltip(Some(format!("Sapienta · {heading}\n{time}")));
                }
                Ok(_) => {
                    let message = "Sapienta · No task running";
                    let _ = status.set_text(message);
                    let _ = detail.set_text("View scan results and saved guides in the app");
                    let _ = timing.set_text("No work is running in the background");
                    let _ = tray.set_tooltip(Some(message));
                    #[cfg(target_os = "macos")]
                    let _ = tray.set_title(None::<&str>);
                }
                Err(_) => {
                    let _ = status.set_text("Could not refresh progress · Open Sapienta");
                    let _ = detail.set_text("Open the app to check your task");
                    let _ = timing.set_text("Progress is temporarily unavailable");
                    #[cfg(target_os = "macos")]
                    let _ = tray.set_title(None::<&str>);
                    let _ = tray.set_tooltip(Some("Sapienta · Could not refresh progress"));
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    Ok(())
}
