# Appearance

Two display styles share the same house palette, and each has a light and dark variant.
Default is the original paper-like reading layout.
Compact fits more on screen with smaller chrome and document text, tighter line spacing,
reduced page padding, and denser code blocks and tables.

⇧⌘D changes only light and dark, so Default stays Default and Compact stays Compact.

| Appearance | ID | Background | Body text | Accent |
|---|---|---|---|---|
| Default Light | `paper` | `#FBF7EF` | `#2B2723` | `#9A5B34` |
| Default Dark | `dark` | `#1E1C1A` | `#E6E0D6` | `#E0996A` |
| Compact Light | `compact-light` | `#FBF7EF` | `#2B2723` | `#9A5B34` |
| Compact Dark | `compact-dark` | `#1E1C1A` | `#E6E0D6` | `#E0996A` |

## One list, one palette

Every colour in the app is a token, and the token's name is the CSS custom
property both the chrome and the preview page read.
The test suite fails if a token exists in one palette and not the other.

Compact changes density only.
It uses the same colours and typefaces as Default, so changing style does not
make the app look like a different product.

> [!TIP]
> A theme's light or dark polarity is derived from the luminance of its own
> background rather than declared.
> A flag that disagrees with the palette it describes is a bug that cannot happen
> if the flag does not exist.

## Contrast

| | Gate | Why |
|---|---|---|
| body text | 7:1 | long-form reading, not a terminal |
| secondary text | 4.5:1 | captions, paths, note titles |
| the five alerts | 4.5:1 | each one draws its own title in its own hue |

See [doc/THEMES.md](../../doc/THEMES.md) in the checkout for the full rules.
