import { describe, expect, test } from 'bun:test'
import { isURL, link, toggling, type Edit } from '../src/models/markdownWrap'

const apply = (text: string, edit: Edit) => text.slice(0, edit.range.start) + edit.replacement + text.slice(edit.range.end)
const sel = (start: number, length: number) => ({ start, end: start + length })

describe('wrapping a selection', () => {
  test('a selection is wrapped', () => {
    expect(apply('make this bold', toggling('make this bold', sel(5, 4), '**'))).toBe('make **this** bold')
  })

  test('markers selected along with the text come off', () => {
    expect(apply('make **this** bold', toggling('make **this** bold', sel(5, 8), '**'))).toBe('make this bold')
  })

  test('markers just outside the selection come off too', () => {
    expect(apply('make **this** bold', toggling('make **this** bold', sel(7, 4), '**'))).toBe('make this bold')
  })

  test('an empty selection takes the word under the caret', () => {
    expect(apply('make this bold', toggling('make this bold', sel(7, 0), '_'))).toBe('make _this_ bold')
  })

  test('with no word to take, the caret lands between a fresh pair', () => {
    const edit = toggling('a  b', sel(2, 0), '**')
    expect(apply('a  b', edit)).toBe('a **** b')
    expect(edit.selection).toEqual(sel(4, 0))
  })

  test('whitespace migrates outside the markers', () => {
    expect(apply('make this  bold', toggling('make this  bold', sel(5, 6), '**'))).toBe('make **this**  bold')
  })

  test('the selection afterwards still covers the same text', () => {
    const edit = toggling('make this bold', sel(5, 4), '**')
    const after = apply('make this bold', edit)
    expect(after.slice(edit.selection.start, edit.selection.end)).toBe('this')
  })
})

describe('making a link', () => {
  test('a URL on the clipboard becomes the destination', () => {
    const edit = link('see the plan', sel(4, 8), 'https://example.com/x')
    expect(apply('see the plan', edit)).toBe('see [the plan](https://example.com/x)')
    expect(edit.selection.end - edit.selection.start).toBe(0)
  })

  test('a selected URL becomes the destination instead', () => {
    const edit = link('https://example.com', sel(0, 19), null)
    expect(apply('https://example.com', edit)).toBe('[](https://example.com)')
    expect(edit.selection).toEqual(sel(1, 0))
  })

  test('with neither, the caret lands in the empty parens', () => {
    const edit = link('the plan', sel(0, 8), null)
    expect(apply('the plan', edit)).toBe('[the plan]()')
    expect(edit.selection).toEqual(sel(11, 0))
  })

  test('prose on the clipboard is not a destination', () => {
    expect(apply('word', link('word', sel(0, 4), 'not a url'))).toBe('[word]()')
  })

  test('a scheme and something after it is a URL, a bare host is not', () => {
    expect(isURL('https://example.com')).toBe(true)
    expect(isURL('mailto:a@b.c')).toBe(true)
    expect(isURL('file:///tmp/x.md')).toBe(true)
    expect(isURL('example.com')).toBe(false)
    expect(isURL('some prose here')).toBe(false)
    expect(isURL('')).toBe(false)
  })
})
