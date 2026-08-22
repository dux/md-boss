import { describe, expect, test } from 'bun:test'
import { memoryNative } from '../src/native/memory'

describe('in-memory native listing', () => {
  const n = memoryNative({
    '/w/10.md': '', '/w/9.md': '', '/w/code/x.swift': '', '/w/docs/deep/guide.md': '',
    '/w/node_modules/x.md': '', '/w/.hidden/x.md': '', '/w/notes.txt': '',
  })

  test('folders with documents first, then documents, naturally ordered; empty and hidden folders gone', async () => {
    const listing = await n.commands.listDir('/w', ['node_modules'])
    expect(listing.kind).toBe('entries')
    if (listing.kind !== 'entries') return
    expect(listing.entries.map((e) => e.name)).toEqual(['docs', '9.md', '10.md', 'notes.txt'])
  })

  test('a missing folder says so', async () => {
    expect(await n.commands.listDir('/nope', [])).toEqual({ kind: 'missing' })
  })

  test('documentsUnder skips hidden and skipped folders', async () => {
    expect(await n.commands.documentsUnder('/w', ['node_modules'])).toEqual(['/w/10.md', '/w/9.md', '/w/docs/deep/guide.md', '/w/notes.txt'])
  })
})
