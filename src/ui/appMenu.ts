// The menu bar, kept in step with the app. One model (src/models/appMenu.ts) is built
// from manager state, installed once through Native.menu, and on every change the
// differences - a label, an enabled flag, the checked appearance - go out as patches. Actions
// dispatch to the same manager calls the keys used to; the native accelerators are the
// shortcuts now, and keys.ts routes only what the menu bar does not carry.

import type { App } from '../app'
import { type AboutInfo, buildAppMenu, diffMenu, flatItems, GITHUB_URL, matchesAccelerator, type MenuModel, type MenuState } from '../models/appMenu'
import { Manager } from '../models/manager'
import type { Platform } from '../models/platform'
import { visiblePanes } from '../models/settings'
import type { StyleID } from '../theme/theme'
import { native } from '../native/bridge'

export class AppMenu {
  private current: MenuModel[] = []
  private nativeAccelerators = false

  constructor(
    private readonly app: Pick<App, 'manager' | 'panels' | 'updater'>,
    private readonly platform: Platform,
    private readonly about: AboutInfo,
  ) {}

  /** Draws the menu, then follows every source the model reads from. Subscribed after the
   *  install so no patch is sent at a menu that is not there yet; the sync right after
   *  catches what changed while the menu was being built. */
  async install(): Promise<void> {
    this.current = this.build()
    this.nativeAccelerators = await native().menu.install(this.current, (id) => this.run(id))
    const sync = () => this.sync()
    const manager = this.app.manager
    manager.onChange(sync)
    manager.settings.onChange(sync)
    manager.notes.onChange(sync)
    manager.tree.onChange(sync)
    manager.onCursorChange(sync)
    this.app.updater.onChange(sync)
    this.sync()
  }

  /** The model as it is drawn right now. */
  get menus(): MenuModel[] {
    return this.current
  }

  build(): MenuModel[] {
    return buildAppMenu(this.state())
  }

  private state(): MenuState {
    const manager = this.app.manager
    const data = manager.settings.data
    return {
      platform: this.platform,
      about: this.about,
      hasRoot: manager.activeRoot !== null,
      hasTarget: manager.actionTarget !== null,
      hasDocument: manager.document !== null,
      isDirty: manager.canSave,
      canFormat: manager.canFormat,
      canSearch: manager.canSearch,
      canGoBack: manager.canGoBack,
      hasNoteAtCursor: manager.hasNoteAtCursor,
      visiblePanes: visiblePanes(data),
      showSidebar: data.showSidebar,
      themeID: manager.theme.id,
      canCheckUpdates: this.app.updater.enabled,
      updateReady: this.app.updater.ready,
    }
  }

  sync(): void {
    const next = this.build()
    for (const patch of diffMenu(this.current, next)) {
      void native().menu.update(patch).catch((err) => console.error('menu not updated:', err))
    }
    this.current = next
  }

  /** A keydown the page answers: every shortcut in the browser build, and under a menu bar
   *  only the items it does not carry (`native: false`). True when the key was one of
   *  ours, whether or not the item was enabled - a disabled accelerator is still taken. */
  handleKey(press: KeyboardEvent): boolean {
    for (const item of flatItems(this.current)) {
      if (!item.accelerator || (this.nativeAccelerators && item.native)) continue
      if (!matchesAccelerator(item.accelerator, press, this.platform)) continue
      if (item.enabled) this.run(item.id)
      return true
    }
    return false
  }

  /** What each item does. Ids are the model's; an unknown one is a programming error. */
  run(id: string): void {
    const { manager, panels } = this.app
    if (id.startsWith('style:')) {
      manager.setStyle(id.slice('style:'.length) as StyleID)
      // A native check item toggles itself on click; picking the style that is already
      // checked would uncheck it while the model still says checked, so it is re-asserted.
      void native().menu.update({ id, checked: true })
      return
    }
    if (id === 'mode:light' || id === 'mode:dark') {
      manager.setThemeMode(id === 'mode:dark')
      void native().menu.update({ id, checked: true })
      return
    }
    switch (id) {
      case 'new-file': return void manager.newFile()
      case 'open-folder': return void manager.addFolders()
      case 'open-file': return void manager.openFilePanel()
      case 'save': return void manager.saveDocument()
      case 'revert': return void manager.revertDocument()
      case 'rename': return manager.renameSelection()
      case 'trash': return manager.trashSelection()
      case 'reveal': return manager.revealSelection()
      case 'settings': return panels.toggle('settings')
      case 'find': return manager.findInDocument()
      case 'find-in-project': return manager.findInProject()
      case 'go-to-file': return manager.goToFile()
      case 'bold': return manager.format('bold')
      case 'italic': return manager.format('italic')
      case 'link': return manager.format('link')
      case 'add-note': return void manager.addNoteAtCursor()
      case 'delete-note': return void manager.deleteNoteAtCursor()
      case 'back': return void manager.goBack()
      case 'toggle-preview': return manager.togglePane('preview')
      case 'toggle-raw': return manager.togglePane('raw')
      case 'toggle-notes': return manager.togglePane('notes')
      case 'side-by-side': return manager.toggleSideBySide()
      case 'narrower': return manager.changeMeasure(-Manager.measureStep)
      case 'wider': return manager.changeMeasure(Manager.measureStep)
      case 'toggle-sidebar': return manager.toggleSidebar()
      case 'bigger': return manager.zoom(1)
      case 'smaller': return manager.zoom(-1)
      case 'actual-size': return manager.resetZoom()
      case 'toggle-light-dark': return manager.toggleLightDark()
      case 'check-updates': return void this.app.updater.fromMenu()
      case 'github': return void native().shell.openURL(GITHUB_URL)
      case 'quit': return void manager.quit()
      default: console.error(`menu action without a handler: ${id}`)
    }
  }
}
