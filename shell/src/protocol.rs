// The two custom protocols: app:// serves the built frontend, previewfile:// serves images
// below the allowed roots to the preview page.

use std::{borrow::Cow, path::Path};

use wry::http::{header::CONTENT_TYPE, Request, Response};

use crate::Shared;

type Reply = Response<Cow<'static, [u8]>>;

/// Where the page starts: wry maps custom schemes to http://<scheme>.localhost on Windows.
pub fn app_start_url() -> &'static str {
    if cfg!(windows) {
        "http://app.localhost/"
    } else {
        "app://localhost/"
    }
}

/// The prefix the page builds image URLs with (`shell.assetBase`).
pub fn asset_base() -> &'static str {
    if cfg!(windows) {
        "http://previewfile.localhost/"
    } else {
        "previewfile://localhost/"
    }
}

pub fn app(dist: &Path, request: Request<Vec<u8>>) -> Reply {
    let path = request.uri().path();
    let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let file = dist.join(rel);
    // An SPA fallback is not wanted: a missing asset should be a 404 in the console.
    match std::fs::read(&file) {
        Ok(bytes) => ok(mime_for(rel), bytes),
        Err(_) => status(404, format!("not found: {rel}")),
    }
}

/// `previewfile://localhost/<encodeURIComponent(absolute path)>`. Served only when the
/// decoded path is below a root the page allowed, and never a directory.
pub fn preview_file(shared: &Shared, request: Request<Vec<u8>>) -> Reply {
    let encoded = request.uri().path().trim_start_matches('/');
    let decoded = percent_decode(encoded);
    let path = Path::new(&decoded);
    let allowed = shared
        .asset_roots
        .lock()
        .map(|roots| roots.iter().any(|root| path.starts_with(root)))
        .unwrap_or(false);
    if !allowed {
        return status(403, "not below an allowed root".to_string());
    }
    match std::fs::read(path) {
        Ok(bytes) if path.is_file() => ok(mime_for(&decoded), bytes),
        _ => status(404, "not found".to_string()),
    }
}

pub fn no_bun_page() -> String {
    r#"<!doctype html><meta charset="utf-8"><title>md-boss</title>
<body style="font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 40em; margin: 4em auto; padding: 0 1em">
<h1 style="font-size: 1.4em">md-boss needs bun</h1>
<p>This build runs its backend with the locally installed <code>bun</code>, and none was found on PATH,
in <code>~/.bun/bin</code>, <code>/opt/homebrew/bin</code> or <code>/usr/local/bin</code>.</p>
<p>Install it, then start md-boss again:</p>
<pre style="background: #eee; padding: 1em; overflow: auto">curl -fsSL https://bun.sh/install | bash</pre>
<p>On Windows: <code>powershell -c "irm bun.sh/install.ps1 | iex"</code>.
Or point <code>MDBOSS_BUN</code> at the binary.</p>
</body>"#
        .to_string()
}

fn ok(mime: &str, bytes: Vec<u8>) -> Reply {
    Response::builder()
        .header(CONTENT_TYPE, mime)
        .body(Cow::Owned(bytes))
        .unwrap()
}

fn status(code: u16, text: String) -> Reply {
    Response::builder()
        .status(code)
        .header(CONTENT_TYPE, "text/plain")
        .body(Cow::Owned(text.into_bytes()))
        .unwrap()
}

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

/// %XX decoding, UTF-8. Anything malformed is passed through as-is.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(hex) = s.get(i + 1..i + 3) {
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_sequences() {
        assert_eq!(percent_decode("%2FUsers%2Fdux%2Fa%20b.png"), "/Users/dux/a b.png");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%2"), "bad%2");
        assert_eq!(percent_decode("%C3%A9"), "é");
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(mime_for("a/b.PNG"), "image/png");
        assert_eq!(mime_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }
}
