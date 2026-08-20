//! The `.md-boss` store on disk: read (three shapes fold into one), write (canonical shape,
//! atomic, removed when empty). The rules about *which* store a note belongs in, shifting
//! and deduplication live on the TypeScript side (src/models/notes.ts, annotationStore.ts);
//! this file is the IO.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

/// A marked line, with or without something written about it. Paths are stored
/// tilde-abbreviated; line numbers are 1-based. Empty title/body are left out of the file,
/// so a plain jump point stays a two-key object in a file meant to be read by a person.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub path: String,
    pub line: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct AnnotationFile {
    pub notes: Vec<Note>,
}

impl AnnotationFile {
    pub fn is_empty(&self) -> bool {
        self.notes.is_empty()
    }
}

/// Three shapes fold into one array: `notes`, plus `bookmarks` and `comments` written by
/// older builds. A line carrying both an old bookmark and an old comment becomes a single
/// note with a title and a body. Missing fields read as empty; a malformed or missing file
/// is empty. Never an error: a store that cannot be read is a store with nothing in it.
pub fn read_notes(path: &Path) -> AnnotationFile {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return AnnotationFile::default(),
    };
    parse(&text)
}

pub fn parse(text: &str) -> AnnotationFile {
    let raw: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return AnnotationFile::default(),
    };
    let obj = match raw.as_object() {
        Some(obj) => obj,
        None => return AnnotationFile::default(),
    };
    let mut found = Vec::new();
    for key in ["notes", "bookmarks", "comments"] {
        if let Some(Value::Array(items)) = obj.get(key) {
            for item in items {
                let (path, line) = match (item.get("path").and_then(Value::as_str), item.get("line").and_then(Value::as_u64)) {
                    (Some(path), Some(line)) => (path, line),
                    _ => continue,
                };
                found.push(Note {
                    path: path.to_string(),
                    line,
                    title: item.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
                    body: item.get("body").and_then(Value::as_str).unwrap_or("").to_string(),
                });
            }
        }
    }
    AnnotationFile { notes: fold(found) }
}

/// One note per (path, line), first non-empty value winning per field, in path then line
/// order - the same fold as the TypeScript side, so the two agree about what a file says.
pub fn fold(notes: Vec<Note>) -> Vec<Note> {
    let mut merged: BTreeMap<(String, u64), Note> = BTreeMap::new();
    for note in notes {
        let key = (note.path.clone(), note.line);
        match merged.get_mut(&key) {
            None => {
                merged.insert(key, note);
            }
            Some(existing) => {
                if existing.title.is_empty() {
                    existing.title = note.title;
                }
                if existing.body.is_empty() {
                    existing.body = note.body;
                }
            }
        }
    }
    merged.into_values().collect()
}

/// Pretty, sorted keys, trailing newline - a file meant to be read, hand-edited and diffed.
/// Only the current key is written, so a file converts itself the first time anything in it
/// is touched.
pub fn serialize(file: &AnnotationFile) -> String {
    // serde_json without preserve_order writes maps in key order; going through Value
    // makes that the case for the structs as well.
    let value = serde_json::to_value(file).unwrap_or(Value::Null);
    let mut out = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{\"notes\":[]}".to_string());
    out.push('\n');
    out
}

/// An emptied file is removed rather than left as `{}` littering the project root. The
/// write is atomic - a temp file renamed into place - so a watcher or a git status never
/// sees half a file.
pub fn write_notes(path: &Path, file: &AnnotationFile) -> io::Result<()> {
    if file.is_empty() {
        return match fs::remove_file(path) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        };
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("md-boss.tmp");
    fs::write(&tmp, serialize(file))?;
    fs::rename(&tmp, path)
}

#[tauri::command]
pub async fn read_notes_cmd(path: String) -> Result<AnnotationFile, String> {
    tauri::async_runtime::spawn_blocking(move || read_notes(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_notes_cmd(path: String, file: AnnotationFile) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_notes(Path::new(&path), &file).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch() -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("md-boss-notes-{}-{}", std::process::id(), n));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn note(path: &str, line: u64, title: &str, body: &str) -> Note {
        Note { path: path.into(), line, title: title.into(), body: body.into() }
    }

    #[test]
    fn legacy_bookmarks_and_comments_fold_into_notes() {
        let text = r#"{
          "bookmarks": [{"path": "~/a.md", "line": 3, "title": "Plan"}],
          "comments": [{"path": "~/a.md", "line": 3, "body": "revisit"}, {"path": "~/b.md", "line": 1, "body": "x"}],
          "notes": [{"path": "~/a.md", "line": 9}]
        }"#;
        let file = parse(text);
        assert_eq!(
            file.notes,
            vec![note("~/a.md", 3, "Plan", "revisit"), note("~/a.md", 9, "", ""), note("~/b.md", 1, "", "x")]
        );
    }

    #[test]
    fn malformed_or_partial_records_read_as_empty_or_are_skipped() {
        assert!(parse("not json").is_empty());
        assert!(parse("[1,2]").is_empty());
        let file = parse(r#"{"notes": [{"path": "~/a.md"}, {"line": 2}, {"path": "~/c.md", "line": 2, "title": 5}]}"#);
        assert_eq!(file.notes, vec![note("~/c.md", 2, "", "")]);
    }

    #[test]
    fn canonical_shape_on_write_sorted_keys_no_empty_fields() {
        let file = AnnotationFile { notes: vec![note("~/a.md", 3, "Plan", ""), note("~/a.md", 1, "", "body")] };
        let text = serialize(&file);
        assert_eq!(
            text,
            "{\n  \"notes\": [\n    {\n      \"line\": 3,\n      \"path\": \"~/a.md\",\n      \"title\": \"Plan\"\n    },\n    {\n      \"body\": \"body\",\n      \"line\": 1,\n      \"path\": \"~/a.md\"\n    }\n  ]\n}\n"
        );
        assert!(!text.contains("bookmarks"));
    }

    #[test]
    fn round_trip_and_removal_when_emptied() {
        let dir = scratch();
        let store = dir.join(".md-boss");
        assert!(read_notes(&store).is_empty());
        let file = AnnotationFile { notes: vec![note("~/a.md", 3, "Plan", "revisit")] };
        write_notes(&store, &file).unwrap();
        assert_eq!(read_notes(&store), file);
        assert!(!dir.join(".md-boss.tmp").exists());
        write_notes(&store, &AnnotationFile::default()).unwrap();
        assert!(!store.exists());
        // removing what is already gone is fine
        write_notes(&store, &AnnotationFile::default()).unwrap();
    }

    #[test]
    fn a_legacy_file_converts_itself_when_touched() {
        let dir = scratch();
        let store = dir.join(".md-boss");
        fs::write(&store, r#"{"bookmarks": [{"path": "~/a.md", "line": 3, "title": "Plan"}]}"#).unwrap();
        let read = read_notes(&store);
        write_notes(&store, &read).unwrap();
        let text = fs::read_to_string(&store).unwrap();
        assert!(text.contains("\"notes\""));
        assert!(!text.contains("bookmarks"));
    }
}
