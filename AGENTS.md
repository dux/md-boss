# md-boss

* two apps live here: the cross-platform Tauri app in tauri-rust/ and the Swift macOS app in app/
* a third, exploratory root is app-simple-bun/ (own Rust shell + local bun backend + JSON-RPC); it has its own Hammerfile and TODO.md - `cd app-simple-bun && hammer lint && hammer test` after changes there
* read doc/CODE_STRUCTURE.md first (tauri-rust) and doc/CODE_STRUCTURE_SWIFT.md (app/) to understand the codebase architecture
* tauri-rust: run `hammer tauri:lint` and `hammer tauri:test` after every batch of jobs -> when code is changed and you are done
* tauri-rust: for text styles use only the classes in tauri-rust/src/ui/styles.css (`.text-default`, `.text-buttons`, `.text-small`, `.text-title`, `.text-mono`)
* tauri-rust: for colors use only the theme CSS custom properties (`var(--accent)` and the other tokens from tauri-rust/src/theme/theme.ts) - never a literal colour in a component
* tauri-rust: only tauri-rust/src/native/tauri.ts imports `@tauri-apps/*`; models and UI go through the `Native` interface, and every new method gets a memory twin
* tauri-rust: read ~/dev/dux/gems/fez/AGENTS.md before touching a .fez file
* app (Swift): run `hammer build` after every batch of jobs -> when code is changed and you are done
* app (Swift): for text styles use only defined classes in app/Views/TextStyles.swift
* app (Swift): for colors use only tokens from app/Views/Theme.swift - never a literal `Color(red:...)` in a view
* app (Swift): preview HTML/CSS/JS lives in app/Resources/preview.{js,css}, not in Swift string literals
* both: the preview web view is *told* which theme to use - never add `prefers-color-scheme` to its CSS
* see ~/dev/AGENTS.md for global rules
