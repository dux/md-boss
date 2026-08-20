// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod walk;

use std::path::PathBuf;
use std::sync::Arc;

/// `~/.config/md-boss` on every OS - plain text, meant to be edited by hand. `MD_BOSS_CONFIG`
/// points a dev build or a test at a scratch folder instead of the real one.
#[tauri::command]
fn config_dir() -> Result<String, String> {
    if let Ok(dir) = std::env::var("MD_BOSS_CONFIG") {
        return Ok(dir);
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or("no home directory")?;
    Ok(home
        .join(".config")
        .join("md-boss")
        .to_string_lossy()
        .into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Arc::new(walk::Scanner::default()))
        .invoke_handler(tauri::generate_handler![
            config_dir,
            walk::list_dir_cmd,
            walk::documents_under_cmd,
            walk::invalidate_scan
        ])
        .setup(|app| {
            // Debug builds only: the webview's console.error/warn land here too (main.ts
            // forwards them), so `tauri dev` shows what the page complains about.
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
