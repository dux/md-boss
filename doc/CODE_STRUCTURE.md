# Code structure

md-boss is a markdown viewer and editor that looks like paper.
Folder tree on the left, rendered preview or raw editor on the right, notes anchored to lines, in a warm paper theme, a matching dark one, or one of six ported schemes.

The repository holds two apps that ship side by side:

* `tauri-rust/` - the cross-platform app: Tauri v2, a Rust crate for the filesystem-heavy paths, a fez + TypeScript frontend bundled by Vite under Bun.
  macOS, Windows and Linux, the `hammer tauri:*` tasks, the release workflow and `install.sh`.
  This file describes it.
* `app/` - the original Swift macOS app: SwiftPM, `Package.swift`, `Tests/`, the top-level `hammer dev` / `build` / `test` tasks.
  See [CODE_STRUCTURE_SWIFT.md](CODE_STRUCTURE_SWIFT.md).

The port plan, and every decision made while porting, is [feature/port-tauri.md](feature/port-tauri.md).
Read its "Decisions made while porting" before changing anything non-obvious; most of the "why" lives there.

## Layout

```
tauri-rust/
  package.json           bun scripts: dev (vite), build (tsc + vite build), test, tauri
  bun.lock
  vite.config.ts         the .fez plugin (each file becomes a Fez.compile call), port 1420
  index.html             <style id="theme">, styles.css, main.ts, <md-boss-app>
  tsconfig.json          strict, bun-types, src + tests
  bin/md-boss            the CLI launcher: execs the installed binary, installed by hammer tauri:link
  src/
    main.ts              boot: pick the Native, create the app object, menu, cli, fez components
    app.ts               createApp(): the MdBoss global - the whole surface a .fez component may reach
    env.d.ts             vite / fez ambient types, `*.fez` module declaration
    native/
      bridge.ts          the Native interface (fs, dialog, shell, paths, commands, menu, cli, app, updater) + installNative/native()
      tauri.ts           the Tauri implementation - the ONLY file that imports @tauri-apps/*
      memory.ts          the in-memory twin: tests and the browser build, JS twins of the Rust commands
      sample.ts          the tiny tree the browser dev page opens
    models/              pure TS, no DOM, no @tauri-apps - ported 1:1 from app/Models
      manager.ts         the central state: roots, open document, panes, commands, toast, prompts
      settings.ts        SettingsData (one object, merged over defaults), panes, font settings
      settingsStore.ts   the live settings, debounced write to settings.json, flush on quit
      roots.ts           roots.txt as text (MRU list, first line active)
      rootFolders.ts     the root folders store over roots.ts
      fileTree.ts        FileNode / flattened rows, expansion, keyboard index arithmetic
      fileTreeModel.ts   the tree state, merged not replaced on refresh, listed through the Rust walk
      fileKinds.ts       DOCUMENT_EXTENSIONS, documentKind (markdown / csv), isImage, documentName
      directoryWatcher.ts  per-directory watching of the active root + expanded folders, capped
      document.ts        OpenDocument: text, savedText, dirty flag, CRLF round-trip, syncWithDisk
      scrollMemory.ts    where each document was left (line for text, pixels for a table), per session
      scrollSync.ts      raw <-> preview, last-driver-wins with a quiet window
      lineIndex.ts       line starts as UTF-16 offsets, bisected
      markdownScan.ts    the shared rules: fences, code spans, nested link text, balanced parens
      markdownLinks.ts   relative paths, inline links, the TS rewriter (memory twin + editor snippets)
      markdownSyntax.ts  one line of source -> the spans the raw pane paints
      markdownHighlight.ts  fence state per line and how far an edit's change reaches
      markdownList.ts    what Return does on a list / quote / task line
      markdownWrap.ts    Cmd-B / I / K as text edits
      fileMove.ts        move and rename validation, said the way the user reads it
      linkTarget.ts      what a clicked preview link is: external / file / directory / missing
      notes.ts           the Note record, titles from the line, the .md-boss file shape
      noteShift.ts       how a line-anchored note moves under an edit
      annotationStore.ts every loaded .md-boss: one per root + the fallback in the config dir
      sidebarSearch.ts   the two search modes (Find in Project, Go to File) and their state
      fuzzyMatch.ts      the Go to File scorer
      typeAhead.ts       type-a-name-to-jump in the tree
      csvTable.ts        RFC 4180 parse, delimiter sniffed, 5 000-row cap
      appMenu.ts         the menu bar as data: buildAppMenu(state), diffMenu, matchesAccelerator
      cli.ts             `md-boss <paths>` made absolute against the caller's cwd
      platform.ts        macos / windows / linux from the user agent, revealLabel
      prompts.ts         text / confirm / discard prompts asked from outside the component tree
      toast.ts           one transient message at a time, injectable timers
      updater.ts         the self-update flow: check on launch, download, "Restart to update"
      paths.ts           pure path text, forward slashes throughout
    editor/              CodeMirror 6 behind one small surface
      editor.ts          createEditor: setText / getText / format / scrollToLine / notes / drop, theme via CSS vars
      highlight.ts       ViewPlugin painting markdownSyntax spans over the visible lines
      markdownKeymap.ts  Return, Cmd-B/I/K, Alt-Return as transactions (testable without a DOM)
      notesGutter.ts     note markers in the gutter and the landing band
    preview/
      page.ts            buildPreviewPage: the srcdoc HTML shell, CSP nonce, <base href>, inlined libs
      csvPage.ts         buildCSVPage: the table page, tighter CSP
      preview.js/.css    the markdown page - the Swift app's, posting to window.parent instead of webkit.messageHandlers
      csv.js/.css        the table page
      marked.min.js      vendored
      highlight.min.js   vendored
    theme/
      theme.ts           TOKENS, THEME_IDS, the eight palettes (the only hex literals), rootCSS, contrast, ThemeChoice
      apply.ts           chromeCSS (tokens + --font-* vars) into <style id=theme>, installThemeSync
    ui/
      styles.css         the text style classes (.text-default/.text-buttons/.text-small/.text-title/.text-mono), body
      md-boss-app.fez    the root layout: sidebar, panes, dividers, overlays
      side-bar.fez       the tree, keyboard navigation, drag targets, swaps in search-results
      root-picker.fez    the root folder select box and its menu
      pane-toggle-bar.fez  the view / raw / notes segments
      search-field.fez   the permanent search field above the folder box
      search-results.fez Find in Project and Go to File result lists
      editor-pane.fez    CodeMirror host, change banner, drop target
      preview-pane.fez   the iframe (srcdoc once, then messages), scroll sync, theme pushes
      csv-pane.fez       the table iframe
      notes-pane.fez     notes in three scopes
      settings-panel.fez the theme grid and the four font sizes (Cmd-,)
      prompt-panel.fez   text / confirm / discard prompts
      context-menu.fez   in-window right-click menus
      change-banner.fez  what the file did on disk
      back-button.fez    "< go back" over the rendered page
      measure-controls.fez  the reading-measure arrows
      toast-overlay.fez  the transient message above the footer
      appMenu.ts         installs the menu model through Native.menu and pushes diffs as state changes
      keys.ts            Escape, plus the keyboard table routed from keydown where the menu bar cannot
      menus.ts           ContextMenus emitter
      panels.ts          Panels emitter (settings)
      dragPoint.ts       isInside: which element a native drag point is over
  src-tauri/
    Cargo.toml           tauri + plugins: cli, single-instance, window-state, dialog, fs (watch), opener, updater, process, log; trash, memchr
    tauri.conf.json      window, CSP null (pages carry their own), asset protocol, cli args, updater endpoint + pubkey, bundle targets, file associations
    build.rs
    capabilities/default.json  what the main window may call (fs scoped **, dialog open, opener, updater, process restart, log)
    icons/               generated by `hammer tauri:icon` from app/Resources/AppIcon.svg
    src/
      main.rs            builder, plugins, the small commands (config_dir, trash, quit, asset roots), --help / --version, RunEvent::Opened
      walk.rs            list_dir / documents_under, the "has documents below" memo (Scanner), invalidate_scan
      search.rs          search_cmd: walk + memchr prefilter + per-line scan, budgets, Generation cancel
      links.rs           the link scanner over bytes and rewrite_links_cmd (plan + atomic writes)
      notes.rs           read_notes_cmd / write_notes_cmd: the .md-boss store, three shapes in, one out
      cli.rs             launch / forward / opened / deliver: argv, second launches, Finder opens, the Inbox
  tests/                 bun test - one file per model, plus the commands through the memory Native
```

`dist/`, `node_modules/`, `src-tauri/target/` and `src-tauri/gen/` are build output and gitignored.

## How the pieces fit

### The app object

`.fez` components compile at runtime inside Fez, so they cannot `import` modules.
`src/app.ts` builds one `MdBoss` global - `native`, the manager, settings, the page builders, the theme list, the prompt / panel / menu emitters - and that object is the whole surface a component may reach.
Adding something a component needs means adding it there, on purpose.

### Native bridge

Everything that touches the OS goes through the `Native` interface in `src/native/bridge.ts`.
`src/native/tauri.ts` is the only file that imports `@tauri-apps/*`; models and UI import the interface.
That is the hedge against a webview problem on any platform: another shell is one file, not a rewrite.

`src/native/memory.ts` is the second implementation: an in-memory filesystem plus JS twins of every Rust command (walk, search, rewrite links, notes), a recording menu, a cli that can play a second launch, an updater a test can `offer` a version to.
Tests run on it, and so does plain `vite` in a browser (`main.ts` picks it when `__TAURI_INTERNALS__` is absent), so UI work and screenshots do not need the native shell.

### Models

`src/models/` is pure TypeScript: no DOM, no `@tauri-apps`, time passed in where it matters, so every rule is tested under `bun test` without a window.
`Manager` is the one singleton - menu commands live outside the component tree and cannot read view state - and it emits only when something app-wide flips (a keystroke is not an event; the dirty flag flipping is).

### Editor

CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `search`) behind `src/editor/editor.ts`, so the pane component and the manager never see CodeMirror types.
Colours are theme CSS vars inside `EditorView.theme`, so a theme switch is a variable change.
Raw highlighting is a `ViewPlugin` over `markdownSyntax.scan` for the visible lines; the fence bookkeeping runs over the whole document.
Return and Cmd-B / I / K are transaction builders in `markdownKeymap.ts`, placed before the default keymap.

### Preview

The rendered page is an `iframe` with `srcdoc`, built once per pane by `src/preview/page.ts` (or `csvPage.ts`) with the theme block, the vendored `marked` / `highlight.js` and `preview.js/.css` inlined under a nonce CSP; every later change - text, theme, font size, measure, scroll, highlight - is a message into the live page, so the DOM and the scroll position survive.
The page posts back (`link`, `scroll`, `context`) through `window.parent.postMessage`.
Relative links resolve against a `<base href>` of the document's folder; local images go through the Tauri asset protocol, whose scope starts empty and grows to the sidebar's roots (`allow_asset_roots_cmd`).

### Theme

Every colour in the app is a token whose name is the CSS custom property both the chrome and the page read.
`src/theme/theme.ts` holds the eight palettes - the only hex literals in the app - and `rootCSS` turns one into `:root { --token: ... }`.
`src/theme/apply.ts` writes that plus the `--font-*` sizes into `<style id="theme">` and keeps it in step with settings.
Nothing reads `prefers-color-scheme`; the app is *told* which theme to use.
`tests/theme.test.ts` gates every palette on completeness and contrast (7:1 body, 4.5:1 muted).

### Rust crate

Small by design - the frontend owns the app, Rust owns what walks a tree or must be native:

| module | commands | what |
|---|---|---|
| `main.rs` | `config_dir`, `trash_cmd`, `quit_cmd`, `allow_asset_roots_cmd` | the builder and plugins; `--help` / `--version` answered before a window exists; `RunEvent::Opened` on macOS |
| `walk.rs` | `list_dir_cmd`, `documents_under_cmd`, `invalidate_scan` | one `read_dir` per level, hidden and `skipFolders` left out, symlinks never descended; `Scanner` memoises "has documents below" |
| `search.rs` | `search_cmd` | the sidebar's own walk, a `memchr` prefilter, a per-line scanner, budgets, a `Generation` id that cancels a superseded query between files |
| `links.rs` | `rewrite_links_cmd` | the markdown link scanner over bytes, `plan` over every document under the root (an unsaved buffer wins), atomic writes; answers written / buffered / failed |
| `notes.rs` | `read_notes_cmd`, `write_notes_cmd` | the `.md-boss` store: three legacy shapes fold into one on read, canonical atomic write, removed when empty |
| `cli.rs` | `launch_cmd` | argv through the cli plugin's clap config; a second launch forwarded by single-instance; Finder / Dock opens; an `Inbox` so nothing arriving before the page asks is lost |

The menu bar is built from TypeScript (`src/models/appMenu.ts` + `src/ui/appMenu.ts` over `@tauri-apps/api/menu`), not in Rust: every label and enabled flag is manager state that lives in the page.
The native accelerators are the shortcuts; `src/ui/keys.ts` only carries Escape and the one item the bar must not take (Move to Trash off macOS).

`src-tauri/capabilities/default.json` is what the main window may call: the fs plugin scoped to `**` (the sidebar lists whatever the user points it at), `dialog:allow-open`, the opener for any path or URL, updater + process restart, log.
`tauri.conf.json` declares the cli argument, the updater endpoint and public key, the bundle targets (`app dmg msi nsis appimage deb` - the bundler keeps the ones for the host OS), the `bin/md-boss` resource and the file associations.

### Tests

`tauri-rust/tests/*.test.ts` under `bun test`: one file per model, the Swift `Tests/` ported before the code they cover, plus the commands driven through the memory Native (`fileCommands`, `notesCommands`, `discard`, `appMenuController`, `watcher`, `memoryNative`).
`tests/appMenu.test.ts` parses the README keyboard table and asserts every shortcut in it is an accelerator on a menu item on all three platforms - so the README table is a test fixture.
`cargo test` covers the Rust modules (walk, search, links, notes, cli).

## Conventions

* Colours: only theme tokens - `var(--accent)` and friends - never a literal colour in a component or in `editor.ts`.
  The palettes in `src/theme/theme.ts` are the one place a hex may appear.
* Text styles: only the classes in `src/ui/styles.css` (`.text-default`, `.text-buttons`, `.text-small`, `.text-title`, `.text-mono`); components carry no pixel sizes, only classes and em ratios.
  The four sizes come from settings through `--font-*`.
* The preview and csv pages are *told* which theme to use - never `prefers-color-scheme` in their CSS.
* `@tauri-apps/*` is imported by `src/native/tauri.ts` only.
  Anything new the app needs from the OS is a method on `Native`, with a memory twin.
* `.fez` files: read `~/dev/dux/gems/fez/AGENTS.md` first.
  Known traps recorded in the port notes: no `grid-template-areas` (the minifier breaks it), component tag selectors do not match inside another component's style (use `.fez-<name>`), a template that renders to an empty string poisons the render hash (keep a stable root with a `hidden` class), wrapper-node classes outside the template are toggled by hand.
* Fez compiles `.fez` files at runtime (the vite plugin only wraps them in `Fez.compile`), so a template error shows in the running app, not in `tsc`.
  `hammer tauri:probe` launches the dev app against a scratch config and captures its window - the check for UI work.
* Hammerfile tasks (namespace `tauri:`): `dev`, `build [--release]`, `test`, `lint`, `icon`, `link`, `probe`, `clean`, `install`.
  `hammer tauri:lint` is `tsc --noEmit` + `cargo clippy -D warnings`; `hammer tauri:test` is `bun test` + `cargo test`.
  Run both when you are done.
* Paths inside the page are forward-slash text (`src/models/paths.ts`); Rust builds paths with `Path::join`.
  The only `#[cfg(target_os)]` is the macOS `RunEvent::Opened`.

## Data files

* `~/.config/md-boss/settings.json` - `SettingsData`, merged over defaults on load, unknown keys dropped.
  Same path on every OS.
* `~/.config/md-boss/roots.txt` - the sidebar's root folders, one absolute path per line, MRU order, first line active.
* `<root>/.md-boss` - the notes store for documents under that root; `~/.config/md-boss/annotations.json` for documents outside every root.
  JSON `{ "notes": [ { "path", "line", "title"?, "body"? } ] }`, paths tilde-abbreviated, removed when empty, watched.
* `.window-state.json` under the app data dir (`~/Library/Application Support/com.dux.md-boss` on macOS, the platform equivalents elsewhere) - position, size, maximized, kept by `tauri-plugin-window-state`.
  Not a setting to hand-edit.
* `MD_BOSS_CONFIG=<dir>` points a dev build or a test at a scratch config folder instead of `~/.config/md-boss`.

## Build and release

`hammer tauri:dev` is `bun install` + `bun tauri dev` (Vite on 1420, the Rust crate rebuilt on change).
`hammer tauri:build --release` builds the platform bundles under `src-tauri/target/**/release/bundle/`; the dmg is universal only when rustup has both Apple targets, otherwise the host arch.
A release build needs the updater signing key (`TAURI_SIGNING_PRIVATE_KEY` or `./tmp/md-boss-updater.key`) because `createUpdaterArtifacts` is on.

`.github/workflows/release.yml` runs on a `v*` tag: a test job, then macOS (universal) / Windows / Ubuntu 22.04 builds through `tauri-action`, one GitHub release per tag with the bundles and `latest.json`.
`install.sh` reads the latest tag off the releases redirect and installs the dmg (macOS) or the deb / AppImage (Linux), plus the `md-boss` launcher into `~/bin`.

## Swift app (macOS)

The original app in `app/` stays: `Package.swift`, `Tests/`, `MdBoss.entitlements`, the top-level Hammerfile tasks (`hammer dev` / `build` / `test` / `lint` / `watch` / `icon` / `register` / `gh_pub` / `demo` / `shots`).
Its architecture, conventions and build gotchas are in [CODE_STRUCTURE_SWIFT.md](CODE_STRUCTURE_SWIFT.md).
The two apps share `web-demo/`, `doc/THEMES.md` (the palettes are the same eight), `app/Resources/AppIcon.svg` and the `preview.js` / `csv.js` renderers, of which the Tauri copies under `src/preview/` differ only in how they post back to the app.
