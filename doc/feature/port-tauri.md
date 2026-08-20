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
