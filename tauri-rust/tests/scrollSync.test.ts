import { describe, expect, test } from 'bun:test'
import { type Move, QUIET_MS, ScrollSync } from '../src/models/scrollSync'

describe('ScrollSync', () => {
  const setup = (bothUp = true) => {
    const sync = new ScrollSync(() => bothUp)
    const moves: Move[] = []
    sync.onMove((m) => moves.push(m))
    return { sync, moves }
  }

  test('a move is dropped unless both panes are up', () => {
    const { sync, moves } = setup(false)
    expect(sync.report(3, 'raw', 0)).toBe(false)
    expect(moves).toEqual([])
  })

  test('the driver keeps driving; the follower waits for the quiet window', () => {
    const { sync, moves } = setup()
    expect(sync.report(3.5, 'raw', 0)).toBe(true)
    sync.applied(10) // the preview followed
    expect(sync.report(4, 'raw', 20)).toBe(true) // driver still drives
    expect(sync.report(9, 'preview', 30)).toBe(false) // fling echo inside the window
    expect(sync.report(9, 'preview', 10 + QUIET_MS + 1)).toBe(true) // quiet, so it takes over
    sync.applied(10 + QUIET_MS + 5) // raw followed, and is now the one that has to wait
    expect(sync.report(5, 'raw', 10 + QUIET_MS + 10)).toBe(false)
    expect(moves.map((m) => [m.line, m.source])).toEqual([[3.5, 'raw'], [4, 'raw'], [9, 'preview']])
  })

  test('reset forgets the driver', () => {
    const { sync } = setup()
    sync.report(1, 'raw', 0)
    sync.applied(5)
    expect(sync.report(2, 'preview', 6)).toBe(false)
    sync.reset()
    expect(sync.report(2, 'preview', 7)).toBe(true)
  })
})
