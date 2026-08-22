// One connected page: where its pushes go, and what it is watching.

import type { ServerWebSocket } from 'bun'
import type { FSWatcher } from 'node:fs'

export class Session {
  private ws: ServerWebSocket<unknown> | null = null
  readonly watchers = new Map<number, FSWatcher>()
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
    this.ws = null
  }
}
