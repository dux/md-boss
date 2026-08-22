// In-window panels (settings, later the prompt dialog) are opened by commands that live
// outside the component tree - a shortcut, a menu item. One tiny emitter carries the
// request to whichever component draws the panel.

export type PanelName = 'settings'

export class Panels {
  private readonly listeners = new Set<(panel: PanelName) => void>()

  onToggle(listener: (panel: PanelName) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toggle(panel: PanelName): void {
    for (const l of this.listeners) l(panel)
  }
}
