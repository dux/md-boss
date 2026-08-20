// Every document under a folder, through the bridge. The sidebar's own tree goes through
// the Rust walk for speed; this is for the passes that read every file - the link rewrite
// after a move - and for tests, which run it over the in-memory tree.

import { native } from '../native/bridge'
import { isDocument } from './fileKinds'

/** Recursive, hidden entries and `skipFolders` left out, files before subtrees and each
 *  level in name order, so the same tree always answers the same way. */
export async function documentsUnder(root: string, skipFolders: ReadonlySet<string>): Promise<string[]> {
  const { fs, paths } = native()
  const found: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = (await fs.list(dir)).filter((e) => !e.name.startsWith('.'))
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const subtrees: string[] = []
    for (const entry of entries) {
      const path = await paths.join(dir, entry.name)
      if (entry.isDir) {
        if (!skipFolders.has(entry.name)) subtrees.push(path)
      } else if (isDocument(entry.name)) {
        found.push(path)
      }
    }
    for (const sub of subtrees) await walk(sub)
  }

  await walk(root)
  return found
}
