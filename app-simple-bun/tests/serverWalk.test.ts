import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Scanner, containsDocument, documentsUnder, isDocument, listDir, naturalCompare } from '../server/walk'

const made: string[] = []

/** A scratch tree: `{ 'one/a.md': 'text' }` written under a unique temp folder. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'md-boss-walk-'))
  made.push(root)
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}

const names = (paths: string[]) => paths.map((p) => basename(p))
const skip = (...names: string[]) => new Set(names)

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('walk', () => {
  test('extensions decide documents', () => {
    expect(isDocument('a.md')).toBe(true)
    expect(isDocument('CAPS.MD')).toBe(true)
    expect(isDocument('notes.txt')).toBe(true)
    expect(isDocument('data.csv')).toBe(true)
    expect(isDocument('b.swift')).toBe(false)
    expect(isDocument('no-extension')).toBe(false)
    expect(isDocument('trailing.')).toBe(false)
    expect(isDocument('.md')).toBe(false)
    expect(isDocument('d.mdx')).toBe(false)
  })

  test('mixed tree walk', () => {
    const root = fixture({
      'top.md': 'a',
      'CAPS.MD': 'case',
      'one/a.markdown': 'a',
      'one/deep/deeper/b.txt': 'b',
      'one/b.swift': 'no',
      'one/no-extension': 'no',
      'two/c.qmd': 'c',
      'two/d.mdx': 'no',
      'two/trailing.': 'no',
      'node_modules/vendored.md': 'no',
      'one/node_modules/also.md': 'no',
      'three/.hidden.md': 'no',
      'three/visible.md': 'yes',
      '.git/config.md': 'no',
    })
    const found = documentsUnder(root, skip('node_modules'), false)
    expect(found.length).toBe(6)
    expect(names(found).sort()).toEqual(['CAPS.MD', 'a.markdown', 'b.txt', 'c.qmd', 'top.md', 'visible.md'])
  })

  test('symlinks are not descended but a linked document counts', () => {
    const root = fixture({ 'real/inside.md': 'a', 'anchor.md': 'b', 'real.md': 'a' })
    symlinkSync(join(root, 'real'), join(root, 'link'))
    symlinkSync(join(root, 'real.md'), join(root, 'alias.md'))
    const found = names(documentsUnder(root, skip(), false))
    expect(found.filter((n) => n === 'inside.md').length).toBe(1)
    expect(found).toContain('alias.md')
    // The sidebar, though, shows a linked folder as a folder.
    const listing = listDir(root, skip(), new Scanner())
    expect(listing.kind).toBe('entries')
    if (listing.kind === 'entries') expect(listing.entries.some((e) => e.name === 'link' && e.isDir)).toBe(true)
  })

  test('skipped folders at every depth and stable order', () => {
    const root = fixture({
      'node_modules/a.md': 'no',
      'one/node_modules/b.md': 'no',
      'one/two/node_modules/c.md': 'no',
      'one/two/yes.md': 'yes',
    })
    expect(names(documentsUnder(root, skip('node_modules'), false))).toEqual(['yes.md'])
    const other = fixture({ 'b.md': 'x', 'a.md': 'x', 'c.md': 'x', 'zsub/one.md': 'x', 'asub/two.md': 'x' })
    expect(names(documentsUnder(other, skip(), false))).toEqual(['a.md', 'b.md', 'c.md', 'two.md', 'one.md'])
  })

  test('degenerate folders answer empty', () => {
    const root = fixture({})
    expect(documentsUnder(root, skip(), false)).toEqual([])
    expect(documentsUnder(join(root, 'gone'), skip(), false)).toEqual([])
  })

  test('packages are opaque only when asked', () => {
    const root = fixture({ 'Thing.app/Contents/notes.md': 'inside', 'outside.md': 'yes' })
    expect(documentsUnder(root, skip(), false).length).toBe(2)
    expect(names(documentsUnder(root, skip(), true))).toEqual(['outside.md'])
  })

  test('budget fails open', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) files[`junk/f${i}.swift`] = 'x'
    const root = fixture(files)
    expect(containsDocument(root, skip(), 10_000, true)).toBe(false)
    expect(containsDocument(root, skip(), 2, true)).toBe(true)
  })

  test('listing hides empty folders and orders naturally', () => {
    const root = fixture({
      '10.md': '',
      '9.md': '',
      'B.md': '',
      'a.md': '',
      'code/x.swift': '',
      'docs/deep/guide.md': '',
      'Zeta/readme.md': '',
      'node_modules/x.md': '',
      '.hidden/x.md': '',
    })
    const listing = listDir(root, skip('node_modules'), new Scanner())
    expect(listing.kind).toBe('entries')
    if (listing.kind !== 'entries') return
    expect(listing.entries.map((e) => e.name)).toEqual(['docs', 'Zeta', '9.md', '10.md', 'a.md', 'B.md'])
    expect(listing.entries[0]!.isDir && listing.entries[1]!.isDir && !listing.entries[2]!.isDir).toBe(true)
  })

  test('listing tells missing from denied and the scanner memo invalidates', () => {
    const root = fixture({ 'empty/x.swift': '' })
    expect(listDir(join(root, 'gone'), skip(), new Scanner())).toEqual({ kind: 'missing' })
    const scanner = new Scanner()
    const empty = join(root, 'empty')
    expect(scanner.containsDocuments(empty, skip())).toBe(false)
    writeFileSync(join(empty, 'now.md'), 'here')
    expect(scanner.containsDocuments(empty, skip())).toBe(false) // memoised
    scanner.invalidate(join(empty, 'now.md'))
    expect(scanner.containsDocuments(empty, skip())).toBe(true)
    // A sibling with a shared prefix is not invalidated.
    const sibling = join(root, 'empty-old')
    mkdirSync(sibling)
    expect(scanner.containsDocuments(sibling, skip())).toBe(false)
    scanner.invalidate(empty)
    expect(scanner.containsDocuments(sibling, skip())).toBe(false)
  })

  test('natural order', () => {
    expect(naturalCompare('9.md', '10.md')).toBeLessThan(0)
    expect(naturalCompare('a', 'B')).toBeLessThan(0)
    expect(naturalCompare('b', 'B')).toBe(0)
    expect(naturalCompare('file2', 'file10')).toBeLessThan(0)
    expect(naturalCompare('x', 'x1')).toBeLessThan(0)
  })
})
