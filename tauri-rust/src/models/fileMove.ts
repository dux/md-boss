// Moving or renaming one file in the sidebar: what has to be true before anything is
// touched, and what has to be rewritten afterwards. A rename is a move that stays in the
// folder it started in, so the two share everything past the validation - one
// markdownLinks Move either way, and the rewrite pass is path arithmetic that never asks
// the disk where the file went.

import { native } from '../native/bridge'
import { documentsUnder } from './documentWalk'
import { rewriting, type Move } from './markdownLinks'
import { basename, dirname, isUnder, joinPath, normalizePath } from './paths'

export type Refusal =
  | 'missingSource'
  /** Moving a folder means one rewrite pair per document inside it, and a decision about
   *  the folder's own links. Not this change. */
  | 'notAFile'
  | 'badDestination'
  | 'sameFolder'
  | 'intoItself'
  | 'exists'
  /** Empty, hidden, or carrying a separator. A rename names a sibling; anything that would
   *  move the file or hide it from the tree is not one. */
  | 'badName'
  /** The name it already has. */
  | 'unchanged'

/** Null for a drop that changes nothing - putting a file back where it already lives is a
 *  no-op, not a mistake to complain about. */
export function moveMessage(refusal: Refusal, source: string, destination: string): string | null {
  const name = basename(source)
  switch (refusal) {
    case 'missingSource': return `${name} is no longer there`
    case 'notAFile': return 'Only files can be moved'
    case 'badDestination': return `${basename(destination)} is not a folder`
    case 'intoItself': return 'A folder cannot be moved into itself'
    case 'exists': return `${basename(destination)} already has a ${name}`
    default: return null
  }
}

/** The same refusals said the way a rename would say them. Null where there is nothing to
 *  complain about: retyping the name a file already has is a no-op, not a mistake. */
export function renameMessage(refusal: Refusal, source: string, name: string): string | null {
  switch (refusal) {
    case 'missingSource': return `${basename(source)} is no longer there`
    case 'notAFile': return 'Only files can be renamed'
    case 'badName': return `${name} is not a file name`
    case 'exists': return `${basename(dirname(source))} already has a ${name}`
    default: return null
  }
}

async function statOrNull(path: string) {
  const { fs } = native()
  try {
    return await fs.stat(path)
  } catch {
    return null
  }
}

/** Null when the move can go ahead. */
export async function checkMove(source: string, destination: string): Promise<Refusal | null> {
  const sourceStat = await statOrNull(source)
  if (!sourceStat) return 'missingSource'
  if (sourceStat.isDir) return 'notAFile'

  const destinationStat = await statOrNull(destination)
  if (!destinationStat || !destinationStat.isDir) return 'badDestination'

  if (normalizePath(dirname(source)) === normalizePath(destination)) return 'sameFolder'
  // Vacuous for a file and exact for a folder, and it compares on path boundaries rather
  // than by prefix - `/work/notes-old` is not part of `/work/notes`.
  if (isUnder(destination, source)) return 'intoItself'

  if (await native().fs.exists(joinPath(destination, basename(source)))) return 'exists'
  return null
}

/** Null when the rename can go ahead. `name` is the final file name, extension included -
 *  the caller has already put it through `documentName`. */
export async function checkRename(source: string, name: string): Promise<Refusal | null> {
  const sourceStat = await statOrNull(source)
  if (!sourceStat) return 'missingSource'
  if (sourceStat.isDir) return 'notAFile'

  // A separator would make this a move, `.` and `..` name the folder the file is already
  // in, and a leading dot would hide it from a tree that skips hidden files - renaming a
  // file into thin air is the one outcome here worth ruling out.
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\') || name.includes(':')) return 'badName'
  if (name === basename(source)) return 'unchanged'

  const target = joinPath(dirname(source), name)
  const targetStat = await statOrNull(target)
  if (targetStat && !(await isSameFile(target, targetStat, source, sourceStat))) return 'exists'
  return null
}

/** On a case-insensitive volume `plan.md` -> `Plan.md` finds a file already sitting at the
 *  target: itself. Inode identity tells that from a real collision; where the platform has
 *  no inode, a name that differs only by case is taken as the same file. */
async function isSameFile(
  target: string,
  targetStat: { ino: number | null },
  source: string,
  sourceStat: { ino: number | null },
): Promise<boolean> {
  if (targetStat.ino !== null && sourceStat.ino !== null) return targetStat.ino === sourceStat.ino
  return normalizePath(target).toLowerCase() === normalizePath(source).toLowerCase()
}

// MARK: - The rewrite pass

export interface Rewrite {
  path: string
  text: string
  count: number
}

/** Every document under `root` whose text changes once `moves` have happened. `buffers`
 *  (unsaved editor text, by path) win over the disk; `excluding` are never read. The
 *  result is the same either side of the rename - resolution is path arithmetic and never
 *  asks the disk whether the file is there - so the move goes first and this follows it. */
export async function planRewrites(
  root: string,
  skipFolders: ReadonlySet<string>,
  moves: Move[],
  buffers: Record<string, string> = {},
  excluding: ReadonlySet<string> = new Set(),
): Promise<Rewrite[]> {
  if (moves.length === 0) return []
  const { fs } = native()
  const rewrites: Rewrite[] = []

  for (const path of await documentsUnder(root, skipFolders)) {
    const key = normalizePath(path)
    if (excluding.has(key)) continue
    let text = buffers[key]
    if (text === undefined) {
      try {
        text = await fs.read(path)
      } catch {
        // A file we cannot read as text is shown but never written.
        continue
      }
    }
    const result = rewriting(text, dirname(path), moves)
    if (result) rewrites.push({ path, text: result.text, count: result.count })
  }
  return rewrites
}
