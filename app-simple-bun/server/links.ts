// The rewrite pass that follows a move: every document under the root is read once, its
// destinations resolved by path arithmetic (src/models/markdownLinks.ts, the same scanner
// the page uses), and written back only when one of them pointed at a file that moved.
// Reading a project's worth of files is the heavy part, which is why this runs here rather
// than in the webview. The port of links.rs's plan/run.

import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { rewriting, type Move } from '../src/models/markdownLinks'
import { dirname, normalizePath } from '../src/models/paths'
import { documentsUnder } from './walk'

export type { Move }

/** One document whose text changes once the moves have happened. */
export interface Rewrite {
  path: string
  text: string
  count: number
  /** The text came from `buffers`, not the disk - the caller owns it. */
  fromBuffer: boolean
}

const decoder = new TextDecoder('utf-8', { fatal: true })

/** Every document under `root` whose text changes once `moves` have happened. `buffers`
 *  (unsaved editor text, by path) win over the disk; `excluding` are never read. The result
 *  is the same either side of the move - resolution is path arithmetic and never asks the
 *  disk whether the file is there - so the move goes first and this follows it. */
export function plan(
  root: string,
  skip: Set<string>,
  moves: Move[],
  buffers: Record<string, string>,
  excluding: Set<string>,
  home: string | null,
): Rewrite[] {
  if (moves.length === 0) return []
  const unsaved = new Map<string, string>()
  for (const [k, v] of Object.entries(buffers)) unsaved.set(normalizePath(k), v)
  const excluded = new Set([...excluding].map(normalizePath))
  const rewrites: Rewrite[] = []
  for (const path of documentsUnder(root, skip, false)) {
    const key = normalizePath(path)
    if (excluded.has(key)) continue
    let text: string
    let fromBuffer: boolean
    const buffered = unsaved.get(key)
    if (buffered !== undefined) {
      text = buffered
      fromBuffer = true
    } else {
      // A file we cannot read as text is shown but never written.
      try {
        text = decoder.decode(readFileSync(path))
      } catch {
        continue
      }
      fromBuffer = false
    }
    const result = rewriting(text, dirname(key), moves, home ? { home } : {})
    if (result) rewrites.push({ path, text: result.text, count: result.count, fromBuffer })
  }
  return rewrites
}

export interface Outcome {
  written: { path: string; count: number }[]
  buffered: { path: string; text: string; count: number }[]
  failed: string[]
}

/** The whole pass: plan, then write. The splice only replaces destination tokens and the
 *  text goes back as it is, so a CRLF file stays CRLF. */
export function run(
  root: string,
  skip: Set<string>,
  moves: Move[],
  buffers: Record<string, string>,
  excluding: Set<string>,
  home: string | null,
): Outcome {
  const outcome: Outcome = { written: [], buffered: [], failed: [] }
  for (const rewrite of plan(root, skip, moves, buffers, excluding, home)) {
    if (rewrite.fromBuffer) {
      outcome.buffered.push({ path: rewrite.path, text: rewrite.text, count: rewrite.count })
      continue
    }
    try {
      writeAtomically(rewrite.path, rewrite.text)
      outcome.written.push({ path: rewrite.path, count: rewrite.count })
    } catch {
      outcome.failed.push(rewrite.path)
    }
  }
  return outcome
}

/** A temp file renamed into place, so a watcher or a reader never sees half a file. The
 *  temp name is no document extension, so a re-list in between never shows it. */
export function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.md-boss.tmp`
  writeFileSync(tmp, text)
  try {
    chmodSync(tmp, statSync(path).mode)
  } catch {
    // a new file keeps the default mode
  }
  renameSync(tmp, path)
}
