# md-boss, the simple-bun build

A third take on md-boss, next to the Swift app in `../app` and the Tauri port in `../tauri-rust`.

* `shell/` - a small Rust launcher: one window with the platform webview, native menus and dialogs, nothing else.
* `server/` - the backend, plain TypeScript run by the **locally installed** `bun`: files, walk, search, link rewrite, notes, watching.
* `src/` - the frontend, the same fez + TypeScript app the Tauri port uses, talking JSON-RPC to the server over a localhost WebSocket.

There is no bundled runtime: the shell finds `bun` on PATH (`curl -fsSL https://bun.sh/install | bash`) and spawns it.
Updates are a payload tarball from the GitHub release, unpacked into `~/.config/md-boss/app/` - the shell itself rarely changes.

```
hammer install    # bun install + cargo fetch
hammer dev        # vite + the shell against it
hammer test       # bun test + cargo test
hammer build      # MdBoss.app in this folder; --release also writes the payload tarball
```

See `TODO.md` for where this stands.
