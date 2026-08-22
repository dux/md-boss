// Finding a string across every document under a folder. The port of search.rs: the file
// list is the sidebar's own walk (documentsUnder), so the search never answers "which files
// does this app show you" differently from the tree; a byte prefilter skips files that
// cannot contain the query before they are decoded; the budgets say when a huge tree was
// cut short rather than quietly showing less; a superseded query is cancelled between files
// through a generation id.
//
// Deliberately not handled: regular expressions, whole-word matching, multi-line patterns.

import { readFileSync } from 'node:fs'
import { documentsUnder } from './walk'

export interface Hit {
  path: string
  /** 1-based, counted the way LineIndex counts - split on `\n` only. */
  line: number
  /** UTF-16 offset of the match within `text`, the unit the editor and the notes speak. */
  column: number
  /** UTF-16 length. */
  length: number
  /** The whole line, so the row can show the match in context and mark it. */
  text: string
}

/** Budgets, so a query typed into a huge tree cannot walk forever. Reaching one sets
 *  `truncated`, which the pane says out loud. */
export interface Limits {
  perFile: number
  total: number
  files: number
}

export const DEFAULT_LIMITS: Limits = { perFile: 50, total: 2000, files: 5000 }

export interface SearchResult {
  hits: Hit[]
  truncated: boolean
  filesSearched: number
}

export interface Match {
  line: number
  column: number
  length: number
  text: string
}

/** Case-insensitive until the query carries a capital, then exact. Derived from the query
 *  rather than stored behind a toggle. */
export function isCaseSensitive(query: string): boolean {
  for (const c of query) if (c !== c.toLowerCase() && c === c.toUpperCase()) return true
  return false
}

/** Every match in one string, pure over text. Matched line by line - a query never spans a
 *  line break - with columns in UTF-16 units; case folding is `toLowerCase` on both sides,
 *  mapped back to the original characters so a fold that changes length cannot shift the
 *  column. Lines keep no trailing `\n` or `\r`. */
export function matches(text: string, query: string, limit: number): Match[] {
  if (!query || !text || limit <= 0) return []
  const sensitive = isCaseSensitive(query)
  const needle = sensitive ? query : query.toLowerCase()
  const found: Match[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (!line) continue
    if (sensitive) {
      let at = line.indexOf(needle)
      while (at >= 0) {
        found.push({ line: index + 1, column: at, length: needle.length, text: line })
        if (found.length >= limit) return found
        at = line.indexOf(needle, at + needle.length)
      }
      continue
    }
    // Folded text, plus for every folded UTF-16 unit the offset of the original char it came
    // from (and one past the end), so a folded offset maps back to a column.
    let folded = ''
    const origin: number[] = []
    let offset = 0
    for (const c of line) {
      const f = c.toLowerCase()
      folded += f
      for (let k = 0; k < f.length; k++) origin.push(offset)
      offset += c.length
    }
    origin.push(offset)
    let at = folded.indexOf(needle)
    while (at >= 0) {
      const start = origin[at]!
      const end = origin[at + needle.length]!
      found.push({ line: index + 1, column: start, length: end - start, text: line })
      if (found.length >= limit) return found
      at = folded.indexOf(needle, at + needle.length)
    }
  }
  return found
}

/** "Could this file possibly contain the query?", answered on raw bytes. One-sided: it may
 *  say yes about a file holding nothing, and must never say no about one that does. Only an
 *  ASCII query can be answered soundly as bytes - folding non-ASCII means Unicode case
 *  mapping - so any other query reads every file. */
export class Needle {
  private folded: Uint8Array
  private sensitive: boolean
  /** The one non-ASCII character whose lowercase is ASCII: KELVIN SIGN folds to `k`. A
   *  file holding it cannot be skipped for a query with a `k` in it. */
  private kelvin: boolean

  private constructor(folded: Uint8Array, sensitive: boolean, kelvin: boolean) {
    this.folded = folded
    this.sensitive = sensitive
    this.kelvin = kelvin
  }

  static for(query: string): Needle | null {
    if (!query) return null
    for (let i = 0; i < query.length; i++) if (query.charCodeAt(i) > 0x7f) return null
    const sensitive = isCaseSensitive(query)
    const folded = new TextEncoder().encode(sensitive ? query : query.toLowerCase())
    const kelvin = !sensitive && folded.includes(0x6b)
    return new Needle(folded, sensitive, kelvin)
  }

  mayContain(bytes: Uint8Array): boolean {
    if (bytes.length < this.folded.length) return false
    if (this.sensitive) return indexOfBytes(bytes, this.folded) >= 0
    const lowered = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!
      lowered[i] = b >= 0x41 && b <= 0x5a ? b + 32 : b
    }
    if (indexOfBytes(lowered, this.folded) >= 0) return true
    return this.kelvin && indexOfBytes(bytes, KELVIN) >= 0
  }
}

const KELVIN = new TextEncoder().encode('K')

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0
  const first = needle[0]!
  const last = haystack.length - needle.length
  outer: for (let i = 0; i <= last; i++) {
    if (haystack[i] !== first) continue
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

const decoder = new TextDecoder('utf-8', { fatal: true })

/** The whole search. `buffers` is unsaved text by path - searching the disk copy of the
 *  file you are looking at would miss what you just typed. `cancelled` is polled between
 *  files, so a superseded query dies within one file's work rather than walking the tree. */
export function run(
  root: string,
  skip: Set<string>,
  query: string,
  buffers: Record<string, string>,
  limits: Limits,
  cancelled: () => boolean,
): SearchResult {
  if (!query) return { hits: [], truncated: false, filesSearched: 0 }
  let targets = documentsUnder(root, skip, false)
  let truncated = false
  if (targets.length > limits.files) {
    targets = targets.slice(0, limits.files)
    truncated = true
  }
  if (cancelled()) return { hits: [], truncated: true, filesSearched: 0 }
  const needle = Needle.for(query)
  const hits: Hit[] = []
  for (const path of targets) {
    if (cancelled()) return { hits, truncated: true, filesSearched: targets.length }
    let text: string
    const unsaved = buffers[path]
    if (unsaved !== undefined) {
      text = unsaved
    } else {
      let bytes: Uint8Array
      try {
        bytes = readFileSync(path)
      } catch {
        continue
      }
      if (needle && !needle.mayContain(bytes)) continue
      // A file we cannot decode is listed but never read, the same rule the document and
      // the link rewriter apply.
      try {
        text = decoder.decode(bytes)
      } catch {
        continue
      }
    }
    const room = Math.min(limits.perFile, Math.max(0, limits.total - hits.length))
    if (room === 0) return { hits, truncated: true, filesSearched: targets.length }
    // One past the cap, so "exactly full" can be told from "there was more".
    const found = matches(text, query, room + 1)
    if (found.length > room) truncated = true
    for (const m of found.slice(0, room)) hits.push({ path, ...m })
  }
  return { hits, truncated, filesSearched: targets.length }
}

/** The newest query's generation. A search whose generation is no longer the latest stops
 *  between files; the frontend bumps it on every keystroke. */
export class Generation {
  private latest = 0

  bump(generation: number): void {
    if (generation > this.latest) this.latest = generation
  }

  isStale(generation: number): boolean {
    return this.latest !== generation
  }
}
