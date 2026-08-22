// The sidebar's tree: the active root's documents loaded in one pass (the first thousand),
// the tree built from that flat list, so a folder without a document in it never appears
// and expanding a folder costs nothing. Reloaded - merged, not replaced - when a watched
// folder changes or the poll comes round, so the cursor and expanded subfolders stay put
// when a build tool touches the folder. Pure flatten and build in fileTree.ts; this holds
// the state.

import { native } from '../native/bridge'
import { DirectoryWatcher } from './directoryWatcher'
import { buildChildren, flatten, parentRow, prefixMatch, sameRows, type FileNode, type FlatRow } from './fileTree'

/** How many documents one root shows. Past it the sidebar says so rather than walking on. */
export const TREE_FILE_LIMIT = 1000

export class FileTreeModel {
  rows: FlatRow[] = []
  cursor = 0

  private root: string | null = null
  private skipFolders: string[] = []
  private children = new Map<string, FileNode[]>()
  private denied = new Set<string>()
  private missing = new Set<string>()
  private expanded = new Set<string>()
  private truncated = false
  /** Loads run one after another: a reload asked for while one is in flight waits its turn,
   *  so an older answer can never land on top of a newer one. */
  private loading: Promise<void> = Promise.resolve()
  /** What the last rebuild was showing, so switching folders can reset the cursor. */
  private lastActive: string | null = null
  private readonly listeners = new Set<() => void>()
  private readonly watcher: DirectoryWatcher

  constructor(expanded: string[] = []) {
    this.expanded = new Set(expanded)
    this.watcher = new DirectoryWatcher(() => void this.reload())
  }

  get watchersSaturated(): boolean {
    return this.watcher.isSaturated
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

  /** The root has more documents than the tree shows. */
  get isTruncated(): boolean {
    return this.truncated
  }

  get fileLimit(): number {
    return TREE_FILE_LIMIT
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

  /** Only the active root is loaded - the others cost nothing until they are picked. */
  setRoot(root: string | null, skipFolders: string[]): void {
    this.root = root
    this.skipFolders = skipFolders
    if (root !== null && !this.children.has(root)) void this.reload()
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
    if (!this.children.has(root)) await this.reload()
    const parts = path.slice(root.length + 1).split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      dir = `${dir}/${part}`
      this.expanded.add(dir)
    }
    this.rebuild()
    const index = this.rows.findIndex((r) => r.node.path === path)
    if (index >= 0) this.moveCursor(index)
  }

  // MARK: Loading

  /** The whole root again. The path argument is accepted for the callers that know which
   *  folder changed; the load is one pass either way. */
  refresh(_path?: string): Promise<void> {
    return this.reload()
  }

  refreshAll(): Promise<void> {
    return this.reload()
  }

  reload(): Promise<void> {
    const root = this.root
    if (root === null) return Promise.resolve()
    this.loading = this.loading.then(() => this.load(root)).catch((err) => console.error('tree load:', err))
    return this.loading
  }

  private async load(root: string): Promise<void> {
    const paths = await native().commands.documentsUnder(root, this.skipFolders, TREE_FILE_LIMIT)
    if (this.root !== root) return
    this.truncated = paths.length >= TREE_FILE_LIMIT
    this.denied.delete(root)
    this.missing.delete(root)
    if (paths.length === 0) {
      // An empty answer is three different things: nothing there, no such folder, or a
      // folder we may not read - and the sidebar says something different for each.
      if (!(await native().fs.exists(root))) this.missing.add(root)
      else {
        try {
          await native().fs.list(root)
        } catch {
          this.denied.add(root)
        }
      }
      if (this.root !== root) return
    }
    const built = buildChildren(root, paths)
    if (!built.has(root)) built.set(root, [])
    this.children = built
    // Drop expansion for subfolders that no longer exist.
    for (const expandedPath of [...this.expanded]) {
      if (expandedPath.startsWith(root + '/') && !built.has(expandedPath)) this.expanded.delete(expandedPath)
    }
    this.rebuild()
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

  /** The active root and every expanded folder under it - a change anywhere in those
   *  reloads the tree. */
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
