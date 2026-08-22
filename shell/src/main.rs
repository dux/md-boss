// Rust links a console subsystem binary by default, which on Windows means a black
// console window behind the app every time it is launched from Explorer, the Start Menu
// or the installer's shortcut. Debug builds keep it - `hammer dev` prints there.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The md-boss shell: one window, the platform webview, and a bun process behind it.
//
// Everything that needs a window or the OS is answered here - menus, dialogs, clipboard,
// opening things, the drop target, the preview's image protocol. Everything else (files,
// search, notes, watching) is the bun server in `server/`, which the page talks to directly
// over a localhost WebSocket. This binary is a launcher; it is meant to change rarely.

mod ipc;
mod menu;
mod paths;
mod protocol;
mod server;

use std::sync::{Arc, Mutex};

use muda::MenuEvent;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{DragDropEvent, WebViewBuilder};

/// Messages from the webview, the menu bar and the server thread into the event loop.
pub enum UserEvent {
    Ipc(String),
    Menu(String),
    ServerExited(Option<i32>),
}

/// Shared state the ipc handlers and the protocols read.
pub struct Shared {
    /// Folders the previewfile:// protocol may serve from (`commands.allowAssetRoots`).
    pub asset_roots: Mutex<Vec<std::path::PathBuf>>,
    /// The page asked to decide the close itself (`app.holdClose`); until then the close
    /// button exits, so a page that never loaded cannot wedge the window.
    pub hold_close: Mutex<bool>,
}

fn main() -> wry::Result<()> {
    let layout = paths::Layout::resolve();
    // Finder launches used to add -psn_…; flags are answered on the terminal.
    let argv: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with("-psn")).collect();
    if argv.iter().any(|a| a == "--version" || a == "-V") {
        println!("md-boss {}", layout.version());
        return Ok(());
    }
    if argv.iter().any(|a| a == "--help" || a == "-h") {
        println!("usage: md-boss [path ...]\n  md-boss .        add the current folder to the sidebar\n  md-boss file.md  open the file");
        return Ok(());
    }
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("md-boss")
        .with_inner_size(LogicalSize::new(1200.0, 800.0))
        .build(&event_loop)
        .expect("window");

    let shared = Arc::new(Shared {
        asset_roots: Mutex::new(Vec::new()),
        hold_close: Mutex::new(false),
    });

    let mut menu_state = menu::MenuState::default();
    if let Err(e) = menu::install_default(&mut menu_state, &window) {
        eprintln!("md-boss: default menu: {e}");
    }
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let _ = menu_proxy.send_event(UserEvent::Menu(event.id().0.clone()));
    }));

    // The server first: the page's init script needs its port.
    let server = match server::Server::spawn(&layout) {
        Ok(s) => Some(Arc::new(Mutex::new(s))),
        Err(e) => {
            eprintln!("md-boss: {e}");
            None
        }
    };
    if let Some(s) = &server {
        server::watch_exit(Arc::clone(s), proxy.clone());
    }

    let boot = serde_json::json!({
        "port": server.as_ref().map(|s| s.lock().unwrap().port),
        "token": server.as_ref().map(|s| s.lock().unwrap().token.clone()),
        "platform": paths::platform(),
        "version": layout.version(),
        "argv": argv,
        "cwd": cwd,
        "devUrl": layout.dev_url,
    });
    let init = format!("window.__MDBOSS = {boot};");

    let ipc_proxy = proxy.clone();
    let drop_proxy = proxy.clone();
    // wry gives CSS pixels on macOS and GTK and device pixels on WebView2; divided where
    // it has to be, so the page sees one coordinate system.
    let scale = if cfg!(windows) { window.scale_factor() } else { 1.0 };
    let dist = layout.dist.clone();
    let shared_for_protocol = Arc::clone(&shared);

    let mut builder = WebViewBuilder::new()
        .with_initialization_script(&init)
        .with_devtools(true)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.body().clone()));
        })
        .with_custom_protocol("app".into(), move |_id, request| protocol::app(&dist, request))
        .with_custom_protocol("previewfile".into(), move |_id, request| {
            protocol::preview_file(&shared_for_protocol, request)
        })
        // OS drags are the page's `onFileDrag`; returning true keeps WebKit from
        // navigating to the dropped file, which is what it does by default.
        .with_drag_drop_handler(move |event: DragDropEvent| {
            let (kind, paths, position) = match event {
                DragDropEvent::Enter { paths, position } => ("enter", paths, Some(position)),
                DragDropEvent::Over { position } => ("over", Vec::new(), Some(position)),
                DragDropEvent::Drop { paths, position } => ("drop", paths, Some(position)),
                DragDropEvent::Leave => ("leave", Vec::new(), None),
                _ => return false,
            };
            let (x, y) = position
                .map(|(x, y)| (x as f64 / scale, y as f64 / scale))
                .unwrap_or((0.0, 0.0));
            let data = serde_json::json!({ "kind": kind, "paths": paths, "x": x, "y": y });
            let _ = drop_proxy.send_event(UserEvent::Ipc(ipc::event_envelope("file-drag", data)));
            true
        });

    builder = match (&server, &layout.dev_url) {
        (None, _) => builder.with_html(protocol::no_bun_page()),
        (Some(_), Some(url)) => builder.with_url(url),
        (Some(_), None) => builder.with_url(protocol::app_start_url()),
    };

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let webview = builder.build(&window)?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window.default_vbox().unwrap();
        builder.build_gtk(vbox)?
    };

    let exit = {
        let server = server.clone();
        move || {
            if let Some(s) = &server {
                s.lock().unwrap().kill();
            }
            std::process::exit(0);
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if *shared.hold_close.lock().unwrap() {
                    ipc::emit(&webview, "close-requested", serde_json::Value::Null);
                } else {
                    exit();
                }
            }
            Event::UserEvent(UserEvent::Menu(id)) => {
                ipc::emit(&webview, "menu", serde_json::json!({ "id": id }));
            }
            Event::UserEvent(UserEvent::Ipc(raw)) => {
                // Events the shell raised on its own threads come through the same channel,
                // as an envelope the dispatcher recognises and forwards to the page.
                if let Some((name, data)) = ipc::event_from_envelope(&raw) {
                    ipc::emit(&webview, &name, data);
                    return;
                }
                let mut ctx = ipc::Context {
                    shared: &shared,
                    layout: &layout,
                    window: &window,
                    server: server.as_ref(),
                    menu: &mut menu_state,
                    argv: &argv,
                    cwd: &cwd,
                    exit: &exit,
                };
                ipc::dispatch(&webview, &mut ctx, &raw);
            }
            Event::UserEvent(UserEvent::ServerExited(code)) => {
                eprintln!("md-boss: server exited ({code:?}), restarting");
                if let Some(s) = &server {
                    let mut guard = s.lock().unwrap();
                    match server::Server::spawn(&layout) {
                        Ok(fresh) => {
                            *guard = fresh;
                            let data = serde_json::json!({ "port": guard.port, "token": guard.token });
                            drop(guard);
                            server::watch_exit(Arc::clone(s), proxy.clone());
                            ipc::emit(&webview, "server-restarted", data);
                        }
                        Err(e) => {
                            eprintln!("md-boss: {e}");
                            ipc::emit(&webview, "server-lost", serde_json::json!({ "error": e.to_string() }));
                        }
                    }
                }
            }
            _ => {}
        }
    });
}
