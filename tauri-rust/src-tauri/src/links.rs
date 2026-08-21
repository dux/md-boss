//! Inline links as text, and the rewrite pass that follows a move. The port of
//! MarkdownScan.swift, MarkdownLinks.swift and FileMove.plan: fences are line state, a code
//! span closes only on a backtick run of its own length, link text nests, a destination
//! carries balanced parentheses - and every document under the root is read once, its
//! destinations resolved by path arithmetic, and written back only when one of them pointed
//! at a file that moved. Reading a project's worth of files is the heavy part, which is why
//! this lives here rather than in the webview; `src/models/markdownLinks.ts` keeps the same
//! scanner for the in-memory twin and the editor's own link snippets.
//!
//! Indices are byte offsets. Every marker is ASCII, and every step over a non-marker moves
//! by a whole character, so a slice never lands inside a multi-byte sequence.
//!
//! Deliberately not handled: reference definitions (`[id]: ./x.md`) and four-space indented
//! code - inside a list `    [a](b.md)` is an ordinary paragraph line, and skipping real
//! links is the worse error.

use crate::walk;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::Path;

/// One file that has moved. A list rather than a pair, because moving a folder is the same
/// algorithm with one entry per document underneath it.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Move {
    pub old: String,
    #[serde(rename = "new")]
    pub new_path: String,
}

/// The destination token of one inline link, and where it sits in the source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Destination {
    /// As written, angle brackets included - link text and any title sit outside it.
    pub start: usize,
    pub end: usize,
    /// Inside the angle brackets, when there were any.
    pub raw: String,
    pub is_image: bool,
}

// MARK: - Characters

/// Bytes of the character starting at `i`; 1 past the end, so a step there is harmless.
fn char_len(text: &str, i: usize) -> usize {
    match text.as_bytes().get(i) {
        None => 1,
        Some(&b) if b < 0x80 => 1,
        Some(&b) if b >= 0xF0 => 4,
        Some(&b) if b >= 0xE0 => 3,
        Some(_) => 2,
    }
}

/// One whole character on, never past the end. `i` must be a character boundary.
fn step(text: &str, i: usize) -> usize {
    (i + char_len(text, i)).min(text.len())
}

/// Past a backslash at `i` and the character it escapes.
fn skip_escape(text: &str, i: usize) -> usize {
    if i + 1 >= text.len() {
        text.len()
    } else {
        step(text, i + 1)
    }
}

fn char_at(text: &str, i: usize) -> Option<char> {
    text[i..].chars().next()
}

fn is_space_at(text: &str, i: usize) -> bool {
    char_at(text, i).is_some_and(char::is_whitespace)
}

// MARK: - Fences and code spans

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fence {
    marker: u8,
    length: usize,
}

/// Up to three leading spaces, then a run of at least three backticks or tildes.
pub fn opens_fence(line: &str) -> Option<Fence> {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i] == b' ' {
        i += 1;
    }
    if i > 3 {
        return None;
    }
    let marker = *b.get(i)?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let mut length = 0;
    while b.get(i + length) == Some(&marker) {
        length += 1;
    }
    (length >= 3).then_some(Fence { marker, length })
}

/// A closer matches the opener's character, runs at least as long, and carries nothing but
/// whitespace after it.
pub fn closes_fence(line: &str, fence: Fence) -> bool {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() && b[i] == b' ' {
        i += 1;
    }
    if i > 3 {
        return false;
    }
    let mut run = 0;
    while b.get(i + run) == Some(&fence.marker) {
        run += 1;
    }
    run >= fence.length && line[i + run..].chars().all(char::is_whitespace)
}

/// A code span closes on a backtick run of exactly the opening run's length. An unmatched
/// run is literal text, so scanning resumes right after it. Returns the index to resume at.
pub fn skipping_code_span(text: &str, index: usize) -> usize {
    let b = text.as_bytes();
    let mut scan = index;
    let mut opening = 0;
    while scan < b.len() && b[scan] == b'`' {
        opening += 1;
        scan += 1;
    }
    let mut search = scan;
    while search < b.len() {
        if b[search] != b'`' {
            search = step(text, search);
            continue;
        }
        let mut end = search;
        let mut run = 0;
        while end < b.len() && b[end] == b'`' {
            run += 1;
            end += 1;
        }
        if run == opening {
            return end;
        }
        search = end;
    }
    scan
}

// MARK: - Brackets and destinations

/// The `]` closing the `[` at `open`, honouring nesting, escapes and code spans.
pub fn matching_bracket(text: &str, open: usize) -> Option<usize> {
    let b = text.as_bytes();
    let mut depth = 1;
    let mut index = open + 1;
    while index < b.len() {
        match b[index] {
            b'\\' => {
                index = skip_escape(text, index);
                continue;
            }
            b'`' => {
                index = skipping_code_span(text, index);
                continue;
            }
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
        index = step(text, index);
    }
    None
}

struct Parsed {
    start: usize,
    end: usize,
    raw: String,
    /// Index just past the closing parenthesis.
    after: usize,
}

/// Parses `(dest)` or `(dest "title")` starting at the opening parenthesis.
fn parsing_destination(text: &str, paren: usize) -> Option<Parsed> {
    let b = text.as_bytes();
    let mut index = skipping_spaces(text, paren + 1);
    if index >= b.len() {
        return None;
    }

    let start = index;
    let end;
    let raw;
    if b[index] == b'<' {
        let mut scan = index + 1;
        while scan < b.len() && b[scan] != b'>' {
            scan = if b[scan] == b'\\' { skip_escape(text, scan) } else { step(text, scan) };
        }
        if scan >= b.len() {
            return None;
        }
        raw = text[start + 1..scan].to_string();
        index = scan + 1;
        end = index;
    } else {
        let mut depth = 0;
        while index < b.len() {
            let ch = b[index];
            if ch == b'\\' {
                index = skip_escape(text, index);
                continue;
            }
            if is_space_at(text, index) {
                break;
            }
            if ch == b'(' {
                depth += 1;
            }
            if ch == b')' {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            index = step(text, index);
        }
        raw = text[start..index].to_string();
        end = index;
    }

    index = skipping_spaces(text, index);
    index = skipping_title(text, index);
    index = skipping_spaces(text, index);

    if index >= b.len() || b[index] != b')' {
        return None;
    }
    Some(Parsed { start, end, raw, after: index + 1 })
}

fn skipping_spaces(text: &str, index: usize) -> usize {
    let mut scan = index;
    while scan < text.len() && is_space_at(text, scan) {
        scan = step(text, scan);
    }
    scan
}

/// Past a `"title"`, `'title'` or `(title)` if one starts at `index`, else `index`.
fn skipping_title(text: &str, index: usize) -> usize {
    let b = text.as_bytes();
    let closer = match b.get(index) {
        Some(b'"') => b'"',
        Some(b'\'') => b'\'',
        Some(b'(') => b')',
        _ => return index,
    };
    let mut scan = index + 1;
    while scan < b.len() && b[scan] != closer {
        scan = if b[scan] == b'\\' { skip_escape(text, scan) } else { step(text, scan) };
    }
    if scan < b.len() {
        scan + 1
    } else {
        index
    }
}

// MARK: - Scanning

/// Every inline link and image destination in `text`, in source order. Fenced blocks are
/// skipped whole.
pub fn destinations(text: &str) -> Vec<Destination> {
    let b = text.as_bytes();
    let len = b.len();
    let mut found = Vec::new();
    let mut fence: Option<Fence> = None;
    let mut index = 0;
    let mut at_line_start = true;

    while index < len {
        if at_line_start {
            let end = text[index..].find('\n').map_or(len, |n| index + n);
            let line = &text[index..end];
            let next = if end == len { len } else { end + 1 };

            if let Some(open) = fence {
                if closes_fence(line, open) {
                    fence = None;
                }
                index = next;
                continue;
            }
            if let Some(opened) = opens_fence(line) {
                fence = Some(opened);
                index = next;
                continue;
            }
        }

        let ch = b[index];
        at_line_start = ch == b'\n';

        match ch {
            b'\\' => index = skip_escape(text, index),
            b'`' => index = skipping_code_span(text, index),
            b'[' | b'!' => {
                let open = if ch == b'!' { index + 1 } else { index };
                if open >= len || b[open] != b'[' {
                    index += 1;
                    continue;
                }
                index = scanning_link(text, open, ch == b'!', &mut found);
            }
            _ => index = step(text, index),
        }
    }

    found.sort_by_key(|d| d.start);
    found
}

/// Handles one `[...](...)`, appending its destination and any nested one, and answers
/// where scanning resumes. A `[` that turns out not to open a link resumes just after it,
/// so a stray `](` in prose cannot eat the rest of the file.
fn scanning_link(text: &str, open: usize, image: bool, found: &mut Vec<Destination>) -> usize {
    let b = text.as_bytes();
    let resume = open + 1;
    let Some(close) = matching_bracket(text, open) else {
        return resume;
    };
    let after_close = close + 1;
    if after_close >= b.len() || b[after_close] != b'(' {
        return resume;
    }
    let Some(parsed) = parsing_destination(text, after_close) else {
        return resume;
    };

    found.push(Destination { start: parsed.start, end: parsed.end, raw: parsed.raw, is_image: image });

    // Link text can hold an image of its own, and that image's destination points at a file
    // like any other. Nested offsets are relative to the inner text, so shift them back.
    for nested in destinations(&text[resume..close]) {
        found.push(Destination {
            start: resume + nested.start,
            end: resume + nested.end,
            raw: nested.raw,
            is_image: nested.is_image,
        });
    }
    parsed.after
}

// MARK: - Paths

/// `C:` when the path starts with a drive letter, else empty.
fn drive_prefix(path: &str) -> &str {
    let b = path.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        &path[..2]
    } else {
        ""
    }
}

/// Collapses `.` and `..`, repeated and trailing slashes; backslashes read as separators.
/// The same rule as `normalizePath` in src/models/paths.ts, so the keys the frontend sends
/// and the paths the walk produces compare equal.
pub fn normalize(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let absolute = slashed.starts_with('/');
    let drive = drive_prefix(&slashed);
    let mut parts: Vec<&str> = Vec::new();
    for part in slashed[drive.len()..].split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                if parts.last().is_some_and(|p| *p != "..") {
                    parts.pop();
                } else if !absolute && drive.is_empty() {
                    parts.push("..");
                }
            }
            _ => parts.push(part),
        }
    }
    let body = parts.join("/");
    if !drive.is_empty() {
        format!("{drive}/{body}")
    } else if absolute {
        format!("/{body}")
    } else if body.is_empty() {
        ".".to_string()
    } else {
        body
    }
}

pub fn join(directory: &str, path: &str) -> String {
    normalize(&format!("{directory}/{path}"))
}

pub fn dirname(path: &str) -> String {
    let n = normalize(path);
    match n.rfind('/') {
        None => ".".to_string(),
        Some(0) => "/".to_string(),
        Some(i) => n[..i].to_string(),
    }
}

/// Path components, the root kept as its own first entry so `/a` and `a` differ.
fn components(path: &str) -> Vec<String> {
    let n = normalize(path);
    let drive = drive_prefix(&n);
    let (head, rest) = if !drive.is_empty() {
        (Some(drive.to_string()), &n[drive.len()..])
    } else if let Some(rest) = n.strip_prefix('/') {
        (Some("/".to_string()), rest)
    } else {
        (None, n.as_str())
    };
    head.into_iter()
        .chain(rest.split('/').filter(|p| !p.is_empty()).map(str::to_string))
        .collect()
}

// Parentheses close an inline destination and quotes open a title, so neither can be left
// literal. Percent-encoding rather than the `<...>` form: `%20` survives every renderer and
// keeps a rewrite shape-stable instead of churning an already-encoded link into another form.
// The set is CharacterSet.urlPathAllowed minus ()<>"' - what the Swift app emitted.
fn is_destination_allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || "!$&*+,;=:@-._~".contains(c)
}

fn encode_component(part: &str) -> String {
    let mut out = String::with_capacity(part.len());
    for c in part.chars() {
        if is_destination_allowed(c) {
            out.push(c);
            continue;
        }
        let mut buf = [0u8; 4];
        for byte in c.encode_utf8(&mut buf).bytes() {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The path from `directory` to `target`, the way you would type it: `./a.md`,
/// `./sub/a.md`, `../other/a.md`. Always relative, always prefixed - a bare `sub/a.md`
/// reads as a word until you get to the slash.
pub fn relative_path(directory: &str, target: &str) -> String {
    let from = components(directory);
    let to = components(target);
    let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();

    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - shared];
    parts.extend(to[shared..].iter().cloned());
    if parts.is_empty() {
        return "./".to_string();
    }
    let joined: Vec<String> = parts.iter().map(|p| encode_component(p)).collect();
    let joined = joined.join("/");
    if parts[0] == ".." {
        joined
    } else {
        format!("./{joined}")
    }
}

// MARK: - Rewriting

/// Repoints every inline destination in `text` that resolves to a moved file. `directory`
/// is the folder `text` was read from; `home` is what `~` expands to, and a `~` destination
/// is left alone without it. None when nothing matched, so a caller never rewrites a file
/// it did not need to touch. The output is assembled forward from the untouched segments
/// between destinations, so line endings, titles and link text all survive verbatim.
pub fn rewriting(text: &str, directory: &str, moves: &[Move], home: Option<&str>) -> Option<(String, usize)> {
    if moves.is_empty() {
        return None;
    }
    let targets: HashMap<String, &str> =
        moves.iter().map(|m| (normalize(&m.old), m.new_path.as_str())).collect();

    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut count = 0;

    for destination in destinations(text) {
        let Some(replacement) = repointing(&destination, directory, &targets, home) else {
            continue;
        };
        output.push_str(&text[cursor..destination.start]);
        output.push_str(&replacement);
        cursor = destination.end;
        count += 1;
    }

    if count == 0 {
        return None;
    }
    output.push_str(&text[cursor..]);
    Some((output, count))
}

fn repointing(
    destination: &Destination,
    directory: &str,
    targets: &HashMap<String, &str>,
    home: Option<&str>,
) -> Option<String> {
    let (body, fragment) = splitting_fragment(&destination.raw);
    let unescaped = unescaping(body);
    let decoded = percent_decode(&unescaped).unwrap_or(unescaped);

    if decoded.is_empty() || decoded.starts_with("//") || has_scheme(&decoded) {
        return None;
    }

    if let Some(direct) = resolving(&decoded, directory, home) {
        if let Some(target) = targets.get(&direct) {
            return Some(format!("{}{fragment}", relative_path(directory, target)));
        }
    }

    // Editor-style `./app/Foo.swift:14`, tried only after the literal path misses - a colon
    // is a legal character in a file name. Same ordering as the link target resolver.
    let suffix = line_suffix(&decoded)?;
    let resolved = resolving(&decoded[..suffix], directory, home)?;
    let target = targets.get(&resolved)?;
    Some(format!("{}{}{fragment}", relative_path(directory, target), &decoded[suffix..]))
}

fn resolving(path: &str, directory: &str, home: Option<&str>) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    if path.starts_with('/') {
        return Some(normalize(path));
    }
    if let Some(rest) = path.strip_prefix('~') {
        return home.map(|h| normalize(&format!("{h}{rest}")));
    }
    Some(join(directory, path))
}

/// `http:`, `mailto:` and friends. Two characters at least before the colon, so a file
/// called `a` followed by a line number is not mistaken for a URL scheme.
fn has_scheme(path: &str) -> bool {
    let b = path.as_bytes();
    if !b.first().is_some_and(u8::is_ascii_alphabetic) {
        return false;
    }
    let mut i = 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'+' | b'.' | b'-')) {
        i += 1;
    }
    i >= 2 && b.get(i) == Some(&b':')
}

/// Where a trailing `:14` or `:14:3` begins, if the path ends in one.
fn line_suffix(path: &str) -> Option<usize> {
    let b = path.as_bytes();
    let digits_then_colon = |end: usize| -> Option<usize> {
        let mut i = end;
        while i > 0 && b[i - 1].is_ascii_digit() {
            i -= 1;
        }
        if i < end && i > 0 && b[i - 1] == b':' {
            Some(i - 1)
        } else {
            None
        }
    };
    let last = digits_then_colon(b.len())?;
    Some(digits_then_colon(last).unwrap_or(last))
}

/// Splits at the first unescaped `#`. The fragment is carried through the rewrite exactly
/// as written - it is the target's anchor, not ours to re-encode.
fn splitting_fragment(raw: &str) -> (&str, &str) {
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\\' => i = skip_escape(raw, i),
            b'#' => return (&raw[..i], &raw[i..]),
            _ => i = step(raw, i),
        }
    }
    (raw, "")
}

fn unescaping(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// `decodeURIComponent`: None on a malformed sequence, and the caller keeps the text as it
/// was - a literal `%` in a file name is not an error.
fn percent_decode(text: &str) -> Option<String> {
    let b = text.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

// MARK: - The pass

/// One document whose text changes once the moves have happened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rewrite {
    pub path: String,
    pub text: String,
    pub count: usize,
    /// The text came from `buffers`, not the disk - the caller owns it.
    pub from_buffer: bool,
}

/// Every document under `root` whose text changes once `moves` have happened. `buffers`
/// (unsaved editor text, by path) win over the disk; `excluding` are never read. The result
/// is the same either side of the move - resolution is path arithmetic and never asks the
/// disk whether the file is there - so the move goes first and this follows it.
pub fn plan(
    root: &Path,
    skip: &HashSet<String>,
    moves: &[Move],
    buffers: &HashMap<String, String>,
    excluding: &HashSet<String>,
    home: Option<&str>,
) -> Vec<Rewrite> {
    if moves.is_empty() {
        return Vec::new();
    }
    let buffers: HashMap<String, &str> = buffers.iter().map(|(k, v)| (normalize(k), v.as_str())).collect();
    let excluding: HashSet<String> = excluding.iter().map(|p| normalize(p)).collect();
    let mut rewrites = Vec::new();

    for path in walk::documents_under(root, skip, false) {
        let key = normalize(&path);
        if excluding.contains(&key) {
            continue;
        }
        let (text, from_buffer) = match buffers.get(&key) {
            Some(unsaved) => (unsaved.to_string(), true),
            None => {
                // A file we cannot read as text is shown but never written.
                let Ok(bytes) = fs::read(&path) else { continue };
                let Ok(decoded) = String::from_utf8(bytes) else { continue };
                (decoded, false)
            }
        };
        if let Some((text, count)) = rewriting(&text, &dirname(&key), moves, home) {
            rewrites.push(Rewrite { path, text, count, from_buffer });
        }
    }
    rewrites
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub path: String,
    pub count: usize,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Buffered {
    pub path: String,
    pub text: String,
    pub count: usize,
}

/// What the pass did: files rewritten on disk, buffers handed back rewritten for the caller
/// to place, and files that could not be written - said out loud rather than claimed.
#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub written: Vec<Written>,
    pub buffered: Vec<Buffered>,
    pub failed: Vec<String>,
}

/// The whole pass: plan, then write. The splice only replaces destination tokens and the
/// bytes go back as they are, so a CRLF file stays CRLF.
pub fn run(
    root: &Path,
    skip: &HashSet<String>,
    moves: &[Move],
    buffers: &HashMap<String, String>,
    excluding: &HashSet<String>,
    home: Option<&str>,
) -> Outcome {
    let mut outcome = Outcome::default();
    for rewrite in plan(root, skip, moves, buffers, excluding, home) {
        if rewrite.from_buffer {
            outcome.buffered.push(Buffered { path: rewrite.path, text: rewrite.text, count: rewrite.count });
            continue;
        }
        match write_atomically(Path::new(&rewrite.path), &rewrite.text) {
            Ok(()) => outcome.written.push(Written { path: rewrite.path, count: rewrite.count }),
            Err(_) => outcome.failed.push(rewrite.path),
        }
    }
    outcome
}

/// A temp file renamed into place, so a watcher or a reader never sees half a file. The
/// temp name is no document extension, so a re-list in between never shows it.
fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    let tmp = path.with_extension("md-boss.tmp");
    fs::write(&tmp, text)?;
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, path)
}

#[tauri::command]
pub async fn rewrite_links_cmd(
    root: String,
    skip_folders: Vec<String>,
    moves: Vec<Move>,
    buffers: HashMap<String, String>,
    excluding: Vec<String>,
    home: Option<String>,
) -> Result<Outcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let skip: HashSet<String> = skip_folders.into_iter().collect();
        let excluding: HashSet<String> = excluding.into_iter().collect();
        run(Path::new(&root), &skip, &moves, &buffers, &excluding, home.as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Synthetic /work paths throughout, as in the Swift suite.
    const WORK: &str = "/work/notes";
    fn at(path: &str) -> String {
        format!("{WORK}/{path}")
    }
    fn mv(old: &str, new: &str) -> Vec<Move> {
        vec![Move { old: at(old), new_path: at(new) }]
    }
    fn raws(text: &str) -> Vec<String> {
        destinations(text).into_iter().map(|d| d.raw).collect()
    }
    fn rewrite(text: &str, directory: &str) -> Option<String> {
        rewriting(text, directory, &mv("a.md", "sub/a.md"), None).map(|(t, _)| t)
    }

    // MARK: paths

    #[test]
    fn normalize_collapses_like_the_frontend() {
        assert_eq!(normalize("/a/./b/../c/"), "/a/c");
        assert_eq!(normalize("a/../../b"), "../b");
        assert_eq!(normalize("C:\\work\\notes\\..\\x"), "C:/work/x");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("/"), "/");
        assert_eq!(dirname("/a/b.md"), "/a");
        assert_eq!(dirname("/a.md"), "/");
        assert_eq!(dirname("a.md"), ".");
        assert_eq!(join("/a/b", "../c.md"), "/a/c.md");
    }

    #[test]
    fn relative_paths() {
        assert_eq!(relative_path(WORK, &at("a.md")), "./a.md");
        assert_eq!(relative_path(WORK, &at("sub/a.md")), "./sub/a.md");
        assert_eq!(relative_path(&at("sub"), &at("a.md")), "../a.md");
        assert_eq!(relative_path(&at("sub/deep"), &at("a.md")), "../../a.md");
        assert_eq!(relative_path(&at("sub"), &at("other/a.md")), "../other/a.md");
        assert_eq!(relative_path(WORK, WORK), "./");
        assert_eq!(relative_path("C:\\work\\notes", "C:\\work\\notes\\sub\\a.md"), "./sub/a.md");
    }

    #[test]
    fn characters_that_would_end_the_destination_are_encoded() {
        assert_eq!(relative_path(WORK, &at("my notes.md")), "./my%20notes.md");
        assert_eq!(relative_path(WORK, &at("a#b.md")), "./a%23b.md");
        assert_eq!(relative_path(WORK, &at("a(1).md")), "./a%281%29.md");
        assert_eq!(relative_path(WORK, &at("100%.md")), "./100%25.md");
        assert_eq!(relative_path(WORK, &at("ünï.md")), "./%C3%BCn%C3%AF.md");
        let path = relative_path(WORK, &at("a b (c).md"));
        assert!(!path.contains('<') && !path.contains('>'));
    }

    // MARK: scanning

    #[test]
    fn links_and_images_are_both_found_and_told_apart() {
        let found = destinations("see [a](./a.md) and ![b](./b.png)");
        assert_eq!(found.iter().map(|d| d.raw.as_str()).collect::<Vec<_>>(), ["./a.md", "./b.png"]);
        assert_eq!(found.iter().map(|d| d.is_image).collect::<Vec<_>>(), [false, true]);
    }

    #[test]
    fn link_text_can_nest_brackets_and_an_image_of_its_own() {
        assert_eq!(raws("[see [1]](./a.md)"), ["./a.md"]);
        assert_eq!(raws("[![x](./x.png) more](./a.md)"), ["./x.png", "./a.md"]);
    }

    #[test]
    fn destination_forms() {
        assert_eq!(raws("[a](<my file.md>)"), ["my file.md"]);
        assert_eq!(raws("[a](./a(1).md)"), ["./a(1).md"]);
        assert_eq!(raws("[a](./a.md \"The Title\")"), ["./a.md"]);
        assert_eq!(raws("[a]( ./a.md 'T' )"), ["./a.md"]);
        let text = "x [a](./a.md \"t\") y";
        let d = &destinations(text)[0];
        assert_eq!(&text[d.start..d.end], "./a.md");
    }

    #[test]
    fn fences_and_code_spans_are_skipped() {
        assert_eq!(raws("```\n[a](./a.md)\n```\n[b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("~~~\n[a](./a.md)\n~~~\n[b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("````\n```\n[a](./a.md)\n````\n[b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("`[a](./a.md)` and [b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("``a ` [x](./x.md)`` and [b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("   ``` md\n[a](./a.md)\n  ```  \n[b](./b.md)"), ["./b.md"]);
    }

    #[test]
    fn what_is_not_a_link_is_left_alone() {
        assert_eq!(raws("\\[not a link\\](./a.md) [b](./b.md)"), ["./b.md"]);
        assert_eq!(raws("[id]: ./a.md\n[x][id]\n[y][]"), Vec::<String>::new());
        assert_eq!(raws("a ]( b\n[c](./c.md)"), ["./c.md"]);
        assert_eq!(raws("[unclosed](./a.md"), Vec::<String>::new());
        assert_eq!(raws("![](./i.png"), Vec::<String>::new());
        assert_eq!(raws("[a](<unclosed"), Vec::<String>::new());
    }

    #[test]
    fn multibyte_text_around_and_inside_links_is_stepped_whole() {
        assert_eq!(raws("日本語 [リンク](./日本.md) \\é `ü` [b](./b.md)"), ["./日本.md", "./b.md"]);
        assert_eq!(raws("[a](./a.md\u{a0}\"t\") [b](./ü\u{2003}'t')"), ["./a.md", "./ü"]);
        assert_eq!(raws("trailing backslash \\"), Vec::<String>::new());
        assert_eq!(raws("[é\\"), Vec::<String>::new());
    }

    // MARK: rewriting

    #[test]
    fn only_the_destinations_that_point_at_the_moved_file_change() {
        assert_eq!(rewrite("[a](./a.md) and [b](./b.md)", WORK).unwrap(), "[a](./sub/a.md) and [b](./b.md)");
        assert_eq!(rewrite("[a](../a.md)", &at("deep")).unwrap(), "[a](../sub/a.md)");
        assert_eq!(rewrite("[a](/work/notes/a.md)", WORK).unwrap(), "[a](./sub/a.md)");
        assert_eq!(rewrite("[a](./a.md#plan)", WORK).unwrap(), "[a](./sub/a.md#plan)");
        assert_eq!(rewrite("[a](./a.md:14)", WORK).unwrap(), "[a](./sub/a.md:14)");
        assert_eq!(rewrite("[a](./a.md:14:3)", WORK).unwrap(), "[a](./sub/a.md:14:3)");
        assert_eq!(rewrite("[the **a**](./a.md \"Title\")", WORK).unwrap(), "[the **a**](./sub/a.md \"Title\")");
        assert_eq!(rewrite("[a](<./a.md>)", WORK).unwrap(), "[a](./sub/a.md)");
    }

    #[test]
    fn a_tilde_destination_follows_the_move_only_when_home_is_known() {
        let moves = mv("a.md", "sub/a.md");
        let text = "[a](~/notes/a.md)";
        assert_eq!(rewriting(text, WORK, &moves, Some("/work")).unwrap().0, "[a](./sub/a.md)");
        assert_eq!(rewriting(text, WORK, &moves, None), None);
    }

    #[test]
    fn a_percent_encoded_destination_is_matched_after_decoding() {
        let spaced = mv("my notes.md", "sub/my notes.md");
        assert_eq!(rewriting("[a](./my%20notes.md)", WORK, &spaced, None).unwrap().0, "[a](./sub/my%20notes.md)");
        // Malformed encoding is kept literal, as decodeURIComponent's throw was.
        let odd = mv("100%zz.md", "sub/100%zz.md");
        assert_eq!(rewriting("[a](./100%zz.md)", WORK, &odd, None).unwrap().0, "[a](./sub/100%25zz.md)");
    }

    #[test]
    fn external_links_and_untouched_text_are_none() {
        assert_eq!(rewrite("[a](https://example.com/a.md) [b](mailto:x@y.z) [c](#a.md) [d](//host/a.md)", WORK), None);
        assert_eq!(rewrite("no links here", WORK), None);
        assert_eq!(rewrite("[b](./b.md)", WORK), None);
        assert_eq!(rewriting("[a](./a.md)", WORK, &[], None), None);
        assert_eq!(rewrite("```\n[a](./a.md)\n```", WORK), None);
    }

    #[test]
    fn counts_and_line_endings() {
        let (text, count) = rewriting("[a](./a.md) [again](./a.md)", WORK, &mv("a.md", "sub/a.md"), None).unwrap();
        assert_eq!(count, 2);
        assert_eq!(text, "[a](./sub/a.md) [again](./sub/a.md)");
        assert_eq!(rewrite("one\r\n[a](./a.md)\r\ntwo", WORK).unwrap(), "one\r\n[a](./sub/a.md)\r\ntwo");
    }

    #[test]
    fn a_file_with_a_scheme_looking_name_is_a_path_when_it_has_a_line_number() {
        // `a:14` - one character before the colon is not a scheme.
        assert_eq!(rewriting("[a](./a:14)", WORK, &mv("a", "sub/a"), None).unwrap().0, "[a](./sub/a:14)");
        assert!(has_scheme("ab:1"));
        assert!(!has_scheme("a:1"));
        assert_eq!(line_suffix("x.md:14:3"), Some(4));
        assert_eq!(line_suffix("x.md::14"), Some(5));
        assert_eq!(line_suffix("x.md:"), None);
        // The same leftmost match the regex found; resolving an empty body then misses.
        assert_eq!(line_suffix(":14"), Some(0));
        assert_eq!(rewriting("[a](:14)", WORK, &mv("a", "sub/a"), None), None);
    }

    // MARK: the pass

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch tree: `{ "one/a.md": "text" }` written under a unique temp folder.
    struct Fixture(PathBuf);

    impl Fixture {
        fn make(files: &[(&str, &str)]) -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!("md-boss-links-{}-{n}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            for (path, text) in files {
                let full = root.join(path);
                fs::create_dir_all(full.parent().unwrap()).unwrap();
                fs::write(full, text).unwrap();
            }
            Fixture(root)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn at(&self, rel: &str) -> String {
            self.0.join(rel).to_string_lossy().into_owned()
        }
        fn read(&self, rel: &str) -> String {
            fs::read_to_string(self.0.join(rel)).unwrap()
        }
        fn moves(&self, old: &str, new: &str) -> Vec<Move> {
            vec![Move { old: self.at(old), new_path: self.at(new) }]
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn skip(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_documents_that_referenced_the_moved_file_are_rewritten() {
        let f = Fixture::make(&[
            ("index.md", "see [a](./a.md)"),
            ("unrelated.md", "see [b](./b.md)"),
            ("deep/x.md", "see [a](../a.md) twice [a](../a.md)"),
            ("sub/a.md", "# a"),
        ]);
        let outcome = run(f.path(), &skip(&[]), &f.moves("a.md", "sub/a.md"), &HashMap::new(), &HashSet::new(), None);
        let mut written = outcome.written.clone();
        written.sort_by(|l, r| l.path.cmp(&r.path));
        assert_eq!(written, [
            Written { path: f.at("deep/x.md"), count: 2 },
            Written { path: f.at("index.md"), count: 1 },
        ]);
        assert!(outcome.buffered.is_empty() && outcome.failed.is_empty());
        assert_eq!(f.read("deep/x.md"), "see [a](../sub/a.md) twice [a](../sub/a.md)");
        assert_eq!(f.read("index.md"), "see [a](./sub/a.md)");
        assert_eq!(f.read("unrelated.md"), "see [b](./b.md)");
        assert!(!f.path().join("index.md-boss.tmp").exists());
    }

    #[test]
    fn a_rename_repoints_inbound_links_the_way_a_move_does_fences_excepted() {
        let f = Fixture::make(&[
            ("a.md", "# a"),
            ("index.md", "see [a](./a.md)"),
            ("deep/x.md", "see [a](../a.md) and [a](../a.md)\n\n```\n[a](../a.md)\n```\n"),
        ]);
        run(f.path(), &skip(&[]), &f.moves("a.md", "b.md"), &HashMap::new(), &HashSet::new(), None);
        assert_eq!(f.read("deep/x.md"), "see [a](../b.md) and [a](../b.md)\n\n```\n[a](../a.md)\n```\n");
        assert_eq!(f.read("index.md"), "see [a](./b.md)");
    }

    #[test]
    fn skipped_and_hidden_folders_are_never_read() {
        let f = Fixture::make(&[
            ("node_modules/vendored.md", "see [a](../a.md)"),
            (".git/x.md", "see [a](../a.md)"),
        ]);
        let plan = plan(f.path(), &skip(&["node_modules"]), &f.moves("a.md", "sub/a.md"), &HashMap::new(), &HashSet::new(), None);
        assert!(plan.is_empty());
    }

    #[test]
    fn an_unsaved_buffer_wins_over_the_disk_and_is_handed_back_not_written() {
        let f = Fixture::make(&[("index.md", "nothing here")]);
        // The key the frontend sends is normalized text; a stray `./` must still match.
        let buffers = HashMap::from([(f.at("./index.md"), "typed [a](./a.md) but not saved".to_string())]);
        let outcome = run(f.path(), &skip(&[]), &f.moves("a.md", "sub/a.md"), &buffers, &HashSet::new(), None);
        assert_eq!(outcome.buffered, [Buffered { path: f.at("index.md"), text: "typed [a](./sub/a.md) but not saved".into(), count: 1 }]);
        assert!(outcome.written.is_empty());
        assert_eq!(f.read("index.md"), "nothing here");
    }

    #[test]
    fn an_excluded_file_and_no_moves_are_no_plan() {
        let f = Fixture::make(&[("index.md", "see [a](./a.md)")]);
        let excluding = HashSet::from([f.at("index.md")]);
        assert!(plan(f.path(), &skip(&[]), &f.moves("a.md", "sub/a.md"), &HashMap::new(), &excluding, None).is_empty());
        assert!(plan(f.path(), &skip(&[]), &[], &HashMap::new(), &HashSet::new(), None).is_empty());
    }

    #[test]
    fn bytes_go_back_as_they_were_and_undecodable_files_are_left_alone() {
        let f = Fixture::make(&[("crlf.md", "one\r\n[a](./a.md)\r\ntwo")]);
        fs::write(f.path().join("binary.md"), [0xff, 0xfe, b'[', b'a', b']', b'(', b'a', b'.', b'm', b'd', b')']).unwrap();
        let outcome = run(f.path(), &skip(&[]), &f.moves("a.md", "sub/a.md"), &HashMap::new(), &HashSet::new(), None);
        assert_eq!(outcome.written.len(), 1);
        assert_eq!(f.read("crlf.md"), "one\r\n[a](./sub/a.md)\r\ntwo");
        assert_eq!(fs::read(f.path().join("binary.md")).unwrap()[..2], [0xff, 0xfe]);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_written_is_reported_not_claimed() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc_geteuid() } == 0 {
            return;
        }
        let f = Fixture::make(&[("locked/index.md", "see [a](../a.md)")]);
        let locked = f.path().join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let outcome = run(f.path(), &skip(&[]), &f.moves("a.md", "sub/a.md"), &HashMap::new(), &HashSet::new(), None);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(outcome.failed, [f.at("locked/index.md")]);
        assert!(outcome.written.is_empty());
        assert_eq!(f.read("locked/index.md"), "see [a](../a.md)");
    }

    #[cfg(unix)]
    extern "C" {
        #[link_name = "geteuid"]
        fn libc_geteuid() -> u32;
    }
}
