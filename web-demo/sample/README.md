---
title: The Paper Theme
author: md-boss
date: 2026-08-09
tags:
  - reading
  - markdown
---

# The Paper Theme

md-boss sets markdown the way a book sets type: a serif body at a fixed reading
measure, warm cream stock, and an accent the colour of burnt sienna.
Everything is drawn offline by a bundled `marked.js`, so a document opens the
same on a plane as it does at a desk.

## Emphasis and links

Text can be *italic*, **bold**, ***both***, ~~struck through~~ or `inline code`.
Links reach [the web](https://apple.com), [a sibling file](./themes.md) and
[a heading further down](#the-reading-measure).

> A blockquote sits quieter than the body around it, italic behind a warm rule.

> [!NOTE]
> The five GitHub alerts are drawn in five hues rather than in one accent,
> because the colour is the whole point of an alert.

> [!WARNING]
> Every palette is held to 7:1 contrast for body text by the test suite, so a
> scheme ported from a terminal is lifted rather than copied.

## The reading measure

The `<` and `>` arrows in the corner of the page narrow and widen the column.
It starts at 48em of the body serif, which lands around 82 characters a line.

| Setting | Default | Where it lives |
|---|---|---|
| `previewMeasure` | `48` | `~/.config/md-boss/settings.json` |
| `previewFontSize` | `17` | the same file, or ⌘+ and ⌘- |
| `themeID` | `paper` | Settings, or View > Theme |

## Front matter

The block at the top of this file is YAML front matter, and it never reaches the
lexer - markdown reads its closing `---` as a setext underline and renders the
whole thing as one enormous heading. It is split off instead and drawn as the
dimmed key/value block above the title.
