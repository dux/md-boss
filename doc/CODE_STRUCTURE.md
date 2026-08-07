# Code structure

md-boss is a macOS markdown viewer and editor.
Folder tree on the left, rendered preview or plain-text editor on the right, in a warm paper theme or a matching dark one.

Build system is SwiftPM plus a `Hammerfile`; there is no Xcode project.
`hammer dev` lints, tests, builds, assembles `MdBoss.app`, installs it to `/Applications` and launches it.

## Layout

```
app/
  MdBossApp.swift          @main App, AppDelegate, menu commands, About panel
  ContentView.swift        root HStack layout, WindowAccessor (window frame persistence)
  Models/
    AppSettings.swift      SettingsData + the singleton that persists it
    MdBossManager.swift    central @MainActor singleton: open document, selection, messages
    MdBossManagerCommands.swift  extension holding the menu-bar entry points
    RootFoldersManager.swift     the sidebar's root folders, stored in roots.txt, MRU-ordered
    FileTreeModel.swift    FileNode/FlatRow, lazy listing, expansion, flattening
    DocumentScanner.swift  memoised "does this folder contain documents?"
    DirectoryWatcher.swift per-directory and per-file kqueue watching
    MarkdownDocument.swift one open file: text, dirty state, save, external changes
    Annotations.swift      Bookmark/Comment records and the .md-boss store
    MdBossManagerAnnotations.swift  extension: add, edit and jump to annotations
  Views/
    SettingsView.swift     the Settings window - one section, the four font sizes
    Theme.swift            ThemeToken, ThemeID, Theme, the two palettes, Color(hex:)
    ThemeCSS.swift         Theme -> CSS custom properties, JS string literals
    TextStyles.swift       .textStyle() modifiers, row highlight
    PaneDivider.swift      draggable divider (point width and split fraction flavours)
    Toast.swift            global transient messages + the overlay view
    PromptPanel.swift      NSAlert text prompt, plus BlockMenuItem
    PaneToggleBar.swift    the raw/preview/bookmarks/comments stripe
    BookmarksPane.swift    every bookmark, grouped by file
    CommentsPane.swift     comments in three scopes: file, project, all projects
    StatusBarView.swift    one-line footer, right-click to copy the path
    SidebarView.swift      root select box, tree, keyboard navigation
    SidebarRow.swift       one flattened row
    RootPicker.swift       the root folder select box and its dropdown
    DocumentPane.swift     preview / editor / split, gated on width
    EditorPane.swift       editor plus the external-change banner
    MarkdownTextView.swift NSTextView bridge
    Preview/
      PreviewPane.swift        debounced live rendering
      MarkdownPreviewView.swift WKWebView bridge, link routing, JS bridge
      MarkdownPageBuilder.swift the HTML shell, CSP nonce, bundled resources
      MarkdownLinkTarget.swift  external / file / directory / missing (ported verbatim)
      LocalFileSchemeHandler.swift previewfile:// image serving (ported verbatim)
  Resources/
    marked.min.js          v15.0.12, vendored from file_explorer_swift
    highlight.min.js       v11.9.0, vendored from file_explorer_swift
    preview.js / preview.css  the page's script and stylesheet, as real files
    AppIcon.svg/.icns      regenerate with `hammer icon`
    build-commit.txt       gitignored, written by the Hammerfile before every SwiftPM run
Tests/
doc/
```

## Conventions worth knowing

**Colors.** Every color in the app is a `ThemeToken`. The token's raw value is the CSS
custom property name, so the SwiftUI chrome and the preview web page are literally reading
the same palette. `ThemeTests` fails if a token exists in the enum but not in both palettes,
or vice versa. Views never write a literal color.

**The web view is told the theme.** There is no `prefers-color-scheme` in the preview CSS.
`Theme.rootCSS` is injected into a `<style id="theme">` element, and a theme toggle swaps
that element's text through `evaluateJavaScript` rather than reloading the page - so scroll
position and selection survive. `NSApp.appearance` is pinned to match on every change,
which is what keeps the titlebar, menus and `NSOpenPanel` in step.

**Settings are one Codable struct.** `SettingsData` is the entire persisted surface;
adding a setting means adding a property there and nowhere else. `AppSettings.load()`
merges the stored JSON over the encoded defaults, so config files written by an older or
newer build still load. `AppSettings` is `@dynamicMemberLookup`, so `settings.sidebarWidth`
reads and writes through; SwiftUI bindings go through `$settings.data.sidebarWidth`.

This deliberately diverges from `file_explorer_swift`'s `AppSettings`, which lists every
setting four times (property, load, snapshot, write). One list is the point.

**`FontSetting` is the one list behind every text size.** The four adjustable sizes - sidebar,
buttons, raw text, preview - carry their own title, key path and clamp, and that list drives
the Settings window, the Bigger/Smaller Text commands and the reset alike. Adding a fifth
adjustable size means adding one case. Cmd-+/- stays scoped to `MdBossManager.zoomable`
(raw and preview): it is a document zoom, not an app-wide one.

Caption and section-header sizes are *derived*, not stored - `AppSettings.captionSize(base:)`
is `fontDefault - 2` with a 9pt floor. Two more settings nobody would ever find in a JSON file
is worse than one rule, and a status bar still at 11pt under an 18pt tree reads as a bug.
For the same reason SF Symbols use `.iconStyle(_:scale:)` rather than a literal point size,
so an icon is always measured off the text it sits next to; row heights and hit areas in the
sidebar and the toggle bar are computed from the same two sizes.

**MdBossManager is a singleton, not a `@StateObject`.** SwiftUI's `.commands` closures live
outside the view hierarchy and cannot read view state, so the menu bar and the views have to
reach the same instance. `ContentView` holds it as `@ObservedObject`, since the singleton
outlives the view.

**Messages go through `Toast.shared`, not through view state.** Models, menu commands and
the web-view bridge all need to say something to the user and none of them can reach a view.
The status bar holds only the open file's path.

**The sidebar shows one root folder at a time.** `roots.txt` doubles as the most-recently-used
list: `RootFoldersManager.active` is simply `roots.first`, and picking a folder in the select
box calls `add(atTop:)`, which floats it to the head. That is why there is no `activeRoot`
setting - a second copy of the answer is a second thing to keep in sync. `FileTree.flatten`
takes that one root and emits its *contents* at depth 0; the root itself is never a row,
which is what makes the select box above the tree the only place it is named. The box lists
the twenty most recent; older roots stay in the file and come back the next time they are used.

`contentsOfDirectory` throws the same way for a folder that is gone and one you are not
allowed to read, so `FileTree.list` asks `fileExists` on the failure path and returns
`.missing` or `.denied`. The sidebar says "No folder or files found in <path>" for the first
and "No access to that folder." for the second - an unmounted drive and a TCC prompt are
different problems and a wrong message sends you looking in the wrong place.

**The sidebar hides folders with no documents in them.** `DocumentScanner` answers that with
a recursive walk that early-exits on the first document found and memoises per path,
invalidating a path and its whole line on any change below it. A folder large enough to blow
the 20,000-entry budget is shown rather than hidden - failing open beats hiding real content.

**The viewer is a set of toggles, not a mode.** `Pane` declares the four panes and their
on-screen order. `AppSettings.panes` always returns them in declaration order and never
returns an empty set. Bookmarks and comments take a fixed 300pt column; raw and preview
share what is left, split by the draggable divider that drives `editorSplit`.

**Annotations live in `.md-boss` at the root of each sidebar folder.** Pretty-printed JSON
with sorted keys and unescaped slashes, so it diffs cleanly and can be committed next to the
documents it points at. Paths are stored tilde-abbreviated; line numbers are 1-based.
Identity is (path, line), so there is at most one bookmark and one comment per line and
adding over an existing one edits it - no UUIDs in a file meant to be hand-edited.
Anything opened outside every root falls back to `~/.config/md-boss/annotations.json`.

The comments pane splits them into three scopes - this file, this project, all projects -
via `CommentSections.partition`, which is pure so the rules can be tested without a store or
a view. "All projects" is limited to `RootFoldersManager.recent`, matching the sidebar's
folder picker: roots past the tenth are unreachable there, so they stay invisible here too.
Every scope title is always drawn, empty or not, and the two wider ones fold (state in
`expandedCommentScopes`). Containment everywhere goes through `AnnotationPath.isUnder`, which
compares on path boundaries so `/work/notes-old` is not part of `/work/notes`.
Each `.md-boss` is watched, so an edit from outside (a `git pull`, say) is picked up, and the
watcher is re-armed after our own atomic writes.

**Layout is a hand-rolled `HStack` with dividers, not `NavigationSplitView`.** The latter's
sidebar column is backed by an `NSVisualEffectView` with `.sidebar` vibrancy that cannot be
forced to an exact cream, and its column widths cannot be persisted into `AppSettings`.
The whole point of this app is that sidebar, editor and web page are the same paper color.

## Build gotchas

* `Package.swift` declares `Resources/build-commit.txt` as a resource but it is gitignored,
  so the Hammerfile writes it before any `swift build` or `swift test`.
* The SwiftPM resource bundle is copied into **both** `Contents/Resources/` and the `.app`
  root. `Bundle.module`'s generated accessor `fatalError`s if it finds neither.
* Ad-hoc codesigning gives the app a new identity on every build, which leaves LaunchServices
  holding stale `.md` bindings. `hammer register` runs `lsregister -f` to fix that.

## Two-phase preview rendering

`baseURL` can only be set when a page loads, so opening a file loads the whole page once
(`loadHTMLString` with the file's own URL as base, which is what makes relative links arrive
at the navigation delegate already absolute). Everything after that - typing, a theme switch,
a text-size change - is an `evaluateJavaScript` call into the live page. A reload would flash
white, lose the scroll position, and re-inline 162KB of libraries per keystroke.

Typing is debounced 250ms by `.task(id: document.text)`, which cancels the pending task on
every keystroke.

## Editor pitfalls that are already handled

* `updateNSView` assigns `textView.string` only when `document.reloadToken` changes. Doing it
  unconditionally destroys the selection, the undo stack, and any in-progress input-method
  composition on every keystroke.
* Every automatic substitution is off. Curly quotes inside a fenced block, or `--` becoming
  an em dash in YAML front matter, is the bug that makes a markdown editor unusable - and
  SwiftUI's `TextEditor` offers no way to turn them off, which is why this is an `NSTextView`.
* An atomic write renames a new inode into place, so the `O_EVTONLY` descriptor is left
  watching a deleted file. `MarkdownDocument.save()` calls `watcher.rearm(url)`; without it,
  external-change detection stops working after the first save.
* CRLF is normalised in the buffer and restored on save, so editing one line of a
  Windows-authored file is a one-line diff.

## Status

Phases 1-4 complete, plus split mode and live preview from phase 5:
themed skeleton, sidebar, preview, editor and saving, split layout.

Plus bookmarks and inline comments, and the four-pane toggle stripe.

Still open, from phase 5-6 of the plan:
scroll sync between the editor and the preview, `data-line` anchoring, new/rename/delete in
the sidebar, dropping a folder on the window, print/export, word count, clickable task lists,
and `hammer gh_pub`. Bookmarks and comments are added from the raw pane only, since the
preview has no line numbers until `data-line` anchoring lands.
