// roots.txt - the sidebar's root folders, one absolute path per line. It doubles as the
// most-recently-used list: the first line is the active root, and picking a folder floats
// it to the top. Plain text, meant to be edited by hand.

export const ROOTS_FILE = 'roots.txt'
/** How many the select box lists; older roots stay in the file and come back when used. */
export const ROOTS_SHOWN = 20

export function parseRoots(text: string | null | undefined): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const roots: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || seen.has(line)) continue
    seen.add(line)
    roots.push(line)
  }
  return roots
}

export function serializeRoots(roots: string[]): string {
  return roots.length ? roots.join('\n') + '\n' : ''
}

/** Floats `root` to the head, which makes it the active one. */
export function addRootAtTop(roots: string[], root: string): string[] {
  return [root, ...roots.filter((r) => r !== root)]
}

export const activeRoot = (roots: string[]): string | null => roots[0] ?? null
export const shownRoots = (roots: string[]): string[] => roots.slice(0, ROOTS_SHOWN)
