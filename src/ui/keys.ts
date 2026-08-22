// App-wide keys the page answers itself. The menu bar (src/ui/appMenu.ts) carries every
// shortcut in the README table as a native accelerator; what is left to the page is Escape
// and Backspace, which the bar must not register, and the same table routed from keydown
// where there is no menu bar (the browser build) or the bar must not take the key (Move to
// Trash off macOS, the column arrows anywhere).

import type { App } from '../app'
import type { AppMenu } from './appMenu'

export function installShortcuts(app: App, menu: AppMenu): void {
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey
    // Escape with nothing else claiming it forgets a pending Cut, wherever the focus went
    // after the menu that set it. Menus, prompts and the root list take theirs in the
    // capture phase and stop it, so one that gets this far is free. Not from a text field:
    // the name field's Escape is its own cancel.
    if (event.key === 'Escape' && !mod && !event.altKey && !event.shiftKey) {
      if (!isTextField(document.activeElement)) app.manager.cancelCut()
      return
    }
    // Backspace on its own is Back, the way a browser reads it - the other half of Cmd-[,
    // and what the Back button in the preview's label strip says it is. Never from a text
    // field or the editor: there the key is delete, and a menu accelerator could not tell
    // the difference, which is why this one is the page's and not the bar's.
    if (event.key === 'Backspace' && !mod && !event.altKey && !event.shiftKey) {
      if (isTextField(document.activeElement)) return
      void app.manager.goBack()
      event.preventDefault()
      return
    }
    if (!mod) return
    // Cmd-Left/Right narrows and widens the reading column, but in a text field it is
    // move-to-line-end and stays there. The menu bar never registers it (native: false),
    // so this is the only thing standing between the two readings.
    if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && isTextField(document.activeElement)) return
    // Cmd-Backspace is every text field's delete-to-line-start, and the editor's: while
    // the caret is in one the key stays with the field. Shift-Cmd-Backspace (Delete Note)
    // has no editing meaning and goes through.
    if (event.key === 'Backspace' && !event.shiftKey && isTextField(document.activeElement)) return
    // The editor's own keymap answers first while it has the focus (Cmd-B, Cmd-F, Cmd-[);
    // an event that arrives prevented is its and is left alone.
    if (event.defaultPrevented) return
    if (menu.handleKey(event)) event.preventDefault()
  })
}

function isTextField(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLElement && element.isContentEditable
}
