// The sidebar's root folders, persisted as roots.txt in the config dir. File order is the
// most-recently-used order, so the head of the list is the active one - there is no second
// place to keep it. Adding a folder that is already listed moves it rather than duplicating
// it, so opening md-boss with a folder argument reliably surfaces that folder at the top.

import { native } from '../native/bridge'
import { isUnder, normalizePath } from './paths'
import { ROOTS_FILE, addRootAtTop, parseRoots, serializeRoots, shownRoots } from './roots'

export class RootFolders {
  roots: string[] = []
  private readonly dir: string
  private readonly path: string
  private readonly listeners = new Set<() => void>()

  private constructor(dir: string, path: string, roots: string[]) {
    this.dir = dir
    this.path = path
    this.roots = roots
  }

  static async load(): Promise<RootFolders> {
    const { fs, paths } = native()
    const dir = await paths.config()
    const path = await paths.join(dir, ROOTS_FILE)
    let roots: string[] = []
    try {
      if (await fs.exists(path)) roots = parseRoots(await fs.read(path)).filter((r) => !r.startsWith('#')).map(normalizePath)
    } catch {
      // unreadable is the same as none
    }
    return new RootFolders(dir, path, roots)
  }

  /** The folder the sidebar is showing. */
  get active(): string | null {
    return this.roots[0] ?? null
  }

  /** What the select box lists. Older roots stay in the file, they just fall off the end
   *  of the box until they are used again. */
  get recent(): string[] {
    return shownRoots(this.roots)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  select(root: string): void {
    if (this.active === normalizePath(root)) return
    this.add(root, true)
  }

  add(root: string, atTop = false): void {
    const folder = normalizePath(root)
    const rest = this.roots.filter((r) => r !== folder)
    this.roots = atTop ? addRootAtTop(rest, folder) : [...rest, folder]
    this.changed()
  }

  remove(root: string): void {
    const folder = normalizePath(root)
    if (!this.roots.includes(folder)) return
    this.roots = this.roots.filter((r) => r !== folder)
    this.changed()
  }

  contains(root: string): boolean {
    return this.roots.includes(normalizePath(root))
  }

  /** The root `path` sits under, if any. */
  rootContaining(path: string): string | null {
    return this.roots.find((r) => isUnder(path, r)) ?? null
  }

  private changed(): void {
    for (const l of this.listeners) l()
    void this.save()
  }

  private async save(): Promise<void> {
    const { fs } = native()
    try {
      await fs.mkdir(this.dir)
      await fs.write(this.path, serializeRoots(this.roots))
    } catch (err) {
      console.error('roots.txt not written:', err)
    }
  }
}
