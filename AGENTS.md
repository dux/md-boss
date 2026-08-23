# md-boss

* [ ] asdasdasda
* [o] asdasdasda
* [x] asdasdasda

> [!NOTE]
> dadadasdadas

- adasda
- asdasdas
- asdadadasd

- [o] asdasdasd
- [ ] 

---

* one app lives here: a small Rust shell (`shell/`) around the platform webview, a local
  bun backend (`server/`), and a fez + TypeScript frontend (`src/`) talking JSON-RPC over a
  localhost WebSocket
* the Swift macOS app and the Tauri port that used to live beside it are gone - git history has them
* read README.md and TODO.md first; doc/THEMES.md covers the palette rules
* run `hammer lint` and `hammer test` after every batch of jobs -> when code is changed and you are done
* for text styles use only the classes in src/ui/styles.css (`.text-default`, `.text-buttons`, `.text-small`, `.text-title`, `.text-mono`)
* for colors use only the theme CSS custom properties (`var(--accent)` and the other tokens from src/theme/theme.ts) - never a literal colour in a component
* only src/native/bun.ts talks to the shell and the server; models and UI go through the `Native` interface, and every new method gets a memory twin in src/native/memory.ts
* read ~/dev/gems/fez/AGENTS.md before touching a .fez file
* the preview web view is *told* which theme to use - never add `prefers-color-scheme` to its CSS
* src/models/exampleDoc.md is the Example page - the one document that shows every construct
  the preview renders. Any change to core markdown rendering (a new construct, a new state of
  an existing one, a syntax that stops working) goes into it in the same commit, written *and*
  drawn: the fenced source to copy, and a rendered line beside it. tests/exampleDoc.test.ts
  asserts the features it claims, so add the assertion too
* see ~/dev/AGENTS.md for global rules
