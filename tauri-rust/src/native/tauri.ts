import { invoke } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, stat, watch, writeTextFile } from '@tauri-apps/plugin-fs'
import { error as logError, info as logInfo, warn as logWarn } from '@tauri-apps/plugin-log'
import type { Native } from './bridge'

export const tauriNative: Native = {
  fs: {
    read: (path) => readTextFile(path),
    write: (path, text) => writeTextFile(path, text),
    mkdir: (dir) => mkdir(dir, { recursive: true }),

    list: async (dir) =>
      (await readDir(dir)).map((e) => ({
        name: e.name,
        isDir: e.isDirectory,
        isFile: e.isFile,
        isSymlink: e.isSymlink,
      })),

    stat: async (path) => {
      const info = await stat(path)
      return {
        isDir: info.isDirectory,
        isFile: info.isFile,
        size: info.size,
        mtime: info.mtime ? info.mtime.getTime() : null,
        ino: info.ino ?? null,
      }
    },

    exists: (path) => exists(path),
  },

  dialog: {
    openFolders: async (startIn) => {
      const picked = await open({ directory: true, multiple: true, defaultPath: startIn ?? undefined, title: 'Choose folders to show in the sidebar' })
      return picked ?? []
    },
    openFile: async (startIn) => {
      const picked = await open({ directory: false, multiple: false, defaultPath: startIn ?? undefined })
      return picked ?? null
    },
  },

  paths: {
    home: () => homeDir(),
    config: () => invoke<string>('config_dir'),
    join: (...parts) => join(...parts),
  },

  commands: {
    listDir: async (path, skipFolders) => {
      const raw = await invoke<{ kind: string; entries?: { name: string; path: string; is_dir: boolean }[] }>(
        'list_dir_cmd', { path, skipFolders },
      )
      if (raw.kind !== 'entries') return { kind: raw.kind as 'denied' | 'missing' }
      return { kind: 'entries', entries: (raw.entries ?? []).map((e) => ({ name: e.name, path: e.path, isDir: e.is_dir })) }
    },
    documentsUnder: (path, skipFolders) => invoke<string[]>('documents_under_cmd', { path, skipFolders }),
    invalidateScan: (path) => invoke<void>('invalidate_scan', { path: path ?? null }),
  },

  // A git checkout or a build tool fires dozens of events in a burst; re-listing on each
  // one would make the tree flicker and lose the cursor, so the plugin debounces for us.
  watch: (dir, onChange) => watch(dir, (event) => onChange(event.paths), { recursive: false, delayMs: 200 }),
}

/** Dev builds: what the page logs shows up in the `tauri dev` terminal, since the webview's
 *  own console is out of reach there. */
export function forwardConsoleToLog(): void {
  const wrap = (name: 'error' | 'warn' | 'info', send: (m: string) => Promise<void>) => {
    const original = console[name].bind(console)
    console[name] = (...args: unknown[]) => {
      original(...args)
      void send(args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).catch(() => {})
    }
  }
  wrap('error', logError)
  wrap('warn', logWarn)
  wrap('info', logInfo)
}
