import { describe, expect, test } from 'bun:test'
import { OpenDocument } from '../src/models/document'
import { ScrollMemory } from '../src/models/scrollMemory'
import { FONT_SETTINGS } from '../src/models/settings'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

describe('OpenDocument', () => {
  test('dirty is the buffer differing from what was saved, and save clears it', async () => {
    const files = { '/w/a.md': 'one\n' }
    installNative(memoryNative(files))
    const doc = await OpenDocument.load('/w/a.md')
    expect(doc.isDirty).toBe(false)
    expect(await doc.save()).toBe(false)
    doc.text = 'two\n'
    expect(doc.isDirty).toBe(true)
    expect(await doc.save()).toBe(true)
    expect(doc.isDirty).toBe(false)
    expect(await native().fs.read('/w/a.md')).toBe('two\n')
    doc.text = 'one\n'
    expect(doc.isDirty).toBe(true)
  })

  test('CRLF files are edited as LF and written back as CRLF', async () => {
    const files = { '/w/win.md': 'a\r\nb\r\n' }
    installNative(memoryNative(files))
    const doc = await OpenDocument.load('/w/win.md')
    expect(doc.text).toBe('a\nb\n')
    expect(doc.usesCRLF).toBe(true)
    doc.text = 'a\nb\nc\n'
    await doc.save()
    expect(await native().fs.read('/w/win.md')).toBe('a\r\nb\r\nc\r\n')
  })

  test('replacing from disk is a clean buffer and a new reload token', () => {
    const doc = new OpenDocument('/w/a.md', 'one')
    doc.text = 'edited'
    doc.replaceFromDisk('fresh\r\n', { mtime: 1, size: 7 })
    expect(doc.text).toBe('fresh\n')
    expect(doc.isDirty).toBe(false)
    expect(doc.reloadToken).toBe(1)
    expect(doc.name).toBe('a.md')
  })
})

describe('manager editing', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('typing flips dirty once, save writes and clears it, the last file is remembered', async () => {
    const files = { '/w/a.md': 'one' }
    installNative(memoryNative(files))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    await manager.open('/w/a.md')
    expect(manager.settings.data.lastOpenedFile).toBe('/w/a.md')
    let changes = 0
    manager.onChange(() => changes++)
    manager.setDocumentText('on')
    manager.setDocumentText('o')
    expect(manager.isDirty).toBe(true)
    expect(changes).toBe(1)
    manager.setDocumentText('one')
    expect(manager.isDirty).toBe(false)
    expect(changes).toBe(2)
    manager.setDocumentText('two')
    await manager.saveDocument()
    expect(manager.isDirty).toBe(false)
    expect(files['/w/a.md']).toBe('two')
  })

  test('a disk change is taken when the buffer is clean and left when it is dirty', async () => {
    const files = { '/w/a.md': 'one' }
    installNative(memoryNative(files))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    await manager.open('/w/a.md')
    manager.setDocumentText('mine')
    await native().fs.write('/w/a.md', 'theirs')
    await tick()
    await tick()
    expect(manager.document?.text).toBe('mine')
    expect(manager.document?.reloadToken).toBe(0)
    manager.setDocumentText('one') // clean again, against the old saved text
    await native().fs.write('/w/a.md', 'theirs again')
    await tick()
    await tick()
    expect(manager.document?.text).toBe('theirs again')
    expect(manager.document?.reloadToken).toBe(1)
  })

  test('restoreSession opens the remembered file and forgets a missing one', async () => {
    installNative(memoryNative({ '/w/a.md': 'one' }))
    let manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    manager.settings.patch({ lastOpenedFile: '/w/a.md' })
    await manager.restoreSession()
    expect(manager.document?.path).toBe('/w/a.md')
    manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    manager.settings.patch({ lastOpenedFile: '/w/gone.md' })
    await manager.restoreSession()
    expect(manager.document).toBeNull()
    expect(manager.settings.data.lastOpenedFile).toBeNull()
  })
})

describe('external changes', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('a clean buffer takes a disk change; a dirty one raises a conflict until reloaded or kept', async () => {
    const files = { '/w/a.md': 'one' }
    installNative(memoryNative(files))
    const doc = await OpenDocument.load('/w/a.md')
    expect(await doc.syncWithDisk()).toBe('unchanged')
    await native().fs.write('/w/a.md', 'two')
    expect(await doc.syncWithDisk()).toBe('reloaded')
    expect(doc.text).toBe('two')
    expect(doc.reloadToken).toBe(1)

    doc.text = 'mine'
    await native().fs.write('/w/a.md', 'theirs')
    expect(await doc.syncWithDisk()).toBe('conflict')
    expect(doc.externalChange).toBe('conflict')
    expect(doc.text).toBe('mine')
    await doc.keepMine()
    expect(doc.externalChange).toBeNull()
    expect(await doc.syncWithDisk()).toBe('unchanged') // the version moved forward
    await native().fs.write('/w/a.md', 'theirs again')
    expect(await doc.syncWithDisk()).toBe('conflict')
    await doc.reloadFromDisk()
    expect(doc.text).toBe('theirs again')
    expect(doc.isDirty).toBe(false)
    expect(doc.externalChange).toBeNull()
  })

  test('our own save is not an external change', async () => {
    installNative(memoryNative({ '/w/a.md': 'one' }))
    const doc = await OpenDocument.load('/w/a.md')
    doc.text = 'two'
    await doc.save()
    expect(await doc.syncWithDisk()).toBe('unchanged')
  })

  test('a missing file detaches rather than closing, and reattaches when it comes back', async () => {
    const files: Record<string, string> = { '/w/a.md': 'one' }
    installNative(memoryNative(files))
    const doc = await OpenDocument.load('/w/a.md')
    doc.text = 'edited'
    delete files['/w/a.md']
    expect(await doc.syncWithDisk()).toBe('detached')
    expect(doc.externalChange).toBe('detached')
    expect(doc.text).toBe('edited')
    files['/w/a.md'] = 'one' // same stamp as before
    expect(await doc.syncWithDisk()).toBe('unchanged')
    expect(doc.externalChange).toBeNull()
  })

  test('the manager surfaces the outcome and a notice', async () => {
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
    expect(manager.notice).toBe('Reloaded a.md')
    expect(changes).toBe(1)
    manager.setDocumentText('mine')
    await native().fs.write('/w/a.md', 'three')
    await tick()
    await tick()
    expect(manager.document?.externalChange).toBe('conflict')
    await manager.keepMine()
    expect(manager.document?.externalChange).toBeNull()
    await manager.saveDocument()
    expect(files['/w/a.md']).toBe('mine')
  })
})

describe('history', () => {
  test('opening pushes the file left behind; back pops it and skips what is gone', async () => {
    const files: Record<string, string> = { '/w/a.md': 'a', '/w/b.md': 'b', '/w/c.md': 'c' }
    installNative(memoryNative(files))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    await manager.open('/w/a.md')
    expect(manager.canGoBack).toBe(false)
    await manager.open('/w/b.md')
    await manager.open('/w/c.md')
    expect(manager.history).toEqual(['/w/a.md', '/w/b.md'])
    expect(manager.backTarget).toBe('/w/b.md')
    delete files['/w/b.md']
    await manager.goBack()
    expect(manager.document?.path).toBe('/w/a.md')
    expect(manager.history).toEqual([])
    await manager.open('/w/c.md')
    expect(manager.history).toEqual(['/w/a.md'])
  })

  test('a dirty document asks; Save keeps the edit, Don\'t Save drops it', async () => {
    const files: Record<string, string> = { '/w/a.md': 'a', '/w/b.md': 'b' }
    const nat = memoryNative(files)
    installNative(nat)
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    await manager.open('/w/a.md')
    manager.setDocumentText('a edited')
    nat.dialog.confirm = async () => true
    await manager.open('/w/b.md')
    expect(files['/w/a.md']).toBe('a edited')
    manager.setDocumentText('b edited')
    nat.dialog.confirm = async () => false
    await manager.open('/w/a.md')
    expect(files['/w/b.md']).toBe('b')
    expect(manager.document?.path).toBe('/w/a.md')
  })

  test('a moved file keeps its history entry and its place', () => {
    const memory = new ScrollMemory()
    memory.recordLine('/w/a.md', 12.5)
    memory.relocate('/w/a.md', '/w/z.md')
    expect(memory.place('/w/a.md')).toEqual({})
    expect(memory.place('/w/z.md').line).toBe(12.5)
    memory.recordTable('/w/z.md', { x: 1, y: 2 })
    expect(memory.place('/w/z.md')).toEqual({ line: 12.5, table: { x: 1, y: 2 } })
    memory.forget('/w/z.md')
    expect(memory.place('/w/z.md')).toEqual({})
    expect(memory.place(null)).toEqual({})
  })
})

describe('theme switching', () => {
  test('picking records the side, Cmd-Shift-D flips to the last theme on the other side', async () => {
    installNative(memoryNative({ '/w/a.md': 'a' }))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    expect(manager.theme.id).toBe('paper')
    manager.setTheme('nord')
    expect(manager.theme.id).toBe('nord')
    expect(manager.notice).toBe('Nord theme')
    manager.toggleLightDark()
    expect(manager.theme.id).toBe('paper')
    manager.setTheme('github')
    manager.toggleLightDark()
    expect(manager.theme.id).toBe('nord')
    manager.toggleLightDark()
    expect(manager.theme.id).toBe('github')
    expect(manager.settings.data).toMatchObject({ themeID: 'github', lightThemeID: 'github', darkThemeID: 'nord' })
  })
})

describe('text sizes', () => {
  test('zoom moves only the document sizes and clamps; reset restores sizes and measure', async () => {
    installNative(memoryNative({ '/w/a.md': 'a' }))
    const manager = new Manager(await SettingsStore.load(), await RootFolders.load(), '/home/dev')
    manager.zoom(2)
    expect(manager.settings.data).toMatchObject({ editorFontSize: 15, previewFontSize: 19, fontDefault: 13, fontButtons: 12 })
    for (let i = 0; i < 20; i++) manager.zoom(1)
    expect(manager.settings.data).toMatchObject({ editorFontSize: 24, previewFontSize: 28 })
    manager.changeMeasure(-100)
    expect(manager.settings.data.previewMeasure).toBe(26)
    manager.resetZoom()
    expect(manager.settings.data).toMatchObject({ editorFontSize: 13, previewFontSize: 17, previewMeasure: 48 })

    const sidebar = manager.settings.data
    manager.changeFontSize(FONT_SETTINGS[0], 3)
    expect(manager.fontSize(FONT_SETTINGS[0])).toBe(16)
    expect(manager.fontSizesAreDefault).toBe(false)
    expect(manager.canChangeFontSize(FONT_SETTINGS[0], 5)).toBe(false)
    manager.resetFontSizes()
    expect(manager.fontSizesAreDefault).toBe(true)
    expect(manager.settings.data.fontDefault).toBe(sidebar.fontDefault)
  })

  test('the chrome CSS carries the theme block and the derived caption size', async () => {
    const { chromeCSS } = await import('../src/theme/apply')
    const { defaultSettings } = await import('../src/models/settings')
    const css = chromeCSS({ ...defaultSettings(), fontDefault: 18, themeID: 'nord' })
    expect(css).toContain('--font-default: 18px')
    expect(css).toContain('--font-small: 16px')
    expect(css).toContain('--bg: #2E3440')
    expect(css).toContain('color-scheme: dark')
  })
})
