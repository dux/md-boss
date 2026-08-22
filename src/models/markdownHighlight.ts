// What the raw pane's highlighter knows outside CodeMirror: the fence open at the start of
// every line, and how far an edit's change in fence state reaches. Port of the line and
// fence bookkeeping in MarkdownHighlighter.swift; the painting is src/editor/highlight.ts.

import { closesFence, opensFence, type Fence } from './markdownScan'

/** Past this many lines the pane stays plain text. A file this size is not being read in a
 *  markdown editor, and a stutter on every keystroke is worse than no colour at all. */
export const LINE_CEILING = 20_000

/** Split on `\n` only, matching LineIndex exactly - OpenDocument normalises CRLF on load,
 *  and a lone `\r` must not shift the numbering the notes are anchored to. */
export const splitLines = (text: string) => text.split('\n')

/** The fence open at the start of each line, one entry per line. The single copy of "am I
 *  inside a fence" - what decides how far a re-highlight has to reach, and what tells
 *  Return-in-a-list from Return-in-code. */
export function fenceStates(lines: readonly string[]): (Fence | null)[] {
  const states: (Fence | null)[] = new Array(lines.length)
  let open: Fence | null = null
  for (let i = 0; i < lines.length; i++) {
    states[i] = open
    if (open) {
      if (closesFence(lines[i], open)) open = null
    } else {
      open = opensFence(lines[i])
    }
  }
  return states
}

const sameFence = (a: Fence | null, b: Fence | null) =>
  a === b || (a !== null && b !== null && a.marker === b.marker && a.length === b.length)

/** The first line (0-based) whose fence state moved, or -1 when nothing below the edit
 *  reads differently. A change in line count alone still counts from the shorter end. */
export function divergence(old: readonly (Fence | null)[], next: readonly (Fence | null)[]): number {
  const shared = Math.min(old.length, next.length)
  for (let i = 0; i < shared; i++) if (!sameFence(old[i], next[i])) return i
  return old.length === next.length ? -1 : shared
}

/** Whether line `line` (1-based) sits inside a fenced block. */
export const isInsideFence = (fences: readonly (Fence | null)[], line: number) =>
  line >= 1 && line <= fences.length && fences[line - 1] !== null
