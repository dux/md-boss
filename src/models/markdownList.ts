// What Return does on a line that is already part of a list or a quote. Pure, so every
// rule here is tested without an editor. The caller supplies whether the line is inside a
// fenced block - the highlighter already keeps that answer, and a `- ` inside ``` is code,
// not a bullet.

export type Marker =
  | { type: 'bullet'; char: string }
  | { type: 'ordered'; number: number; delimiter: string }

/** What the *next* item's marker reads as. Ordered lists increment rather than renumbering
 *  what follows: renumbering rewrites lines nobody touched, makes one undo step span the
 *  whole list, and CommonMark renders `1. 1. 1.` correctly anyway. */
export function nextMarker(marker: Marker): string {
  return marker.type === 'bullet' ? `${marker.char} ` : `${marker.number + 1}${marker.delimiter} `
}

/** Everything before an item's text, kept verbatim so a continuation lines up under it. */
export interface Prefix {
  /** Leading spaces, exactly as written. */
  indent: string
  /** The `> ` runs, exactly as written. A quote can carry a list and vice versa. */
  quotes: string
  marker: Marker | null
  /** Whether the item carried a `[ ]`, `[x]` or `[*]` box. */
  isTask: boolean
  /** UTF-16 offset where the item's own text starts. */
  contentStart: number
  /** Nothing but whitespace after the marker. */
  isEmpty: boolean
}

/** What to open the next line with. A task always continues unchecked - carrying `[x]`
 *  forward would tick a box nobody has done. */
export function continuationOf(prefix: Prefix): string {
  return prefix.indent + prefix.quotes + (prefix.marker ? nextMarker(prefix.marker) : '') + (prefix.isTask ? '[ ] ' : '')
}

/** Where a `- `, `* `, `+ `, `1. ` or `1) ` marker starting at `start` ends, or null.
 *  Shared with the syntax scanner, which needs the same answer to paint the marker. */
export function markerEnd(text: string, start: number): number | null {
  const first = text[start]
  if (first === undefined) return null
  if (first === '-' || first === '*' || first === '+') {
    return text[start + 1] === ' ' ? start + 2 : null
  }
  let digits = 0
  while (/[0-9]/.test(text[start + digits] ?? '')) digits++
  if (digits === 0 || digits > 9) return null
  const delimiter = text[start + digits]
  if (delimiter !== '.' && delimiter !== ')') return null
  return text[start + digits + 1] === ' ' ? start + digits + 2 : null
}

/** Where a `[ ]`, `[x]` or `[*]` box starting at `start` ends, when one follows the marker. */
export function taskEnd(text: string, start: number): number | null {
  if (text[start] !== '[') return null
  if (!' xX*'.includes(text[start + 1] ?? '\0')) return null
  if (text[start + 2] !== ']') return null
  if (text[start + 3] !== ' ') return null
  return start + 4
}

/** Null when the line opens nothing that Return should carry forward. */
export function prefixOf(line: string): Prefix | null {
  let index = 0
  while (line[index] === ' ') index++
  const indent = line.slice(0, index)

  let quotes = ''
  while (line[index] === '>') {
    let end = index + 1
    if (line[end] === ' ') end++
    quotes += line.slice(index, end)
    index = end
  }

  // Indentation after the quote bars belongs to the list, not to the quote.
  const innerStart = index
  while (line[index] === ' ') index++
  const inner = line.slice(innerStart, index)

  let marker: Marker | null = null
  let isTask = false
  const end = markerEnd(line, index)
  if (end !== null) {
    marker = parseMarker(line.slice(index, end))
    index = end
    const boxed = taskEnd(line, index)
    if (boxed !== null) {
      isTask = true
      index = boxed
    }
  }

  if (marker === null && quotes === '') return null

  return {
    indent: indent + inner,
    quotes,
    marker,
    isTask,
    contentStart: index,
    isEmpty: /^\s*$/.test(line.slice(index)),
  }
}

function parseMarker(token: string): Marker | null {
  const first = token[0]
  if (first === '-' || first === '*' || first === '+') return { type: 'bullet', char: first }
  const m = /^([0-9]+)([.)])/.exec(token)
  return m ? { type: 'ordered', number: Number(m[1]), delimiter: m[2] } : null
}

export type Continuation =
  /** Let the editor insert the newline it was going to. */
  | { type: 'none' }
  /** A newline plus the reconstructed prefix. */
  | { type: 'insert'; text: string }
  /** An empty item sheds its marker instead of growing another one - the standard way out
   *  of a list. `length` counts from the start of the line. */
  | { type: 'clear'; length: number }

/** caretColumn is the UTF-16 offset of the caret within `line`; insideFence says a `- `
 *  there is code, and Return is just a newline. */
export function continuation(line: string, caretColumn: number, insideFence: boolean): Continuation {
  if (insideFence) return { type: 'none' }
  const prefix = prefixOf(line)
  if (!prefix) return { type: 'none' }
  // Return with the caret still inside the marker splits the line rather than continuing
  // it - there is no item yet to continue.
  if (caretColumn < prefix.contentStart) return { type: 'none' }
  if (prefix.isEmpty) return { type: 'clear', length: prefix.contentStart }
  return { type: 'insert', text: '\n' + continuationOf(prefix) }
}
