import { describe, expect, test } from 'bun:test'
import { activeRoot, addRootAtTop, parseRoots, serializeRoots, shownRoots } from '../src/models/roots'

describe('roots.txt', () => {
  test('one path per line, blanks and duplicates dropped, order kept', () => {
    expect(parseRoots('/a\n\n/b\n/a\n  /c  \n')).toEqual(['/a', '/b', '/c'])
    expect(parseRoots(null)).toEqual([])
  })

  test('the first line is the active root', () => {
    expect(activeRoot(['/a', '/b'])).toBe('/a')
    expect(activeRoot([])).toBeNull()
  })

  test('adding floats to the top and de-duplicates', () => {
    expect(addRootAtTop(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
    expect(addRootAtTop(['/a'], '/c')).toEqual(['/c', '/a'])
  })

  test('round trips and shows at most twenty', () => {
    const many = Array.from({ length: 25 }, (_, i) => `/r${i}`)
    expect(parseRoots(serializeRoots(many))).toEqual(many)
    expect(shownRoots(many)).toHaveLength(20)
    expect(serializeRoots([])).toBe('')
  })
})
