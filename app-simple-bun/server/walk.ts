// Walking a folder for the sidebar and the project-wide passes. One readdir per directory,
// names decided by extension, hidden entries and `skipFolders` left out, symlinks never
// descended (which is also what makes a cycle impossible). The port of walk.rs.

import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/** What the sidebar lists and the document panes open. */
export const DOCUMENT_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'qmd', 'rmd', 'txt', 'csv', 'json'])

/** Directories the sidebar treats as opaque files - a `Foo.app` with a stray .txt inside it
 *  is not a folder worth showing. Only the scanner asks for this; the search walk descends. */
export const PACKAGE_EXTENSIONS = new Set([
  'app', 'bundle', 'framework', 'kext', 'plugin', 'rtfd', 'playground', 'xcodeproj', 'xcworkspace',
  'photoslibrary', 'fcpbundle', 'sparsebundle',
])

/** Entries examined before giving up on a single folder. Hitting it means the folder is
 *  enormous and document-free; the scan then fails open and shows the folder, because
 *  hiding real content is worse than showing an empty one. */
export const SCAN_BUDGET = 20_000

function extensionLower(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1).toLowerCase()
}

export function isDocument(name: string): boolean {
  const ext = extensionLower(name)
  return ext !== null && DOCUMENT_EXTENSIONS.has(ext)
}

function isPackage(name: string): boolean {
  const ext = extensionLower(name)
  return ext !== null && PACKAGE_EXTENSIONS.has(ext)
}

const isHidden = (name: string) => name.startsWith('.')

export interface Entry {
  name: string
  path: string
  isDir: boolean
}

/** One level of the sidebar. A folder that is gone and one you are not allowed to read are
 *  different problems, and the sidebar says something different for each. */
export type Listing =
  | { kind: 'entries'; entries: Entry[] }
  | { kind: 'denied' }
  | { kind: 'missing' }

/** One directory, one readdir. Only the entries that matter - directories worth descending
 *  and files the sidebar would list - and how many entries it had to look at. With
 *  `followSymlinks` a link to a folder counts as a folder (the sidebar shows it); without, a
 *  link is whatever its name says and is never descended (the walk). */
function children(
  dir: string,
  skip: Set<string>,
  skipPackages: boolean,
  followSymlinks: boolean,
): { entries: { name: string; isDir: boolean }[]; examined: number } | null {
  let dirents: Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const out: { name: string; isDir: boolean }[] = []
  let examined = 0
  for (const entry of dirents) {
    examined += 1
    const name = entry.name
    if (!name || isHidden(name)) continue
    let isDir: boolean
    if (entry.isSymbolicLink()) {
      if (!followSymlinks) {
        isDir = false
      } else {
        try {
          isDir = statSync(join(dir, name)).isDirectory()
        } catch {
          isDir = false
        }
      }
    } else {
      isDir = entry.isDirectory()
    }
    if (isDir) {
      if (skip.has(name) || (skipPackages && isPackage(name))) continue
      out.push({ name, isDir: true })
    } else if (isDocument(name)) {
      out.push({ name, isDir: false })
    }
  }
  return { entries: out, examined }
}

/** Every document below `root`, however deep. Within one directory documents come before
 *  subtrees and each group is sorted by name, so the same tree always answers the same way
 *  and search results do not shuffle between keystrokes. An unreadable directory is not an
 *  error here: a whole-project pass that stopped at the first protected folder would find
 *  nothing at all. */
export function documentsUnder(root: string, skip: Set<string>, skipPackages = false, limit = Infinity): string[] {
  const found: string[] = []
  collect(root, skip, skipPackages, found, limit)
  return found
}

/** `limit` caps the walk, not just the answer: a tree with a hundred thousand files stops
 *  being read once enough have been found. The caller sees a full-length answer and knows. */
function collect(dir: string, skip: Set<string>, skipPackages: boolean, found: string[], limit: number): void {
  if (found.length >= limit) return
  const read = children(dir, skip, skipPackages, false)
  if (!read) return
  const documents: string[] = []
  const subtrees: string[] = []
  for (const { name, isDir } of read.entries) (isDir ? subtrees : documents).push(name)
  documents.sort(byteOrder)
  subtrees.sort(byteOrder)
  for (const name of documents) {
    if (found.length >= limit) return
    found.push(join(dir, name))
  }
  for (const name of subtrees) {
    if (found.length >= limit) return
    collect(join(dir, name), skip, skipPackages, found, limit)
  }
}

/** Rust's `sort` on Strings is byte order; JS default sort is UTF-16 code unit order, which
 *  agrees for everything but astral characters. Close enough to share fixtures, but the
 *  comparator is named so the intent is on record. */
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Whether anything below `dir` is a document, giving up after `budget` entries. Fails
 *  *open* on the budget - a folder too big to scan is shown rather than hidden. */
export function containsDocument(dir: string, skip: Set<string>, budget: number, skipPackages: boolean): boolean {
  const state = { examined: 0 }
  return probe(dir, skip, skipPackages, state, budget)
}

function probe(dir: string, skip: Set<string>, skipPackages: boolean, state: { examined: number }, budget: number): boolean {
  const read = children(dir, skip, skipPackages, false)
  if (!read) return false
  // Every entry readdir handed back, not just the ones that got through the filter - the
  // budget is there to bound a huge document-free folder, and those are exactly the folders
  // where almost nothing gets through.
  state.examined += read.examined
  const subtrees: string[] = []
  for (const { name, isDir } of read.entries) {
    if (!isDir) return true
    subtrees.push(name)
  }
  if (state.examined > budget) return true
  subtrees.sort(byteOrder)
  return subtrees.some((name) => probe(join(dir, name), skip, skipPackages, state, budget))
}

/** "Does this folder have a document anywhere below it?", memoised per path. A change
 *  inside a folder can flip the answer for it and every folder above it, and invalidates
 *  everything below it. */
export class Scanner {
  private cache = new Map<string, boolean>()

  containsDocuments(dir: string, skip: Set<string>): boolean {
    const cached = this.cache.get(dir)
    if (cached !== undefined) return cached
    const result = containsDocument(dir, skip, SCAN_BUDGET, true)
    this.cache.set(dir, result)
    return result
  }

  invalidate(path: string): void {
    const below = `${path}/`
    for (const cached of [...this.cache.keys()]) {
      if (cached === path || cached.startsWith(below) || path.startsWith(`${cached}/`)) this.cache.delete(cached)
    }
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}

/** One level of the tree: documents, and folders that have a document somewhere below
 *  them. Folders first, then natural order - `9.md` before `10.md`. */
export function listDir(dir: string, skip: Set<string>, scanner: Scanner): Listing {
  let dirents: Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    if (code === 'EACCES' || code === 'EPERM') return { kind: 'denied' }
    try {
      statSync(dir)
      return { kind: 'denied' }
    } catch {
      return { kind: 'missing' }
    }
  }
  const entries: Entry[] = []
  for (const entry of dirents) {
    const name = entry.name
    if (!name || isHidden(name)) continue
    const path = join(dir, name)
    let isDir: boolean
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      if (skip.has(name) || !scanner.containsDocuments(path, skip)) continue
    } else if (!isDocument(name)) {
      continue
    }
    entries.push({ name, path, isDir })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? naturalCompare(a.name, b.name) : a.isDir ? -1 : 1))
  return { kind: 'entries', entries }
}

/** Case-insensitive, digit runs compared by value: `a2` < `a10`, `B` between `a` and `c`. */
export function naturalCompare(a: string, b: string): number {
  const x = [...a.toLowerCase()]
  const y = [...b.toLowerCase()]
  let i = 0
  let j = 0
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
  for (;;) {
    const p = x[i]
    const q = y[j]
    if (p === undefined && q === undefined) return 0
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (isDigit(p) && isDigit(q)) {
      let np = 0n
      let nq = 0n
      while (isDigit(x[i])) np = np * 10n + BigInt(x[i++]!.charCodeAt(0) - 48)
      while (isDigit(y[j])) nq = nq * 10n + BigInt(y[j++]!.charCodeAt(0) - 48)
      if (np !== nq) return np < nq ? -1 : 1
      continue
    }
    if (p !== q) return p < q ? -1 : 1
    i++
    j++
  }
}

export const skipSet = (skipFolders: string[]) => new Set(skipFolders)
