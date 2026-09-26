// One connected page: where its pushes go, what it is watching, which AI turns it runs.

import type { ServerWebSocket } from 'bun'
import type { FSWatcher } from 'node:fs'

export class Session {
  private ws: ServerWebSocket<unknown> | null = null
  readonly watchers = new Map<number, FSWatcher>()
  /** Running AI turns by the page's turn id; aborting one stops its `claude`. */
  readonly turns = new Map<string, AbortController>()
  private nextWatch = 1

  attach(ws: ServerWebSocket<unknown>): void {
    this.ws = ws
  }

  push(event: string, data: unknown): void {
    this.ws?.send(JSON.stringify({ event, data }))
  }

  nextWatchId(): number {
    return this.nextWatch++
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    for (const turn of this.turns.values()) turn.abort()
    this.turns.clear()
    this.ws = null
  }
}
