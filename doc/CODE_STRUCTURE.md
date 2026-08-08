# Code structure

md-boss is a macOS markdown viewer and editor.
Folder tree on the left, rendered preview or plain-text editor on the right, in a warm paper theme, a matching dark one, or one of six ported schemes.

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
    MdBossManagerFiles.swift     extension: cut, move, and following the moved file
    MarkdownLinks.swift    relative paths, inline link scanning, link rewriting
    FileMove.swift         move validation and the rewrite plan
    RootFoldersManager.swift     the sidebar's root folders, stored in roots.txt, MRU-ordered
    ScrollSync.swift       raw <-> preview scroll sync, last-driver-wins
    FileTreeModel.swift    FileNode/FlatRow, lazy listing, expansion, flattening
    DocumentScanner.swift  memoised "does this folder contain documents?"
    DirectoryWatcher.swift per-directory and per-file kqueue watching
    MarkdownDocument.swift one open file: text, dirty state, save, external changes
    Annotations.swift      the Note record and the .md-boss store
    MdBossManagerAnnotations.swift  extension: add, edit and jump to annotations
  Views/
    SettingsView.swift     the Settings window - the theme grid and the four font sizes
    Theme.swift            ThemeToken, ThemeID, Theme, ThemeChoice, Color(hex:)
    ThemePalettes.swift    the eight palettes and Theme.all - the only hex literals in the app
    ThemeCSS.swift         Theme -> CSS custom properties, JS string literals
    TextStyles.swift       .textStyle() modifiers, row highlight
    PaneDivider.swift      draggable divider (point width and split fraction flavours)
    Toast.swift            global transient messages + the overlay view
    PromptPanel.swift      NSAlert text prompt, plus BlockMenuItem
    PaneToggleBar.swift    the raw/preview/notes stripe
    NotesPane.swift        notes in three scopes: file, project, all projects
    StatusBarView.swift    one-line footer, right-click to copy the path
    SidebarView.swift      root select box, tree, keyboard navigation
    SidebarRow.swift       one flattened row
    RootPicker.swift       the root folder select box and its dropdown
    DocumentPane.swift     preview / editor / split, gated on width
    EditorPane.swift       editor plus the external-change banner
    MarkdownTextView.swift NSTextView bridge
    EditorTextView.swift   the NSTextView subclass - the raw pane's file drop target
    LineIndex.swift        line starts, bisected - the one line-number answer
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
the same palette. `ThemeTests` fails if a token exists in the enum but not in every palette,
or vice versa. Views never write a literal color.

**Eight themes, one list.** `Theme.all` in `ThemePalettes.swift` drives the Settings grid, the
View > Theme submenu, `Theme.named` and the tests alike; adding a theme is a `ThemeID` case, a
palette and a line in that list. A theme's light/dark polarity is *derived* from the luminance
of its own `bg` rather than declared, for the same reason caption sizes are derived from the
sidebar size - a flag that disagrees with the palette it describes is a bug that cannot happen
if the flag does not exist. `ThemeTests` gates every palette at 7:1 for text and 4.5:1 for
`muted` against its own background, which is what stops a ported scheme from arriving with a
terminal contrast in a reading pane. See `doc/THEMES.md`.

**Cmd-Shift-D stays a light/dark switch, not a cycle.** `ThemeChoice` carries the active theme
plus the last one used on each side of the line, so the shortcut flips polarity and lands where
you were: Nord -> Paper -> Nord. It is a pure value, so the rule is tested without touching the
settings file.

**The web view is told the theme.** There is no `prefers-color-scheme` in the preview CSS.
`Theme.rootCSS` is injected into a `<style id="theme">` element, and a theme change swaps
that element's text through `evaluateJavaScript` rather than reloading the page - so scroll
position and selection survive. `NSApp.appearance` is pinned to match on every change,
which is what keeps the titlebar, menus and `NSOpenPanel` in step. The preview and the editor
both key that change detection on the whole `Theme`, not its id or one token out of it.

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

**The viewer is a set of toggles, not a mode.** `Pane` declares the three panes and their
on-screen order. `AppSettings.panes` always returns them in declaration order and never
returns an empty set. Notes take a fixed 300pt column; raw and preview
share what is left, split by the draggable divider that drives `editorSplit`.
`Pane.named` maps the retired `bookmarks` and `comments` values onto `notes`, so a config
written before they were one pane still opens with the panes it asked for.

**Annotations live in `.md-boss` at the root of each sidebar folder.** Pretty-printed JSON
with sorted keys and unescaped slashes, so it diffs cleanly and can be committed next to the
documents it points at. Paths are stored tilde-abbreviated; line numbers are 1-based.
Identity is (path, line), so there is at most one note per line and adding over an existing
one edits it - no UUIDs in a file meant to be hand-edited.
Anything opened outside every root falls back to `~/.config/md-boss/annotations.json`.

The notes pane splits them into three scopes - this file, this project, all projects -
via `NoteSections.partition`, which is pure so the rules can be tested without a store or
a view. "All projects" is limited to `RootFoldersManager.recent`, matching the sidebar's
folder picker: roots past the twentieth are unreachable there, so they stay invisible here too.
Every scope title is always drawn, empty or not, and the two wider ones fold (state in
`expandedNoteScopes`). Containment everywhere goes through `AnnotationPath.isUnder`, which
compares on path boundaries so `/work/notes-old` is not part of `/work/notes`.
Each `.md-boss` is watched, so an edit from outside (a `git pull`, say) is picked up, and the
watcher is re-armed after our own atomic writes.

A moved file drags its notes with it. `AnnotationStore.repoint` is written out rather than
routed through `mutate`, because the destination can be owned by a different `.md-boss` -
notes have to leave one file and land in another, and `mutate` only knows about one. Landing
on a line that already has a note folds field-wise, the same rule as decoding.

**A bookmark was a note nobody had written anything on.** They used to be two structs with the
same two keys and a third called `title` in one and `body` in the other, and everything
downstream was doubled to match. `Note` carries both fields: the title comes from the source
line so the pane reads as a table of contents, the body is what you typed, and either may be
empty.

The migration is the decoder rather than a conversion step. `Note.init(from:)` is hand-written
so a missing `title` or `body` falls back to `""` - the synthesized one would throw - which
means an object written as a bookmark and one written as a comment both decode straight into a
`Note`. `AnnotationFile` then folds the `notes`, `bookmarks` and `comments` keys into one
array, first non-empty value winning per field, and encodes only `notes`. A line that carried
both a bookmark and a comment becomes one note holding both, which is the one part of this
that cannot be undone once the file is written back.

Clearing the body no longer deletes. It used to, for comments, but with one body-only dialog
that would leave no way to make a note with only a title - so deleting is explicit, and
`setNote` drops a record only when both fields are blank.

**Moving a file rewrites the links to it.** Dropping a row on a folder - or cutting it and
picking "Move Here" - moves the file and then repoints every `[text](path)` and `![alt](path)`
under the active root that pointed at it. Notes follow too. The move is *not* undoable;
Cmd-Z belongs to the editor and undoes text, not the filesystem.

`MarkdownLinks.destinations` is a hand-rolled scanner rather than a regular expression,
because none of what has to be right here is regular: link text nests (`[see ![x](a.png)](b.md)`),
a destination can carry balanced parentheses, a code span closes only on a backtick run of its
own length, and fences are line state. A regex gets each of those wrong, and the failure mode -
silently rewriting a link inside a fenced block - is the worst one a file mover has.
Deliberately out of scope: reference definitions (`[id]: ./x.md`), four-space indented code
(inside a list `    [a](b.md)` is an ordinary paragraph, and skipping real links is the worse
error), and the moved file's own outbound links.

Destinations are percent-encoded, never wrapped in `<...>`. `%20` survives every renderer,
and it keeps a rewrite shape-stable instead of churning an already-encoded link into another
form. `MarkdownLinks.canonical` stops resolving symlinks at the deepest ancestor that exists,
because `resolvingSymlinksInPath` gives up on a path that is not there - a directory
enumerator hands back `/private/var/...` while a link says `/var/...`, and a file that has
just been moved away would otherwise canonicalise differently from the folder it sits in.

The plan is built *after* `moveItem` and off the main actor. Resolution is path arithmetic
and never asks the disk whether the file is there, so the result is the same either side of
the rename - which leaves latency as the tiebreaker, and a full-root read before the rename
would freeze the drag. What must precede the move is validation, and `FileMove.check` is
cheap. A name collision aborts rather than prompts: there is no confirm helper here, and
silently clobbering a file mid-drag is unrecoverable.

`MarkdownDocument.url` stopped being a `let` for this. `relocate(to:)` keeps the buffer, the
undo stack and the dirty flag and only changes where the next save lands; reopening would put
a save prompt in the middle of a drag and throw all three away. A rewrite that lands on the
open document goes into the *buffer* when it is dirty and stays dirty - saving someone's
unsaved work to fix a link is worse than the link.

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

## Scroll sync runs on source lines, not on percentages

Every block in the preview carries a `data-line`, so the two panes agree on positions rather
than on how far down they are. A percentage cannot work here: a 40-line fenced block is tall
in raw and short rendered, an image is one source line against 400px of page, and
`preview.css` gives the page `45vh` of bottom padding.

Marked's tokens carry their source text but not their position, so `preview.js` finds each
token back in the source with a running cursor and counts the newlines it skipped over.
Adding up `token.raw` would be simpler and wrong - link reference definitions are lifted out
of the token stream entirely, and everything below one would sit two lines too high.
List items are anchored individually, since a thirty-item list is a single token.

Scrolling maps a fractional line to a pixel offset by interpolating between the two anchors
either side of it, and back the same way. One line past the last is the "at the end"
sentinel, which is what puts both panes at their own bottom despite that padding.

`ScrollSync` is a Combine subject rather than an `@Published` on `MdBossManager`, because
this fires on every scroll frame and everything observing the manager would re-evaluate its
body sixty times a second. The pane that is driving keeps driving; any other one has to wait
for it to fall quiet for 150ms. Both sides also ignore the events their own programmatic
scroll causes - the JS side for 120ms, since one assignment to `scrollTop` settles over
several frames.

`data-line` is also what lets notes be added from the preview: the page
reports the right-clicked block's line before the menu opens, and a `BlockMenuItem` fires
when the item is picked, long after that message has landed.

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
  Windows-authored file is a one-line diff. The link rewriter does the opposite on purpose:
  it splices destination tokens and leaves everything between them alone, so a CRLF file
  stays CRLF.
* `NSTextViewDelegate` has no drag-*destination* hooks, only the outbound
  `writablePasteboardTypesFor` family, so a dropped file is invisible from the coordinator.
  That is the whole reason `EditorTextView` exists, and the reason the TextKit stack is
  assembled by hand instead of by `NSTextView.scrollableTextView()` - which promises nothing
  about subclasses. The stack is TextKit 1 explicitly, which is what the app was already
  running: the ruler and the scroll sync both reach for `layoutManager`, and the first touch
  of that downgrades a TextKit 2 view anyway. The coordinator holds the text storage and the
  layout manager, because nothing from the scroll view down reliably does - and losing them
  leaves an editor that is empty rather than one that crashes.
* A dropped file is inserted with `insertText(_:replacementRange:)`, the same call Tab uses:
  it registers one undo step, applies the typing attributes rather than inheriting the
  preceding character's, and posts `didChangeText`, so the text reaches `document.text`
  through the delegate like any other edit.

## Status

Phases 1-4 complete, plus split mode and live preview from phase 5:
themed skeleton, sidebar, preview, editor and saving, split layout.

Plus notes and the pane toggle stripe.

Plus `data-line` anchoring, scroll sync between the editor and the preview, and notes added
from either pane.

Plus drag and drop: a file dragged into the raw pane becomes a relative link to itself, and
a file dragged onto a folder - or cut and dropped through "Move Here" - moves and takes every
reference to it with it.

Still open, from phase 5-6 of the plan:
new/rename/delete in the sidebar, moving folders rather than files, rewriting the moved file's
own outbound links, dropping a folder on the window, print/export, word count,
clickable task lists, and `hammer gh_pub`. Opening a note still forces the raw pane open
rather than scrolling the preview to it.
