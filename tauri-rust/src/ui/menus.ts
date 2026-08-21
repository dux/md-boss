// Right-click menus drawn in the window - the menu bar is native (src/ui/appMenu.ts), these
// stay in the page: the preview iframe cannot host a native menu, and one component drawing
// the list where the click was serves every pane the same way. Commands outside the
// component tree open it through this emitter, the way panels and prompts work.

export interface MenuItem {
  label: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}

export interface MenuRequest {
  x: number
  y: number
  items: MenuItem[]
}

export class ContextMenus {
  private readonly listeners = new Set<(request: MenuRequest) => void>()

  onOpen(listener: (request: MenuRequest) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open(x: number, y: number, items: MenuItem[]): void {
    for (const l of this.listeners) l({ x, y, items })
  }
}
