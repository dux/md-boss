import { describe, expect, test } from 'bun:test'
import { AIChat, sessionFile } from '../src/models/aiChat'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { memoryNative, type MemoryAi } from '../src/native/memory'

const PATH = '/home/dev/notes/plan.md'
const DOC = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}.`).join('\n')
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup(files: Record<string, string> = {}) {
  installNative(memoryNative({ [PATH]: DOC, ...files }))
  const settings = await SettingsStore.load()
  const chat = await AIChat.open(PATH, { settings, dialect: () => 'DIALECT' })
  return { chat, settings, files, ai: native().ai as MemoryAi }
}

describe('AI chat turns', () => {
  test('the first turn sends the whole document, streams the reply and remembers the session', async () => {
    const { chat, settings, ai } = await setup()
    settings.patch({ aiModel: 'claude-opus-5-5' })
    ai.script({ text: 'Step 3 repeats step 2.' })
    const seen: string[] = []
    chat.onChange(() => seen.push(chat.streaming))
    await chat.send('  Anything redundant?  ', DOC)

    const [request] = ai.requests
    expect(request.resume).toBeNull()
    expect(request.model).toBe('claude-opus-5-5')
    expect(request.systemPrompt.endsWith('DIALECT')).toBe(true)
    expect(request.text).toContain(`<document path="plan.md" state="full">\n${DOC}\n</document>`)
    expect(request.text.endsWith('<mode>write</mode>\n\nAnything redundant?')).toBe(true)
    expect(seen).toContain('Step 3 ')
    expect(chat.state).toBe('idle')
    expect(chat.streaming).toBe('')
    expect(chat.session.messages).toEqual([
      { role: 'user', text: 'Anything redundant?', mode: 'write', attachments: [] },
      { role: 'assistant', text: 'Step 3 repeats step 2.' },
    ])
    expect(chat.session.claudeSessionId).toBe('session-1')
    expect(chat.session.lastSentText).toBe(DOC)
  })

  test('later turns resume the session and send only what changed', async () => {
    const { chat, ai } = await setup()
    await chat.send('first', DOC)
    await chat.send('second', DOC)
    const edited = DOC.replace('Step 12.', 'Step 12, reworded.')
    await chat.send('third', edited)

    expect(ai.requests.map((r) => r.resume)).toEqual([null, 'session-1', 'session-1'])
    expect(ai.requests[1].text).toBe('<mode>write</mode>\n\nsecond')
    expect(ai.requests[2].text).toContain('state="changed"')
    expect(ai.requests[2].text).toContain('+Step 12, reworded.')
    expect(chat.session.lastSentText).toBe(edited)
  })

  test('attached rows go with the next message only, once each, in line order', async () => {
    const { chat, ai } = await setup()
    chat.attach({ start: 9, end: 10, text: 'Step 9.\nStep 10.' })
    chat.attach({ start: 2, end: 2, text: 'Step 2.' })
    chat.attach({ start: 2, end: 2, text: 'Step 2.' })
    expect(chat.attachments.map((a) => a.start)).toEqual([2, 9])
    chat.detach(1)
    chat.setMode('ask')
    await chat.send('Why this?', DOC)

    expect(ai.requests[0].text).toContain('<selected lines="2">\nStep 2.\n</selected>\n\n<mode>ask</mode>\n\nWhy this?')
    expect(ai.requests[0].text).not.toContain('Step 9.\nStep 10.\n</selected>')
    expect(chat.attachments).toEqual([])
    expect(chat.session.messages[0]).toEqual({ role: 'user', text: 'Why this?', mode: 'ask', attachments: [{ start: 2, end: 2, text: 'Step 2.' }] })
  })

  test('a lost CLI session is replaced by a new one that gets the transcript and the whole document', async () => {
    const { chat, ai } = await setup()
    ai.script({ text: 'Yes.' })
    await chat.send('Is step 4 needed?', DOC)
    ai.script({ error: { reason: 'no-session', message: 'No conversation found' } }, { text: 'Still yes.' })
    await chat.send('Sure?', DOC)

    const retry = ai.requests[2]
    expect(retry.resume).toBeNull()
    expect(retry.text).toContain('<user>\nIs step 4 needed?\n</user>\n\n<assistant>\nYes.\n</assistant>')
    expect(retry.text).toContain('state="full"')
    expect(retry.text).not.toContain('<user>\nSure?')
    expect(chat.session.claudeSessionId).toBe('session-2')
    expect(chat.session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  test('a failed turn is an error row; the session and what was sent stay as they were', async () => {
    const { chat, ai } = await setup()
    await chat.send('first', DOC)
    ai.script({ error: { reason: 'failed', message: 'rate limited' } })
    await chat.send('second', DOC.replace('Step 1.', 'Step one.'))

    expect(chat.session.messages.at(-1)).toEqual({ role: 'error', text: 'rate limited' })
    expect(chat.session.claudeSessionId).toBe('session-1')
    expect(chat.session.lastSentText).toBe(DOC)
    expect(chat.state).toBe('idle')
  })

  test('no claude says how to get it', async () => {
    const { chat, ai } = await setup()
    ai.script({ error: { reason: 'no-claude', message: 'claude was not found' } })
    await chat.send('hi', DOC)
    expect(chat.session.messages.at(-1)?.text).toContain('claudePath')
  })

  test('stop keeps what had streamed, and the session it belongs to', async () => {
    const { chat, ai } = await setup()
    ai.script({ text: 'A long answer', hold: true })
    const sending = chat.send('Explain.', DOC)
    await tick()
    expect(chat.state).toBe('streaming')
    expect(chat.streaming).toBe('A long answer')
    chat.stop()
    await sending
    expect(chat.session.messages.at(-1)).toEqual({ role: 'assistant', text: 'A long answer' })
    expect(chat.session.claudeSessionId).toBe('session-1')
  })

  test('nothing is sent while a turn runs, or when the message is blank', async () => {
    const { chat, ai } = await setup()
    ai.script({ text: 'x', hold: true })
    const sending = chat.send('one', DOC)
    await chat.send('two', DOC)
    await chat.send('   ', DOC)
    ai.release()
    await sending
    expect(ai.requests.length).toBe(1)
  })
})

describe('AI chat images', () => {
  const withImages = `${DOC}\n\n![shot](assets/shot.png) ![flow](assets/flow.svg) ![gone](assets/gone.png) ![raw](assets/photo.heic)`
  const files = {
    '/home/dev/notes/assets/shot.png': 'PNG',
    '/home/dev/notes/assets/flow.svg': '<svg>flow</svg>',
    '/home/dev/notes/assets/photo.heic': 'HEIC',
  }

  test('local rasters go as images, SVGs as source, each once per session; missing and unreadable ones wait', async () => {
    const { chat, ai } = await setup(files)
    await chat.send('What do the pictures show?', withImages)
    await chat.send('And now?', withImages)

    expect(ai.requests[0].images).toEqual(['/home/dev/notes/assets/shot.png'])
    expect(ai.requests[0].text).toContain('<image path="./assets/flow.svg">\n<svg>flow</svg>\n</image>')
    expect(ai.requests[1].images).toEqual([])
    expect(ai.requests[1].text).not.toContain('<image')
    expect(chat.session.sentImages).toEqual(['/home/dev/notes/assets/shot.png', '/home/dev/notes/assets/flow.svg'])
  })
})

describe('AI chat persistence', () => {
  test('the session survives a reopen; reset starts over and keeps the mode', async () => {
    const { chat, settings } = await setup()
    chat.setMode('ask')
    await chat.send('hello', DOC)
    await chat.flushed()

    const again = await AIChat.open(PATH, { settings, dialect: () => '' })
    expect(again.session.messages.length).toBe(2)
    expect(again.session.claudeSessionId).toBe('session-1')
    expect(again.session.mode).toBe('ask')

    again.reset()
    await again.flushed()
    const fresh = await AIChat.open(PATH, { settings, dialect: () => '' })
    expect(fresh.session).toEqual({ path: PATH, claudeSessionId: null, lastSentText: null, sentImages: [], mode: 'ask', messages: [] })
  })

  test('a corrupt file, or one written for another path, is a new chat', async () => {
    const { settings, files } = await setup()
    const file = await sessionFile(PATH)
    expect(file.startsWith('/tmp/md-boss/chats/')).toBe(true)

    files[file] = '{not json'
    expect((await AIChat.open(PATH, { settings, dialect: () => '' })).session.messages).toEqual([])
    files[file] = JSON.stringify({ path: '/elsewhere.md', messages: [{ role: 'user', text: 'x' }] })
    expect((await AIChat.open(PATH, { settings, dialect: () => '' })).session.messages).toEqual([])
  })
})
