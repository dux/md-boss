// The app chrome is themed by one <style id="theme">: rootCSS(theme) - every colour in
// every component is a var(--token) - plus the four text sizes as --font-* vars, so a
// change in either is a text swap. The preview page carries its own copy of the theme
// block and is told about changes by mdSetTheme / mdSetFontSize (preview-pane.fez).

import { captionSize, type SettingsData } from '../models/settings'
import type { SettingsStore } from '../models/settingsStore'
import { rootCSS, themeNamed } from './theme'

export function chromeCSS(data: SettingsData): string {
  const fonts = [
    `  --font-default: ${data.fontDefault}px;`,
    `  --font-buttons: ${data.fontButtons}px;`,
    `  --font-small: ${captionSize(data.fontDefault)}px;`,
  ].join('\n')
  return `${rootCSS(themeNamed(data.themeID))}\n:root {\n${fonts}\n}`
}

export function installThemeSync(settings: SettingsStore, style: HTMLElement): () => void {
  let applied: string | null = null
  const apply = (data: SettingsData) => {
    const css = chromeCSS(data)
    if (css === applied) return
    applied = css
    style.textContent = css
  }
  apply(settings.data)
  return settings.onChange(apply)
}
