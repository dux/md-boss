import { getVersion } from '@tauri-apps/api/app'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { homeDir, join } from '@tauri-apps/api/path'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ask, open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, readDir, readTextFile, rename, stat, watch, writeTextFile } from '@tauri-apps/plugin-fs'
import { error as logError, info as logInfo, warn as logWarn } from '@tauri-apps/plugin-log'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import type { MenuEntry } from '../models/appMenu'
import { platformFromUserAgent } from '../models/platform'
import type { Native, NotesFile, RewriteOutcome, SearchResult } from './bridge'

const platform = platformFromUserAgent(navigator.userAgent)

/** The action and check items by id, for the patches that follow a state change. */
const menuItems = new Map<string, MenuItem | CheckMenuItem>()

async function menuEntry(entry: MenuEntry, onAction: (id: string) => void): Promise<MenuItem | CheckMenuItem | PredefinedMenuItem> {
  switch (entry.kind) {
    case 'separator':
      return PredefinedMenuItem.new({ item: 'Separator' })
    case 'predefined':
      return PredefinedMenuItem.new({ item: entry.item, text: entry.label })
    case 'about': {
      const { name, version, comments, website, websiteLabel, credits, authors } = entry.info
      return PredefinedMenuItem.new({ text: entry.label, item: { About: { name, version, comments, website, websiteLabel, credits, authors } } })
    }
    case 'item': {
      const options = {
        id: entry.id,
        text: entry.label,
        enabled: entry.enabled,
        accelerator: entry.native && entry.accelerator ? entry.accelerator : undefined,
        action: () => onAction(entry.id),
      }
      const item = entry.checked === undefined
        ? await MenuItem.new(options)
        : await CheckMenuItem.new({ ...options, checked: entry.checked })
      menuItems.set(entry.id, item)
      return item
    }
  }
}

export const tauriNative: Native = {
  platform,
  app: {
    version: () => getVersion(),
  },
  fs: {
    read: (path) => readTextFile(path),
    write: (path, text) => writeTextFile(path, text),
    // createNew rather than an exists check: the answer can change between asking and
    // writing, and this is the one call that must not clobber.
    create: (path) => writeTextFile(path, '', { createNew: true }),
    rename: (from, to) => rename(from, to),
    trash: (path) => invoke<void>('trash_cmd', { path }),
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

  // The webview's own clipboard: WebKit and WebView2 allow readText from a key press, which
  // is the only time the app reads it (Cmd-K). The clipboard plugin can replace this if a
  // platform turns out to prompt.
  clipboard: {
    readText: async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return null
      }
    },
    writeText: (text) => navigator.clipboard.writeText(text),
  },

  shell: {
    reveal: (path) => revealItemInDir(path),
    openURL: (url) => openUrl(url),
    openPath: (path) => openPath(path),
    // convertFileSrc('') is the protocol's own prefix - asset://localhost/ here, and
    // http://asset.localhost/ on Windows - which is what the page appends an encoded path to.
    assetBase: () => convertFileSrc(''),
  },

  dialog: {
    confirm: (message, okLabel, cancelLabel) => ask(message, { kind: 'warning', okLabel, cancelLabel }),
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
    search: (root, skipFolders, query, buffers, generation) =>
      invoke<SearchResult>('search_cmd', { root, skipFolders, query, buffers, generation }),
    readNotes: (storePath) => invoke<NotesFile>('read_notes_cmd', { path: storePath }),
    writeNotes: (storePath, file) => invoke<void>('write_notes_cmd', { path: storePath, file }),
    invalidateScan: (path) => invoke<void>('invalidate_scan', { path: path ?? null }),
    rewriteLinks: (root, skipFolders, moves, buffers, excluding, home) =>
      invoke<RewriteOutcome>('rewrite_links_cmd', { root, skipFolders, moves, buffers, excluding, home }),
    allowAssetRoots: (roots) => invoke<void>('allow_asset_roots_cmd', { roots }),
  },

  // One Submenu per top-level menu, every item created with its handle kept, the whole
  // thing set as the app menu - the window menu bar on Windows and Linux, the global one
  // on macOS, where the Window and Help menus are also registered as such so the OS adds
  // the window list and the Help search box.
  menu: {
    install: async (menus, onAction) => {
      menuItems.clear()
      const submenus: Submenu[] = []
      for (const model of menus) {
        const items = await Promise.all(model.items.map((entry) => menuEntry(entry, onAction)))
        const submenu = await Submenu.new({ id: model.id, text: model.label, items })
        if (platform === 'macos' && model.role === 'window') await submenu.setAsWindowsMenuForNSApp()
        if (platform === 'macos' && model.role === 'help') await submenu.setAsHelpMenuForNSApp()
        submenus.push(submenu)
      }
      const menu = await Menu.new({ items: submenus })
      await menu.setAsAppMenu()
      return true
    },
    update: async (patch) => {
      const item = menuItems.get(patch.id)
      if (!item) return
      if (patch.label !== undefined) await item.setText(patch.label)
      if (patch.enabled !== undefined) await item.setEnabled(patch.enabled)
      if (patch.checked !== undefined && item instanceof CheckMenuItem) await item.setChecked(patch.checked)
    },
  },

  // The event's position is typed PhysicalPosition, but wry fills it per platform: macOS
  // (NSDraggingInfo.draggingLocation, in points) and GTK (widget coordinates) already give
  // CSS pixels, WebView2 (ScreenToClient) gives device pixels. Divided where it has to be,
  // so the pane sees one coordinate system.
  onFileDrag: (listener) =>
    getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload
      const scale = platform === 'windows' ? window.devicePixelRatio || 1 : 1
      const at = p.type === 'leave' ? { x: 0, y: 0 } : { x: p.position.x / scale, y: p.position.y / scale }
      const paths = p.type === 'enter' || p.type === 'drop' ? p.paths : []
      listener({ kind: p.type, paths, ...at })
    }),

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
