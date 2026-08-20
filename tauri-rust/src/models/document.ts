// One open file: its text, whether it differs from disk, and what a save writes back.
// The port of MarkdownDocument.swift minus the disk watching, which the Manager does.

import { native } from '../native/bridge'

/** Identifies a version of the file on disk. Size as well as mtime because volumes with
 *  one-second timestamp resolution - SMB, some FUSE mounts - hide a rewrite that lands
 *  inside the same second we recorded. */
export interface Stamp {
  mtime: number | null
  size: number | null
}

export type ExternalChange =
  /** Changed on disk while we hold unsaved edits. */
  | 'conflict'
  /** Deleted or renamed out from under us. */
  | 'detached'

export type SyncOutcome = 'unchanged' | 'reloaded' | 'conflict' | 'detached'

const sameStamp = (a: Stamp, b: Stamp) => a.mtime === b.mtime && a.size === b.size

export class OpenDocument {
  readonly path: string
  text: string
  savedText: string
  /** Windows line endings are normalised in the buffer and restored on save. Otherwise
   *  every save of a CRLF file is a whole-file diff. */
  readonly usesCRLF: boolean
  /** Bumped only on open and on an external reload. The editor pushes the string into
   *  CodeMirror only when this changes, so typing never resets the selection. */
  reloadToken = 0
  externalChange: ExternalChange | null = null
  /** The version we are holding, used to tell our own writes from someone else's. */
  private lastKnownStamp: Stamp

  constructor(path: string, raw: string, stamp: Stamp = { mtime: null, size: null }) {
    this.path = path
    this.usesCRLF = raw.includes('\r\n')
    this.text = normalizeLineEndings(raw)
    this.savedText = this.text
    this.lastKnownStamp = stamp
  }

  static async load(path: string): Promise<OpenDocument> {
    const raw = await native().fs.read(path)
    return new OpenDocument(path, raw, await stampOf(path))
  }

  get isDirty(): boolean {
    return this.text !== this.savedText
  }

  get name(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }

  /** What lands on disk: the buffer with the file's own line endings put back. */
  get payload(): string {
    return this.usesCRLF ? this.text.replace(/\n/g, '\r\n') : this.text
  }

  /** Writes the buffer when it differs from disk. Returns whether a write happened. */
  async save(): Promise<boolean> {
    if (!this.isDirty) return false
    await native().fs.write(this.path, this.payload)
    this.savedText = this.text
    this.externalChange = null
    this.lastKnownStamp = await stampOf(this.path)
    return true
  }

  /** Takes the version on disk, discarding the buffer. */
  replaceFromDisk(raw: string, stamp: Stamp): void {
    this.text = normalizeLineEndings(raw)
    this.savedText = this.text
    this.externalChange = null
    this.lastKnownStamp = stamp
    this.reloadToken++
  }

  async reloadFromDisk(): Promise<void> {
    this.replaceFromDisk(await native().fs.read(this.path), await stampOf(this.path))
  }

  /** Keeps the buffer and dismisses the banner; the next save overwrites what is on disk.
   *  The recorded version moves forward so the same change is not reported twice. */
  async keepMine(): Promise<void> {
    this.externalChange = null
    this.lastKnownStamp = await stampOf(this.path)
  }

  /** The one place that decides whether the file changed under us and what to do about it.
   *  The watcher calls it the moment it can; the poll calls it every two seconds because a
   *  watcher cannot see everything - an atomic rewrite renames a new inode over the path,
   *  and network volumes deliver nothing at all. */
  async syncWithDisk(): Promise<SyncOutcome> {
    if (!(await native().fs.exists(this.path))) {
      this.externalChange = 'detached'
      return 'detached'
    }
    const current = await stampOf(this.path)
    if (sameStamp(current, this.lastKnownStamp)) {
      // Something is there with our version on it: a detach was a rename on the way to
      // an atomic rewrite that has since landed, or the file came back.
      if (this.externalChange === 'detached') this.externalChange = null
      return 'unchanged'
    }
    // Nothing to lose - take the new version. This is the common case: you edited the
    // file in another editor and came back. A rewrite with the same bytes (a formatter
    // that changed nothing, a touch) only moves the stamp: reloading would reset the
    // editor's selection for no visible reason.
    if (!this.isDirty) {
      const raw = await native().fs.read(this.path)
      if (raw === this.payload) {
        this.lastKnownStamp = current
        this.externalChange = null
        return 'unchanged'
      }
      this.replaceFromDisk(raw, current)
      return 'reloaded'
    }
    this.externalChange = 'conflict'
    return 'conflict'
  }
}

async function stampOf(path: string): Promise<Stamp> {
  try {
    const info = await native().fs.stat(path)
    return { mtime: info.mtime, size: info.size }
  } catch {
    return { mtime: null, size: null }
  }
}

export const normalizeLineEndings = (raw: string) => raw.replace(/\r\n/g, '\n')
