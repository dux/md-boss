# Themes

Eight palettes, two of them the house pair and six ports of schemes people
already recognise. ⇧⌘D switches between light and dark rather than cycling
through all eight: it remembers the last theme used on each side of the line, so
Nord to Paper and back lands on Nord again.

| Theme | Background | Body text | Accent |
|---|---|---|---|
| Paper | `#FBF7EF` | `#2B2723` | `#9A5B34` |
| Dark | `#1E1C1A` | `#E6E0D6` | `#E0996A` |
| Solarized Light | `#FDF6E3` | `#073642` | `#CB4B16` |
| Solarized Dark | `#002B36` | `#EEE8D5` | `#CB4B16` |
| GitHub Light | `#FFFFFF` | `#1F2328` | `#0969DA` |
| Nord | `#2E3440` | `#ECEFF4` | `#88C0D0` |
| Dracula | `#282A36` | `#F8F8F2` | `#FF79C6` |
| Gruvbox Dark | `#282828` | `#EBDBB2` | `#FE8019` |

## One list, one palette

Every colour in the app is a token, and the token's raw value is the CSS custom
property name - so the SwiftUI chrome and the preview web page read the same
palette. The test suite fails if a token exists in the enum but not in every
palette, or the other way round.

> [!TIP]
> A theme's light or dark polarity is derived from the luminance of its own
> background rather than declared. A flag that disagrees with the palette it
> describes is a bug that cannot happen if the flag does not exist.

## Contrast

| | Gate | Why |
|---|---|---|
| body text | 7:1 | long-form reading, not a terminal |
| secondary text | 4.5:1 | captions, paths, note titles |
| the five alerts | 4.5:1 | each one draws its own title in its own hue |

Solarized's blue sits at 3.4:1 on its own background and its yellow at 3.0:1.
Both are lifted along lightness with hue and saturation held, which keeps the
scheme recognisable while making it readable at length.
