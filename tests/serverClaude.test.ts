import { afterEach, describe, expect, test } from 'bun:test'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locate, run, stop, type RunQuery } from '../server/claude'
import { Session } from '../server/session'
import type { AiRequest } from '../src/native/bridge'

const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-boss-claude-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A Session that keeps what it would have sent to the page. */
class Recording extends Session {
  pushed: { event: string; data: unknown }[] = []
  override push(event: string, data: unknown): void {
    this.pushed.push({ event, data })
  }
}

/** A stand-in for the CLI binary: `locate` only needs the file to exist. */
function fakeClaude(): string {
  const path = join(scratch(), 'claude')
  writeFileSync(path, '')
  return path
}

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return { resume: null, systemPrompt: 'be brief', text: 'hello', images: [], schema: null, model: null, claudePath: fakeClaude(), ...overrides }
}

const delta = (text: string) =>
  ({ type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } }) as unknown as SDKMessage
const success = (result: string, structured?: unknown) =>
  ({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', result, structured_output: structured }) as unknown as SDKMessage

/** A query that records what it was asked and replays `messages`. */
function scripted(messages: SDKMessage[], seen: { prompt?: SDKUserMessage; options?: Options } = {}): RunQuery {
  return ({ prompt, options }) => (async function* () {
    for await (const turn of prompt) seen.prompt = turn
    seen.options = options
    for (const msg of messages) yield msg
  })()
}

describe('claude turns', () => {
  test('streams text deltas to the page and resolves with the result', async () => {
    const session = new Recording()
    const result = await run(session, 't1', request(), scripted([delta('Hel'), delta('lo'), success('Hello')]))
    expect(result).toEqual({ kind: 'done', sessionId: 's1', text: 'Hello', structured: null })
    expect(session.pushed).toEqual([
      { event: 'ai', data: { turn: 't1', text: 'Hel' } },
      { event: 'ai', data: { turn: 't1', text: 'lo' } },
    ])
    expect(session.turns.size).toBe(0)
  })

  test('chat only: no tools, no settings, no MCP, no connectors; resume, model and schema passed through', async () => {
    const seen: { options?: Options } = {}
    const schema = { type: 'object' }
    await run(new Recording(), 't1', request({ resume: 'abc', model: 'claude-opus-5-5', schema }), scripted([success('{}', {})], seen))
    const o = seen.options!
    expect(o.tools).toEqual([])
    expect(o.settingSources).toEqual([])
    expect(o.strictMcpConfig).toBe(true)
    expect(o.settings).toEqual({ disableClaudeAiConnectors: true })
    expect(o.systemPrompt).toBe('be brief')
    expect(o.resume).toBe('abc')
    expect(o.model).toBe('claude-opus-5-5')
    expect(o.outputFormat).toEqual({ type: 'json_schema', schema })
  })

  test('a new session sets neither resume nor model', async () => {
    const seen: { options?: Options } = {}
    await run(new Recording(), 't1', request(), scripted([success('ok')], seen))
    expect('resume' in seen.options!).toBe(false)
    expect('model' in seen.options!).toBe(false)
    expect('outputFormat' in seen.options!).toBe(false)
  })

  test('structured output comes back parsed', async () => {
    const proposal = { summary: 's', edits: [{ old: 'a', new: 'b' }], images: [] }
    const result = await run(new Recording(), 't1', request({ schema: {} }), scripted([success('{...}', proposal)]))
    expect(result).toEqual({ kind: 'done', sessionId: 's1', text: '{...}', structured: proposal })
  })

  test('images go first, as base64 blocks, then the text', async () => {
    const png = join(scratch(), 'shot.PNG')
    writeFileSync(png, Buffer.from([1, 2, 3]))
    const seen: { prompt?: SDKUserMessage } = {}
    await run(new Recording(), 't1', request({ images: [png], text: 'what is this?' }), scripted([success('ok')], seen))
    expect(seen.prompt!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') } },
      { type: 'text', text: 'what is this?' },
    ])
  })

  test('an image the model cannot read fails the turn before claude starts', async () => {
    let started = false
    const q: RunQuery = () => {
      started = true
      return scripted([success('ok')])({} as never)
    }
    const result = await run(new Recording(), 't1', request({ images: ['/nope/diagram.svg'] }), q)
    expect(result).toMatchObject({ kind: 'error', reason: 'failed' })
    expect(started).toBe(false)
  })

  test('a missing session is its own failure, so the chat can start a new one', async () => {
    const q: RunQuery = () => (async function* (): AsyncGenerator<SDKMessage> {
      throw new Error('Claude Code returned an error result: No conversation found with session ID: 0000')
    })()
    const result = await run(new Recording(), 't1', request({ resume: '0000' }), q)
    expect(result).toMatchObject({ kind: 'error', reason: 'no-session' })
  })

  test('an error result carries its message', async () => {
    const err = { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1', errors: ['rate limited'] } as unknown as SDKMessage
    expect(await run(new Recording(), 't1', request(), scripted([err]))).toEqual({ kind: 'error', reason: 'failed', message: 'rate limited', sessionId: 's1' })
  })

  test('stop aborts the running turn and reports it stopped', async () => {
    const session = new Recording()
    const q: RunQuery = ({ options }) => (async function* (): AsyncGenerator<SDKMessage> {
      yield delta('partial ')
      await new Promise((_, reject) => options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })()
    const pending = run(session, 't1', request(), q)
    await Bun.sleep(0)
    expect(session.turns.has('t1')).toBe(true)
    stop(session, 't1')
    expect(await pending).toEqual({ kind: 'stopped', sessionId: 's1' })
    expect(session.turns.size).toBe(0)
  })

  test('closing the page aborts its turns', async () => {
    const session = new Recording()
    let aborted = false
    const q: RunQuery = ({ options }) => (async function* (): AsyncGenerator<SDKMessage> {
      await new Promise((resolve) => options.abortController!.signal.addEventListener('abort', () => resolve((aborted = true))))
    })()
    const pending = run(session, 't1', request(), q)
    await Bun.sleep(0)
    session.dispose()
    expect(await pending).toEqual({ kind: 'stopped', sessionId: null })
    expect(aborted).toBe(true)
  })

  test('no claude, no turn', async () => {
    expect(await run(new Recording(), 't1', request({ claudePath: '/nope/claude' }), scripted([]))).toMatchObject({ kind: 'error', reason: 'no-claude' })
  })
})

describe('locate', () => {
  test('an override is used only when it exists', () => {
    const path = fakeClaude()
    expect(locate(path)).toBe(path)
    expect(locate('/nope/claude')).toBeNull()
  })
})
