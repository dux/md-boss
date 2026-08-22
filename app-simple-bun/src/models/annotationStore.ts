// Every loaded `.md-boss`, keyed by the store file's path so a write goes back where it
// came from: one per root folder plus the fallback in the config dir for files outside
// every root. The port of AnnotationStore.swift; the IO is the Rust store behind
// commands.readNotes / writeNotes, the file rules are notes.ts, the shifting is noteShift.ts.

import { native, type NotesFile } from '../native/bridge'
import { DirectoryWatcher } from './directoryWatcher'
import type { LineIndex } from './lineIndex'
import {
  type AnnotationFile, deduplicated, emptyFile, fold, type Note, noteId, noteIsEmpty, noteTooltip,
  removingPath, repointing, serializeAnnotationFile, storePath,
} from './notes'
import { type Edit, shiftLine } from './noteShift'
import { basename, dirname } from './paths'
import type { RootFolders } from './rootFolders'

export const STORE_FILE_NAME = '.md-boss'
export const FALLBACK_FILE_NAME = 'annotations.json'

const byPathThenLine = (a: Note, b: Note) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)
const sameFile = (a: AnnotationFile, b: AnnotationFile) => serializeAnnotationFile(a) === serializeAnnotationFile(b)

export class AnnotationStore {
  /** Keyed by the `.md-boss` file's path. */
  files: Record<string, AnnotationFile> = {}
  private readonly folders: RootFolders
  private readonly fallback: string
  private readonly home: string
  private readonly listeners = new Set<() => void>()
  private readonly watcher: DirectoryWatcher
  private reloading: Promise<void> | null = null
  /** Bumped by every local write. A reload that started before a write must not land its
   *  stale reading over the newer files - it re-reads instead. */
  private generation = 0

  constructor(folders: RootFolders, fallback: string, home: string) {
    this.folders = folders
    this.fallback = fallback
    this.home = home
    // A `.md-boss` is meant to be hand-editable and committed, so it has to be picked up
    // when it changes under us - after a git pull, say. Watched by directory (the only
    // granularity the platforms share), filtered to the store files.
    this.watcher = new DirectoryWatcher((_, changed) => {
      if (changed.some((p) => basename(p) === STORE_FILE_NAME || p === this.fallback)) void this.reload()
    })
    // A folder arriving or leaving brings its own `.md-boss` with it.
    this.folders.onChange(() => void this.reload())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  // MARK: Loading

  /** Every candidate store, whether or not it exists yet. */
  private candidates(): string[] {
    return [...this.folders.roots.map((root) => `${root}/${STORE_FILE_NAME}`), this.fallback]
  }

  /** Reads every store. A contested note goes to the store that owns its document today,
   *  so a repair moves it into the project rather than stranding it in the fallback; the
   *  repair is written back rather than re-done on every launch, only touching the stores
   *  that actually lost a copy. One reload at a time - the write our own repair provokes
   *  finds nothing left to fold. */
  reload(): Promise<void> {
    if (this.reloading) return this.reloading
    this.reloading = this.doReload().finally(() => {
      this.reloading = null
    })
    return this.reloading
  }

  private async doReload(): Promise<void> {
    for (;;) {
      const generation = this.generation
      const loaded: Record<string, AnnotationFile> = {}
      const existing: string[] = []
      for (const store of this.candidates()) {
        if (!(await native().fs.exists(store))) continue
        existing.push(store)
        loaded[store] = fromNative(await native().commands.readNotes(store))
      }
      // Something was written while we were reading: what we hold is already stale.
      if (generation !== this.generation) continue
      const healed = deduplicated(loaded, (n) => this.storeFor(this.expand(n.path)))
      const before = this.files
      this.files = healed
      for (const [path, file] of Object.entries(healed)) {
        if (!loaded[path] || !sameFile(file, loaded[path])) await this.write(path)
      }
      this.watcher.sync(new Set(existing.map(dirname)))
      if (JSON.stringify(before) !== JSON.stringify(healed)) this.emit()
      return
    }
  }

  /** Every mutation starts from settled files, not from ones a reload is about to replace. */
  private async settle(): Promise<void> {
    if (this.reloading) await this.reloading
  }

  private async write(store: string): Promise<void> {
    this.generation++
    const file = this.files[store] ?? emptyFile()
    if (file.notes.length === 0) delete this.files[store]
    await native().commands.writeNotes(store, file)
  }

  // MARK: Paths

  /** The tilde-abbreviated form a note's path is stored in. */
  key(documentPath: string): string {
    return storePath(documentPath, this.home)
  }

  expand(stored: string): string {
    return stored === '~' ? this.home : stored.startsWith('~/') ? this.home + stored.slice(1) : stored
  }

  /** The `.md-boss` a *new* annotation for the document belongs in. Not necessarily the one
   *  an existing note is already in - roots are MRU-ordered, so nested roots swap places,
   *  and a file annotated before its folder became a root has its note in the fallback.
   *  Anything touching a note that already exists goes through storeHolding instead. */
  storeFor(documentPath: string): string {
    const root = this.folders.rootContaining(documentPath)
    return root ? `${root}/${STORE_FILE_NAME}` : this.fallback
  }

  /** Where a change to one note has to land: wherever it already lives, or - for a new
   *  one - the store that owns the document. */
  private storeHolding(documentPath: string, line: number): string {
    const path = this.key(documentPath)
    const owner = Object.keys(this.files).sort().find((store) => this.files[store].notes.some((n) => n.path === path && n.line === line))
    return owner ?? this.storeFor(documentPath)
  }

  /** Every loaded store with a note on this document. One, normally. */
  private storesHolding(path: string): string[] {
    return Object.keys(this.files).sort().filter((store) => this.files[store].notes.some((n) => n.path === path))
  }

  // MARK: Reading

  /** Every note across every loaded store, by file then line. */
  get notes(): Note[] {
    return Object.values(this.files).flatMap((f) => f.notes).sort(byPathThenLine)
  }

  notesFor(documentPath: string): Note[] {
    const path = this.key(documentPath)
    return Object.values(this.files).flatMap((f) => f.notes).filter((n) => n.path === path).sort((a, b) => a.line - b.line)
  }

  noteCount(documentPath: string | null): number {
    return documentPath ? this.notesFor(documentPath).length : 0
  }

  /** Every store, not just the one storeFor would pick today - a lookup that missed is
   *  what used to offer "Add Note" on a line that already had one. */
  noteAt(documentPath: string, line: number): Note | null {
    const path = this.key(documentPath)
    return Object.values(this.files).flatMap((f) => f.notes).find((n) => n.path === path && n.line === line) ?? null
  }

  /** Asked on every edit in the raw pane, so a document nobody has annotated costs
   *  nothing to type in. */
  hasNotes(documentPath: string): boolean {
    const path = this.key(documentPath)
    return Object.values(this.files).some((f) => f.notes.some((n) => n.path === path))
  }

  /** Line -> hover text for one document: the gutter markers and both panes' hover all
   *  want the same answer. Two stores can name the same line; the first wins. */
  noteTexts(documentPath: string | null): Map<number, string> {
    const out = new Map<number, string>()
    if (!documentPath) return out
    for (const n of this.notesFor(documentPath)) if (!out.has(n.line)) out.set(n.line, noteTooltip(n))
    return out
  }

  // MARK: Writing

  private async mutate(store: string, change: (file: AnnotationFile) => AnnotationFile): Promise<void> {
    await this.settle()
    const before = this.files[store] ?? emptyFile()
    const after = change(before)
    // An unchanged file is not rewritten. Note shifting runs on every edit in the raw
    // pane and moves nothing on almost all of them.
    if (sameFile(before, after)) return
    this.files[store] = after
    await this.write(store)
    this.emit()
  }

  /** A note with neither a title nor a body is removed rather than stored - there would
   *  be nothing to show in the pane and nothing to click. Clearing a body no longer
   *  deletes the note, which is what leaves a plain jump point reachable. */
  setNote(documentPath: string, line: number, title: string, body: string): Promise<void> {
    const entry: Note = { path: this.key(documentPath), line, title, body }
    return this.mutate(this.storeHolding(documentPath, line), (file) => {
      const notes = file.notes.filter((n) => noteId(n) !== noteId(entry))
      if (!noteIsEmpty(entry)) notes.push(entry)
      return { notes: notes.sort(byPathThenLine) }
    })
  }

  remove(note: Note): Promise<void> {
    return this.mutate(this.storeHolding(this.expand(note.path), note.line), (file) => ({
      notes: file.notes.filter((n) => noteId(n) !== noteId(note)),
    }))
  }

  /** Follows an edit in the raw pane, so a note stays on the line it was put on rather than
   *  on the number that line used to have. Written straight through rather than held until
   *  the document is saved: adding a note mid-edit rewrites the whole file anyway. An
   *  external change swaps the whole text and hands us no edit, so it shifts nothing. */
  async shift(documentPath: string, from: LineIndex, to: LineIndex, edit: Edit): Promise<void> {
    const path = this.key(documentPath)
    for (const store of this.storesHolding(path)) {
      await this.mutate(store, (file) => ({
        notes: fold(
          file.notes.map((n) => {
            if (n.path !== path) return n
            const line = shiftLine(n.line, from, to, edit)
            return line === null ? n : { ...n, line }
          }),
        ),
      }))
    }
  }

  /** Follows a file the sidebar moved. The destination can be owned by a different store -
   *  notes have to leave one file and land in another. */
  async repoint(oldDocument: string, newDocument: string): Promise<void> {
    await this.settle()
    const oldPath = this.key(oldDocument)
    const newPath = this.key(newDocument)
    if (oldPath === newPath) return
    const destination = this.storeFor(newDocument)
    const moved: Note[] = []
    const touched = new Set<string>()
    for (const [store, file] of Object.entries(this.files)) {
      const split = repointing(file, oldPath, newPath)
      if (!split) continue
      this.files[store] = split.kept
      moved.push(...split.moved)
      touched.add(store)
    }
    if (moved.length === 0) return
    const landing = this.files[destination] ?? emptyFile()
    this.files[destination] = { notes: fold([...landing.notes, ...moved]) }
    touched.add(destination)
    for (const store of touched) await this.write(store)
    this.emit()
  }

  /** Drops every note on a file that has gone, and says how many went. */
  async removeAll(documentPath: string): Promise<number> {
    await this.settle()
    const path = this.key(documentPath)
    let removed = 0
    for (const [store, file] of Object.entries(this.files)) {
      const kept = removingPath(file, path)
      if (!kept) continue
      removed += file.notes.length - kept.notes.length
      this.files[store] = kept
      await this.write(store)
    }
    if (removed > 0) this.emit()
    return removed
  }
}

function fromNative(file: NotesFile): AnnotationFile {
  return { notes: fold(file.notes.map((n) => ({ path: n.path, line: n.line, title: n.title ?? '', body: n.body ?? '' }))) }
}
