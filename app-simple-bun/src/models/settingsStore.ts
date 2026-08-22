// The live settings: one object, read everywhere, written through `set`, persisted to
// ~/.config/md-boss/settings.json with a short debounce so a drag or a resize does not
// write a file per pixel. `flush` on quit so the last change is never lost.

import { native } from '../native/bridge'
import { defaultSettings, parseSettings, serializeSettings, type SettingsData } from './settings'

export const SETTINGS_FILE = 'settings.json'
export const SAVE_DELAY_MS = 300

export class SettingsStore {
  data: SettingsData
  private readonly path: string
  private readonly dir: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<(data: SettingsData) => void>()

  private constructor(dir: string, path: string, data: SettingsData) {
    this.dir = dir
    this.path = path
    this.data = data
  }

  /** Missing or unreadable file -> defaults; never throws at boot. */
  static async load(): Promise<SettingsStore> {
    const { fs, paths } = native()
    const dir = await paths.config()
    const path = await paths.join(dir, SETTINGS_FILE)
    let data = defaultSettings()
    try {
      if (await fs.exists(path)) data = parseSettings(await fs.read(path))
    } catch {
      // unreadable config is the same as none
    }
    return new SettingsStore(dir, path, data)
  }

  /** Replaces the settings; an identical value is a no-op, so no write and no listeners. */
  set(next: SettingsData): void {
    if (serializeSettings(next) === serializeSettings(this.data)) return
    this.data = next
    for (const listener of this.listeners) listener(next)
    this.scheduleSave()
  }

  patch(changes: Partial<SettingsData>): void {
    this.set({ ...this.data, ...changes })
  }

  onChange(listener: (data: SettingsData) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  /** Writes now; also cancels a pending debounced write. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const { fs } = native()
    await fs.mkdir(this.dir)
    await fs.write(this.path, serializeSettings(this.data))
  }
}
