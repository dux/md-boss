// One directory, its direct entries, debounced: a git checkout fires dozens of events in a
// burst and re-listing on each would make the tree flicker. The page gets a `watch` event
// with the paths the platform reported - the directory itself when it went away.

import { watch as fsWatch } from 'node:fs'
import { join } from 'node:path'
import type { Session } from './session'

const DEBOUNCE_MS = 200

export function start(session: Session, dir: string): number {
  const id = session.nextWatchId()
  const changed = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    const paths = [...changed]
    changed.clear()
    session.push('watch', { id, changed: paths })
  }
  const note = (path: string) => {
    changed.add(path)
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS)
  }
  const watcher = fsWatch(dir, (_event, filename) => note(filename ? join(dir, String(filename)) : dir))
  watcher.on('error', () => {
    note(dir)
    stop(session, id)
  })
  session.watchers.set(id, watcher)
  return id
}

export function stop(session: Session, id: number): void {
  session.watchers.get(id)?.close()
  session.watchers.delete(id)
}
