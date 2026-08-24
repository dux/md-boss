import { describe, expect, test } from 'bun:test'
import { completedTaskIndexes } from '../src/models/taskCompletion'

describe('completed task transitions', () => {
  test('finds every in-progress spelling that becomes done', () => {
    const before = '- [o] one\n- [O] two\n- [*] three\n- [ ] four'
    const after = '- [x] one\n- [X] two\n- [x] three\n- [x] four'
    expect(completedTaskIndexes(before, after)).toEqual([0, 1, 2])
  })

  test('matches unchanged task text after unrelated lines move it', () => {
    const before = '# Work\n\n> - [ ] quoted\n\n- [o] ship it\n- [ ] later'
    const after = '# Work\n\n> - [ ] quoted\n\nNew context.\n\n- [ ] later\n- [x] ship it'
    expect(completedTaskIndexes(before, after)).toEqual([2])
  })

  test('ignores other state changes, renamed tasks, and fenced examples', () => {
    const before = '- [ ] queued\n- [o] old name\n```md\n- [o] example\n```'
    const after = '- [x] queued\n- [x] new name\n```md\n- [x] example\n```'
    expect(completedTaskIndexes(before, after)).toEqual([])
  })

  test('matches duplicate task text by occurrence', () => {
    const before = '- [x] repeat\n- [o] repeat'
    const after = '- [x] repeat\n- [x] repeat'
    expect(completedTaskIndexes(before, after)).toEqual([1])
  })
})
