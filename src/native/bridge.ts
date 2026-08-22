// The one seam between the app and the operating system. Models and UI import this
// interface; src/native/bun.ts is the only module that talks to the shell and the bun
// server, so another shell (Electron) is one file, not a rewrite. src/native/memory.ts is
// its twin for tests and the browser build - every method here needs both.

import type { MenuModel, MenuPatch } from '../models/appMenu'
import type { Platform } from '../models/platform'

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
  /** ms since epoch, null when the filesystem does not say */
  mtime: number | null
  /** Inode, where the platform has one - identity for a case-only rename. */
  ino: number | null
}

export interface NativeFs {
  read(path: string): Promise<string>
  /** Whole-file replace; the directory must exist. */
  write(path: string, text: string): Promise<void>
  /** An empty file, failing when one is already there - the sidebar's New File, where
   *  clobbering a file would be silent. */
  create(path: string): Promise<void>
  /** Moves a file to a new path, in the same folder (a rename) or another one. A plain file
   *  already at `to` is replaced, so callers validate first (fileMove.ts). */
  rename(from: string, to: string): Promise<void>
  /** The OS trash, not a delete: Cmd-Z is the editor's, so the Trash is what makes this
   *  recoverable. The shell does it (shell/src/ipc.rs, the `trash` crate). */
  trash(path: string): Promise<void>
  /** Creates parents as needed; an existing directory is fine. */
  mkdir(dir: string): Promise<void>
  list(dir: string): Promise<Entry[]>
  stat(path: string): Promise<Stat>
  exists(path: string): Promise<boolean>
}

export interface NativeDialog {
  /** Folder picker, several at once, starting where the last one ended. Empty when cancelled. */
  openFolders(startIn: string | null): Promise<string[]>
  /** Single document picker. Null when cancelled. */
  openFile(startIn: string | null): Promise<string | null>
}

/** The desktop the app runs on - the one string the UI varies by it is the reveal label
 *  (src/models/platform.ts); the Tauri side also reads it for drag coordinates. */
export type { Platform }

export interface NativeShell {
  /** The file selected in Finder / Explorer / the file manager. */
  reveal(path: string): Promise<void>
  /** A URL in whatever handles its scheme - the browser, the mail client. */
  openURL(url: string): Promise<void>
  /** A file in whatever the OS opens it with: what a click on a non-document link does. */
  openPath(path: string): Promise<void>
  /** The prefix the preview page turns a local image path into a loadable URL with:
   *  `assetBase() + encodeURIComponent(path)`. The Tauri asset protocol, which serves only
   *  what `commands.allowAssetRoots` has allowed. A prefix rather than a function because
   *  the page finds its images after rendering, inside its own iframe. Empty when there is
   *  no such protocol (the browser build), and the page then leaves `file:` URLs alone. */
  assetBase(): string
}

/** An OS file drag over the window, in CSS pixels from the page's top-left. `paths` is
 *  what is being dragged - filled on `enter` and `drop`, empty on `over` and `leave`. */
export interface FileDrag {
  kind: 'enter' | 'over' | 'drop' | 'leave'
  paths: string[]
  x: number
  y: number
}

export interface NativePaths {
  home(): Promise<string>
  /** ~/.config/md-boss on every OS - plain text, meant to be edited by hand. */
  config(): Promise<string>
  join(...parts: string[]): Promise<string>
}

export interface ListedEntry {
  name: string
  path: string
  isDir: boolean
}

/** One level of the sidebar: documents, and folders with a document somewhere below. */
export type Listing =
  | { kind: 'entries'; entries: ListedEntry[] }
  | { kind: 'denied' }
  | { kind: 'missing' }

/** The `.md-boss` file as the server reads and writes it (server/notes.ts). */
export interface NotesFile {
  notes: { path: string; line: number; title?: string; body?: string }[]
}

export interface SearchHit {
  path: string
  /** 1-based, split on `\n` only. */
  line: number
  /** UTF-16 offset of the match within `text`. */
  column: number
  length: number
  text: string
}

export interface SearchResult {
  hits: SearchHit[]
  /** A budget was reached - the pane says so rather than quietly showing less. */
  truncated: boolean
  filesSearched: number
}

/** One file that has moved, for the link rewrite. */
export interface LinkMove {
  old: string
  new: string
}

/** What the rewrite pass did (server/links.ts). */
export interface RewriteOutcome {
  /** Rewritten on disk, atomically. */
  written: { path: string; count: number }[]
  /** Text that came from `buffers`, handed back rewritten - the caller owns that buffer. */
  buffered: { path: string; text: string; count: number }[]
  /** Needed rewriting and could not be written. */
  failed: string[]
}

/** The filesystem-heavy passes, answered by the server (server/walk.ts). */
export interface NativeCommands {
  /** Every match under `root` (server/search.ts). `buffers` is unsaved text by path;
   *  `generation` cancels any older search still running. */
  search(root: string, skipFolders: string[], query: string, buffers: Record<string, string>, generation: number): Promise<SearchResult>
  /** Missing or malformed reads as empty; legacy bookmarks/comments fold into notes. */
  readNotes(storePath: string): Promise<NotesFile>
  /** Canonical shape, atomic; an empty file is removed. */
  writeNotes(storePath: string, file: NotesFile): Promise<void>
  listDir(path: string, skipFolders: string[]): Promise<Listing>
  /** Every document below `path`, documents before subtrees, each level in name order.
   *  `limit` stops the walk once that many are found - the sidebar builds its tree from
   *  this list and asks for the first thousand. */
  documentsUnder(path: string, skipFolders: string[], limit?: number): Promise<string[]>
  /** Drop the "has documents below" memo for `path` and its ancestors/descendants; all of it when omitted. */
  invalidateScan(path?: string): Promise<void>
  /** Repoints every inline link under `root` that resolved to a moved file, in every
   *  document below it (server/links.ts). `buffers` is unsaved text by path and wins
   *  over the disk; `excluding` are never read; `home` is what `~` expands to. */
  rewriteLinks(root: string, skipFolders: string[], moves: LinkMove[], buffers: Record<string, string>, excluding: string[], home: string | null): Promise<RewriteOutcome>
  /** Lets the preview's asset protocol serve files below these folders - the sidebar's
   *  roots, so an image next to a document loads and nothing outside the listed folders
   *  does. Grows as roots are added; a removed root is not revoked. */
  allowAssetRoots(roots: string[]): Promise<void>
}

/** Stop watching. */
export type Unwatch = () => void

export interface NativeClipboard {
  /** Null when the clipboard is empty or not readable. */
  readText(): Promise<string | null>
  writeText(text: string): Promise<void>
}

/** The menu bar (src/models/appMenu.ts is the model, src/ui/appMenu.ts keeps it in step). */
export interface NativeMenu {
  /** Draws the menus and wires every action item to `onAction` by id. Resolves to whether
   *  the shell registered the accelerators with the OS - true under Tauri, false in the
   *  browser build, where the page routes the shortcuts itself (src/ui/keys.ts). */
  install(menus: MenuModel[], onAction: (id: string) => void): Promise<boolean>
  /** A label, an enabled flag or a check changed under a live menu. */
  update(patch: MenuPatch): Promise<void>
}

export interface NativeApp {
  /** The version from package.json, carried in the payload - what the About panel shows. */
  version(): Promise<string>
  /** Ends the process. Asked by `Manager.quit` once unsaved edits are settled - the menu's
   *  Quit and the window's close button both go through it, so the guard runs for both. */
  exit(): Promise<void>
  /** The window's close button, Cmd-W. The shell holds the close; `listener` decides what
   *  happens (quit, after the guard) - the window itself is never closed, the app exits. */
  onCloseRequested(listener: () => void): Promise<Unwatch>
}

/** `md-boss <paths...>`: the positional arguments as typed and the directory they were
 *  typed in - src/models/cli.ts resolves one against the other. */
export interface OpenRequest {
  paths: string[]
  cwd: string
}

/** The command line and the file associations (shell/src/main.rs). One process serves
 *  every launch: the first one's arguments are read at boot, a later `md-boss …` or a
 *  Finder double-click hands its own to the running window. */
export interface NativeCli {
  /** Every request that arrived before this was asked - the first launch's own, plus any
   *  file opened from Finder while the page was still loading. One entry with no paths
   *  from a bare `md-boss` or a Dock click, and the session is restored instead. Asked
   *  once, after `onOpen` is listening, so nothing falls between the two. */
  launch(): Promise<OpenRequest[]>
  /** A later launch or open while this one runs; the shell has already brought the window
   *  forward. */
  onOpen(listener: (request: OpenRequest) => void): Promise<Unwatch>
}

/** A newer signed build the update endpoint lists for this platform. */
export interface AvailableUpdate {
  version: string
  /** Fetches the payload from the release and checks it against the published sha256. */
  download(): Promise<void>
  /** Puts the downloaded package in place of the running build, so the next launch is the
   *  new version. On Windows the installer ends this process itself. */
  install(): Promise<void>
}

/** Self-update over the GitHub release's latest.json (src/models/updater.ts is the flow). */
export interface NativeUpdater {
  /** False where there is nothing signed to update: dev builds and the browser build. */
  enabled: boolean
  /** Null when the running version is the newest listed. Rejects when the endpoint cannot
   *  be read - offline, or before the first release. */
  check(): Promise<AvailableUpdate | null>
  /** Ends this process and starts the installed build. */
  relaunch(): Promise<void>
}

export interface Native {
  platform: Platform
  app: NativeApp
  updater: NativeUpdater
  fs: NativeFs
  dialog: NativeDialog
  clipboard: NativeClipboard
  shell: NativeShell
  paths: NativePaths
  commands: NativeCommands
  menu: NativeMenu
  cli: NativeCli
  /** Files dragged in from the OS. An HTML5 drop never carries a native path, so the raw
   *  pane's "drop a file, get a link" listens here for anything from outside the window. */
  onFileDrag(listener: (drag: FileDrag) => void): Promise<Unwatch>
  /** One directory, its direct entries only, debounced; `changed` carries the paths the
   *  platform reported (the directory itself when it went away). */
  watch(dir: string, onChange: (changed: string[]) => void): Promise<Unwatch>
}

let current: Native | null = null

export function installNative(impl: Native): void {
  current = impl
}

export function native(): Native {
  if (!current) throw new Error('native bridge not installed - call installNative() at boot')
  return current
}
