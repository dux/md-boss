import { describe, expect, test } from 'bun:test'
import { buildAIStartPrompt } from '../src/models/aiStart'
import type { InstalledMarkdownComponent } from '../src/models/markdownComponents'
import { Manager } from '../src/models/manager'
import type { ChecklistOptions } from '../src/models/prompts'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const ROOT = `${HOME}/notes`
const BASE = `${ROOT}/plan.md`
const COMPONENT: InstalledMarkdownComponent = {
  type: 'custom-card',
  tag: 'md-custom-card',
  filename: 'md-custom-card.fez',
  source: '<slot />',
  info: '<p>A locally installed card with a title.</p>',
  demo: '<md-custom-card title="Example">Body.</md-custom-card>',
  example: ':::custom-card title="Example"\nBody.\n:::',
}

describe('AI start prompt', () => {
  test('describes extended Markdown and every installed component', () => {
    const prompt = buildAIStartPrompt(BASE, [COMPONENT], {
      groupTasksByTopic: false,
      splitTasksByAgent: false,
    })

    expect(prompt).toContain(`Base file: ${BASE}`)
    expect(prompt).toContain('- [ ] not started')
    expect(prompt).toContain('- [o] in progress')
    expect(prompt).toContain('- [x] done')
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(prompt).toContain(`\`${kind}\``)
    }
    expect(prompt).toContain('### `:::custom-card`')
    expect(prompt).toContain(COMPONENT.info)
    expect(prompt).toContain(COMPONENT.example)
    expect(prompt).toContain('reference data')
    expect(prompt).not.toContain('Group related tasks under clear `##` topic headings')
    expect(prompt).not.toContain('use multiple agents when the environment supports them')
  })

  test('adds only the task organization instructions selected in the dialog', () => {
    const topic = buildAIStartPrompt(BASE, [], {
      groupTasksByTopic: true,
      splitTasksByAgent: false,
    })
    expect(topic).toContain('Group related tasks under clear `##` topic headings')
    expect(topic).not.toContain('use multiple agents when the environment supports them')

    const agents = buildAIStartPrompt(BASE, [], {
      groupTasksByTopic: false,
      splitTasksByAgent: true,
    })
    expect(agents).not.toContain('Group related tasks under clear `##` topic headings')
    expect(agents).toContain('First write the complete task list')
    expect(agents).toContain('use multiple agents when the environment supports them')
    expect(agents).toContain('explicit file ownership')
  })

  test('uses a longer reference fence when a component example contains code', () => {
    const component = { ...COMPONENT, example: ':::custom-card\n```js\nwork()\n```\n:::' }
    const prompt = buildAIStartPrompt(BASE, [component], {
      groupTasksByTopic: false,
      splitTasksByAgent: false,
    })
    expect(prompt).toContain('````md\n:::custom-card\n```js\nwork()\n```\n:::\n````')
  })
})

describe('AI start command', () => {
  async function setup() {
    installNative(memoryNative({ [BASE]: '# Plan\n' }, HOME))
    const folders = await RootFolders.load()
    folders.add(ROOT, true)
    const manager = new Manager(await SettingsStore.load(), folders, HOME, `${HOME}/.config/md-boss`, () => [COMPONENT])
    await manager.open(BASE)
    return manager
  }

  test('asks through the shared checklist dialog and copies its configured prompt', async () => {
    const manager = await setup()
    let asked: ChecklistOptions | null = null
    manager.prompts.checklistHandler = async (options) => {
      asked = options
      return { groupTasksByTopic: true, splitTasksByAgent: true }
    }

    await manager.copyAIStartPrompt()

    expect(asked).not.toBeNull()
    const options = asked as ChecklistOptions | null
    expect(options?.title).toBe('Prepare AI prompt')
    expect(options?.confirm).toBe('Copy prompt')
    expect(options?.items.map((item) => ({ id: item.id, checked: item.checked }))).toEqual([
      { id: 'groupTasksByTopic', checked: true },
      { id: 'splitTasksByAgent', checked: false },
    ])
    const copied = await native().clipboard.readText()
    expect(copied).toContain(`Base file: ${BASE}`)
    expect(copied).toContain('### `:::custom-card`')
    expect(copied).toContain('Group related tasks under clear `##` topic headings')
    expect(copied).toContain('use multiple agents when the environment supports them')
    expect(manager.toast.text).toBe('AI prompt copied')
  })

  test('cancelling leaves the clipboard and toast untouched', async () => {
    const manager = await setup()
    manager.prompts.checklistHandler = async () => null

    await manager.copyAIStartPrompt()

    expect(await native().clipboard.readText()).toBeNull()
    expect(manager.toast.text).toBeNull()
  })
})
