import { describe, expect, test } from 'bun:test'
import { LineIndex } from '../src/models/lineIndex'

describe('line index', () => {
  test('the empty string is one line', () => {
    const index = new LineIndex('')
    expect(index.count).toBe(1)
    expect(index.lineAt(0)).toBe(1)
    expect(index.rangeOfLine(1)).toEqual({ start: 0, end: 0 })
  })

  test('offsets map to their line', () => {
    const index = new LineIndex('one\ntwo\nthree')
    expect(index.count).toBe(3)
    expect(index.lineAt(0)).toBe(1)
    expect(index.lineAt(3)).toBe(1) // the newline belongs to the line it ends
    expect(index.lineAt(4)).toBe(2)
    expect(index.lineAt(7)).toBe(2)
    expect(index.lineAt(8)).toBe(3)
    expect(index.lineAt(12)).toBe(3)
  })

  test('a trailing newline opens an empty last line', () => {
    const index = new LineIndex('one\ntwo\n')
    expect(index.count).toBe(3)
    expect(index.lineAt(8)).toBe(3)
    expect(index.rangeOfLine(3)).toEqual({ start: 8, end: 8 })
  })

  test('ranges carry the trailing newline', () => {
    const index = new LineIndex('one\ntwo\nthree')
    expect(index.rangeOfLine(1)).toEqual({ start: 0, end: 4 })
    expect(index.rangeOfLine(2)).toEqual({ start: 4, end: 8 })
    expect(index.rangeOfLine(3)).toEqual({ start: 8, end: 13 })
    expect(index.rangeOfLine(0)).toBeNull()
    expect(index.rangeOfLine(4)).toBeNull()
  })

  test('offsets outside the text clamp to the first and last line', () => {
    const index = new LineIndex('one\ntwo')
    expect(index.lineAt(-5)).toBe(1)
    expect(index.lineAt(9000)).toBe(2)
  })

  test('counting is by UTF-16 units, so emoji do not shift a line', () => {
    const text = '🎉 party\nnext'
    const index = new LineIndex(text)
    expect(index.length).toBe(text.length)
    expect(index.lineAt(text.indexOf('next'))).toBe(2)
  })

  test('only \\n splits, so a lone carriage return stays on its line', () => {
    const index = new LineIndex('one\rstill one\ntwo')
    expect(index.count).toBe(2)
    expect(index.lineAt(5)).toBe(1)
  })
})
