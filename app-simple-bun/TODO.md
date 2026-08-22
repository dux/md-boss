# TODO - app-simple-bun

The working list for this root. Phases in order; a phase is done when every box in it is ticked.

## 1. Skeleton

- [x] folder, `.gitignore`, `README.md`, this file
- [x] `Hammerfile` with install / lint / test / server / dev / build / run / icon / payload / link
- [x] `package.json`, `tsconfig.json`, `vite.config.ts` (port 1430, fez plugin), `index.html`

## 2. Shell v0 (Rust: tao + wry)

- [x] window + webview; loads `MDBOSS_DEV_URL` in dev, `app://` from the payload's `dist/` otherwise
- [x] finds `bun` on PATH, picks a free port, spawns `bun server/main.ts --port N --token T`
- [x] injects `window.__MDBOSS = { port, token, platform, version, argv, cwd }` before the page runs
- [x] "bun not found" page with the install command
- [x] child is killed on exit, restarted (with a page event) if it dies
- [x] ipc: `{id, method, params}` in, `__mdbossReply(id, result, error)` out; `app.version`, `app.exit` answered

## 3. Server v0 (Bun)

- [x] WebSocket JSON-RPC on 127.0.0.1:port, token checked on connect
- [x] `fs.read/write/create/rename/trash/mkdir/list/stat/exists`, `paths.home/config/join`
- [x] `watch`: per-directory `fs.watch`, debounced, pushed as `{event: 'watch', data}`
- [x] round trip from the page: list a folder, show it (verified headless: ping, listDir, search, stat, watch, 403 on a bad token)

## 4. Frontend

- [x] copy `../tauri-rust/src` and `tests`; drop `native/tauri.ts` and the `@tauri-apps/*` deps
- [x] `native/bun.ts`: `Native` over the socket (server methods) and wry ipc (shell methods)
- [x] `main.ts` picks `bun.ts` when `window.__MDBOSS` is there, memory native otherwise
- [ ] app boots: sidebar, preview, editor against the socket (`hammer dev`, not yet run in a window); `bun test` green

## 5. Shell natives

- [x] menus (`muda`), `menu.install/update`, accelerators, action ids back to the page
- [x] dialogs (`rfd`): `openFolders`, `openFile`
- [x] `shell.reveal/openURL/openPath`
- [x] clipboard (`arboard`)
- [x] OS file drag into the window -> `onFileDrag` events
- [x] `previewfile://` protocol for images under the allowed roots; `shell.assetBase()`
- [x] `app.onCloseRequested`: the shell holds the close, the page decides

## 6. Server ports (from `../tauri-rust/src-tauri/src/*.rs`)

- [x] `walk.ts`: `listDir`, `documentsUnder`, the "has documents below" memo, `invalidateScan`
- [x] `search.ts`: full-text search with buffers, budget, cancellation by generation
- [x] `links.ts`: `rewriteLinks` over `src/models/markdownLinks.ts`
- [x] `notes.ts`: `readNotes/writeNotes`, legacy shapes folded in, atomic write, empty file removed
- [x] tests for each, ported from `cargo test`

## 7. CLI + single instance

- [x] shell forwards argv + cwd to the page as `cli.launch`
- [ ] a second launch finds the running shell (lock file + port) and forwards its argv; window comes forward
- [x] `bin/md-boss` launcher, `hammer link`

## 8. Bundle

- [ ] `hammer build` assembles `MdBoss.app` (Info.plist, icon, shell binary, `server/`, `dist/`)
- [ ] Linux: binary + `.desktop` + icon
- [ ] Windows: exe, WebView2 runtime assumed
- [ ] `hammer icon` from `../app/Resources/AppIcon.svg`

## 9. Updates

- [ ] `hammer payload` writes `payload-<version>.tar.gz` (`server/`, `dist/`, `version.txt`, `min_shell`)
- [ ] shell resolves the payload from `~/.config/md-boss/app/current/`, falls back to the bundle
- [ ] `server/update.ts`: `releases/latest` redirect -> tag, download, sha256, extract, flip `current`
- [ ] page: "restart to update" toast; `min_shell` behind -> toast the install command

## 10. Verify elsewhere

- [ ] Linux VM: fonts, drop, WebKitGTK quirks
- [ ] Windows: WebView2, paths, `bun` on PATH
