import { isDocument } from '../models/fileKinds'
import type { Entry, Listing, Native, Stat, Unwatch } from './bridge'

// An in-memory Native over a { "/abs/path/file.md": "text" } map - what the tests and
// the browser dev page (vite without Tauri) run against.
export function memoryNative(files: Record<string, string>, home = '/home/dev'): Native {
  const paths = () => Object.keys(files)
  const norm = (p: string) => p.replace(/\/+$/, '') || '/'
  // Directories exist implicitly above every file, plus whatever mkdir created.
  const dirs = new Set<string>()
  // Watchers fire for writes made through this Native; a test that pokes the map directly
  // is a change no watcher saw, which is what the backstop poll is for.
  const watchers = new Set<{ dir: string; cb: (changed: string[]) => void }>()
  const notify = (path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    for (const w of watchers) if (w.dir === parent) queueMicrotask(() => w.cb([path]))
  }
  const isDir = (made: Set<string>, p: string) =>
    made.has(norm(p)) || [...made].some((d) => d.startsWith(norm(p) + '/')) || paths().some((f) => f.startsWith(norm(p) + '/'))

  const list = async (dir: string): Promise<Entry[]> => {
    const prefix = norm(dir) + '/'
    const names = new Map<string, boolean>()
    for (const f of paths()) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      names.set(name, names.get(name) || slash !== -1)
    }
    return [...names].map(([name, dir]) => ({ name, isDir: dir, isFile: !dir, isSymlink: false }))
  }

  const stat = async (p: string): Promise<Stat> => {
    if (p in files) return { isDir: false, isFile: true, size: files[p].length, mtime: null, ino: null }
    if (isDir(dirs, p)) return { isDir: true, isFile: false, size: 0, mtime: null, ino: null }
    throw new Error(`no such file: ${p}`)
  }

  const roots = [...new Set(paths().map((f) => f.split('/').slice(0, -1).join('/')))]
    .sort((a, b) => a.length - b.length)

  return {
    fs: {
      read: async (p) => {
        if (!(p in files)) throw new Error(`no such file: ${p}`)
        return files[p]
      },
      write: async (p, text) => {
        if (!isDir(dirs, p.slice(0, p.lastIndexOf('/')))) throw new Error(`no such directory for: ${p}`)
        files[p] = text
        notify(p)
      },
      mkdir: async (dir) => {
        dirs.add(norm(dir))
      },
      list,
      stat,
      exists: async (p) => p in files || isDir(dirs, p),
    },
    dialog: {
      openFolders: async () => roots.slice(0, 1),
      openFile: async () => paths().find((p) => p.endsWith('.md')) ?? null,
    },
    paths: {
      home: async () => home,
      config: async () => `${home}/.config/md-boss`,
      join: async (...parts) => parts.join('/').replace(/\/{2,}/g, '/'),
    },

    // The same rules walk.rs applies, over the map: hidden and skipped folders left out,
    // folders shown only when a document sits somewhere below them.
    commands: {
      listDir: async (dir, skipFolders): Promise<Listing> => {
        const root = norm(dir)
        if (!isDir(dirs, root)) return { kind: 'missing' }
        const skip = new Set(skipFolders)
        const entries = (await list(root))
          .filter((e) => !e.name.startsWith('.'))
          .filter((e) => (e.isDir ? !skip.has(e.name) && documentsBelow(`${root}/${e.name}`, skip).length > 0 : isDocument(e.name)))
          .map((e) => ({ name: e.name, path: `${root}/${e.name}`, isDir: e.isDir }))
          .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        return { kind: 'entries', entries }
      },
      documentsUnder: async (dir, skipFolders) => documentsBelow(norm(dir), new Set(skipFolders)),
      invalidateScan: async () => {},
    },

    watch: async (dir, cb): Promise<Unwatch> => {
      const entry = { dir: norm(dir), cb }
      watchers.add(entry)
      return () => watchers.delete(entry)
    },
  }

  function documentsBelow(dir: string, skip: Set<string>): string[] {
    const prefix = dir + '/'
    return paths()
      .filter((f) => f.startsWith(prefix) && isDocument(f))
      .filter((f) => f.slice(prefix.length).split('/').every((part, i, parts) => !part.startsWith('.') && (i === parts.length - 1 || !skip.has(part))))
      .sort()
  }
}
