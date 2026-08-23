import { describe, expect, test } from 'bun:test'
import { continuation, prefixOf, type Continuation } from '../src/models/markdownList'

/** Return pressed at the end of the line, which is where it is pressed. */
const atEnd = (line: string, insideFence = false): Continuation =>
  continuation(line, line.length, insideFence)
const insert = (text: string): Continuation => ({ type: 'insert', text })
const none: Continuation = { type: 'none' }

describe('Return continues a list', () => {
  test.each(['-', '*', '+'])('bullet %p carries its own character forward', (marker) => {
    expect(atEnd(`${marker} item`)).toEqual(insert(`\n${marker} `))
  })

  test('an ordered list increments rather than renumbering', () => {
    expect(atEnd('1. first')).toEqual(insert('\n2. '))
    expect(atEnd('41) other')).toEqual(insert('\n42) '))
  })

  test('indentation is carried verbatim', () => {
    expect(atEnd('    - nested')).toEqual(insert('\n    - '))
  })

  test('a quote continues with its bars, list or not', () => {
    expect(atEnd('> quoted')).toEqual(insert('\n> '))
    expect(atEnd('> > deep')).toEqual(insert('\n> > '))
    expect(atEnd('> - item')).toEqual(insert('\n> - '))
  })

  test.each(['[ ]', '[x]', '[X]', '[o]', '[O]', '[*]'])('a task %p continues unchecked', (box) => {
    expect(atEnd(`- ${box} done`)).toEqual(insert('\n- [ ] '))
  })

  test('an empty item sheds its marker instead of growing another', () => {
    expect(atEnd('- ')).toEqual({ type: 'clear', length: 2 })
    expect(atEnd('  1. ')).toEqual({ type: 'clear', length: 5 })
    expect(atEnd('- [ ] ')).toEqual({ type: 'clear', length: 6 })
  })

  test('inside a fence a bullet is code, so Return is just a newline', () => {
    expect(atEnd('- item', true)).toEqual(none)
  })

  test.each(['plain prose', '# heading', '', '3 - 2 = 1'])('%p opens nothing', (line) => {
    expect(atEnd(line)).toEqual(none)
  })

  test('Return inside the marker itself does not continue', () => {
    expect(continuation('- item', 1, false)).toEqual(none)
  })

  test('Return mid-item still carries the prefix', () => {
    expect(continuation('- one two', 6, false)).toEqual(insert('\n- '))
  })
})

describe('prefixes', () => {
  test('indentation after the quote bars belongs to the list', () => {
    const p = prefixOf('>   - item')!
    expect(p.quotes).toBe('> ')
    expect(p.indent).toBe('  ')
    expect(p.contentStart).toBe(6)
  })

  test('ten digits is not an ordered marker', () => {
    expect(prefixOf('1234567890. x')).toBeNull()
  })
})
