import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { visiblePanes } from '../src/models/settings'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { memoryNative, type MemoryAi } from '../src/native/memory'

const HOME = '/home/dev'
const A = '/home/dev/notes/a.md'
const B = '/home/dev/notes/b.md'
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup() {
  const files: Record<string, string> = { [A]: '# Plan\n\nFirst step.\nSecond step.\n\n\n## Later\n', [B]: '# Other\n' }
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  folders.add('/home/dev/notes', true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME, undefined, () => [])
  await manager.notes.reload()
  return { manager, files, ai: native().ai as MemoryAi }
}

describe('AI commands', () => {
  test('each document has its own chat, ready when the document is', async () => {
    const { manager } = await setup()
    expect(manager.chat).toBeNull()
    await manager.open(A)
    expect(manager.chat?.session.path).toBe(A)
    await manager.open(B)
    expect(manager.chat?.session.path).toBe(B)
  })

  test('opening another document stops a reply still arriving for the one left', async () => {
    const { manager, ai } = await setup()
    await manager.open(A)
    const chat = manager.chat!
    ai.script({ text: 'long', hold: true })
    const sending = manager.sendToChat('Explain.')
    await tick()
    expect(chat.state).toBe('streaming')
    await manager.open(B)
    await sending
    expect(chat.state).toBe('idle')
    expect(chat.session.messages.at(-1)).toEqual({ role: 'assistant', text: 'long' })
  })

  test('attached rows lose trailing blank lines, run to the end when open, and unfold the pane', async () => {
    const { manager } = await setup()
    await manager.open(A)
    expect(visiblePanes(manager.settings.data)).not.toContain('ai')
    manager.attachToChat(3, 6)
    expect(manager.chat!.attachments).toEqual([{ start: 3, end: 4, text: 'First step.\nSecond step.' }])
    manager.attachToChat(7, null)
    manager.attachToChat(99, null)
    expect(manager.chat!.attachments).toEqual([{ start: 7, end: 7, text: '## Later' }])
    expect(visiblePanes(manager.settings.data)).toContain('ai')
  })

  test('a message is about the text in the editor, saved or not', async () => {
    const { manager, ai } = await setup()
    await manager.open(A)
    manager.setDocumentText('# Plan, unsaved\n')
    await manager.sendToChat('What is the title?')
    expect(ai.requests[0].text).toContain('# Plan, unsaved')
  })

  test('a new session asks first, and only when there is something to lose', async () => {
    const { manager } = await setup()
    await manager.open(A)
    let asked = 0
    manager.prompts.confirmHandler = async () => {
      asked++
      return asked > 1
    }
    await manager.resetChat()
    expect(asked).toBe(0)
    await manager.sendToChat('hi')
    await manager.resetChat()
    expect(manager.chat!.session.messages.length).toBe(2)
    await manager.resetChat()
    expect(manager.chat!.session.messages).toEqual([])
  })

  test('the claude status is asked once per path', async () => {
    const { manager, ai } = await setup()
    let asks = 0
    const status = ai.status.bind(ai)
    ai.status = (path) => {
      asks++
      return status(path)
    }
    await manager.claudeStatus()
    await manager.claudeStatus()
    manager.settings.patch({ claudePath: '/opt/claude' })
    await manager.claudeStatus()
    expect(asks).toBe(2)
  })
})

describe('applying a proposed change', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
  const REVISED = '# Plan\nIntro.\n\nFirst step.\nSecond step.\n\n\n## Later on\n![Flow](assets/flow.svg)\n'

  async function proposed() {
    const context = await setup()
    await context.manager.open(A)
    context.ai.script({ text: 'ok' }, {
      structured: {
        reply: 'Done.',
        summary: 'Intro and a diagram',
        edits: [{ old: '# Plan\n\n', new: '# Plan\nIntro.\n\n' }, { old: '## Later\n', new: '## Later on\n![Flow](assets/flow.svg)\n' }],
        images: [{ name: 'flow.svg', alt: 'Flow', svg: SVG }],
      },
    })
    await context.manager.sendToChat('Add an intro and a diagram.')
    await context.manager.prepareChange()
    return context
  }

  test('writes the drawing, swaps and saves the text, settles the proposal', async () => {
    const { manager, files } = await proposed()
    expect(manager.chat!.pending).not.toBeNull()
    await manager.applyProposal()
    expect(files['/home/dev/notes/assets/flow.svg']).toBe(SVG)
    expect(files[A]).toBe(REVISED)
    expect(manager.document!.text).toBe(REVISED)
    expect(manager.isDirty).toBe(false)
    expect(manager.chat!.pending).toBeNull()
    expect(manager.chat!.session.messages.at(-1)?.proposal?.status).toBe('applied')
    expect(manager.toast.text).toBe('Applied the change to a.md')
  })

  test('notes follow each changed run, not one edit spanning them all', async () => {
    const { manager } = await proposed()
    await manager.notes.setNote(A, 4, 'Second', '')
    await manager.notes.setNote(A, 7, 'Later', '')
    await manager.applyProposal()
    expect(manager.notes.noteAt(A, 5)?.title).toBe('Second')
    expect(manager.notes.noteAt(A, 8)?.title).toBe('Later')
  })

  test('refused once the editor holds other text; nothing is written', async () => {
    const { manager, files } = await proposed()
    manager.setDocumentText('# Plan, edited meanwhile\n')
    await manager.applyProposal()
    expect(manager.toast.text).toBe('The document changed - prepare the change again')
    expect(files['/home/dev/notes/assets/flow.svg']).toBeUndefined()
    expect(manager.chat!.pending).not.toBeNull()
  })

  test('discard settles it without touching the document', async () => {
    const { manager, files } = await proposed()
    const before = files[A]
    manager.discardProposal()
    expect(manager.chat!.pending).toBeNull()
    expect(files[A]).toBe(before)
  })
})
