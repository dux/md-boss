import { describe, expect, test } from 'bun:test'
import { gitRoot, isAbsolutePath, launchPaths, workspaceRoot } from '../src/models/cli'
import { Manager } from '../src/models/manager'
import { RootFolders } from '../src/models/rootFolders'
import { SettingsStore } from '../src/models/settingsStore'
import { installNative, native } from '../src/native/bridge'
import { type MemoryCli, memoryNative } from '../src/native/memory'

const HOME = '/home/dev'
const ROOT = '/home/dev/notes'
const at = (p: string) => `${ROOT}/${p}`
const tick = () => new Promise((r) => setTimeout(r, 0))

async function setup(files: Record<string, string>) {
  installNative(memoryNative(files, HOME))
  const folders = await RootFolders.load()
  folders.add(ROOT, true)
  const manager = new Manager(await SettingsStore.load(), folders, HOME)
  await manager.notes.reload()
  await manager.tree.refreshAll()
  return { manager, folders }
}

describe('launchPaths', () => {
  test('relative arguments resolve against the caller\'s directory, absolute ones are kept', () => {
    expect(launchPaths(['.', 'doc/API.md', '../x', '/abs/a.md'], '/work/repo', HOME))
      .toEqual(['/work/repo', '/work/repo/doc/API.md', '/work/x', '/abs/a.md'])
  })

  test('a tilde means home, as it would have to the shell', () => {
    expect(launchPaths(['~', '~/notes/a.md', '~x'], '/work', HOME)).toEqual([HOME, `${HOME}/notes/a.md`, '/work/~x'])
  })

  test('Windows spellings are absolute too, and come out with forward slashes', () => {
    expect(isAbsolutePath('C:\\docs')).toBe(true)
    expect(isAbsolutePath('c:/docs')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share')).toBe(true)
    expect(isAbsolutePath('docs\\a.md')).toBe(false)
    expect(launchPaths(['C:\\docs\\a.md', 'b.md'], 'C:\\work', HOME)).toEqual(['C:/docs/a.md', 'C:/work/b.md'])
  })

  test('order is kept and nothing is deduplicated - the manager decides what each one is', () => {
    expect(launchPaths(['b', 'a', 'b'], '/w', HOME)).toEqual(['/w/b', '/w/a', '/w/b'])
  })
})

describe('workspaceRoot', () => {
  const gitAt = (...dirs: string[]) => {
    const set = new Set(dirs.map((d) => `${d}/.git`))
    return async (path: string) => set.has(path)
  }

  test('walks up to the folder that holds .git', async () => {
    expect(await gitRoot('/work/repo/doc', gitAt('/work/repo'))).toBe('/work/repo')
    expect(await workspaceRoot('/work/repo/doc', gitAt('/work/repo'))).toBe('/work/repo')
    expect(await workspaceRoot('/work/repo', gitAt('/work/repo'))).toBe('/work/repo')
  })

  test('the document folder when no ancestor is a git repo', async () => {
    expect(await gitRoot('/work/site/docs', gitAt())).toBe(null)
    expect(await workspaceRoot('/work/site/docs', gitAt())).toBe('/work/site/docs')
    expect(await workspaceRoot('/', gitAt())).toBe('/')
  })

  test('the nearest ancestor wins when several folders have .git', async () => {
    expect(await gitRoot('/a/b/c', gitAt('/a', '/a/b'))).toBe('/a/b')
  })
})

describe('openFromCLI', () => {
  test('`md-boss .` puts the folder at the top of the sidebar and makes it active', async () => {
    const { manager, folders } = await setup({ [at('a.md')]: '# a', '/work/site/index.md': '# site' })
    await manager.openFromCLI({ paths: ['.'], cwd: '/work/site' })
    expect(folders.roots).toEqual(['/work/site', ROOT])
    expect(folders.active).toBe('/work/site')
    expect(manager.settings.data.lastOpenedFolder).toBe('/work/site')
  })

  test('`md-boss file.md` opens the file and lists its folder when no root holds it', async () => {
    const { manager, folders } = await setup({ [at('a.md')]: '# a', '/work/site/index.md': '# site' })
    await manager.openFromCLI({ paths: ['index.md'], cwd: '/work/site' })
    expect(manager.document?.path).toBe('/work/site/index.md')
    expect(folders.roots).toEqual(['/work/site', ROOT])
    expect(folders.active).toBe('/work/site')
    await tick()
    expect(manager.tree.cursorRow?.node.path).toBe('/work/site/index.md')
  })

  test('a file under a listed root opens in place and adds nothing', async () => {
    const { manager, folders } = await setup({ [at('a.md')]: '# a', [at('deep/b.md')]: '# b' })
    await manager.openFromCLI({ paths: ['deep/b.md'], cwd: ROOT })
    expect(manager.document?.path).toBe(at('deep/b.md'))
    expect(folders.roots).toEqual([ROOT])
    expect(manager.tree.cursorRow?.node.path).toBe(at('deep/b.md'))
  })

  test('what is not there is reported by name, and the rest still opens', async () => {
    const { manager } = await setup({ [at('a.md')]: '# a' })
    await manager.openFromCLI({ paths: ['a.md', 'missing.md'], cwd: ROOT })
    expect(manager.toast.text).toBe('Not found: missing.md')
    expect(manager.document?.path).toBe(at('a.md'))
  })

  test('a git parent becomes the sidebar root for a folder argument', async () => {
    const { manager, folders } = await setup({
      [at('a.md')]: '# a',
      '/work/repo/.git/HEAD': 'ref',
      '/work/repo/doc/index.md': '# doc',
    })
    await manager.openFromCLI({ paths: ['.'], cwd: '/work/repo/doc' })
    expect(folders.roots).toEqual(['/work/repo', ROOT])
    expect(folders.active).toBe('/work/repo')
  })

  test('a git parent becomes the sidebar root for a file, and the file opens', async () => {
    const { manager, folders } = await setup({
      [at('a.md')]: '# a',
      '/work/repo/.git/HEAD': 'ref',
      '/work/repo/doc/index.md': '# doc',
    })
    await manager.openFromCLI({ paths: ['index.md'], cwd: '/work/repo/doc' })
    expect(manager.document?.path).toBe('/work/repo/doc/index.md')
    expect(folders.roots).toEqual(['/work/repo', ROOT])
    expect(folders.active).toBe('/work/repo')
    await tick()
    expect(manager.tree.cursorRow?.node.path).toBe('/work/repo/doc/index.md')
  })

  test('a file already under a listed folder still switches to its git parent', async () => {
    const { manager, folders } = await setup({
      [at('a.md')]: '# a',
      '/work/repo/.git/HEAD': 'ref',
      '/work/repo/doc/index.md': '# doc',
    })
    folders.add('/work/repo/doc', true)
    await manager.openFromCLI({ paths: ['index.md'], cwd: '/work/repo/doc' })
    expect(manager.document?.path).toBe('/work/repo/doc/index.md')
    expect(folders.active).toBe('/work/repo')
    expect(folders.roots).toEqual(['/work/repo', '/work/repo/doc', ROOT])
  })

  test('a .git file counts the same as a directory - git worktrees write a file', async () => {
    const { manager, folders } = await setup({
      [at('a.md')]: '# a',
      '/work/repo/.git': 'gitdir: /elsewhere',
      '/work/repo/doc/index.md': '# doc',
    })
    await manager.openFromCLI({ paths: ['doc'], cwd: '/work/repo' })
    expect(folders.roots).toEqual(['/work/repo', ROOT])
  })

  test('a second launch arrives through the cli twin the same way', async () => {
    const { manager, folders } = await setup({ [at('a.md')]: '# a', '/work/site/index.md': '# site' })
    const cli = native().cli as MemoryCli
    expect(await cli.launch()).toEqual([{ paths: [], cwd: HOME }])
    let pending: Promise<void> = Promise.resolve()
    await cli.onOpen((request) => {
      pending = manager.openFromCLI(request)
    })
    cli.open({ paths: ['.'], cwd: '/work/site' })
    await pending
    expect(folders.active).toBe('/work/site')
  })
})
