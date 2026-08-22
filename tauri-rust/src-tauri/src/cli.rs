//! `md-boss <paths...>` - what the command line, Finder and the Dock ask the window to do.
//!
//! The arguments are parsed by tauri-plugin-cli's clap config (`plugins.cli` in
//! tauri.conf.json): the first launch reads its own, and a second launch hands its argv and
//! cwd to the running process through tauri-plugin-single-instance, where the same parser
//! runs over them - so the two launches cannot disagree about what is a flag and what is a
//! path. Relative paths are resolved by the page against `cwd` (src/models/cli.ts), which
//! is why bin/md-boss execs the binary rather than going through `open -a`. On macOS a
//! double-click in Finder or a drop on the Dock icon arrives as `RunEvent::Opened` instead
//! of argv (main.rs) and takes the same road in.
//!
//! Every request goes through the `Inbox`: what arrives before the page has asked for its
//! launch is kept and answered by `launch_cmd` in one go, what arrives after is emitted -
//! so a file opened by Finder while the webview is still loading is not lost, and the page
//! never sees the same request twice.

use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_cli::{CliExt, Matches};

/// A request that arrived after the page asked `launch_cmd` is emitted on this event, with
/// one `OpenRequest` as payload.
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

/// The requests waiting for the page, and whether it has asked for them yet. Managed state
/// behind a mutex: `Opened` and the single-instance callback land on the main thread, the
/// command on Tauri's pool.
#[derive(Debug, Default)]
pub struct Inbox {
    pending: Vec<OpenRequest>,
    listening: bool,
}

impl Inbox {
    /// A request arrived. Back comes the request to emit, or nothing when it was kept for
    /// `take` because the page has not asked yet.
    pub fn push(&mut self, request: OpenRequest) -> Option<OpenRequest> {
        if self.listening {
            Some(request)
        } else {
            self.pending.push(request);
            None
        }
    }

    /// The page's one ask: everything kept so far, in arrival order; from here on `push`
    /// hands requests back for emitting.
    pub fn take(&mut self) -> Vec<OpenRequest> {
        self.listening = true;
        std::mem::take(&mut self.pending)
    }
}

/// The first launch's request, read before the window exists. Arguments that do not parse
/// (an unknown flag, the `-psn_…` an older macOS passes on a Dock launch) count as none,
/// since a launch is not the place to refuse.
pub fn launch_request<R: Runtime>(app: &AppHandle<R>) -> OpenRequest {
    let paths = match app.cli().matches().map(|m| launch(&m)) {
        Ok(Launch::Open(paths)) => paths,
        _ => Vec::new(),
    };
    OpenRequest { paths, cwd: current_dir() }
}

/// The inbox as managed state, seeded with the first launch's request. An empty one is kept
/// too: the page tells a launch with no paths (restore the session) from one that had some.
pub fn inbox(first: OpenRequest) -> Mutex<Inbox> {
    let mut inbox = Inbox::default();
    inbox.pending.push(first);
    Mutex::new(inbox)
}

fn current_dir() -> String {
    std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Every request that arrived before the page asked, the first launch's first.
#[tauri::command]
pub fn launch_cmd(inbox: tauri::State<'_, Mutex<Inbox>>) -> Vec<OpenRequest> {
    inbox.lock().expect("cli inbox poisoned").take()
}

/// The single-instance callback: a second `md-boss …` has exited and left its arguments
/// here. The window comes forward either way - `md-boss` with nothing after it is how you
/// ask for the app - and the page gets the paths the same way it got the first launch's.
pub fn forward<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    let paths = match app.cli().matches_from(argv).map(|m| launch(&m)) {
        Ok(Launch::Open(paths)) => paths,
        _ => Vec::new(),
    };
    deliver(app, OpenRequest { paths, cwd });
}

/// macOS: files and folders from Finder (double-click, Open With) and the Dock icon. They
/// come as `file:` URLs, absolute already, so the cwd carries nothing the page needs.
pub fn opened<R: Runtime>(app: &AppHandle<R>, urls: Vec<tauri::Url>) {
    let paths = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return;
    }
    deliver(app, OpenRequest { paths, cwd: current_dir() });
}

fn deliver<R: Runtime>(app: &AppHandle<R>, request: OpenRequest) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let emit = match app.try_state::<Mutex<Inbox>>() {
        Some(inbox) => inbox.lock().expect("cli inbox poisoned").push(request),
        // Before the inbox is managed (main.rs, right after build) nothing can ask yet, and
        // nothing can arrive either: the window does not exist.
        None => Some(request),
    };
    if let Some(request) = emit {
        if let Err(err) = app.emit(OPEN_EVENT, request) {
            log::warn!("cli: could not forward the open request: {err}");
        }
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

    fn request(paths: &[&str], cwd: &str) -> OpenRequest {
        OpenRequest { paths: paths.iter().map(|p| p.to_string()).collect(), cwd: cwd.into() }
    }

    #[test]
    fn the_inbox_keeps_what_arrives_before_the_page_asks_and_hands_back_the_rest() {
        let mut inbox = Inbox::default();
        assert_eq!(inbox.push(request(&["a.md"], "/w")), None);
        assert_eq!(inbox.push(request(&["/tmp/b.md"], "/")), None);
        assert_eq!(inbox.take(), vec![request(&["a.md"], "/w"), request(&["/tmp/b.md"], "/")]);
        // Asked: from now on nothing is kept, and asking again finds nothing.
        assert_eq!(inbox.push(request(&["c.md"], "/w")), Some(request(&["c.md"], "/w")));
        assert_eq!(inbox.take(), vec![]);
    }

    #[test]
    fn the_first_launch_is_answered_even_with_no_paths() {
        let mut inbox = inbox(request(&[], "/w")).into_inner().unwrap();
        assert_eq!(inbox.take(), vec![request(&[], "/w")]);
    }

    #[test]
    fn help_and_version_win_over_paths() {
        let m = matches(&[("help", json!("Usage: md-boss [PATHS]...")), ("paths", json!(["."]))]);
        assert_eq!(launch(&m), Launch::Help("Usage: md-boss [PATHS]...".into()));
        let m = matches(&[("version", Value::Null)]);
        assert_eq!(launch(&m), Launch::Version);
    }
}
