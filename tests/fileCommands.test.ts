import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const ROOT = '/home/dev/notes'
const at = (p: string) => `${ROOT}/${p}`

async function setup(files: Record<string, string>) {
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  folders.add(ROOT, true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.notes.reload()
  await manager.tree.refreshAll()
  return { manager, files }
}

const rowPaths = (manager: Manager) => manager.tree.rows.map((r) => r.node.path)
const documents = (files: Record<string, string>) => Object.keys(files).filter((p) => p.startsWith(ROOT + '/')).sort()

describe('new file', () => {
  test('Cmd-N creates an empty document in the active folder, opens it and puts the cursor on it', async () => {
    const { manager, files } = await setup({ [at('a.md')]: '# a' })
    manager.prompts.handler = async (o) => {
      expect(o.title).toBe('New File')
      expect(o.message).toBe('Created in notes')
      return 'plan'
    }
    await manager.newFile()
    expect(files[at('plan.md')]).toBe('')
    expect(manager.document?.path).toBe(at('plan.md'))
    expect(rowPaths(manager)).toEqual([at('a.md'), at('plan.md')])
    expect(manager.tree.cursorRow?.node.path).toBe(at('plan.md'))
  })

  test('a name already taken is refused before anything is written; cancel creates nothing', async () => {
    const { manager, files } = await setup({ [at('a.md')]: '# a' })
    manager.prompts.handler = async () => 'a.md'
    await manager.newFile()
    expect(files[at('a.md')]).toBe('# a')
    expect(manager.toast.text).toBe('a.md already exists')
    expect(manager.document).toBeNull()

    manager.prompts.handler = async () => null
    await manager.newFile()
    expect(documents(files)).toEqual([at('a.md')])
  })
})

describe('rename', () => {
  const fixture = () => setup({
    [at('a.md')]: '# a',
    [at('b.md')]: '# b',
    [at('index.md')]: 'see [a](./a.md)',
    [at('deep/x.md')]: 'see [a](../a.md) and [b](../b.md)',
    [at('.md-boss')]: JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 1, title: 'A' }, { path: '~/notes/b.md', line: 1, title: 'B' }] }),
  })

  test('Rename… turns the row into a field; an empty or unchanged name cancels', async () => {
    const { manager, files } = await fixture()
    await manager.startRename(at('a.md'))
    expect(manager.renaming).toBe(at('a.md'))
    expect(manager.tree.cursorRow?.node.path).toBe(at('a.md'))

    await manager.rename(at('a.md'), '   ')
    expect(manager.renaming).toBeNull()
    expect(files[at('a.md')]).toBe('# a')

    await manager.rename(at('a.md'), 'a.md')
    expect(manager.toast.text).toBeNull()
    expect(files[at('a.md')]).toBe('# a')

    await manager.startRename(at('a.md'))
    manager.cancelRename()
    expect(manager.renaming).toBeNull()
  })

  test('validation refuses before anything is touched, with the rename wording', async () => {
    const { manager, files } = await fixture()
    await manager.rename(at('a.md'), 'b.md')
    expect(manager.toast.text).toBe('notes already has a b.md')
    await manager.rename(at('a.md'), '.hidden')
    expect(manager.toast.text).toBe('.hidden.md is not a file name')
    await manager.rename(at('deep'), 'other')
    expect(manager.toast.text).toBe('Only files can be renamed')
    expect(documents(files)).toEqual([at('.md-boss'), at('a.md'), at('b.md'), at('deep/x.md'), at('index.md')])
  })

  test('the file, the open document, the notes, the history and the inbound links all follow', async () => {
    const { manager, files } = await fixture()
    await manager.open(at('b.md'))
    await manager.open(at('a.md'))
    await manager.open(at('b.md'))
    await manager.open(at('a.md'))
    expect(manager.history).toEqual([at('b.md'), at('a.md'), at('b.md')])
    manager.scrollMemory.recordLine(at('a.md'), 7)

    await manager.rename(at('a.md'), 'plan')
    expect(files[at('a.md')]).toBeUndefined()
    expect(files[at('plan.md')]).toBe('# a')
    expect(manager.document?.path).toBe(at('plan.md'))
    expect(manager.settings.data.lastOpenedFile).toBe(at('plan.md'))
    expect(manager.history).toEqual([at('b.md'), at('plan.md'), at('b.md')])
    expect(manager.scrollMemory.place(at('plan.md')).line).toBe(7)
    expect(manager.notes.notesFor(at('plan.md')).map((n) => n.title)).toEqual(['A'])
    expect(manager.notes.notesFor(at('a.md'))).toEqual([])
    expect(files[at('.md-boss')]).toContain('~/notes/plan.md')
    expect(files[at('index.md')]).toBe('see [a](./plan.md)')
    expect(files[at('deep/x.md')]).toBe('see [a](../plan.md) and [b](../b.md)')
    expect(manager.toast.text).toBe('Updated 2 links in 2 files')
    expect(rowPaths(manager)).toEqual([at('deep'), at('b.md'), at('index.md'), at('plan.md')])
    expect(manager.tree.cursorRow?.node.path).toBe(at('plan.md'))
  })

  test('an unsaved buffer that links to the file is rewritten in place, not saved', async () => {
    const { manager, files } = await fixture()
    await manager.open(at('index.md'))
    manager.setDocumentText('typed [a](./a.md) but not saved')
    await manager.rename(at('a.md'), 'z.md')
    expect(manager.document?.text).toBe('typed [a](./z.md) but not saved')
    expect(manager.document?.isDirty).toBe(true)
    expect(files[at('index.md')]).toBe('see [a](./a.md)')
    expect(manager.toast.text).toBe('Updated 2 links in 2 files - 1 unsaved')
  })

  test('changing only the case of the name is a rename', async () => {
    const { manager, files } = await fixture()
    await manager.rename(at('a.md'), 'A.md')
    expect(files[at('A.md')]).toBe('# a')
    expect(files[at('a.md')]).toBeUndefined()
  })
})

describe('move to trash', () => {
  const fixture = () => setup({
    [at('a.md')]: '# a',
    [at('index.md')]: 'see [a](./a.md)',
    [at('deep/x.md')]: '# x',
    [at('.md-boss')]: JSON.stringify({ notes: [
      { path: '~/notes/a.md', line: 1, title: 'A' },
      { path: '~/notes/a.md', line: 2, title: 'A2' },
      { path: '~/notes/index.md', line: 1, title: 'I' },
    ] }),
  })

  test('asks, counting the notes that go with it; Cancel leaves everything', async () => {
    const { manager, files } = await fixture()
    let asked: unknown = null
    manager.prompts.confirmHandler = async (o) => {
      asked = o
      return false
    }
    await manager.trash(at('a.md'))
    expect(asked).toEqual({
      title: 'Move a.md to the Trash?',
      message: 'Links to it in other documents are left as they are. Its 2 notes go with it.',
      confirm: 'Move to Trash',
    })
    expect(files[at('a.md')]).toBe('# a')
    expect(manager.notes.noteCount(at('a.md'))).toBe(2)
  })

  test('confirmed: the file goes, its notes go, links stay, the history forgets it', async () => {
    const { manager, files } = await fixture()
    await manager.open(at('a.md'))
    await manager.open(at('index.md'))
    expect(manager.history).toEqual([at('a.md')])
    manager.prompts.confirmHandler = async () => true
    await manager.trash(at('a.md'))
    expect(files[at('a.md')]).toBeUndefined()
    expect(files[at('index.md')]).toBe('see [a](./a.md)')
    expect(manager.notes.noteCount(at('a.md'))).toBe(0)
    expect(manager.notes.noteCount(at('index.md'))).toBe(1)
    expect(manager.history).toEqual([])
    expect(manager.toast.text).toBe('Moved a.md to the Trash - 2 notes removed')
    expect(rowPaths(manager)).toEqual([at('deep'), at('index.md')])
  })

  test('a single note is said in the singular; none is not mentioned', async () => {
    const { manager } = await fixture()
    const messages: string[] = []
    manager.prompts.confirmHandler = async (o) => {
      messages.push(o.message)
      return true
    }
    await manager.trash(at('index.md'))
    await manager.trash(at('deep/x.md'))
    expect(messages).toEqual([
      'Links to it in other documents are left as they are. Its note goes with it.',
      'Links to it in other documents are left as they are.',
    ])
    expect(manager.toast.text).toBe('Moved x.md to the Trash')
  })

  test('folders and files that are gone are refused without asking', async () => {
    const { manager } = await fixture()
    manager.prompts.confirmHandler = async () => {
      throw new Error('should not ask')
    }
    await manager.trash(at('deep'))
    expect(manager.toast.text).toBe('Only files can be moved to the Trash')
    await manager.trash(at('gone.md'))
    expect(manager.toast.text).toBe('gone.md is no longer there')
  })

  test('Cmd-Backspace acts on the open document, else on the cursor row', async () => {
    const { manager, files } = await fixture()
    manager.prompts.confirmHandler = async () => true
    expect(manager.actionTarget).toBe(at('deep'))
    manager.tree.moveCursor(1)
    expect(manager.actionTarget).toBe(at('a.md'))
    await manager.open(at('index.md'))
    expect(manager.actionTarget).toBe(at('index.md'))
    manager.trashSelection()
    await new Promise((r) => setTimeout(r, 10))
    expect(files[at('index.md')]).toBeUndefined()
  })
})

describe('move', () => {
  const fixture = () => setup({
    [at('a.md')]: '# a\nsee [x](./deep/x.md)',
    [at('b.md')]: '# b',
    [at('index.md')]: 'see [a](./a.md) and [b](./b.md)',
    [at('deep/x.md')]: 'see [a](../a.md)',
    [at('deep/a.md')]: '# the other a',
    [at('other/y.md')]: 'see ![a](../a.md "t") and [a](<../a.md>)',
    [at('.md-boss')]: JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 1, title: 'A' }] }),
  })

  test('Cut then Move Here moves the file; links, notes, history and the open document follow', async () => {
    const { manager, files } = await fixture()
    await manager.open(at('a.md'))
    manager.cut(at('a.md'))
    expect(manager.cutFile).toBe(at('a.md'))
    expect(await manager.canMove(at('a.md'), at('other'))).toBe(true)

    await manager.moveCut(at('other'))
    expect(manager.cutFile).toBeNull()
    expect(files[at('a.md')]).toBeUndefined()
    expect(files[at('other/a.md')]).toBe('# a\nsee [x](./deep/x.md)')
    expect(manager.document?.path).toBe(at('other/a.md'))
    expect(manager.notes.notesFor(at('other/a.md')).map((n) => n.title)).toEqual(['A'])
    expect(files[at('index.md')]).toBe('see [a](./other/a.md) and [b](./b.md)')
    expect(files[at('deep/x.md')]).toBe('see [a](../other/a.md)')
    expect(files[at('other/y.md')]).toBe('see ![a](./a.md "t") and [a](./a.md)')
    // The moved file's own outbound link is left as it was - out of scope, by design.
    expect(files[at('other/a.md')]).toContain('[x](./deep/x.md)')
    expect(manager.toast.text).toBe('Updated 4 links in 3 files')
    expect(manager.tree.cursorRow?.node.path).toBe(at('other/a.md'))
    expect(rowPaths(manager)).toContain(at('other/a.md'))
  })

  test('a collision stops the move before anything is touched, and the cut stays pending', async () => {
    const { manager, files } = await fixture()
    manager.cut(at('a.md'))
    await manager.moveCut(at('deep'))
    expect(manager.toast.text).toBe('deep already has a a.md')
    expect(files[at('a.md')]).toBe('# a\nsee [x](./deep/x.md)')
    expect(files[at('deep/a.md')]).toBe('# the other a')
    expect(files[at('index.md')]).toBe('see [a](./a.md) and [b](./b.md)')
    expect(manager.cutFile).toBe(at('a.md'))
    expect(await manager.canMove(at('a.md'), at('deep'))).toBe(false)
  })

  test('the folder it already lives in is a silent no-op that forgets the cut; a gone file says so', async () => {
    const { manager } = await fixture()
    manager.cut(at('a.md'))
    await manager.moveCut(ROOT)
    expect(manager.toast.text).toBeNull()
    expect(manager.cutFile).toBeNull()

    manager.cut(at('gone.md'))
    await manager.moveCut(at('deep'))
    expect(manager.toast.text).toBe('gone.md is no longer there')
    expect(manager.cutFile).toBeNull()
  })

  test('folders are refused, as is a destination that is not a folder', async () => {
    const { manager, files } = await fixture()
    await manager.move(at('deep'), at('other'))
    expect(manager.toast.text).toBe('Only files can be moved')
    await manager.move(at('b.md'), at('index.md'))
    expect(manager.toast.text).toBe('index.md is not a folder')
    expect(documents(files).length).toBe(7)
  })

  test('Escape cancels a pending cut and says whether there was one', async () => {
    const { manager } = await fixture()
    expect(manager.cancelCut()).toBe(false)
    manager.cut(at('b.md'))
    expect(manager.cancelCut()).toBe(true)
    expect(manager.cutFile).toBeNull()
  })

  test('a row dropped on a folder moves it; a drop with nothing dragged from the sidebar does nothing', async () => {
    const { manager, files } = await fixture()
    await manager.dropDragged(at('other'))
    expect(documents(files).length).toBe(7)

    manager.draggedFile = at('b.md')
    await manager.dropDragged(at('other'))
    expect(manager.draggedFile).toBeNull()
    expect(files[at('other/b.md')]).toBe('# b')
    expect(files[at('index.md')]).toBe('see [a](./a.md) and [b](./other/b.md)')
    expect(manager.toast.text).toBe('Updated 1 link in 1 file')
  })

  test('an unsaved buffer that links to the moved file is rewritten in place, a clean open one is reloaded', async () => {
    const { manager, files } = await fixture()
    await manager.open(at('index.md'))
    manager.setDocumentText('typed [a](./a.md) but not saved')
    await manager.move(at('a.md'), at('other'))
    expect(manager.document?.text).toBe('typed [a](./other/a.md) but not saved')
    expect(manager.document?.isDirty).toBe(true)
    expect(files[at('index.md')]).toBe('see [a](./a.md) and [b](./b.md)')
    expect(manager.toast.text).toBe('Updated 4 links in 3 files - 1 unsaved')

    manager.prompts.discardHandler = async () => 'discard'
    await manager.open(at('deep/x.md'))
    expect(manager.document?.text).toBe('see [a](../other/a.md)')
    await manager.move(at('other/a.md'), ROOT)
    expect(manager.document?.text).toBe('see [a](../a.md)')
    expect(manager.document?.isDirty).toBe(false)
  })

  test('a trashed file is no longer cut or dragged', async () => {
    const { manager } = await fixture()
    manager.cut(at('b.md'))
    manager.draggedFile = at('b.md')
    manager.prompts.confirmHandler = async () => true
    await manager.trash(at('b.md'))
    expect(manager.cutFile).toBeNull()
    expect(manager.draggedFile).toBeNull()
  })
})

describe('links from the preview', () => {
  // The memory Native with a shell that remembers what it was asked to open.
  async function linkFixture() {
    const calls: string[] = []
    const files = {
      [at('a.md')]: '# a',
      [at('b.md')]: '# b\n\n## Intro',
      [at('spec.pdf')]: '%PDF',
      [at('sub/c.md')]: '# c',
      '/home/dev/elsewhere/z.md': '# z',
    }
    const base = memoryNative(files, HOME)
    installNative({
      ...base,
      shell: {
        ...base.shell,
        reveal: async (p) => { calls.push(`reveal ${p}`) },
        openURL: async (u) => { calls.push(`url ${u}`) },
        openPath: async (p) => { calls.push(`path ${p}`) },
      },
    })
    const folders = await RootFolders.load()
    folders.add(ROOT, true)
    const manager = new Manager(await SettingsStore.load(), folders, HOME)
    await manager.notes.reload()
    await manager.tree.refreshAll()
    return { manager, files, calls }
  }

  test('an external link goes to the OS, a non-document file too', async () => {
    const { manager, calls } = await linkFixture()
    await manager.followLink('https://example.com/x')
    await manager.followLink(`file://${at('spec.pdf')}`)
    expect(calls).toEqual(['url https://example.com/x', `path ${at('spec.pdf')}`])
    expect(manager.document).toBeNull()
  })

  test('a document opens in the app, revealed in the sidebar, and its anchor is requested', async () => {
    const { manager, calls } = await linkFixture()
    await manager.followLink(`file://${at('b.md')}#intro`)
    expect(manager.document?.path).toBe(at('b.md'))
    expect(manager.tree.cursorRow?.node.path).toBe(at('b.md'))
    expect(manager.anchorRequest?.id).toBe('intro')
    expect(calls).toEqual([])

    // Same file, another anchor: no reopen, just a new request.
    const seq = manager.anchorRequest!.seq
    await manager.followLink(`file://${at('b.md')}#other`)
    expect(manager.anchorRequest).toEqual({ id: 'other', seq: seq + 1 })
  })

  test('a document outside every root is opened and its folder listed', async () => {
    const { manager } = await linkFixture()
    await manager.followLink('file:///home/dev/elsewhere/z.md')
    expect(manager.document?.path).toBe('/home/dev/elsewhere/z.md')
    expect(manager.folders.active).toBe('/home/dev/elsewhere')
  })

  test('a folder inside a root is revealed; one outside becomes a root', async () => {
    const { manager } = await linkFixture()
    await manager.followLink(`file://${at('sub')}/`)
    expect(manager.folders.active).toBe(ROOT)
    expect(manager.tree.cursorRow?.node.path).toBe(at('sub'))

    await manager.followLink('file:///home/dev/elsewhere')
    expect(manager.folders.active).toBe('/home/dev/elsewhere')
  })

  test('a missing target is reported by name', async () => {
    const { manager } = await linkFixture()
    await manager.followLink(`file://${at('gone.md')}`)
    expect(manager.toast.text).toBe('Not found: gone.md')
    expect(manager.document).toBeNull()
  })

  test('Cmd-Shift-R reveals the open document, or the sidebar row when nothing is open', async () => {
    const { manager, calls } = await linkFixture()
    manager.tree.moveCursor(1)
    manager.revealSelection()
    await manager.open(at('b.md'))
    manager.revealSelection()
    expect(calls).toEqual([`reveal ${at('a.md')}`, `reveal ${at('b.md')}`])
  })
})

describe('files dropped into the raw pane', () => {
  test('one link per line, relative to the open document, an embed for an image', async () => {
    const { manager } = await setup({ [at('sub/a.md')]: '# a', [at('b.md')]: '# b' })
    expect(manager.linksFor([at('b.md')])).toBeNull()
    await manager.open(at('sub/a.md'))
    expect(manager.linksFor([at('b.md'), at('sub/img/shot.png'), '/home/dev/Pictures/x.JPG']))
      .toBe('[b.md](../b.md)\n![shot.png](./img/shot.png)\n![x.JPG](../../Pictures/x.JPG)')
    expect(manager.linksFor([])).toBeNull()
  })
})
