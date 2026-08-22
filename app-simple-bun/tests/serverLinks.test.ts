import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { plan, run } from '../server/links'

const made: string[] = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'md-boss-links-'))
  made.push(root)
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('link rewrite pass', () => {
  test('rewrites every document that pointed at a moved file, and only those', () => {
    const root = fixture({
      'a.md': 'see [b](./b.md) and ![img](./img.png)\n',
      'sub/c.md': 'up [b](../b.md)\r\nkeep [x](./x.md)\r\n',
      'sub/x.md': 'nothing\n',
      'node_modules/n.md': '[b](../b.md)\n',
    })
    const moves = [{ old: join(root, 'b.md'), new: join(root, 'moved/b.md') }]
    const planned = plan(root, new Set(['node_modules']), moves, {}, new Set(), null)
    expect(planned.map((r) => r.path.slice(root.length)).sort()).toEqual(['/a.md', '/sub/c.md'])
    const outcome = run(root, new Set(['node_modules']), moves, {}, new Set(), null)
    expect(outcome.failed).toEqual([])
    expect(outcome.written.length).toBe(2)
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('see [b](./moved/b.md) and ![img](./img.png)\n')
    // CRLF survives the splice
    expect(readFileSync(join(root, 'sub/c.md'), 'utf8')).toBe('up [b](../moved/b.md)\r\nkeep [x](./x.md)\r\n')
    expect(readFileSync(join(root, 'node_modules/n.md'), 'utf8')).toBe('[b](../b.md)\n')
  })

  test('buffers win over the disk and come back rewritten; excluded files are never read', () => {
    const root = fixture({ 'a.md': 'disk [b](./b.md)\n', 'e.md': '[b](./b.md)\n' })
    const moves = [{ old: join(root, 'b.md'), new: join(root, 'sub/b.md') }]
    const buffers = { [join(root, 'a.md')]: 'typed [b](./b.md)\n' }
    const outcome = run(root, new Set(), moves, buffers, new Set([join(root, 'e.md')]), null)
    expect(outcome.written).toEqual([])
    expect(outcome.buffered).toEqual([{ path: join(root, 'a.md'), text: 'typed [b](./sub/b.md)\n', count: 1 }])
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('disk [b](./b.md)\n')
    expect(readFileSync(join(root, 'e.md'), 'utf8')).toBe('[b](./b.md)\n')
  })

  test('no moves, no work', () => {
    const root = fixture({ 'a.md': '[b](./b.md)\n' })
    expect(plan(root, new Set(), [], {}, new Set(), null)).toEqual([])
  })
})
