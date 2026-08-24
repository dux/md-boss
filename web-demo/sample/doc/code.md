# Code

Highlighting is `highlight.js`, bundled rather than fetched, so a fenced block
renders with no network and inside the same palette as everything around it.

```ts
export const THEME_IDS = ['paper', 'dark', 'compact-light', 'compact-dark'] as const

/** Missing tokens resolve to magenta rather than throwing - a palette hole should
 *  be loud on screen and caught by the tests, not fatal at runtime. */
export const tokenValue = (theme: Theme, token: Token) => theme.hex[token] ?? '#FF00FF'
```

```rust
fn main() {
    println!("{}", (1..=10).sum::<u32>());
}
```

```js
// Marked's tokens carry their source text but not their position, so each one is
// found back in the source with a running cursor and the newlines are counted.
function anchor(token, cursor, src) {
  const at = src.indexOf(token.raw, cursor)
  return { line: countNewlines(src, 0, at) + 1, next: at + token.raw.length }
}
```

An unfenced block scrolls inside itself rather than widening the page:

```
app/ ──> Models/ ──> SettingsStore ──> ~/.config/md-boss/settings.json ──> disk ──> forever
```

Press <kbd>⌘3</kbd> for the raw pane, <kbd>⇧⌘D</kbd> to switch light and dark.
A `/` at the start of an empty line opens Insert, so you never have to type a fence
by hand.
