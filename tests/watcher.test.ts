import { describe, expect, test } from 'bun:test'
import { DirectoryWatcher } from '../src/models/directoryWatcher'
import { FileTreeModel } from '../src/models/fileTreeModel'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('directory watcher', () => {
  test('watches exactly the synced set and stops at the cap', async () => {
    installNative(memoryNative({ '/w/a.md': '' }))
    const seen: string[] = []
    const watcher = new DirectoryWatcher((dir) => seen.push(dir))
    watcher.sync(new Set(['/w']))
    await tick()
    await native().fs.write('/w/b.md', '')
    await tick()
    expect(seen).toEqual(['/w'])
    watcher.sync(new Set())
    await tick()
    await native().fs.write('/w/c.md', '')
    await tick()
    expect(seen).toEqual(['/w'])
    expect(watcher.count).toBe(0)

    const many = new Set(Array.from({ length: 130 }, (_, i) => `/w/d${i}`))
    watcher.sync(many)
    expect(watcher.count).toBe(DirectoryWatcher.maxWatchers)
    expect(watcher.isSaturated).toBe(true)
  })
})

describe('tree follows the disk', () => {
  test('a file written into the root appears, with the cursor on the file it was on', async () => {
    installNative(memoryNative({ '/w/b.md': '', '/w/top.md': '', '/w/docs/deep.md': '' }))
    const tree = new FileTreeModel()
    tree.setRoot('/w', [])
    await tick()
    tree.moveCursor(2) // top.md
    await native().fs.write('/w/a.md', 'new')
    await tick()
    await tick()
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'a.md', 'b.md', 'top.md'])
    expect(tree.cursorRow?.node.name).toBe('top.md')
  })

  test('an expanded subfolder is watched, a collapsed one waits for the poll', async () => {
    installNative(memoryNative({ '/w/top.md': '', '/w/docs/deep.md': '', '/w/other/x.md': '' }))
    const tree = new FileTreeModel()
    tree.setRoot('/w', [])
    await tick()
    tree.expand(tree.rows[0].node) // docs
    await tick()
    await native().fs.write('/w/docs/new.md', '')
    await tick()
    await tick()
    expect(tree.rows.map((r) => r.node.name)).toEqual(['docs', 'deep.md', 'new.md', 'other', 'top.md'])

    tree.collapse(tree.rows[0].node)
    await tick()
    await native().fs.write('/w/docs/later.md', '')
    await tick()
    await tick()
    tree.expand(tree.rows[0].node)
    await tick()
    // Already listed while collapsed, so the expand shows the stale listing until refreshAll.
    await tree.refreshAll()
    expect(tree.rows.map((r) => r.node.name)).toContain('later.md')
  })
})

describe('open document follows the disk', () => {
  test('a save from elsewhere re-reads the open file', async () => {
    const files = { '/w/a.md': 'one' }
    installNative(memoryNative(files))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    await manager.open('/w/a.md')
    let changes = 0
    manager.onChange(() => changes++)
    await native().fs.write('/w/a.md', 'two')
    await tick()
    await tick()
    expect(manager.document?.text).toBe('two')
    expect(changes).toBe(1)
    await native().fs.write('/w/a.md', 'two') // same text - nothing to say
    await tick()
    expect(changes).toBe(1)
  })
})
