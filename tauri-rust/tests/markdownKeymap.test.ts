import { describe, expect, test } from 'bun:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import { continuationSpec, formatSpec, type Format } from '../src/editor/markdownKeymap'

/** `|` marks the caret, `[` `]` a selection, in the fixture text. */
function stateOf(fixture: string): EditorState {
  const caret = fixture.indexOf('|')
  const open = fixture.indexOf('[[')
  const close = fixture.indexOf(']]')
  let doc = fixture
  let selection
  if (open >= 0 && close > open) {
    doc = fixture.slice(0, open) + fixture.slice(open + 2, close) + fixture.slice(close + 2)
    selection = EditorSelection.single(open, close - 2)
  } else {
    doc = fixture.slice(0, caret) + fixture.slice(caret + 1)
    selection = EditorSelection.cursor(caret)
  }
  return EditorState.create({ doc, selection })
}

/** The document after, with `|` at the caret (or `[[` `]]` around a selection). */
function apply(state: EditorState, spec: ReturnType<typeof continuationSpec>): string {
  if (!spec) return '<none>'
  const next = state.update(spec).state
  const { main } = next.selection
  const text = next.doc.toString()
  if (main.empty) return text.slice(0, main.head) + '|' + text.slice(main.head)
  return text.slice(0, main.from) + '[[' + text.slice(main.from, main.to) + ']]' + text.slice(main.to)
}

const noFence = () => false
const returnOn = (fixture: string, fence = noFence) => {
  const state = stateOf(fixture)
  return apply(state, continuationSpec(state, fence))
}

describe('Return', () => {
  test('continues a bullet, an ordered item, a quote, and a task unchecked', () => {
    expect(returnOn('- one|')).toBe('- one\n- |')
    expect(returnOn('3. three|\nx')).toBe('3. three\n4. |\nx')
    expect(returnOn('> said|')).toBe('> said\n> |')
    expect(returnOn('- [x] done|')).toBe('- [x] done\n- [ ] |')
  })

  test('an empty item sheds its marker, indentation and all', () => {
    expect(returnOn('- one\n  - |')).toBe('- one\n|')
    expect(returnOn('1. |')).toBe('|')
  })

  test('a plain line, a selection, a caret inside the marker and a fence are left to the editor', () => {
    expect(returnOn('plain|')).toBe('<none>')
    expect(returnOn('- [[one]]')).toBe('<none>')
    expect(returnOn('-| one')).toBe('<none>')
    expect(returnOn('```\n- code|\n```', () => true)).toBe('<none>')
  })
})

describe('formatting', () => {
  const format = (fixture: string, kind: Format, clipboard: string | null = null) => {
    const state = stateOf(fixture)
    return apply(state, formatSpec(state, kind, clipboard))
  }

  test('bold and italic wrap the selection or the word under the caret, and unwrap', () => {
    expect(format('say [[hello]] there', 'bold')).toBe('say **[[hello]]** there')
    expect(format('say hel|lo there', 'italic')).toBe('say _[[hello]]_ there')
    expect(format('say **[[hello]]** there', 'bold')).toBe('say [[hello]] there')
  })

  test('link takes a URL from the clipboard, or leaves the caret where the half is missing', () => {
    expect(format('see [[docs]] now', 'link', 'https://x.y/')).toBe('see [docs](https://x.y/)| now')
    expect(format('see [[docs]] now', 'link', 'not a url')).toBe('see [docs](|) now')
    expect(format('go [[https://x.y/]] now', 'link', null)).toBe('go [|](https://x.y/) now')
  })
})
