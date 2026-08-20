// Every colour in the app is a token; the token's name is the CSS custom property both the
// chrome and the preview page read, so the two are guaranteed to describe the same palette.
// The palettes below are the one place a hex literal is allowed to appear. Six of the eight
// are ports of schemes people already recognise; where a scheme's canonical body text is
// too pale for a document reader, the emphasized value is used instead - this is a reading
// app before it is a tribute. Tests gate every palette on completeness and contrast.

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

/** The persisted identity of a theme - what lands in settings.json. Order is picker and
 *  menu order. */
export const THEME_IDS = [
  'paper', 'dark', 'solarized-light', 'solarized-dark', 'github', 'nord', 'dracula', 'gruvbox',
] as const

export type ThemeID = (typeof THEME_IDS)[number]

export interface Theme {
  id: ThemeID
  title: string
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
  title: 'Paper',
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
  title: 'Dark',
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

/** Solarized (Ethan Schoonover), base3 stock. Body text is base02 and secondary text
 *  base01, rather than the canonical base00 - that takes text on bg from 4.5:1 to ~12:1.
 *  The accents are a terminal contrast too and are lifted along lightness. */
const solarizedLight: Theme = {
  id: 'solarized-light',
  title: 'Solarized Light',
  hex: {
    'bg': '#FDF6E3', 'surface': '#EEE8D5', 'sidebar-bg': '#EEE8D5', 'text': '#073642',
    'muted': '#586E75', 'border': '#E0D9C2', 'border-strong': '#CFC7B0', 'accent': '#CB4B16',
    'link': '#268BD2', 'selection': '#E8E0C8', 'code-bg': '#EEE8D5', 'code-border': '#DDD6C1',
    'quote-bar': '#D3CBB7', 'quote-text': '#586E75', 'table-stripe': '#F5EFDC',
    'table-head': '#EBE4D0', 'rule': '#E0D9C2',
    'alert-note': '#2074AF', 'alert-tip': '#667500', 'alert-important': '#6166C0',
    'alert-warning': '#8C6A00', 'alert-caution': '#D72724',
    'hl-keyword': '#859900', 'hl-string': '#2AA198', 'hl-number': '#D33682', 'hl-title': '#268BD2',
    'hl-comment': '#93A1A1', 'hl-variable': '#B58900', 'hl-type': '#CB4B16', 'hl-meta': '#93A1A1',
  },
}

/** base03 stock. Links are lifted off the canonical base blue, which only manages 4.3:1. */
const solarizedDark: Theme = {
  id: 'solarized-dark',
  title: 'Solarized Dark',
  hex: {
    'bg': '#002B36', 'surface': '#073642', 'sidebar-bg': '#01242E', 'text': '#EEE8D5',
    'muted': '#93A1A1', 'border': '#0E4451', 'border-strong': '#1A5A6B', 'accent': '#CB4B16',
    'link': '#58A6DE', 'selection': '#0B3A46', 'code-bg': '#073642', 'code-border': '#0F4553',
    'quote-bar': '#2C5D68', 'quote-text': '#93A1A1', 'table-stripe': '#05303B',
    'table-head': '#083C48', 'rule': '#0E4451',
    'alert-note': '#58A6DE', 'alert-tip': '#859900', 'alert-important': '#9A9AE0',
    'alert-warning': '#B58900', 'alert-caution': '#E56866',
    'hl-keyword': '#859900', 'hl-string': '#2AA198', 'hl-number': '#D33682', 'hl-title': '#58A6DE',
    'hl-comment': '#586E75', 'hl-variable': '#B58900', 'hl-type': '#CB4B16', 'hl-meta': '#586E75',
  },
}

/** GitHub Light (Primer). The neutral option: plain white stock, no warmth at all. Links sit
 *  a shade darker than the accent so a link inside a selected row is still distinguishable. */
const github: Theme = {
  id: 'github',
  title: 'GitHub Light',
  hex: {
    'bg': '#FFFFFF', 'surface': '#F6F8FA', 'sidebar-bg': '#F6F8FA', 'text': '#1F2328',
    'muted': '#656D76', 'border': '#D0D7DE', 'border-strong': '#AFB8C1', 'accent': '#0969DA',
    'link': '#0550AE', 'selection': '#DDF4FF', 'code-bg': '#F6F8FA', 'code-border': '#D0D7DE',
    'quote-bar': '#D0D7DE', 'quote-text': '#656D76', 'table-stripe': '#FAFBFC',
    'table-head': '#EAEEF2', 'rule': '#D0D7DE',
    'alert-note': '#0550AE', 'alert-tip': '#116329', 'alert-important': '#8250DF',
    'alert-warning': '#9A6700', 'alert-caution': '#CF222E',
    'hl-keyword': '#CF222E', 'hl-string': '#0A3069', 'hl-number': '#0550AE', 'hl-title': '#8250DF',
    'hl-comment': '#6E7781', 'hl-variable': '#953800', 'hl-type': '#953800', 'hl-meta': '#6E7781',
  },
}

/** Nord (Arctic Ice Studio). Cool polar night stock with the frost blues as accent. Muted
 *  sits between nord3 and nord4; nord3 alone is too dark to read as secondary text on nord0.
 *  nord15 and nord11 sit under the gate and are lifted, not swapped for another hue. */
const nord: Theme = {
  id: 'nord',
  title: 'Nord',
  hex: {
    'bg': '#2E3440', 'surface': '#3B4252', 'sidebar-bg': '#292E39', 'text': '#ECEFF4',
    'muted': '#98A3B7', 'border': '#3B4252', 'border-strong': '#4C566A', 'accent': '#88C0D0',
    'link': '#81A1C1', 'selection': '#434C5E', 'code-bg': '#3B4252', 'code-border': '#434C5E',
    'quote-bar': '#4C566A', 'quote-text': '#D8DEE9', 'table-stripe': '#333A47',
    'table-head': '#3F4757', 'rule': '#434C5E',
    'alert-note': '#81A1C1', 'alert-tip': '#A3BE8C', 'alert-important': '#B793B0',
    'alert-warning': '#EBCB8B', 'alert-caution': '#D08B91',
    'hl-keyword': '#81A1C1', 'hl-string': '#A3BE8C', 'hl-number': '#B48EAD', 'hl-title': '#88C0D0',
    'hl-comment': '#616E88', 'hl-variable': '#D8DEE9', 'hl-type': '#8FBCBB', 'hl-meta': '#616E88',
  },
}

/** The loud one. Muted is lifted off the canonical #6272A4 comment colour, which is under
 *  3:1 against the background and unreadable as UI text. */
const dracula: Theme = {
  id: 'dracula',
  title: 'Dracula',
  hex: {
    'bg': '#282A36', 'surface': '#343746', 'sidebar-bg': '#21222C', 'text': '#F8F8F2',
    'muted': '#9BA3C4', 'border': '#363948', 'border-strong': '#474A5C', 'accent': '#FF79C6',
    'link': '#8BE9FD', 'selection': '#44475A', 'code-bg': '#343746', 'code-border': '#44475A',
    'quote-bar': '#6272A4', 'quote-text': '#C7CAE0', 'table-stripe': '#2D2F3D',
    'table-head': '#383B4B', 'rule': '#44475A',
    'alert-note': '#8BE9FD', 'alert-tip': '#50FA7B', 'alert-important': '#BD93F9',
    'alert-warning': '#FFB86C', 'alert-caution': '#FF5858',
    'hl-keyword': '#FF79C6', 'hl-string': '#F1FA8C', 'hl-number': '#BD93F9', 'hl-title': '#50FA7B',
    'hl-comment': '#6272A4', 'hl-variable': '#8BE9FD', 'hl-type': '#FFB86C', 'hl-meta': '#6272A4',
  },
}

/** Gruvbox Dark (morhetz). The closest of the ports to the house pair: warm retro stock,
 *  warm ink, orange accent. */
const gruvbox: Theme = {
  id: 'gruvbox',
  title: 'Gruvbox Dark',
  hex: {
    'bg': '#282828', 'surface': '#32302F', 'sidebar-bg': '#1D2021', 'text': '#EBDBB2',
    'muted': '#A89984', 'border': '#3C3836', 'border-strong': '#504945', 'accent': '#FE8019',
    'link': '#83A598', 'selection': '#45403C', 'code-bg': '#32302F', 'code-border': '#3C3836',
    'quote-bar': '#665C54', 'quote-text': '#D5C4A1', 'table-stripe': '#2E2B2A',
    'table-head': '#3C3836', 'rule': '#3C3836',
    'alert-note': '#83A598', 'alert-tip': '#B8BB26', 'alert-important': '#D3869B',
    'alert-warning': '#FABD2F', 'alert-caution': '#FB5946',
    'hl-keyword': '#FB4934', 'hl-string': '#B8BB26', 'hl-number': '#D3869B', 'hl-title': '#FABD2F',
    'hl-comment': '#928374', 'hl-variable': '#83A598', 'hl-type': '#FE8019', 'hl-meta': '#928374',
  },
}

/** Every theme, in picker and menu order. One list drives the Settings grid, the View >
 *  Theme menu, themeNamed and the tests. */
export const THEMES: readonly Theme[] = [paper, dark, solarizedLight, solarizedDark, github, nord, dracula, gruvbox]

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
  // color-scheme keeps scrollbars, form controls and the caret on the same side of the line
  // as the palette - a light scrollbar on a dark page is the tell it was forgotten.
  return `:root {\n${vars}\n  color-scheme: ${isDark(theme) ? 'dark' : 'light'};\n}`
}

// MARK: - Theme choice

/** The whole theme choice as one value: which theme is active, plus the last one used on
 *  each side of the light/dark line so Cmd-Shift-D stays a polarity switch rather than a
 *  cycle through eight palettes. Pure - settings only store the three ids. */
export interface ThemeChoice {
  active: ThemeID
  light: ThemeID
  dark: ThemeID
}

/** A stored id on the wrong side of the line would make the toggle a no-op, so it is
 *  dropped back to the house default for that side. Unknown ids read as Paper. */
export function themeChoice(active = 'paper', light = 'paper', dark = 'dark'): ThemeChoice {
  const a = themeNamed(active).id
  const l = themeNamed(light)
  const d = themeNamed(dark)
  return { active: a, light: isDark(l) ? 'paper' : l.id, dark: isDark(d) ? d.id : 'dark' }
}

/** Picking a theme also records it as the choice for its own side. */
export function selectingTheme(choice: ThemeChoice, id: ThemeID): ThemeChoice {
  return isDark(themeNamed(id))
    ? themeChoice(id, choice.light, id)
    : themeChoice(id, id, choice.dark)
}

/** Cmd-Shift-D. Flips polarity, landing on whichever theme was last used on that side. */
export function flippedTheme(choice: ThemeChoice): ThemeChoice {
  return selectingTheme(choice, isDark(themeNamed(choice.active)) ? choice.light : choice.dark)
}
