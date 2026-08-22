// How a line-anchored note moves when the text under it is edited. A note marks a whole
// line, so what it really anchors to is that line's start offset - which makes the rule the
// one a text marker follows: an edit entirely at or before the anchor slides it, an edit
// after it leaves it alone, and an edit that swallows it drops it back to where the edit
// began. Insertion *exactly* at the anchor slides it, so pressing Enter at the head of a
// noted line takes the note down with its text rather than leaving it behind on the new
// blank line.

import type { LineIndex } from './lineIndex'

/** One replacement, in UTF-16 offsets against the text *before* it happened. */
export interface Edit {
  start: number
  end: number
  /** Length of what went in. */
  length: number
}

export const editDelta = (edit: Edit) => edit.length - (edit.end - edit.start)

export function shiftOffset(anchor: number, edit: Edit): number {
  if (edit.end <= anchor) return anchor + editDelta(edit)
  if (edit.start >= anchor) return anchor
  return edit.start
}

/** The line a note lands on, read back out of the new text rather than counted as a delta.
 *  That is what gets a same-length replacement right: swapping two characters for a newline
 *  and a character moves no offset, but everything below it gains a line. Null when the old
 *  line was already out of range. */
export function shiftLine(line: number, from: LineIndex, to: LineIndex, edit: Edit): number | null {
  const range = from.rangeOfLine(line)
  if (!range) return null
  return to.lineAt(shiftOffset(range.start, edit))
}
