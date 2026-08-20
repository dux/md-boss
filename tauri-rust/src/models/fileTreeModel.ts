// The sidebar's tree: one root listed a level at a time through the Rust walk, merged
// rather than replaced on every refresh so the cursor and expanded subfolders stay put when
// a build tool touches the folder. Pure flatten in fileTree.ts; this holds the state.

import { native } from '../native/bridge'
import { DirectoryWatcher } from './directoryWatcher'
import { flatten, parentRow, prefixMatch, sameRows, type FileNode, type FlatRow } from './fileTree'

export class FileTreeModel {
  rows: FlatRow[] = []
  cursor = 0

  private root: string | null = null
  private skipFolders: string[] = []
  private children = new Map<string, FileNode[]>()
  private denied = new Set<string>()
  private missing = new Set<string>()
  private expanded = new Set<string>()
  private listing = new Set<string>()
  /** What the last rebuild was showing, so switching folders can reset the cursor. */
  private lastActive: string | null = null
  private readonly listeners = new Set<() => void>()
  private readonly watcher: DirectoryWatcher

  constructor(expanded: string[] = []) {
    this.expanded = new Set(expanded)
    this.watcher = new DirectoryWatcher((dir) => void this.changedOnDisk(dir))
  }

  get watchersSaturated(): boolean {
    return this.watcher.isSaturated
  }

  /** Something in a watched folder changed. A new document deep in a subtree can make
   *  ancestors worth showing, so the "contains documents" answer is dropped for this path
   *  and its line before the folder is re-listed. */
  private async changedOnDisk(dir: string): Promise<void> {
    await native().commands.invalidateScan(dir)
    await this.refresh(dir)
  }

  get activeRoot(): string | null {
    return this.root
  }

  /** The active folder is unreachable - an unmounted drive, or renamed in Finder. */
  get activeIsMissing(): boolean {
    return this.root !== null && this.missing.has(this.root)
  }

  get activeIsDenied(): boolean {
    return this.root !== null && this.denied.has(this.root)
  }

  get expandedPaths(): string[] {
    return [...this.expanded].sort()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  /** Only the active root is listed - the others cost nothing until they are picked. A
   *  subfolder left expanded from last time is listed along with it, or its chevron would
   *  say open over nothing. */
  setRoot(root: string | null, skipFolders: string[]): void {
    this.root = root
    this.skipFolders = skipFolders
    if (root !== null && !this.children.has(root)) void this.refreshAll()
    this.rebuild()
  }

  // MARK: Expansion

  isExpanded(node: FileNode): boolean {
    return this.expanded.has(node.path)
  }

  toggle(node: FileNode): void {
    if (!node.isDir) return
    if (this.expanded.has(node.path)) this.collapse(node)
    else this.expand(node)
  }

  expand(node: FileNode): void {
    if (!node.isDir || this.expanded.has(node.path)) return
    this.expanded.add(node.path)
    void this.refresh(node.path)
    this.rebuild()
  }

  collapse(node: FileNode): void {
    if (!this.expanded.delete(node.path)) return
    this.rebuild()
  }

  // MARK: Cursor

  get cursorRow(): FlatRow | null {
    return this.rows[this.cursor] ?? null
  }

  /** Clamped to the rows. Returns whether there was a row to land on at all - the key
   *  handler ignores the press when there was not, so it stays available to something else. */
  moveCursor(to: number): boolean {
    if (this.rows.length === 0) return false
    const target = Math.min(this.rows.length - 1, Math.max(0, to))
    if (target !== this.cursor) {
      this.cursor = target
      this.emit()
    }
    return true
  }

  moveCursorBy(delta: number): boolean {
    return this.moveCursor(this.cursor + delta)
  }

  /** Right arrow: opens a closed folder, steps into an open one. Nothing on a file. */
  expandOrDescend(): boolean {
    const row = this.cursorRow
    if (!row || !row.node.isDir) return false
    if (this.expanded.has(row.node.path)) return this.moveCursorBy(1)
    this.expand(row.node)
    return true
  }

  /** Left arrow, NSOutlineView semantics: closes an open folder, otherwise jumps to the
   *  parent row. Nothing at the top level. */
  collapseOrAscend(): boolean {
    const row = this.cursorRow
    if (!row) return false
    if (row.node.isDir && this.expanded.has(row.node.path)) {
      this.collapse(row.node)
      return true
    }
    const parent = parentRow(this.rows, this.cursor)
    return parent >= 0 && this.moveCursor(parent)
  }

  /** Type-to-jump. A prefix with no match still counts as handled: the keystroke was
   *  meant for the tree, it just named nothing. */
  jumpTo(prefix: string): boolean {
    const match = prefixMatch(this.rows, this.cursor, prefix)
    if (match >= 0) this.moveCursor(match)
    return true
  }

  /** Opens every folder above `path` and puts the cursor on it. Only within the active
   *  root - the manager switches roots first when it has to. */
  async reveal(path: string): Promise<void> {
    const root = this.root
    if (root === null || !path.startsWith(root + '/')) return
    const parts = path.slice(root.length + 1).split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      dir = `${dir}/${part}`
      if (!this.expanded.has(dir)) this.expanded.add(dir)
      await this.refresh(dir)
    }
    if (!this.children.has(root)) await this.refresh(root)
    this.rebuild()
    const index = this.rows.findIndex((r) => r.node.path === path)
    if (index >= 0) this.moveCursor(index)
  }

  // MARK: Listing

  /** Lists a directory and merges the result in. */
  async refresh(path: string): Promise<void> {
    if (this.listing.has(path)) return
    this.listing.add(path)
    const result = await native().commands.listDir(path, this.skipFolders)
    this.listing.delete(path)

    switch (result.kind) {
      case 'entries': {
        this.denied.delete(path)
        this.missing.delete(path)
        const nodes = result.entries.map((e) => ({ path: e.path, name: e.name, isDir: e.isDir }))
        this.children.set(path, nodes)
        // Drop expansion for subfolders that no longer exist.
        const names = new Set(nodes.filter((n) => n.isDir).map((n) => n.path))
        for (const expandedPath of [...this.expanded]) {
          if (!expandedPath.startsWith(path + '/')) continue
          if (expandedPath.slice(path.length + 1).includes('/')) continue
          if (!names.has(expandedPath)) this.expanded.delete(expandedPath)
        }
        break
      }
      case 'denied':
        this.denied.add(path)
        this.missing.delete(path)
        this.children.set(path, [])
        break
      case 'missing':
        this.denied.delete(path)
        this.missing.add(path)
        this.children.set(path, [])
        break
    }
    this.rebuild()
  }

  async refreshAll(): Promise<void> {
    if (this.root === null) return
    const targets = [this.root, ...[...this.expanded].filter((p) => p.startsWith(this.root + '/'))]
    await Promise.all(targets.map((p) => this.refresh(p)))
  }

  /** Where the cursor anchors is the *file* it is on, not the index - a row appearing above
   *  it shifts every index below, and a poll makes that something that can happen while you
   *  are simply reading. When the anchored row is gone the index is held instead, which is
   *  what a list does when the thing under it disappears. */
  private rebuild(): void {
    const anchor = this.cursorRow?.node.path ?? null
    const flattened = flatten(this.root, this.children, this.expanded, this.denied)
    const changed = !sameRows(this.rows, flattened)
    if (changed) this.rows = flattened

    let target: number
    if (this.root !== this.lastActive) target = 0
    else if (anchor !== null && this.rows.some((r) => r.node.path === anchor)) target = this.rows.findIndex((r) => r.node.path === anchor)
    else target = Math.min(this.cursor, Math.max(0, this.rows.length - 1))
    this.lastActive = this.root
    const moved = target !== this.cursor
    if (moved) this.cursor = target

    if (changed || moved) this.emit()
    this.syncWatchers()
  }

  /** The active root and every expanded, listed folder under it. */
  private syncWatchers(): void {
    if (this.root === null) {
      this.watcher.sync(new Set())
      return
    }
    const targets = new Set([this.root])
    for (const path of this.expanded) {
      if (this.children.has(path) && path.startsWith(this.root + '/')) targets.add(path)
    }
    this.watcher.sync(targets)
  }
}
