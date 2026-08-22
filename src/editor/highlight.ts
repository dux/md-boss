// Paints MarkdownSyntax spans over the raw pane as CodeMirror mark decorations. Only the
// visible lines are decorated, rebuilt when the document or the viewport changes; the
// fence pass runs over the whole document because it is a predicate per line and costs
// nothing - typing ``` at the top really does change how the rest of the file reads.

import { type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { fenceStates, isInsideFence, LINE_CEILING, splitLines } from '../models/markdownHighlight'
import type { Fence } from '../models/markdownScan'
import { KINDS, scan, type Kind, type Span } from '../models/markdownSyntax'

/** One mark per kind; the class is what the theme in editor.ts colours. */
const marks: Record<Kind, Decoration> = Object.fromEntries(
  KINDS.map((kind) => [kind, Decoration.mark({ class: `md-${kind}` })]),
) as Record<Kind, Decoration>

class Highlighter {
  decorations: DecorationSet
  private fences: (Fence | null)[]

  /** Whether line `line` (1-based) sits inside a fenced block - what tells Return-in-a-list
   *  from Return-in-code. */
  isInsideFence(line: number): boolean {
    return isInsideFence(this.fences, line)
  }

  constructor(view: EditorView) {
    this.fences = fenceStates(splitLines(view.state.doc.toString()))
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.fences = fenceStates(splitLines(update.state.doc.toString()))
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
  }

  private build(view: EditorView): DecorationSet {
    const doc = view.state.doc
    if (doc.lines > LINE_CEILING) return Decoration.none
    const ranges: Range<Decoration>[] = []
    const spans: Span[] = []
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = doc.lineAt(pos)
        spans.length = 0
        scan(line.text, this.fences[line.number - 1] ?? null, spans)
        for (const span of spans) {
          if (span.end > span.start) ranges.push(marks[span.kind].range(line.from + span.start, line.from + span.end))
        }
        pos = line.to + 1
      }
    }
    // Spans overlap by design (a heading's text under the bold inside it), so the set is
    // sorted here rather than built in order.
    return Decoration.set(ranges, true)
  }
}

export const highlightPlugin = ViewPlugin.fromClass(Highlighter, { decorations: (plugin) => plugin.decorations })

export const markdownHighlight = (): Extension => highlightPlugin
