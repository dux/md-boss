# Themes

Two themes, both defined once in `app/Views/Theme.swift` and consumed by the SwiftUI chrome
and the preview web page alike.
`ThemeToken`'s raw value is the CSS custom property name, so `--accent` in the page and
`theme[.accent]` in a view are guaranteed to be the same color.

## Paper

Warm cream stock, warm ink, burnt-sienna accent, ink-blue links.
Text on background is about 13:1.

| token | hex | role |
|---|---|---|
| `bg` | `#FBF7EF` | reading canvas - warm ivory |
| `surface` | `#F3EDE1` | header bars, banners, status bar |
| `sidebar-bg` | `#F3EDE1` | sidebar recedes one step |
| `text` | `#2B2723` | warm near-black ink, never `#000` |
| `muted` | `#7A7166` | secondary and metadata |
| `border` | `#E3D9C6` | hairlines inside a pane |
| `border-strong` | `#CFC4AE` | pane dividers |
| `accent` | `#9A5B34` | burnt sienna - focus, active row, caret |
| `link` | `#1F5C8B` | muted ink blue |
| `selection` | `#EADFC9` | selected row, text selection |
| `code-bg` | `#F2EADA` | inline code and fenced blocks |
| `code-border` | `#E0D5BF` | fenced block border |
| `quote-bar` | `#D8C7A5` | blockquote left rule |
| `quote-text` | `#5C554C` | blockquote body |
| `table-stripe` | `#F5EFE3` | even rows |
| `table-head` | `#EDE5D4` | header row |
| `rule` | `#E3D9C6` | `<hr>` |

Syntax colors are muted and print-like rather than neon:
`hl-keyword #A03E52`, `hl-string #4C6B3C`, `hl-number #8A5A20`, `hl-title #6D4C9F`,
`hl-comment #94897A` (italic), `hl-variable #2F5D8C`, `hl-type #8A5A20`, `hl-meta #94897A`.

## Dark

The same hue family rotated dark, so switching reads as the same app at night rather than a
different app.
Deliberately warm charcoal - not `#000`, not blue-black.
Text on background is about 12:1.

| token | hex | role |
|---|---|---|
| `bg` | `#1E1C1A` | soft warm charcoal |
| `surface` | `#26231F` | header bars, banners, status bar |
| `sidebar-bg` | `#1A1817` | sidebar recedes |
| `text` | `#E6E0D6` | warm off-white, never `#FFF` |
| `muted` | `#9A9287` | secondary |
| `border` | `#38342E` | hairlines |
| `border-strong` | `#4A443C` | pane dividers |
| `accent` | `#E0996A` | amber, the dark sibling of terracotta |
| `link` | `#7FB3D5` | soft ink blue |
| `selection` | `#3A332B` | selected row |
| `code-bg` | `#26231F` | code |
| `code-border` | `#39342C` | fenced border |
| `quote-bar` | `#6B5B45` | blockquote rule |
| `quote-text` | `#B9B1A4` | blockquote body |
| `table-stripe` | `#232019` | even rows |
| `table-head` | `#2B2722` | header row |
| `rule` | `#38342E` | `<hr>` |

Syntax: `hl-keyword #E88B9A`, `hl-string #A3C48A`, `hl-number #E0B87A`, `hl-title #C0A6E8`,
`hl-comment #7E7566` (italic), `hl-variable #8FBBDE`, `hl-type #E0B87A`, `hl-meta #7E7566`.

## Typography

The chrome is system sans and the document is serif.
That contrast is the signal that the middle pane is the thing you are reading, not another
piece of UI.

* Preview body and headings: `ui-serif, "New York", "Iowan Old Style", Charter, Palatino, Georgia, serif`.
  `ui-serif` resolves to New York on macOS; Iowan Old Style is the warm oldstyle fallback.
* Chrome: the SwiftUI system font, sized from `AppSettings` through `.textStyle(...)`.
* Mono: `"SF Mono", ui-monospace, Menlo, monospace`.
* Measure 48em by default, adjustable from the toggle bar in 2em steps and stored in
  `previewMeasure`. It is held in em, not px, so the column tracks the text size.
* Base 17px, line-height 1.7.

## Rules

* Never add `@media (prefers-color-scheme: ...)` to the preview CSS. The page is told which
  theme to use so it can never disagree with the app around it.
* `color-scheme: light|dark` **is** set on `:root`. That is orthogonal to the palette and is
  what makes WebKit's scrollbars and default caret match.
* Adding a token means adding it to `ThemeToken` **and** to both palettes. `ThemeTests`
  fails otherwise.
