import { Manager } from './models/manager'
import { RootFolders } from './models/rootFolders'
import { SettingsStore } from './models/settingsStore'
import { native } from './native/bridge'
import { buildPreviewPage } from './preview/page'
import { DEFAULT_THEME, rootCSS } from './theme/theme'

// What .fez components may reach. Fez compiles them at runtime, so they cannot import
// modules; this object is their one import and the explicit list of the app surface.
export async function createApp() {
  const settings = await SettingsStore.load()
  const folders = await RootFolders.load()
  const home = await native().paths.home()
  return {
    native,
    buildPreviewPage,
    rootCSS,
    theme: DEFAULT_THEME,
    settings,
    manager: new Manager(settings, folders, home),
  }
}

export type App = Awaited<ReturnType<typeof createApp>>

declare global {
  // eslint-disable-next-line no-var
  var MdBoss: App
}
