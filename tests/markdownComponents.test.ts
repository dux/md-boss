import { describe, expect, test } from 'bun:test'
import { componentDocumentation, componentExample, componentType, FEZ_AGENTS_URL, MarkdownComponents } from '../src/models/markdownComponents'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const CONFIG = `${HOME}/.config/md-boss`
const DIR = `${CONFIG}/components`

describe('installed Markdown components', () => {
  test('installs editable defaults when the component folder is first created', async () => {
    const files: Record<string, string> = {}
    installNative(memoryNative(files, HOME))
    const components = await MarkdownComponents.load(CONFIG)

    expect(components.items.map((item) => item.type)).toEqual(['details', 'info', 'warning'])
    expect(files[`${DIR}/md-details.fez`]).toContain("props.title || 'Details'")
    expect(files[`${DIR}/md-info.fez`]).toContain('<slot />')
    expect(files[`${DIR}/md-warning.fez`]).toContain('var(--alert-caution)')
  })

  test('an existing component folder is authoritative and never reseeded', async () => {
    const files: Record<string, string> = {
      [`${DIR}/md-custom-card.fez`]: '<info>Custom card.</info>\n<demo><md-custom-card>Example.</md-custom-card></demo>\n<slot />\n',
      [`${DIR}/README.md`]: 'not a component\n',
    }
    installNative(memoryNative(files, HOME))
    const components = await MarkdownComponents.load(CONFIG)

    expect(components.items).toEqual([{
      type: 'custom-card',
      tag: 'md-custom-card',
      filename: 'md-custom-card.fez',
      source: '<info>Custom card.</info>\n<demo><md-custom-card>Example.</md-custom-card></demo>\n<slot />\n',
      info: 'Custom card.',
      demo: '<md-custom-card>Example.</md-custom-card>',
      example: ':::custom-card\nExample.\n:::',
    }])
    expect(files[`${DIR}/md-info.fez`]).toBeUndefined()
  })

  test('loads a component only when both documentation blocks have content', async () => {
    const files: Record<string, string> = {
      [`${DIR}/md-no-info.fez`]: '<demo><md-no-info></md-no-info></demo>\n<slot />\n',
      [`${DIR}/md-no-demo.fez`]: '<info>Undemonstrated.</info>\n<slot />\n',
      [`${DIR}/md-empty.fez`]: '<info> </info>\n<demo> </demo>\n<slot />\n',
      [`${DIR}/md-wrong-demo.fez`]: '<info>Wrong tag.</info>\n<demo><md-other>Example.</md-other></demo>\n<slot />\n',
    }
    installNative(memoryNative(files, HOME))
    const components = await MarkdownComponents.load(CONFIG)

    expect(components.items).toEqual([])
  })

  test('the starter is ready for a local harness and names the installed folder', async () => {
    installNative(memoryNative({}, HOME))
    const components = await MarkdownComponents.load(CONFIG)
    const prompt = components.starterPrompt()

    expect(prompt).toContain(DIR)
    expect(prompt).toContain(FEZ_AGENTS_URL)
    expect(prompt).toContain(':::details title="Implementation details"')
    expect(prompt).toContain(`bunx @dinoreic/fez compile ${DIR}/md-<type>.fez`)
    expect(prompt).toContain('Never use literal colors')
    expect(prompt).toContain('non-empty <info> block')
    expect(prompt).toContain('non-empty <demo> block')
  })
})

describe('component examples', () => {
  test('turns a matching Fez demo into typed Markdown with props and readable content', () => {
    expect(componentExample('details', '<md-details title="Implementation details"><p>Longer <strong>optional</strong> explanation.</p></md-details>')).toBe(
      ':::details title="Implementation details"\nLonger **optional** explanation.\n:::',
    )
  })

  test('accepts an empty self-closing demo and rejects another component tag', () => {
    expect(componentExample('divider', '<md-divider />')).toBe(':::divider\n:::')
    expect(componentExample('info', '<md-warning>Wrong component.</md-warning>')).toBeNull()
  })
})

describe('component documentation', () => {
  test('extracts trimmed info and demo blocks', () => {
    expect(componentDocumentation(`
<info>
  <p>A documented component.</p>
</info>
<demo>
  <md-card title="Example"></md-card>
</demo>
`)).toEqual({
      info: '<p>A documented component.</p>',
      demo: '<md-card title="Example"></md-card>',
    })
  })

  test('requires both blocks to be non-empty', () => {
    expect(componentDocumentation('<info>Documented.</info>')).toBeNull()
    expect(componentDocumentation('<info></info><demo><md-card></md-card></demo>')).toBeNull()
  })
})

describe('component filenames', () => {
  test('map lowercase kebab-case Fez files to types', () => {
    expect(componentType('md-info.fez')).toBe('info')
    expect(componentType('md-custom-card.fez')).toBe('custom-card')
  })

  test('rejects names that are not portable Markdown types', () => {
    for (const name of ['info.fez', 'md-Info.fez', 'md-two_words.fez', 'md-info.js', 'md-.fez']) {
      expect(componentType(name)).toBeNull()
    }
  })
})
