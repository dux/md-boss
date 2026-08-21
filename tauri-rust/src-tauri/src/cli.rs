//! `md-boss <paths...>` - what the command line asks the window to do.
//!
//! The arguments are parsed by tauri-plugin-cli's clap config (`plugins.cli` in
//! tauri.conf.json): the first launch reads its own, and a second launch hands its argv and
//! cwd to the running process through tauri-plugin-single-instance, where the same parser
//! runs over them - so the two launches cannot disagree about what is a flag and what is a
//! path. Relative paths are resolved by the page against `cwd` (src/models/cli.ts), which
//! is why bin/md-boss execs the binary rather than going through `open -a`.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_cli::{CliExt, Matches};

/// A second launch arrives on this event, with the same payload `launch_cmd` answers.
pub const OPEN_EVENT: &str = "cli-open";

/// The positional paths as typed, and the directory they were typed in.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct OpenRequest {
    pub paths: Vec<String>,
    pub cwd: String,
}

/// What a parse asks for. `Help` carries clap's rendered text; `Version` is printed from
/// the package info by the caller.
#[derive(Debug, PartialEq, Eq)]
pub enum Launch {
    Help(String),
    Version,
    Open(Vec<String>),
}

pub fn launch(matches: &Matches) -> Launch {
    if let Some(help) = matches.args.get("help") {
        if let Value::String(text) = &help.value {
            return Launch::Help(text.clone());
        }
    }
    if matches.args.contains_key("version") {
        return Launch::Version;
    }
    let paths = match matches.args.get("paths").map(|arg| &arg.value) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    Launch::Open(paths)
}

/// The first launch's request, asked once by the page at boot. Arguments that do not parse
/// (an unknown flag, the `-psn_…` an older macOS passes on a Dock launch) count as none,
/// since a launch is not the place to refuse.
pub fn launch_request<R: Runtime>(app: &AppHandle<R>) -> OpenRequest {
    let paths = match app.cli().matches().map(|m| launch(&m)) {
        Ok(Launch::Open(paths)) => paths,
        _ => Vec::new(),
    };
    OpenRequest { paths, cwd: current_dir() }
}

fn current_dir() -> String {
    std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub fn launch_cmd(request: tauri::State<'_, OpenRequest>) -> OpenRequest {
    request.inner().clone()
}

/// The single-instance callback: a second `md-boss …` has exited and left its arguments
/// here. The window comes forward either way - `md-boss` with nothing after it is how you
/// ask for the app - and the page gets the paths the same way it got the first launch's.
pub fn forward<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    let paths = match app.cli().matches_from(argv).map(|m| launch(&m)) {
        Ok(Launch::Open(paths)) => paths,
        _ => Vec::new(),
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(err) = app.emit(OPEN_EVENT, OpenRequest { paths, cwd }) {
        log::warn!("cli: could not forward the open request: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri_plugin_cli::ArgData;

    fn matches(args: &[(&str, Value)]) -> Matches {
        let mut m = Matches::default();
        for (name, value) in args {
            // ArgData is non_exhaustive, so it is filled rather than built.
            let mut data = ArgData::default();
            data.value = value.clone();
            m.args.insert(name.to_string(), data);
        }
        m
    }

    #[test]
    fn paths_come_out_in_order_and_as_typed() {
        let m = matches(&[("paths", json!([".", "doc/API.md", "~/notes"]))]);
        assert_eq!(
            launch(&m),
            Launch::Open(vec![".".into(), "doc/API.md".into(), "~/notes".into()])
        );
    }

    #[test]
    fn no_paths_is_an_empty_open() {
        assert_eq!(launch(&matches(&[("paths", Value::Null)])), Launch::Open(vec![]));
        assert_eq!(launch(&matches(&[])), Launch::Open(vec![]));
    }

    #[test]
    fn help_and_version_win_over_paths() {
        let m = matches(&[("help", json!("Usage: md-boss [PATHS]...")), ("paths", json!(["."]))]);
        assert_eq!(launch(&m), Launch::Help("Usage: md-boss [PATHS]...".into()));
        let m = matches(&[("version", Value::Null)]);
        assert_eq!(launch(&m), Launch::Version);
    }
}
