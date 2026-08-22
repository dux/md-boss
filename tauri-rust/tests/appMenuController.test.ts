import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import { aboutInfo, flatItems } from '../src/models/appMenu'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { Updater } from '../src/models/updater'
import { installNative, native } from '../src/native/bridge'
import { type MemoryApp, type MemoryMenu, type MemoryUpdater, memoryNative } from '../src/native/memory'
import { AppMenu } from '../src/ui/appMenu'
import { Panels } from '../src/ui/panels'

const HOME = '/home/dev'
const ROOT = '/home/dev/notes'
const at = (p: string) => `${ROOT}/${p}`
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup(files: Record<string, string>, platform: 'macos' | 'linux' = 'macos') {
  const nat = memoryNative(files, HOME)
  nat.platform = platform
  installNative(nat)
  const folders = await RootFolders.load()
  folders.add(ROOT, true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.notes.reload()
  await manager.tree.refreshAll()
  const panels = new Panels()
  const updater = new Updater(native().updater, manager.toast, () => manager.prepareToExit())
  const menu = new AppMenu({ manager, panels, updater }, platform, aboutInfo('1.0.0'))
  await menu.install()
  const twin = native().menu as MemoryMenu
  twin.patches.length = 0
  return { manager, panels, updater, menu, twin, files }
}

const press = (code: string, over: Partial<KeyboardEvent> = {}) =>
  ({ key: '', code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent

describe('AppMenu', () => {
  test('installs the model built from the manager and patches what changes', async () => {
    const { manager, twin } = await setup({ [at('a.md')]: '# a' })
    expect(twin.installed).not.toBeNull()
    const items = new Map(flatItems(twin.installed!).map((i) => [i.id, i]))
    expect(items.get('new-file')!.enabled).toBe(true)
    expect(items.get('save')!.enabled).toBe(false)
    expect(items.get('theme:paper')!.checked).toBe(true)

    manager.toggleSidebar()
    expect(twin.patches).toEqual([{ id: 'toggle-sidebar', label: 'Show Sidebar' }])

    twin.patches.length = 0
    manager.setTheme('dark')
    expect(twin.patches).toEqual([{ id: 'theme:paper', checked: false }, { id: 'theme:dark', checked: true }])

    twin.patches.length = 0
    await manager.open(at('a.md'))
    manager.setDocumentText('# a!')
    expect(twin.patches).toContainEqual({ id: 'save', enabled: true })
    expect(twin.patches).toContainEqual({ id: 'revert', enabled: true })
  })

  test('a click on an item runs the manager command', async () => {
    const { manager, panels, twin } = await setup({ [at('a.md')]: '# a' })
    const toggled: string[] = []
    panels.onToggle((p) => toggled.push(p))
    twin.click('settings')
    expect(toggled).toEqual(['settings'])

    twin.click('toggle-raw')
    expect(manager.settings.data.visiblePanes).toEqual(['preview', 'raw'])

    twin.click('theme:nord')
    expect(manager.theme.id).toBe('nord')
    // The clicked check item is re-asserted, whatever the native toggle did to it.
    expect(twin.patches.at(-1)).toEqual({ id: 'theme:nord', checked: true })

    await manager.open(at('a.md'))
    manager.setDocumentText('changed')
    twin.click('revert')
    await tick()
    expect(manager.document?.text).toBe('# a')
    expect(manager.isDirty).toBe(false)
  })

  test('the Help item checks for updates, and is the restart once one is downloaded', async () => {
    const { manager, updater, twin } = await setup({ [at('a.md')]: '# a' })
    const nat = native().updater as MemoryUpdater
    twin.click('check-updates')
    await tick()
    expect(manager.toast.text).toBe('md-boss is up to date')

    nat.offer('9.9.9')
    twin.click('check-updates')
    await tick()
    await tick()
    expect(updater.ready).toBe(true)
    expect(twin.patches).toContainEqual({ id: 'check-updates', label: 'Restart to Update' })

    twin.click('check-updates')
    await tick()
    await tick()
    expect(nat.installed).toEqual(['9.9.9'])
    expect(nat.relaunches).toBe(1)
  })

  test('Quit and the close button run the unsaved-edits guard before the process ends', async () => {
    const { manager, twin } = await setup({ [at('a.md')]: '# a' })
    const app = native().app as MemoryApp
    await manager.open(at('a.md'))
    manager.setDocumentText('changed')
    // Save fails to stick: the quit is refused and the app stays up.
    manager.prompts.discardHandler = async () => 'save'
    const write = native().fs.write
    native().fs.write = async () => { throw new Error('disk full') }
    twin.click('quit')
    await tick()
    await tick()
    expect(app.exits).toBe(0)
    expect(manager.isDirty).toBe(true)
    expect(manager.toast.text).toBe('Could not save: Error: disk full')

    // Don't Save: the edits go, and so does the process - settings flushed on the way.
    native().fs.write = write
    manager.prompts.discardHandler = async () => 'discard'
    manager.settings.patch({ showSidebar: false })
    twin.click('quit')
    await tick()
    await tick()
    expect(app.exits).toBe(1)
    expect(JSON.parse(await native().fs.read(`${HOME}/.config/md-boss/settings.json`)).showSidebar).toBe(false)

    // The close button is the same road (main.ts installs it).
    await app.onCloseRequested(() => void manager.quit())
    app.closeWindow()
    await tick()
    await tick()
    expect(app.exits).toBe(2)
  })

  test('Bold / Italic / Link go to the raw pane as one-shot requests, only while it is up', async () => {
    const { manager, twin } = await setup({ [at('a.md')]: '# a' })
    await manager.open(at('a.md'))
    expect(manager.canFormat).toBe(false)
    twin.click('bold')
    expect(manager.formatRequest).toBeNull()
    manager.togglePane('raw')
    expect(manager.canFormat).toBe(true)
    twin.click('link')
    expect(manager.formatRequest).toEqual({ format: 'link', id: 1 })
    twin.click('italic')
    expect(manager.formatRequest).toEqual({ format: 'italic', id: 2 })
  })

  test('without a menu bar the page routes every shortcut; a disabled one is still taken', async () => {
    const { manager, menu } = await setup({ [at('a.md')]: '# a' })
    expect(menu.handleKey(press('Digit0', { metaKey: true }))).toBe(true)
    expect(manager.settings.data.showSidebar).toBe(false)
    // Ctrl on macOS is not the modifier.
    expect(menu.handleKey(press('Digit0', { ctrlKey: true }))).toBe(false)
    expect(menu.handleKey(press('KeyX', { metaKey: true }))).toBe(false)
    // Save is disabled with nothing dirty: the key is ours, nothing happens.
    expect(menu.handleKey(press('KeyS', { metaKey: true }))).toBe(true)
    expect(menu.handleKey(press('KeyR', { key: '®', metaKey: true, altKey: true }))).toBe(true)
    expect(manager.settings.data.visiblePanes).toEqual(['preview', 'raw'])
  })

  test('Ctrl-Backspace off macOS reaches Move to Trash through the page', async () => {
    const { manager, menu } = await setup({ [at('a.md')]: '# a' }, 'linux')
    let asked = false
    manager.prompts.confirmHandler = async () => {
      asked = true
      return false
    }
    manager.tree.moveCursor(0)
    expect(menu.handleKey(press('Backspace', { key: 'Backspace', ctrlKey: true }))).toBe(true)
    await tick()
    expect(asked).toBe(true)
  })
})
