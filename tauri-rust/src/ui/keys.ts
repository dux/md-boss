// App-wide keyboard shortcuts that have no menu yet (P9 brings native menus and wires them
// to the same manager calls). Cmd on macOS, Ctrl elsewhere.

import type { App } from '../app'

export function installShortcuts(app: App): void {
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey
    if (!mod) return
    // event.code rather than event.key: with Alt held, macOS turns the key into a symbol
    // (Alt-R is "®"), and the pane toggles are Alt-Cmd-R / V / N.
    if (event.altKey) {
      const pane = { KeyR: 'raw', KeyV: 'preview', KeyN: 'notes' }[event.code]
      if (pane && !event.shiftKey) {
        event.preventDefault()
        app.manager.togglePane(pane as 'raw' | 'preview' | 'notes')
      } else if (event.code === 'Digit0' && !event.shiftKey) {
        event.preventDefault()
        app.manager.resetZoom()
      }
      return
    }
    const key = event.key.toLowerCase()
    // Cmd-+ arrives as "=" on most layouts without Shift, and as "+" with it.
    if (key === '=' || key === '+') {
      event.preventDefault()
      app.manager.zoom(1)
    } else if (key === '-' || key === '_') {
      event.preventDefault()
      app.manager.zoom(-1)
    } else if (key === ',' && !event.shiftKey) {
      event.preventDefault()
      app.panels.toggle('settings')
    } else if (key === 's' && !event.shiftKey) {
      event.preventDefault()
      void app.manager.saveDocument()
    } else if (key === 'k' && event.shiftKey) {
      event.preventDefault()
      void app.manager.addNoteAtCursor()
    } else if (key === 'backspace' && event.shiftKey) {
      event.preventDefault()
      void app.manager.deleteNoteAtCursor()
    } else if (key === 'd' && event.shiftKey) {
      event.preventDefault()
      app.manager.toggleLightDark()
    } else if (key === '[' && !event.shiftKey) {
      event.preventDefault()
      void app.manager.goBack()
    } else if (key === '\\' && !event.shiftKey) {
      event.preventDefault()
      app.manager.toggleSideBySide()
    } else if (key === 'o' && event.shiftKey) {
      event.preventDefault()
      void app.manager.openFilePanel()
    } else if (key === 'o') {
      event.preventDefault()
      void app.manager.addFolders()
    } else if (key === '0' && !event.shiftKey) {
      event.preventDefault()
      app.manager.toggleSidebar()
    }
  })
}
