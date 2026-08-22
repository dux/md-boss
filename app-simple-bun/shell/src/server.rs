// The bun child: spawned with a free port and a token, watched, killed on exit.

use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    net::TcpListener,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};

use tao::event_loop::EventLoopProxy;

use crate::{paths, UserEvent};

pub struct Server {
    pub port: u16,
    pub token: String,
    child: Child,
    /// Set by `kill`, so the watcher thread does not report a death we caused.
    killed: bool,
}

#[derive(Debug)]
pub enum SpawnError {
    NoBun,
    NoServer(std::path::PathBuf),
    Io(std::io::Error),
}

impl std::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpawnError::NoBun => write!(f, "bun not found - install it: curl -fsSL https://bun.sh/install | bash"),
            SpawnError::NoServer(p) => write!(f, "server not found at {}", p.display()),
            SpawnError::Io(e) => write!(f, "could not start bun: {e}"),
        }
    }
}

impl Server {
    pub fn spawn(layout: &paths::Layout) -> Result<Server, SpawnError> {
        let bun = paths::find_bun().ok_or(SpawnError::NoBun)?;
        if !layout.server_main.is_file() {
            return Err(SpawnError::NoServer(layout.server_main.clone()));
        }
        let port = free_port().map_err(SpawnError::Io)?;
        let token = random_token();
        let child = Command::new(bun)
            .arg(&layout.server_main)
            .arg("--port")
            .arg(port.to_string())
            .arg("--token")
            .arg(&token)
            .arg("--parent")
            .arg(std::process::id().to_string())
            .current_dir(&layout.app_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(SpawnError::Io)?;
        Ok(Server { port, token, child, killed: false })
    }

    pub fn kill(&mut self) {
        self.killed = true;
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Polls the child and reports its exit to the event loop. Polling rather than `wait()`,
/// so `kill` can take the lock in between.
pub fn watch_exit(server: Arc<Mutex<Server>>, proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(300));
        let mut guard = match server.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if guard.killed {
            return;
        }
        match guard.child.try_wait() {
            Ok(Some(status)) => {
                let _ = proxy.send_event(UserEvent::ServerExited(status.code()));
                return;
            }
            Ok(None) => {}
            Err(_) => return,
        }
    });
}

fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Not a secret in any serious sense - the socket is loopback-only and the token keeps a
/// stray local client from driving the server by accident. No crate for that.
fn random_token() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u32(std::process::id());
    let a = h.finish();
    let mut h2 = RandomState::new().build_hasher();
    h2.write_u64(a);
    format!("{a:016x}{:016x}", h2.finish())
}
