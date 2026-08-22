import { describe, expect, test } from 'bun:test'
import { parentRow, prefixMatch, type FlatRow } from '../src/models/fileTree'
import { FileTreeModel } from '../src/models/fileTreeModel'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { isNameCharacter, TYPE_AHEAD_RESET_MS, TypeAhead } from '../src/models/typeAhead'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const tick = () => new Promise((r) => setTimeout(r, 0))
const row = (name: string, depth: number, isDir = false): FlatRow => ({ node: { path: '/r/' + name, name, isDir }, depth, isDenied: false })

describe('prefixMatch', () => {
  const rows = [row('alpha', 0), row('beta', 0), row('bravo', 0), row('Gamma', 0)]

  test('searches forward from the cursor and wraps, case-insensitively', () => {
    expect(prefixMatch(rows, 0, 'b')).toBe(1)
    expect(prefixMatch(rows, 1, 'b')).toBe(2)
    expect(prefixMatch(rows, 2, 'b')).toBe(1)
    expect(prefixMatch(rows, 3, 'g')).toBe(3)
    expect(prefixMatch(rows, 0, 'GA')).toBe(3)
  })

  test('a longer prefix narrows, nothing matches gives -1', () => {
    expect(prefixMatch(rows, 0, 'br')).toBe(2)
    expect(prefixMatch(rows, 0, 'z')).toBe(-1)
    expect(prefixMatch(rows, 0, '')).toBe(-1)
    expect(prefixMatch([], 0, 'a')).toBe(-1)
  })
})

describe('parentRow', () => {
  const rows = [row('docs', 0, true), row('inner', 1, true), row('x.md', 2), row('deep.md', 1), row('top.md', 0)]

  test('finds the nearest shallower row above, none at the top', () => {
    expect(parentRow(rows, 2)).toBe(1)
    expect(parentRow(rows, 3)).toBe(0)
    expect(parentRow(rows, 4)).toBe(-1)
    expect(parentRow(rows, 0)).toBe(-1)
    expect(parentRow(rows, 9)).toBe(-1)
  })
})

describe('TypeAhead', () => {
  test('characters within the reset window build a prefix, a pause starts over', () => {
    const typed = new TypeAhead()
    expect(typed.append('B', 1000)).toBe('b')
    expect(typed.append('r', 1000 + TYPE_AHEAD_RESET_MS)).toBe('br')
    expect(typed.append('a', 1000 + TYPE_AHEAD_RESET_MS * 2 + 1)).toBe('a')
  })

  test('only letters and digits count, and a stray key leaves the prefix alone', () => {
    const typed = new TypeAhead()
    expect(typed.append('d', 0)).toBe('d')
    expect(typed.append('-', 10)).toBeNull()
    expect(typed.append(' ', 10)).toBeNull()
    expect(typed.append('ArrowDown', 10)).toBeNull()
    expect(typed.append('o', 20)).toBe('do')
    typed.reset()
    expect(typed.append('c', 30)).toBe('c')
  })

  test('isNameCharacter reads any script, one character at a time', () => {
    expect(isNameCharacter('ž')).toBe(true)
    expect(isNameCharacter('7')).toBe(true)
    expect(isNameCharacter('日')).toBe(true)
    expect(isNameCharacter('.')).toBe(false)
    expect(isNameCharacter('ab')).toBe(false)
    expect(isNameCharacter('')).toBe(false)
  })
})

describe('tree keyboard', () => {
  const files = () => ({
    '/w/top.md': '', '/w/docs/deep.md': '', '/w/docs/inner/x.md': '', '/w/b.md': '',
  })
  const names = (tree: FileTreeModel) => tree.rows.map((r) => r.node.name)

  async function load(expanded: string[] = []) {
    installNative(memoryNative(files()))
    const tree = new FileTreeModel(expanded)
    tree.setRoot('/w', [])
    await tick()
    return tree
  }

  test('up and down clamp, and report whether there was anything to move on', async () => {
    const tree = await load()
    expect(names(tree)).toEqual(['docs', 'b.md', 'top.md'])
    expect(tree.moveCursorBy(-1)).toBe(true)
    expect(tree.cursor).toBe(0)
    expect(tree.moveCursorBy(1)).toBe(true)
    expect(tree.moveCursorBy(5)).toBe(true)
    expect(tree.cursor).toBe(2)

    const empty = new FileTreeModel()
    expect(empty.moveCursorBy(1)).toBe(false)
  })

  test('right opens a folder, then steps into it; nothing on a file', async () => {
    const tree = await load()
    expect(tree.expandOrDescend()).toBe(true)
    await tick()
    expect(names(tree)).toEqual(['docs', 'inner', 'deep.md', 'b.md', 'top.md'])
    expect(tree.cursor).toBe(0)
    expect(tree.expandOrDescend()).toBe(true)
    expect(tree.cursor).toBe(1)
    tree.moveCursor(2)
    expect(tree.expandOrDescend()).toBe(false)
    expect(tree.cursor).toBe(2)
  })

  test('left closes an open folder, otherwise climbs to the parent, nothing at the top', async () => {
    const tree = await load(['/w/docs', '/w/docs/inner'])
    expect(names(tree)).toEqual(['docs', 'inner', 'x.md', 'deep.md', 'b.md', 'top.md'])
    tree.moveCursor(2)
    expect(tree.collapseOrAscend()).toBe(true)
    expect(tree.cursor).toBe(1)
    expect(tree.collapseOrAscend()).toBe(true)
    expect(names(tree)).toEqual(['docs', 'inner', 'deep.md', 'b.md', 'top.md'])
    expect(tree.cursor).toBe(1)
    expect(tree.collapseOrAscend()).toBe(true)
    expect(tree.cursor).toBe(0)
    tree.moveCursor(4)
    expect(tree.collapseOrAscend()).toBe(false)
    expect(tree.cursor).toBe(4)
  })

  test('type-to-jump moves to the next match after the cursor and is handled either way', async () => {
    const tree = await load()
    expect(tree.jumpTo('t')).toBe(true)
    expect(tree.cursorRow?.node.name).toBe('top.md')
    expect(tree.jumpTo('d')).toBe(true)
    expect(tree.cursorRow?.node.name).toBe('docs')
    expect(tree.jumpTo('zzz')).toBe(true)
    expect(tree.cursorRow?.node.name).toBe('docs')
  })
})

describe('manager', () => {
  test('Cmd-0 flips showSidebar, Escape cancels a cut only when one is pending', async () => {
    installNative(memoryNative({ '/w/a.md': '' }))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    expect(manager.settings.data.showSidebar).toBe(true)
    manager.toggleSidebar()
    expect(manager.settings.data.showSidebar).toBe(false)
    manager.toggleSidebar()
    expect(manager.settings.data.showSidebar).toBe(true)

    let changes = 0
    manager.onChange(() => changes++)
    expect(manager.cancelCut()).toBe(false)
    expect(changes).toBe(0)
    manager.cutFile = '/w/a.md'
    expect(manager.cancelCut()).toBe(true)
    expect(manager.cutFile).toBeNull()
    expect(changes).toBe(1)
  })
})
