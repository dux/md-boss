// What `md-boss <paths...>` means, as paths. The arguments arrive as typed - `.`,
// `doc/API.md`, `~/notes`, `/abs/path` - together with the directory they were typed in,
// and become absolute here; what to do with each (a folder, a file, nothing there) is the
// manager's call once it has looked at the disk.

import { joinPath, normalizePath } from './paths'

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
