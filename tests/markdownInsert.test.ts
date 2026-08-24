import { describe, expect, test } from 'bun:test'
import { CARET, INSERT_MENU, insertEdit, insertRows, isSeparator, slashQuery } from '../src/models/markdownInsert'
import { exampleText } from '../src/models/exampleDoc'

/** The snippet an id names - the tests read the catalogue rather than repeating it. */
function snippet(id: string): string {
  for (const row of INSERT_MENU) {
    if (!isSeparator(row) && row.id === id) return row.snippet
  }
  throw new Error(`no insertion named ${id}`)
}

const labels = (query: string) => insertRows(query).map((row) => (isSeparator(row) ? '-' : row.label))

describe('the catalogue', () => {
  test('offers every construct the example page shows off', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(snippet(`alert-${kind.toLowerCase()}`)).toContain(`> [!${kind}]`)
      expect(exampleText).toContain(`> [!${kind}]`)
    }
    for (const marker of ['[ ]', '[o]', '[x]']) {
      expect(INSERT_MENU.some((row) => !isSeparator(row) && row.snippet.includes(marker))).toBe(true)
    }
    for (const type of ['info', 'warning', 'details']) {
      expect(snippet(`component-${type}`)).toContain(`:::${type}`)
      expect(exampleText).toContain(`:::${type}`)
    }
  })

  test('places the caret exactly once in every row', () => {
    for (const row of INSERT_MENU) {
      if (isSeparator(row)) continue
      expect(row.snippet.split(CARET)).toHaveLength(2)
    }
  })
})

describe('filtering', () => {
  test('an empty query is the whole list, groups and all', () => {
    expect(insertRows('')).toBe(INSERT_MENU)
    expect(labels('')).toContain('-')
  })

  test('a query is the matches alone, matched on the label and on what you might call it', () => {
    expect(labels('head')).toEqual(['Heading 1', 'Heading 2', 'Heading 3'])
    expect(labels('todo')).toEqual(['Task', 'Task in progress', 'Task done'])
    expect(labels('h1')).toEqual(['Heading 1'])
    expect(labels('codeblock')).toEqual(['Code block'])
    expect(labels('zzz')).toEqual([])
  })
})

describe('where an insertion lands', () => {
  test('a blank line takes it, and the caret sits where the marker was', () => {
    expect(insertEdit({ from: 40, text: '' }, snippet('task'), null)).toEqual({
      from: 40,
      to: 40,
      text: '- [ ] ',
      caret: 46,
    })
  })

  test('a line with text keeps it and the snippet opens the line below', () => {
    expect(insertEdit({ from: 10, text: '- one' }, snippet('task'), null)).toEqual({
      from: 15,
      to: 15,
      text: '\n- [ ] ',
      caret: 22,
    })
  })

  test('a `/` query is swallowed, indentation and all', () => {
    expect(insertEdit({ from: 100, text: '  /head' }, snippet('heading-2'), 7)).toEqual({
      from: 100,
      to: 107,
      text: '## ',
      caret: 103,
    })
  })

  test('a snippet of several lines lands whole, the caret in its first field', () => {
    const edit = insertEdit({ from: 0, text: '' }, snippet('table'), null)
    expect(edit.text.split('\n')).toHaveLength(3)
    expect(edit.caret).toBe(2)
  })
})

describe('the `/` trigger', () => {
  test('is a slash that opens the line, indentation aside', () => {
    expect(slashQuery('/', 1)).toBe('')
    expect(slashQuery('  /head', 7)).toBe('head')
    expect(slashQuery('/head', 3)).toBe('he')
  })

  test('a slash inside a line, a path, a marker before it, or a space in the query is prose', () => {
    expect(slashQuery('see /usr', 8)).toBe(null)
    expect(slashQuery('/usr/local', 10)).toBe(null)
    expect(slashQuery('- /task', 7)).toBe(null)
    expect(slashQuery('/code block', 11)).toBe(null)
  })

  test('the caret before the slash is not in a query', () => {
    expect(slashQuery('/head', 0)).toBe(null)
  })
})
