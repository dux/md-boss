// The sidebar's rows. The tree is flattened rather than nested so keyboard navigation is
// index arithmetic and expansion state is one set of paths.

export interface FileNode {
  path: string
  name: string
  isDir: boolean
}

/** One visible line in the sidebar. `isDenied` marks a directory we were not allowed to
 *  read - "denied" must not look like "empty". */
export interface FlatRow {
  node: FileNode
  depth: number
  isDenied: boolean
}

/** Walks the active root's contents, descending only into expanded directories, so the cost
 *  is proportional to the number of visible rows rather than the size of the tree. The root
 *  itself is never a row - the sidebar names it in the select box above the tree and dives
 *  straight into its contents, which is why it is implicitly expanded. */
export function flatten(
  root: string | null,
  children: ReadonlyMap<string, FileNode[]>,
  expanded: ReadonlySet<string>,
  denied: ReadonlySet<string>,
): FlatRow[] {
  if (root === null) return []
  const rows: FlatRow[] = []
  const append = (node: FileNode, depth: number) => {
    rows.push({ node, depth, isDenied: denied.has(node.path) })
    if (!node.isDir || !expanded.has(node.path)) return
    for (const child of children.get(node.path) ?? []) append(child, depth + 1)
  }
  for (const child of children.get(root) ?? []) append(child, 0)
  return rows
}

export const sameRows = (a: FlatRow[], b: FlatRow[]) =>
  a.length === b.length &&
  a.every((r, i) => r.node.path === b[i].node.path && r.depth === b[i].depth && r.isDenied === b[i].isDenied && r.node.isDir === b[i].node.isDir)

/** The row to jump to for a typed prefix: forward from the cursor first, wrapping round,
 *  so typing the same prefix again cycles through the matches. -1 when nothing matches. */
export function prefixMatch(rows: readonly FlatRow[], cursor: number, prefix: string): number {
  if (rows.length === 0 || prefix === '') return -1
  const wanted = prefix.toLowerCase()
  for (let step = 1; step <= rows.length; step++) {
    const index = (cursor + step) % rows.length
    if (rows[index].node.name.toLowerCase().startsWith(wanted)) return index
  }
  return -1
}

/** The nearest row above `cursor` one level up - what Left jumps to from a file or a
 *  collapsed folder. -1 at the top level. */
export function parentRow(rows: readonly FlatRow[], cursor: number): number {
  const row = rows[cursor]
  if (!row || row.depth === 0) return -1
  for (let index = cursor - 1; index >= 0; index--) {
    if (rows[index].depth === row.depth - 1) return index
  }
  return -1
}

/** Folders first, then names in natural order (`9.md` before `10.md`, case folded). */
export const compareNodes = (a: FileNode, b: FileNode): number =>
  Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** The tree from a flat list of document paths below `root`: every folder on the way to a
 *  document becomes a directory node, so a folder with nothing to show never exists here.
 *  Each level is sorted with `compareNodes`. The list is what one `documentsUnder` call
 *  answered, so the whole tree is known up front and expanding costs nothing. */
export function buildChildren(root: string, paths: readonly string[]): Map<string, FileNode[]> {
  const children = new Map<string, FileNode[]>()
  const seen = new Set<string>()
  const add = (parent: string, node: FileNode) => {
    if (seen.has(node.path)) return
    seen.add(node.path)
    let list = children.get(parent)
    if (!list) children.set(parent, (list = []))
    list.push(node)
  }
  const prefix = root.endsWith('/') ? root : root + '/'
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue
    const parts = path.slice(prefix.length).split('/').filter(Boolean)
    let dir = prefix.slice(0, -1)
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const full = `${dir}/${name}`
      add(dir, { path: full, name, isDir: i < parts.length - 1 })
      dir = full
    }
  }
  for (const list of children.values()) list.sort(compareNodes)
  return children
}
