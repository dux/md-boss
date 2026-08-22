import { describe, expect, test } from 'bun:test'
import { AnnotationStore } from '../src/models/annotationStore'
import { LineIndex } from '../src/models/lineIndex'
import { RootFolders } from '../src/models/rootFolders'
import { installNative, native } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const FALLBACK = `${HOME}/.config/md-boss/annotations.json`
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup(files: Record<string, string>, roots: string[] = ['/home/dev/notes']) {
  const nat = memoryNative(files, HOME)
  installNative(nat)
  await nat.fs.mkdir(`${HOME}/.config/md-boss`)
  const folders = await RootFolders.load()
  for (const root of [...roots].reverse()) folders.add(root, true)
  const store = new AnnotationStore(folders, FALLBACK, HOME)
  await store.reload()
  return { store, folders, files }
}

describe('AnnotationStore', () => {
  test('reads the root store and the fallback, answers per document, and writes through', async () => {
    const { store, files } = await setup({
      '/home/dev/notes/a.md': '# A\nline two\n',
      '/home/dev/notes/.md-boss': JSON.stringify({ bookmarks: [{ path: '~/notes/a.md', line: 2, title: 'two' }] }),
      [FALLBACK]: JSON.stringify({ notes: [{ path: '~/elsewhere/x.md', line: 1, body: 'outside' }] }),
    })
    expect(store.notes.map((n) => n.path)).toEqual(['~/elsewhere/x.md', '~/notes/a.md'])
    expect(store.noteCount('/home/dev/notes/a.md')).toBe(1)
    expect(store.noteAt('/home/dev/notes/a.md', 2)?.title).toBe('two')
    expect(store.noteTexts('/home/dev/notes/a.md').get(2)).toBe('Note on line 2')
    expect(store.hasNotes('/home/dev/notes/b.md')).toBe(false)

    let changes = 0
    store.onChange(() => changes++)
    await store.setNote('/home/dev/notes/a.md', 1, 'A', 'first')
    expect(changes).toBe(1)
    expect(store.notesFor('/home/dev/notes/a.md').map((n) => n.line)).toEqual([1, 2])
    // written in the canonical shape - the legacy key is gone
    expect(files['/home/dev/notes/.md-boss']).toContain('"notes"')
    expect(files['/home/dev/notes/.md-boss']).not.toContain('bookmarks')
    // editing over an existing line replaces it; an empty note removes it
    await store.setNote('/home/dev/notes/a.md', 2, 'two!', '')
    expect(store.noteAt('/home/dev/notes/a.md', 2)?.title).toBe('two!')
    await store.setNote('/home/dev/notes/a.md', 2, '', '  ')
    expect(store.noteAt('/home/dev/notes/a.md', 2)).toBeNull()
    // a note for a file under no root lands in the fallback
    await store.setNote('/tmp/loose.md', 3, 'loose', '')
    expect(files[FALLBACK]).toContain('/tmp/loose.md')
  })

  test('a store emptied by removal is deleted from disk', async () => {
    const { store, files } = await setup({
      '/home/dev/notes/a.md': '',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 2 }] }),
    })
    await store.remove(store.notes[0])
    expect(files['/home/dev/notes/.md-boss']).toBeUndefined()
    expect(store.notes).toEqual([])
  })

  test('an external edit to .md-boss is picked up', async () => {
    const { store } = await setup({
      '/home/dev/notes/a.md': '',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 2 }] }),
    })
    let changes = 0
    store.onChange(() => changes++)
    await native().fs.write('/home/dev/notes/.md-boss', JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 5, title: 'moved by hand' }] }))
    await tick()
    await tick()
    await tick()
    expect(store.notesFor('/home/dev/notes/a.md').map((n) => n.line)).toEqual([5])
    expect(changes).toBe(1)
  })

  test('a note duplicated across stores is repaired into the one that owns the document', async () => {
    const { store, files } = await setup({
      '/home/dev/notes/a.md': '',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 2, title: 'here' }] }),
      [FALLBACK]: JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 2, body: 'stray copy' }] }),
    })
    expect(store.notes).toEqual([{ path: '~/notes/a.md', line: 2, title: 'here', body: 'stray copy' }])
    expect(files[FALLBACK]).toBeUndefined()
    expect(files['/home/dev/notes/.md-boss']).toContain('stray copy')
  })

  test('shift follows an edit; repoint and removeAll follow a move and a trash', async () => {
    const { store, files } = await setup({
      '/home/dev/notes/a.md': 'one\ntwo\nthree\n',
      '/home/dev/notes/.md-boss': JSON.stringify({ notes: [{ path: '~/notes/a.md', line: 3, title: 'three' }] }),
    })
    const before = new LineIndex('one\ntwo\nthree\n')
    const after = new LineIndex('one\nX\ntwo\nthree\n')
    await store.shift('/home/dev/notes/a.md', before, after, { start: 4, end: 4, length: 2 })
    expect(store.notesFor('/home/dev/notes/a.md').map((n) => n.line)).toEqual([4])

    await store.repoint('/home/dev/notes/a.md', '/home/dev/notes/sub/b.md')
    expect(store.notesFor('/home/dev/notes/a.md')).toEqual([])
    expect(store.notesFor('/home/dev/notes/sub/b.md').map((n) => n.title)).toEqual(['three'])
    expect(files['/home/dev/notes/.md-boss']).toContain('sub/b.md')

    expect(await store.removeAll('/home/dev/notes/sub/b.md')).toBe(1)
    expect(store.notes).toEqual([])
    expect(files['/home/dev/notes/.md-boss']).toBeUndefined()
  })
})
