// The AI pane's turns: the user's installed `claude`, driven through the Agent SDK. One
// `query()` per turn, continued with `resume`; text streams to the page as `ai` pushes and
// the call itself resolves with the outcome. Chat only - no built-in tools, no settings,
// no MCP servers and no claude.ai connectors, so the model sees exactly what the page sends.

import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { AiRequest, AiResult, AiStatus } from '../src/native/bridge'
import { home, temp } from './paths'
import type { Session } from './session'

/** `query` as this module uses it, so a test can hand in a scripted one. */
export type RunQuery = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>

const MEDIA_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Kept for error messages: the last of what the CLI wrote to stderr. */
const STDERR_TAIL = 2000

/** An app launched from Finder has launchd's PATH, so the usual install places are tried by hand. */
export function locate(override: string | null): string | null {
  if (override) return existsSync(override) ? override : null
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    Bun.which('claude'),
    join(home(), '.local', 'bin', exe),
    join(home(), '.claude', 'local', exe),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null
}

// `claude --version` by the binary's real path, for the life of the process: an upgrade
// repoints ~/.local/bin/claude at a new version directory, which is a new key.
const versions = new Map<string, string | null>()

export async function status(claudePath: string | null): Promise<AiStatus> {
  const path = locate(claudePath)
  if (!path) return { path: null, version: null }
  const real = realpathSync(path)
  if (!versions.has(real)) versions.set(real, await readVersion(path))
  return { path, version: versions.get(real) ?? null }
}

async function readVersion(path: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([path, '--version'], { stdout: 'pipe', stderr: 'ignore' })
    const out = (await new Response(proc.stdout).text()).trim()
    return (await proc.exited) === 0 && out ? out.split(/\s+/)[0] : null
  } catch {
    return null
  }
}

export async function run(session: Session, turnId: string, request: AiRequest, runQuery: RunQuery = query): Promise<AiResult> {
  const claude = locate(request.claudePath)
  if (!claude) return { kind: 'error', reason: 'no-claude', message: 'claude was not found', sessionId: null }

  // The CLI files its sessions under ~/.claude/projects by cwd; one fixed cwd keeps them together.
  const cwd = join(temp(), 'chats')
  mkdirSync(cwd, { recursive: true })

  const abort = new AbortController()
  session.turns.set(turnId, abort)
  let stderr = ''
  let sessionId: string | null = null
  const options: Options = {
    systemPrompt: request.systemPrompt,
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true },
    includePartialMessages: true,
    pathToClaudeCodeExecutable: claude,
    cwd,
    abortController: abort,
    stderr: (data) => {
      stderr = (stderr + data).slice(-STDERR_TAIL)
    },
  }
  if (request.resume) options.resume = request.resume
  if (request.model) options.model = request.model
  if (request.schema) options.outputFormat = { type: 'json_schema', schema: request.schema }

  try {
    const turn = userTurn(request)
    for await (const msg of runQuery({ prompt: once(turn), options })) {
      if ('session_id' in msg && msg.session_id) sessionId = msg.session_id
      if (msg.type === 'stream_event' && msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
        session.push('ai', { turn: turnId, text: msg.event.delta.text })
      }
      if (msg.type !== 'result') continue
      if (msg.subtype === 'success' && !msg.is_error) {
        return { kind: 'done', sessionId: msg.session_id, text: msg.result, structured: msg.structured_output ?? null }
      }
      const message = msg.subtype === 'success' ? msg.result : msg.errors.join('\n') || msg.subtype
      return failure(message, sessionId)
    }
    return abort.signal.aborted ? { kind: 'stopped', sessionId } : failure(stderr.trim() || 'claude ended without an answer', sessionId)
  } catch (e) {
    if (abort.signal.aborted) return { kind: 'stopped', sessionId }
    return failure(e instanceof Error ? e.message : String(e), sessionId)
  } finally {
    session.turns.delete(turnId)
  }
}

export function stop(session: Session, turnId: string): void {
  session.turns.get(turnId)?.abort()
}

function failure(message: string, sessionId: string | null): AiResult {
  const reason = /No conversation found with session ID/i.test(message) ? 'no-session' : 'failed'
  return { kind: 'error', reason, message, sessionId }
}

/** The images first, then the text - the order the model reads them in. Built before the
 *  query starts, so an unreadable image fails the turn here rather than inside the SDK. */
function userTurn(request: AiRequest): SDKUserMessage {
  const images = request.images.map((path) => {
    const media_type = MEDIA_TYPES[extname(path).toLowerCase()]
    if (!media_type) throw new Error(`not an image the model reads: ${path}`)
    return { type: 'image' as const, source: { type: 'base64' as const, media_type, data: readFileSync(path).toString('base64') } }
  })
  return {
    type: 'user',
    message: { role: 'user', content: [...images, { type: 'text', text: request.text }] },
    parent_tool_use_id: null,
  }
}

async function* once(turn: SDKUserMessage): AsyncIterable<SDKUserMessage> {
  yield turn
}
