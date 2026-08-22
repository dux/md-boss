import { describe, expect, test } from 'bun:test'
import { jsLiteral } from '../src/preview/page'
import {
  THEMES, THEME_IDS, TOKENS, contrast, flippedTheme, isDark, isValidHex, rootCSS, selectingTheme,
  themeChoice, themeNamed, tokenValue, type ThemeID,
} from '../src/theme/theme'

/** Declared rather than derived, so a bad luminance threshold shows up as a failing test
 *  instead of a light theme with a dark titlebar. */
const expectedPolarity: Record<ThemeID, boolean> = {
  'paper': false, 'dark': true, 'solarized-light': false, 'solarized-dark': true,
  'github': false, 'nord': true, 'dracula': true, 'gruvbox': true,
}

const each = THEMES.map((t) => [t.id, t] as const)

describe('theme', () => {
  test.each(each)('%s defines every token as a #RRGGBB literal and nothing else', (_, theme) => {
    expect(Object.keys(theme.hex).sort()).toEqual([...TOKENS].sort())
    for (const token of TOKENS) expect(isValidHex(tokenValue(theme, token))).toBe(true)
  })

  test('no two themes carry the same palette, and every id has exactly one', () => {
    for (let i = 0; i < THEMES.length; i++) {
      for (let j = i + 1; j < THEMES.length; j++) expect(THEMES[i].hex).not.toEqual(THEMES[j].hex)
    }
    for (const id of THEME_IDS) expect(THEMES.filter((t) => t.id === id)).toHaveLength(1)
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS])
  })

  test.each(each)('%s polarity follows the background', (id, theme) => {
    expect(isDark(theme)).toBe(expectedPolarity[id])
  })

  test.each(each)('%s body text clears 7:1 against its own background', (_, theme) => {
    expect(contrast(tokenValue(theme, 'text'), tokenValue(theme, 'bg'))).toBeGreaterThanOrEqual(7)
  })

  test.each(each)('%s muted text clears 4.5:1 against its own background', (_, theme) => {
    expect(contrast(tokenValue(theme, 'muted'), tokenValue(theme, 'bg'))).toBeGreaterThanOrEqual(4.5)
  })

  test.each(each)('%s alert colours clear 4.5:1 against their own background', (_, theme) => {
    for (const token of ['alert-note', 'alert-tip', 'alert-important', 'alert-warning', 'alert-caution'] as const) {
      expect(contrast(tokenValue(theme, token), tokenValue(theme, 'bg'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  test.each(each)('%s rootCSS emits one custom property per token plus a color-scheme', (_, theme) => {
    const css = rootCSS(theme)
    for (const token of TOKENS) expect(css).toContain(`--${token}: ${tokenValue(theme, token)};`)
    expect(css).toContain(`color-scheme: ${isDark(theme) ? 'dark' : 'light'}`)
  })

  test('themeNamed round-trips through the id and falls back to paper', () => {
    for (const id of THEME_IDS) expect(themeNamed(id).id).toBe(id)
    expect(themeNamed('nonsense').id).toBe('paper')
  })

  test('bad hex is rejected rather than silently parsed', () => {
    expect(isValidHex('#FBF7EF')).toBe(true)
    expect(isValidHex('FBF7EF')).toBe(true)
    expect(isValidHex('#FBF7E')).toBe(false)
    expect(isValidHex('#GGGGGG')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })

  test('contrast is the WCAG ratio, symmetric', () => {
    expect(contrast('#000000', '#FFFFFF')).toBe(21)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1)
    expect(contrast('#1F2328', '#FFFFFF')).toBe(contrast('#FFFFFF', '#1F2328'))
  })
})

describe('theme choice', () => {
  test.each(each)('picking %s records it on its own side', (id, theme) => {
    const choice = selectingTheme(themeChoice(), id)
    expect(choice.active).toBe(id)
    expect(isDark(theme) ? choice.dark : choice.light).toBe(id)
  })

  test.each(each)('the toggle flips polarity from %s and twice returns to it', (id, theme) => {
    const start = selectingTheme(themeChoice(), id)
    expect(isDark(themeNamed(flippedTheme(start).active))).toBe(!isDark(theme))
    expect(flippedTheme(flippedTheme(start)).active).toBe(id)
  })

  test('the toggle remembers the last theme used on each side', () => {
    // Nord, then back to a light theme, then Cmd-Shift-D again lands on Nord - not Dark.
    const choice = selectingTheme(selectingTheme(themeChoice(), 'nord'), 'solarized-light')
    expect(flippedTheme(choice).active).toBe('nord')
  })

  test('a stored id on the wrong side or unknown is dropped, so the toggle is never a no-op', () => {
    const corrupt = themeChoice('paper', 'paper', 'github')
    expect(corrupt.dark).toBe('dark')
    expect(isDark(themeNamed(flippedTheme(corrupt).active))).toBe(true)
    expect(themeChoice('mystery', 'mystery', 'mystery')).toEqual({ active: 'paper', light: 'paper', dark: 'dark' })
  })
})

describe('JS literals', () => {
  test('a closing script tag cannot escape the literal', () => {
    const literal = jsLiteral('before </script> after')
    expect(literal).not.toContain('</script>')
    expect(literal).toContain('<\\/script>')
  })

  test('quotes, backslashes and newlines survive; template characters pass through', () => {
    const literal = jsLiteral('a"b\\c\nd')
    expect(literal.startsWith('"') && literal.endsWith('"')).toBe(true)
    expect(literal).toContain('\\"')
    expect(literal).toContain('\\n')
    expect(jsLiteral('`${x}`')).toBe('"`${x}`"')
  })
})
