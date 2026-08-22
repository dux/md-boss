// App-wide keys the page answers itself. The menu bar (src/ui/appMenu.ts) carries every
// shortcut in the README table as a native accelerator; what is left to the page is Escape,
// which is no menu item, and the same table routed from keydown where there is no menu bar
// (the browser build) or the bar must not take the key (Move to Trash off macOS).

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
    if (!mod) return
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
