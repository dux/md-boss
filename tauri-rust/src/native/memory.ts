import { isDocument } from '../models/fileKinds'
import { rewriting } from '../models/markdownLinks'
import { parseAnnotationFile, serializeAnnotationFile } from '../models/notes'
import { dirname } from '../models/paths'
import type { MenuModel, MenuPatch } from '../models/appMenu'
import type { Entry, Listing, Native, NativeMenu, RewriteOutcome, Stat, Unwatch } from './bridge'

/** The menu twin keeps what it was given, so a test can read the installed model, the
 *  patches that followed, and click an item the way the menu bar would. */
export interface MemoryMenu extends NativeMenu {
  installed: MenuModel[] | null
  patches: MenuPatch[]
  click(id: string): void
}

function memoryMenu(): MemoryMenu {
  let action: ((id: string) => void) | null = null
  return {
    installed: null,
    patches: [],
    // False: no menu bar here, the page routes the shortcuts itself.
    async install(menus, onAction) {
      this.installed = menus
      action = onAction
      return false
    },
    async update(patch) {
      this.patches.push(patch)
    },
    click(id) {
      action?.(id)
    },
  }
}

// An in-memory Native over a { "/abs/path/file.md": "text" } map - what the tests and
// the browser dev page (vite without Tauri) run against.
export function memoryNative(files: Record<string, string>, home = '/home/dev'): Native {
  const paths = () => Object.keys(files)
  const norm = (p: string) => p.replace(/\/+$/, '') || '/'
  // Directories exist implicitly above every file, plus whatever mkdir created.
  const dirs = new Set<string>()
  // A write through this Native bumps the file's mtime, so a stamp can tell a rewrite of the
  // same length. A test that pokes the map directly is a same-second rewrite at best.
  const mtimes = new Map<string, number>()
  let clock = 0
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
    if (p in files) return { isDir: false, isFile: true, size: files[p].length, mtime: mtimes.get(p) ?? 0, ino: null }
    if (isDir(dirs, p)) return { isDir: true, isFile: false, size: 0, mtime: null, ino: null }
    throw new Error(`no such file: ${p}`)
  }

  let clipboard: string | null = null
  const roots = [...new Set(paths().map((f) => f.split('/').slice(0, -1).join('/')))]
    .sort((a, b) => a.length - b.length)

  return {
    platform: 'macos',
    app: {
      version: async () => '0.0.0-dev',
    },
    fs: {
      read: async (p) => {
        if (!(p in files)) throw new Error(`no such file: ${p}`)
        return files[p]
      },
      write: async (p, text) => {
        if (!isDir(dirs, p.slice(0, p.lastIndexOf('/')))) throw new Error(`no such directory for: ${p}`)
        files[p] = text
        mtimes.set(p, ++clock)
        notify(p)
      },
      create: async (p) => {
        if (p in files) throw new Error(`already exists: ${p}`)
        if (!isDir(dirs, p.slice(0, p.lastIndexOf('/')))) throw new Error(`no such directory for: ${p}`)
        files[p] = ''
        mtimes.set(p, ++clock)
        notify(p)
      },
      rename: async (from, to) => {
        if (!(from in files)) throw new Error(`no such file: ${from}`)
        if (!isDir(dirs, to.slice(0, to.lastIndexOf('/')))) throw new Error(`no such directory for: ${to}`)
        files[to] = files[from]
        delete files[from]
        mtimes.set(to, ++clock)
        mtimes.delete(from)
        notify(from)
        notify(to)
      },
      trash: async (p) => {
        if (!(p in files)) throw new Error(`no such file: ${p}`)
        delete files[p]
        mtimes.delete(p)
        notify(p)
      },
      mkdir: async (dir) => {
        dirs.add(norm(dir))
      },
      list,
      stat,
      exists: async (p) => p in files || isDir(dirs, p),
    },
    clipboard: {
      readText: async () => clipboard,
      writeText: async (text) => {
        clipboard = text
      },
    },
    // Nothing to reveal or open into in a browser tab; a test that cares swaps these in.
    // No asset protocol either: the page leaves a file: image where it is.
    shell: {
      reveal: async () => {},
      openURL: async () => {},
      openPath: async () => {},
      assetBase: () => '',
    },
    dialog: {
      confirm: async () => true,
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
      // The same rules as search.rs, over the in-memory tree: case follows the query,
      // lines split on \n and lose a trailing \r, columns are UTF-16 (JS strings already
      // are), budgets as in Limits::default().
      search: async (root, skipFolders, query, buffers) => {
        if (!query) return { hits: [], truncated: false, filesSearched: 0 }
        const sensitive = /\p{Lu}/u.test(query)
        const needle = sensitive ? query : query.toLowerCase()
        const targets = documentsBelow(norm(root), new Set(skipFolders))
        const hits: { path: string; line: number; column: number; length: number; text: string }[] = []
        let truncated = false
        for (const path of targets) {
          const text = buffers[path] ?? files[path] ?? ''
          const room = Math.min(50, 2000 - hits.length)
          if (room <= 0) return { hits, truncated: true, filesSearched: targets.length }
          let count = 0
          const lines = text.split('\n')
          for (let i = 0; i < lines.length && count <= room; i++) {
            const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i]
            const hay = sensitive ? line : line.toLowerCase()
            let from = 0
            for (;;) {
              const at = hay.indexOf(needle, from)
              if (at < 0 || count > room) break
              count++
              if (count <= room) hits.push({ path, line: i + 1, column: at, length: needle.length, text: line })
              from = at + Math.max(1, needle.length)
            }
          }
          if (count > room) truncated = true
        }
        return { hits, truncated, filesSearched: targets.length }
      },
      readNotes: async (storePath) => parseAnnotationFile(files[storePath] ?? ''),
      writeNotes: async (storePath, file) => {
        if (file.notes.length === 0) {
          delete files[storePath]
        } else {
          files[storePath] = serializeAnnotationFile({
            notes: file.notes.map((n) => ({ path: n.path, line: n.line, title: n.title ?? '', body: n.body ?? '' })),
          })
          mtimes.set(storePath, ++clock)
        }
        notify(storePath)
      },
      invalidateScan: async () => {},
      allowAssetRoots: async () => {},
      // The same pass as links.rs, over the map: every document under the root, the buffer
      // winning over the map and handed back rather than stored, the rest written in place.
      rewriteLinks: async (root, skipFolders, moves, buffers, excluding, home): Promise<RewriteOutcome> => {
        const outcome: RewriteOutcome = { written: [], buffered: [], failed: [] }
        if (moves.length === 0) return outcome
        const skipped = new Set(excluding)
        for (const path of documentsBelow(norm(root), new Set(skipFolders))) {
          if (skipped.has(path)) continue
          const buffer = buffers[path]
          const result = rewriting(buffer ?? files[path], dirname(path), moves, home ? { home } : {})
          if (!result) continue
          if (buffer !== undefined) {
            outcome.buffered.push({ path, text: result.text, count: result.count })
            continue
          }
          files[path] = result.text
          mtimes.set(path, ++clock)
          notify(path)
          outcome.written.push({ path, count: result.count })
        }
        return outcome
      },
    },

    menu: memoryMenu(),

    watch: async (dir, cb): Promise<Unwatch> => {
      const entry = { dir: norm(dir), cb }
      watchers.add(entry)
      return () => watchers.delete(entry)
    },
    // No OS to drag from.
    onFileDrag: async () => () => {},
  }

  function documentsBelow(dir: string, skip: Set<string>): string[] {
    const prefix = dir + '/'
    return paths()
      .filter((f) => f.startsWith(prefix) && isDocument(f))
      .filter((f) => f.slice(prefix.length).split('/').every((part, i, parts) => !part.startsWith('.') && (i === parts.length - 1 || !skip.has(part))))
      .sort()
  }
}
