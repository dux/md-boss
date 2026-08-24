import { describe, expect, test } from 'bun:test'
import { jsLiteral } from '../src/preview/page'
import {
  DENSITY_TOKENS, STYLES, STYLE_IDS, THEMES, THEME_IDS, TOKENS, contrast, flippedTheme, isDark,
  isValidHex, rootCSS, selectingMode, selectingStyle, styleNamed, themeForStyle, themeNamed,
  tokenValue, type ThemeID,
} from '../src/theme/theme'

/** Declared rather than derived, so a bad luminance threshold shows up as a failing test
 *  instead of a light theme with a dark titlebar. */
const expectedPolarity: Record<ThemeID, boolean> = {
  'paper': false, 'dark': true, 'compact-light': false, 'compact-dark': true,
}

const each = THEMES.map((t) => [t.id, t] as const)

describe('theme', () => {
  test.each(each)('%s defines every token as a #RRGGBB literal and nothing else', (_, theme) => {
    expect(Object.keys(theme.hex).sort()).toEqual([...TOKENS].sort())
    for (const token of TOKENS) expect(isValidHex(tokenValue(theme, token))).toBe(true)
  })

  test('every appearance id has exactly one theme', () => {
    for (const id of THEME_IDS) expect(THEMES.filter((t) => t.id === id)).toHaveLength(1)
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS])
  })

  test('default and compact share the house palettes', () => {
    expect(themeNamed('compact-light').hex).toEqual(themeNamed('paper').hex)
    expect(themeNamed('compact-dark').hex).toEqual(themeNamed('dark').hex)
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
    for (const token of DENSITY_TOKENS) expect(css).toContain(`--${token}: ${styleNamed(theme.style).density[token]};`)
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

describe('display style', () => {
  test('the style list contains only Default and Compact', () => {
    expect(STYLES.map((style) => style.id)).toEqual([...STYLE_IDS])
    expect(STYLES.map((style) => style.title)).toEqual(['Default', 'Compact'])
  })

  test.each(STYLES.map((style) => [style.id, style] as const))('%s defines every density token', (_, style) => {
    expect(Object.keys(style.density).sort()).toEqual([...DENSITY_TOKENS].sort())
  })

  test('Compact is smaller and tighter than Default', () => {
    expect(styleNamed('compact').density['chrome-font-offset']).toBe('-1px')
    expect(styleNamed('compact').density['document-font-offset']).toBe('-2px')
    expect(Number(styleNamed('compact').density['document-line-height'])).toBeLessThan(Number(styleNamed('default').density['document-line-height']))
  })
})

describe('appearance choice', () => {
  test.each(each)('the toggle flips mode from %s, preserves style, and twice returns', (id, theme) => {
    const flipped = flippedTheme(theme)
    expect(isDark(flipped)).toBe(!isDark(theme))
    expect(flipped.style).toBe(theme.style)
    expect(flippedTheme(flipped).id).toBe(id)
  })

  test('selecting a style preserves mode', () => {
    expect(selectingStyle(themeNamed('paper'), 'compact').id).toBe('compact-light')
    expect(selectingStyle(themeNamed('dark'), 'compact').id).toBe('compact-dark')
    expect(selectingStyle(themeNamed('compact-dark'), 'default').id).toBe('dark')
  })

  test('selecting a mode preserves style', () => {
    expect(selectingMode(themeNamed('compact-light'), true).id).toBe('compact-dark')
    expect(selectingMode(themeNamed('compact-dark'), false).id).toBe('compact-light')
  })

  test('themeForStyle covers both styles and modes', () => {
    expect(themeForStyle('default', false).id).toBe('paper')
    expect(themeForStyle('default', true).id).toBe('dark')
    expect(themeForStyle('compact', false).id).toBe('compact-light')
    expect(themeForStyle('compact', true).id).toBe('compact-dark')
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
