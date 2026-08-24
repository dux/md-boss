import { createEditor } from './editor/editor'
import { Manager } from './models/manager'
import { RootFolders } from './models/rootFolders'
import { SettingsStore } from './models/settingsStore'
import { TypeAhead } from './models/typeAhead'
import { Updater } from './models/updater'
import { documentKind } from './models/fileKinds'
import { insertRows } from './models/markdownInsert'
import { FONT_SETTINGS, PANE_TITLE, PANES, visiblePanes } from './models/settings'
import { panelShortcut } from './models/appMenu'
import { Panels } from './ui/panels'
import { ContextMenus } from './ui/menus'
import { isInside } from './ui/dragPoint'
import { refreshIcon, rowIcon } from './ui/icons'
import { NOTE_SCOPES, SCOPE_TITLE, noteLabel, partitionNotes, scopeIsCollapsible } from './models/notes'
import { SEARCH_PLACEHOLDER } from './models/sidebarSearch'
import { documentBaseURL } from './models/linkTarget'
import { revealLabel } from './models/platform'
import { native } from './native/bridge'
import { buildPreviewPage } from './preview/page'
import { buildCSVPage } from './preview/csvPage'
import { parseCSV } from './models/csvTable'
import { MarkdownComponents } from './models/markdownComponents'
import { typedBlocks } from './models/typedBlocks'
import { isDark, rootCSS, STYLES, themeForStyle, themeNamed } from './theme/theme'

// What .fez components may reach. Fez compiles them at runtime, so they cannot import
// modules; this object is their one import and the explicit list of the app surface.
export async function createApp() {
  const settings = await SettingsStore.load()
  const folders = await RootFolders.load()
  const home = await native().paths.home()
  const configDir = await native().paths.config()
  const components = await MarkdownComponents.load(configDir)
  await components.start()
  const manager = new Manager(settings, folders, home, configDir, () => components.items)
  components.onChange(() => {
    if (manager.document?.path === manager.examplePath && !manager.isDirty) void manager.openExample()
  })
  return {
    native,
    TypeAhead,
    createEditor,
    documentKind,
    /** The Insert menu's rows, filtered by what has been typed after a `/`. */
    insertRows,
    visiblePanes,
    PANES,
    PANE_TITLE,
    /** "⌘2" - what a panel label's tooltip says the key is. */
    panelShortcut,
    FONT_SETTINGS,
    NOTE_SCOPES,
    SCOPE_TITLE,
    noteLabel,
    partitionNotes,
    scopeIsCollapsible,
    SEARCH_PLACEHOLDER,
    panels: new Panels(),
    menus: new ContextMenus(),
    buildPreviewPage,
    buildCSVPage,
    parseCSV,
    typedBlocks,
    documentBaseURL,
    isInside,
    /** The sidebar row's glyph - folder, page, table, image - as an inline SVG string. */
    rowIcon,
    /** The root row's re-read button glyph, same inline-SVG shape as the row icons. */
    refreshIcon,
    /** "Reveal in Finder" / "Show in Explorer" / "Show in File Manager" - the menus' item. */
    revealLabel: revealLabel(native().platform),
    isDark,
    rootCSS,
    STYLES,
    themeForStyle,
    themeNamed,
    settings,
    components,
    manager,
    /** Self-update: the launch check and the Help item. Restart runs quit's guard first. */
    updater: new Updater(native().updater, manager.toast, () => manager.prepareToExit()),
  }
}

export type App = Awaited<ReturnType<typeof createApp>>

declare global {
  // eslint-disable-next-line no-var
  var MdBoss: App
}
