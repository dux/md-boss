// The Native for the simple-bun shell. Two channels: the server methods go over one
// WebSocket to the bun process (JSON-RPC, `{id, method, params}`), the shell-only ones -
// menus, dialogs, clipboard, opening things, the close guard - over wry's ipc and come back
// through `window.__mdbossReply`. The shell tells the page where the server is in
// `window.__MDBOSS` before any script runs.

import type { Platform } from '../models/platform'
import type { FileDrag, Native, OpenRequest, Unwatch } from './bridge'

interface Boot {
  port: number | null
  token: string | null
  platform: Platform
  version: string
  argv: string[]
  cwd: string
  devUrl: string | null
}

declare global {
  interface Window {
    __MDBOSS?: Boot
    ipc?: { postMessage(message: string): void }
    __mdbossReply?: (id: number, result: unknown, error: string | null) => void
    __mdbossEvent?: (name: string, data: unknown) => void
  }
}

export function hasShell(): boolean {
  return typeof window !== 'undefined' && window.__MDBOSS !== undefined
}

// ---- the shell channel (wry ipc)

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
const shellPending = new Map<number, Pending>()
let shellNextId = 1
const shellListeners = new Map<string, Set<(data: unknown) => void>>()

function shell<T>(method: string, ...params: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = shellNextId++
    shellPending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    if (!window.ipc) {
      shellPending.delete(id)
      reject(new Error('no shell ipc'))
      return
    }
    window.ipc.postMessage(JSON.stringify({ id, method, params }))
  })
}

function onShell(name: string, fn: (data: unknown) => void): Unwatch {
  let set = shellListeners.get(name)
  if (!set) shellListeners.set(name, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

function installShellCallbacks(): void {
  window.__mdbossReply = (id, result, error) => {
    const p = shellPending.get(id)
    if (!p) return
    shellPending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve(result)
  }
  window.__mdbossEvent = (name, data) => {
    shellListeners.get(name)?.forEach((fn) => fn(data))
  }
}

// ---- the server channel (WebSocket to bun)

interface ServerEvent {
  event: string
  data: unknown
}

class Socket {
  private ws: WebSocket | null = null
  private ready: Promise<void> = Promise.reject(new Error('server not connected'))
  private pending = new Map<number, Pending>()
  private nextId = 1
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  private onReconnect: (() => void)[] = []

  constructor() {
    this.ready.catch(() => {})
  }

  connect(port: number, token: string): Promise<void> {
    const previous = this.ws
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc?token=${encodeURIComponent(token)}`)
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error(`server on ${port} not reachable`))
      ws.onclose = () => {
        if (this.ws !== ws) return
        for (const p of this.pending.values()) p.reject(new Error('server connection closed'))
        this.pending.clear()
      }
      ws.onmessage = (m) => this.receive(String(m.data))
    })
    previous?.close()
    return this.ready
  }

  private receive(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: string } & Partial<ServerEvent>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.event !== undefined) {
      this.listeners.get(msg.event)?.forEach((fn) => fn(msg.data))
      return
    }
    if (msg.id === undefined) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  }

  async call<T>(method: string, ...params: unknown[]): Promise<T> {
    await this.ready
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  on(event: string, fn: (data: unknown) => void): Unwatch {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  /** Called after a reconnect, so watches can be re-registered. */
  afterReconnect(fn: () => void): void {
    this.onReconnect.push(fn)
  }

  reconnected(): void {
    for (const fn of this.onReconnect) fn()
  }
}

const socket = new Socket()

/** Server-side watches by their client-side handle, re-created when the server restarts. */
interface WatchEntry {
  dir: string
  onChange: (changed: string[]) => void
  serverId: number | null
}
const watches = new Set<WatchEntry>()

async function registerWatch(entry: WatchEntry): Promise<void> {
  entry.serverId = await socket.call<number>('watch.start', entry.dir)
}

socket.on('watch', (data) => {
  const { id, changed } = data as { id: number; changed: string[] }
  for (const w of watches) if (w.serverId === id) w.onChange(changed)
})

socket.afterReconnect(() => {
  for (const w of watches) void registerWatch(w).catch(() => {})
})

/** Connects to the server the shell started, and follows it through restarts. */
export async function connectServer(): Promise<void> {
  const boot = window.__MDBOSS!
  installShellCallbacks()
  if (boot.port && boot.token) await socket.connect(boot.port, boot.token)
  onShell('server-restarted', (data) => {
    const { port, token } = data as { port: number; token: string }
    void socket.connect(port, token).then(() => socket.reconnected())
  })
}

// ---- the Native

export const bunNative: Native = {
  platform: window.__MDBOSS?.platform ?? 'macos',

  app: {
    version: () => shell<string>('app.version'),
    exit: () => shell<void>('app.exit'),
    // Telling the shell once makes it hold the close and leave the decision here.
    onCloseRequested: async (listener) => {
      await shell<void>('app.holdClose')
      return onShell('close-requested', () => listener())
    },
  },

  // Updates are the payload tarball (see TODO.md, phase 9); until that lands there is
  // nothing to offer, and the flow stays quiet.
  updater: {
    enabled: false,
    check: async () => null,
    relaunch: () => shell<void>('app.exit'),
  },

  fs: {
    read: (path) => socket.call('fs.read', path),
    write: (path, text) => socket.call('fs.write', path, text),
    create: (path) => socket.call('fs.create', path),
    rename: (from, to) => socket.call('fs.rename', from, to),
    trash: (path) => socket.call('fs.trash', path),
    mkdir: (dir) => socket.call('fs.mkdir', dir),
    list: (dir) => socket.call('fs.list', dir),
    stat: (path) => socket.call('fs.stat', path),
    exists: (path) => socket.call('fs.exists', path),
  },

  // The webview's own clipboard where it allows it (a key press is the only time the app
  // reads it), the shell's otherwise.
  clipboard: {
    readText: async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return shell<string | null>('clipboard.readText')
      }
    },
    writeText: async (text) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        await shell<void>('clipboard.writeText', text)
      }
    },
  },

  shell: {
    reveal: (path) => shell<void>('shell.reveal', path),
    openURL: (url) => shell<void>('shell.openURL', url),
    openPath: (path) => shell<void>('shell.openPath', path),
    // previewfile://localhost/ (http://previewfile.localhost/ on Windows) - the protocol
    // the shell serves images below the allowed roots from.
    assetBase: () => (window.__MDBOSS?.platform === 'windows' ? 'http://previewfile.localhost/' : 'previewfile://localhost/'),
  },

  dialog: {
    openFolders: (startIn) => shell<string[]>('dialog.openFolders', startIn),
    openFile: (startIn) => shell<string | null>('dialog.openFile', startIn),
  },

  paths: {
    home: () => socket.call('paths.home'),
    config: () => socket.call('paths.config'),
    join: (...parts) => socket.call('paths.join', ...parts),
  },

  commands: {
    listDir: (path, skipFolders) => socket.call('commands.listDir', path, skipFolders),
    documentsUnder: (path, skipFolders, limit) => socket.call('commands.documentsUnder', path, skipFolders, limit ?? null),
    search: (root, skipFolders, query, buffers, generation) =>
      socket.call('commands.search', root, skipFolders, query, buffers, generation),
    readNotes: (storePath) => socket.call('commands.readNotes', storePath),
    writeNotes: (storePath, file) => socket.call('commands.writeNotes', storePath, file),
    invalidateScan: (path) => socket.call('commands.invalidateScan', path ?? null),
    rewriteLinks: (root, skipFolders, moves, buffers, excluding, home) =>
      socket.call('commands.rewriteLinks', root, skipFolders, moves, buffers, excluding, home),
    allowAssetRoots: (roots) => shell<void>('commands.allowAssetRoots', roots),
  },

  // The shell builds the bar with muda from the same model; actions come back as `menu`
  // events by id. True: the accelerators are the OS's.
  menu: {
    install: async (menus, onAction) => {
      const ok = await shell<boolean>('menu.install', menus)
      onShell('menu', (data) => onAction((data as { id: string }).id))
      return ok
    },
    update: (patch) => shell<void>('menu.update', patch),
  },

  cli: {
    launch: () => shell<OpenRequest[]>('cli.launch'),
    onOpen: async (listener) => onShell('cli-open', (data) => listener(data as OpenRequest)),
  },

  onFileDrag: async (listener) => onShell('file-drag', (data) => listener(data as FileDrag)),

  watch: async (dir, onChange) => {
    const entry: WatchEntry = { dir, onChange, serverId: null }
    watches.add(entry)
    await registerWatch(entry)
    return () => {
      watches.delete(entry)
      if (entry.serverId !== null) void socket.call('watch.stop', entry.serverId).catch(() => {})
    }
  },
}
