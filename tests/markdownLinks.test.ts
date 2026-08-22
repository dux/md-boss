import { describe, expect, test } from 'bun:test'
import { destinations, relativePath, rewriting, snippet } from '../src/models/markdownLinks'

// Synthetic /work paths throughout, as in the Swift suite.
const work = '/work/notes'
const at = (path: string) => `/work/notes/${path}`

describe('relative paths', () => {
  test('a sibling is prefixed, not bare', () => {
    expect(relativePath(work, at('a.md'))).toBe('./a.md')
  })

  test('a file below reads as one path', () => {
    expect(relativePath(work, at('sub/a.md'))).toBe('./sub/a.md')
  })

  test('climbing out is not prefixed', () => {
    expect(relativePath(at('sub'), at('a.md'))).toBe('../a.md')
    expect(relativePath(at('sub/deep'), at('a.md'))).toBe('../../a.md')
  })

  test('a cousin climbs then descends', () => {
    expect(relativePath(at('sub'), at('other/a.md'))).toBe('../other/a.md')
  })

  test('characters that would end the destination are encoded', () => {
    expect(relativePath(work, at('my notes.md'))).toBe('./my%20notes.md')
    expect(relativePath(work, at('a#b.md'))).toBe('./a%23b.md')
    expect(relativePath(work, at('a(1).md'))).toBe('./a%281%29.md')
    expect(relativePath(work, at('100%.md'))).toBe('./100%25.md')
  })

  test('angle brackets are never emitted', () => {
    const path = relativePath(work, at('a b (c).md'))
    expect(path).not.toContain('<')
    expect(path).not.toContain('>')
  })

  test('the same folder is ./', () => {
    expect(relativePath(work, work)).toBe('./')
  })

  test('backslashes are read as separators', () => {
    expect(relativePath('C:\\work\\notes', 'C:\\work\\notes\\sub\\a.md')).toBe('./sub/a.md')
  })
})

describe('link snippets', () => {
  test('a document keeps its extension in the link text', () => {
    expect(snippet(at('sub/notes.md'), work)).toBe('[notes.md](./sub/notes.md)')
  })

  test('an image is an embed, case-insensitively', () => {
    expect(snippet(at('img/shot.png'), work)).toBe('![shot.png](./img/shot.png)')
    expect(snippet(at('img/SHOT.JPEG'), work)).toBe('![SHOT.JPEG](./img/SHOT.JPEG)')
  })

  test('anything else is a plain link', () => {
    expect(snippet(at('spec.pdf'), work)).toBe('[spec.pdf](./spec.pdf)')
  })

  test('brackets in the name are escaped so they cannot close the link text', () => {
    expect(snippet(at('a[1].md'), work)).toBe('[a\\[1\\].md](./a%5B1%5D.md)')
  })
})

describe('link scanning', () => {
  const raws = (text: string) => destinations(text).map((d) => d.raw)

  test('links and images are both found, and told apart', () => {
    const found = destinations('see [a](./a.md) and ![b](./b.png)')
    expect(found.map((d) => d.raw)).toEqual(['./a.md', './b.png'])
    expect(found.map((d) => d.isImage)).toEqual([false, true])
  })

  test('link text can nest brackets and an image of its own', () => {
    expect(raws('[see [1]](./a.md)')).toEqual(['./a.md'])
    expect(raws('[![x](./x.png) more](./a.md)')).toEqual(['./x.png', './a.md'])
  })

  test('the angle-bracket form is read without its brackets', () => {
    expect(raws('[a](<my file.md>)')).toEqual(['my file.md'])
  })

  test('balanced parentheses stay part of the destination', () => {
    expect(raws('[a](./a(1).md)')).toEqual(['./a(1).md'])
  })

  test('a title is not part of the destination', () => {
    expect(raws('[a](./a.md "The Title")')).toEqual(['./a.md'])
  })

  test('fenced blocks are skipped, on either marker', () => {
    expect(raws('```\n[a](./a.md)\n```\n[b](./b.md)')).toEqual(['./b.md'])
    expect(raws('~~~\n[a](./a.md)\n~~~\n[b](./b.md)')).toEqual(['./b.md'])
  })

  test('a fence closes only on a run at least as long as its opener', () => {
    expect(raws('````\n```\n[a](./a.md)\n````\n[b](./b.md)')).toEqual(['./b.md'])
  })

  test('inline code spans are skipped, whatever their run length', () => {
    expect(raws('`[a](./a.md)` and [b](./b.md)')).toEqual(['./b.md'])
    expect(raws('``a ` [x](./x.md)`` and [b](./b.md)')).toEqual(['./b.md'])
  })

  test('escaped brackets do not open a link', () => {
    expect(raws('\\[not a link\\](./a.md) [b](./b.md)')).toEqual(['./b.md'])
  })

  test('reference definitions and shortcut references are left alone', () => {
    expect(raws('[id]: ./a.md\n[x][id]\n[y][]')).toEqual([])
  })

  test('a stray bracket-paren in prose does not eat the rest of the file', () => {
    expect(raws('a ]( b\n[c](./c.md)')).toEqual(['./c.md'])
  })

  test('ranges point at the destination token in the source', () => {
    const text = 'x [a](./a.md "t") y'
    const [d] = destinations(text)
    expect(text.slice(d.range.start, d.range.end)).toBe('./a.md')
  })
})

describe('link rewriting', () => {
  const moves = [{ old: at('a.md'), new: at('sub/a.md') }]
  const rewrite = (text: string, directory = work) => rewriting(text, directory, moves)?.text ?? null

  test('only the destinations that point at the moved file change', () => {
    expect(rewrite('[a](./a.md) and [b](./b.md)')).toBe('[a](./sub/a.md) and [b](./b.md)')
  })

  test('a link from a subfolder is recomputed from where it lives', () => {
    expect(rewrite('[a](../a.md)', at('deep'))).toBe('[a](../sub/a.md)')
  })

  test('an absolute destination follows the move too', () => {
    expect(rewrite('[a](/work/notes/a.md)')).toBe('[a](./sub/a.md)')
  })

  test('a tilde destination follows the move when home is known', () => {
    const text = '[a](~/notes/a.md)'
    expect(rewriting(text, work, moves, { home: '/work' })?.text).toBe('[a](./sub/a.md)')
    expect(rewriting(text, work, moves)).toBeNull()
  })

  test('an anchor survives the rewrite', () => {
    expect(rewrite('[a](./a.md#plan)')).toBe('[a](./sub/a.md#plan)')
  })

  test('an editor-style line suffix survives the rewrite', () => {
    expect(rewrite('[a](./a.md:14)')).toBe('[a](./sub/a.md:14)')
    expect(rewrite('[a](./a.md:14:3)')).toBe('[a](./sub/a.md:14:3)')
  })

  test('a percent-encoded destination is matched after decoding', () => {
    const spaced = [{ old: at('my notes.md'), new: at('sub/my notes.md') }]
    expect(rewriting('[a](./my%20notes.md)', work, spaced)?.text).toBe('[a](./sub/my%20notes.md)')
  })

  test('external links are never touched', () => {
    expect(rewrite('[a](https://example.com/a.md) [b](mailto:x@y.z) [c](#a.md)')).toBeNull()
  })

  test('a title and the link text come through untouched', () => {
    expect(rewrite('[the **a**](./a.md "Title")')).toBe('[the **a**](./sub/a.md "Title")')
  })

  test('two links on one line are both rewritten and counted', () => {
    const result = rewriting('[a](./a.md) [again](./a.md)', work, moves)
    expect(result?.count).toBe(2)
    expect(result?.text).toBe('[a](./sub/a.md) [again](./sub/a.md)')
  })

  test('nothing to do is null, so the caller never writes the file back', () => {
    expect(rewrite('no links here')).toBeNull()
    expect(rewrite('[b](./b.md)')).toBeNull()
    expect(rewriting('[a](./a.md)', work, [])).toBeNull()
  })

  test('Windows line endings are not normalised on the way through', () => {
    expect(rewrite('one\r\n[a](./a.md)\r\ntwo')).toBe('one\r\n[a](./sub/a.md)\r\ntwo')
  })

  test('a link inside a fenced block is left broken rather than silently edited', () => {
    expect(rewrite('```\n[a](./a.md)\n```')).toBeNull()
  })
})
