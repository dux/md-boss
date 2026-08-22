import { describe, expect, test } from 'bun:test'
import {
  closedCodeSpan, closesFence, matchingBracket, opensFence, parsingDestination,
  skippingCodeSpan, skippingTitle,
} from '../src/models/markdownScan'

describe('fences', () => {
  test('three or more backticks or tildes open, with up to three leading spaces', () => {
    expect(opensFence('```')).toEqual({ marker: '`', length: 3 })
    expect(opensFence('````swift')).toEqual({ marker: '`', length: 4 })
    expect(opensFence('~~~')).toEqual({ marker: '~', length: 3 })
    expect(opensFence('   ```')).toEqual({ marker: '`', length: 3 })
  })

  test('too short, too indented, or the wrong character is prose', () => {
    expect(opensFence('``')).toBeNull()
    expect(opensFence('    ```')).toBeNull()
    expect(opensFence('# heading')).toBeNull()
    expect(opensFence('')).toBeNull()
  })

  test('a closer matches the marker, runs at least as long, and carries only whitespace', () => {
    const fence = { marker: '`' as const, length: 3 }
    expect(closesFence('```', fence)).toBe(true)
    expect(closesFence('`````  ', fence)).toBe(true)
    expect(closesFence('  ```', fence)).toBe(true)
    expect(closesFence('``', fence)).toBe(false)
    expect(closesFence('~~~', fence)).toBe(false)
    expect(closesFence('``` swift', fence)).toBe(false)
    expect(closesFence('    ```', fence)).toBe(false)
  })

  test('a four-backtick fence is not closed by three', () => {
    expect(closesFence('```', { marker: '`', length: 4 })).toBe(false)
    expect(closesFence('````', { marker: '`', length: 4 })).toBe(true)
  })
})

describe('code spans', () => {
  test('closes on a run of exactly the opening length', () => {
    expect(skippingCodeSpan('`code` after', 0)).toBe(6)
    expect(closedCodeSpan('a `code` b', 2)).toEqual({ start: 2, end: 8 })
    expect(skippingCodeSpan('``a ` b`` c', 0)).toBe(9)
  })

  test('an unmatched run is literal text and scanning resumes after it', () => {
    expect(skippingCodeSpan('`` not closed `', 0)).toBe(2)
    expect(closedCodeSpan('`` not closed `', 0)).toBeNull()
    expect(closedCodeSpan('lonely ` tick', 7)).toBeNull()
  })
})

describe('brackets', () => {
  test('finds the closer, honouring nesting', () => {
    expect(matchingBracket('[text](x)', 0)).toBe(5)
    expect(matchingBracket('[a [b] c](x)', 0)).toBe(8)
  })

  test('escapes and code spans do not count', () => {
    expect(matchingBracket('[a \\] b](x)', 0)).toBe(7)
    expect(matchingBracket('[a `]` b](x)', 0)).toBe(8)
  })

  test('unclosed is null', () => {
    expect(matchingBracket('[never', 0)).toBeNull()
    expect(matchingBracket('[a `]` b', 0)).toBeNull()
  })
})

describe('destinations', () => {
  test('a bare destination, with its range covering only the token', () => {
    const text = '[t](docs/a.md)'
    expect(parsingDestination(text, 3)).toEqual({ range: { start: 4, end: 13 }, raw: 'docs/a.md', end: 14 })
  })

  test('balanced parentheses stay inside the destination', () => {
    const text = '[t](a(b).md)'
    const d = parsingDestination(text, 3)!
    expect(d.raw).toBe('a(b).md')
    expect(d.end).toBe(text.length)
  })

  test('angle brackets allow spaces and are part of the range, not the raw value', () => {
    const text = '[t](<my file.md>)'
    const d = parsingDestination(text, 3)!
    expect(d.raw).toBe('my file.md')
    expect(text.slice(d.range.start, d.range.end)).toBe('<my file.md>')
    expect(d.end).toBe(text.length)
  })

  test('a title in any of the three quote styles sits outside the range', () => {
    for (const title of ['"Title"', "'Title'", '(Title)']) {
      const text = `[t](a.md ${title})`
      const d = parsingDestination(text, 3)!
      expect(d.raw).toBe('a.md')
      expect(text.slice(d.range.start, d.range.end)).toBe('a.md')
      expect(d.end).toBe(text.length)
    }
  })

  test('spaces around the destination are tolerated', () => {
    const d = parsingDestination('[t]( a.md )', 3)!
    expect(d.raw).toBe('a.md')
  })

  test('an unterminated destination or a space without a title is not a link', () => {
    expect(parsingDestination('[t](a.md', 3)).toBeNull()
    expect(parsingDestination('[t](a.md b.md)', 3)).toBeNull()
    expect(parsingDestination('[t](<a.md)', 3)).toBeNull()
    expect(parsingDestination('[t](', 3)).toBeNull()
  })

  test('skippingTitle leaves an unclosed title where it found it', () => {
    expect(skippingTitle('"open', 0)).toBe(0)
    expect(skippingTitle('"a \\" b" x', 0)).toBe(8)
    expect(skippingTitle('x', 0)).toBe(0)
  })
})
