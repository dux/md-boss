import { describe, expect, test } from 'bun:test'
import type { AiRequest } from '../src/native/bridge'
import { memoryNative, type MemoryAi } from '../src/native/memory'

describe('in-memory AI', () => {
  const request: AiRequest = { resume: null, systemPrompt: '', text: 'hi', images: [], schema: null, model: null, claudePath: null }

  test('plays scripted replies word by word, keeps the requests, numbers new sessions', async () => {
    const ai = memoryNative({}).ai as MemoryAi
    ai.script({ text: 'two words' })
    const deltas: string[] = []
    expect(await ai.run(request, (t) => deltas.push(t)).result).toEqual({ kind: 'done', sessionId: 'session-1', text: 'two words', structured: null })
    expect(deltas).toEqual(['two ', 'words'])
    expect(await ai.run({ ...request, resume: 'session-1' }, () => {}).result).toMatchObject({ kind: 'done', sessionId: 'session-1', text: 'ok' })
    expect(ai.requests.map((r) => r.resume)).toEqual([null, 'session-1'])
  })

  test('a held turn waits for stop or release', async () => {
    const ai = memoryNative({}).ai as MemoryAi
    ai.script({ text: 'x', hold: true }, { text: 'y', hold: true })
    const first = ai.run(request, () => {})
    const second = ai.run(request, () => {})
    await Bun.sleep(0)
    first.stop()
    expect(await first.result).toEqual({ kind: 'stopped', sessionId: 'session-1' })
    ai.release()
    expect(await second.result).toMatchObject({ kind: 'done', text: 'y' })
  })

  test('scripted failures', async () => {
    const ai = memoryNative({}).ai as MemoryAi
    ai.script({ error: { reason: 'no-session', message: 'gone' } })
    expect(await ai.run(request, () => {}).result).toEqual({ kind: 'error', reason: 'no-session', message: 'gone', sessionId: null })
  })
})

describe('in-memory native listing', () => {
  const n = memoryNative({
    '/w/10.md': '', '/w/9.md': '', '/w/code/x.swift': '', '/w/docs/deep/guide.md': '',
    '/w/node_modules/x.md': '', '/w/.hidden/x.md': '', '/w/notes.txt': '',
  })

  test('folders with documents first, then documents, naturally ordered; empty and hidden folders gone', async () => {
    const listing = await n.commands.listDir('/w', ['node_modules'])
    expect(listing.kind).toBe('entries')
    if (listing.kind !== 'entries') return
    expect(listing.entries.map((e) => e.name)).toEqual(['docs', '9.md', '10.md', 'notes.txt'])
  })

  test('a missing folder says so', async () => {
    expect(await n.commands.listDir('/nope', [])).toEqual({ kind: 'missing' })
  })

  test('documentsUnder skips hidden and skipped folders', async () => {
    expect(await n.commands.documentsUnder('/w', ['node_modules'])).toEqual(['/w/10.md', '/w/9.md', '/w/docs/deep/guide.md', '/w/notes.txt'])
  })

  test('rich clipboard keeps the plain-text fallback readable', async () => {
    await n.clipboard.writeHTML('<h1>Guide</h1>', '# Guide')
    expect(await n.clipboard.readText()).toBe('# Guide')
  })
})
