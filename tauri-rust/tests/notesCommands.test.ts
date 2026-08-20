import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup(files: Record<string, string>) {
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  folders.add('/home/dev/notes', true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.notes.reload()
  return { manager, files }
}

describe('note commands', () => {
  test('add at cursor titles from the line, edit keeps the title, delete removes', async () => {
    const { manager, files } = await setup({ '/home/dev/notes/a.md': '# The **plan**\nsecond\n' })
    await manager.open('/home/dev/notes/a.md')
    manager.reportCursor(1, '# The **plan**')
    expect(manager.hasNoteAtCursor).toBe(false)
    manager.prompts.handler = async (o) => (o.title === 'Add Note' ? 'remember this' : null)
    await manager.addNoteAtCursor()
    const note = manager.notes.noteAt('/home/dev/notes/a.md', 1)
    expect(note).toEqual({ path: '~/notes/a.md', line: 1, title: 'The plan', body: 'remember this' })
    expect(files['/home/dev/notes/.md-boss']).toContain('remember this')
    expect(manager.notice).toBe('Note saved on line 1')
    expect(manager.hasNoteAtCursor).toBe(true)

    manager.prompts.handler = async (o) => {
      expect(o.title).toBe('Edit Note')
      expect(o.value).toBe('remember this')
      return ''
    }
    await manager.addNoteAtCursor()
    expect(manager.notes.noteAt('/home/dev/notes/a.md', 1)).toEqual({ path: '~/notes/a.md', line: 1, title: 'The plan', body: '' })

    manager.prompts.handler = async () => '  Renamed  '
    await manager.renameNote(manager.notes.noteAt('/home/dev/notes/a.md', 1)!)
    expect(manager.notes.noteAt('/home/dev/notes/a.md', 1)?.title).toBe('Renamed')

    manager.prompts.handler = async () => null // cancelled
    await manager.editNote(manager.notes.noteAt('/home/dev/notes/a.md', 1)!)
    expect(manager.notes.noteAt('/home/dev/notes/a.md', 1)?.title).toBe('Renamed')

    await manager.deleteNoteAtCursor()
    expect(manager.hasNoteAtCursor).toBe(false)
    expect(files['/home/dev/notes/.md-boss']).toBeUndefined()
  })

  test('typing above a note moves it; the cursor report clears the landing band', async () => {
    const { manager } = await setup({
      '/home/dev/notes/a.md': 'one\ntwo\nthree\n',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 3, title: 'three' }] }),
    })
    await manager.open('/home/dev/notes/a.md')
    manager.setDocumentText('one\nX\ntwo\nthree\n', { start: 4, end: 4, length: 2 })
    await tick()
    expect(manager.notes.notesFor('/home/dev/notes/a.md').map((n) => n.line)).toEqual([4])

    manager.requestScroll(4)
    expect(manager.highlightedLine).toBe(4)
    expect(manager.scrollRequest?.line).toBe(4)
    manager.reportCursor(4, 'three', false)
    expect(manager.highlightedLine).toBe(4)
    manager.reportCursor(2, 'X')
    expect(manager.highlightedLine).toBeNull()
  })

  test('going to a note opens its file, reveals it in the tree and asks for the line', async () => {
    const { manager } = await setup({
      '/home/dev/notes/a.md': 'a',
      '/home/dev/notes/deep/inner/b.md': 'b\nb2\n',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/deep/inner/b.md', line: 2, title: 'b2' }] }),
    })
    await manager.open('/home/dev/notes/a.md')
    await tick()
    manager.settings.patch({ visiblePanes: ['notes'] })
    await manager.goToNote(manager.notes.notes[0])
    expect(manager.document?.path).toBe('/home/dev/notes/deep/inner/b.md')
    expect(manager.tree.expandedPaths).toEqual(['/home/dev/notes/deep', '/home/dev/notes/deep/inner'])
    expect(manager.tree.cursorRow?.node.path).toBe('/home/dev/notes/deep/inner/b.md')
    expect(manager.scrollRequest?.line).toBe(2)
    // the raw pane was forced open, since nothing showing could mark the line
    expect(manager.settings.data.visiblePanes).toEqual(['raw', 'notes'])
  })
})
