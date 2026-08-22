// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod links;
mod notes;
mod search;
mod walk;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_cli::CliExt;
use tauri_plugin_window_state::StateFlags;

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

/// Quit, asked by the page once it has settled unsaved edits (Manager.quit). The menu's Quit
/// is a plain item routed there rather than the predefined one: on macOS that one is
/// `terminate:` and on Windows `PostQuitMessage`, neither of which asks anybody first.
#[tauri::command]
fn quit_cmd(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    // Single-instance first: a second launch is answered (cli::forward) and exits inside
    // the build, before any other plugin runs or a window exists.
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(cli::forward))
        .plugin(tauri_plugin_cli::init())
        // Frame persistence, the WindowAccessor's job in the Swift app: position and size
        // back on the next launch, maximized too. Not fullscreen or visibility - a window
        // restored into a space-filling fullscreen is not how anyone wants to arrive.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // Self-update over plugins.updater in tauri.conf.json (the release's latest.json and
        // the public key); the process plugin is the relaunch once a package is in place.
        // The page decides when to check and asks before restarting (src/models/updater.ts).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(walk::Scanner::default()))
        .manage(Arc::new(search::Generation::default()))
        .invoke_handler(tauri::generate_handler![
            config_dir,
            trash_cmd,
            quit_cmd,
            allow_asset_roots_cmd,
            cli::launch_cmd,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // `--help` and `--version` are answered on the terminal and never open a window - the
    // window is created by run(), so this is the last moment before it shows.
    match app.cli().matches().map(|m| cli::launch(&m)) {
        Ok(cli::Launch::Help(text)) => {
            println!("{text}");
            return;
        }
        Ok(cli::Launch::Version) => {
            let info = app.package_info();
            println!("{} {}", info.name, info.version);
            return;
        }
        _ => {}
    }
    app.manage(cli::inbox(cli::launch_request(app.handle())));

    // macOS hands Finder's double-click, Open With and a drop on the Dock icon to the running
    // process as URLs rather than argv - on Windows and Linux an association launches
    // `md-boss <file>` and the cli plugin already reads it. The first of these can arrive
    // before the page is up; the inbox keeps it.
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            cli::opened(app, urls);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
