// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;
mod notes;
mod search;
mod walk;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

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

/// The OS trash rather than a delete: the sidebar's Cmd-Backspace has to be recoverable, and
/// only the Finder / Explorer / file manager can put a file back. Off the main thread - the
/// Linux backend copies across filesystems when it must, and the sidebar should not wait.
#[tauri::command(async)]
fn trash_cmd(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// The preview loads local images over the asset protocol, whose scope starts empty
/// (tauri.conf.json) and grows to the sidebar's roots as the frontend lists them - so an
/// image next to a document is served and nothing outside the listed folders is. A root
/// that leaves the sidebar stays allowed: the scope cannot shrink, and what it guards is
/// the preview's reach, not a secret.
#[tauri::command]
fn allow_asset_roots_cmd(app: tauri::AppHandle, roots: Vec<String>) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    for root in roots {
        scope
            .allow_directory(&root, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(walk::Scanner::default()))
        .manage(Arc::new(search::Generation::default()))
        .invoke_handler(tauri::generate_handler![
            config_dir,
            trash_cmd,
            allow_asset_roots_cmd,
            walk::list_dir_cmd,
            walk::documents_under_cmd,
            walk::invalidate_scan,
            notes::read_notes_cmd,
            notes::write_notes_cmd,
            search::search_cmd,
            links::rewrite_links_cmd
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
