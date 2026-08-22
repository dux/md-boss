import { describe, expect, test } from 'bun:test'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'
import { defaultSettings } from '../src/models/settings'
import { SAVE_DELAY_MS, SettingsStore } from '../src/models/settingsStore'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('settings store', () => {
  test('no file yet is the defaults, and a change writes the file after the debounce', async () => {
    const files: Record<string, string> = {}
    installNative(memoryNative(files))
    const store = await SettingsStore.load()
    expect(store.data).toEqual(defaultSettings())

    let seen = 0
    store.onChange(() => seen++)
    store.patch({ sidebarWidth: 300 })
    store.patch({ sidebarWidth: 300 }) // identical - no event, no extra write
    expect(seen).toBe(1)
    expect(files['/home/dev/.config/md-boss/settings.json']).toBeUndefined()

    await sleep(SAVE_DELAY_MS + 50)
    const written = files['/home/dev/.config/md-boss/settings.json']
    expect(written).toBeDefined()
    expect(JSON.parse(written).sidebarWidth).toBe(300)
  })

  test('an existing file is merged over the defaults on load', async () => {
    installNative(memoryNative({ '/home/dev/.config/md-boss/settings.json': '{"themeID":"nord"}' }))
    const store = await SettingsStore.load()
    expect(store.data.themeID).toBe('nord')
    expect(store.data.sidebarWidth).toBe(260)
  })

  test('flush writes immediately and cancels the pending write', async () => {
    const files: Record<string, string> = {}
    installNative(memoryNative(files))
    const store = await SettingsStore.load()
    store.patch({ showSidebar: false })
    await store.flush()
    expect(JSON.parse(files['/home/dev/.config/md-boss/settings.json']).showSidebar).toBe(false)
  })
})
