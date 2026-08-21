// The sidebar's two search modes and the state behind them - the SidebarSearch.swift port.
//
// The field is permanent chrome above the folder box, and the *query* is what decides
// whether the tree or a result list is showing. So there is no "search is open" flag to get
// out of step with what you can see: an empty field is the tree, anything typed into it is
// a search. `mode` only says which of the two searches that is, and Cmd-Shift-F / Cmd-P set
// it. Not a fourth pane: a pane is persisted through visiblePanes, which a query must never be.

import { native, type SearchHit } from '../native/bridge'
import { rank, type Ranked } from './fuzzyMatch'

export type SearchMode = 'text' | 'files'

export const SEARCH_PLACEHOLDER: Record<SearchMode, string> = {
  text: 'Find in project',
  files: 'Go to file',
}

/** What a search reads from the rest of the app, asked for at the moment it runs - the
 *  active root can change between keystrokes, and the buffer is whatever is typed now. */
export interface SearchContext {
  root(): string | null
  skipFolders(): string[]
  /** Most recently opened first. Breaks ties in Go to File only. */
  recent(): string[]
  /** Unsaved text by path - searching the disk copy of the open file would miss what you
   *  just typed. */
  buffers(): Record<string, string>
}

/** A superseded query never reaches the disk at all. */
export const SEARCH_DEBOUNCE_MS = 180

export class SidebarSearch {
  mode: SearchMode = 'text'
  /** Bumped by `focus` and watched by the field, so Cmd-Shift-F puts the caret in it. A
   *  counter rather than a flag: pressing it twice has to focus twice, and a flag that is
   *  already true is not a change anything can observe. */
  focusRequest = 0
  query = ''
  hits: SearchHit[] = []
  files: Ranked[] = []
  isRunning = false
  truncated = false
  /** Which row the keyboard is on. */
  cursor = 0

  /** Every document under the root, walked when Go to File is asked for; each keystroke
   *  after that filters in memory. */
  private candidates: string[] = []
  private candidatesGeneration = 0
  /** Monotonic per query. The Rust side drops a search whose generation is no longer the
   *  newest between files, and a late answer for an older one is dropped here too. */
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly context: SearchContext, private readonly debounceMs = SEARCH_DEBOUNCE_MS) {}

  /** Whether a result list is showing instead of the tree. The query is the answer. */
  get isActive(): boolean {
    return this.query !== ''
  }

  get rowCount(): number {
    return this.mode === 'files' ? this.files.length : this.hits.length
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  // MARK: Choosing a search

  /** Cmd-Shift-F and Cmd-P. Switches which search the field is doing and puts the caret in
   *  it, deliberately keeping whatever is already typed - swapping modes mid-query is the
   *  whole point of having two of them on one field. */
  focus(mode: SearchMode): void {
    if (this.mode !== mode) {
      this.mode = mode
      this.cursor = 0
    }
    this.focusRequest++
    if (mode === 'files') void this.loadCandidates()
    this.schedule()
    this.emit()
  }

  /** Typed into the field. */
  setQuery(query: string): void {
    if (query === this.query) return
    this.query = query
    this.cursor = 0
    this.schedule()
    this.emit()
  }

  /** Back to the tree. The mode survives, because it is a preference about the field rather
   *  than part of the query. */
  clear(): void {
    this.cancel()
    this.query = ''
    this.hits = []
    this.files = []
    this.isRunning = false
    this.truncated = false
    this.cursor = 0
    this.emit()
  }

  /** Returns whether there was a row to move on, so the key stays available otherwise. */
  moveCursor(step: number): boolean {
    if (this.rowCount === 0) return false
    const next = Math.min(Math.max(0, this.cursor + step), this.rowCount - 1)
    if (next !== this.cursor) {
      this.cursor = next
      this.emit()
    }
    return true
  }

  /** The active folder changed under a query: the candidates are another tree's, and the
   *  hits are too. */
  rootChanged(): void {
    this.candidates = []
    if (!this.isActive) return
    if (this.mode === 'files') void this.loadCandidates()
    this.schedule()
    this.emit()
  }

  // MARK: Running

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.generation++
  }

  private schedule(): void {
    this.cancel()
    if (!this.isActive) {
      this.hits = []
      this.files = []
      this.isRunning = false
      this.truncated = false
      return
    }
    if (this.mode === 'files') this.rankFiles()
    else this.runSearch()
  }

  private rankFiles(): void {
    const root = this.context.root()
    if (root === null) return
    this.files = rank(this.query, this.candidates, root, this.context.recent())
    this.cursor = Math.min(this.cursor, Math.max(0, this.files.length - 1))
  }

  private runSearch(): void {
    const root = this.context.root()
    if (root === null) return
    const query = this.query
    const skip = this.context.skipFolders()
    const buffers = this.context.buffers()
    const generation = this.generation
    this.isRunning = true
    this.timer = setTimeout(() => {
      this.timer = null
      void native().commands.search(root, skip, query, buffers, generation).then(
        (result) => {
          // A late arrival for a query that has moved on is dropped.
          if (generation !== this.generation) return
          this.hits = result.hits
          this.truncated = result.truncated
          this.isRunning = false
          this.cursor = Math.min(this.cursor, Math.max(0, result.hits.length - 1))
          this.emit()
        },
        () => {
          if (generation !== this.generation) return
          this.isRunning = false
          this.emit()
        },
      )
    }, this.debounceMs)
  }

  /** Walked on every Cmd-P rather than once: the walk is the sidebar's own and cheap, and a
   *  list kept from the first press would miss every file made since. The old list stays
   *  on screen until the new one lands, so a repeat press does not blank the results. */
  private async loadCandidates(): Promise<void> {
    const root = this.context.root()
    if (root === null) return
    const generation = ++this.candidatesGeneration
    const found = await native().commands.documentsUnder(root, this.context.skipFolders())
    if (generation !== this.candidatesGeneration) return
    this.candidates = found
    if (this.mode === 'files' && this.isActive) {
      this.rankFiles()
      this.emit()
    }
  }
}
