// What the raw pane colours, as spans over one line of source. Line by line, with the
// fence state handed in and back, because that is what makes an incremental highlight
// cheap: an edit re-scans the lines it touched, and only a fence forces the work below it.
// A construct split across a line break is not coloured - rare in writing, and a per-line
// answer that is right about the common case beats a document-wide one re-run from the top
// on every keystroke. Not handled, as in markdownLinks: setext headings, four-space
// indented code, reference definitions, HTML.

import {
  closedCodeSpan, closesFence, matchingBracket, opensFence, parsingDestination,
  skippingCodeSpan, type Fence,
} from './markdownScan'
import { markerEnd, taskEnd } from './markdownList'
import { typedBlockMarker } from './typedBlocks'

export const KINDS = [
  'headingMarker', 'headingText',
  'fenceMarker', 'fenceInfo', 'codeBlock', 'codeSpan',
  'emphasis', 'strong', 'strikethrough',
  'imageBang', 'linkBracket', 'linkText', 'linkDestination',
  'quoteMarker', 'quoteText',
  'listMarker', 'taskMarker',
  'componentMarker', 'componentType', 'componentAttribute',
  'rule',
] as const

export type Kind = (typeof KINDS)[number]

/** A run to paint, in UTF-16 units relative to the start of its own line. Spans may
 *  overlap, and later ones win: a heading emits `headingText` over its whole line and the
 *  inline pass then paints the `**bold**` inside it. */
export interface Span {
  start: number
  end: number
  kind: Kind
}

/** Every span on one line, appended to `spans`, given the fence open at its start. Returns
 *  the fence state after the line, which is what the caller carries to the next one. */
export function scan(line: string, fence: Fence | null, spans: Span[]): Fence | null {
  if (fence) {
    // A closer is still the fence's own punctuation, so it reads as the marker.
    const closes = closesFence(line, fence)
    append(spans, 0, line.length, closes ? 'fenceMarker' : 'codeBlock')
    return closes ? null : fence
  }

  const opened = opensFence(line)
  if (opened) {
    let i = 0
    while (line[i] === ' ') i++
    while (line[i] === opened.marker) i++
    append(spans, 0, i, 'fenceMarker')
    append(spans, i, line.length, 'fenceInfo')
    return opened
  }

  const component = typedBlockMarker(line)
  if (component) {
    append(spans, component.markerStart, component.markerEnd, 'componentMarker')
    if (component.kind === 'open') {
      append(spans, component.typeStart, component.typeEnd, 'componentType')
      if (component.attributesStart !== null) append(spans, component.attributesStart, line.trimEnd().length, 'componentAttribute')
    }
    return null
  }

  const prose = blockPrefix(line, spans)
  inline(line, prose, line.length, spans)
  return null
}

// MARK: - Block level

/** Everything a line carries before its prose - quote bars, a heading's hashes, a list
 *  bullet, a task box - plus the tint over what follows. Answers where the prose starts. */
function blockPrefix(line: string, spans: Span[]): number {
  let index = 0
  let quoted = false

  // `>` repeats: `> > a quoted quote`.
  for (;;) {
    let marker = index
    while (line[marker] === ' ') marker++
    if (line[marker] !== '>') break
    let end = marker + 1
    if (line[end] === ' ') end++
    append(spans, index, end, 'quoteMarker')
    index = end
    quoted = true
  }
  if (quoted) append(spans, index, line.length, 'quoteText')

  let start = index
  while (line[start] === ' ') start++
  if (start >= line.length) return line.length
  const body = line.slice(start)

  if (isRule(body)) {
    append(spans, start, line.length, 'rule')
    return line.length
  }

  let hashes = 0
  while (line[start + hashes] === '#') hashes++
  if (hashes >= 1 && hashes <= 6 && (start + hashes === line.length || line[start + hashes] === ' ')) {
    append(spans, start, start + hashes, 'headingMarker')
    append(spans, start + hashes, line.length, 'headingText')
    // Still scanned inline: `# The **plan**` is a heading with bold in it.
    return start + hashes
  }

  const afterMarker = markerEnd(line, start)
  if (afterMarker === null) return start
  append(spans, start, afterMarker, 'listMarker')

  const afterBox = taskEnd(line, afterMarker)
  if (afterBox === null) return afterMarker
  append(spans, afterMarker, afterBox, 'taskMarker')
  return afterBox
}

/** Three or more of `-`, `_` or `*`, and nothing else but spaces. */
function isRule(body: string): boolean {
  const marker = body[0]
  if (marker !== '-' && marker !== '_' && marker !== '*') return false
  let count = 0
  for (const ch of body) {
    if (ch === marker) count++
    else if (ch !== ' ' && ch !== '\t') return false
  }
  return count >= 3
}

// MARK: - Inline

function inline(line: string, start: number, end: number, spans: Span[]): void {
  let index = start
  while (index < end) {
    const ch = line[index]
    if (ch === '\\') index = Math.min(index + 2, end)
    else if (ch === '`') index = code(line, index, end, spans)
    else if (ch === '[' || ch === '!') index = link(line, index, end, spans)
    else if (ch === '*' || ch === '_' || ch === '~') index = delimited(line, index, end, spans)
    else index++
  }
}

/** An unmatched backtick run is literal text, so it is skipped rather than painted. */
function code(line: string, index: number, end: number, spans: Span[]): number {
  const span = closedCodeSpan(line, index)
  if (!span || span.end > end) return Math.min(skippingCodeSpan(line, index), end)
  append(spans, span.start, span.end, 'codeSpan')
  return span.end
}

function link(line: string, index: number, end: number, spans: Span[]): number {
  const image = line[index] === '!'
  const open = image ? index + 1 : index
  const next = index + 1

  if (open >= end || line[open] !== '[') return next
  const close = matchingBracket(line, open)
  if (close === null || close >= end) return next

  const paren = close + 1
  if (paren >= end || line[paren] !== '(') return next
  const parsed = parsingDestination(line, paren)
  if (!parsed || parsed.end > end) return next

  if (image) append(spans, index, open, 'imageBang')
  append(spans, open, open + 1, 'linkBracket')
  append(spans, open + 1, close, 'linkText')
  append(spans, close, parsed.range.start, 'linkBracket')
  append(spans, parsed.range.start, parsed.range.end, 'linkDestination')
  append(spans, parsed.range.end, parsed.end, 'linkBracket')

  // Link text can hold emphasis or an image of its own.
  inline(line, open + 1, close, spans)
  return parsed.end
}

/** A `*`, `_` or `~` run pairs with the next run of its own length on the same line. Not
 *  CommonMark's full flanking rule, which needs the whole document: a run followed by
 *  whitespace opens nothing, a run preceded by whitespace closes nothing, and `_` inside a
 *  word is a word - `snake_case` is not italics. */
function delimited(line: string, index: number, end: number, spans: Span[]): number {
  const marker = line[index]
  let runEnd = index
  while (runEnd < end && line[runEnd] === marker) runEnd++
  const length = runEnd - index

  // A rule was handled at block level, so a run of three here is `***bold italic***`.
  if (length > 3) return runEnd
  // `~` is strikethrough and only ever doubled.
  if (marker === '~' && length !== 2) return runEnd
  if (runEnd >= end || isSpace(line[runEnd])) return runEnd
  if (marker === '_' && index > 0 && isWordCharacter(codePointBefore(line, index))) return runEnd

  let search = runEnd
  while (search < end) {
    if (line[search] === '\\') {
      search = Math.min(search + 2, end)
      continue
    }
    if (line[search] !== marker) {
      search++
      continue
    }
    let closeEnd = search
    while (closeEnd < end && line[closeEnd] === marker) closeEnd++
    if (closeEnd - search === length && !isSpace(line[search - 1])) {
      const kind: Kind = marker === '~' ? 'strikethrough' : length >= 2 ? 'strong' : 'emphasis'
      append(spans, index, closeEnd, kind)
      inline(line, runEnd, search, spans)
      return closeEnd
    }
    search = closeEnd
  }
  return runEnd
}

const isSpace = (ch: string) => /\s/.test(ch)
const isWordCharacter = (ch: string) => /[\p{L}\p{N}]/u.test(ch)

/** The code point ending at `index`, so a `_` after an emoji sees the emoji. */
function codePointBefore(text: string, index: number): string {
  const unit = text.charCodeAt(index - 1)
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) return text.slice(index - 2, index)
  return text[index - 1]
}

/** An empty range is dropped rather than painted. */
function append(spans: Span[], start: number, end: number, kind: Kind): void {
  if (start < end) spans.push({ start, end, kind })
}
