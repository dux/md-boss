// Cmd-B, Cmd-I and Cmd-K as text edits over a document. Offsets are UTF-16 units.

import type { Range } from './markdownScan'

export interface Edit {
  /** What to replace, over the whole document. */
  range: Range
  replacement: string
  /** Where the selection lands afterwards, over the document as it will then be. */
  selection: Range
}

const span = (start: number, length: number): Range => ({ start, end: start + length })

/** Wraps the selection in `marker`, or unwraps it when it is already wrapped. Already
 *  wrapped counts both ways: markers just outside the selection (`**|foo|**`) and markers
 *  inside it (`|**foo**|`). An empty selection takes the word under the caret, and with no
 *  word to take it leaves the caret between a fresh pair. */
export function toggling(text: string, selection: Range, marker: string): Edit {
  const target = selection.start === selection.end ? wordAt(text, selection.start) : selection
  const width = marker.length
  const targetLength = target.end - target.start

  // `|**foo**|` - the markers were selected along with the text.
  if (
    targetLength >= 2 * width &&
    text.slice(target.start, target.start + width) === marker &&
    text.slice(target.end - width, target.end) === marker
  ) {
    const inner = text.slice(target.start + width, target.end - width)
    return { range: target, replacement: inner, selection: span(target.start, inner.length) }
  }

  // `**|foo|**` - the markers sit just outside.
  if (
    target.start >= width && target.end + width <= text.length &&
    text.slice(target.start - width, target.start) === marker &&
    text.slice(target.end, target.end + width) === marker
  ) {
    const outer = span(target.start - width, targetLength + 2 * width)
    return { range: outer, replacement: text.slice(target.start, target.end), selection: span(outer.start, targetLength) }
  }

  // Trailing space inside the markers is not emphasis in CommonMark - `**foo **` renders
  // literally - so whitespace at either end migrates outside them.
  const trimmed = trimming(text, target)
  const body = text.slice(trimmed.start, trimmed.end)
  const lead = text.slice(target.start, trimmed.start)
  const tail = text.slice(trimmed.end, target.end)
  return {
    range: target,
    replacement: lead + marker + body + marker + tail,
    selection: span(trimmed.start + lead.length + width, body.length),
  }
}

/** `[text](url)`, filling in whichever half it can. A URL on the clipboard becomes the
 *  destination and the caret lands past the link. A selection that is itself a URL becomes
 *  the destination instead, with the caret in the empty brackets where the text goes. */
export function link(text: string, selection: Range, clipboard: string | null): Edit {
  const target = selection.start === selection.end ? wordAt(text, selection.start) : selection
  const body = text.slice(target.start, target.end)

  if (clipboard !== null && isURL(clipboard)) {
    const replacement = `[${body}](${clipboard})`
    return { range: target, replacement, selection: span(target.start + replacement.length, 0) }
  }
  if (isURL(body)) {
    // Between the brackets, which is the half still missing.
    return { range: target, replacement: `[](${body})`, selection: span(target.start + 1, 0) }
  }
  return { range: target, replacement: `[${body}]()`, selection: span(target.start + body.length + 3, 0) }
}

/** Deliberately narrow: a scheme and something after it. A bare `example.com` on the
 *  clipboard is far more often prose than a link anyone meant to paste. */
export function isURL(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
}

/** The word under the caret, or an empty range where it stands when there is none. */
function wordAt(text: string, location: number): Range {
  let start = Math.min(location, text.length)
  let end = start
  while (start > 0 && isWordUnit(text[start - 1])) start--
  while (end < text.length && isWordUnit(text[end])) end++
  return { start, end }
}

// One UTF-16 unit at a time, as the editor's offsets are; a surrogate half is not a letter.
const isWordUnit = (ch: string) => /[\p{L}\p{N}_]/u.test(ch)

function trimming(text: string, range: Range): Range {
  let start = range.start
  let end = range.end
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return { start, end }
}
