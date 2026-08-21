import { installNative, native } from './native/bridge'
import { installThemeSync } from './theme/apply'

// Outside Tauri (vite in a browser, for UI work) the app runs on an in-memory tree.
if ('__TAURI_INTERNALS__' in window) {
  const { tauriNative, forwardConsoleToLog } = await import('./native/tauri')
  installNative(tauriNative)
  if (import.meta.env.DEV) forwardConsoleToLog()
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
void globalThis.MdBoss.manager.restoreSession()
installThemeSync(globalThis.MdBoss.settings, document.getElementById('theme')!)

// Fez after the app object: components reach MdBoss from init().
await import('@dinoreic/fez')
await import('./ui/change-banner.fez')
await import('./ui/back-button.fez')
await import('./ui/measure-controls.fez')
await import('./ui/preview-pane.fez')
await import('./ui/csv-pane.fez')
await import('./ui/editor-pane.fez')
await import('./ui/pane-toggle-bar.fez')
await import('./ui/root-picker.fez')
await import('./ui/search-field.fez')
await import('./ui/search-results.fez')
await import('./ui/side-bar.fez')
await import('./ui/settings-panel.fez')
await import('./ui/prompt-panel.fez')
await import('./ui/context-menu.fez')
await import('./ui/notes-pane.fez')
await import('./ui/md-boss-app.fez')
