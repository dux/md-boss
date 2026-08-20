// Note markers down the left edge of the raw pane, and the band on the line a jump landed
// on. Both are fed from outside (the annotation store, the manager) through effects, so
// the editor never reads app state itself.

import { type Extension, RangeSet, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view'

/** Line -> hover text, as the store answers for one document. */
export const setNotes = StateEffect.define<Map<number, string>>()
export const setLandingLine = StateEffect.define<number | null>()

class NoteDot extends GutterMarker {
  constructor(private readonly tooltip: string) {
    super()
  }

  override eq(other: NoteDot): boolean {
    return other.tooltip === this.tooltip
  }

  override toDOM(): Node {
    const dot = document.createElement('span')
    dot.className = 'cm-note-dot'
    dot.title = this.tooltip
    return dot
  }
}

/** Kept as a map rather than a RangeSet: line numbers are what the store speaks, and
 *  mapping them through document changes is the store's job (noteShift), not the gutter's.
 *  The gutter asks per visible line, so a map lookup is the cheap answer. */
const notesField = StateField.define<Map<number, string>>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setNotes)) return e.value
    return value
  },
})

const landingField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLandingLine)) return e.value
    return value
  },
})

const landingMark = Decoration.line({ class: 'cm-landing' })

const landingDecorations = EditorView.decorations.compute([landingField], (state) => {
  const line = state.field(landingField)
  if (line === null || line < 1 || line > state.doc.lines) return Decoration.none
  return RangeSet.of([landingMark.range(state.doc.line(line).from)])
})

const noteGutter = gutter({
  class: 'cm-notes',
  lineMarker(view, line) {
    const notes = view.state.field(notesField)
    const number = view.state.doc.lineAt(line.from).number
    const tooltip = notes.get(number)
    return tooltip === undefined ? null : new NoteDot(tooltip)
  },
  lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setNotes))),
  initialSpacer: () => new NoteDot(''),
})

const gutterTheme = EditorView.theme({
  '.cm-notes .cm-gutterElement': { width: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-note-dot': { width: '4px', height: '4px', borderRadius: '2px', background: 'var(--accent)', display: 'block' },
  '.cm-landing': { backgroundColor: 'var(--selection)' },
})

export const notesExtension = (): Extension => [notesField, landingField, landingDecorations, noteGutter, gutterTheme]

export type NoteDecorations = DecorationSet
