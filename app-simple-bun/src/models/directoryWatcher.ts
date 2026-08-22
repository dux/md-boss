// Per-directory watching of a small bounded set - the active root and the expanded folders,
// which is exactly the granularity a non-recursive watch is good at on every platform. A
// runaway expansion would exhaust inotify or descriptor limits, so watching stops at a cap
// and the UI can say so.

import { native, type Unwatch } from '../native/bridge'

export class DirectoryWatcher {
  static readonly maxWatchers = 128

  private readonly entries = new Map<string, Promise<Unwatch>>()
  private readonly onChange: (dir: string, changed: string[]) => void
  isSaturated = false

  constructor(onChange: (dir: string, changed: string[]) => void) {
    this.onChange = onChange
  }

  get count(): number {
    return this.entries.size
  }

  /** Watches exactly `dirs` - adds what is new, drops what is gone. */
  sync(dirs: ReadonlySet<string>): void {
    for (const [dir, pending] of this.entries) {
      if (dirs.has(dir)) continue
      this.entries.delete(dir)
      void pending.then((unwatch) => unwatch()).catch(() => {})
    }
    for (const dir of dirs) {
      if (this.entries.has(dir)) continue
      if (this.entries.size >= DirectoryWatcher.maxWatchers) {
        this.isSaturated = true
        return
      }
      const pending = native().watch(dir, (changed) => {
        // A late event from a watch that was dropped meanwhile is noise.
        if (this.entries.has(dir)) this.onChange(dir, changed)
      })
      // A folder that cannot be watched - gone, denied - is simply not watched; the poll
      // still covers it. Said out loud, because a silent watcher is indistinguishable from
      // a working one until a file fails to appear.
      this.entries.set(dir, pending.catch((err: unknown) => {
        console.warn(`watch failed for ${dir}:`, err)
        return () => {}
      }))
    }
    this.isSaturated = false
  }

  unwatchAll(): void {
    this.sync(new Set())
  }
}
