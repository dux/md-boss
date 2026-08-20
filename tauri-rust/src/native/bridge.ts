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

/** The filesystem-heavy passes, answered by the Rust side (src-tauri/src/walk.rs). */
export interface NativeCommands {
  listDir(path: string, skipFolders: string[]): Promise<Listing>
  /** Every document below `path`, documents before subtrees, each level in name order. */
  documentsUnder(path: string, skipFolders: string[]): Promise<string[]>
  /** Drop the "has documents below" memo for `path` and its ancestors/descendants; all of it when omitted. */
  invalidateScan(path?: string): Promise<void>
}

/** Stop watching. */
export type Unwatch = () => void

export interface Native {
  fs: NativeFs
  dialog: NativeDialog
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
