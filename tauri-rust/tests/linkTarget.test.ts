import { describe, expect, test } from 'bun:test'
import { documentBaseURL, fileURL, pathFromFileURL, resolveLinkTarget, strippingLineSuffix, type PathProbe } from '../src/models/linkTarget'

// The disk as the MarkdownLinkTarget tests described it: one document, one folder, and
// a file whose name really does end in a colon and digits.
const disk: Record<string, 'file' | 'dir'> = {
  '/work/notes': 'dir',
  '/work/notes/a.md': 'file',
  '/work/notes/spec.pdf': 'file',
  '/work/notes/app/Foo.swift': 'file',
  '/work/notes/log:12': 'file',
}
const probe: PathProbe = async (path) => disk[path] ?? null

describe('file URLs', () => {
  test('a path becomes a file URL with each component encoded, and back', () => {
    expect(fileURL('/work/my notes/a#1.md')).toBe('file:///work/my%20notes/a%231.md')
    expect(pathFromFileURL('file:///work/my%20notes/a%231.md')).toEqual({ path: '/work/my notes/a#1.md', fragment: null })
  })

  test('a Windows drive keeps its colon and loses the leading slash on the way back', () => {
    expect(fileURL('C:\\Users\\me\\a.md')).toBe('file:///C:/Users/me/a.md')
    expect(pathFromFileURL('file:///C:/Users/me/a.md')?.path).toBe('C:/Users/me/a.md')
  })

  test('the fragment rides alongside the path, still encoded, and an empty one is none', () => {
    expect(pathFromFileURL('file:///work/a.md#some-heading')).toEqual({ path: '/work/a.md', fragment: 'some-heading' })
    expect(pathFromFileURL('file:///work/a.md#')?.fragment).toBeNull()
    expect(pathFromFileURL('file:///work/a.md#%C3%A9')?.fragment).toBe('%C3%A9')
  })

  test('the browser has collapsed dot segments, and so does the path', () => {
    expect(pathFromFileURL('file:///work/notes/../other/a.md')?.path).toBe('/work/other/a.md')
  })

  test('anything that is not a file URL is null', () => {
    expect(pathFromFileURL('https://example.com/a.md')).toBeNull()
    expect(pathFromFileURL('mailto:me@example.com')).toBeNull()
    expect(pathFromFileURL('not a url')).toBeNull()
  })

  test("the page's base is the document's folder, slash-terminated", () => {
    expect(documentBaseURL('/work/notes/a.md')).toBe('file:///work/notes/')
    expect(documentBaseURL('/a.md')).toBe('file:///')
  })
})

describe('line suffixes', () => {
  test('":14" and ":14:3" are stripped; anything else is not a suffix', () => {
    expect(strippingLineSuffix('/x/Foo.swift:14')).toBe('/x/Foo.swift')
    expect(strippingLineSuffix('/x/Foo.swift:14:3')).toBe('/x/Foo.swift')
    expect(strippingLineSuffix('/x/Foo.swift')).toBeNull()
    expect(strippingLineSuffix('/x/Foo.swift:abc')).toBeNull()
  })
})

describe('link targets', () => {
  test('a non-file scheme is external, untouched', async () => {
    expect(await resolveLinkTarget('https://example.com/x?y=1#z', probe)).toEqual({ kind: 'external', url: 'https://example.com/x?y=1#z' })
    expect(await resolveLinkTarget('mailto:me@example.com', probe)).toEqual({ kind: 'external', url: 'mailto:me@example.com' })
  })

  test('a file on disk is a file, with its fragment; a folder is a directory', async () => {
    expect(await resolveLinkTarget('file:///work/notes/a.md', probe)).toEqual({ kind: 'file', path: '/work/notes/a.md', fragment: null })
    expect(await resolveLinkTarget('file:///work/notes/a.md#intro', probe)).toEqual({ kind: 'file', path: '/work/notes/a.md', fragment: 'intro' })
    expect(await resolveLinkTarget('file:///work/notes/', probe)).toEqual({ kind: 'directory', path: '/work/notes' })
  })

  test('an editor-style line suffix is tried only after the literal path misses', async () => {
    expect(await resolveLinkTarget('file:///work/notes/app/Foo.swift:14', probe)).toEqual({ kind: 'file', path: '/work/notes/app/Foo.swift', fragment: null })
    expect(await resolveLinkTarget('file:///work/notes/app/Foo.swift:14:3', probe)).toMatchObject({ kind: 'file', path: '/work/notes/app/Foo.swift' })
    // A colon is a legal character in a file name.
    expect(await resolveLinkTarget('file:///work/notes/log:12', probe)).toMatchObject({ kind: 'file', path: '/work/notes/log:12' })
  })

  test('nothing on disk is missing, reported by the path that was tried', async () => {
    expect(await resolveLinkTarget('file:///work/notes/gone.md', probe)).toEqual({ kind: 'missing', path: '/work/notes/gone.md' })
    expect(await resolveLinkTarget('file:///work/notes/gone.md:3', probe)).toEqual({ kind: 'missing', path: '/work/notes/gone.md:3' })
  })
})
