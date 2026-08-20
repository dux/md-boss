// App-wide keyboard shortcuts that have no menu yet (P9 brings native menus and wires them
// to the same manager calls). Cmd on macOS, Ctrl elsewhere.

import type { App } from '../app'

export function installShortcuts(app: App): void {
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey
    if (!mod || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'o' && event.shiftKey) {
      event.preventDefault()
      void app.manager.openFilePanel()
    } else if (key === 'o') {
      event.preventDefault()
      void app.manager.addFolders()
    }
  })
}
