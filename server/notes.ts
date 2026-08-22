// The `.md-boss` store on disk: read (three shapes fold into one), write (canonical shape,
// atomic, removed when empty). The parsing and the fold are src/models/notes.ts, shared
// with the page, so the two sides agree about what a file says; this file is the IO.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileIsEmpty, parseAnnotationFile, serializeAnnotationFile, type AnnotationFile } from '../src/models/notes'

/** Missing or malformed reads as empty. Never an error: a store that cannot be read is a
 *  store with nothing in it. */
export function readNotes(path: string): AnnotationFile {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { notes: [] }
  }
  return parseAnnotationFile(text)
}

/** An emptied file is removed rather than left as `{}` littering the project root. The
 *  write is atomic - a temp file renamed into place - so a watcher or a git status never
 *  sees half a file. */
export function writeNotes(path: string, file: AnnotationFile): void {
  if (fileIsEmpty(file)) {
    try {
      unlinkSync(path)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, serializeAnnotationFile(file))
  renameSync(tmp, path)
}
