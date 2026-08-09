# Code

Highlighting is `highlight.js`, bundled rather than fetched, so a fenced block
renders with no network and inside the same palette as everything around it.

```swift
struct Theme: Sendable, Equatable, Identifiable {
    let id: ThemeID
    let title: String
    let hex: [ThemeToken: String]

    /// Missing tokens resolve to magenta rather than crashing - a palette hole
    /// should be loud on screen and caught by the tests, not fatal at runtime.
    func value(_ token: ThemeToken) -> String { hex[token] ?? "#FF00FF" }
}
```

```ruby
task :build do
  desc 'Lint, test, build, assemble .app bundle and install to /Applications'
  opt :release, type: :boolean
  proc do |opts|
    cfg = opts[:release] ? 'release' : 'debug'
    sh "swift build -c #{cfg}"
  end
end
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
app/ ──> Models/ ──> AppSettings ──> ~/.config/md-boss/settings.json ──> disk ──> forever
```

Numbers in prose are set with oldstyle figures: 1234567890 in 2026.
Press <kbd>⌥⌘R</kbd> for the raw pane, <kbd>⇧⌘D</kbd> to switch theme.
