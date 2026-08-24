# Appearance

The app has two display styles, Default and Compact.
Each style has a light and dark variant, giving four appearance IDs in `src/theme/theme.ts`.
The Settings panel and Appearance menu present style and colour mode as separate controls.

## Styles

| style | purpose | density |
|---|---|---|
| Default | the original paper-like reading layout | 17px preview text, 1.7 line height, generous page and block spacing |
| Compact | more content on screen without changing visual identity | preview text two pixels smaller, chrome and editor text one pixel smaller, tighter spacing |

Compact changes density only.
It uses the same colors and typefaces as Default, so changing style does not make the app look like a different product.
Its tighter values cover chrome text, preview text and rhythm, editor lines, page padding, code blocks, and table cells.

`STYLES` is the authoritative list and carries every density custom property.
`STYLE_IDS` is its persisted identity type.
`themeForStyle` combines a style with the requested light/dark mode.

## Palettes

| mode | stock | accent | character |
|---|---|---|---|
| Light | `#FBF7EF` warm ivory | `#9A5B34` burnt sienna | paper-like and quiet |
| Dark | `#1E1C1A` warm charcoal | `#E0996A` amber | the same hue family at night |

Every color is defined once in `src/theme/theme.ts` and consumed by the app chrome and preview page alike.
A token's name is the CSS custom property name, so `--accent` means the same thing everywhere.

`TOKENS` is the complete list of color properties.
`DENSITY_TOKENS` is the complete list of sizing and spacing properties.
`rootCSS` writes both sets into the app window and every preview frame.

## Choosing an appearance

The one persisted value is `themeID`.
Its four valid values are `paper`, `dark`, `compact-light`, and `compact-dark`.

Changing style preserves the current light/dark mode.
Changing mode preserves the current style.
⇧⌘D therefore maps Default Light to Default Dark and Compact Light to Compact Dark.

An unknown stored ID falls back to Default Light rather than leaving the interface without a palette.

## Polarity

A theme's light/dark polarity is derived from the WCAG relative luminance of its background.
There is no stored boolean that can disagree with the actual palette.

Polarity drives the `color-scheme` line in `rootCSS`.
That keeps the webview's scrollbars, form controls, and caret on the same side of the line as the app.

## Typography

The chrome is system sans and the document is serif.
That contrast signals that the middle pane is the thing being read rather than another piece of UI.

* Preview body and headings use `ui-serif, "New York", "Iowan Old Style", Charter, Palatino, Georgia, serif`.
* Chrome uses `-apple-system, system-ui, sans-serif` through the text classes in `src/ui/styles.css`.
* Mono text uses `"SF Mono", ui-monospace, Menlo, monospace`.
* The default reading measure is 48em and remains adjustable in 2em steps.
* Font-size settings remain the user's base values; Compact applies its offsets on top without rewriting them.

## Rules

* Never add `@media (prefers-color-scheme: ...)` to preview CSS.
  The preview is told which theme to use so it cannot disagree with the app around it.
* `color-scheme: light|dark` must remain on `:root` for native webview controls.
* Adding a color token means adding it to `TOKENS` and both palettes.
* Adding a density token means adding it to `DENSITY_TOKENS` and both styles.
* `tests/theme.test.ts` enforces completeness, IDs, polarity, and contrast.
