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
