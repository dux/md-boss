// One object is the whole persisted surface. Adding a setting means adding a property to
// the defaults and nowhere else - parseSettings merges stored JSON over them, so old config
// files stay readable and unknown keys are dropped rather than fatal.

export const PANES = ['preview', 'raw', 'notes'] as const
export type Pane = (typeof PANES)[number]

export interface SettingsData {
  themeID: string
  /** Which panes the viewer shows, left to right in PANES order. */
  visiblePanes: string[]
  sidebarWidth: number
  /** The notes column's width. A list rather than a document, so it keeps a width of its
   *  own instead of sharing what preview and raw split. */
  notesWidth: number
  showSidebar: boolean
  previewFontSize: number
  /** Reading measure in em, so the column tracks the text size rather than fighting it.
   *  48em of the body serif is roughly 82 characters. */
  previewMeasure: number
  editorFontSize: number
  fontDefault: number
  fontButtons: number
  /** Which note scopes are unfolded. Both wider ones start closed. */
  expandedNoteScopes: string[]
  expandedPaths: string[]
  /** Reopened on launch. */
  lastOpenedFile: string | null
  /** Where the Open Folder panel starts next time. */
  lastOpenedFolder: string | null
  /** Never listed in the tree. Editable by hand in settings.json. */
  skipFolders: string[]
}

export function defaultSettings(): SettingsData {
  return {
    themeID: 'paper',
    visiblePanes: ['preview'],
    sidebarWidth: 260,
    notesWidth: 350,
    showSidebar: true,
    previewFontSize: 17,
    previewMeasure: 48,
    editorFontSize: 13,
    fontDefault: 13,
    fontButtons: 12,
    expandedNoteScopes: [],
    expandedPaths: [],
    lastOpenedFile: null,
    lastOpenedFolder: null,
    skipFolders: [
      'node_modules', '.build', '.git', 'DerivedData',
      'Pods', '__pycache__', '.next', 'vendor', 'dist', 'coverage',
    ],
  }
}

// MARK: - Persistence

/** Stored JSON merged over the defaults, key by key: a missing key keeps its default, an
 *  unknown key is dropped, and a value of the wrong shape is ignored rather than letting
 *  one bad line reset the whole file. */
export function parseSettings(text: string | null | undefined): SettingsData {
  const defaults = defaultSettings()
  if (!text) return defaults
  let stored: unknown
  try {
    stored = JSON.parse(text)
  } catch {
    return defaults
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return defaults

  const out = defaults as unknown as Record<string, unknown>
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = (stored as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (sameShape(value, fallback)) out[key] = value
  }
  return out as unknown as SettingsData
}

function sameShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return value === null || typeof value === 'number' || typeof value === 'string'
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every((v) => typeof v === 'string')
  return typeof value === typeof fallback
}

/** Pretty, sorted keys - a file meant to be read and edited by hand, and diffed. */
export function serializeSettings(data: SettingsData): string {
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : 1)))
  return JSON.stringify(sorted, null, 2) + '\n'
}

// MARK: - Panes

/** Written by builds from before bookmarks and comments were one pane. Without this a
 *  config naming either one decodes to nothing and the viewer silently resets. */
export function paneNamed(stored: string): Pane | null {
  if (stored === 'bookmarks' || stored === 'comments') return 'notes'
  return (PANES as readonly string[]).includes(stored) ? (stored as Pane) : null
}

export const PANE_TITLE: Record<Pane, string> = { preview: 'Preview', raw: 'Raw', notes: 'Notes' }

/** Always in declaration order, and possibly empty: a pane that is off still holds its
 *  header rail on screen, so "all collapsed" is a viewer state, not a dead end. */
export function visiblePanes(data: SettingsData): Pane[] {
  const shown = new Set(data.visiblePanes.map(paneNamed).filter((p): p is Pane => p !== null))
  return PANES.filter((p) => shown.has(p))
}

export function togglePane(data: SettingsData, pane: Pane): SettingsData {
  const shown = new Set<string>(visiblePanes(data))
  if (shown.has(pane)) shown.delete(pane)
  else shown.add(pane)
  return { ...data, visiblePanes: PANES.filter((p) => shown.has(p)) }
}

export function showPane(data: SettingsData, pane: Pane): SettingsData {
  return visiblePanes(data).includes(pane) ? data : togglePane(data, pane)
}

// MARK: - Adjustable text sizes

type SizeKey = 'fontDefault' | 'fontButtons' | 'editorFontSize' | 'previewFontSize'

/** The four text sizes the settings window exposes, in on-screen order. One list drives the
 *  window, the Bigger/Smaller Text commands and the reset, so the clamps live here rather
 *  than as magic numbers at each call site. */
export interface FontSetting {
  id: 'sidebar' | 'buttons' | 'editor' | 'preview'
  title: string
  detail: string
  key: SizeKey
  min: number
  max: number
}

export const FONT_SETTINGS: readonly FontSetting[] = [
  { id: 'sidebar', title: 'Sidebar', detail: 'Folder and file names', key: 'fontDefault', min: 10, max: 20 },
  { id: 'buttons', title: 'Buttons', detail: 'Toolbar and pane buttons', key: 'fontButtons', min: 9, max: 18 },
  { id: 'editor', title: 'Raw text', detail: 'The editor pane', key: 'editorFontSize', min: 9, max: 24 },
  { id: 'preview', title: 'Preview', detail: 'The rendered document', key: 'previewFontSize', min: 11, max: 28 },
]

/** Cmd-+/- is a document zoom, not an app-wide one. */
export const ZOOMABLE: readonly FontSetting['id'][] = ['editor', 'preview']

export const fontSetting = (id: FontSetting['id']) => FONT_SETTINGS.find((s) => s.id === id)!
export const clampFont = (s: FontSetting, value: number) => Math.min(s.max, Math.max(s.min, value))
export const fontDefault = (s: FontSetting) => defaultSettings()[s.key]
export const fontSize = (data: SettingsData, s: FontSetting) => data[s.key]

export function setFontSize(data: SettingsData, s: FontSetting, value: number): SettingsData {
  return { ...data, [s.key]: clampFont(s, value) }
}

export function canChangeFontSize(data: SettingsData, s: FontSetting, delta: number): boolean {
  const next = data[s.key] + delta
  return next >= s.min && next <= s.max
}

export function resetFontSizes(data: SettingsData): SettingsData {
  let out = data
  for (const s of FONT_SETTINGS) out = setFontSize(out, s, fontDefault(s))
  return out
}

/** Captions and section headers track the sidebar size instead of being settings of their
 *  own - a status bar still at 11pt under an 18pt tree reads as a bug. */
export const captionSize = (base: number) => Math.max(9, base - 2)
