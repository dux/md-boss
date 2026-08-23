import { describe, expect, test } from 'bun:test'
import { EXAMPLE_DIR_NAME, EXAMPLE_FILE_NAME, exampleText } from '../src/models/exampleDoc'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const DIR = `${HOME}/.config/md-boss/${EXAMPLE_DIR_NAME}`
const PATH = `${DIR}/${EXAMPLE_FILE_NAME}`

async function setup(files: Record<string, string> = {}) {
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.notes.reload()
  return { manager, files }
}

describe('the example page', () => {
  test('is written to the config dir, opened, and its folder becomes the active root', async () => {
    const { manager, files } = await setup()
    await manager.openExample()
    expect(files[PATH]).toBe(exampleText)
    expect(manager.document?.path).toBe(PATH)
    expect(manager.activeRoot).toBe(DIR)
    expect(manager.isExampleRoot(DIR)).toBe(true)
  })

  test('is reachable with no folders listed at all - the folder box pins it', async () => {
    const { manager } = await setup()
    expect(manager.activeRoot).toBe(null)
    await manager.openExample()
    expect(manager.document?.text).toBe(exampleText)
  })

  test('takes edits, and gives them up the next time it is picked', async () => {
    const { manager, files } = await setup()
    await manager.openExample()
    manager.setDocumentText('# gone')
    expect(manager.isDirty).toBe(true)

    await manager.openExample()
    expect(manager.document?.text).toBe(exampleText)
    expect(manager.isDirty).toBe(false)
    expect(files[PATH]).toBe(exampleText)
  })

  test('a saved edit is overwritten too - the page is laid down again, not merged', async () => {
    const { manager, files } = await setup()
    await manager.openExample()
    manager.setDocumentText('# saved over')
    await manager.saveDocument()
    expect(files[PATH]).toBe('# saved over')

    await manager.openExample()
    expect(files[PATH]).toBe(exampleText)
    expect(manager.document?.text).toBe(exampleText)
  })

  test('coming back from another document opens it rather than reloading in place', async () => {
    const other = `${HOME}/notes/a.md`
    const { manager } = await setup({ [other]: '# a' })
    await manager.open(other)
    expect(manager.document?.path).toBe(other)

    await manager.openExample()
    expect(manager.document?.path).toBe(PATH)
    expect(manager.document?.text).toBe(exampleText)
  })
})

describe('what the example page demonstrates', () => {
  const lines = exampleText.split('\n')

  test('opens with front matter, which the preview draws as a key/value block', () => {
    expect(lines[0]).toBe('---')
    expect(lines.slice(1, 8).join('\n')).toContain('title: Markdown Example')
    expect(lines.indexOf('---', 1)).toBeGreaterThan(0)
  })

  test('carries all three task states, including the spinner md-boss adds', () => {
    expect(exampleText).toContain('- [ ] not started')
    expect(exampleText).toContain('- [o] in progress')
    expect(exampleText).toContain('- [x] done')
  })

  test('shows each task state written as well as drawn - the marker alone is a widget', () => {
    // The rendered row is the widget; the code span next to it is the text you type to get
    // it. Without the second half the list shows three shapes and no way to reproduce them.
    for (const marker of ['[ ]', '[o]', '[x]']) {
      expect(exampleText).toContain(`- ${marker} \`${marker}\` - `)
    }
  })

  test('carries all five alert kinds', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(exampleText).toContain(`> [!${kind}]`)
    }
  })

  test('carries a table, a rule and a highlighted fence for each bundled language shown', () => {
    expect(exampleText).toContain('|:--|:-:|--:|')
    expect(exampleText).toMatch(/^---$/m)
    for (const lang of ['js', 'python', 'rust', 'sh', 'diff', 'md']) {
      expect(exampleText).toContain('```' + lang + '\n')
    }
  })

  test('every fence it opens is closed', () => {
    let fence: string | null = null
    let opened = 0
    for (const line of lines) {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (!match) continue
      const mark = match[1]![0]!
      if (!fence) {
        fence = mark
        opened += 1
      } else if (mark === fence) {
        fence = null
      }
    }
    expect(opened).toBeGreaterThan(10)
    expect(fence).toBe(null)
  })
})
