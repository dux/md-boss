// Right-click menus drawn in the window - the menu bar is native (src/ui/appMenu.ts), these
// stay in the page: the preview iframe cannot host a native menu, and one component drawing
// the list where the click was serves every pane the same way. Commands outside the
// component tree open it through this emitter, the way panels and prompts work.

export interface MenuItem {
  label: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
  /** A submenu, drawn beside its row. An item carrying one has no action of its own. */
  items?: MenuItem[]
}

export interface MenuRequest {
  x: number
  y: number
  items: MenuItem[]
  /** Whether the first row starts picked - the raw pane's `/` menu, which is driven from
   *  the keyboard with the caret still in the text. */
  preselect: boolean
}

export class ContextMenus {
  private readonly listeners = new Set<(request: MenuRequest | null) => void>()

  onOpen(listener: (request: MenuRequest | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open(x: number, y: number, items: MenuItem[], preselect = false): void {
    for (const l of this.listeners) l({ x, y, items, preselect })
  }

  /** Down without a pick - the `/` menu, when what was typed stops naming anything. */
  close(): void {
    for (const l of this.listeners) l(null)
  }
}
