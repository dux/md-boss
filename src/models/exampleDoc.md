---
title: Markdown Example
subtitle: every feature md-boss renders, with notes on each
tags:
  - reference
  - sample
---

# Markdown Example

This document is the reference sheet. It shows every construct md-boss renders, with the
source next to the result, so you can copy what you need and see what it does.

It is a system page: **edits are not kept**. Pick Example from the folder box again and it
comes back exactly as it is here, whatever you did to it. That makes it a safe place to try
things out.

## Headings

Six levels, `#` through `######`. The first two carry a rule underneath. Every heading gets
an anchor, so `[jump](#headings)` links to one.

```md
# Heading 1
## Heading 2
### Heading 3
```

### Heading 3

#### Heading 4

##### Heading 5 - the last two go quiet rather than smaller

###### Heading 6

## Emphasis

```md
*italic* and _italic_, **bold** and __bold__, ***both***, ~~struck through~~, `inline code`
```

*italic* and _italic_, **bold** and __bold__, ***both***, ~~struck through~~, `inline code`.

## Paragraphs and line breaks

A blank line starts a new paragraph. A single newline does *not* break the line - md-boss
renders with `breaks: false`, the way GitHub does - so prose you have hard-wrapped in the
editor still reads as one paragraph. End a line with two spaces to force a break.

## Lists

Unordered lists take `-`, `*` or `+`; the marker you type is the marker that continues when
you press Return.

- first item
- second item
  - nested one level
  - and another
    - two levels down
- third item

Ordered lists number themselves - write `1.` on every line and the output still counts up.

1. first
2. second
   1. nested counts on its own
   2. second nested
3. third

## Task lists

Three states, not two. Put the marker between the brackets and the preview draws it.

```md
- [ ] not started
- [o] in progress
- [x] done
```

Each line below is written with the marker it names, so you can see the two side by side:

- [ ] `[ ]` - not started. An empty box.
- [o] `[o]` - in progress. A turning spinner, and md-boss's own: GitHub has no such state.
- [x] `[x]` - done. A ticked box.

Return on a task line continues the list with an empty box, whatever the line above was.
An item with nothing written on it sheds its marker instead of growing another.

## Quotes

```md
> A quote, which can hold **anything** a paragraph can.
```

> A quote, which can hold **anything** a paragraph can.
>
> Including a second paragraph.

## Alerts

Five kinds, each in its own colour. The marker is the first line of a quote.

> [!NOTE]
> Something worth knowing that does not change what you do.

> [!TIP]
> A shortcut or a better way round.

> [!IMPORTANT]
> Something you need in order to get the right result.

> [!WARNING]
> Something that will bite if you ignore it.

> [!CAUTION]
> Something with consequences that are hard to undo.

## Tables

Pipes make the columns; the second row sets the alignment - `:--` left, `:-:` centre,
`--:` right.

```md
| Key | Action | Pane |
|:--|:-:|--:|
| ⌘P | go to file | sidebar |
```

| Key | Action | Pane |
|:--|:-:|--:|
| ⌘P | go to file by name | sidebar |
| ⇧⌘F | search every document | sidebar |
| ⇧⌘D | light and dark | window |
| ⌘1 - ⌘4 | open a panel | window |

## Code

Indent by four spaces, or fence with three backticks and name the language. Highlighting is
done offline by a bundled highlight.js.

```js
// JavaScript
const answer = [1, 2, 3].reduce((sum, n) => sum + n, 36)
console.log(`the answer is ${answer}`)
```

```python
# Python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
// Rust
fn main() {
    println!("{}", (1..=10).sum::<u32>());
}
```

```sh
# Shell
rg --files | fzf -f readme
```

```diff
--- a/README.md
+++ b/README.md
-old line
+new line
```

A fence with no language is left unhighlighted:

```
plain text, no colours
```

## Links

```md
[external](https://example.com), [another document](./plan.md), [a heading](#tables)
```

An [external link](https://example.com) opens in your browser. A relative link opens that
document in md-boss, resolved against this file's folder. An anchor such as
[back to Tables](#tables) scrolls the preview to that heading.

Bare URLs are linked where they stand: https://example.com

## Images

```md
![alt text](./diagram.png)
```

Images resolve against the document's folder, the same way links do. Remote images are not
fetched - the preview has no network access at all, by design.

## Horizontal rule

Three or more `-`, `*` or `_` on their own line.

---

## Inline HTML

A small amount of raw HTML passes through. Press <kbd>⌘</kbd> <kbd>S</kbd> to save, and
<mark>this is marked</mark>. Script tags and event handlers are stripped - the preview
runs under a policy that blocks them.

## Front matter

The `---` block at the very top of this file is read as front matter and drawn as the dimmed
key/value list above the title, rather than as a rule followed by a giant heading. It is a
reading affordance, not a YAML parser: `key: value` pairs and simple lists, nothing nested.

```md
---
title: Markdown Example
tags:
  - reference
---
```

A `---` anywhere else in the document is a horizontal rule, as above.

## Escaping

Backslash a character to keep markdown off it: \*not italic\*, \# not a heading.
