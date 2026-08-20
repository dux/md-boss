// The raw pane's CodeMirror 6 setup. One small surface - set text, read text, focus - so
// the pane component and the manager never touch CodeMirror types. Highlighting, the
// markdown keymap and scroll sync land in the following P4 tasks.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { markdownHighlight } from './highlight'
import { markdownKeymap } from './markdownKeymap'
import { notesExtension, setLandingLine, setNotes } from './notesGutter'
import type { Edit } from '../models/noteShift'

export interface EditorOptions {
  parent: HTMLElement
  text: string
  fontSize: number
  /** False for a CSV: the pane still shows its text, but nothing in it is a heading, and
   *  colouring a quoted field because it holds an asterisk is worse than plain text. */
  highlight: boolean
  /** Every document change, with the whole text - the manager compares it with what was
   *  saved, which is the one thing the dirty flag is - and the replacement that made it, in
   *  old-text offsets, so notes can follow their lines. Several changes in one transaction
   *  (multiple cursors) are reported as the one span that covers them all. */
  onChange(text: string, edit: Edit): void
  /** The caret moved: its 1-based line and that line's text. `navigated` is false when the
   *  whole text was swapped in rather than the reader moving. */
  onCursor(line: number, text: string, navigated: boolean): void
  /** A right-click, in viewport coordinates, on a line. */
  onContextMenu(x: number, y: number, line: number): void
  /** The user scrolled: the source line at the top of the viewport, fractional within
   *  that line; one past the last line at the very end. Not fired while following. */
  onScroll(line: number): void
}

export interface Editor {
  setText(text: string): void
  getText(): string
  setFontSize(size: number): void
  setHighlight(on: boolean): void
  /** Puts a source line (fractional) at the top of the viewport; past the end goes to the
   *  bottom, where the preview is when it says so. */
  scrollToLine(line: number): void
  /** Brings a line into view (centred) and puts the caret on it - a note jump. */
  revealLine(line: number): void
  /** Line -> hover text for the gutter dots. */
  setNotes(notes: Map<number, string>): void
  /** The band on the line a jump landed on; null clears it. */
  setLandingLine(line: number | null): void
  focus(): void
  destroy(): void
}

/** Every automatic substitution off is the whole reason the Swift app used NSTextView; in
 *  a contenteditable the equivalents are attributes on the content element. */
const contentAttributes = EditorView.contentAttributes.of({
  spellcheck: 'false',
  autocorrect: 'off',
  autocapitalize: 'off',
})

/** Chrome and colours come from the theme tokens, so a theme switch is a CSS-var change.
 *  Line numbers recede further than muted text: the eye should land on the line. */
const chrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': { padding: '20px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--muted)',
    border: 'none',
    opacity: '0.7',
    fontSize: '0.8em',
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '30px', padding: '0 8px 0 12px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
})

/** Every kind maps onto a token the preview already uses for the same construct, so the
 *  pane and the page are drawing one palette. Block-level kinds first and inline ones
 *  after: spans overlap (the bold inside a heading), both classes land on the text, and the
 *  later rule is the one that wins the colour - the same "later spans win" the Swift
 *  highlighter had. Bold and italic are font traits on a monospace face, which may have no
 *  italic; the browser synthesises one, which is the right answer, not a failure. */
const syntax = EditorView.theme({
  '.md-headingMarker': { color: 'var(--muted)', fontWeight: 'bold' },
  '.md-headingText': { color: 'var(--accent)', fontWeight: 'bold' },
  '.md-quoteMarker': { color: 'var(--quote-bar)' },
  '.md-quoteText': { color: 'var(--quote-text)', fontStyle: 'italic' },
  '.md-listMarker, .md-taskMarker': { color: 'var(--accent)' },
  '.md-rule': { color: 'var(--rule)' },
  '.md-emphasis': { fontStyle: 'italic' },
  '.md-strong': { fontWeight: 'bold' },
  '.md-strikethrough': { color: 'var(--muted)', textDecoration: 'line-through' },
  '.md-linkText': { color: 'var(--link)' },
  '.md-fenceMarker, .md-fenceInfo, .md-imageBang, .md-linkBracket, .md-linkDestination': { color: 'var(--muted)' },
  '.md-codeBlock, .md-codeSpan': { color: 'var(--hl-string)' },
})

const fontSizeTheme = (size: number): Extension =>
  EditorView.theme({ '&': { fontSize: `${size}px` } })

const highlightExtension = (on: boolean): Extension => (on ? [markdownHighlight(), syntax] : [])

/** Marks the transaction that swaps a whole document in, so the caret report that follows
 *  is not mistaken for the reader moving off a line. */
const swapAnnotation = Annotation.define<boolean>()

/** How long the pane's own scroll events are ignored after it was scrolled by code. A
 *  programmatic scroll lands on the next frame and would otherwise read as the user. */
const SETTLE_MS = 120

/** Where the top of the document sits in scroll coordinates - the content padding. */
const contentTop = (view: EditorView) =>
  view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop

/** The source line at the top of the viewport, fractional within that line. At the end of
 *  the file, past the last line: the preview's tall bottom padding means its last block sits
 *  well above its own end, and both panes being at the bottom together is what reads as
 *  correct. */
function topVisibleLine(view: EditorView): number {
  const scroller = view.scrollDOM
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) return view.state.doc.lines + 1
  const height = scroller.scrollTop - contentTop(view)
  const block = view.lineBlockAtHeight(height)
  const line = view.state.doc.lineAt(block.from).number
  const progress = block.height > 0 ? (height - block.top) / block.height : 0
  return line + Math.min(1, Math.max(0, progress))
}

function scrollTopFor(view: EditorView, line: number): number {
  const scroller = view.scrollDOM
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const whole = Math.floor(line)
  if (whole > view.state.doc.lines) return max
  const block = view.lineBlockAt(view.state.doc.line(Math.max(1, whole)).from)
  const progress = Math.min(1, Math.max(0, line - whole))
  return Math.min(max, Math.max(0, block.top + block.height * progress + contentTop(view)))
}

export function createEditor(options: EditorOptions): Editor {
  const font = new Compartment()
  const highlight = new Compartment()
  let suppressUntil = 0
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        contentAttributes,
        chrome,
        font.of(fontSizeTheme(options.fontSize)),
        highlight.of(highlightExtension(options.highlight)),
        markdownKeymap,
        notesExtension(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            let from = Infinity, to = -Infinity, fromB = Infinity, toB = -Infinity
            update.changes.iterChanges((fA, tA, fB, tB) => {
              from = Math.min(from, fA)
              to = Math.max(to, tA)
              fromB = Math.min(fromB, fB)
              toB = Math.max(toB, tB)
            })
            options.onChange(update.state.doc.toString(), { start: from, end: to, length: toB - fromB })
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            // A whole-text swap selects nothing by hand: it is setText's transaction.
            options.onCursor(line.number, line.text, !update.transactions.some((tr) => tr.annotation(swapAnnotation)))
          }
        }),
        EditorView.domEventHandlers({
          contextmenu(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos === null) return false
            event.preventDefault()
            options.onContextMenu(event.clientX, event.clientY, view.state.doc.lineAt(pos).number)
            return true
          },
        }),
      ],
    }),
  })

  let scrollFrame: number | null = null
  view.scrollDOM.addEventListener('scroll', () => {
    if (performance.now() < suppressUntil || scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      options.onScroll(topVisibleLine(view))
    })
  }, { passive: true })

  return {
    scrollToLine(line) {
      suppressUntil = performance.now() + SETTLE_MS
      view.scrollDOM.scrollTop = scrollTopFor(view, line)
    },
    setText(text) {
      const current = view.state.doc.toString()
      if (current === text) return
      view.dispatch({ changes: { from: 0, to: current.length, insert: text }, annotations: swapAnnotation.of(true) })
    },
    revealLine(line) {
      const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
      suppressUntil = performance.now() + SETTLE_MS
      view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
        annotations: swapAnnotation.of(true),
      })
    },
    setNotes(notes) {
      view.dispatch({ effects: setNotes.of(notes) })
    },
    setLandingLine(line) {
      view.dispatch({ effects: setLandingLine.of(line) })
    },
    getText: () => view.state.doc.toString(),
    setFontSize(size) {
      view.dispatch({ effects: font.reconfigure(fontSizeTheme(size)) })
    },
    setHighlight(on) {
      view.dispatch({ effects: highlight.reconfigure(highlightExtension(on)) })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
