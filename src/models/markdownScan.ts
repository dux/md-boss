// The parts of markdown that are not regular, in one place: fences are line state, a code
// span closes only on a backtick run of its own length, link text nests, and a destination
// carries balanced parentheses. The link rewriter and the editor's highlighter read these
// rules instead of each carrying a copy - they walk the text differently on purpose, but
// they must never disagree about what a fence *is*. Indices are UTF-16 code units, as in
// every JS string API; every marker here is ASCII so that is safe.

export type FenceMarker = '`' | '~'

export interface Fence {
  marker: FenceMarker
  length: number
}

export interface Range {
  start: number
  end: number
}

export interface Destination {
  /** The destination token only, angle brackets included - link text and any title sit
   *  outside it, so a rewrite that splices there cannot disturb them. */
  range: Range
  raw: string
  /** Index just past the closing parenthesis. */
  end: number
}

const isSpace = (ch: string) => /\s/.test(ch)

/** Up to three leading spaces, then a run of at least three backticks or tildes. */
export function opensFence(line: string): Fence | null {
  let i = 0
  while (i < line.length && line[i] === ' ') i++
  if (i > 3) return null
  const marker = line[i]
  if (marker !== '`' && marker !== '~') return null
  let length = 0
  while (line[i + length] === marker) length++
  return length >= 3 ? { marker, length } : null
}

/** A closer matches the opener's character, runs at least as long, and carries nothing but
 *  whitespace after it. */
export function closesFence(line: string, fence: Fence): boolean {
  let i = 0
  while (i < line.length && line[i] === ' ') i++
  if (i > 3) return false
  let run = 0
  while (line[i + run] === fence.marker) run++
  if (run < fence.length) return false
  for (let j = i + run; j < line.length; j++) if (!isSpace(line[j])) return false
  return true
}

/** A code span closes on a backtick run of exactly the opening run's length. An unmatched
 *  run is literal text, so scanning resumes right after it. Returns the index to resume at. */
export function skippingCodeSpan(text: string, index: number): number {
  let scan = index
  let opening = 0
  while (scan < text.length && text[scan] === '`') {
    opening++
    scan++
  }
  let search = scan
  while (search < text.length) {
    if (text[search] !== '`') {
      search++
      continue
    }
    let end = search
    let run = 0
    while (end < text.length && text[end] === '`') {
      run++
      end++
    }
    if (run === opening) return end
    search = end
  }
  return scan
}

/** Whether the run at `index` actually closed. The highlighter colours a closed span and
 *  leaves an unmatched run as prose; the rewriter only needs to know where to resume. */
export function closedCodeSpan(text: string, index: number): Range | null {
  let scan = index
  while (scan < text.length && text[scan] === '`') scan++
  const end = skippingCodeSpan(text, index)
  return end > scan ? { start: index, end } : null
}

/** The `]` closing the `[` at `open`, honouring nesting, escapes and code spans. */
export function matchingBracket(text: string, open: number): number | null {
  let depth = 1
  let index = open + 1
  while (index < text.length) {
    const ch = text[index]
    if (ch === '\\') {
      index += 2
      continue
    }
    if (ch === '`') {
      index = skippingCodeSpan(text, index)
      continue
    }
    if (ch === '[') depth++
    if (ch === ']') {
      depth--
      if (depth === 0) return index
    }
    index++
  }
  return null
}

/** Parses `(dest)` or `(dest "title")` starting at the opening parenthesis. */
export function parsingDestination(text: string, paren: number): Destination | null {
  let index = skippingSpaces(text, paren + 1)
  if (index >= text.length) return null

  let range: Range
  let raw: string

  if (text[index] === '<') {
    const start = index
    let scan = index + 1
    while (scan < text.length && text[scan] !== '>') {
      scan += text[scan] === '\\' ? 2 : 1
    }
    if (scan >= text.length) return null
    raw = text.slice(start + 1, scan)
    index = scan + 1
    range = { start, end: index }
  } else {
    const start = index
    let depth = 0
    while (index < text.length) {
      const ch = text[index]
      if (ch === '\\') {
        index += 2
        continue
      }
      if (isSpace(ch)) break
      if (ch === '(') depth++
      if (ch === ')') {
        if (depth === 0) break
        depth--
      }
      index++
    }
    if (index > text.length) index = text.length
    raw = text.slice(start, index)
    range = { start, end: index }
  }

  index = skippingSpaces(text, index)
  index = skippingTitle(text, index)
  index = skippingSpaces(text, index)

  if (index >= text.length || text[index] !== ')') return null
  return { range, raw, end: index + 1 }
}

export function skippingSpaces(text: string, index: number): number {
  let scan = index
  while (scan < text.length && isSpace(text[scan])) scan++
  return scan
}

/** Past a `"title"`, `'title'` or `(title)` if one starts at `index`, else `index`. */
export function skippingTitle(text: string, index: number): number {
  if (index >= text.length) return index
  const closer = { '"': '"', "'": "'", '(': ')' }[text[index]]
  if (!closer) return index
  let scan = index + 1
  while (scan < text.length && text[scan] !== closer) {
    scan += text[scan] === '\\' ? 2 : 1
  }
  return scan < text.length ? scan + 1 : index
}
