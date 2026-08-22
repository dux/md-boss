import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readNotes, writeNotes } from '../server/notes'
import { note } from '../src/models/notes'

const made: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-boss-notes-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('notes store', () => {
  test('round trip and removal when emptied', () => {
    const store = join(scratch(), '.md-boss')
    expect(readNotes(store)).toEqual({ notes: [] })
    const file = { notes: [note('~/a.md', 3, 'Plan', 'revisit')] }
    writeNotes(store, file)
    expect(readNotes(store)).toEqual(file)
    expect(existsSync(`${store}.tmp`)).toBe(false)
    writeNotes(store, { notes: [] })
    expect(existsSync(store)).toBe(false)
    // removing what is already gone is fine
    writeNotes(store, { notes: [] })
  })

  test('a legacy file converts itself when touched', () => {
    const store = join(scratch(), '.md-boss')
    writeFileSync(store, '{"bookmarks": [{"path": "~/a.md", "line": 3, "title": "Plan"}]}')
    const read = readNotes(store)
    expect(read.notes).toEqual([note('~/a.md', 3, 'Plan', '')])
    writeNotes(store, read)
    const text = readFileSync(store, 'utf8')
    expect(text).toContain('"notes"')
    expect(text).not.toContain('bookmarks')
  })

  test('malformed reads as empty', () => {
    const store = join(scratch(), '.md-boss')
    writeFileSync(store, 'not json')
    expect(readNotes(store)).toEqual({ notes: [] })
  })
})
