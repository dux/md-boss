import { describe, expect, test } from 'bun:test'
import { Manager } from '../src/models/manager'
import type { DiscardOptions } from '../src/models/prompts'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { type MemoryApp, memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const ROOT = '/home/dev/notes'
const at = (p: string) => `${ROOT}/${p}`

async function setup() {
  const files: Record<string, string> = { [at('a.md')]: '# a', [at('b.md')]: '# b' }
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  folders.add(ROOT, true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.tree.refreshAll()
  await manager.open(at('a.md'))
  manager.setDocumentText('# a edited')
  return { manager, files }
}

describe('discard-changes prompt', () => {
  test('asks with the Swift alert wording, only while the document is dirty', async () => {
    const { manager } = await setup()
    const asked: DiscardOptions[] = []
    manager.prompts.discardHandler = async (o) => {
      asked.push(o)
      return 'discard'
    }
    await manager.open(at('b.md'))
    expect(asked).toEqual([{ title: 'Save changes to a.md?', message: "Your changes will be lost if you don't save them." }])
    await manager.open(at('a.md'))
    expect(asked.length).toBe(1)
  })

  test('Save writes the buffer and the switch goes through', async () => {
    const { manager, files } = await setup()
    manager.prompts.discardHandler = async () => 'save'
    await manager.open(at('b.md'))
    expect(files[at('a.md')]).toBe('# a edited')
    expect(manager.document?.path).toBe(at('b.md'))
    expect(manager.history).toEqual([at('a.md')])
    expect(manager.toast.text).toBe('Saved a.md')
  })

  test("Don't Save leaves the file as it was and the switch goes through", async () => {
    const { manager, files } = await setup()
    manager.prompts.discardHandler = async () => 'discard'
    await manager.open(at('b.md'))
    expect(files[at('a.md')]).toBe('# a')
    expect(manager.document?.path).toBe(at('b.md'))
    expect(manager.isDirty).toBe(false)
  })

  test('Cancel stays on the dirty document with nothing written and no history pushed', async () => {
    const { manager, files } = await setup()
    manager.prompts.discardHandler = async () => 'cancel'
    await manager.open(at('b.md'))
    expect(files[at('a.md')]).toBe('# a')
    expect(manager.document?.path).toBe(at('a.md'))
    expect(manager.document?.text).toBe('# a edited')
    expect(manager.history).toEqual([])
  })

  test('a Save that fails cancels the switch and says why', async () => {
    const { manager } = await setup()
    manager.prompts.discardHandler = async () => 'save'
    native().fs.write = async () => { throw new Error('disk full') }
    await manager.open(at('b.md'))
    expect(manager.document?.path).toBe(at('a.md'))
    expect(manager.isDirty).toBe(true)
    expect(manager.toast.text).toBe('Could not save: Error: disk full')
  })

  test('nobody to ask is cancel - edits are never dropped by default', async () => {
    const { manager } = await setup()
    await manager.open(at('b.md'))
    expect(manager.document?.path).toBe(at('a.md'))
    expect(manager.isDirty).toBe(true)
  })

  test('Back and quit run the same guard', async () => {
    const { manager, files } = await setup()
    const app = native().app as MemoryApp
    manager.prompts.discardHandler = async () => 'discard'
    await manager.open(at('b.md'))
    manager.setDocumentText('# b edited')
    manager.prompts.discardHandler = async () => 'cancel'
    await manager.goBack()
    expect(manager.document?.path).toBe(at('b.md'))
    expect(manager.history).toEqual([at('a.md')])
    await manager.quit()
    expect(app.exits).toBe(0)
    manager.prompts.discardHandler = async () => 'save'
    await manager.quit()
    expect(app.exits).toBe(1)
    expect(files[at('b.md')]).toBe('# b edited')
  })
})
