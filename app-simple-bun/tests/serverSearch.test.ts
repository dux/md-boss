import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_LIMITS, Needle, isCaseSensitive, matches, run, type Match } from '../server/search'

const made: string[] = []

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'md-boss-search-'))
  made.push(root)
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const lines = (m: Match[]) => m.map((x) => [x.line, x.column, x.length])
const bytes = (s: string) => new TextEncoder().encode(s)

describe('search', () => {
  test('case follows the query', () => {
    expect(isCaseSensitive('plan')).toBe(false)
    expect(isCaseSensitive('Plan')).toBe(true)
    const text = 'The Plan\nthe plan\nno\n'
    expect(lines(matches(text, 'plan', 10))).toEqual([[1, 4, 4], [2, 4, 4]])
    expect(lines(matches(text, 'Plan', 10))).toEqual([[1, 4, 4]])
  })

  test('columns are utf16 and lines lose their line endings', () => {
    const text = '😀 plan\r\nsecond Plan here\r\n'
    const found = matches(text, 'plan', 10)
    expect(lines(found)).toEqual([[1, 3, 4], [2, 7, 4]])
    expect(found[0]!.text).toBe('😀 plan')
    expect(found[1]!.text).toBe('second Plan here')
  })

  test('folding that changes length keeps columns on the original', () => {
    // 'İ' lowercases to two code units; the match after it must still land on the right column.
    expect(lines(matches('İ abc', 'abc', 10))).toEqual([[1, 2, 3]])
    // A folded match over a widening char: the length covers the original characters.
    expect(lines(matches('xİy', 'i̇', 10))).toEqual([[1, 1, 1]])
  })

  test('limit and repeated matches on one line', () => {
    expect(lines(matches('aaaa\naa\n', 'aa', 10))).toEqual([[1, 0, 2], [1, 2, 2], [2, 0, 2]])
    expect(matches('aaaa\naa\n', 'aa', 2).length).toBe(2)
    expect(matches('x', '', 10)).toEqual([])
  })

  test('the prefilter never says no about a match', () => {
    const needle = Needle.for('plan')!
    expect(needle.mayContain(bytes('The PLAN'))).toBe(true)
    expect(needle.mayContain(bytes('nothing here'))).toBe(false)
    expect(Needle.for('Plan')!.mayContain(bytes('a Plan'))).toBe(true)
    expect(Needle.for('Plan')!.mayContain(bytes('a plan'))).toBe(false)
    expect(Needle.for('plan')!.mayContain(bytes('K'))).toBe(false)
    // Kelvin sign folds to k: a file holding it cannot be skipped
    expect(Needle.for('kelvin')!.mayContain(bytes('Kelvin'))).toBe(true)
    expect(Needle.for('plän')).toBeNull()
    expect(Needle.for('')).toBeNull()
  })

  test('searches the tree with buffers, skips and budgets', () => {
    const dir = fixture({
      'a.md': 'alpha plan\nbeta\n',
      'sub/b.md': 'plan one\nplan two\nplan three\n',
      'node_modules/x.md': 'plan hidden\n',
      'c.txt': 'PLAN shouting\n',
      'bin.md': 'plan ￿',
    })
    const skip = new Set(['node_modules'])
    const never = () => false
    const result = run(dir, skip, 'plan', {}, DEFAULT_LIMITS, never)
    expect(result.hits.map((h) => h.path.slice(dir.length))).toEqual(['/a.md', '/bin.md', '/c.txt', '/sub/b.md', '/sub/b.md', '/sub/b.md'])
    expect(result.filesSearched).toBe(4)
    expect(result.truncated).toBe(false)

    // unsaved text wins over the disk copy
    const buffers = { [join(dir, 'a.md')]: 'nothing now\n' }
    expect(run(dir, skip, 'alpha', buffers, DEFAULT_LIMITS, never).hits).toEqual([])

    // per-file and total budgets say when they cut
    const tight = run(dir, skip, 'plan', {}, { perFile: 2, total: 100, files: 100 }, never)
    expect(tight.truncated).toBe(true)
    expect(tight.hits.filter((h) => h.path.endsWith('b.md')).length).toBe(2)
    const total = run(dir, skip, 'plan', {}, { perFile: 50, total: 3, files: 100 }, never)
    expect(total.hits.length).toBe(3)
    expect(total.truncated).toBe(true)
    const files = run(dir, skip, 'plan', {}, { perFile: 50, total: 100, files: 2 }, never)
    expect(files.filesSearched).toBe(2)
    expect(files.truncated).toBe(true)

    // cancelled between files
    let calls = 0
    const cancelAfterTwo = () => calls++ >= 2
    const cancelled = run(dir, skip, 'plan', {}, DEFAULT_LIMITS, cancelAfterTwo)
    expect(cancelled.truncated).toBe(true)
    expect(cancelled.hits.length).toBeLessThan(6)
  })
})
