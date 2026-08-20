# Port md-boss to Tauri - one codebase for macOS, Windows and Linux

The Swift app in `app/` is replaced by a Tauri v2 app living in `./tauri-rust`.
One fez + TypeScript frontend bundled by Vite under Bun, one Rust crate, three CI builds.

## Open questions

None.

## Not sure

None.

## Answered

1. Frontend framework: **fez** - already used in `web-demo`, no new dependency.
2. JS toolchain: **Bun** (install, scripts, test runner) + Vite.
3. Editor: **CodeMirror 6**.
4. Settings: **`~/.config/md-boss` on every OS** - same hand-editable path everywhere, as the README promises.
5. Swift app: **kept until parity**, then deleted in the last phase.
6. Releases: **GitHub Actions matrix with `tauri-action`**, replacing `hammer gh_pub`.
7. Auto-updater: **yes**, `tauri-plugin-updater` with signed bundles and `latest.json` on the release.
8. Task runner: **Hammerfile stays** - `hammer dev/build/test/icon` wrap `tauri` and `bun`.

## Why Tauri

md-boss is already half a web app.
The preview and the CSV table are `preview.js/css`, `csv.js/css`, `marked` and `highlight` rendered in a WKWebView, and every colour in the app is a `ThemeToken` whose raw value is a CSS custom property name.
The pure model layer - markdown scanning, link rewriting, moves, notes, fuzzy match, settings - has no AppKit in it and is covered by `Tests/`.
What is actually tied to macOS is small: the NSTextView editor, the WKWebView bridge, FSEvents/kqueue, `NSOpenPanel`, menus.
Those are exactly the things a shell framework provides.

Tauri gives a ~10 MB binary, native menus on all three platforms, and on macOS the same WKWebView the preview already renders in.
Electron is the fallback if WebKitGTK on Linux ever becomes a problem; the frontend is written so that swap is a shell swap, not a rewrite (see "Native bridge").

Rejected: Swift on Linux/Windows (no SwiftUI or AppKit there, so a second UI anyway), Wails (same webview story, weaker plugin ecosystem, v3 still alpha), Flutter/Qt/KMP (full rewrite, throws away the JS preview).

## Layout

```
tauri-rust/
  package.json         bun scripts: dev, build, test
  bun.lock
  vite.config.ts
  index.html
  src/
    main.ts              boot, root layout, keyboard routing
    native/              the bridge interface and its Tauri implementation
      bridge.ts          interface: fs, watch, dialog, shell, settings, menu, cli
      tauri.ts           implementation over @tauri-apps/api and plugins
    models/              ported 1:1 from app/Models - pure TS, no DOM
    ui/                  fez components: sidebar, panes, settings, toast, divider
    editor/              CodeMirror 6 setup, markdown keymap, highlighter, scroll sync
    preview/             preview.js/css, csv.js/css, marked, highlight - moved as-is
    theme/               palettes as CSS custom properties, ThemeChoice logic
  src-tauri/
    Cargo.toml
    tauri.conf.json      window, bundle, file associations, plugins, CSP
    capabilities/        plugin permissions per window
    icons/               generated from app/Resources/AppIcon.svg
    src/
      main.rs            builder, plugins, menu, single-instance, cli
      walk.rs            document walk, "has documents below" memo
      search.rs          full-text search over a root
      links.rs           inline link scan and rewrite on move/rename
      notes.rs           .md-boss store read/write
      menu.rs            app menu, per-OS labels
  tests/                 bun test ports of Tests/*.swift
```

`web-demo/`, `doc/`, `install.sh` stay where they are.

## Module mapping

| Swift today | New home | Notes |
|---|---|---|
| `MdBossApp.swift` (App, AppDelegate, menus, About) | `src-tauri/src/main.rs`, `menu.rs`, `src/main.ts` | menus are native via Tauri menu API; shortcuts registered in JS |
| `ContentView.swift`, `WindowAccessor` | `src/main.ts`, `tauri-plugin-window-state` | window frame persistence is the plugin |
| `AppSettings.swift` (`SettingsData`, merge-over-defaults load) | `src/models/settings.ts` | same one-struct rule; JSON merged over defaults; `~/.config/md-boss` on every OS |
| `CLIShim.swift`, Dock drop | `tauri-plugin-cli` + `tauri-plugin-single-instance`, `tauri.conf.json` file associations | `md-boss .` and `md-boss file.md` forward to the running instance |
| `MdBossManager*.swift` | `src/models/manager.ts` | singleton stays, it is what menus and views share |
| `MarkdownLinks`, `MarkdownScan`, `MarkdownSyntax`, `MarkdownList`, `LineIndex` | `src/models/*.ts` | pure ports, tests first |
| `FileMove.swift` | `src/models/fileMove.ts` + `src-tauri/src/links.rs` | validation in TS, rewrite pass in Rust (walks the root) |
| `DocumentSearch`, `ByteScan`, `DirectoryWalk`, `ProjectIndex` | `src-tauri/src/search.rs`, `walk.rs` | `ignore` + `grep-searcher` + `memchr` crates; cancellable via a generation counter |
| `DirectoryWatcher.swift` (kqueue) | `tauri-plugin-fs` watch | `notify` crate: FSEvents / inotify / ReadDirectoryChangesW; keep the 30 s backstop poll |
| `FuzzyMatch`, `SidebarSearch` | `src/models/*.ts` | pure |
| `Annotations`, `NoteShift`, `MdBossManagerAnnotations` | `src/models/notes.ts` + `src-tauri/src/notes.rs` | store IO in Rust, shifting logic in TS |
| `FileTreeModel.swift` | `src/models/fileTree.ts` | flatten, merge-not-replace refresh, file-anchored cursor |
| `Theme.swift`, `ThemePalettes.swift`, `ThemeCSS.swift` | `src/theme/palettes.css`, `src/theme/theme.ts` | tokens are already CSS vars; `ThemeChoice` light/dark memory ported; contrast test ported |
| `TextStyles.swift` | `src/ui/styles.css` | one class per text role, sizes derived from the four `FontSetting`s |
| `SettingsView.swift` | `src/ui/settings.ts` | theme grid + four sizes, in-window panel |
| `SidebarView`, `SidebarRow`, `RootPicker`, `SearchPane`, `PaneToggleBar`, `NotesPane`, `StatusBarView`, `PaneDivider`, `Toast`, `PromptPanel` | `src/ui/*.ts` | `PromptPanel` becomes an in-window dialog; native dialogs only for open/save/trash |
| `MarkdownTextView`, `EditorTextView`, `MarkdownHighlighter`, `LineNumberRuler` | `src/editor/` | CodeMirror 6: decorations for highlighting, custom keymap for Return/Cmd-B/I/K, drop handler for link insert, `lineBlockAt` for line-anchored scroll sync |
| `Preview/*.swift` (WKWebView bridge, page builder, scheme handler, link target) | `src/preview/`, `tauri.conf.json` asset protocol | preview is an `iframe` with `srcdoc`; local images via Tauri asset protocol scoped to the active roots; link routing stays in `preview.js` posting to the parent |
| `CSVPane`, `CSVPreviewView`, `CSVPageBuilder` | `src/preview/csv.ts` | parse moves to TS, same `csv.js/css` |
| `Resources/*.js, *.css` | `src/preview/` | byte-identical move |
| `AppIcon.svg/.icns` | `src-tauri/icons/` via `tauri icon` | `hammer icon` becomes `tauri icon AppIcon.svg` |
| `Tests/*.swift` | `tests/*.test.ts` | `bun test`; ported before the code they cover |

## Native bridge

Everything that touches the OS goes through one interface in `src/native/bridge.ts`:

```ts
interface Native {
  fs: { read, write, list, stat, move, trash, mkdir, exists }
  watch(root: string, cb: (events) => void): () => void
  dialog: { openFolders, openFile, confirm }
  shell: { reveal(path), openExternal(url) }
  paths: { config(): string, home(): string }   // config() is always ~/.config/md-boss
  commands: { walk, search, rewriteLinks, readNotes, writeNotes }
  menu: { set(items), onAction(cb) }
  cli: { onOpen(cb) }   // args from a second instance, dock/file-association opens
}
```

The Tauri implementation is the only file that imports `@tauri-apps/*`.
Models and UI import the interface.
That is the hedge against WebKitGTK: an Electron implementation of the same interface is a shell swap.

## Rust side

Small by design - the frontend owns the app, Rust owns the filesystem-heavy paths:

* `walk` - list a directory tree of document files, hiding folders with none below, memoised per root, invalidated by watcher events.
* `search` - case-sensitivity by query capital, byte prefilter, bounded results, cancelled by generation id.
* `rewrite_links` - the hand-written scanner ported from `MarkdownScan`/`MarkdownLinks` (fences, code spans, nested link text, balanced parens), applied to every document under the root on move or rename.
* `notes` - read/write `.md-boss`, including the legacy bookmark/comment shape on read.
* menu, single-instance forwarding, cli args.

No `#[cfg(target_os)]` except menu labels ("Reveal in Finder" / "Show in Explorer" / "Show in file manager") and the macOS appearance pin.
Paths are built with `Path::join`, never string concat, so Windows drive letters and separators fall out of `std::path`.

## Phases

Each phase ends with a working app - never trade a working product for unfinished complexity.

1. Scaffold `tauri-rust` with Bun, Vite, fez, `bun test`, and the `Hammerfile` tasks; one window that opens a folder and renders a `.md` through the moved `preview.js`.
2. Port models and their tests: scan, links, syntax, list, lineIndex, fuzzy, settings, fileMove validation, notes shifting, theme contrast.
3. Sidebar: root picker, tree with hidden-empty-folders (Rust `walk`), watcher, 30 s backstop, keyboard navigation, type-to-jump.
4. Editor: CodeMirror 6, raw-pane highlighting from `MarkdownSyntax`, Return rules, Cmd-B/I/K, line-anchored scroll sync, external-change banner, save.
5. Themes and text sizes: eight palettes as CSS vars, Cmd-Shift-D polarity memory, settings panel, Cmd-+/-, reading measure arrows.
6. Notes pane: add/edit/delete, three scopes, titles from the line, `.md-boss` watched.
7. Search: Cmd-Shift-F across the root (Rust `search`), Cmd-P go to file, sidebar takeover and Esc.
8. Moving, renaming, trash, link rewrite, drag into the raw pane, CSV pane.
9. Menus, shortcuts, cli + single instance, file associations, window state, About.
10. Packaging: dmg (universal), msi + nsis, AppImage + deb; updater signing keys and `latest.json`; CI matrix; `install.sh` pointed at the new assets; README and `doc/CODE_STRUCTURE.md` updated.
11. Remove `app/`, `Package.swift`, Swift `Tests/`, and the Swift parts of the `Hammerfile`.

## Build and CI

* Dev on the Mac: `rustup`, `cargo`, `bun`, then `hammer dev` (= `bun install` + `cargo tauri dev`).
* `Hammerfile` tasks: `dev`, `build` (`--release`), `test` (`bun test` + `cargo test`), `lint` (`tsc --noEmit`, `cargo clippy`), `icon` (`tauri icon app/Resources/AppIcon.svg`), `clean`. `gh_pub` goes away - tags trigger the release workflow.
* Linux build host needs `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`.
* Windows needs the WebView2 runtime (preinstalled on Windows 10/11) and the MSVC toolchain.
* Release: one workflow, matrix of `macos-latest`, `windows-latest`, `ubuntu-22.04`, `tauri-apps/tauri-action` uploads the bundles to one GitHub release per tag.
* Updater: `tauri-plugin-updater`; the private signing key lives in a GitHub Actions secret (`TAURI_SIGNING_PRIVATE_KEY`), the public key in `tauri.conf.json`; `tauri-action` writes `latest.json` next to the bundles and the app checks it on launch.
* Minimum versions: macOS 10.15 (Tauri floor; README can keep saying 14), Windows 10, Linux with webkit2gtk 4.1 (Ubuntu 22.04 and newer).

## What is lost or changes

* `NSTextView` services: OS dictation, Lookup, Services menu. CodeMirror keeps IME, spell check (webview native), undo, drag and drop.
* `NSOpenPanel` appearance pinning to the theme - Tauri dialogs follow the OS theme only.
* The `~/bin/md-boss` shim is replaced by the cli plugin; on Windows it is `md-boss.exe` on PATH from the installer.
* kqueue's per-directory descriptor cap goes away; `notify` watches recursively with one handle.

## gitignore additions

```
/tauri-rust/node_modules
/tauri-rust/dist
/tauri-rust/src-tauri/target
/tauri-rust/src-tauri/gen
```

## Out of scope

* Mobile targets.
* Plugin or extension system.
* Any feature the Swift app does not have today - parity first.

## Decisions made while porting

* Fez is pinned to a GitHub commit (`github:dux/fez#fb09f4c`) because npm's 0.5.3 predates `this.local`, `onRefresh` and the root-level style scoping AGENTS.md documents. Switch to the npm range once 0.6.0 is published.
* `.fez` components compile at runtime inside Fez, so they cannot `import` modules. `src/app.ts` builds one `MdBoss` global - `native`, the preview page builder, the theme - and that object is the whole surface a component may reach.
* `grid-template-areas` is avoided in `.fez` styles: the fez CSS minifier collapses the whitespace between area names and the value turns invalid. Explicit `grid-column` / `grid-row` instead.
* Outside Tauri (plain vite in a browser) `main.ts` installs an in-memory `Native` over `src/native/sample.ts`, so UI work and screenshots do not need the native shell; tests use the same `memoryNative`.
* Preview page -> app messages go through `window.parent.postMessage`; the Swift `webkit.messageHandlers` path is gone from the tauri copy of `preview.js`. The two vendored libraries are byte-identical copies.
* `tauri-plugin-fs` needs its `watch` cargo feature or `watch()` fails with "Command watch not found"; the `DirectoryWatcher` logs that warning instead of swallowing it.
* `MD_BOSS_CONFIG` (read by the Rust `config_dir` command) points a dev build or a test at a scratch config folder; without it the app uses `~/.config/md-boss` on every OS. `hammer tauri:probe` launches the dev app that way and captures its window to `tmp/probe.png` - the real-app check for UI tasks, since the native folder dialog cannot be driven from here.
* In dev builds `console.error/warn/info` from the webview are forwarded to the Rust log, so `tauri dev` shows what the page complains about.
* Keyboard focus is the DOM's: the sidebar tree is a focusable element (`tabIndex = 0`) that owns the bare keys while focused, the way the Swift `SidebarView` was `.focusable()`; modified combinations belong to `src/ui/keys.ts` (later the native menu) and are left alone. The open root picker takes keys in the capture phase, so it is modal over the tree behind it. `fez`'s `dump.js` utility calls `preventDefault()` on every Escape at document level - harmless, but it means `defaultPrevented` is no evidence of who handled an Escape.
* Fez skips a render whose HTML hash is unchanged, `afterRender` included, so a class on the component's wrapper node that is not part of the template (`.no-sidebar`, `.dragging` on `md-boss-app`) is toggled by hand where the state changes, not in `afterRender`. Component tag selectors (`side-bar { }`) do not match inside another component's style - the rendered node is `div.fez-side-bar`, so that is the selector.
* CodeMirror is three packages - `@codemirror/state`, `view`, `commands` - behind one small surface in `src/editor/editor.ts` (`setText`, `getText`, `setFontSize`, `focus`, `destroy`), so the pane component and the manager never see CodeMirror types. Colours are theme CSS vars inside `EditorView.theme`, so a theme switch is a variable change. `OpenDocument` (`src/models/document.ts`) owns text / savedText / CRLF round-trip; the dirty flag is `text !== savedText`, the manager emits only when it flips - a keystroke is not an app-wide event.
* Pane toggles are matched on `event.code` (`KeyR` / `KeyV` / `KeyN`): with Alt held, macOS turns `event.key` into a symbol (Alt-R is "®"). Cmd-S and the toggles live in `src/ui/keys.ts` until the native menu (P9) takes them.
* `restoreSession` reopens `lastOpenedFile` at boot, as the Swift app did, and forgets a path that is gone rather than reporting it.
* Raw highlighting is a CodeMirror `ViewPlugin` (`src/editor/highlight.ts`) over `MarkdownSyntax.scan`: only the visible lines are decorated, rebuilt on document or viewport change, while the fence pass (`src/models/markdownHighlight.ts`, the port of the Swift line and fence bookkeeping) runs over the whole document because it is a predicate per line. Kinds become `.md-<kind>` classes coloured by theme tokens in `editor.ts`, block-level rules before inline ones so overlapping spans resolve the way "later spans win" did in AppKit. CSV (`documentKind`) and files past 20 000 lines stay plain.
* The raw pane's Return and Cmd-B / I / K are `src/editor/markdownKeymap.ts`: transaction builders over an `EditorState` (testable without a DOM, `tests/markdownKeymap.test.ts`) plus thin commands, placed before the default keymap. Return inserts a plain newline rather than CodeMirror's indenting one, as NSTextView did; a document without the highlighter (CSV) gets no list rule. `Native` gained `clipboard.readText/writeText`, the webview's own clipboard in Tauri - read only from a key press (Cmd-K), which WebKit and WebView2 allow without a prompt.
* Scroll sync is `src/models/scrollSync.ts` (the ScrollSync.swift rule, time passed in) owned by the manager; the editor reports `lineBlockAtHeight` at the top of its scroller, fractional within the line, and follows with `lineBlockAt`; the preview keeps the `scroll` message / `mdScrollToLine` pair from `preview.js`. Both sides ignore their own scroll events for 120 ms after being scrolled by code - in the DOM a programmatic scroll lands on the next frame, so the synchronous "isFollowing" flag AppKit allowed is not enough. The pane toggle bar is `pane-toggle-bar.fez` above the root picker; notes is a 350px placeholder column until P6.
* External changes: `OpenDocument.syncWithDisk` keeps the Swift stamp rule (mtime + size, so one-second volumes still show a rewrite) and its outcomes - a clean buffer reloads, a dirty one gets the conflict banner, a missing file detaches and keeps the buffer. The watcher and a 2 s poll both call it through the manager, which serialises the calls. A rewrite with the same bytes only moves the stamp. `change-banner.fez` sits in both panes; `ScrollMemory` is session-only and both panes record into it before the sync; `back-button.fez` floats over the preview and Cmd-[ walks `manager.history`.
* Fez gotcha hit twice: a template that renders to an empty string leaves fez's render hash untouched, so the next identical non-empty render is skipped as unchanged. Any component whose whole body is an `{#if}` (the banner, the Back button) needs a stable root with a `hidden` class instead.
* Switching away from a dirty document asks through the native two-button question dialog (Save / Don't Save) for now; the in-window three-way prompt with Cancel is queued as its own task.
* Theme switching: `installThemeSync` (src/theme/apply.ts) swaps the chrome's `<style id=theme>` from settings; the preview pane calls `mdSetTheme` on the live page so the DOM and scroll survive; the manager carries `setTheme` / `toggleLightDark` over the ported `ThemeChoice`. Nothing reads `prefers-color-scheme`; `rootCSS` sets `color-scheme` so scrollbars and the caret follow the palette. The "View > Theme" list is `MdBoss.THEMES` + `manager.setTheme` - drawn by the native menu in P9 and the settings grid in the next P5 task.
* Text sizes: `src/ui/styles.css` holds the four text-style classes (`text-default` / `text-buttons` / `text-small` / `text-title`) over `--font-*` vars that `src/theme/apply.ts` writes from settings next to the theme block; components carry no pixel sizes, only classes and em ratios. Cmd-+/-/Alt-Cmd-0 go through `manager.zoom` / `resetZoom` (editor + preview + measure); the settings panel (`settings-panel.fez`, Cmd-,) is an in-window overlay opened through the `Panels` emitter, since the command comes from outside the component tree.
* `measure-controls.fez` floats top-right of the preview page (the Back button's opposite corner), stepping `manager.changeMeasure` by 2em; the page follows through `mdSetMeasure` and the side-by-side preview width follows the setting through the app shell.
* Notes IO is `src-tauri/src/notes.rs` (`read_notes_cmd` / `write_notes_cmd`): the three-shape read and the canonical, atomic, removed-when-empty write, with the same fold as `notes.ts` so both sides agree about what a file says. `src/models/annotationStore.ts` is the AnnotationStore.swift port over it: one store per root plus the fallback in the config dir, directory-watched and reloaded on an external `.md-boss` edit, the cross-store duplicate repair written back. A reload that started before a local write re-reads instead of landing stale files (generation counter) - the AppKit version never had the race because its reads were synchronous.
* Notes UI: `notes-pane.fez` over `partitionNotes`; the manager carries the caret (`reportCursor`, from the editor's selection changes and from a right-click in either pane), `requestScroll` / `highlightedLine` (the landing band in the editor, `mdHighlightLine` in the page) and the note commands. Prompts and right-click menus are in-window components (`prompt-panel.fez`, `context-menu.fez`) reached through small emitters (`Prompts`, `ContextMenus`) because the commands come from shortcuts and menus outside the component tree; the preview page now posts the click position with its `context` message and suppresses the webview's own menu. Note shifting rides on the editor's change deltas (`onChange(text, edit)`), asked only when the document has notes. `tree.reveal` opens the folders above a file and lands the cursor on it.
* Search is `src-tauri/src/search.rs` (`search_cmd`): the file set is `walk::documents_under` - the sidebar's own walk, as DocumentSearch.swift insisted - rather than the `ignore` crate, so the search never answers "which files does this app show you" differently from the tree; and a hand-written per-line scanner with a `memchr` byte prefilter (ASCII only, with the KELVIN SIGN escape ByteScan.swift had) rather than `grep-searcher`, since there is no regex to speak of. Columns are UTF-16, lines split on `\n`; budgets per file / total / files and a generation id (`AtomicU64`, `fetch_max`) for cancelling a superseded query between files. The memory Native carries a JS twin for tests and the browser build.
