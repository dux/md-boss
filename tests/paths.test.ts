import { describe, expect, test } from 'bun:test'
import { basename, components, dirname, joinPath, normalizePath } from '../src/models/paths'

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
})
