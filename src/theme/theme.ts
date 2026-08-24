// Every colour in the app is a token; the token's name is the CSS custom property both the
// chrome and the preview page read, so the two are guaranteed to describe the same palette.
// The palettes below are the one place a hex literal is allowed to appear. Tests gate both
// light and dark on completeness and contrast.

export const TOKENS = [
  'bg', 'surface', 'sidebar-bg', 'text', 'muted', 'border', 'border-strong',
  'accent', 'link', 'selection', 'code-bg', 'code-border', 'quote-bar',
  'quote-text', 'table-stripe', 'table-head', 'rule',
  // GFM alerts. Five hues rather than one accent, because the colour is the whole point of
  // an alert. Each carries the title text as well as the bar, so all five are gated at 4.5:1.
  'alert-note', 'alert-tip', 'alert-important', 'alert-warning', 'alert-caution',
  'hl-keyword', 'hl-string', 'hl-number', 'hl-title', 'hl-comment',
  'hl-variable', 'hl-type', 'hl-meta',
] as const

export type Token = (typeof TOKENS)[number]

export const STYLE_IDS = ['default', 'compact'] as const
export type StyleID = (typeof STYLE_IDS)[number]

export const DENSITY_TOKENS = [
  'chrome-font-offset', 'document-font-offset', 'document-line-height',
  'document-padding-x', 'document-padding-y', 'document-block-space',
  'document-code-padding-x', 'document-code-padding-y',
  'document-cell-padding-x', 'document-cell-padding-y',
  'editor-font-offset', 'editor-line-height', 'editor-padding-y',
] as const

export type DensityToken = (typeof DENSITY_TOKENS)[number]

export interface DisplayStyle {
  id: StyleID
  title: string
  density: Record<DensityToken, string>
}

const defaultStyle: DisplayStyle = {
  id: 'default',
  title: 'Default',
  density: {
    'chrome-font-offset': '0px', 'document-font-offset': '0px', 'document-line-height': '1.7',
    'document-padding-x': '32px', 'document-padding-y': '40px', 'document-block-space': '1.4em',
    'document-code-padding-x': '16px', 'document-code-padding-y': '14px',
    'document-cell-padding-x': '12px', 'document-cell-padding-y': '7px',
    'editor-font-offset': '0px', 'editor-line-height': '1.5', 'editor-padding-y': '20px',
  },
}

const compactStyle: DisplayStyle = {
  id: 'compact',
  title: 'Compact',
  density: {
    'chrome-font-offset': '-1px', 'document-font-offset': '-2px', 'document-line-height': '1.52',
    'document-padding-x': '24px', 'document-padding-y': '28px', 'document-block-space': '1em',
    'document-code-padding-x': '12px', 'document-code-padding-y': '10px',
    'document-cell-padding-x': '9px', 'document-cell-padding-y': '5px',
    'editor-font-offset': '-1px', 'editor-line-height': '1.35', 'editor-padding-y': '12px',
  },
}

/** The two display styles. Colour is chosen independently by switching the active style's
 *  light or dark variant. */
export const STYLES: readonly DisplayStyle[] = [defaultStyle, compactStyle]

export function styleNamed(id: string): DisplayStyle {
  return STYLES.find((style) => style.id === id) ?? defaultStyle
}

/** The persisted identity of an appearance - what lands in settings.json. */
export const THEME_IDS = ['paper', 'dark', 'compact-light', 'compact-dark'] as const

export type ThemeID = (typeof THEME_IDS)[number]

export interface Theme {
  id: ThemeID
  title: string
  style: StyleID
  hex: Record<Token, string>
}

const MAGENTA = '#FF00FF'

/** Missing tokens resolve to magenta rather than throwing - a palette hole should be loud
 *  on screen and caught by the tests, not fatal at runtime. */
export const tokenValue = (theme: Theme, token: Token) => theme.hex[token] ?? MAGENTA

// MARK: - Palettes

/** Warm cream stock, warm ink, burnt-sienna accent. Text on bg is ~13:1. */
const paper: Theme = {
  id: 'paper',
  title: 'Default Light',
  style: 'default',
  hex: {
    'bg': '#FBF7EF', 'surface': '#F3EDE1', 'sidebar-bg': '#F3EDE1', 'text': '#2B2723',
    'muted': '#756C61', 'border': '#E3D9C6', 'border-strong': '#CFC4AE', 'accent': '#9A5B34',
    'link': '#1F5C8B', 'selection': '#EADFC9', 'code-bg': '#F2EADA', 'code-border': '#E0D5BF',
    'quote-bar': '#D8C7A5', 'quote-text': '#5C554C', 'table-stripe': '#F5EFE3',
    'table-head': '#EDE5D4', 'rule': '#E3D9C6',
    'alert-note': '#2F5D8C', 'alert-tip': '#4C6B3C', 'alert-important': '#6D4C9F',
    'alert-warning': '#8A5A20', 'alert-caution': '#A03E52',
    'hl-keyword': '#A03E52', 'hl-string': '#4C6B3C', 'hl-number': '#8A5A20', 'hl-title': '#6D4C9F',
    'hl-comment': '#94897A', 'hl-variable': '#2F5D8C', 'hl-type': '#8A5A20', 'hl-meta': '#94897A',
  },
}

/** The same hue family rotated dark, so switching reads as the same app at night.
 *  Deliberately warm charcoal - not #000, not blue-black. Text on bg is ~12:1. */
const dark: Theme = {
  id: 'dark',
  title: 'Default Dark',
  style: 'default',
  hex: {
    'bg': '#1E1C1A', 'surface': '#26231F', 'sidebar-bg': '#1A1817', 'text': '#E6E0D6',
    'muted': '#9A9287', 'border': '#38342E', 'border-strong': '#4A443C', 'accent': '#E0996A',
    'link': '#7FB3D5', 'selection': '#3A332B', 'code-bg': '#26231F', 'code-border': '#39342C',
    'quote-bar': '#6B5B45', 'quote-text': '#B9B1A4', 'table-stripe': '#232019',
    'table-head': '#2B2722', 'rule': '#38342E',
    'alert-note': '#8FBBDE', 'alert-tip': '#A3C48A', 'alert-important': '#C0A6E8',
    'alert-warning': '#E0B87A', 'alert-caution': '#E88B9A',
    'hl-keyword': '#E88B9A', 'hl-string': '#A3C48A', 'hl-number': '#E0B87A', 'hl-title': '#C0A6E8',
    'hl-comment': '#7E7566', 'hl-variable': '#8FBBDE', 'hl-type': '#E0B87A', 'hl-meta': '#7E7566',
  },
}

const compactLight: Theme = { ...paper, id: 'compact-light', title: 'Compact Light', style: 'compact' }
const compactDark: Theme = { ...dark, id: 'compact-dark', title: 'Compact Dark', style: 'compact' }

/** The four style/mode combinations. The Settings panel presents the two axes separately. */
export const THEMES: readonly Theme[] = [paper, dark, compactLight, compactDark]

/** An id with no palette falls back to Paper rather than rendering magenta - a hand-edited
 *  settings.json should not be able to break the app. */
export function themeNamed(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? paper
}

export const DEFAULT_THEME = paper

// MARK: - Colour maths

/** Channels in 0..1, or null if the string is not a #RRGGBB literal. */
function rgb(hex: string): [number, number, number] | null {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9A-Fa-f]{6}$/.test(digits)) return null
  const value = parseInt(digits, 16)
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

export const isValidHex = (hex: string) => rgb(hex) !== null

/** WCAG relative luminance, 0 (black) to 1 (white). Unparseable hex reads as mid grey so
 *  a broken token cannot flip a whole theme's polarity. */
export function luminance(hex: string): number {
  const channels = rgb(hex)
  if (!channels) return 0.5
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2])
}

/** WCAG contrast ratio between two #RRGGBB literals, 1 (identical) to 21 (black on white). */
export function contrast(one: string, other: string): number {
  const a = luminance(one)
  const b = luminance(other)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Derived from the background rather than declared: a stored flag that disagrees with the
 *  palette it describes is a bug that cannot happen if the flag does not exist. */
export const isDark = (theme: Theme) => luminance(tokenValue(theme, 'bg')) < 0.5

/** The :root block both the chrome's <style id="theme"> and the preview page carry. */
export function rootCSS(theme: Theme): string {
  const vars = TOKENS.map((t) => `  --${t}: ${tokenValue(theme, t)};`).join('\n')
  const density = styleNamed(theme.style).density
  const densityVars = DENSITY_TOKENS.map((t) => `  --${t}: ${density[t]};`).join('\n')
  // color-scheme keeps scrollbars, form controls and the caret on the same side of the line
  // as the palette - a light scrollbar on a dark page is the tell it was forgotten.
  return `:root {\n${vars}\n${densityVars}\n  color-scheme: ${isDark(theme) ? 'dark' : 'light'};\n}`
}

// MARK: - Appearance choice

export function themeForStyle(style: StyleID, darkMode: boolean): Theme {
  const id: ThemeID = style === 'compact'
    ? darkMode ? 'compact-dark' : 'compact-light'
    : darkMode ? 'dark' : 'paper'
  return themeNamed(id)
}

/** Changes density while preserving light/dark mode. */
export const selectingStyle = (theme: Theme, style: StyleID): Theme => themeForStyle(style, isDark(theme))

/** Changes light/dark mode while preserving density. */
export const selectingMode = (theme: Theme, darkMode: boolean): Theme => themeForStyle(theme.style, darkMode)

/** Cmd-Shift-D changes only colour mode. */
export const flippedTheme = (theme: Theme): Theme => selectingMode(theme, !isDark(theme))
