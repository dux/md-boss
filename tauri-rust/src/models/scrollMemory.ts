// Where each document was left, so coming back to one lands where you stopped reading
// rather than at the top of it. A *line* for text - the raw pane and the preview both speak
// in source lines, so one recorded number serves both, and a line survives a font or
// measure change that a pixel offset would not. *Pixels* for a table (P8): a CSV has no
// anchors and scrolls sideways as well as down. Session only, and deliberately outside
// SettingsData: a position per file would grow that file without bound and rewrite it
// while you scroll.

export interface Place {
  line?: number
  table?: { x: number; y: number }
}

export class ScrollMemory {
  private readonly places = new Map<string, Place>()

  place(path: string | null): Place {
    return (path && this.places.get(path)) || {}
  }

  recordLine(path: string, line: number): void {
    this.places.set(path, { ...this.place(path), line })
  }

  recordTable(path: string, offset: { x: number; y: number }): void {
    this.places.set(path, { ...this.place(path), table: offset })
  }

  /** A file that moved keeps its place - it is the same document one path later. */
  relocate(from: string, to: string): void {
    const place = this.places.get(from)
    if (!place) return
    this.places.delete(from)
    this.places.set(to, place)
  }

  forget(path: string): void {
    this.places.delete(path)
  }
}
