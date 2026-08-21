// The raw pane's CodeMirror 6 setup. One small surface - set text, read text, focus - so
// the pane component and the manager never touch CodeMirror types. Highlighting, the
// markdown keymap and scroll sync land in the following P4 tasks.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { markdownHighlight } from './highlight'
import { applyFormat, type Format, markdownKeymap } from './markdownKeymap'
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
  /** What an HTML5 drop at a document offset would insert - asked while the drag is over
   *  the text, to accept it, and again on the drop, to insert. Null leaves the drag to
   *  CodeMirror: the pane knows what the sidebar is dragging, the editor does not. A drop
   *  carrying OS files is never CodeMirror's either way: it would paste their contents,
   *  and the paths arrive through the native drag event instead. */
  dropText(pos: number): string | null
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
  /** Cmd-F: the find panel, open and focused. */
  openSearch(): void
  /** Bold / Italic / Link from the menu bar; the keys go through the keymap directly. */
  format(format: Format): void
  /** A native (OS) file drag over the pane, in viewport coordinates: the caret follows the
   *  pointer while it is over the text, as the NSTextView's did, and goes back where it
   *  was if the drag leaves without dropping. */
  dragOver(x: number, y: number): void
  dragLeave(): void
  /** The drop: `text` goes in under the pointer, the caret lands after it, the pane takes
   *  focus - what a drop into a text view has always done. */
  drop(x: number, y: number, text: string): void
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

/** The find panel, at the top of the pane where the NSTextView find bar was, in the
 *  chrome's sans and sizes rather than the editor's mono. CodeMirror's own panel colours
 *  are the `&light` / `&dark` greys, which match none of the eight palettes; every one
 *  is replaced with a token. Matches are an accent wash, the current one a stronger one. */
const searchPanel = EditorView.theme({
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: '-apple-system, system-ui, sans-serif',
    fontSize: 'var(--font-buttons)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '5px 28px 5px 10px' },
  '.cm-panel.cm-search .cm-textfield': {
    padding: '3px 7px',
    border: '1px solid var(--border-strong)',
    borderRadius: '5px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    font: 'inherit',
    outline: 'none',
  },
  '.cm-panel.cm-search .cm-textfield:focus': { borderColor: 'var(--accent)' },
  '.cm-panel.cm-search .cm-button': {
    padding: '3px 9px',
    border: '1px solid var(--border-strong)',
    borderRadius: '5px',
    backgroundColor: 'var(--bg)',
    backgroundImage: 'none',
    color: 'var(--text)',
    font: 'inherit',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search .cm-button:active': { backgroundColor: 'var(--selection)', backgroundImage: 'none' },
  '.cm-panel.cm-search label': { color: 'var(--muted)', fontSize: 'var(--font-small)' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
  '.cm-panel.cm-search [name=close]': { top: '4px', right: '8px', color: 'var(--muted)', fontSize: '1.3em', cursor: 'pointer' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' },
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

/** A drop's text into the document, the caret after it, the editor focused. */
function insertAt(view: EditorView, pos: number, text: string): void {
  view.focus()
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    scrollIntoView: true,
    userEvent: 'input.drop',
  })
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
        dropCursor(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        contentAttributes,
        chrome,
        searchPanel,
        search({ top: true }),
        font.of(fontSizeTheme(options.fontSize)),
        highlight.of(highlightExtension(options.highlight)),
        markdownKeymap,
        notesExtension(),
        keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
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
          // A drag the pane has text for is accepted here; the browser only delivers a drop
          // where dragover was claimed, and a private data type is not one a contenteditable
          // claims by itself.
          dragover(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ?? view.state.doc.length
            if (options.dropText(pos) === null) return false
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
            return true
          },
          // Before CodeMirror's own drop handler: true here is "handled", and the event
          // goes no further.
          drop(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ?? view.state.doc.length
            const text = options.dropText(pos)
            if (text !== null) {
              event.preventDefault()
              insertAt(view, pos, text)
              return true
            }
            return (event.dataTransfer?.files.length ?? 0) > 0
          },
        }),
      ],
    }),
  })

  // Where the caret was before a native drag moved it, put back if the drag leaves.
  let selectionBeforeDrag: number | null = null

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
    openSearch() {
      openSearchPanel(view)
    },
    format(format) {
      applyFormat(view, format)
      view.focus()
    },
    dragOver(x, y) {
      const pos = view.posAtCoords({ x, y }, false)
      if (pos === null) return
      if (selectionBeforeDrag === null) selectionBeforeDrag = view.state.selection.main.head
      if (view.state.selection.main.head !== pos || !view.state.selection.main.empty) {
        view.dispatch({ selection: { anchor: pos }, annotations: swapAnnotation.of(true) })
      }
    },
    dragLeave() {
      if (selectionBeforeDrag === null) return
      const pos = Math.min(selectionBeforeDrag, view.state.doc.length)
      selectionBeforeDrag = null
      view.dispatch({ selection: { anchor: pos }, annotations: swapAnnotation.of(true) })
    },
    drop(x, y, text) {
      selectionBeforeDrag = null
      insertAt(view, view.posAtCoords({ x, y }, false) ?? view.state.doc.length, text)
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
