import { describe, expect, test } from 'bun:test'
import { basename, components, dirname, joinPath, normalizePath, relativeTo } from '../src/models/paths'

describe('paths', () => {
  test('normalises dots, doubles and trailing slashes', () => {
    expect(normalizePath('/a/./b//c/')).toBe('/a/b/c')
    expect(normalizePath('/a/b/../c')).toBe('/a/c')
    expect(normalizePath('a/../../b')).toBe('../b')
    expect(normalizePath('/..')).toBe('/')
    expect(normalizePath('')).toBe('.')
  })

  test('reads backslashes and drives', () => {
    expect(normalizePath('C:\\Users\\x\\..\\y')).toBe('C:/Users/y')
    expect(components('C:/Users/y')).toEqual(['C:', 'Users', 'y'])
  })

  test('join, dirname, basename', () => {
    expect(joinPath('/work/notes', './a.md')).toBe('/work/notes/a.md')
    expect(joinPath('/work/notes', '../a.md')).toBe('/work/a.md')
    expect(dirname('/work/notes/a.md')).toBe('/work/notes')
    expect(dirname('/a')).toBe('/')
    expect(dirname('a')).toBe('.')
    expect(basename('/work/notes/a.md')).toBe('a.md')
  })

  test('components keep the root apart from a relative path', () => {
    expect(components('/a/b')).toEqual(['/', 'a', 'b'])
    expect(components('a/b')).toEqual(['a', 'b'])
  })

  test('relativeTo writes a path against its root, and refuses one that is not under it', () => {
    expect(relativeTo('/work/notes/doc/a.md', '/work/notes')).toBe('doc/a.md')
    expect(relativeTo('/work/notes/a.md', '/work/notes/')).toBe('a.md')
    expect(relativeTo('/work/notes', '/work/notes')).toBe('')
    // The boundary isUnder guards: a sibling whose name starts with the root's is not under it.
    expect(relativeTo('/work/notes-old/a.md', '/work/notes')).toBe(null)
    expect(relativeTo('/other/a.md', '/work/notes')).toBe(null)
  })
})
