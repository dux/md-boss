// Return, Cmd-B, Cmd-I and Cmd-K in the raw pane. The rules are the pure models
// (markdownList, markdownWrap); this file turns their answers into transactions. The
// transaction builders take an EditorState rather than a view so they are testable
// without a DOM; the commands at the bottom are the thin CodeMirror wrappers.

import { insertNewline } from '@codemirror/commands'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { continuation } from '../models/markdownList'
import { link, toggling, type Edit } from '../models/markdownWrap'
import { native } from '../native/bridge'
import { highlightPlugin } from './highlight'

/** Return on a list or a quote carries the marker down; an empty item sheds it. Null when
 *  the editor should insert the newline it was going to - a Return over a selection is a
 *  deletion first, a Return inside a fence is code. */
export function continuationSpec(state: EditorState, insideFence: (line: number) => boolean): TransactionSpec | null {
  const { main } = state.selection
  if (!main.empty) return null
  const line = state.doc.lineAt(main.head)
  const next = continuation(line.text, main.head - line.from, insideFence(line.number))
  switch (next.type) {
    case 'none':
      return null
    case 'insert':
      return {
        changes: { from: main.head, insert: next.text },
        selection: EditorSelection.cursor(main.head + next.text.length),
        userEvent: 'input',
      }
    case 'clear':
      return {
        changes: { from: line.from, to: line.from + next.length },
        selection: EditorSelection.cursor(line.from),
        userEvent: 'delete',
      }
  }
}

export type Format = 'bold' | 'italic' | 'link'

/** One Edit over the whole document becomes one transaction. */
export function formatSpec(state: EditorState, format: Format, clipboard: string | null): TransactionSpec {
  const { main } = state.selection
  const text = state.doc.toString()
  const selection = { start: main.from, end: main.to }
  let edit: Edit
  switch (format) {
    case 'bold':
      edit = toggling(text, selection, '**')
      break
    case 'italic':
      edit = toggling(text, selection, '_')
      break
    case 'link':
      edit = link(text, selection, clipboard)
      break
  }
  return {
    changes: { from: edit.range.start, to: edit.range.end, insert: edit.replacement },
    selection: EditorSelection.range(edit.selection.start, edit.selection.end),
    userEvent: 'input',
  }
}

// MARK: - Commands

/** Nothing in a CSV is a list: without the highlighter (plain documents) Return is a
 *  newline, and a row that happens to start with `- ` must not gain a bullet. */
const continueList: Command = (view) => {
  const highlighter = view.plugin(highlightPlugin)
  if (!highlighter) return false
  const spec = continuationSpec(view.state, (line) => highlighter.isInsideFence(line))
  if (!spec) return false
  view.dispatch(spec)
  return true
}

const formatCommand = (format: Format): Command => (view) => {
  view.dispatch(formatSpec(view.state, format, null))
  return true
}

/** The clipboard is read here and passed in, so the rule itself stays pure. Async, so the
 *  command answers true and the edit lands a tick later. */
const linkCommand: Command = (view: EditorView) => {
  void native().clipboard.readText().then((clipboard) => {
    view.dispatch(formatSpec(view.state, 'link', clipboard))
  })
  return true
}

/** Before the default keymap: Return tries the list rule and otherwise inserts a plain
 *  newline - no auto-indent, as in NSTextView. Alt-Return is the way out when you want a
 *  plain newline on a list line. */
export const markdownKeymap = keymap.of([
  { key: 'Enter', run: continueList },
  { key: 'Enter', run: insertNewline },
  { key: 'Alt-Enter', run: insertNewline },
  { key: 'Mod-b', run: formatCommand('bold') },
  { key: 'Mod-i', run: formatCommand('italic') },
  { key: 'Mod-k', run: linkCommand },
])
