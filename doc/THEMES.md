# Themes

Eight themes, every one of them defined once in `app/Views/ThemePalettes.swift` and consumed by
the SwiftUI chrome and the preview web page alike.
`ThemeToken`'s raw value is the CSS custom property name, so `--accent` in the page and
`theme[.accent]` in a view are guaranteed to be the same color.

`ThemePalettes.swift` is the authority; this file describes the shape and the rules, not the
hexes, because a second copy of 200 token rows is a second thing to keep in sync.

## The list

`Theme.all` is the one list, in picker and menu order. It drives the Settings grid, the
View > Theme submenu, `Theme.named` and the tests.

| theme | polarity | stock | accent | lineage |
|---|---|---|---|---|
| Paper | light | `#FBF7EF` warm ivory | `#9A5B34` burnt sienna | the house default |
| Dark | dark | `#1E1C1A` warm charcoal | `#E0996A` amber | the house pair |
| Solarized Light | light | `#FDF6E3` base3 | `#CB4B16` orange | Ethan Schoonover |
| Solarized Dark | dark | `#002B36` base03 | `#CB4B16` orange | Ethan Schoonover |
| GitHub Light | light | `#FFFFFF` | `#0969DA` blue | GitHub Primer |
| Nord | dark | `#2E3440` nord0 | `#88C0D0` frost | Arctic Ice Studio |
| Dracula | dark | `#282A36` | `#FF79C6` pink | Dracula |
| Gruvbox Dark | dark | `#282828` bg0 | `#FE8019` orange | morhetz |

Paper and Dark are the same hue family rotated, so switching between them reads as the same app
at night rather than a different app. The six ports are there for people who already have a
scheme they read in - Gruvbox is the closest of them to the house palette, GitHub Light the
furthest.

The ports are ports, not tributes. Where a scheme's canonical body text is a terminal contrast
rather than a reading one, the emphasized value is used instead: Solarized Light's text is
`base02` and its secondary text `base01`, not `base00`, which only manages 4.5:1 and 4.1:1
against base3. Dracula's `muted` is lifted off `#6272A4` for the same reason - under 3:1 is not
UI text. `ThemeTests` enforces both thresholds, so this cannot quietly regress.

## Polarity

A theme's light/dark polarity is **derived**, never declared: `Theme.isDark` is the WCAG
relative luminance of `bg` below 0.5. A stored flag that disagreed with the palette it describes
would be a bug; the flag does not exist, so it cannot.

Polarity drives two things - `NSApp.appearance` (titlebar, menus, `NSOpenPanel`, WebKit's own
scrollers) and the `color-scheme` line in `rootCSS`.

## Choosing one

`ThemeChoice` holds the whole choice as one value: the active theme plus the last one used on
each side of the light/dark line. It is pure, so the rules are tested without touching
`~/.config/md-boss/settings.json`.

* Settings (Cmd-,) shows every theme as a card painted in its own palette. The selection ring is
  the one exception - it belongs to the window chrome, so it is drawn in the *active* theme's
  accent.
* View > Theme lists all eight with a checkmark on the active one.
* Cmd-Shift-D stays a light/dark switch rather than becoming a cycle through eight: it flips
  polarity and lands on whichever theme was last used on that side. Nord -> Paper -> Nord.

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
* Adding a token means adding it to `ThemeToken` **and** to all eight palettes. `ThemeTests`
  fails otherwise.
* Adding a theme means a case in `ThemeID`, a palette, and an entry in `Theme.all`. `ThemeTests`
  fails if the enum and the list disagree, if the palette is a duplicate of another, or if its
  text misses 7:1 or its `muted` misses 4.5:1 against its own background.
