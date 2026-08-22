import { describe, expect, test } from 'bun:test'
import { LineIndex } from '../src/models/lineIndex'
import { shiftLine, shiftOffset } from '../src/models/noteShift'

describe('note shifting', () => {
  /** Lines 1, 2 and 3 start at 0, 4 and 8. */
  const text = 'one\ntwo\nthree\n'

  /** Runs an edit the way the editor reports one, and answers where a note moved to. */
  const shift = (line: number, start: number, length: number, replacement: string) => {
    const updated = text.slice(0, start) + replacement + text.slice(start + length)
    return shiftLine(line, new LineIndex(text), new LineIndex(updated), { start, end: start + length, length: replacement.length })
  }

  test('a line added above pushes the note down', () => expect(shift(3, 0, 0, 'new\n')).toBe(4))
  test('a line removed above pulls the note up', () => expect(shift(3, 0, 4, '')).toBe(2))
  test('Enter at the head of a noted line takes the note down with its text', () => expect(shift(3, 8, 0, '\n')).toBe(4))
  test('Enter at the tail of the line above also pushes the note down', () => expect(shift(3, 7, 0, '\n')).toBe(4))

  test('typing within or at the head of the noted line leaves it where it is', () => {
    expect(shift(3, 8, 0, 'X')).toBe(3)
    expect(shift(3, 9, 0, 'X')).toBe(3)
  })

  test('typing on the line above leaves it where it is', () => expect(shift(3, 7, 0, 'X')).toBe(3))
  test('a same-length replacement that introduces a newline still shifts', () => expect(shift(3, 4, 2, 'x\n')).toBe(4))
  test('a note whose line is typed over lands on the line that survived', () => expect(shift(3, 4, 9, 'z')).toBe(2))
  test('a line out of range has nowhere to go', () => expect(shift(99, 0, 0, 'new\n')).toBeNull())

  test('an edit at or before the anchor slides it, including insertion exactly on it', () => {
    expect(shiftOffset(8, { start: 8, end: 8, length: 1 })).toBe(9)
    expect(shiftOffset(8, { start: 0, end: 4, length: 0 })).toBe(4)
  })

  test('an edit starting after the anchor leaves it alone', () => {
    expect(shiftOffset(8, { start: 9, end: 12, length: 1 })).toBe(8)
  })

  test('an edit that swallows the anchor drops it to where the edit began', () => {
    expect(shiftOffset(8, { start: 4, end: 13, length: 1 })).toBe(4)
  })
})
