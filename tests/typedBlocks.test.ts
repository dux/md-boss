import { describe, expect, test } from 'bun:test'
import { typedBlockAttributes, typedBlockMarker, typedBlocks } from '../src/models/typedBlocks'

describe('typed block attributes', () => {
  test('reads quoted, bare and boolean-style props', () => {
    expect(typedBlockAttributes('title="Implementation details" tone=quiet open')).toEqual({
      title: 'Implementation details',
      tone: 'quiet',
      open: '',
    })
  })
})

describe('typed block markers', () => {
  test('reports exact source offsets for highlighting', () => {
    expect(typedBlockMarker('  :::details title="More"')).toEqual({
      kind: 'open',
      markerStart: 2,
      markerEnd: 5,
      typeStart: 5,
      typeEnd: 12,
      attributesStart: 13,
      type: 'details',
      attributes: 'title="More"',
    })
    expect(typedBlockMarker(' :::')).toEqual({ kind: 'close', markerStart: 1, markerEnd: 4 })
  })
})

describe('typed blocks', () => {
  test('accepts compact and three-colon openers', () => {
    expect(typedBlocks('::info\nUseful.\n:::\n\n:::warning\nCareful.\n:::')).toEqual([
      { type: 'info', attributes: {}, openLine: 1, closeLine: 3 },
      { type: 'warning', attributes: {}, openLine: 5, closeLine: 7 },
    ])
  })

  test('carries props and emits a nested child before its parent', () => {
    expect(typedBlocks([
      ':::details title="Implementation details"',
      'before',
      ':::info tone=quiet',
      'inside',
      ':::',
      'after',
      ':::',
    ].join('\n'))).toEqual([
      { type: 'info', attributes: { tone: 'quiet' }, openLine: 3, closeLine: 5 },
      { type: 'details', attributes: { title: 'Implementation details' }, openLine: 1, closeLine: 7 },
    ])
  })

  test('ignores directive-looking lines in fences and leading front matter', () => {
    const source = [
      '---',
      'example: :::info',
      '---',
      '```md',
      ':::warning',
      ':::',
      '```',
      ':::info',
      'real',
      ':::',
    ].join('\n')
    expect(typedBlocks(source)).toEqual([
      { type: 'info', attributes: {}, openLine: 8, closeLine: 10 },
    ])
  })

  test('leaves unclosed syntax and its closed children as Markdown', () => {
    expect(typedBlocks(':::details\n:::info\nchild\n:::')).toEqual([])
    expect(typedBlocks(':::info\nnever closed')).toEqual([])
  })

  test('requires a lowercase portable component type', () => {
    expect(typedBlocks(':::Info\nno\n:::')).toEqual([])
    expect(typedBlocks(':::two_words\nno\n:::')).toEqual([])
  })
})
