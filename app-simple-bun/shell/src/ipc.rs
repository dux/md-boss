// The page's calls into the shell: `{id, method, params}` over `window.ipc.postMessage`,
// answered with `window.__mdbossReply(id, result, error)`. Events the shell raises go the
// other way as `window.__mdbossEvent(name, data)`.

use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};

use serde::Deserialize;
use serde_json::{json, Value};
use tao::window::Window;
use wry::WebView;

use crate::{
    menu::{self, MenuState},
    paths::Layout,
    protocol,
    server::Server,
    Shared,
};

pub struct Context<'a> {
    pub shared: &'a Shared,
    pub layout: &'a Layout,
    pub window: &'a Window,
    pub server: Option<&'a Arc<Mutex<Server>>>,
    pub menu: &'a mut MenuState,
    pub argv: &'a [String],
    pub cwd: &'a str,
    pub exit: &'a dyn Fn(),
}

#[derive(Deserialize)]
struct Call {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

pub fn dispatch(webview: &WebView, ctx: &mut Context, raw: &str) {
    let call: Call = match serde_json::from_str(raw) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("md-boss: bad ipc message ({e}): {raw}");
            return;
        }
    };
    match handle(ctx, &call.method, &call.params) {
        Ok(result) => reply(webview, call.id, result, None),
        Err(error) => reply(webview, call.id, Value::Null, Some(error)),
    }
}

fn handle(ctx: &mut Context, method: &str, params: &Value) -> Result<Value, String> {
    let arg = |i: usize| params.get(i).cloned().unwrap_or(Value::Null);
    let str_arg = |i: usize| {
        arg(i)
            .as_str()
            .map(String::from)
            .ok_or_else(|| format!("{method}: argument {i} must be a string"))
    };
    match method {
        "app.version" => Ok(json!(ctx.layout.version())),
        "app.exit" => {
            (ctx.exit)();
            Ok(Value::Null)
        }
        "app.holdClose" => {
            *ctx.shared.hold_close.lock().unwrap() = true;
            Ok(Value::Null)
        }
        "app.focus" => {
            ctx.window.set_focus();
            Ok(Value::Null)
        }
        "server.info" => Ok(ctx
            .server
            .map(|s| {
                let g = s.lock().unwrap();
                json!({ "port": g.port, "token": g.token })
            })
            .unwrap_or(Value::Null)),

        "shell.openURL" | "shell.openPath" => open::that_detached(str_arg(0)?)
            .map(|_| Value::Null)
            .map_err(|e| e.to_string()),
        "shell.reveal" => reveal(&str_arg(0)?),
        "shell.assetBase" => Ok(json!(protocol::asset_base())),

        "clipboard.readText" => Ok(arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map(Value::String)
            .unwrap_or(Value::Null)),
        "clipboard.writeText" => {
            let text = str_arg(0)?;
            arboard::Clipboard::new()
                .and_then(|mut c| c.set_text(text))
                .map(|_| Value::Null)
                .map_err(|e| e.to_string())
        }

        "dialog.openFolders" => {
            let mut dialog = rfd::FileDialog::new().set_title("Choose folders to show in the sidebar");
            if let Some(start) = arg(0).as_str() {
                dialog = dialog.set_directory(start);
            }
            let picked: Vec<String> = dialog
                .pick_folders()
                .unwrap_or_default()
                .iter()
                .map(|p| p.display().to_string())
                .collect();
            Ok(json!(picked))
        }
        "dialog.openFile" => {
            let mut dialog = rfd::FileDialog::new();
            if let Some(start) = arg(0).as_str() {
                dialog = dialog.set_directory(start);
            }
            Ok(dialog
                .pick_file()
                .map(|p| Value::String(p.display().to_string()))
                .unwrap_or(Value::Null))
        }

        "commands.allowAssetRoots" => {
            let roots: Vec<String> = serde_json::from_value(arg(0)).map_err(|e| e.to_string())?;
            let mut allowed = ctx.shared.asset_roots.lock().unwrap();
            for root in roots {
                let path = PathBuf::from(root);
                if !allowed.contains(&path) {
                    allowed.push(path);
                }
            }
            Ok(Value::Null)
        }

        "cli.launch" => Ok(json!([{ "paths": ctx.argv, "cwd": ctx.cwd }])),

        "menu.install" => {
            let models = serde_json::from_value(arg(0)).map_err(|e| format!("menu.install: {e}"))?;
            menu::install(ctx.menu, ctx.window, models)?;
            Ok(json!(true))
        }
        "menu.update" => {
            let patch = serde_json::from_value(arg(0)).map_err(|e| format!("menu.update: {e}"))?;
            menu::update(ctx.menu, patch);
            Ok(Value::Null)
        }

        _ => Err(format!("unknown method: {method}")),
    }
}

/// The file selected in Finder / Explorer / the file manager.
fn reveal(path: &str) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(format!("/select,{path}")).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("dbus-send")
        .args([
            "--session",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:file://{path}"))
        .arg("string:")
        .status();
    match status {
        Ok(s) if s.success() => Ok(Value::Null),
        _ => {
            // No file manager answered: the folder is the next best thing.
            let parent = PathBuf::from(path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
            open::that_detached(parent).map(|_| Value::Null).map_err(|e| e.to_string())
        }
    }
}

pub fn reply(webview: &WebView, id: u64, result: Value, error: Option<String>) {
    let js = format!(
        "window.__mdbossReply && window.__mdbossReply({id}, {}, {});",
        result,
        serde_json::to_string(&error).unwrap_or_else(|_| "null".into())
    );
    if let Err(e) = webview.evaluate_script(&js) {
        eprintln!("md-boss: reply failed: {e}");
    }
}

pub fn emit(webview: &WebView, name: &str, data: Value) {
    let js = format!("window.__mdbossEvent && window.__mdbossEvent({}, {});", json!(name), data);
    if let Err(e) = webview.evaluate_script(&js) {
        eprintln!("md-boss: event failed: {e}");
    }
}

/// Events raised off the main thread travel through the ipc channel in this wrapper.
pub fn event_envelope(name: &str, data: Value) -> String {
    json!({ "__event": name, "data": data }).to_string()
}

pub fn event_from_envelope(raw: &str) -> Option<(String, Value)> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let name = v.get("__event")?.as_str()?.to_string();
    Some((name, v.get("data").cloned().unwrap_or(Value::Null)))
}
