import { describe, expect, test } from 'bun:test'
import { divergence, fenceStates, isInsideFence, splitLines } from '../src/models/markdownHighlight'

describe('fence states', () => {
  test('each line carries the fence open at its start; the closer is still inside', () => {
    const states = fenceStates(splitLines('a\n```js\ncode\n```\nb'))
    expect(states.map((f) => (f ? f.marker + f.length : null))).toEqual([null, null, '`3', '`3', null])
    expect(isInsideFence(states, 3)).toBe(true)
    expect(isInsideFence(states, 4)).toBe(true)
    expect(isInsideFence(states, 5)).toBe(false)
    expect(isInsideFence(states, 9)).toBe(false)
  })

  test('an unclosed fence runs to the end, a tilde fence is not closed by backticks', () => {
    expect(fenceStates(splitLines('~~~\n```\nx')).map((f) => f?.marker ?? null)).toEqual([null, '~', '~'])
  })

  test('divergence is the first line whose state moved, or the shorter length', () => {
    const before = fenceStates(splitLines('a\nb\nc'))
    const after = fenceStates(splitLines('a\n```\nc'))
    expect(divergence(before, after)).toBe(2)
    expect(divergence(before, before)).toBe(-1)
    expect(divergence(before, fenceStates(splitLines('a\nb\nc\nd')))).toBe(3)
    const same = fenceStates(splitLines('```\nx\n```'))
    expect(divergence(same, fenceStates(splitLines('```\ny\n```')))).toBe(-1)
  })
})
