// Pure path text. Forward slashes throughout - a backslash is read as a separator on the
// way in, so a Windows path compares equal to itself however it was typed. Symlink
// resolution is not a text question and stays with the Rust side that touches the disk.

/** Collapses `.` and `..`, repeated and trailing slashes. Keeps a leading `/` or drive. */
export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const absolute = slashed.startsWith('/')
  const drive = /^[A-Za-z]:/.exec(slashed)?.[0] ?? ''
  const parts: string[] = []
  for (const part of slashed.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute && !drive) parts.push('..')
      continue
    }
    parts.push(part)
  }
  const body = parts.join('/')
  if (drive) return `${drive}/${body}`
  if (absolute) return `/${body}`
  return body || '.'
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'))
}

export function dirname(path: string): string {
  const n = normalizePath(path)
  const slash = n.lastIndexOf('/')
  if (slash < 0) return '.'
  return slash === 0 ? '/' : n.slice(0, slash)
}

export function basename(path: string): string {
  const n = normalizePath(path)
  return n.slice(n.lastIndexOf('/') + 1)
}

/** Path components, the root kept as its own first entry so `/a` and `a` differ. */
export function components(path: string): string[] {
  const n = normalizePath(path)
  const drive = /^[A-Za-z]:/.exec(n)?.[0]
  if (drive) return [drive, ...n.slice(drive.length + 1).split('/').filter(Boolean)]
  if (n.startsWith('/')) return ['/', ...n.slice(1).split('/').filter(Boolean)]
  return n.split('/').filter(Boolean)
}

/** Containment on path boundaries, so `/work/notes-old` is not treated as part of
 *  `/work/notes`. Vacuous when the two are the same path. */
export function isUnder(path: string, root: string): boolean {
  const p = normalizePath(path)
  const r = normalizePath(root)
  return p === r || p.startsWith(r.endsWith('/') ? r : r + '/')
}

/** `path` written against `root`: the part below it, no leading slash. Null when the path
 *  does not sit under the root at all - the caller's cue to show it whole rather than to
 *  print a string of `../`. The root itself answers the empty string. */
export function relativeTo(path: string, root: string): string | null {
  const p = normalizePath(path)
  const r = normalizePath(root)
  if (!isUnder(p, r)) return null
  if (p === r) return ''
  return p.slice(r.endsWith('/') ? r.length : r.length + 1)
}
