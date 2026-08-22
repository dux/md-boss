# AI chat in md-boss - the Claude Agent SDK

Status: planned - 2026-08-22. Nothing built yet.

A chat pane in `app-simple-bun`, driven by the Claude Agent SDK, that can read the folder you have open and answer about the document you are looking at.
This root is the only target: the Swift app and the Tauri app are going away, so nothing here has to be expressible in three shells.

## The shape in one paragraph

The bun server owns one agent per connected page, the way it already owns one `fs.watch` per expanded folder.
`query()` from `@anthropic-ai/claude-agent-sdk` returns a `Query` that is an `AsyncGenerator<SDKMessage>`; every message it yields is pushed to the page over the socket that already exists, and every user turn is written back into the generator's input.
The page never talks to the SDK - it sees `{event: 'agent', data: SDKMessage}` frames and RPC methods, exactly like `watch`.

## Decisions taken

* **The Agent SDK, not the `claude` CLI directly.** Both spawn the same executable, so the dependency is identical; the SDK adds a typed message union, `canUseTool` (the callback that makes a real approval prompt possible), `interrupt()`, and `supportedModels()`, instead of a stdout NDJSON schema we would re-derive from fixtures on every CLI bump.
* **Not the plain Messages API.** A chat that only answers about the open buffer would be ~150 lines against `@anthropic-ai/sdk` and no agent harness. We want it to search the tree and eventually edit, so the harness earns its cost. If phase 5 shows the pane is only ever used for "explain this paragraph", reconsider.
* **The dependency posture is already established.** `./shell/src/server.rs` fails with `SpawnError::NoBun` and a friendly install line when bun is missing. A missing `claude` gets the same treatment. We do not vendor or ship the binary.
* **The `Native` seam stays, for the memory twin and not for portability.** Its comment in `./src/native/bridge.ts` promises "another shell is one file, not a rewrite" - that reason dies with the parent apps. `./src/native/memory.ts` is why 530 tests run with no server and no subprocess, and that reason does not.
* **Read-only first.** Phase 1-5 ship with `allowedTools: ['Read', 'Grep', 'Glob']` scoped to the active root and no approval UI at all. Permissions are phase 6, once the pane has proved it is worth the plumbing.

## Verified, 2026-08-22

Checked against the published package and the installed CLI, so the plan does not rest on memory:

* `@anthropic-ai/claude-agent-sdk@0.3.239`, 4.6 MB unpacked, **zero runtime dependencies**.
* It does **not** vendor the harness: 1.3 MB `sdk.mjs`, and options `pathToClaudeCodeExecutable?: string` and `executable?: 'bun' | 'deno' | 'node'`. It spawns an installed Claude Code, same as the CLI route.
* `query({prompt, options})` returns `Query extends AsyncGenerator<SDKMessage, void>` with `interrupt()`, `setModel()`, `supportedModels()`.
* Options we need all exist: `canUseTool`, `allowedTools`, `disallowedTools`, `permissionMode`, `additionalDirectories`, `includePartialMessages`, `resume`, `forkSession`, `stderr`.
* `CanUseTool = (toolName, input, {signal, suggestions}) => Promise<PermissionResult>`, where `PermissionResult` is `{behavior: 'allow', updatedInput?, updatedPermissions?}` or `{behavior: 'deny', message, interrupt?}`. The `suggestions` are what an "always allow" button hands back.
* Installed CLI is 2.1.239; the SDK version tracks it.

## Files this touches

```
server/agent.ts          the Query per session, its input queue, its lifecycle
server/rpc.ts            agent.status / start / send / interrupt / stop / permission
server/session.ts        holds the agent handle, kills it in dispose()
src/native/bridge.ts     NativeAgent, the interface the models see
src/native/bun.ts        it over the socket
src/native/memory.ts     the twin: replays a recorded SDKMessage script
src/models/chat.ts       transcript + turn state machine, pure and tested
src/ui/chat-pane.fez     the pane
src/models/settings.ts   'chat' in PANES, claudePath, model
tests/chat.test.ts       the model against the fixture
tests/agent.test.ts      the server module against a stub Query
```

## 1. Ground work

- [ ] `bun add @anthropic-ai/claude-agent-sdk`, pinned exactly (its version tracks the CLI; a floating range means a silent harness swap)
- [ ] `Bun.which('claude')` in the server, with a settings override - the Rust shell does not need to know about this
- [ ] `agent.status` RPC: `{available, path, version}`, from `claude --version`
- [ ] settings: `claudePath: string | null`, `aiModel: string | null`

## 2. Server: one agent per session

- [ ] `server/agent.ts`: start a `query()` whose `prompt` is an async iterable we push `SDKUserMessage`s into, so the process stays warm across turns instead of respawning per message
- [ ] options: `cwd` = active root, `additionalDirectories`, `allowedTools`, `permissionMode`, `includePartialMessages: true`, `executable: 'bun'`, `pathToClaudeCodeExecutable` from settings, `stderr` into the server log
- [ ] drain the generator in a loop, `session.push('agent', msg)` per `SDKMessage`
- [ ] `session.ts` holds the handle and disposes it, the way `watchers` are closed
- [ ] RPC: `agent.start`, `agent.send`, `agent.interrupt`, `agent.stop`
- [ ] `tests/agent.test.ts` against a stub `Query` - no real subprocess in the suite

## 3. Native seam and the twin

- [ ] `NativeAgent` in `./src/native/bridge.ts`: `status()`, `start(opts)`, `send(text)`, `interrupt()`, `stop()`, `onMessage(cb)`
- [ ] `./src/native/bun.ts`: the RPC calls plus the `agent` push subscription
- [ ] `./src/native/memory.ts`: replays a recorded script of `SDKMessage`s on a timer, so `bun test` and `hammer dev` in a browser both work with no CLI installed
- [ ] record the fixture once from a real session and check it in

## 4. The chat model

- [ ] `./src/models/chat.ts`: the transcript (user turns, assistant text, tool calls, results, errors) and a turn state machine - `idle | thinking | streaming | awaiting-permission | error`
- [ ] fold `SDKPartialAssistantMessage` into the growing assistant block; fold tool results back onto their `tool_use`
- [ ] `SDKResultMessage` closes the turn and carries usage
- [ ] pure, no DOM, tested against the fixture from phase 3

## 5. The pane

- [ ] `'chat'` joins `PANES`, with a toggle segment and a shortcut
- [ ] `./src/ui/chat-pane.fez`: transcript, composer, stop button, empty state
- [ ] tool calls render collapsed - one line, expandable; thinking hidden behind a toggle
- [ ] only the classes in `./src/ui/styles.css` and only theme tokens, same rule as every other component
- [ ] empty states: no `claude` on PATH (show the install line, mirroring the "bun not found" page), not logged in, no folder open

**Stop here and use it for a week before phase 6.**

## 6. Permissions

- [ ] `canUseTool` pushes a `permission` request to the page and awaits `agent.permission(id, result)`
- [ ] UI: allow once / always allow / deny, with the returned `suggestions` sent back as `updatedPermissions` for "always"
- [ ] the request's `AbortSignal` cancels the prompt when the turn is interrupted
- [ ] widen the default `allowedTools` past read-only once the prompt is real; `Edit`/`Write` still route through the buffer, not behind the editor's back

## 7. Context

- [ ] seed each turn with the open file, the selection, and the active root
- [ ] decide where it goes: appended system prompt (stable, caches well) vs. a preamble in the user message (visible, editable)
- [ ] "ask about this selection" from the editor's context menu

## 8. Sessions

- [ ] one session id per chat, `resume` on reopen, `forkSession` for a branch
- [ ] new chat / clear
- [ ] decide whether the transcript is ours to persist or we lean on Claude Code's own session files

## 9. Errors and edges

- [ ] process dies mid-turn: the turn goes to `error`, the pane offers retry
- [ ] Escape interrupts, and interrupt during a tool call is tested
- [ ] root switched or pane closed mid-turn: abort, do not leak the subprocess
- [ ] rate limits, refusals, and auth expiry surface as readable rows rather than a stuck spinner

## 10. Polish

- [ ] model picker from `supportedModels()`
- [ ] usage and cost from the result message, somewhere quiet
- [ ] transcript survives a restart

## Open questions

1. Does the agent's `cwd` follow the active root, or the open document's folder when it sits outside every root?
2. Does the chat see unsaved buffer text, or only what is on disk? Search already answers this one way (`buffers` are passed to `commands.search`), and being inconsistent would be worse than either choice.
3. One chat for the window, or one per root?
4. Read-only past phase 6, or is editing the point? That decision drives how much of phase 6 is needed.

## Not doing

* Shipping, vendoring, or auto-installing Claude Code. It is the user's install and the user's login, and that is the feature: no key handling, no billing, no proxy in md-boss.
* Our own `ANTHROPIC_API_KEY` prompt or storage.
* Any of this in `../tauri-rust` or `../app`, which are slated for removal.
