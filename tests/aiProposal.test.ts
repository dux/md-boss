import { describe, expect, test } from 'bun:test'
import { parseProposal, proposalDiff } from '../src/models/aiProposal'
import { editsBetween } from '../src/models/noteShift'

const answer = (overrides: Record<string, unknown> = {}) => ({
  reply: 'Done.',
  summary: 'Tightened the intro',
  document: '# Plan\n',
  images: [],
  ...overrides,
})
const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

describe('reading a proposed change', () => {
  test('a whole answer reads, an assets/ prefix on an image name is dropped', () => {
    const parsed = parseProposal(answer({ images: [{ name: 'assets/flow-chart.svg', alt: 'Flow', svg }] }))
    expect(parsed?.document).toBe('# Plan\n')
    expect(parsed?.images).toEqual([{ name: 'flow-chart.svg', alt: 'Flow', svg }])
  })

  test('anything missing or wrong-typed is no proposal at all', () => {
    expect(parseProposal(null)).toBeNull()
    expect(parseProposal('text')).toBeNull()
    expect(parseProposal(answer({ document: undefined }))).toBeNull()
    expect(parseProposal(answer({ images: 'none' }))).toBeNull()
    expect(parseProposal(answer({ images: [{ name: 'a.svg', svg }] }))).toBeNull()
  })

  test.each(['../escape.svg', 'sub/dir.svg', '.hidden.svg', 'photo.png', 'no-extension', ''])('%p is not a name Apply may write', (name) => {
    expect(parseProposal(answer({ images: [{ name, alt: '', svg }] }))).toBeNull()
  })

  test('an image must be SVG source, and names are unique', () => {
    expect(parseProposal(answer({ images: [{ name: 'a.svg', alt: '', svg: '<script>x</script>' }] }))).toBeNull()
    expect(parseProposal(answer({ images: [{ name: 'a.svg', alt: '', svg: '<?xml version="1.0"?>\n<svg></svg>' }] }))).not.toBeNull()
    const twice = [{ name: 'a.svg', alt: '', svg }, { name: 'assets/a.svg', alt: '', svg }]
    expect(parseProposal(answer({ images: twice }))).toBeNull()
  })
})

describe('the diff a proposal shows', () => {
  test('changed lines with two of context, counted, hunks apart', () => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const changed = base.replace('line 3', 'line three').replace('line 17', 'line 17\nline 17b')
    const diff = proposalDiff(base, changed)
    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(1)
    expect(diff.lines.filter((l) => l.kind === 'gap').length).toBe(1)
    expect(diff.lines.slice(0, 4)).toEqual([
      { kind: 'same', text: 'line 1' },
      { kind: 'same', text: 'line 2' },
      { kind: 'remove', text: 'line 3' },
      { kind: 'add', text: 'line three' },
    ])
  })
})

describe('edits between two texts', () => {
  test('one per changed run, in old offsets, and applied last to first they rebuild the new text', () => {
    const before = 'a\nb\nc\nd\ne\n'
    const after = 'a\nB\nc\nd\ne\nf\n'
    const edits = editsBetween(before, after)
    expect(edits.map((e) => e.edit)).toEqual([{ start: 2, end: 4, length: 2 }, { start: 10, end: 10, length: 2 }])
    let text = before
    for (const { edit, text: inserted } of [...edits].reverse()) text = text.slice(0, edit.start) + inserted + text.slice(edit.end)
    expect(text).toBe(after)
  })

  test('identical texts need no edits', () => {
    expect(editsBetween('same\n', 'same\n')).toEqual([])
  })
})
