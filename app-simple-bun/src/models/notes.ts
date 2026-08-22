// Notes: a marked line, with or without something written about it. Paths are stored
// tilde-abbreviated (`~/dev/notes/plan.md`) so a `.md-boss` file stays readable and
// survives a different home directory. Line numbers are 1-based. One note per (path, line):
// adding over an existing one edits it, which keeps identity stable without UUIDs in a
// file meant to be hand-edited. Bookmarks and comments used to be two types with the same
// two keys; they were the same record - a bookmark is a note nothing has been written on.

import { isUnder, normalizePath } from './paths'

export interface Note {
  path: string
  line: number
  /** Taken from the source line when the note is made, so a list of them is scannable
   *  without opening every file. Comments written before the merge have none. */
  title: string
  /** What you typed. Empty is a plain jump point - what used to be a bookmark. */
  body: string
}

export function note(path: string, line: number, title = '', body = ''): Note {
  return { path, line, title, body }
}

export const noteId = (n: Note) => `${n.path}:${n.line}`
/** What a row leads with. Old comments have no title, and one cannot be invented without
 *  re-reading the file they point at. */
export const noteLabel = (n: Note) => (n.title ? n.title : n.body)
/** What a hover over the line says. A note with no body carries no information beyond its
 *  own existence - its title came off the source line you are already looking at. */
export const noteTooltip = (n: Note) => (n.body ? n.body : `Note on line ${n.line}`)
export const noteIsEmpty = (n: Note) => n.title === '' && n.body.trim() === ''

const byPathThenLine = (a: Note, b: Note) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line

// MARK: - The .md-boss file

export interface AnnotationFile {
  notes: Note[]
}

export const emptyFile = (): AnnotationFile => ({ notes: [] })
export const fileIsEmpty = (f: AnnotationFile) => f.notes.length === 0

/** Three shapes fold into one array: `notes`, plus `bookmarks` and `comments` written by
 *  older builds. A line carrying both an old bookmark and an old comment becomes a single
 *  note with a title and a body - the merge, and the one part of it that cannot be undone
 *  once the file is written back. Missing fields read as empty; a malformed file is empty. */
export function parseAnnotationFile(text: string): AnnotationFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyFile()
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyFile()
  const obj = raw as Record<string, unknown>
  const read = (key: string): Note[] => {
    const list = obj[key]
    if (!Array.isArray(list)) return []
    const out: Note[] = []
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const { path, line, title, body } = item as Record<string, unknown>
      if (typeof path !== 'string' || typeof line !== 'number') continue
      out.push(note(path, line, typeof title === 'string' ? title : '', typeof body === 'string' ? body : ''))
    }
    return out
  }
  return { notes: fold([...read('notes'), ...read('bookmarks'), ...read('comments')]) }
}

/** Only the current key is written, so a file converts itself the first time anything in
 *  it is touched. Empty fields are left out rather than written as `""`, so a plain jump
 *  point stays a three-key object in a file meant to be read by a person. */
export function serializeAnnotationFile(file: AnnotationFile): string {
  const notes = file.notes.map((n) => {
    const out: Record<string, unknown> = { line: n.line, path: n.path }
    if (n.title) out.title = n.title
    if (n.body) out.body = n.body
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
  })
  return JSON.stringify({ notes }, null, 2) + '\n'
}

/** One note per (path, line), first non-empty value winning per field. */
export function fold(notes: Note[]): Note[] {
  const merged = new Map<string, Note>()
  for (const n of notes) {
    const id = noteId(n)
    const existing = merged.get(id)
    if (!existing) {
      merged.set(id, { ...n })
      continue
    }
    if (!existing.title) existing.title = n.title
    if (!existing.body) existing.body = n.body
  }
  return [...merged.values()].sort(byPathThenLine)
}

/** Splits the notes on a file that has moved: what stays here, and what has to be
 *  repointed. Null when nothing in this file pointed at `oldPath`, so a store that is not
 *  involved is never rewritten. */
export function repointing(
  file: AnnotationFile,
  oldPath: string,
  newPath: string,
): { kept: AnnotationFile; moved: Note[] } | null {
  if (!file.notes.some((n) => n.path === oldPath)) return null
  const moved: Note[] = []
  const kept: Note[] = []
  for (const n of file.notes) {
    if (n.path === oldPath) moved.push({ ...n, path: newPath })
    else kept.push(n)
  }
  return { kept: { notes: kept }, moved }
}

/** This file without the notes on a document that has gone. Null when it had none. */
export function removingPath(file: AnnotationFile, path: string): AnnotationFile | null {
  if (!file.notes.some((n) => n.path === path)) return null
  return { notes: file.notes.filter((n) => n.path !== path) }
}

// MARK: - Paths

/** The form a note's path is stored in: under `home` it is tilde-abbreviated. */
export function storePath(absolute: string, home: string): string {
  const path = normalizePath(absolute)
  const root = normalizePath(home)
  if (path === root) return '~'
  return path.startsWith(root + '/') ? '~' + path.slice(root.length) : path
}

export function expandPath(stored: string, home: string): string {
  if (stored === '~') return normalizePath(home)
  return stored.startsWith('~/') ? normalizePath(home + stored.slice(1)) : normalizePath(stored)
}

/** First 40 characters of a line, letters, digits and spaces only. Markdown markers,
 *  punctuation and indentation are dropped, so `## The **plan**` suggests "The plan". */
export function suggestedTitle(line: string, limit = 40): string {
  let kept = ''
  for (const ch of line) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      kept += ch
    } else if (/\s/.test(ch) || ch === '-' || ch === '_') {
      // Collapse runs of separators into a single space.
      if (!kept.endsWith(' ')) kept += ' '
    }
  }
  return Array.from(kept.trim()).slice(0, limit).join('').trim()
}

// MARK: - Scopes

/** The three reaches of the notes pane, nearest first. */
export const NOTE_SCOPES = ['thisFile', 'thisProject', 'allProjects'] as const
export type NoteScope = (typeof NOTE_SCOPES)[number]

export const SCOPE_TITLE: Record<NoteScope, string> = {
  thisFile: 'This file',
  thisProject: 'This project',
  allProjects: 'All projects',
}

/** The open document's notes are the point of the pane, so that scope never folds. */
export const scopeIsCollapsible = (scope: NoteScope) => scope !== 'thisFile'

/** Splits every known note into the three scopes. Pure on purpose. `recentRoots` is the
 *  sidebar's recent list: folders past the twentieth are already unreachable from the
 *  picker, so they contribute nothing here either. Paths are absolute; `home` expands the
 *  stored forms. */
export function partitionNotes(
  all: Note[],
  file: string | null,
  activeRoot: string | null,
  recentRoots: string[],
  home: string,
): Record<NoteScope, Note[]> {
  const currentPath = file === null ? null : storePath(file, home)
  const otherRoots = recentRoots.filter((root) => (activeRoot === null ? true : !isUnder(root, activeRoot)))

  const result: Record<NoteScope, Note[]> = { thisFile: [], thisProject: [], allProjects: [] }
  for (const n of all) {
    const url = expandPath(n.path, home)
    if (currentPath !== null && n.path === currentPath) result.thisFile.push(n)
    else if (activeRoot !== null && isUnder(url, activeRoot)) result.thisProject.push(n)
    else if (otherRoots.some((root) => isUnder(url, root))) result.allProjects.push(n)
  }
  for (const scope of NOTE_SCOPES) result[scope].sort(byPathThenLine)
  return result
}

// MARK: - Across stores

/** One note per (path, line) across *every* store, not just within one file. The copies
 *  fold together field-wise, the same rule the parser and repoint use, so nothing anyone
 *  typed is dropped. `home` names the store a note *should* be in, and a contested one
 *  goes there when it has a copy to spare - otherwise the project's own `.md-boss` could
 *  lose a note to the fallback on nothing but alphabetical luck. A note sitting on its own
 *  is never moved. Stores emptied by the fold still come back in the result, because the
 *  caller has to write them out to finish the repair. */
export function deduplicated(
  stores: Record<string, AnnotationFile>,
  home: (n: Note) => string | null = () => null,
): Record<string, AnnotationFile> {
  // Sorted, so the tie-break does not depend on object ordering.
  const copies = new Map<string, { store: string; note: Note }[]>()
  for (const path of Object.keys(stores).sort()) {
    for (const n of stores[path].notes) {
      const id = noteId(n)
      if (!copies.has(id)) copies.set(id, [])
      copies.get(id)!.push({ store: path, note: n })
    }
  }

  const merged: Record<string, Note[]> = {}
  for (const path of Object.keys(stores)) merged[path] = []
  for (const found of copies.values()) {
    const to = keeper(found, home)
    ;(merged[to] ??= []).push(...found.map((f) => f.note))
  }

  const out: Record<string, AnnotationFile> = {}
  for (const [path, notes] of Object.entries(merged)) out[path] = { notes: fold(notes) }
  return out
}

function keeper(found: { store: string; note: Note }[], home: (n: Note) => string | null): string {
  if (found.length < 2) return found[0].store
  const wanted = home(found[0].note)
  if (wanted === null || !found.some((f) => f.store === wanted)) return found[0].store
  return wanted
}
