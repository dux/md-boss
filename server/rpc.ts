// The method table: one handler per server-side Native method (src/native/bridge.ts).
// Every handler gets the session first, then the call's positional params.

import type { Session } from './session'
import * as fs from './fs'
import * as links from './links'
import * as notes from './notes'
import * as paths from './paths'
import * as search from './search'
import * as walk from './walk'
import * as watch from './watch'
import type { AnnotationFile } from '../src/models/notes'

// biome-ignore lint/suspicious/noExplicitAny: the wire is untyped; handlers narrow
export type Handler = (session: Session, ...args: any[]) => unknown

/** Shared across connections: the "has documents below" memo and the newest search. */
const scanner = new walk.Scanner()
const generation = new search.Generation()

export const methods: Record<string, Handler> = {
  'server.ping': () => 'pong',

  'fs.read': (_s, path: string) => fs.read(path),
  'fs.write': (_s, path: string, text: string) => fs.write(path, text),
  'fs.create': (_s, path: string) => fs.create(path),
  'fs.rename': (_s, from: string, to: string) => fs.rename(from, to),
  'fs.trash': (_s, path: string) => fs.trash(path),
  'fs.mkdir': (_s, dir: string) => fs.mkdir(dir),
  'fs.list': (_s, dir: string) => fs.list(dir),
  'fs.stat': (_s, path: string) => fs.stat(path),
  'fs.exists': (_s, path: string) => fs.exists(path),

  'paths.home': () => paths.home(),
  'paths.config': () => paths.config(),
  'paths.join': (_s, ...parts: string[]) => paths.join(...parts),

  'watch.start': (s, dir: string) => watch.start(s, dir),
  'watch.stop': (s, id: number) => watch.stop(s, id),

  'commands.listDir': (_s, path: string, skipFolders: string[]) => walk.listDir(path, walk.skipSet(skipFolders), scanner),
  'commands.documentsUnder': (_s, path: string, skipFolders: string[], limit: number | null) =>
    walk.documentsUnder(path, walk.skipSet(skipFolders), false, limit ?? Infinity),
  'commands.invalidateScan': (_s, path: string | null) => (path ? scanner.invalidate(path) : scanner.invalidateAll()),

  'commands.search': (_s, root: string, skipFolders: string[], query: string, buffers: Record<string, string>, gen: number) => {
    generation.bump(gen)
    return search.run(root, walk.skipSet(skipFolders), query, buffers, search.DEFAULT_LIMITS, () => generation.isStale(gen))
  },

  'commands.readNotes': (_s, storePath: string) => notes.readNotes(storePath),
  'commands.writeNotes': (_s, storePath: string, file: AnnotationFile) => notes.writeNotes(storePath, file),

  'commands.rewriteLinks': (
    _s, root: string, skipFolders: string[], moves: links.Move[], buffers: Record<string, string>, excluding: string[], home: string | null,
  ) => links.run(root, walk.skipSet(skipFolders), moves, buffers, new Set(excluding), home),
}
