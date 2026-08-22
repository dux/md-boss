// Ranking file names against what has been typed so far, for Go to File. A subsequence
// match rather than a substring one, so `mtv` finds `app/Views/MarkdownTextView.swift`.
// Pure, so the ordering can be pinned by test - which is the whole difficulty here: any
// scorer finds the matches, and only the order is the feature.

import { basename, normalizePath } from './paths'

export interface Ranked {
  path: string
  /** Root-relative, which is what the row shows and what the score was computed over. */
  display: string
  score: number
  /** UTF-16 offsets in `display` that the query landed on, for marking the row. */
  matched: number[]
}

// Weighted the way fzy weights them, and the ordering between these is the whole design:
// a run that stays together beats one that lands on boundaries, or `n-o-t-e.md` would
// outrank `notes.md` for "note". Gaps cost almost nothing - being far into a long path is
// not the same as being a bad match.
const CONSECUTIVE = 100
const AFTER_SLASH = 90
const AFTER_WORD = 80
const CAMEL_HUMP = 70
const AFTER_DOT = 60
const GAP_PENALTY = 1
const GAP_CAP = 20
const FLOOR = Number.MIN_SAFE_INTEGER / 4

/** Null when the query is not a subsequence of the candidate.
 *
 *  A full alignment rather than a greedy walk. Greedy takes the first place each character
 *  fits, which gets the ordering wrong in exactly the case this is for: `mtv` against
 *  `app/Models/MarkdownDocumentValue.swift` would seize the `M` of `Models`, then score a
 *  lucky consecutive `tV`, and beat the `M`/`T`/`V` of `MarkdownTextView` that anyone
 *  typing `mtv` meant. `best[i][j]` is the best score with query character `i` sitting at
 *  candidate position `j`; `reach[i][j]` is the best way to place the first `i + 1`
 *  characters anywhere up to `j`. */
export function score(query: string, candidate: string): { score: number; matched: number[] } | null {
  if (query === '') return { score: 0, matched: [] }

  const needle = Array.from(query.toLowerCase())
  const hay = Array.from(candidate)
  const lowered = Array.from(candidate.toLowerCase())
  // Lowercasing can change the code point count for some scripts, and the offsets would
  // then point into a string of a different length.
  if (lowered.length !== hay.length || hay.length === 0 || needle.length > hay.length) return null

  const rows = needle.length
  const columns = hay.length
  const grid = <T,>(fill: T) => Array.from({ length: rows }, () => Array<T>(columns).fill(fill))
  const best = grid(FLOOR)
  const reach = grid(FLOOR)
  const from = grid(-1)
  const chained = grid(false)

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      if (lowered[j] === needle[i]) {
        if (i === 0) {
          best[i][j] = bonus(hay, j) - Math.min(j, GAP_CAP) * GAP_PENALTY
        } else if (j > 0) {
          const continued = best[i - 1][j - 1] > FLOOR ? best[i - 1][j - 1] + CONSECUTIVE : FLOOR
          const fresh = reach[i - 1][j - 1] > FLOOR ? reach[i - 1][j - 1] + bonus(hay, j) : FLOOR
          if (continued >= fresh) {
            best[i][j] = continued
            chained[i][j] = true
          } else {
            best[i][j] = fresh
          }
        }
      }

      if (j === 0) {
        reach[i][j] = best[i][j]
        from[i][j] = best[i][j] > FLOOR ? 0 : -1
      } else if (best[i][j] > reach[i][j - 1]) {
        reach[i][j] = best[i][j]
        from[i][j] = j
      } else {
        reach[i][j] = reach[i][j - 1]
        from[i][j] = from[i][j - 1]
      }
    }
  }

  if (reach[rows - 1][columns - 1] <= FLOOR) return null

  const matchedPoints = Array<number>(rows).fill(0)
  let row = rows - 1
  let column = from[rows - 1][columns - 1]
  for (;;) {
    matchedPoints[row] = column
    if (row === 0) break
    // A fresh start came from the best reach up to the previous column, so `j > 0`.
    column = chained[row][column] ? column - 1 : from[row - 1][column - 1]
    row--
  }

  // Code point positions -> UTF-16 offsets, which is what a row marks.
  const offsets: number[] = []
  let utf16 = 0
  for (let p = 0, m = 0; p < hay.length && m < matchedPoints.length; p++) {
    if (p === matchedPoints[m]) {
      offsets.push(utf16)
      m++
    }
    utf16 += hay[p].length
  }

  // A short candidate that matched is a better answer than a long one that also did.
  return { score: reach[rows - 1][columns - 1] - Math.floor(columns / 8), matched: offsets }
}

/** The very start of the string counts as a boundary, the same as one after a slash. */
function bonus(hay: string[], index: number): number {
  if (index === 0) return AFTER_SLASH
  const previous = hay[index - 1]
  if (previous === '/') return AFTER_SLASH
  if (previous === '-' || previous === '_' || previous === ' ') return AFTER_WORD
  if (previous === '.') return AFTER_DOT
  // CamelCase opens a word too: the T of MarkdownTextView.
  if (isLower(previous) && isUpper(hay[index])) return CAMEL_HUMP
  return 0
}

const isLower = (ch: string) => ch !== ch.toUpperCase() && ch === ch.toLowerCase()
const isUpper = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase()

/** `recent` is most-recently-opened paths, nearest first. It breaks ties only - a better
 *  match always wins over a more recent one. */
export function rank(
  query: string,
  candidates: string[],
  root: string,
  recent: string[] = [],
  limit = 200,
): Ranked[] {
  const rootPath = normalizePath(root)
  const recency = new Map<string, number>()
  recent.forEach((path, position) => recency.set(normalizePath(path), recent.length - position))

  const ranked: Ranked[] = []
  for (const candidate of candidates) {
    const path = normalizePath(candidate)
    const display = path.startsWith(rootPath + '/') ? path.slice(rootPath.length + 1) : basename(path)
    const hit = score(query, display)
    if (!hit) continue
    ranked.push({ path: candidate, display, score: hit.score, matched: hit.matched })
  }

  return ranked
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      const leftRecent = recency.get(normalizePath(left.path)) ?? 0
      const rightRecent = recency.get(normalizePath(right.path)) ?? 0
      if (leftRecent !== rightRecent) return rightRecent - leftRecent
      return left.display.localeCompare(right.display, undefined, { numeric: true, sensitivity: 'base' })
    })
    .slice(0, limit)
}
