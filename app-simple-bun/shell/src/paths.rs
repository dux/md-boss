// Where the payload (server/, dist/, version.txt) lives, and where bun is.

use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Layout {
    /// The payload root: `server/` and `dist/` are below it.
    pub app_dir: PathBuf,
    pub dist: PathBuf,
    pub server_main: PathBuf,
    /// Set by `hammer dev`: the page comes from vite instead of `dist/`.
    pub dev_url: Option<String>,
}

impl Layout {
    /// MDBOSS_APP_DIR wins (dev), then the updated payload under ~/.config/md-boss/app/current,
    /// then the copy inside the bundle (macOS: Contents/Resources), then next to the binary.
    pub fn resolve() -> Layout {
        let app_dir = std::env::var("MDBOSS_APP_DIR")
            .map(PathBuf::from)
            .ok()
            .filter(|p| has_payload(p))
            .or_else(|| {
                home_dir()
                    .map(|h| h.join(".config").join("md-boss").join("app").join("current"))
                    .filter(|p| has_payload(p))
            })
            .or_else(|| {
                let exe = std::env::current_exe().ok()?;
                let dir = exe.parent()?.to_path_buf();
                #[cfg(target_os = "macos")]
                {
                    let res = dir.join("..").join("Resources");
                    if has_payload(&res) {
                        return res.canonicalize().ok();
                    }
                }
                Some(dir)
            })
            .unwrap_or_else(|| PathBuf::from("."));
        Layout {
            dist: app_dir.join("dist"),
            server_main: app_dir.join("server").join("main.ts"),
            dev_url: std::env::var("MDBOSS_DEV_URL").ok().filter(|s| !s.is_empty()),
            app_dir,
        }
    }

    /// The payload's version, the shell's own when there is no payload file.
    pub fn version(&self) -> String {
        std::fs::read_to_string(self.app_dir.join("version.txt"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
    }
}

fn has_payload(dir: &Path) -> bool {
    dir.join("server").join("main.ts").is_file()
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// `bun`, wherever it is. A bundle launched from Finder or a .desktop file gets the login
/// shell's PATH only on a good day, so the usual install locations are tried by hand.
pub fn find_bun() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("MDBOSS_BUN").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let exe = if cfg!(windows) { "bun.exe" } else { "bun" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        candidates.push(home.join(".bun").join("bin").join(exe));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(exe));
    candidates.push(PathBuf::from("/usr/local/bin").join(exe));
    candidates.into_iter().find(|p| p.is_file())
}
