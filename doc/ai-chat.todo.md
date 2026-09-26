# AI pane - one chat per document, prepare change, apply

Status: planned - 2026-09-26. Nothing built yet.

## Why

Work on a document (usually a plan) with Claude without leaving md-boss.
Each document gets one ongoing chat session.
Clicking a row in the preview attaches it to the composer, so "this line" is always concrete.
The chat is a real conversation: the model never asks "shall I write it?", because writing is a separate, explicit step.
**Prepare change** turns the conversation into a proposed revision shown as a diff.
You keep chatting to refine it, then **Apply** writes it into the document.
The model can draw images (SVG) on request.
Apply saves them to `assets/` next to the document, and the revision embeds them with a normal markdown image tag.

## Decisions taken

* **Backend: the installed Claude Code**, driven by `@anthropic-ai/claude-agent-sdk` from the bun server.
  It runs on the user's subscription and needs no API key.
* **Claude only for now.**
  Other providers (DeepSeek's Anthropic-compatible endpoint, a model picker, API keys in settings) are a later layer.
  Nothing here is built for them, and nothing here is shaped for them.
* **Sessions live in a global temp folder**: `<os tmpdir>/md-boss/chats/<sha1 of doc path>.json`.
  The OS may purge it, and that is acceptable.
* **Images**: the AI draws SVGs, stored in `<doc dir>/assets/` and embedded via `![alt](assets/x.svg)`.
  Images the document already links are shown to the model.
* **Row attach**: a plain click on a preview block while the AI pane is open, plus "Ask AI" in the preview and raw right-click menus.
  A plain click in raw still just moves the caret.
* **The chat sees the buffer, unsaved edits included**, the same way search already reads open `buffers`.
* **Pinned SDK version.** `@anthropic-ai/claude-agent-sdk` is pinned exactly, because its version tracks the CLI and a floating range would swap the harness silently.

## Behaviour

* A fifth pane, **AI** (⌘5), sits to the right of Notes and has its own draggable width, like Notes.
* The head carries an **Ask | Write** toggle and a **New session** button, which confirms before clearing.
  * Ask is a conversation about the document: answers and explanations, no drafting.
  * Write is for shaping changes: it suggests freely, never asks permission to write, and shows **Prepare change** in the composer.
* The transcript shows user turns with their attached-line chips, and assistant replies stream in live.
  Replies are plain text with preserved whitespace in this first layer.
  Markdown rendering of replies is a later layer.
* The composer has removable chips for attached rows (`L12-14 "first 40 chars..."`), a textarea, Send / Stop, and Prepare change in Write mode.
  Return sends and ⇧Return adds a newline.
* The proposal card in the transcript shows:
  * a one-line summary and `+N -M lines`
  * a collapsible unified diff, additions in `--alert-tip` and deletions in `--alert-caution`
  * thumbnails of the new SVGs, each marked new or replacing an existing file
  * **Apply** and **Discard**
* While a proposal is pending, every message revises it.
  The reply streams, a new card replaces the old one, and the old card collapses to "Revision N".
* Apply writes the SVGs to `assets/`, puts the new text in the buffer, saves, keeps notes on their lines, and marks the turn "Applied".
  If the document changed after the proposal was prepared, Apply refuses with "The document changed - prepare the change again".
  Cmd-Z in the raw pane undoes an Apply as one step.
* Empty states:
  * no document open
  * not a markdown document
  * `claude` not found: the install line, plus the settings key that overrides the path
  * not logged in: the `claude` error text, plus "run `claude` in a terminal to log in"
* The Settings panel gets an AI section showing the detected `claude` path and version.
  `aiModel` and `claudePath` are `settings.json` keys, where `null` means the CLI default and auto-detect.

## What goes to the model

The system prompt is fixed per session, so the CLI's prompt cache holds.
It carries:
* the role: collaborating on one markdown document in md-boss
* the Ask/Write rules, including "never offer to write or apply; the user has a Prepare change button"
* the md-boss markdown dialect and the installed Fez components, extracted from `buildAIStartPrompt` in `./src/models/aiStart.ts` into a shared `markdownDialect(components)`, so both use one text
* the image rule: draw only SVG, name files `kebab-name.svg`, embed as `![alt](assets/name.svg)`

Built-in tools are off (`tools: []`) and `settingSources: []`.
The claude.ai account connectors are off too (`strictMcpConfig: true`, `settings: {disableClaudeAiConnectors: true}`).
Without them the connectors' tool definitions ride along on every turn - ten times the cost of a one-word reply.
That means no CLAUDE.md, no MCP, no file access and no permission prompts - just chat.

Each user turn is one `SDKUserMessage` built by a pure function:

```
<document path="plan.md" state="full">...</document>    first turn, after a reseed, or when a diff would be larger than half the text
<document state="changed">unified diff since last sent</document>
(no document block when unchanged)
<selected lines="12-14">...exact text...</selected>      one per attached row
<mode>write</mode>
the user's message
```

Each turn also carries any image the document links locally that has not been sent yet in this session.
PNG, JPG, GIF and WebP go as base64 image blocks, and SVG goes as text.
At most 10 go per turn, 5 MB each, and the server reads the bytes.

Conversation memory is the CLI session: `resume: claudeSessionId`.
If resume fails because the CLI's session file is gone, the chat starts a new CLI session seeded with the full document and the transcript text, and retries once.
The CLI reports that case as an error result reading "No conversation found with session ID: ...".

Prepare and revise turns add `outputFormat: {type: 'json_schema'}` with `{reply, summary, document, images: [{name, alt, svg}]}`.
It returns the full revised document rather than edit hunks, so applying it cannot mismatch.
The CLI answers through a `StructuredOutput` tool, so no text deltas stream on these turns and the pane shows "Preparing change..." until the result lands.
The parsed object arrives as `structured_output` on the success result.

## Architecture

* The frontend owns the chat state, and nothing else writes it.
  `AIChat` in `./src/models/aiChat.ts` holds the session: transcript, `claudeSessionId`, `lastSentText`, `sentImages`, the pending proposal and the mode.
  It persists to the temp session file through `native().fs`, debounced and flushed on quit like `SettingsStore`.
* The server is a thin boundary.
  `./server/claude.ts` runs one `query()` per turn and streams `session.push('ai', {turn, type: 'delta' | 'done' | 'error', ...})`.
  `Session.dispose()` aborts in-flight turns.
* `Native` gets an `ai` namespace.
  `./src/native/memory.ts` gets a twin that replays scripted replies, so every model test runs without the CLI.
* The installed app does not ship `node_modules`, so the SDK travels inside a bundled server (`bun build server/main.ts --target bun`).
  The shell starts `server/main.js` in a bundle and `server/main.ts` in a checkout.
  The bundle comes out around 1.2 MB and runs with no `node_modules` beside it.
  `bun install` also fetches `@anthropic-ai/claude-agent-sdk-<platform>`, a 217 MB copy of `claude`.
  It stays in the checkout: we always pass `pathToClaudeCodeExecutable`, so the bundle never needs it.

## Files

```
+ server/claude.ts           find claude (claudePath, Bun.which, ~/.local/bin, ~/.claude/local, brew paths);
                             status() = {path, version}; run(turn) = query({systemPrompt, tools: [],
                             settingSources: [], strictMcpConfig: true,
                             settings: {disableClaudeAiConnectors: true}, resume, model, includePartialMessages: true,
                             outputFormat?, abortController, pathToClaudeCodeExecutable, cwd: <tmp>/md-boss/chats}),
                             pushes deltas, resolves {sessionId, text, structured} | error; reads image bytes
~ server/rpc.ts              ai.status, ai.run(turnId, request), ai.stop(turnId), paths.temp
~ server/session.ts          running turns map; dispose() aborts them
~ src/native/bridge.ts       NativeAi {status, run(request, onDelta) -> Promise<AiResult>, stop}; paths.temp()
~ src/native/bun.ts          RPC calls + socket.on('ai') routed by turn id (same shape as watch)
~ src/native/memory.ts       MemoryAi twin: scripted replies/structured results, failure injection, recorded requests
+ src/models/aiPrompt.ts     pure: systemPrompt(dialect), userTurn(doc, lastSent, attachments, mode, message),
                             imagesToSend(doc, dir, sent), PROPOSAL_SCHEMA, reseed(transcript, doc)
+ src/models/aiChat.ts       AIChat store: load/save session file, send/prepare/revise/stop/reset, attach(line range),
                             proposal + stats (via `diff`), states idle|streaming|preparing|error
~ src/models/aiStart.ts      extract markdownDialect(components); buildAIStartPrompt reuses it
~ src/models/manager.ts      owns AIChat for the open document (swap on open); attachLine(start,end);
                             applyProposal(): base check -> write assets -> replaceBuffer -> shift notes
                             per diff hunk (noteShift Edit) -> saveDocument -> chat.markApplied
~ src/models/settings.ts     PANES += 'ai', PANE_TITLE, aiWidth, aiModel: null, claudePath: null
~ src/models/appMenu.ts      PANE_ACCELERATOR ai = CmdOrCtrl+5, PANE_ACTION toggle-ai, MenuAction union
~ src/ui/appMenu.ts          case 'toggle-ai'
+ src/ui/fez/ai-pane.fez     head toggle + New session, transcript, proposal card, composer, empty states
~ src/ui/fez/md-boss-app.fez AI pane block + divider; dragStart learns the 'ai' edge (MIN 280 / MAX 720)
~ src/ui/fez/preview-pane.fez  forwards {kind:'pick'} to manager.attachLine; pushes pick mode on AI visibility;
                               context menu gains "Ask AI"
~ src/ui/fez/editor-pane.fez   context menu gains "Ask AI"
~ src/preview/preview.js     mdSetPickMode(on); click on [data-line] (not a link) posts
                             {kind:'pick', line, next} (next = following block's data-line, for the range)
~ src/ui/fez/settings-panel.fez  AI section: claude path + version or install hint
~ src/main.ts                import ai-pane.fez
~ Hammerfile                 payload stages a bundled server (bun build server/main.ts --target bun);
                             src/models no longer staged
~ shell/src/paths.rs         server_main = server/main.js when present (bundle), else server/main.ts (checkout)
~ package.json               @anthropic-ai/claude-agent-sdk pinned exactly 0.3.283 (tracks CLI 2.1.283), diff
~ README.md                  AI section
+ tests/aiPrompt.test.ts, tests/aiChat.test.ts, tests/serverClaude.test.ts (stubbed query)
~ tests/appMenu.test.ts, tests/settings.test.ts   the fifth pane
```

## Steps

Each step ends with a working app.

* [x] Spike in `./tmp`: install the SDK and confirm against the real CLI, then adjust names here to whatever the SDK actually exposes
  * [x] a custom `systemPrompt` with `tools: []`
  * [x] `resume` across two `query()` calls
  * [x] an image block in an `SDKUserMessage`
  * [x] `outputFormat` coming back as structured output on the result message
  * [x] `pathToClaudeCodeExecutable` pointing at the native `~/.local/bin/claude`
  * [x] a `bun build` bundle of it running
* [ ] Server `claude.ts`, RPC, native seam, memory twin, tests
* [ ] `aiPrompt.ts` and `aiChat.ts`: chat only, Ask/Write, persistence, reseed, tests
* [ ] Pane, settings, menu, width; preview pick and "Ask AI" menus
* [ ] Prepare, revise, proposal card, Apply (assets, notes shift, stale-base refusal), tests
* [ ] Bundled server in the Hammerfile and the shell path; `hammer build`, then launch the bundle from Finder
* [ ] README section

## Errors and edges

* [ ] the `claude` process dies mid-turn: the turn goes to `error` and the pane offers Retry
* [ ] Escape and Stop interrupt a streaming turn; interrupting during Prepare change leaves the previous proposal intact
* [ ] switching documents, closing the pane or losing the server mid-turn aborts the turn and never leaks the subprocess
* [ ] rate limits, refusals and an expired login show up as readable rows, never as a stuck spinner
* [ ] a structured result that fails the schema is an error row, and nothing is applied

## Verification

* `hammer lint` and `hammer test` after each step.
* Manual run in `hammer dev`:
  * [ ] open a plan, click three preview rows, and ask in Ask mode
  * [ ] switch to Write, chat, Prepare change, ask for a diagram, and revise twice
  * [ ] Apply, then check the diff, `assets/*.svg` on disk, the image in the preview, notes still on their lines, and that Cmd-Z undoes
  * [ ] edit the document and confirm Apply refuses
  * [ ] relaunch and confirm the session resumes
* The bundled app launched from Finder finds `claude` without a terminal PATH.

## Later

* Other providers: an Anthropic-compatible base URL and key (DeepSeek), and a model picker.
* Markdown rendering of assistant replies.
* Usage and cost from the result message, shown somewhere quiet.

## Not doing

* Shipping, vendoring or auto-installing Claude Code.
  It is the user's install and the user's login, and a missing `claude` gets an install line, the same way a missing `bun` does.
* Agent tools, file access or permission prompts.
  The model only sees what md-boss sends it, and changes reach the document only through Apply.
