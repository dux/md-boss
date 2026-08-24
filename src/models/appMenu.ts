// The menu bar as data: File / Edit / View / Appearance / Window / Help, carrying every shortcut
// in the README keyboard table. Built from manager state by src/ui/appMenu.ts, drawn
// natively by the shell (src/native/bun.ts), and in the browser build the same table is
// what keys.ts routes keydown through. Pure, so the README table is a test.

import type { Platform } from './platform'
import { revealLabel } from './platform'
import { type Pane, PANE_TITLE, PANES } from './settings'
import { isDark, STYLES, type StyleID, type ThemeID, themeNamed } from '../theme/theme'

export const GITHUB_URL = 'https://github.com/dux/md-boss'

/** What the native About panel shows. Credits and website are the same line the Swift
 *  About panel carried; macOS draws the credits, Windows and Linux the website. */
export interface AboutInfo {
  name: string
  version: string
  comments: string
  website: string
  websiteLabel: string
  credits: string
  authors: string[]
}

export function aboutInfo(version: string): AboutInfo {
  return {
    name: 'md-boss',
    version,
    comments: 'A markdown viewer and editor that looks like paper',
    website: GITHUB_URL,
    websiteLabel: 'github.com/dux/md-boss',
    credits: 'github.com/dux/md-boss',
    authors: ['dux'],
  }
}

/** Items the OS draws and answers itself; the subset of Tauri's predefined kinds used here. */
export type PredefinedKind =
  | 'Undo' | 'Redo' | 'Cut' | 'Copy' | 'Paste' | 'SelectAll'
  | 'Minimize' | 'Maximize' | 'Fullscreen' | 'CloseWindow' | 'BringAllToFront'
  | 'Hide' | 'HideOthers' | 'ShowAll' | 'Services'

export type MenuAction =
  | 'new-file' | 'open-folder' | 'open-file' | 'save' | 'revert' | 'rename' | 'trash' | 'reveal' | 'settings'
  | 'find' | 'find-in-project' | 'go-to-file' | 'bold' | 'italic' | 'link' | 'add-note' | 'delete-note'
  | 'back' | 'toggle-preview' | 'toggle-raw' | 'toggle-notes' | 'side-by-side' | 'toggle-sidebar'
  | 'narrower' | 'wider'
  | 'bigger' | 'smaller' | 'actual-size' | 'toggle-light-dark'
  | `style:${StyleID}` | 'mode:light' | 'mode:dark'
  | 'check-updates' | 'github' | 'quit'

export interface MenuItemModel {
  kind: 'item'
  id: MenuAction
  label: string
  /** muda grammar: `Alt+CmdOrCtrl+Shift+K`. Null for an item with no shortcut. */
  accelerator: string | null
  /** Whether the menu bar registers the accelerator. False for the one key the bar must not
   *  take from text fields (see `trash`); the page routes it instead (keys.ts). */
  native: boolean
  enabled: boolean
  /** Present only on appearance check items. */
  checked?: boolean
}

export type MenuEntry =
  | MenuItemModel
  | { kind: 'separator' }
  | { kind: 'predefined'; item: PredefinedKind; label?: string }
  | { kind: 'about'; label: string; info: AboutInfo }

export interface MenuModel {
  id: string
  label: string
  /** macOS hands the Window and Help menus extra items (window list, search) when told
   *  which ones they are. */
  role: 'app' | 'window' | 'help' | null
  items: MenuEntry[]
}

/** What the menu needs to know - the manager's answers, flattened so the model is pure. */
export interface MenuState {
  platform: Platform
  about: AboutInfo
  hasRoot: boolean
  /** `manager.actionTarget` - the open document, or the sidebar cursor's row. */
  hasTarget: boolean
  hasDocument: boolean
  isDirty: boolean
  canFormat: boolean
  canSearch: boolean
  canGoBack: boolean
  hasNoteAtCursor: boolean
  visiblePanes: Pane[]
  showSidebar: boolean
  themeID: ThemeID
  /** False in dev and browser builds, where nothing signed can be checked. */
  canCheckUpdates: boolean
  /** An update is downloaded: the Help item becomes "Restart to Update". */
  updateReady: boolean
}

/** A patch the controller pushes when the model changes under a live menu. */
export interface MenuPatch {
  id: string
  label?: string
  enabled?: boolean
  checked?: boolean
}

/** Cmd-1 to Cmd-4, in the order the panels stand on screen: files, preview, raw, notes.
 *  The number is the position, so the keys are read off the window rather than remembered. */
export const SIDEBAR_ACCELERATOR = 'CmdOrCtrl+1'
export const PANE_ACCELERATOR: Record<Pane, string> = {
  preview: 'CmdOrCtrl+2',
  raw: 'CmdOrCtrl+3',
  notes: 'CmdOrCtrl+4',
}

/** What a panel label's tooltip says. ⌘ for CmdOrCtrl, the way the rest of the tooltips
 *  write it, and from the accelerator itself so the two cannot drift apart. */
export const panelShortcut = (panel: 'files' | Pane): string =>
  (panel === 'files' ? SIDEBAR_ACCELERATOR : PANE_ACCELERATOR[panel]).replace('CmdOrCtrl+', '⌘')

const PANE_ACTION: Record<Pane, MenuAction> = { preview: 'toggle-preview', raw: 'toggle-raw', notes: 'toggle-notes' }

const separator: MenuEntry = { kind: 'separator' }
const predefined = (item: PredefinedKind, label?: string): MenuEntry => ({ kind: 'predefined', item, label })

function item(id: MenuAction, label: string, accelerator: string | null = null, enabled = true, extra: Partial<MenuItemModel> = {}): MenuItemModel {
  return { kind: 'item', id, label, accelerator, native: true, enabled, ...extra }
}

export function buildAppMenu(s: MenuState): MenuModel[] {
  const mac = s.platform === 'macos'
  const menus: MenuModel[] = []
  const activeTheme = themeNamed(s.themeID)
  // Not the predefined Quit: that one is `terminate:` on macOS and PostQuitMessage on
  // Windows, and neither asks about unsaved edits. Our item runs Manager.quit, which does.
  // The labels are what the predefined one would have shown on each desktop.
  const quit = item('quit', mac ? `Quit ${s.about.name}` : s.platform === 'windows' ? 'Exit' : 'Quit', 'CmdOrCtrl+Q')

  if (mac) {
    menus.push({
      id: 'app', label: s.about.name, role: 'app',
      items: [
        { kind: 'about', label: `About ${s.about.name}`, info: s.about },
        separator,
        item('settings', 'Settings…', 'CmdOrCtrl+,'),
        separator,
        predefined('Services'),
        separator,
        predefined('Hide'),
        predefined('HideOthers'),
        predefined('ShowAll'),
        separator,
        quit,
      ],
    })
  }

  menus.push({
    id: 'file', label: 'File', role: null,
    items: [
      item('new-file', 'New File…', 'CmdOrCtrl+N', s.hasRoot),
      separator,
      item('open-folder', 'Open Folder…', 'CmdOrCtrl+O'),
      item('open-file', 'Open File…', 'CmdOrCtrl+Shift+O'),
      separator,
      item('save', 'Save', 'CmdOrCtrl+S', s.isDirty),
      item('revert', 'Revert to Saved', null, s.isDirty),
      separator,
      // No shortcut on Rename: Return already opens in the sidebar, and every free Command
      // combination in this app already means something else.
      item('rename', 'Rename…', null, s.hasTarget),
      // Cmd-Backspace is delete-to-line-start in every text field. On macOS the page sees
      // the key first and the menu only gets what no field took; on Windows and Linux the
      // bar would take Ctrl-Backspace from every field, so there the page routes it.
      item('trash', 'Move to Trash', 'CmdOrCtrl+Backspace', s.hasTarget, { native: mac }),
      separator,
      item('reveal', revealLabel(s.platform), 'CmdOrCtrl+Shift+R', s.hasTarget),
      ...(mac
        ? [separator, predefined('CloseWindow')]
        : [separator, item('settings', 'Settings…', 'CmdOrCtrl+,'), separator, quit]),
    ],
  })

  menus.push({
    id: 'edit', label: 'Edit', role: null,
    items: [
      predefined('Undo'),
      predefined('Redo'),
      separator,
      predefined('Cut'),
      predefined('Copy'),
      predefined('Paste'),
      predefined('SelectAll'),
      separator,
      // Cmd-F stays the raw pane's own find bar - one document, incremental.
      item('find', 'Find…', 'CmdOrCtrl+F', s.hasDocument),
      item('find-in-project', 'Find in Project…', 'CmdOrCtrl+Shift+F', s.canSearch),
      item('go-to-file', 'Go to File…', 'CmdOrCtrl+P', s.canSearch),
      separator,
      item('bold', 'Bold', 'CmdOrCtrl+B', s.canFormat),
      item('italic', 'Italic', 'CmdOrCtrl+I', s.canFormat),
      // Cmd-K is free - Shift-Cmd-K is Add Note and stays where it is.
      item('link', 'Link', 'CmdOrCtrl+K', s.canFormat),
      separator,
      item('add-note', s.hasNoteAtCursor ? 'Edit Note…' : 'Add Note…', 'CmdOrCtrl+Shift+K', s.hasDocument),
      item('delete-note', 'Delete Note', 'CmdOrCtrl+Shift+Backspace', s.hasNoteAtCursor),
    ],
  })

  menus.push({
    id: 'view', label: 'View', role: null,
    items: [
      // Cmd-[ is what every browser and editor on the platform means by Back. Backspace is
      // the other half of that habit and keys.ts carries it - a bare key the bar must not
      // register, or it would take the editor's delete.
      item('back', 'Back', 'CmdOrCtrl+[', s.canGoBack),
      separator,
      // The four panels in screen order, so the menu reads like the window and Cmd-1 to
      // Cmd-4 land where the labels are.
      item('toggle-sidebar', `${s.showSidebar ? 'Collapse' : 'Expand'} Files`, SIDEBAR_ACCELERATOR),
      ...PANES.map((pane) => item(PANE_ACTION[pane], `${s.visiblePanes.includes(pane) ? 'Collapse' : 'Expand'} ${PANE_TITLE[pane]}`, PANE_ACCELERATOR[pane])),
      separator,
      item('side-by-side', 'Preview & Raw', 'CmdOrCtrl+\\'),
      separator,
      // The reading column, the same step the arrows beside the Preview label take. Not
      // registered on the bar: Cmd-arrow is every text field's move-to-line-end, so the
      // page routes these and keeps them off a caret (keys.ts).
      item('narrower', 'Narrower Column', 'CmdOrCtrl+ArrowLeft', true, { native: false }),
      item('wider', 'Wider Column', 'CmdOrCtrl+ArrowRight', true, { native: false }),
      separator,
      // "=" rather than "+": the key is the same and the accelerator has to name a key, not
      // a character that needs Shift on most layouts.
      item('bigger', 'Bigger Text', 'CmdOrCtrl+='),
      item('smaller', 'Smaller Text', 'CmdOrCtrl+-'),
      item('actual-size', 'Actual Size', 'Alt+CmdOrCtrl+0'),
      ...(mac ? [separator, predefined('Fullscreen')] : []),
    ],
  })

  menus.push({
    id: 'theme', label: 'Appearance', role: null,
    items: [
      ...STYLES.map((style): MenuEntry => item(`style:${style.id}`, style.title, null, true, { checked: style.id === activeTheme.style })),
      separator,
      item('mode:light', 'Light', null, true, { checked: !isDark(activeTheme) }),
      item('mode:dark', 'Dark', null, true, { checked: isDark(activeTheme) }),
      separator,
      item('toggle-light-dark', 'Toggle Light/Dark', 'CmdOrCtrl+Shift+D'),
    ],
  })

  menus.push({
    id: 'window', label: 'Window', role: 'window',
    items: mac
      ? [predefined('Minimize'), predefined('Maximize', 'Zoom'), separator, predefined('BringAllToFront')]
      : [predefined('Minimize'), predefined('Maximize'), separator, predefined('CloseWindow')],
  })

  menus.push({
    id: 'help', label: 'Help', role: 'help',
    items: [
      // One item for the whole update flow (src/models/updater.ts): a check, and once the
      // package is downloaded the restart that applies it.
      item('check-updates', s.updateReady ? 'Restart to Update' : 'Check for Updates…', null, s.canCheckUpdates),
      separator,
      item('github', `${s.about.name} on GitHub`),
      ...(mac ? [] : [separator, { kind: 'about', label: `About ${s.about.name}`, info: s.about } as MenuEntry]),
    ],
  })

  return menus
}

/** Every action item, in menu order. */
export function flatItems(menus: MenuModel[]): MenuItemModel[] {
  const out: MenuItemModel[] = []
  for (const menu of menus) for (const entry of menu.items) if (entry.kind === 'item') out.push(entry)
  return out
}

/** What changed between two builds of the same menu: a label, an enabled flag, a check.
 *  The structure never changes at runtime, so items are matched by id. */
export function diffMenu(prev: MenuModel[], next: MenuModel[]): MenuPatch[] {
  const before = new Map(flatItems(prev).map((i) => [i.id, i]))
  const patches: MenuPatch[] = []
  for (const item of flatItems(next)) {
    const old = before.get(item.id)
    if (!old) continue
    const patch: MenuPatch = { id: item.id }
    if (item.label !== old.label) patch.label = item.label
    if (item.enabled !== old.enabled) patch.enabled = item.enabled
    if (item.checked !== undefined && item.checked !== old.checked) patch.checked = item.checked
    if (Object.keys(patch).length > 1) patches.push(patch)
  }
  return patches
}

// MARK: - Matching key events against accelerators (the page's side)

/** The fields of a KeyboardEvent the match reads. */
export interface KeyPress {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** `event.code` for the key part of an accelerator. Codes rather than keys because Alt
 *  turns the key into a symbol on macOS (Alt-R is "®") and Shift into another character. */
function codeFor(token: string): string {
  if (/^[A-Z]$/.test(token)) return `Key${token}`
  if (/^[0-9]$/.test(token)) return `Digit${token}`
  switch (token) {
    case '[': return 'BracketLeft'
    case '\\': return 'Backslash'
    case ',': return 'Comma'
    case '=': return 'Equal'
    case '-': return 'Minus'
    default: return token
  }
}

/** True when the key press is the accelerator: same modifiers exactly, same key. CmdOrCtrl
 *  is Command on macOS and Control elsewhere, never both. */
export function matchesAccelerator(accelerator: string, press: KeyPress, platform: Platform): boolean {
  const parts = accelerator.split('+')
  // "CmdOrCtrl+=" - a trailing empty part means the key was "+" itself, which nothing here uses.
  const token = parts.pop() ?? ''
  const mods = new Set(parts)
  const mod = platform === 'macos' ? press.metaKey : press.ctrlKey
  const other = platform === 'macos' ? press.ctrlKey : press.metaKey
  if (mods.has('CmdOrCtrl') !== mod || other) return false
  if (mods.has('Alt') !== press.altKey) return false
  if (mods.has('Shift') !== press.shiftKey) return false
  return press.code === codeFor(token)
}
