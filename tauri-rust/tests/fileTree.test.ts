import { describe, expect, test } from 'bun:test'
import { flatten, type FileNode } from '../src/models/fileTree'
import { FileTreeModel } from '../src/models/fileTreeModel'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const node = (path: string, isDir: boolean): FileNode => ({ path, name: path.slice(path.lastIndexOf('/') + 1), isDir })
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('flatten', () => {
  const children = new Map<string, FileNode[]>([
    ['/r', [node('/r/docs', true), node('/r/top.md', false)]],
    ['/r/docs', [node('/r/docs/deep.md', false)]],
  ])
  const rows = (expanded: string[], denied: string[] = []) => flatten('/r', children, new Set(expanded), new Set(denied))

  test('the root is dived into, not drawn', () => {
    expect(rows([]).map((r) => r.node.name)).toEqual(['docs', 'top.md'])
    expect(rows([]).map((r) => r.depth)).toEqual([0, 0])
  })

  test('only expanded directories contribute rows, and depth increases with nesting', () => {
    expect(rows(['/r/docs']).map((r) => r.node.name)).toEqual(['docs', 'deep.md', 'top.md'])
    expect(rows(['/r/docs']).map((r) => r.depth)).toEqual([0, 1, 0])
  })

  test('no listing yet, or no root, means no rows', () => {
    expect(flatten('/r', new Map(), new Set(), new Set())).toEqual([])
    expect(flatten(null, children, new Set(), new Set())).toEqual([])
  })

  test('the denied flag reaches the row', () => {
    expect(rows([], ['/r/docs'])[0].isDenied).toBe(true)
    expect(rows([], ['/r/docs'])[1].isDenied).toBe(false)
  })
})

describe('tree model', () => {
  const files = () => ({
    '/w/top.md': '', '/w/docs/deep.md': '', '/w/docs/inner/x.md': '', '/w/src/main.swift': '', '/w/b.md': '',
  })

  test('lists the root one level deep, folders first, and expands on demand', async () => {
    installNative(memoryNative(files()))
    const tree = new FileTreeModel()
    let changes = 0
    tree.onChange(() => changes++)
    tree.setRoot('/w', ['node_modules'])
    await tick()
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'b.md', 'top.md'])
    expect(changes).toBe(1)

    tree.expand(tree.rows[0].node)
    await tick()
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'inner', 'deep.md', 'b.md', 'top.md'])
    expect(tree.rows.map((r) => r.depth)).toEqual([0, 1, 1, 0, 0])
    expect(tree.expandedPaths).toEqual(['/w/docs'])

    tree.collapse(tree.rows[0].node)
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'b.md', 'top.md'])
  })

  test('a missing root says so, a new root resets the cursor', async () => {
    installNative(memoryNative(files()))
    const tree = new FileTreeModel()
    tree.setRoot('/gone', [])
    await tick()
    expect(tree.rows).toEqual([])
    expect(tree.activeIsMissing).toBe(true)
    expect(tree.activeIsDenied).toBe(false)

    tree.setRoot('/w', [])
    await tick()
    tree.moveCursor(2)
    expect(tree.cursor).toBe(2)
    tree.setRoot('/gone', [])
    expect(tree.cursor).toBe(0)
  })

  test('a row appearing above the cursor leaves the cursor on its own file', async () => {
    const tree_files: Record<string, string> = files()
    installNative(memoryNative(tree_files))
    const tree = new FileTreeModel()
    tree.setRoot('/w', [])
    await tick()
    tree.moveCursor(2) // top.md
    tree_files['/w/a.md'] = ''
    await tree.refresh('/w')
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'a.md', 'b.md', 'top.md'])
    expect(tree.cursorRow?.node.name).toBe('top.md')
  })

  test('the cursor holds its place when its own row is deleted', async () => {
    const tree_files: Record<string, string> = files()
    installNative(memoryNative(tree_files))
    const tree = new FileTreeModel()
    tree.setRoot('/w', [])
    await tick()
    tree.moveCursor(1) // b.md
    delete tree_files['/w/b.md']
    await tree.refresh('/w')
    expect(tree.cursor).toBe(1)
    expect(tree.cursorRow?.node.name).toBe('top.md')
  })

  test('expansion of a subfolder that vanished is dropped on the next listing', async () => {
    const tree_files: Record<string, string> = files()
    installNative(memoryNative(tree_files))
    const tree = new FileTreeModel(['/w/docs'])
    tree.setRoot('/w', [])
    await tick()
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'inner', 'deep.md', 'b.md', 'top.md'])
    delete tree_files['/w/docs/deep.md']
    delete tree_files['/w/docs/inner/x.md']
    await tree.refresh('/w')
    expect(tree.expandedPaths).toEqual([])
  })
})
