// The central state the menu bar, the sidebar and the panes all reach: which folders are
// listed, which file is open, what it says. A singleton on purpose - menu commands live
// outside the component tree and cannot read view state.

import { native } from '../native/bridge'
import { DirectoryWatcher } from './directoryWatcher'
import { FileTreeModel } from './fileTreeModel'
import { dirname } from './paths'
import { RootFolders } from './rootFolders'
import { SettingsStore } from './settingsStore'

export interface OpenDocument {
  path: string
  text: string
}

export class Manager {
  readonly tree: FileTreeModel
  readonly settings: SettingsStore
  readonly folders: RootFolders
  readonly home: string
  document: OpenDocument | null = null
  error: string | null = null
  private readonly listeners = new Set<() => void>()
  /** The open file's folder, so a save from another editor shows up on tab-back. */
  private readonly documentWatcher = new DirectoryWatcher((_, changed) => void this.documentChangedOnDisk(changed))
  private poll: ReturnType<typeof setInterval> | null = null

  /** Long, because this is a backstop and not the mechanism: the watcher answers a local
   *  change in milliseconds, and anything this catches has been wrong for a while already.
   *  It covers what a watcher cannot see - a network volume, a file synced in by Dropbox. */
  static readonly pollIntervalMs = 30_000

  constructor(settings: SettingsStore, folders: RootFolders, home: string) {
    this.settings = settings
    this.folders = folders
    this.home = home
    this.tree = new FileTreeModel(settings.data.expandedPaths)
    this.folders.onChange(() => this.rootsChanged())
    this.rootsChanged()
  }

  /** Re-lists what is on screen every 30 seconds, whether or not anything said to. Silent
   *  when nothing changed: refresh merges and rows are only published when they differ. */
  startPolling(): void {
    if (this.poll) return
    this.poll = setInterval(() => void this.tree.refreshAll(), Manager.pollIntervalMs)
  }

  stopPolling(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  private async documentChangedOnDisk(changed: string[]): Promise<void> {
    const doc = this.document
    if (!doc || !changed.includes(doc.path)) return
    try {
      const text = await native().fs.read(doc.path)
      if (text === doc.text) return
      this.document = { path: doc.path, text }
      this.emit()
    } catch {
      // gone or unreadable - the P4 external-change banner says so; until then the buffer stays
    }
  }

  get activeRoot(): string | null {
    return this.folders.active
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private rootsChanged(): void {
    this.tree.setRoot(this.folders.active, this.settings.data.skipFolders)
    this.emit()
  }

  /** `/Users/me/dev` reads as `~/dev` - the home prefix is noise in a sidebar this narrow. */
  abbreviateHome(path: string): string {
    if (path === this.home || path.startsWith(this.home + '/')) return '~' + path.slice(this.home.length)
    return path
  }

  /** Cmd-O. Several at once; each lands at the top, so the last one picked is active. */
  async addFolders(): Promise<void> {
    const picked = await native().dialog.openFolders(this.settings.data.lastOpenedFolder)
    for (const folder of picked) this.addRoot(folder)
  }

  addRoot(root: string): void {
    this.settings.patch({ lastOpenedFolder: root })
    this.folders.add(root, true)
  }

  selectRoot(root: string): void {
    this.folders.select(root)
  }

  removeRoot(root: string): void {
    this.folders.remove(root)
  }

  /** Cmd-Shift-O. One file; its folder is added to the sidebar when no listed root holds it. */
  async openFilePanel(): Promise<void> {
    const picked = await native().dialog.openFile(this.settings.data.lastOpenedFolder)
    if (picked === null) return
    this.settings.patch({ lastOpenedFolder: dirname(picked) })
    await this.open(picked)
  }

  async open(path: string): Promise<void> {
    try {
      const text = await native().fs.read(path)
      this.document = { path, text }
      this.error = null
      this.documentWatcher.sync(new Set([dirname(path)]))
      if (this.folders.rootContaining(path) === null) this.addRoot(dirname(path))
    } catch (err) {
      this.error = String(err)
    }
    this.emit()
  }
}
