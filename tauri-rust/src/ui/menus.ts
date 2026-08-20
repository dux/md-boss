// Right-click menus drawn in the window. Native context menus arrive with P9's menu work;
// until then - and for the preview iframe, which cannot host a native menu anyway - one
// component draws the list where the click was. Commands outside the component tree open
// it through this emitter, the way panels and prompts work.

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
