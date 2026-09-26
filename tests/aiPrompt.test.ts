import { describe, expect, test } from 'bun:test'
import { systemPrompt, transcriptText, turnText, unifiedDiff, type Turn } from '../src/models/aiPrompt'

const doc = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the plan.`).join('\n')

function turn(overrides: Partial<Turn> = {}): Turn {
  return { name: 'plan.md', text: doc, lastSent: null, svgs: [], attachments: [], mode: 'write', message: 'Tighten the intro.', ...overrides }
}

describe('turn text', () => {
  test('the first turn carries the whole document, then the mode, then the message last', () => {
    const text = turnText(turn())
    expect(text.startsWith(`<document path="plan.md" state="full">\n${doc}\n</document>`)).toBe(true)
    expect(text.endsWith('<mode>write</mode>\n\nTighten the intro.')).toBe(true)
  })

  test('an unchanged document is not sent again', () => {
    expect(turnText(turn({ lastSent: doc }))).toBe('<mode>write</mode>\n\nTighten the intro.')
  })

  test('a small change goes as a diff against what the model saw', () => {
    const edited = doc.replace('Line 20 of the plan.', 'Line 20, rewritten.')
    const text = turnText(turn({ text: edited, lastSent: doc }))
    expect(text).toContain('<document path="plan.md" state="changed">\n@@ -18,5 +18,5 @@')
    expect(text).toContain('-Line 20 of the plan.\n+Line 20, rewritten.')
    expect(text).not.toContain('Line 1 of the plan.')
  })

  test('a change bigger than half the text goes whole', () => {
    const rewritten = doc.replace(/plan/g, 'roadmap')
    expect(turnText(turn({ text: rewritten, lastSent: doc }))).toContain('state="full"')
  })

  test('selected rows and SVG sources ride along before the mode', () => {
    const text = turnText(turn({
      lastSent: doc,
      svgs: [{ path: './assets/flow.svg', source: '<svg/>' }],
      attachments: [{ start: 3, end: 3, text: 'Line 3 of the plan.' }, { start: 7, end: 9, text: 'a\nb\nc' }],
      mode: 'ask',
    }))
    expect(text).toBe([
      '<image path="./assets/flow.svg">\n<svg/>\n</image>',
      '<selected lines="3">\nLine 3 of the plan.\n</selected>',
      '<selected lines="7-9">\na\nb\nc\n</selected>',
      '<mode>ask</mode>',
      'Tighten the intro.',
    ].join('\n\n'))
  })
})

describe('unified diff', () => {
  test('hunks only, no file headers', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n')).toBe('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
  })

  test('nothing changed is no hunks', () => {
    expect(unifiedDiff('same', 'same')).toBe('')
  })
})

describe('system prompt and transcript', () => {
  test('the system prompt carries the dialect and never invites asking to write', () => {
    const prompt = systemPrompt('## Markdown supported by md-boss')
    expect(prompt.endsWith('## Markdown supported by md-boss')).toBe(true)
    expect(prompt).toContain('never ask whether to write, apply or save anything')
    expect(prompt).toContain('assets/<kebab-name>.svg')
  })

  test('a lost session is replayed as a transcript', () => {
    expect(transcriptText([])).toBe('')
    const text = transcriptText([{ role: 'user', text: 'Is step 2 needed?' }, { role: 'assistant', text: 'No.' }])
    expect(text).toContain('<user>\nIs step 2 needed?\n</user>\n\n<assistant>\nNo.\n</assistant>')
    expect(text.startsWith('<transcript>')).toBe(true)
  })
})
