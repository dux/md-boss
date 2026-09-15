import { installNative, native } from './native/bridge'
import { installThemeSync } from './theme/apply'

// Inside the shell (window.__MDBOSS is its boot record) the app runs on the bun server;
// outside it (vite in a browser, for UI work) on an in-memory tree.
if ('__MDBOSS' in window) {
  const { bunNative, connectServer } = await import('./native/bun')
  await connectServer()
  installNative(bunNative)
} else {
  const { memoryNative } = await import('./native/memory')
  const { sampleFiles } = await import('./native/sample')
  installNative(memoryNative(sampleFiles))
}

const { createApp } = await import('./app')
const { installShortcuts } = await import('./ui/keys')
const { AppMenu } = await import('./ui/appMenu')
const { aboutInfo } = await import('./models/appMenu')
globalThis.MdBoss = await createApp()
// The menu bar is the shortcuts: built before the first keystroke can land.
const menu = new AppMenu(globalThis.MdBoss, native().platform, aboutInfo(await native().app.version()))
await menu.install()
installShortcuts(globalThis.MdBoss, menu)
globalThis.MdBoss.manager.startPolling()
// Packaged builds only (the Native says): a newer release is downloaded in the background
// and offered as "Restart to update"; nothing is said when there is none.
void globalThis.MdBoss.updater.checkOnLaunch()
// `md-boss <paths>` and a file opened from Finder open those instead of the last session; a
// later launch or open while this one runs arrives on onOpen, its window already brought
// forward by the Rust side. Listening first, then asking: what arrived in between the two
// would otherwise be lost.
await native().cli.onOpen((request) => void globalThis.MdBoss.manager.openFromCLI(request))
const launches = await native().cli.launch()
if (launches.some((l) => l.paths.length > 0)) {
  void (async () => {
    for (const launch of launches) await globalThis.MdBoss.manager.openFromCLI(launch)
  })()
} else {
  void globalThis.MdBoss.manager.restoreSession()
}
// The close button is a quit, through the same guard as the menu's.
await native().app.onCloseRequested(() => void globalThis.MdBoss.manager.quit())
installThemeSync(globalThis.MdBoss.settings, document.getElementById('theme')!)

// Fez after the app object: components reach MdBoss from init().
await import('@dinoreic/fez')
await import('./ui/fez/change-banner.fez')
await import('./ui/fez/back-button.fez')
await import('./ui/fez/copy-path.fez')
await import('./ui/fez/copy-doc.fez')
await import('./ui/fez/ai-start.fez')
await import('./ui/fez/measure-controls.fez')
await import('./ui/fez/preview-pane.fez')
await import('./ui/fez/csv-pane.fez')
await import('./ui/fez/editor-pane.fez')
await import('./ui/fez/root-picker.fez')
await import('./ui/fez/search-field.fez')
await import('./ui/fez/search-results.fez')
await import('./ui/fez/side-bar.fez')
await import('./ui/fez/settings-panel.fez')
await import('./ui/fez/prompt-panel.fez')
await import('./ui/fez/context-menu.fez')
await import('./ui/fez/notes-pane.fez')
await import('./ui/fez/toast-overlay.fez')
await import('./ui/fez/md-boss-app.fez')
