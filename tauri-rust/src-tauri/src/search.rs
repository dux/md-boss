//! Finding a string across every document under a folder. The port of DocumentSearch.swift
//! and ByteScan.swift: the file list is the sidebar's own walk (walk::documents_under), so
//! the search never answers "which files does this app show you" differently from the tree;
//! a byte prefilter skips files that cannot contain the query before they are decoded; the
//! budgets say when a huge tree was cut short rather than quietly showing less; a superseded
//! query is cancelled between files through a generation id.
//!
//! Deliberately not handled: regular expressions, whole-word matching, multi-line patterns.

use crate::walk;
use memchr::memmem;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    /// 1-based, counted the way LineIndex counts - split on `\n` only.
    pub line: usize,
    /// UTF-16 offset of the match within `text`, the unit the editor and the notes speak.
    pub column: usize,
    /// UTF-16 length.
    pub length: usize,
    /// The whole line, so the row can show the match in context and mark it.
    pub text: String,
}

/// Budgets, so a query typed into a huge tree cannot walk forever. Reaching one sets
/// `truncated`, which the pane says out loud.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub per_file: usize,
    pub total: usize,
    pub files: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { per_file: 50, total: 2000, files: 5000 }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<Hit>,
    pub truncated: bool,
    pub files_searched: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    pub line: usize,
    pub column: usize,
    pub length: usize,
    pub text: String,
}

/// Case-insensitive until the query carries a capital, then exact. Derived from the query
/// rather than stored behind a toggle.
pub fn is_case_sensitive(query: &str) -> bool {
    query.chars().any(char::is_uppercase)
}

/// Every match in one string, pure over text. Matched line by line - a query never spans a
/// line break - with columns in UTF-16 units; case folding is `to_lowercase` on both sides,
/// mapped back to the original characters so a fold that changes length cannot shift the
/// column. Lines keep no trailing `\n` or `\r`.
pub fn matches(text: &str, query: &str, limit: usize) -> Vec<Match> {
    if query.is_empty() || text.is_empty() || limit == 0 {
        return Vec::new();
    }
    let sensitive = is_case_sensitive(query);
    let needle = if sensitive { query.to_string() } else { query.to_lowercase() };
    let mut found = Vec::new();
    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.is_empty() {
            continue;
        }
        if sensitive {
            for (byte, _) in line.match_indices(needle.as_str()) {
                found.push(Match {
                    line: index + 1,
                    column: utf16_len(&line[..byte]),
                    length: utf16_len(needle.as_str()),
                    text: line.to_string(),
                });
                if found.len() >= limit {
                    return found;
                }
            }
            continue;
        }
        // Folded text, plus for every folded char the UTF-16 offset of the original char it
        // came from (and one past the end), so a folded byte offset maps back to a column.
        let mut folded = String::with_capacity(line.len());
        let mut origin: Vec<usize> = Vec::with_capacity(line.len());
        let mut offset = 0;
        for c in line.chars() {
            for f in c.to_lowercase() {
                folded.push(f);
                origin.push(offset);
            }
            offset += c.len_utf16();
        }
        origin.push(offset);
        // folded byte offset -> folded char index
        let mut byte_to_char: HashMap<usize, usize> = HashMap::new();
        for (i, (b, _)) in folded.char_indices().enumerate() {
            byte_to_char.insert(b, i);
        }
        byte_to_char.insert(folded.len(), origin.len() - 1);
        for (byte, _) in folded.match_indices(needle.as_str()) {
            let Some(&start_char) = byte_to_char.get(&byte) else { continue };
            let Some(&end_char) = byte_to_char.get(&(byte + needle.len())) else { continue };
            let start = origin[start_char];
            let end = origin[end_char];
            found.push(Match { line: index + 1, column: start, length: end - start, text: line.to_string() });
            if found.len() >= limit {
                return found;
            }
        }
    }
    found
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// "Could this file possibly contain the query?", answered on raw bytes. One-sided: it may
/// say yes about a file holding nothing, and must never say no about one that does. Only an
/// ASCII query can be answered soundly as bytes - folding non-ASCII means Unicode case
/// mapping - so any other query reads every file.
pub struct Needle {
    folded: Vec<u8>,
    sensitive: bool,
    /// The one non-ASCII character whose lowercase is ASCII: KELVIN SIGN folds to `k`. A
    /// file holding it cannot be skipped for a query with a `k` in it.
    kelvin: bool,
}

impl Needle {
    pub fn new(query: &str) -> Option<Needle> {
        if query.is_empty() || !query.is_ascii() {
            return None;
        }
        let sensitive = is_case_sensitive(query);
        let folded = if sensitive { query.as_bytes().to_vec() } else { query.to_ascii_lowercase().into_bytes() };
        let kelvin = !sensitive && folded.contains(&b'k');
        Some(Needle { folded, sensitive, kelvin })
    }

    pub fn may_contain(&self, bytes: &[u8]) -> bool {
        if bytes.len() < self.folded.len() {
            return false;
        }
        if self.sensitive {
            return memmem::find(bytes, &self.folded).is_some();
        }
        let lowered: Vec<u8> = bytes.iter().map(u8::to_ascii_lowercase).collect();
        if memmem::find(&lowered, &self.folded).is_some() {
            return true;
        }
        self.kelvin && memmem::find(bytes, "\u{212A}".as_bytes()).is_some()
    }
}

/// The whole search. `buffers` is unsaved text by path - searching the disk copy of the
/// file you are looking at would miss what you just typed. `cancelled` is polled between
/// files, so a superseded query dies within one file's work rather than walking the tree.
pub fn run(
    root: &Path,
    skip: &HashSet<String>,
    query: &str,
    buffers: &HashMap<String, String>,
    limits: Limits,
    cancelled: &dyn Fn() -> bool,
) -> SearchResult {
    if query.is_empty() {
        return SearchResult::default();
    }
    let mut targets = walk::documents_under(root, skip, false);
    let mut truncated = false;
    if targets.len() > limits.files {
        targets.truncate(limits.files);
        truncated = true;
    }
    if cancelled() {
        return SearchResult { hits: Vec::new(), truncated: true, files_searched: 0 };
    }
    let needle = Needle::new(query);
    let mut hits: Vec<Hit> = Vec::new();
    for path in &targets {
        if cancelled() {
            return SearchResult { hits, truncated: true, files_searched: targets.len() };
        }
        let text: String = match buffers.get(path) {
            Some(unsaved) => unsaved.clone(),
            None => {
                let Ok(bytes) = std::fs::read(path) else { continue };
                if let Some(needle) = &needle {
                    if !needle.may_contain(&bytes) {
                        continue;
                    }
                }
                // A file we cannot decode is listed but never read, the same rule the
                // document and the link rewriter apply.
                let Ok(decoded) = String::from_utf8(bytes) else { continue };
                decoded
            }
        };
        let room = limits.per_file.min(limits.total.saturating_sub(hits.len()));
        if room == 0 {
            return SearchResult { hits, truncated: true, files_searched: targets.len() };
        }
        // One past the cap, so "exactly full" can be told from "there was more".
        let found = matches(&text, query, room + 1);
        if found.len() > room {
            truncated = true;
        }
        for m in found.into_iter().take(room) {
            hits.push(Hit { path: path.clone(), line: m.line, column: m.column, length: m.length, text: m.text });
        }
    }
    SearchResult { hits, truncated, files_searched: targets.len() }
}

/// The newest query's generation. A search whose generation is no longer the latest stops
/// between files; the frontend bumps it on every keystroke.
#[derive(Default)]
pub struct Generation(AtomicU64);

#[tauri::command]
pub async fn search_cmd(
    root: String,
    skip_folders: Vec<String>,
    query: String,
    buffers: HashMap<String, String>,
    generation: u64,
    latest: tauri::State<'_, Arc<Generation>>,
) -> Result<SearchResult, String> {
    let latest = latest.inner().clone();
    latest.0.fetch_max(generation, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let skip: HashSet<String> = skip_folders.into_iter().collect();
        let cancelled = || latest.0.load(Ordering::SeqCst) != generation;
        run(Path::new(&root), &skip, &query, &buffers, Limits::default(), &cancelled)
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fixture(files: &[(&str, &str)]) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("md-boss-search-{}-{}", std::process::id(), n));
        for (name, text) in files {
            let path = dir.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        dir
    }

    fn lines(m: &[Match]) -> Vec<(usize, usize, usize)> {
        m.iter().map(|m| (m.line, m.column, m.length)).collect()
    }

    #[test]
    fn case_follows_the_query() {
        assert!(!is_case_sensitive("plan"));
        assert!(is_case_sensitive("Plan"));
        let text = "The Plan\nthe plan\nno\n";
        assert_eq!(lines(&matches(text, "plan", 10)), vec![(1, 4, 4), (2, 4, 4)]);
        assert_eq!(lines(&matches(text, "Plan", 10)), vec![(1, 4, 4)]);
    }

    #[test]
    fn columns_are_utf16_and_lines_lose_their_line_endings() {
        let text = "😀 plan\r\nsecond Plan here\r\n";
        let found = matches(text, "plan", 10);
        assert_eq!(lines(&found), vec![(1, 3, 4), (2, 7, 4)]);
        assert_eq!(found[0].text, "😀 plan");
        assert_eq!(found[1].text, "second Plan here");
    }

    #[test]
    fn folding_that_changes_length_keeps_columns_on_the_original() {
        // 'İ' lowercases to two chars; the match after it must still land on the right column.
        let found = matches("İ abc", "abc", 10);
        assert_eq!(lines(&found), vec![(1, 2, 3)]);
        // A folded match over a widening char: the length covers the original characters.
        let found = matches("xİy", "i̇", 10);
        assert_eq!(lines(&found), vec![(1, 1, 1)]);
    }

    #[test]
    fn limit_and_repeated_matches_on_one_line() {
        let found = matches("aaaa\naa\n", "aa", 10);
        assert_eq!(lines(&found), vec![(1, 0, 2), (1, 2, 2), (2, 0, 2)]);
        assert_eq!(matches("aaaa\naa\n", "aa", 2).len(), 2);
        assert!(matches("x", "", 10).is_empty());
    }

    #[test]
    fn the_prefilter_never_says_no_about_a_match() {
        let needle = Needle::new("plan").unwrap();
        assert!(needle.may_contain(b"The PLAN"));
        assert!(!needle.may_contain(b"nothing here"));
        assert!(Needle::new("Plan").unwrap().may_contain(b"a Plan"));
        assert!(!Needle::new("Plan").unwrap().may_contain(b"a plan"));
        assert!(Needle::new("plan").unwrap().may_contain("\u{212A}".as_bytes()) == false);
        // Kelvin sign folds to k: a file holding it cannot be skipped
        assert!(Needle::new("kelvin").unwrap().may_contain("\u{212A}elvin".as_bytes()));
        assert!(Needle::new("plän").is_none());
        assert!(Needle::new("").is_none());
    }

    #[test]
    fn searches_the_tree_with_buffers_skips_and_budgets() {
        let dir = fixture(&[
            ("a.md", "alpha plan\nbeta\n"),
            ("sub/b.md", "plan one\nplan two\nplan three\n"),
            ("node_modules/x.md", "plan hidden\n"),
            ("c.txt", "PLAN shouting\n"),
            ("bin.md", "plan \u{FFFF}"),
        ]);
        let skip: HashSet<String> = ["node_modules".to_string()].into_iter().collect();
        let never = || false;
        let result = run(&dir, &skip, "plan", &HashMap::new(), Limits::default(), &never);
        let paths: Vec<String> = result.hits.iter().map(|h| h.path.trim_start_matches(&*dir.to_string_lossy()).to_string()).collect();
        assert_eq!(paths, vec!["/a.md", "/bin.md", "/c.txt", "/sub/b.md", "/sub/b.md", "/sub/b.md"]);
        assert_eq!(result.files_searched, 4);
        assert!(!result.truncated);

        // unsaved text wins over the disk copy
        let mut buffers = HashMap::new();
        buffers.insert(dir.join("a.md").to_string_lossy().into_owned(), "nothing now\n".to_string());
        let result = run(&dir, &skip, "alpha", &buffers, Limits::default(), &never);
        assert!(result.hits.is_empty());

        // per-file and total budgets say when they cut
        let tight = Limits { per_file: 2, total: 100, files: 100 };
        let result = run(&dir, &skip, "plan", &HashMap::new(), tight, &never);
        assert!(result.truncated);
        assert_eq!(result.hits.iter().filter(|h| h.path.ends_with("b.md")).count(), 2);
        let total = Limits { per_file: 50, total: 3, files: 100 };
        let result = run(&dir, &skip, "plan", &HashMap::new(), total, &never);
        assert_eq!(result.hits.len(), 3);
        assert!(result.truncated);
        let files = Limits { per_file: 50, total: 100, files: 2 };
        let result = run(&dir, &skip, "plan", &HashMap::new(), files, &never);
        assert_eq!(result.files_searched, 2);
        assert!(result.truncated);

        // cancelled between files
        let calls = AtomicUsize::new(0);
        let cancel_after_two = || calls.fetch_add(1, Ordering::SeqCst) >= 2;
        let result = run(&dir, &skip, "plan", &HashMap::new(), Limits::default(), &cancel_after_two);
        assert!(result.truncated);
        assert!(result.hits.len() < 6);
    }
}
