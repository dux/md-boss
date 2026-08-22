// Keeps the raw pane and the preview looking at the same part of the document. Port of
// ScrollSync.swift: last-driver-wins with a quiet window, so the two panes cannot push each
// other down the file. Listeners rather than the manager's change event: this fires on
// every scroll frame and nothing but the two panes should hear it. Time is passed in so
// the rule is testable.

import type { Pane } from './settings'

export interface Move {
  /** 1-based source line at the top of the driving pane, with the fractional part saying
   *  how far into that line it sits - so a slow drag moves the other pane smoothly rather
   *  than in line-sized steps. Past the last line means "at the end". */
  line: number
  source: Pane
}

/** How long a pane stays quiet after being moved by the other one. A programmatic scroll
 *  settles over several frames, and a trackpad fling keeps reporting well after the finger
 *  is gone; both would otherwise read as the follower taking over. */
export const QUIET_MS = 150

export class ScrollSync {
  private driver: Pane | null = null
  private appliedAt = -Infinity
  private readonly listeners = new Set<(move: Move) => void>()
  private readonly bothUp: () => boolean

  /** `bothUp` answers whether raw and preview are both on screen - a move with only one of
   *  them up has nobody to follow it. */
  constructor(bothUp: () => boolean) {
    this.bothUp = bothUp
  }

  onMove(listener: (move: Move) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Reported by a pane when the user scrolls it. Returns whether the move was sent. */
  report(line: number, from: Pane, now: number): boolean {
    if (!this.bothUp()) return false
    // The pane already driving keeps driving; any other one has to wait for it to go
    // quiet. That is the whole of last-driver-wins.
    if (this.driver !== from && now - this.appliedAt <= QUIET_MS) return false
    this.driver = from
    const move = { line, source: from }
    for (const l of this.listeners) l(move)
    return true
  }

  /** Called by the pane that just followed a move, to restart the quiet window. */
  applied(now: number): void {
    this.appliedAt = now
  }

  /** Opening a different file invalidates whoever was driving. */
  reset(): void {
    this.driver = null
    this.appliedAt = -Infinity
  }
}
