// The filesystem half of the Native: plain node:fs, with the one OS-specific piece (the
// Trash) done through whatever the desktop offers.

import { access, mkdir as fsMkdir, open, readdir, rename as fsRename, stat as fsStat } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface Entry {
  name: string
  isDir: boolean
  isFile: boolean
  isSymlink: boolean
}

export interface Stat {
  isDir: boolean
  isFile: boolean
  size: number
  mtime: number | null
  ino: number | null
}

export function read(path: string): Promise<string> {
  return Bun.file(path).text()
}

export async function write(path: string, text: string): Promise<void> {
  await Bun.write(path, text)
}

/** An empty file, failing when one is already there (`wx`) - the one call that must not clobber. */
export async function create(path: string): Promise<void> {
  const handle = await open(path, 'wx')
  await handle.close()
}

export function rename(from: string, to: string): Promise<void> {
  return fsRename(from, to)
}

export async function mkdir(dir: string): Promise<void> {
  await fsMkdir(dir, { recursive: true })
}

export async function list(dir: string): Promise<Entry[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.map((e) => ({
    name: e.name,
    isDir: e.isDirectory(),
    isFile: e.isFile(),
    isSymlink: e.isSymbolicLink(),
  }))
}

export async function stat(path: string): Promise<Stat> {
  const s = await fsStat(path)
  return {
    isDir: s.isDirectory(),
    isFile: s.isFile(),
    size: s.size,
    mtime: Number.isFinite(s.mtimeMs) ? Math.round(s.mtimeMs) : null,
    ino: Number.isFinite(s.ino) ? Number(s.ino) : null,
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The OS trash, not a delete. macOS: the `trash` command where installed (faster, no
 *  automation prompt), Finder through osascript otherwise; Linux: `gio trash`; Windows:
 *  the VB FileSystem helper, which is the one documented route to the Recycle Bin. */
export async function trash(path: string): Promise<void> {
  const attempts: string[][] = []
  switch (process.platform) {
    case 'darwin':
      attempts.push(['trash', path])
      attempts.push(['osascript', '-e', `tell application "Finder" to delete POSIX file ${JSON.stringify(path)}`])
      break
    case 'win32':
      attempts.push([
        'powershell', '-NoProfile', '-Command',
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${psQuote(path)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ])
      break
    default:
      attempts.push(['gio', 'trash', path])
      attempts.push(['trash-put', path])
  }
  let lastError = ''
  for (const cmd of attempts) {
    try {
      const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' })
      const code = await proc.exited
      if (code === 0) return
      lastError = (await new Response(proc.stderr).text()).trim() || `${cmd[0]} exited ${code}`
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`could not move to trash: ${lastError || 'no trash command available'}`)
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** The folder a path is in - for the callers that create next to something. */
export function parent(path: string): string {
  return dirname(path)
}
