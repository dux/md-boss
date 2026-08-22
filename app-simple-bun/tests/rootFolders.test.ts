import { describe, expect, test } from 'bun:test'
import { RootFolders } from '../src/models/rootFolders'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('root folders', () => {
  test('adding at the top moves an existing root instead of duplicating it', async () => {
    const files: Record<string, string> = {}
    installNative(memoryNative(files))
    const folders = await RootFolders.load()
    folders.add('/a')
    folders.add('/b')
    expect(folders.roots).toEqual(['/a', '/b'])
    folders.add('/b', true)
    expect(folders.roots).toEqual(['/b', '/a'])
    await tick()
    expect(files['/home/dev/.config/md-boss/roots.txt']).toBe('/b\n/a\n')
  })

  test('selecting a folder makes it active without duplicating it', async () => {
    installNative(memoryNative({}))
    const folders = await RootFolders.load()
    for (const p of ['/a', '/b', '/c']) folders.add(p)
    expect(folders.active).toBe('/a')
    folders.select('/c')
    expect(folders.roots).toEqual(['/c', '/a', '/b'])
    let changes = 0
    folders.onChange(() => changes++)
    folders.select('/c')
    expect(folders.roots).toEqual(['/c', '/a', '/b'])
    expect(changes).toBe(0)
  })

  test('recent is capped at twenty without dropping the rest', async () => {
    installNative(memoryNative({}))
    const folders = await RootFolders.load()
    for (let i = 0; i < 24; i++) folders.add(`/f${i}`)
    expect(folders.recent).toHaveLength(20)
    expect(folders.roots).toHaveLength(24)
    expect(folders.recent[19]).toBe('/f19')
  })

  test('rootContaining matches on path boundaries, not prefixes', async () => {
    installNative(memoryNative({}))
    const folders = await RootFolders.load()
    folders.add('/work/notes')
    expect(folders.rootContaining('/work/notes/a.md')).toBe('/work/notes')
    expect(folders.rootContaining('/work/notes')).toBe('/work/notes')
    expect(folders.rootContaining('/work/notes-old/a.md')).toBeNull()
  })

  test('loads the file, skipping comments and blanks, and remove writes it back', async () => {
    const files = { '/home/dev/.config/md-boss/roots.txt': '# mine\n/a\n\n/b/\n' }
    installNative(memoryNative(files))
    const folders = await RootFolders.load()
    expect(folders.roots).toEqual(['/a', '/b'])
    folders.remove('/a')
    await tick()
    expect(files['/home/dev/.config/md-boss/roots.txt']).toBe('/b\n')
    expect(folders.contains('/b')).toBe(true)
  })
})
