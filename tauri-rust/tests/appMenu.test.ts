import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { aboutInfo, buildAppMenu, diffMenu, flatItems, matchesAccelerator, type MenuEntry, type MenuItemModel, type MenuState } from '../src/models/appMenu'
import type { Platform } from '../src/models/platform'
import { THEMES } from '../src/theme/theme'

function state(over: Partial<MenuState> = {}): MenuState {
  return {
    platform: 'macos',
    about: aboutInfo('1.2.3'),
    hasRoot: true,
    hasTarget: true,
    hasDocument: true,
    isDirty: false,
    canFormat: true,
    canSearch: true,
    canGoBack: false,
    hasNoteAtCursor: false,
    visiblePanes: ['preview'],
    showSidebar: true,
    themeID: 'paper',
    canCheckUpdates: true,
    updateReady: false,
    ...over,
  }
}

const byId = (s: MenuState) => new Map(flatItems(buildAppMenu(s)).map((i) => [i.id, i]))
const labels = (entries: MenuEntry[]) => entries.map((e) => (e.kind === 'item' || e.kind === 'about' ? e.label : e.kind === 'predefined' ? e.item : '-'))

/** "Alt+CmdOrCtrl+Shift+K" with the modifiers in one order, so two spellings compare. */
function canonical(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  return [...parts].sort().concat(key).join('+')
}

/** The README keyboard table, read as accelerators: ⌘ is CmdOrCtrl, ⇧ Shift, ⌥ Alt, ⌫
 *  Backspace, and ⌘+ is the = key. Escape and the arrows are the sidebar's, not menu items. */
function readmeShortcuts(): string[] {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
  const table = readme.slice(readme.indexOf('## Keyboard'), readme.indexOf('## Configuration'))
  const found = new Set<string>()
  for (const [, mods, key] of table.matchAll(/([⇧⌥⌘]+)([A-Z0-9\\[+\-⌫])/gu)) {
    const parts: string[] = []
    if (mods.includes('⌥')) parts.push('Alt')
    if (mods.includes('⌘')) parts.push('CmdOrCtrl')
    if (mods.includes('⇧')) parts.push('Shift')
    found.add(canonical(parts.concat(key === '⌫' ? 'Backspace' : key === '+' ? '=' : key).join('+')))
  }
  return [...found].sort()
}

describe('the menu carries the README keyboard table', () => {
  test('every shortcut in the table is an accelerator on a menu item, on every platform', () => {
    const expected = readmeShortcuts()
    expect(expected.length).toBeGreaterThan(20)
    for (const platform of ['macos', 'windows', 'linux'] as Platform[]) {
      const registered = flatItems(buildAppMenu(state({ platform }))).filter((i) => i.accelerator).map((i) => canonical(i.accelerator!))
      for (const shortcut of expected) expect(registered).toContain(shortcut)
    }
  })

  test('no two items share an accelerator', () => {
    const all = flatItems(buildAppMenu(state())).filter((i) => i.accelerator).map((i) => canonical(i.accelerator!))
    expect(new Set(all).size).toBe(all.length)
  })

  test('the ones the Swift menu had are on the same items', () => {
    const items = byId(state())
    expect(items.get('new-file')!.accelerator).toBe('CmdOrCtrl+N')
    expect(items.get('open-folder')!.accelerator).toBe('CmdOrCtrl+O')
    expect(items.get('open-file')!.accelerator).toBe('CmdOrCtrl+Shift+O')
    expect(items.get('save')!.accelerator).toBe('CmdOrCtrl+S')
    expect(items.get('trash')!.accelerator).toBe('CmdOrCtrl+Backspace')
    expect(items.get('reveal')!.accelerator).toBe('CmdOrCtrl+Shift+R')
    expect(items.get('find')!.accelerator).toBe('CmdOrCtrl+F')
    expect(items.get('find-in-project')!.accelerator).toBe('CmdOrCtrl+Shift+F')
    expect(items.get('go-to-file')!.accelerator).toBe('CmdOrCtrl+P')
    expect(items.get('bold')!.accelerator).toBe('CmdOrCtrl+B')
    expect(items.get('italic')!.accelerator).toBe('CmdOrCtrl+I')
    expect(items.get('link')!.accelerator).toBe('CmdOrCtrl+K')
    expect(items.get('add-note')!.accelerator).toBe('CmdOrCtrl+Shift+K')
    expect(items.get('delete-note')!.accelerator).toBe('CmdOrCtrl+Shift+Backspace')
    expect(items.get('back')!.accelerator).toBe('CmdOrCtrl+[')
    expect(items.get('toggle-raw')!.accelerator).toBe('Alt+CmdOrCtrl+R')
    expect(items.get('toggle-preview')!.accelerator).toBe('Alt+CmdOrCtrl+V')
    expect(items.get('toggle-notes')!.accelerator).toBe('Alt+CmdOrCtrl+N')
    expect(items.get('side-by-side')!.accelerator).toBe('CmdOrCtrl+\\')
    expect(items.get('toggle-light-dark')!.accelerator).toBe('CmdOrCtrl+Shift+D')
    expect(items.get('toggle-sidebar')!.accelerator).toBe('CmdOrCtrl+0')
    expect(items.get('bigger')!.accelerator).toBe('CmdOrCtrl+=')
    expect(items.get('smaller')!.accelerator).toBe('CmdOrCtrl+-')
    expect(items.get('actual-size')!.accelerator).toBe('Alt+CmdOrCtrl+0')
    expect(items.get('settings')!.accelerator).toBe('CmdOrCtrl+,')
    expect(items.get('rename')!.accelerator).toBeNull()
    expect(items.get('revert')!.accelerator).toBeNull()
  })
})

describe('menu structure', () => {
  test('the six menus, plus the app menu on macOS', () => {
    expect(buildAppMenu(state()).map((m) => m.label)).toEqual(['md-boss', 'File', 'Edit', 'View', 'Theme', 'Window', 'Help'])
    expect(buildAppMenu(state({ platform: 'windows' })).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Theme', 'Window', 'Help'])
    expect(buildAppMenu(state({ platform: 'linux' })).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Theme', 'Window', 'Help'])
  })

  test('macOS: About and Settings in the app menu, the Window and Help menus are told their roles', () => {
    const menus = buildAppMenu(state())
    const app = menus[0]
    expect(app.role).toBe('app')
    expect(labels(app.items)).toEqual(['About md-boss', '-', 'Settings…', '-', 'Services', '-', 'Hide', 'HideOthers', 'ShowAll', '-', 'Quit md-boss'])
    expect(menus.find((m) => m.id === 'window')!.role).toBe('window')
    expect(menus.find((m) => m.id === 'help')!.role).toBe('help')
    const about = app.items[0]
    expect(about.kind === 'about' && about.info).toEqual(aboutInfo('1.2.3'))
  })

  test('Windows and Linux: Settings and Quit close the File menu, About sits in Help', () => {
    for (const platform of ['windows', 'linux'] as Platform[]) {
      const menus = buildAppMenu(state({ platform }))
      const file = labels(menus.find((m) => m.id === 'file')!.items)
      expect(file.slice(-4)).toEqual(['-', 'Settings…', '-', platform === 'windows' ? 'Exit' : 'Quit'])
      expect(labels(menus.find((m) => m.id === 'help')!.items)).toEqual(['Check for Updates…', '-', 'md-boss on GitHub', '-', 'About md-boss'])
      expect(labels(menus.find((m) => m.id === 'window')!.items)).toEqual(['Minimize', 'Maximize', '-', 'CloseWindow'])
    }
    expect(labels(buildAppMenu(state()).find((m) => m.id === 'help')!.items)).toEqual(['Check for Updates…', '-', 'md-boss on GitHub'])
  })

  test('the Help item is the update flow: a check, then the restart once one is downloaded, off where nothing is signed', () => {
    expect(byId(state()).get('check-updates')!).toMatchObject({ label: 'Check for Updates…', enabled: true, accelerator: null })
    expect(byId(state({ updateReady: true })).get('check-updates')!.label).toBe('Restart to Update')
    expect(byId(state({ canCheckUpdates: false })).get('check-updates')!.enabled).toBe(false)
    expect(diffMenu(buildAppMenu(state()), buildAppMenu(state({ updateReady: true })))).toEqual([{ id: 'check-updates', label: 'Restart to Update' }])
  })

  test('the reveal item is named for the platform', () => {
    expect(byId(state()).get('reveal')!.label).toBe('Reveal in Finder')
    expect(byId(state({ platform: 'windows' })).get('reveal')!.label).toBe('Show in Explorer')
    expect(byId(state({ platform: 'linux' })).get('reveal')!.label).toBe('Show in File Manager')
  })

  test('Move to Trash keeps Cmd-Backspace off the menu bar where it would take the key from text fields', () => {
    expect(byId(state()).get('trash')!.native).toBe(true)
    expect(byId(state({ platform: 'windows' })).get('trash')!.native).toBe(false)
    expect(byId(state({ platform: 'linux' })).get('trash')!.native).toBe(false)
    const others = flatItems(buildAppMenu(state({ platform: 'linux' }))).filter((i) => i.id !== 'trash')
    expect(others.every((i) => i.native)).toBe(true)
  })

  test('the Edit menu keeps the system items and the mac Edit order: find, format, notes', () => {
    const edit = labels(buildAppMenu(state()).find((m) => m.id === 'edit')!.items)
    expect(edit).toEqual([
      'Undo', 'Redo', '-', 'Cut', 'Copy', 'Paste', 'SelectAll', '-',
      'Find…', 'Find in Project…', 'Go to File…', '-', 'Bold', 'Italic', 'Link', '-', 'Add Note…', 'Delete Note',
    ])
  })
})

describe('state in the menu', () => {
  test('the eight themes are check items, the active one checked, in palette order', () => {
    const theme = buildAppMenu(state({ themeID: 'nord' })).find((m) => m.id === 'theme')!
    const checks = theme.items.filter((e): e is MenuItemModel => e.kind === 'item' && e.checked !== undefined)
    expect(checks.map((c) => c.label)).toEqual(THEMES.map((t) => t.title))
    expect(checks.filter((c) => c.checked).map((c) => c.id)).toEqual(['theme:nord'])
    expect(labels(theme.items).slice(-2)).toEqual(['-', 'Toggle Light/Dark'])
  })

  test('pane, sidebar and note items say what they will do', () => {
    const shown = byId(state({ visiblePanes: ['preview', 'raw'], showSidebar: true, hasNoteAtCursor: true }))
    expect(shown.get('toggle-preview')!.label).toBe('Hide Preview')
    expect(shown.get('toggle-raw')!.label).toBe('Hide Raw')
    expect(shown.get('toggle-notes')!.label).toBe('Show Notes')
    expect(shown.get('toggle-sidebar')!.label).toBe('Hide Sidebar')
    expect(shown.get('add-note')!.label).toBe('Edit Note…')
    const hidden = byId(state({ visiblePanes: ['notes'], showSidebar: false }))
    expect(hidden.get('toggle-preview')!.label).toBe('Show Preview')
    expect(hidden.get('toggle-sidebar')!.label).toBe('Show Sidebar')
    expect(hidden.get('add-note')!.label).toBe('Add Note…')
  })

  test('enablement follows the manager, as the Swift menu did', () => {
    const off = byId(state({ hasRoot: false, hasTarget: false, hasDocument: false, isDirty: false, canFormat: false, canSearch: false, canGoBack: false, hasNoteAtCursor: false }))
    for (const id of ['new-file', 'save', 'revert', 'rename', 'trash', 'reveal', 'find', 'find-in-project', 'go-to-file', 'bold', 'italic', 'link', 'add-note', 'delete-note', 'back']) {
      expect(off.get(id as never)!.enabled).toBe(false)
    }
    for (const id of ['open-folder', 'open-file', 'settings', 'toggle-raw', 'side-by-side', 'toggle-sidebar', 'bigger', 'smaller', 'actual-size', 'toggle-light-dark', 'check-updates', 'github']) {
      expect(off.get(id as never)!.enabled).toBe(true)
    }
    const on = byId(state({ isDirty: true, canGoBack: true, hasNoteAtCursor: true }))
    expect(on.get('save')!.enabled).toBe(true)
    expect(on.get('revert')!.enabled).toBe(true)
    expect(on.get('back')!.enabled).toBe(true)
    expect(on.get('delete-note')!.enabled).toBe(true)
  })
})

describe('diffMenu', () => {
  test('only what changed, by id', () => {
    const before = buildAppMenu(state())
    const after = buildAppMenu(state({ isDirty: true, themeID: 'dark', visiblePanes: ['preview', 'raw'] }))
    expect(diffMenu(before, after)).toEqual([
      { id: 'save', enabled: true },
      { id: 'revert', enabled: true },
      { id: 'toggle-raw', label: 'Hide Raw' },
      { id: 'theme:paper', checked: false },
      { id: 'theme:dark', checked: true },
    ])
    expect(diffMenu(after, after)).toEqual([])
  })
})

describe('matchesAccelerator', () => {
  const press = (over: Partial<Parameters<typeof matchesAccelerator>[1]>) =>
    ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })

  test('CmdOrCtrl is Command on macOS and Control elsewhere, never the other', () => {
    expect(matchesAccelerator('CmdOrCtrl+S', press({ code: 'KeyS', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+S', press({ code: 'KeyS', ctrlKey: true }), 'macos')).toBe(false)
    expect(matchesAccelerator('CmdOrCtrl+S', press({ code: 'KeyS', ctrlKey: true }), 'windows')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+S', press({ code: 'KeyS', metaKey: true }), 'linux')).toBe(false)
    expect(matchesAccelerator('CmdOrCtrl+S', press({ code: 'KeyS', metaKey: true, ctrlKey: true }), 'macos')).toBe(false)
  })

  test('modifiers must match exactly', () => {
    expect(matchesAccelerator('CmdOrCtrl+Shift+F', press({ code: 'KeyF', metaKey: true, shiftKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+F', press({ code: 'KeyF', metaKey: true, shiftKey: true }), 'macos')).toBe(false)
    expect(matchesAccelerator('CmdOrCtrl+Shift+F', press({ code: 'KeyF', metaKey: true }), 'macos')).toBe(false)
    expect(matchesAccelerator('Alt+CmdOrCtrl+R', press({ code: 'KeyR', key: '®', metaKey: true, altKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+R', press({ code: 'KeyR', metaKey: true, altKey: true }), 'macos')).toBe(false)
  })

  test('punctuation, digits and Backspace go by code', () => {
    expect(matchesAccelerator('CmdOrCtrl+[', press({ code: 'BracketLeft', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+\\', press({ code: 'Backslash', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+,', press({ code: 'Comma', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+=', press({ code: 'Equal', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+-', press({ code: 'Minus', metaKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('Alt+CmdOrCtrl+0', press({ code: 'Digit0', metaKey: true, altKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+Shift+Backspace', press({ code: 'Backspace', key: 'Backspace', metaKey: true, shiftKey: true }), 'macos')).toBe(true)
    expect(matchesAccelerator('CmdOrCtrl+Backspace', press({ code: 'Backspace', metaKey: true, shiftKey: true }), 'macos')).toBe(false)
  })
})
