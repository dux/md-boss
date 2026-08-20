//! Walking a folder for the sidebar and the project-wide passes. One `read_dir` per
//! directory, names decided by extension, hidden entries and `skip_folders` left out,
//! symlinks never descended (which is also what makes a cycle impossible). Everything here
//! is blocking I/O, so the commands run it on the blocking pool.

use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// What the sidebar lists and the document panes open.
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "qmd", "rmd", "txt", "csv",
];

/// Directories the sidebar treats as opaque files - a `Foo.app` with a stray .txt inside it
/// is not a folder worth showing. Only the scanner asks for this; the search walk descends.
pub const PACKAGE_EXTENSIONS: &[&str] = &[
    "app",
    "bundle",
    "framework",
    "kext",
    "plugin",
    "rtfd",
    "playground",
    "xcodeproj",
    "xcworkspace",
    "photoslibrary",
    "fcpbundle",
    "sparsebundle",
];

/// Entries examined before giving up on a single folder. Hitting it means the folder is
/// enormous and document-free; the scan then fails open and shows the folder, because
/// hiding real content is worse than showing an empty one.
pub const SCAN_BUDGET: usize = 20_000;

fn extension_lower(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    if dot == 0 || dot == name.len() - 1 {
        return None;
    }
    Some(name[dot + 1..].to_ascii_lowercase())
}

pub fn is_document(name: &str) -> bool {
    extension_lower(name).is_some_and(|ext| DOCUMENT_EXTENSIONS.contains(&ext.as_str()))
}

fn is_package(name: &str) -> bool {
    extension_lower(name).is_some_and(|ext| PACKAGE_EXTENSIONS.contains(&ext.as_str()))
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// One level of the sidebar. `contents_of_directory` throws the same way for a folder that
/// is gone and one you are not allowed to read, and the sidebar says something different
/// for each - an unmounted drive and a permissions prompt are different problems.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Listing {
    Entries { entries: Vec<Entry> },
    Denied,
    Missing,
}

/// One directory, one `read_dir`. Hands back only the entries that matter - directories
/// worth descending and files the sidebar would list - and how many entries it had to
/// look at to do it. Names are bare, not paths. With `follow_symlinks` a link to a folder
/// counts as a folder (the sidebar shows it); without, a link is whatever its name says and
/// is never descended (the walk).
fn children(
    dir: &Path,
    skip: &HashSet<String>,
    skip_packages: bool,
    follow_symlinks: bool,
) -> io::Result<(Vec<(String, bool)>, usize)> {
    let mut out = Vec::new();
    let mut examined = 0;
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        examined += 1;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || is_hidden(&name) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let is_dir = if kind.is_symlink() {
            follow_symlinks
                && fs::metadata(entry.path())
                    .map(|m| m.is_dir())
                    .unwrap_or(false)
        } else {
            kind.is_dir()
        };
        if is_dir {
            if skip.contains(&name) || (skip_packages && is_package(&name)) {
                continue;
            }
            out.push((name, true));
        } else if is_document(&name) {
            out.push((name, false));
        }
    }
    Ok((out, examined))
}

/// Every document below `root`, however deep. Within one directory documents come before
/// subtrees and each group is sorted by name, so the same tree always answers the same way
/// and search results do not shuffle between keystrokes. An unreadable directory is not an
/// error here: a whole-project pass that stopped at the first protected folder would find
/// nothing at all.
pub fn documents_under(root: &Path, skip: &HashSet<String>, skip_packages: bool) -> Vec<String> {
    let mut found = Vec::new();
    collect(root, skip, skip_packages, &mut found);
    found
}

fn collect(dir: &Path, skip: &HashSet<String>, skip_packages: bool, found: &mut Vec<String>) {
    let Ok((entries, _)) = children(dir, skip, skip_packages, false) else {
        return;
    };
    let mut documents: Vec<String> = Vec::new();
    let mut subtrees: Vec<String> = Vec::new();
    for (name, is_dir) in entries {
        if is_dir {
            subtrees.push(name)
        } else {
            documents.push(name)
        }
    }
    documents.sort();
    subtrees.sort();
    for name in documents {
        found.push(dir.join(name).to_string_lossy().into_owned());
    }
    for name in subtrees {
        collect(&dir.join(name), skip, skip_packages, found);
    }
}

/// Whether anything below `dir` is a document, giving up after `budget` entries. Fails
/// *open* on the budget - a folder too big to scan is shown rather than hidden.
pub fn contains_document(
    dir: &Path,
    skip: &HashSet<String>,
    budget: usize,
    skip_packages: bool,
) -> bool {
    let mut examined = 0;
    probe(dir, skip, skip_packages, &mut examined, budget)
}

fn probe(
    dir: &Path,
    skip: &HashSet<String>,
    skip_packages: bool,
    examined: &mut usize,
    budget: usize,
) -> bool {
    let Ok((entries, looked)) = children(dir, skip, skip_packages, false) else {
        return false;
    };
    // Every entry read_dir handed back, not just the ones that got through the filter -
    // the budget is there to bound a huge document-free folder, and those are exactly the
    // folders where almost nothing gets through.
    *examined += looked;
    let mut subtrees: Vec<String> = Vec::new();
    for (name, is_dir) in entries {
        if !is_dir {
            return true;
        }
        subtrees.push(name);
    }
    if *examined > budget {
        return true;
    }
    subtrees.sort();
    subtrees
        .iter()
        .any(|name| probe(&dir.join(name), skip, skip_packages, examined, budget))
}

/// "Does this folder have a document anywhere below it?", memoised per path. A change
/// inside a folder can flip the answer for it and every folder above it, and invalidates
/// everything below it.
#[derive(Default)]
pub struct Scanner {
    cache: Mutex<HashMap<String, bool>>,
}

impl Scanner {
    pub fn contains_documents(&self, dir: &Path, skip: &HashSet<String>) -> bool {
        let key = dir.to_string_lossy().into_owned();
        if let Some(&cached) = self.cache.lock().unwrap().get(&key) {
            return cached;
        }
        let result = contains_document(dir, skip, SCAN_BUDGET, true);
        self.cache.lock().unwrap().insert(key, result);
        result
    }

    pub fn invalidate(&self, path: &Path) {
        let path = path.to_string_lossy().into_owned();
        let below = format!("{path}/");
        self.cache.lock().unwrap().retain(|cached, _| {
            !(cached == &path
                || cached.starts_with(&below)
                || path.starts_with(&format!("{cached}/")))
        });
    }

    pub fn invalidate_all(&self) {
        self.cache.lock().unwrap().clear();
    }
}

/// One level of the tree: documents, and folders that have a document somewhere below
/// them. Folders first, then natural order - `9.md` before `10.md`.
pub fn list_dir(dir: &Path, skip: &HashSet<String>, scanner: &Scanner) -> Listing {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) => {
            return match err.kind() {
                io::ErrorKind::NotFound => Listing::Missing,
                io::ErrorKind::PermissionDenied => Listing::Denied,
                _ if dir.exists() => Listing::Denied,
                _ => Listing::Missing,
            };
        }
    };

    let mut entries = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            if skip.contains(&name) || !scanner.contains_documents(&path, skip) {
                continue;
            }
        } else if !is_document(&name) {
            continue;
        }
        entries.push(Entry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    Listing::Entries { entries }
}

/// Case-insensitive, digit runs compared by value: `a2` < `a10`, `B` between `a` and `c`.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let mut np = 0u128;
                let mut nq = 0u128;
                while let Some(d) = x.peek().and_then(|c| c.to_digit(10)) {
                    np = np * 10 + d as u128;
                    x.next();
                }
                while let Some(d) = y.peek().and_then(|c| c.to_digit(10)) {
                    nq = nq * 10 + d as u128;
                    y.next();
                }
                if np != nq {
                    return np.cmp(&nq);
                }
            }
            (Some(p), Some(q)) => {
                if p != q {
                    return p.cmp(&q);
                }
                x.next();
                y.next();
            }
        }
    }
}

// MARK: - Commands

fn skip_set(skip_folders: Vec<String>) -> HashSet<String> {
    skip_folders.into_iter().collect()
}

#[tauri::command]
pub async fn list_dir_cmd(
    path: String,
    skip_folders: Vec<String>,
    scanner: tauri::State<'_, Arc<Scanner>>,
) -> Result<Listing, String> {
    let scanner = scanner.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_dir(Path::new(&path), &skip_set(skip_folders), &scanner)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn documents_under_cmd(
    path: String,
    skip_folders: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        documents_under(Path::new(&path), &skip_set(skip_folders), false)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn invalidate_scan(path: Option<String>, scanner: tauri::State<'_, Arc<Scanner>>) {
    match path {
        Some(path) => scanner.invalidate(&PathBuf::from(path)),
        None => scanner.invalidate_all(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch tree: `{ "one/a.md": "text" }` written under a unique temp folder.
    struct Fixture(PathBuf);

    impl Fixture {
        fn make(files: &[(&str, &str)]) -> Self {
            let n = COUNTER.fetch_add(1, AtomicOrdering::SeqCst);
            let root =
                std::env::temp_dir().join(format!("md-boss-walk-{}-{n}", std::process::id()));
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
        fn names(&self, paths: Vec<String>) -> Vec<String> {
            paths
                .iter()
                .map(|p| {
                    Path::new(p)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
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
    fn extensions_decide_documents() {
        assert!(is_document("a.md"));
        assert!(is_document("CAPS.MD"));
        assert!(is_document("notes.txt"));
        assert!(is_document("data.csv"));
        assert!(!is_document("b.swift"));
        assert!(!is_document("no-extension"));
        assert!(!is_document("trailing."));
        assert!(!is_document(".md"));
        assert!(!is_document("d.mdx"));
    }

    #[test]
    fn mixed_tree_walk() {
        let f = Fixture::make(&[
            ("top.md", "a"),
            ("CAPS.MD", "case"),
            ("one/a.markdown", "a"),
            ("one/deep/deeper/b.txt", "b"),
            ("one/b.swift", "no"),
            ("one/no-extension", "no"),
            ("two/c.qmd", "c"),
            ("two/d.mdx", "no"),
            ("two/trailing.", "no"),
            ("node_modules/vendored.md", "no"),
            ("one/node_modules/also.md", "no"),
            ("three/.hidden.md", "no"),
            ("three/visible.md", "yes"),
            (".git/config.md", "no"),
        ]);
        let found = documents_under(f.path(), &skip(&["node_modules"]), false);
        assert_eq!(found.len(), 6, "{found:?}");
        let mut names = f.names(found);
        names.sort();
        assert_eq!(
            names,
            [
                "CAPS.MD",
                "a.markdown",
                "b.txt",
                "c.qmd",
                "top.md",
                "visible.md"
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_descended_but_a_linked_document_counts() {
        let f = Fixture::make(&[
            ("real/inside.md", "a"),
            ("anchor.md", "b"),
            ("real.md", "a"),
        ]);
        std::os::unix::fs::symlink(f.path().join("real"), f.path().join("link")).unwrap();
        std::os::unix::fs::symlink(f.path().join("real.md"), f.path().join("alias.md")).unwrap();
        let found = f.names(documents_under(f.path(), &skip(&[]), false));
        assert_eq!(found.iter().filter(|n| *n == "inside.md").count(), 1);
        assert!(found.contains(&"alias.md".to_string()));
        // The sidebar, though, shows a linked folder as a folder.
        let scanner = Scanner::default();
        let Listing::Entries { entries } = list_dir(f.path(), &skip(&[]), &scanner) else {
            panic!()
        };
        assert!(entries.iter().any(|e| e.name == "link" && e.is_dir));
    }

    #[test]
    fn skipped_folders_at_every_depth_and_stable_order() {
        let f = Fixture::make(&[
            ("node_modules/a.md", "no"),
            ("one/node_modules/b.md", "no"),
            ("one/two/node_modules/c.md", "no"),
            ("one/two/yes.md", "yes"),
        ]);
        assert_eq!(
            f.names(documents_under(f.path(), &skip(&["node_modules"]), false)),
            ["yes.md"]
        );

        let g = Fixture::make(&[
            ("b.md", "x"),
            ("a.md", "x"),
            ("c.md", "x"),
            ("zsub/one.md", "x"),
            ("asub/two.md", "x"),
        ]);
        assert_eq!(
            g.names(documents_under(g.path(), &skip(&[]), false)),
            ["a.md", "b.md", "c.md", "two.md", "one.md"]
        );
    }

    #[test]
    fn degenerate_folders_answer_empty() {
        let f = Fixture::make(&[]);
        assert!(documents_under(f.path(), &skip(&[]), false).is_empty());
        assert!(documents_under(&f.path().join("gone"), &skip(&[]), false).is_empty());
    }

    #[test]
    fn packages_are_opaque_only_when_asked() {
        let f = Fixture::make(&[
            ("Thing.app/Contents/notes.md", "inside"),
            ("outside.md", "yes"),
        ]);
        assert_eq!(documents_under(f.path(), &skip(&[]), false).len(), 2);
        assert_eq!(
            f.names(documents_under(f.path(), &skip(&[]), true)),
            ["outside.md"]
        );
    }

    #[test]
    fn budget_fails_open() {
        let files: Vec<(String, &str)> =
            (0..20).map(|i| (format!("junk/f{i}.swift"), "x")).collect();
        let refs: Vec<(&str, &str)> = files.iter().map(|(p, t)| (p.as_str(), *t)).collect();
        let f = Fixture::make(&refs);
        assert!(!contains_document(f.path(), &skip(&[]), 10_000, true));
        assert!(contains_document(f.path(), &skip(&[]), 2, true));
    }

    #[test]
    fn listing_hides_empty_folders_and_orders_naturally() {
        let f = Fixture::make(&[
            ("10.md", ""),
            ("9.md", ""),
            ("B.md", ""),
            ("a.md", ""),
            ("code/x.swift", ""),
            ("docs/deep/guide.md", ""),
            ("Zeta/readme.md", ""),
            ("node_modules/x.md", ""),
            (".hidden/x.md", ""),
        ]);
        let scanner = Scanner::default();
        let Listing::Entries { entries } = list_dir(f.path(), &skip(&["node_modules"]), &scanner)
        else {
            panic!()
        };
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["docs", "Zeta", "9.md", "10.md", "a.md", "B.md"]);
        assert!(entries[0].is_dir && entries[1].is_dir && !entries[2].is_dir);
    }

    #[test]
    fn listing_tells_missing_from_denied_and_scanner_memo_invalidates() {
        let f = Fixture::make(&[("empty/x.swift", "")]);
        assert_eq!(
            list_dir(&f.path().join("gone"), &skip(&[]), &Scanner::default()),
            Listing::Missing
        );

        let scanner = Scanner::default();
        let empty = f.path().join("empty");
        assert!(!scanner.contains_documents(&empty, &skip(&[])));
        fs::write(empty.join("now.md"), "here").unwrap();
        assert!(!scanner.contains_documents(&empty, &skip(&[])), "memoised");
        scanner.invalidate(&empty.join("now.md"));
        assert!(scanner.contains_documents(&empty, &skip(&[])));
        // A sibling with a shared prefix is not invalidated.
        let sibling = f.path().join("empty-old");
        fs::create_dir_all(&sibling).unwrap();
        assert!(!scanner.contains_documents(&sibling, &skip(&[])));
        scanner.invalidate(&empty);
        assert!(!scanner.contains_documents(&sibling, &skip(&[])));
    }

    #[cfg(unix)]
    #[test]
    fn listing_reports_denied() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc_geteuid() } == 0 {
            return;
        }
        let f = Fixture::make(&[("locked/x.md", "")]);
        let locked = f.path().join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let result = list_dir(&locked, &skip(&[]), &Scanner::default());
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(result, Listing::Denied);
    }

    #[cfg(unix)]
    extern "C" {
        #[link_name = "geteuid"]
        fn libc_geteuid() -> u32;
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("9.md", "10.md"), Ordering::Less);
        assert_eq!(natural_cmp("a", "B"), Ordering::Less);
        assert_eq!(natural_cmp("b", "B"), Ordering::Equal);
        assert_eq!(natural_cmp("file2", "file10"), Ordering::Less);
        assert_eq!(natural_cmp("x", "x1"), Ordering::Less);
    }
}
