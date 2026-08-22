import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { SidebarSearch, type SearchContext } from '../src/models/sidebarSearch'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms))

const FILES = () => ({
  '/home/dev/notes/README.md': '# Notes\nalpha beta\nAlpha again\n',
  '/home/dev/notes/docs/plan.md': 'the plan\nalpha in a subfolder\n',
  '/home/dev/notes/docs/other.txt': 'nothing here\n',
  '/home/dev/other/x.md': 'alpha elsewhere\n',
})

function context(root: string | null, extra: Partial<SearchContext> = {}): SearchContext {
  return { root: () => root, skipFolders: () => [], recent: () => [], buffers: () => ({}), ...extra }
}

describe('SidebarSearch', () => {
  test('the query decides: typing activates, clearing gives the tree back and keeps the mode', async () => {
    installNative(memoryNative(FILES(), HOME))
    const search = new SidebarSearch(context('/home/dev/notes'), 0)
    let changes = 0
    search.onChange(() => changes++)
    expect(search.isActive).toBe(false)

    search.focus('files')
    expect(search.mode).toBe('files')
    expect(search.focusRequest).toBe(1)
    await tick()
    search.setQuery('pl')
    expect(search.isActive).toBe(true)
    expect(search.files.map((f) => f.display)).toEqual(['docs/plan.md'])
    expect(search.rowCount).toBe(1)

    search.clear()
    expect(search.isActive).toBe(false)
    expect(search.files).toEqual([])
    expect(search.mode).toBe('files')
    expect(changes).toBeGreaterThan(0)
  })

  test('focus twice is two requests, and switching mode keeps the query and re-runs it', async () => {
    installNative(memoryNative(FILES(), HOME))
    const search = new SidebarSearch(context('/home/dev/notes'), 0)
    search.focus('text')
    search.focus('text')
    expect(search.focusRequest).toBe(2)
    search.setQuery('alpha')
    expect(search.isRunning).toBe(true)
    await settle()
    expect(search.isRunning).toBe(false)
    expect(search.hits.map((h) => `${h.path.slice(16)}:${h.line}:${h.column}`)).toEqual([
      'README.md:2:0', 'README.md:3:0', 'docs/plan.md:2:0',
    ])
    expect(search.hits[1].length).toBe(5)

    search.focus('files')
    await settle()
    expect(search.query).toBe('alpha')
    expect(search.files).toEqual([])
    expect(search.rowCount).toBe(0)

    search.focus('text')
    await settle()
    expect(search.hits.length).toBe(3)
  })

  test('a capital makes the search exact, and the unsaved buffer is what gets searched', async () => {
    installNative(memoryNative(FILES(), HOME))
    const search = new SidebarSearch(context('/home/dev/notes', {
      buffers: () => ({ '/home/dev/notes/docs/plan.md': 'Alpha typed just now\n' }),
    }), 0)
    search.focus('text')
    search.setQuery('Alpha')
    await settle()
    expect(search.hits.map((h) => `${h.path.slice(16)}:${h.line}`)).toEqual(['README.md:3', 'docs/plan.md:1'])
    expect(search.hits[1].text).toBe('Alpha typed just now')
  })

  test('the cursor clamps to the rows, resets on a new query, and a late answer is dropped', async () => {
    installNative(memoryNative(FILES(), HOME))
    const search = new SidebarSearch(context('/home/dev/notes'), 0)
    expect(search.moveCursor(1)).toBe(false)
    search.focus('text')
    search.setQuery('alpha')
    await settle()
    expect(search.moveCursor(5)).toBe(true)
    expect(search.cursor).toBe(2)
    expect(search.moveCursor(-9)).toBe(true)
    expect(search.cursor).toBe(0)
    search.moveCursor(2)
    search.setQuery('alpha ')
    expect(search.cursor).toBe(0)
    // The second query supersedes the first before its debounce fired; only its hits land.
    search.setQuery('nothing')
    await settle()
    expect(search.hits.map((h) => h.text)).toEqual(['nothing here'])
  })

  test('changing the root drops candidates and re-ranks against the new folder', async () => {
    installNative(memoryNative(FILES(), HOME))
    let root = '/home/dev/notes'
    const search = new SidebarSearch(context(null, { root: () => root }), 0)
    search.focus('files')
    await tick()
    search.setQuery('md')
    expect(search.files.map((f) => f.display)).toEqual(['README.md', 'docs/plan.md'])
    root = '/home/dev/other'
    search.rootChanged()
    await tick()
    expect(search.files.map((f) => f.display)).toEqual(['x.md'])
  })
})

describe('manager search commands', () => {
  async function setup() {
    installNative(memoryNative(FILES(), HOME))
    const folders = await RootFolders.load()
    folders.add('/home/dev/notes', true)
    const settings = await SettingsStore.load()
    const manager = new Manager(settings, folders, HOME)
    return manager
  }

  test('find in project and go to file force the sidebar shown and focus the field in their mode', async () => {
    const manager = await setup()
    manager.settings.patch({ showSidebar: false })
    manager.findInProject()
    expect(manager.settings.data.showSidebar).toBe(true)
    expect(manager.search.mode).toBe('text')
    expect(manager.search.focusRequest).toBe(1)
    manager.goToFile()
    expect(manager.search.mode).toBe('files')
    expect(manager.search.focusRequest).toBe(2)
    expect(manager.canSearch).toBe(true)
  })

  test('a hit opens its file, reveals it and lands on the line; a file pick clears the query', async () => {
    const manager = await setup()
    await manager.goToHit({ path: '/home/dev/notes/docs/plan.md', line: 2, column: 0, length: 5, text: 'alpha in a subfolder' })
    expect(manager.document?.path).toBe('/home/dev/notes/docs/plan.md')
    expect(manager.scrollRequest?.line).toBe(2)
    expect(manager.highlightedLine).toBe(2)
    expect(manager.tree.cursorRow?.node.path).toBe('/home/dev/notes/docs/plan.md')

    manager.search.focus('files')
    await tick()
    manager.search.setQuery('readme')
    expect(manager.search.isActive).toBe(true)
    await manager.openSearchCursor()
    expect(manager.document?.path).toBe('/home/dev/notes/README.md')
    expect(manager.search.isActive).toBe(false)
  })

  test('Cmd-F shows the raw pane and leaves a one-shot request the pane follows', async () => {
    const manager = await setup()
    manager.findInDocument()
    expect(manager.findRequest).toBeNull()
    await manager.open('/home/dev/notes/README.md')
    manager.findInDocument()
    expect(manager.settings.data.visiblePanes).toContain('raw')
    expect(manager.findRequest?.id).toBe(1)
    manager.findInDocument()
    expect(manager.findRequest?.id).toBe(2)
    await manager.open('/home/dev/notes/docs/plan.md')
    expect(manager.findRequest).toBeNull()
  })
})
