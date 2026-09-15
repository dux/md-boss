// Opening a document from the file manager.
//
// A Windows or Linux launcher passes the file as an argument, so `argv` already carries it.
// macOS does not: markdown is a declared document type, so the file arrives as an Apple
// Event, which tao turns into `Event::Opened` rather than into arguments. The paths land in
// one queue. Asked before the page is listening they come out of `cli.launch` beside the
// launch's own arguments; later they are pushed as `cli-open`, the event the page already
// listens on for a second launch.

use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::sync::OnceLock;

use tao::event_loop::EventLoopProxy;

use crate::UserEvent;

#[derive(Default)]
struct Pending {
    /// True once the page has asked for `cli.launch`; before that an open waits in `queued`.
    ready: bool,
    queued: Vec<String>,
}

static PENDING: Mutex<Pending> = Mutex::new(Pending { ready: false, queued: Vec::new() });

#[cfg(target_os = "macos")]
static PROXY: OnceLock<EventLoopProxy<UserEvent>> = OnceLock::new();

/// Install the open handler. Called once, before the event loop runs.
pub fn install(proxy: EventLoopProxy<UserEvent>) {
    #[cfg(target_os = "macos")]
    {
        let _ = PROXY.set(proxy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = proxy;
}

/// The paths opened before the page asked; also marks the page live, so a later open becomes
/// a `cli-open` event rather than another queued entry.
pub fn take_launch() -> Vec<String> {
    let mut pending = PENDING.lock().unwrap();
    pending.ready = true;
    std::mem::take(&mut pending.queued)
}

/// Records an open. `None` before `take_launch` - it is queued for the launch; `Some` after,
/// so the caller pushes it to the page. Only macOS delivers opens; elsewhere this stays dark.
#[cfg(target_os = "macos")]
fn record(paths: Vec<String>) -> Option<Vec<String>> {
    let mut pending = PENDING.lock().unwrap();
    if pending.ready {
        return Some(paths);
    }
    pending.queued.extend(paths);
    None
}

/// Documents the OS asked us to open, from tao's `Event::Opened`.
#[cfg(target_os = "macos")]
pub fn deliver(paths: Vec<String>) {
    let Some(paths) = record(paths) else { return };
    if let Some(proxy) = PROXY.get() {
        let data = serde_json::json!({ "paths": paths, "cwd": "" });
        let _ = proxy.send_event(UserEvent::Ipc(crate::ipc::event_envelope("cli-open", data)));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn an_open_before_the_page_asks_joins_the_launch() {
        // The queue is process-global; this is the only test that touches it.
        assert!(record(vec!["/a.md".into()]).is_none());
        assert_eq!(take_launch(), vec!["/a.md".to_string()]);
        // After the page asked, the next open is handed straight to it.
        assert_eq!(record(vec!["/b.md".into()]), Some(vec!["/b.md".to_string()]));
    }
}
