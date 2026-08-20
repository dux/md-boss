// The one seam between the app and the operating system. Models and UI
// import this interface; src/native/tauri.ts is the only module that imports
// @tauri-apps/*, so another shell (Electron) is one file, not a rewrite.
// It grows a member at a time, as the phases in doc/feature/port-tauri.md
// need them.

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
  /** Creates parents as needed; an existing directory is fine. */
  mkdir(dir: string): Promise<void>
  list(dir: string): Promise<Entry[]>
  stat(path: string): Promise<Stat>
  exists(path: string): Promise<boolean>
}

export interface NativeDialog {
  /** A two-way question. True for `okLabel`. Closing the dialog counts as cancel. */
  confirm(message: string, okLabel: string, cancelLabel: string): Promise<boolean>
  /** Folder picker, several at once, starting where the last one ended. Empty when cancelled. */
  openFolders(startIn: string | null): Promise<string[]>
  /** Single document picker. Null when cancelled. */
  openFile(startIn: string | null): Promise<string | null>
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

/** The `.md-boss` file as the Rust store reads and writes it (src-tauri/src/notes.rs). */
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

/** The filesystem-heavy passes, answered by the Rust side (src-tauri/src/walk.rs). */
export interface NativeCommands {
  /** Every match under `root` (src-tauri/src/search.rs). `buffers` is unsaved text by path;
   *  `generation` cancels any older search still running. */
  search(root: string, skipFolders: string[], query: string, buffers: Record<string, string>, generation: number): Promise<SearchResult>
  /** Missing or malformed reads as empty; legacy bookmarks/comments fold into notes. */
  readNotes(storePath: string): Promise<NotesFile>
  /** Canonical shape, atomic; an empty file is removed. */
  writeNotes(storePath: string, file: NotesFile): Promise<void>
  listDir(path: string, skipFolders: string[]): Promise<Listing>
  /** Every document below `path`, documents before subtrees, each level in name order. */
  documentsUnder(path: string, skipFolders: string[]): Promise<string[]>
  /** Drop the "has documents below" memo for `path` and its ancestors/descendants; all of it when omitted. */
  invalidateScan(path?: string): Promise<void>
}

/** Stop watching. */
export type Unwatch = () => void

export interface NativeClipboard {
  /** Null when the clipboard is empty or not readable. */
  readText(): Promise<string | null>
  writeText(text: string): Promise<void>
}

export interface Native {
  fs: NativeFs
  dialog: NativeDialog
  clipboard: NativeClipboard
  paths: NativePaths
  commands: NativeCommands
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
