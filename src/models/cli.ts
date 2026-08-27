// What `md-boss <paths...>` means, as paths. The arguments arrive as typed - `.`,
// `doc/API.md`, `~/notes`, `/abs/path` - together with the directory they were typed in,
// and become absolute here; what to do with each (a folder, a file, nothing there) is the
// manager's call once it has looked at the disk. The sidebar root for a launched path is
// the nearest ancestor that holds a `.git` entry, or the document's own folder when none
// of them is a git repo.

import { dirname, joinPath, normalizePath } from './paths'

/** `/x`, `C:\\x`, `C:/x`, `\\\\server\\share` - everything else is relative to `cwd`. */
export function isAbsolutePath(path: string): boolean {
  return /^(\/|\\\\|[A-Za-z]:[\\/])/.test(path)
}

/** Absolute, normalized, in the order given. `~` expands as the shell would have, had
 *  it seen it - a quoted or forwarded `~/notes` still means home. */
export function launchPaths(paths: string[], cwd: string, home: string): string[] {
  return paths.map((arg) => {
    const expanded = arg === '~' || arg.startsWith('~/') ? home + arg.slice(1) : arg
    return isAbsolutePath(expanded) ? normalizePath(expanded) : joinPath(cwd, expanded)
  })
}

/** The nearest ancestor of `dir` that holds a `.git` entry (a directory or a file -
 *  worktrees write a file). Null when none of them is a git repo. */
export async function gitRoot(
  dir: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  let current = normalizePath(dir)
  for (;;) {
    if (await exists(joinPath(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current || parent === '.') return null
    current = parent
  }
}

/** The sidebar folder for a launched folder: its git root, or the folder itself. */
export async function workspaceRoot(
  dir: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  return (await gitRoot(dir, exists)) ?? normalizePath(dir)
}
