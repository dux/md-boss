import { createEditor } from './editor/editor'
import { Manager } from './models/manager'
import { RootFolders } from './models/rootFolders'
import { SettingsStore } from './models/settingsStore'
import { TypeAhead } from './models/typeAhead'
import { documentKind } from './models/fileKinds'
import { FONT_SETTINGS, PANE_TITLE, PANES, paneShortTitle, visiblePanes } from './models/settings'
import { Panels } from './ui/panels'
import { ContextMenus } from './ui/menus'
import { NOTE_SCOPES, SCOPE_TITLE, noteLabel, partitionNotes, scopeIsCollapsible } from './models/notes'
import { native } from './native/bridge'
import { buildPreviewPage } from './preview/page'
import { rootCSS, THEMES, themeNamed } from './theme/theme'

// What .fez components may reach. Fez compiles them at runtime, so they cannot import
// modules; this object is their one import and the explicit list of the app surface.
export async function createApp() {
  const settings = await SettingsStore.load()
  const folders = await RootFolders.load()
  const home = await native().paths.home()
  const configDir = await native().paths.config()
  return {
    native,
    TypeAhead,
    createEditor,
    documentKind,
    visiblePanes,
    PANES,
    PANE_TITLE,
    paneShortTitle,
    FONT_SETTINGS,
    NOTE_SCOPES,
    SCOPE_TITLE,
    noteLabel,
    partitionNotes,
    scopeIsCollapsible,
    panels: new Panels(),
    menus: new ContextMenus(),
    buildPreviewPage,
    rootCSS,
    THEMES,
    themeNamed,
    settings,
    manager: new Manager(settings, folders, home, configDir),
  }
}

export type App = Awaited<ReturnType<typeof createApp>>

declare global {
  // eslint-disable-next-line no-var
  var MdBoss: App
}
