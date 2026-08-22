import { describe, expect, test } from 'bun:test'
import type { Fence } from '../src/models/markdownScan'
import { scan, type Kind, type Span } from '../src/models/markdownSyntax'

/** Spans as [kind, the text they cover], which is what makes an expectation readable. */
function spans(line: string, fence: Fence | null = null): [Kind, string][] {
  const found: Span[] = []
  scan(line, fence, found)
  return found.map((s) => [s.kind, line.slice(s.start, s.end)])
}

const kinds = (line: string, fence: Fence | null = null) => spans(line, fence).map((s) => s[0])
const state = (line: string, fence: Fence | null = null) => scan(line, fence, [])
const texts = (line: string, kind: Kind) => spans(line).filter((s) => s[0] === kind).map((s) => s[1])
const ticks: Fence = { marker: '`', length: 3 }

describe('headings and rules', () => {
  test('hashes and their text are separate spans', () => {
    expect(spans('## The plan')).toEqual([['headingMarker', '##'], ['headingText', ' The plan']])
  })

  test.each(['####### too many', '#hashtag', 'a # mid line'])('%p is not a heading', (line) => {
    expect(kinds(line)).not.toContain('headingMarker')
  })

  test('heading text is still scanned inline', () => {
    expect(kinds('# The **plan**')).toEqual(['headingMarker', 'headingText', 'strong'])
  })

  test.each(['---', '***', '___', '- - -', '-----'])('%p is a rule', (line) => {
    expect(kinds(line)).toEqual(['rule'])
  })

  test.each(['--', '- item'])('%p is not a rule', (line) => {
    expect(kinds(line)).not.toContain('rule')
  })
})

describe('fences', () => {
  test('an opener paints its run and its info string, and opens the fence', () => {
    expect(spans('```swift')).toEqual([['fenceMarker', '```'], ['fenceInfo', 'swift']])
    expect(state('```swift')).toEqual(ticks)
  })

  test('a line inside a fence is code, whatever it looks like', () => {
    expect(kinds('# not a heading', ticks)).toEqual(['codeBlock'])
    expect(kinds('- [a](b.md)', ticks)).toEqual(['codeBlock'])
    expect(state('# not a heading', ticks)).toEqual(ticks)
  })

  test('the closer ends the fence and is painted as its own marker', () => {
    expect(kinds('```', ticks)).toEqual(['fenceMarker'])
    expect(state('```', ticks)).toBeNull()
  })

  test('a fence closes only on its own marker', () => {
    expect(state('~~~', ticks)).toEqual(ticks)
    expect(state('``', ticks)).toEqual(ticks)
  })
})

describe('inline', () => {
  test('a code span closes on a run of its own length', () => {
    expect(texts('a `code` b', 'codeSpan')).toEqual(['`code`'])
    expect(texts('a ``has ` inside`` b', 'codeSpan')).toEqual(['``has ` inside``'])
  })

  test('an unmatched backtick run is prose', () => {
    expect(kinds('a ` lonely tick')).not.toContain('codeSpan')
  })

  test('a link paints its brackets, text and destination apart', () => {
    expect(spans('see [the plan](./a.md) now')).toEqual([
      ['linkBracket', '['], ['linkText', 'the plan'], ['linkBracket', ']('],
      ['linkDestination', './a.md'], ['linkBracket', ')'],
    ])
  })

  test('an image carries its bang', () => {
    expect(spans('![alt](a.png)')[0]).toEqual(['imageBang', '!'])
  })

  test('a destination with balanced parentheses is one token', () => {
    expect(texts('[x](./a(1).md)', 'linkDestination')).toEqual(['./a(1).md'])
  })

  test('link text is scanned inline', () => {
    expect(kinds('[the **plan**](a.md)')).toContain('strong')
  })

  test('a bracket that opens no link is prose', () => {
    expect(kinds('an [aside] in prose')).not.toContain('linkText')
  })

  test('emphasis and strong are told apart by run length', () => {
    expect(texts('a *one* b', 'emphasis')).toEqual(['*one*'])
    expect(texts('a **two** b', 'strong')).toEqual(['**two**'])
    expect(texts('a ~~gone~~ b', 'strikethrough')).toEqual(['~~gone~~'])
  })

  test.each(['snake_case_name', '2 * 3 * 4', 'a * b'])('%p cannot delimit', (line) => {
    expect(kinds(line)).not.toContain('emphasis')
    expect(kinds(line)).not.toContain('strong')
  })

  test('an escaped marker delimits nothing', () => {
    expect(kinds('\\*not emphasis\\*')).not.toContain('emphasis')
  })
})

describe('lists and quotes', () => {
  test.each(['- a', '* a', '+ a', '1. a', '12) a'])('%p starts with a marker', (line) => {
    expect(kinds(line)[0]).toBe('listMarker')
  })

  test('all three task states are marked', () => {
    for (const box of ['[ ]', '[x]', '[X]', '[*]']) {
      expect(kinds(`- ${box} do it`).slice(0, 2)).toEqual(['listMarker', 'taskMarker'])
    }
  })

  test('indentation is kept out of the marker', () => {
    expect(texts('    - nested', 'listMarker')).toEqual(['- '])
  })

  test('quote markers repeat and the body is tinted', () => {
    expect(texts('> > deep', 'quoteMarker')).toEqual(['> ', '> '])
    expect(texts('> > deep', 'quoteText')).toEqual(['deep'])
  })

  test('a quoted line still scans inline', () => {
    expect(kinds('> see [a](b.md)')).toContain('linkDestination')
  })
})

describe('spans are well formed', () => {
  const lines = [
    '# Heading', '## The **plan** and `code`', '> quoted [link](./a.md)',
    '- [ ] task with *emphasis*', '```swift', 'let x = 1', '```', '---',
    '![img](a.png) and ~~gone~~', '', '    indented', 'plain prose',
    '1. numbered', 'snake_case and 2 * 3', '\\*escaped\\*', 'a ``tick ` in`` b',
  ]

  test('no span falls outside the line it came from', () => {
    for (const line of lines) {
      const found: Span[] = []
      scan(line, null, found)
      for (const s of found) {
        expect(s.start).toBeGreaterThanOrEqual(0)
        expect(s.end).toBeGreaterThan(s.start)
        expect(s.end).toBeLessThanOrEqual(line.length)
      }
    }
  })

  test('offsets are UTF-16, so emoji and accents do not shift a span', () => {
    expect(texts('🎉 **bold**', 'strong')).toEqual(['**bold**'])
    expect(texts('café *ok*', 'emphasis')).toEqual(['*ok*'])
  })
})
