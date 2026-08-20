import { describe, expect, test } from 'bun:test'
import {
  FONT_SETTINGS, ZOOMABLE, canChangeFontSize, captionSize, clampFont, defaultSettings, fontDefault,
  paneNamed, parseSettings, resetFontSizes, serializeSettings, setFontSize, showPane, togglePane,
  visiblePanes,
} from '../src/models/settings'

describe('font settings', () => {
  test.each(FONT_SETTINGS.map((s) => [s.id, s] as const))('%s default sits inside its range', (_, s) => {
    expect(fontDefault(s)).toBeGreaterThanOrEqual(s.min)
    expect(fontDefault(s)).toBeLessThanOrEqual(s.max)
  })

  test('each setting points at a distinct stored size', () => {
    expect(new Set(FONT_SETTINGS.map((s) => s.key)).size).toBe(FONT_SETTINGS.length)
  })

  test.each(FONT_SETTINGS.map((s) => [s.id, s] as const))('%s clamps at both ends', (_, s) => {
    expect(clampFont(s, s.min - 5)).toBe(s.min)
    expect(clampFont(s, s.max + 5)).toBe(s.max)
    expect(clampFont(s, fontDefault(s))).toBe(fontDefault(s))
  })

  test('the four surfaces the settings window names are all covered, in order', () => {
    expect(FONT_SETTINGS.map((s) => s.id)).toEqual(['sidebar', 'buttons', 'editor', 'preview'])
  })

  test('Cmd-+/- is scoped to the document panes', () => {
    expect(ZOOMABLE).toEqual(['editor', 'preview'])
  })

  test('set clamps, canChange respects the range, reset restores defaults', () => {
    const editor = FONT_SETTINGS[2]
    let data = setFontSize(defaultSettings(), editor, 99)
    expect(data.editorFontSize).toBe(editor.max)
    expect(canChangeFontSize(data, editor, 1)).toBe(false)
    expect(canChangeFontSize(data, editor, -1)).toBe(true)
    data = resetFontSizes(data)
    expect(data.editorFontSize).toBe(defaultSettings().editorFontSize)
  })
})

describe('derived text sizes', () => {
  test('captions track the sidebar size two points down', () => {
    expect(captionSize(13)).toBe(11)
    expect(captionSize(20)).toBe(18)
  })

  test('captions never fall below nine points', () => {
    expect(captionSize(FONT_SETTINGS[0].min)).toBe(9)
    expect(captionSize(4)).toBe(9)
  })
})

describe('loading settings.json', () => {
  test('missing or broken text is the defaults', () => {
    expect(parseSettings(null)).toEqual(defaultSettings())
    expect(parseSettings('')).toEqual(defaultSettings())
    expect(parseSettings('{not json')).toEqual(defaultSettings())
    expect(parseSettings('[1,2]')).toEqual(defaultSettings())
  })

  test('stored keys win, missing keys keep their default, unknown keys are dropped', () => {
    const data = parseSettings('{"sidebarWidth": 300, "mystery": true}')
    expect(data.sidebarWidth).toBe(300)
    expect(data.themeID).toBe('paper')
    expect('mystery' in data).toBe(false)
  })

  test('a value of the wrong shape is ignored rather than resetting the file', () => {
    const data = parseSettings('{"sidebarWidth": "wide", "showSidebar": false}')
    expect(data.sidebarWidth).toBe(260)
    expect(data.showSidebar).toBe(false)
  })

  test('optionals accept a value or null', () => {
    expect(parseSettings('{"lastOpenedFile": "/a.md"}').lastOpenedFile).toBe('/a.md')
    expect(parseSettings('{"lastOpenedFile": null}').lastOpenedFile).toBeNull()
    expect(parseSettings('{"windowX": 12.5}').windowX).toBe(12.5)
  })

  test('serialize is pretty, sorted, and round-trips', () => {
    const text = serializeSettings(defaultSettings())
    const keys = Object.keys(JSON.parse(text))
    expect(keys).toEqual([...keys].sort())
    expect(text.endsWith('\n')).toBe(true)
    expect(parseSettings(text)).toEqual(defaultSettings())
  })
})

describe('panes', () => {
  test('legacy bookmarks and comments read as notes', () => {
    expect(paneNamed('bookmarks')).toBe('notes')
    expect(paneNamed('comments')).toBe('notes')
    expect(paneNamed('raw')).toBe('raw')
    expect(paneNamed('nope')).toBeNull()
  })

  test('visible panes are in declaration order and never empty', () => {
    expect(visiblePanes({ ...defaultSettings(), visiblePanes: ['notes', 'raw'] })).toEqual(['raw', 'notes'])
    expect(visiblePanes({ ...defaultSettings(), visiblePanes: [] })).toEqual(['preview'])
    expect(visiblePanes({ ...defaultSettings(), visiblePanes: ['junk'] })).toEqual(['preview'])
  })

  test('toggling off the last pane is ignored', () => {
    const data = defaultSettings()
    expect(togglePane(data, 'preview')).toBe(data)
    const two = togglePane(data, 'raw')
    expect(visiblePanes(two)).toEqual(['preview', 'raw'])
    expect(visiblePanes(togglePane(two, 'preview'))).toEqual(['raw'])
  })

  test('show is idempotent', () => {
    const data = showPane(defaultSettings(), 'notes')
    expect(visiblePanes(data)).toEqual(['preview', 'notes'])
    expect(showPane(data, 'notes')).toBe(data)
  })
})
