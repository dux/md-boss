import { describe, expect, test } from 'bun:test'
import { rank, score } from '../src/models/fuzzyMatch'

describe('go to file ranking', () => {
  test('a subsequence matches, and anything else does not', () => {
    expect(score('mtv', 'MarkdownTextView.swift')).not.toBeNull()
    expect(score('zzz', 'MarkdownTextView.swift')).toBeNull()
    expect(score('vtm', 'MarkdownTextView.swift')).toBeNull()
  })

  test('the offsets point at what actually matched', () => {
    const hit = score('mtv', 'MarkdownTextView')!
    expect(hit.matched.map((i) => 'MarkdownTextView'[i])).toEqual(['M', 'T', 'V'])
  })

  test('offsets are UTF-16 even past an astral character', () => {
    const display = '🎉/notes.md'
    const hit = score('n', display)!
    expect(display[hit.matched[0]]).toBe('n')
  })

  test('an initials match beats a scattered one', () => {
    const ranked = rank('mtv', [
      '/w/app/Models/MarkdownDocumentValue.swift',
      '/w/app/Views/MarkdownTextView.swift',
    ], '/w')
    expect(ranked[0].display).toBe('app/Views/MarkdownTextView.swift')
  })

  test('a run that stays together beats one that is spread out', () => {
    const ranked = rank('note', ['/w/n-o-t-e.md', '/w/notes.md'], '/w')
    expect(ranked[0].display).toBe('notes.md')
  })

  test('recency breaks a tie and nothing more', () => {
    const ranked = rank('a', ['/w/a1.md', '/w/a2.md'], '/w', ['/w/a2.md'])
    expect(ranked[0].display).toBe('a2.md')
    const better = rank('ab', ['/w/ab.md', '/w/a_b.md'], '/w', ['/w/a_b.md'])
    expect(better[0].display).toBe('ab.md')
  })

  test('paths are shown relative to the root they were found under', () => {
    expect(rank('c', ['/w/deep/c.md'], '/w')[0].display).toBe('deep/c.md')
    expect(rank('c', ['/elsewhere/c.md'], '/w')[0].display).toBe('c.md')
  })

  test('an empty query keeps everything, in name order', () => {
    expect(rank('', ['/w/b.md', '/w/a.md'], '/w').map((r) => r.display)).toEqual(['a.md', 'b.md'])
    expect(rank('', ['/w/a10.md', '/w/a2.md'], '/w').map((r) => r.display)).toEqual(['a2.md', 'a10.md'])
  })

  test('the limit caps the list after ranking', () => {
    expect(rank('a', ['/w/a1.md', '/w/a2.md', '/w/a3.md'], '/w', [], 2)).toHaveLength(2)
  })
})
