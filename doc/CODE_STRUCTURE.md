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
    CLIShim.swift          the ~/bin/md-boss shim, rewritten on launch when it is stale
    MdBossManager.swift    central @MainActor singleton: open document, selection, messages
    MdBossManagerCommands.swift  extension holding the menu-bar entry points
    MdBossManagerFiles.swift     extension: new file, cut, move, and following the moved file
    MarkdownLinks.swift    relative paths, inline link scanning, link rewriting
    MarkdownScan.swift     the rules both scanners share: fences, code spans, links
    MarkdownSyntax.swift   one line of source -> the spans the raw pane paints
    FileMove.swift         move and rename validation, and the rewrite plan
    DocumentSearch.swift   full-text search across a root, pure and cancellable
    FuzzyMatch.swift       the Go to File scorer
    SidebarSearch.swift    the sidebar's two search modes and their state
    MdBossManagerSearch.swift    extension: opening what a search found
    RootFoldersManager.swift     the sidebar's root folders, stored in roots.txt, MRU-ordered
    ScrollSync.swift       raw <-> preview scroll sync, last-driver-wins
    FileTreeModel.swift    FileNode/FlatRow, lazy listing, expansion, flattening
    DocumentScanner.swift  memoised "does this folder contain documents?"
    DirectoryWatcher.swift per-directory and per-file kqueue watching
    MarkdownDocument.swift one open file: text, dirty state, save, external changes
    Annotations.swift      the Note record and the .md-boss store
    NoteShift.swift        how a line-anchored note moves when the text under it is edited
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
    PaneToggleBar.swift    the raw/view/notes segments at the top of the sidebar
    NotesPane.swift        notes in three scopes: file, project, all projects
    StatusBarView.swift    footer: the Save button, the path, right-click to copy
    SidebarView.swift      pane toggles, root select box, tree, keyboard navigation
    SearchPane.swift       the search field and the two result lists
    SidebarRow.swift       one flattened row
    RootPicker.swift       the root folder select box and its dropdown
    DocumentPane.swift     preview / editor / split, gated on width
    EditorPane.swift       editor plus the external-change banner
    MarkdownTextView.swift NSTextView bridge
    MarkdownHighlighter.swift  paints MarkdownSyntax spans onto the text storage
    EditorTextView.swift   the NSTextView subclass - the raw pane's file drop target
    LineIndex.swift        line starts, bisected - the one line-number answer
    Preview/
      PreviewPane.swift        debounced live rendering
      MeasureControls.swift    the reading-measure arrows, pinned to the page's top-right corner
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
web-demo/                  the demo page: index.html, fez components, screenshots,
                           and the sample documents the screenshots are taken of
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

**The viewer is a set of toggles, not a mode.** `Pane` declares the three panes, their
on-screen order, and the key that switches each one. `AppSettings.panes` always returns them
in declaration order and never returns an empty set. The toggles are a segmented control at
the top of the *sidebar* rather than a stripe over the viewer, so the document panes start at
the window's top edge and the chrome is all in one column. Their shortcuts are ⌥⌘R/V/N: a
menu shortcut is matched before the responder chain, so plain ⌘V would have taken Paste out
of the editor, and ⌘N belongs to New File. Notes take a fixed 350pt column; raw and preview
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

**Which `.md-boss` holds a note is bookkeeping; identity is (path, line) across all of them.**
`storeURL(for:)` answers from `RootFoldersManager.root(containing:)`, which is
`roots.first { isUnder }` - and `roots` is MRU-ordered, so that answer *moves*. Nested roots
swap places as you use them, and a file annotated before its folder became a root has its note
in the fallback. Reads always scanned every store, so the pane was right; writes went to
`storeURL` alone, so once the answer flipped, `note(for:line:)` missed, the dialog offered
"Add Note" on a line that already had one, and `setNote` wrote a second record into the other
file. `remove` on such a note did nothing and `shift` left it behind.

So every read scans all stores, and `store(forNoteAt:line:)` sends a write to the file the
note is *already* in, falling back to `storeURL` only for a genuinely new one. `shift` walks
every store holding notes for the document rather than the one `storeURL` names.

`NoteStores.deduplicated` heals what the old rule already wrote. It runs in `reload`, folds
the copies field-wise like everything else here, and hands the survivor to the store that owns
the document today - so a repair pulls a note into the project's own `.md-boss` instead of
stranding it in the fallback on alphabetical luck. A note sitting on its own is never moved,
and only stores that actually changed are written back, so a clean set of files comes through
byte-identical and the reload our own write provokes finds nothing left to do.

**A note marks a whole line, which is what lets it survive editing.** What it really anchors
to is that line's *start offset*, so `NoteShift` slides it the way a text marker moves rather
than diffing anything: an edit entirely at or before the anchor slides it, an edit after it
leaves it alone, and an edit that swallows it drops it back to where the edit began.
Insertion exactly at the anchor slides it, so pressing Enter at the head of a noted line takes
the note down with its text instead of leaving it on the new blank line. The new line number
is then read back out of the *new* text rather than counted as a delta - which is the only way
to get a same-length replacement right, since swapping two characters for a newline and a
character moves no offset but still gains everything below it a line.

The hook is `NSTextStorageDelegate`, not `textDidChange`: it is the only one carrying the
edited range, and unlike `shouldChangeTextIn` it sees programmatic mutations too - the outdent
path, undo, a paste. Two notes landing on one line go through `AnnotationFile.fold`, the same
rule as decoding and `repoint`.

`mutate` skips the write when the file came out unchanged, and that is what makes this
affordable: the shift runs on every edit in the raw pane and moves nothing on almost all of
them, so typing a paragraph touches the disk zero times. `hasNotes` is asked before any of it,
so a document nobody has annotated never even builds the second `LineIndex`.

Two things it deliberately does not do. An external change - a `git pull` under an open file -
swaps the whole text and hands us no edit to follow, so notes keep their line numbers, the
same as they would for any other tool reading the file. And the write goes straight through
rather than waiting for the document to be saved, because adding a note mid-edit rewrites the
whole file anyway, shifted numbers included; holding them back would only be half true. The
cost is that discarding unsaved changes leaves the notes where the edits put them.

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
cheap. A name collision aborts rather than prompts - a modal in the middle of a drag is the
wrong place for a question, and silently clobbering a file is unrecoverable either way.

**Renaming is that same pass.** A rename is a move that stays in its folder, so `rename` and
`move` share everything past validation through `relocate`: the open document follows, the
notes follow, the tree resettles, and one `MarkdownLinks.Move` drives the same rewrite.
`FileMove.checkRename` is the only new part, and it is a name validator - a separator would
make it a move, `.` and `..` name the folder the file is already in, and a leading dot would
hide it from a tree that skips hidden files. `FileTree.documentName` applies on the way in for
the reason it applies to `newFile`: renaming a file into thin air is the outcome worth ruling
out. A folder is refused, for the same reason moving one is.

The collision check has to compare *identity*, not paths. On a case-insensitive volume
`plan.md` -> `Plan.md` finds a file already at the target - itself - and standardizing does
not fold case, so path comparison would refuse a legal rename.

**Move to Trash asks, and takes the notes with it.** `PromptPanel.confirm` exists for this
one caller: ⌘Z is the editor's, so the Trash is what makes it recoverable and only Finder can
put it back. Return cancels. Notes on the file go through `AnnotationFile.removing(path:)` -
pure and nil-when-unaffected, the shape `repointing` already has - because notes on one
document can be spread across several `.md-boss` files. Left behind they would sit in the
pane forever, one click from nothing.

Inbound links are deliberately *not* rewritten. `followLink` already says "Not found", and
rewriting other people's documents because one file went is a worse surprise than a dead link.
The open document is told by its own watcher, which already has the wording for a file that
went out from under it - there is no second mechanism.

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

## Shipping it

`hammer gh_pub` builds `-c release`, stamps the install line in the README with the current
commit as a cache buster, pushes, deletes every existing release and uploads a fresh
`latest`. There is only ever one release and it is always the newest build, which is what
`install.sh` downloads - the tarball is the installed `/Applications/MdBoss.app`, so what
ships is exactly what was just run.

`hammer shots` recaptures `web-demo/assets`. Every screenshot is a `settings.json` and a
relaunch rather than a window driven by hand: theme, panes, open file and window frame are
all persisted state, so nothing has to be clicked and a shot is reproducible. It backs the
live config up before the run and restores it in an `ensure`, and the demo `.md-boss` is
written and removed around the run rather than committed, since note paths carry the home
directory of whoever took them. Line numbers for those notes are looked up by their text,
so editing a sample document cannot quietly move a note off the line it talks about.

## Two-phase preview rendering

`baseURL` can only be set when a page loads, so opening a file loads the whole page once
(`loadHTMLString` with the file's own URL as base, which is what makes relative links arrive
at the navigation delegate already absolute). Everything after that - typing, a theme switch,
a text-size change - is an `evaluateJavaScript` call into the live page. A reload would flash
white, lose the scroll position, and re-inline 162KB of libraries per keystroke.

Typing is debounced 250ms by `.task(id: document.text)`, which cancels the pending task on
every keystroke.

## Task lists take three states, and no bullet

`preview.js` rewrites a bare `[x] item` line to the `- [x] item` GFM insists on before it
lexes, skipping fenced code.
The rewrite adds characters but never a newline, so every `data-line` anchor stays where it
was.
`[*]` is a third state - started, not finished.
Marked knows nothing about it, so it reaches the DOM as literal text at the head of the item
and a post-render pass swaps it for the spinner `preview.css` draws.

## Front matter is split off, not stripped

A leading `---` block never reaches the lexer - marked reads its closing `---` as a setext
underline and renders the whole thing as one enormous heading.
`splitFront` takes it off the front and `toHTML` starts its line counter past it, so every
anchor below still names its own source line.
Blanking the lines instead would hand `blankBreaks` a run of them and open every document with
stray `<br>`s.

It is drawn rather than hidden, as a dimmed sans key/value block.
`blockFor` gives a source line the last anchor at or before it, so with nothing above the first
heading a note on line 2 would have no block to hang on.
The block carries `data-line="1"` and is excluded from `tagListItems`, which matches rendered
elements against tokens by position and would otherwise be one out of step.

Parsing is one `key: value` per line, with a list under a key joined on commas. Anything deeper
is shown as text - this is a label on the document, not a YAML implementation.

## Alerts are re-tagged in the DOM

`> [!NOTE]` and its four siblings, done as a post-render pass for the same reason task lists
are: the tokens keep their raw text, so nothing below moves.
`breaks: false`, so the marker and the body arrive as one text node split by a newline - the
marker is a prefix to strip rather than a node to remove.
Two spaces after the marker make it a hard break, and that `<br>` goes with it.

Five hues rather than one accent, because the colour is the whole point of an alert.
Each draws its own title, so all five are body text and `ThemeTests` holds them to 4.5:1 like
`muted`. Every ported scheme needed at least one lifted - Solarized's blue is 3.4:1 on its own
background and its yellow 3.0:1. Lifted along lightness with hue and saturation held, the same
operation `doc/THEMES.md` describes for body text.

## The raw pane is highlighted a line at a time

`MarkdownSyntax.scan` takes one line and the fence open at its start, and answers spans plus
the fence state after it. Line-shaped on purpose: it makes an edit's repaint cheap, and it
keeps the UTF-16 arithmetic local, which `NSTextStorage` needs and `String.Index` is not.
The cost is that a construct split over a line break is not coloured - a link whose `]` is on
the next line. Legal markdown, rare in writing, and the alternative is re-reading the document
from the top on every keystroke.

Spans may overlap and later ones win: a heading emits `headingText` across its line and the
inline pass then paints the `**bold**` inside it.

The rules it reads by live in `MarkdownScan`, shared with `MarkdownLinks`. The *traversals*
are not shared, deliberately - the rewriter skips a fenced block whole and this has to colour
one - but neither may have its own idea of what a fence is.

**The fence pass and the paint pass are separated on purpose.** On every edit the fence state
is recomputed for the whole document, which is one predicate per line and costs nothing.
What is *not* redone everywhere is the attribute write: that invalidates layout, and doing it
document-wide per keystroke is what would stutter. So the paint covers the edited lines, one
further back because an edit can join two - and everything below only when the fence state
actually moved, which is exactly when typing ``` really did change how the rest of the file
reads. Past `lineCeiling` the pane goes back to plain text, failing open like
`DocumentScanner.budget`.

Two things the highlighter may never do. It must not change a character: a mutation from
`didProcessEditing` re-enters `processEditing` and traps. And it must not go through
`shouldChangeText`, so nothing it paints reaches the undo stack - attribute-only edits post
`.editedAttributes` and register no undo.

`didProcessEditing` rebuilds the `LineIndex` unconditionally now. It used to sit behind the
`hasNotes` guard, which would have left an unannotated document with no index to highlight
against; the guard now wraps only the note shift.

`Coordinator.appliedFont` exists because `NSTextView.font` answers nil once the storage holds
mixed faces, which it does from the first paint - the theme guard keyed on it would never hold
again. And `load(_:into:)` repaints explicitly, because it runs under `isSwapping` and the
storage delegate is suppressed there.

Every `Kind` maps onto a token the preview already uses for the same construct, so the pane and
the page draw one palette. The map is an exhaustive `switch`, so a new kind is a compile error
until it is given a colour.

## Typing in the raw pane

Return, Cmd-B, Cmd-I and Cmd-K all live in `doCommandBy` and the responder chain rather than
in the manager, and all of them go through `shouldChangeText` -> mutate -> `didChangeText`,
which is the shape `outdent` already had. That is what keeps each one a single undo step, a
single `didProcessEditing`, and therefore a single note shift and a single repaint.

`MarkdownList.continuation` decides what Return does, purely. It is handed whether the line is
inside a fence, because `- ` inside ``` is code and Return there is only a newline - the answer
comes from `MarkdownHighlighter.fences`, which is why that vector exists. Option-Return arrives
as `insertNewlineIgnoringFieldEditor` and never reaches the switch, so there is always a way to
get a plain newline.

Ordered lists increment rather than renumber: renumbering rewrites lines nobody touched, makes
one undo step span the whole list, and CommonMark renders `1. 1. 1.` correctly anyway. A task
always continues as `[ ]` - carrying `[x]` forward would tick a box nobody has done. An empty
item sheds its marker instead of growing another, at any depth; Shift-Tab is the explicit
outdent, so Return does not need to be two rules.

`MarkdownList.markerEnd` is shared with `MarkdownSyntax`, which needs the same answer to paint
a marker that this needs to continue one. Two ideas of what a bullet is would drift.

**The Format menu reaches the editor through the responder chain.** `MdBossManager` holds no
reference to a text view - that would be a second copy of "who has focus", it goes stale, and
it would have to be taught about a second pane or a second window. `NSApp.sendAction(_:to: nil,
from: nil)` asks AppKit, which already keeps the one authoritative answer. `EditorTextView`
carries the `@objc` actions because it is the object AppKit can reach; it decides nothing, the
same way it decides nothing about a file drop.

They have to be real menu items: a menu shortcut is matched *before* the responder chain, so a
bare Cmd-B with no menu item would never arrive at all.

`MarkdownWrap` returns one replacement over one range, never several. Whitespace migrates
outside the markers, because `**foo **` renders literally. The clipboard is read at the call
site and passed in, so the rule itself stays pure - the same discipline `NoteSections.partition`
follows with its roots.

## Search is a sidebar mode, not a fourth pane

`PaneToggleBar` fits exactly three segments across a 160pt sidebar - "Preview" already had to
become "View" to make three fit - and a `Pane` is *persisted* through `visiblePanes`, which a
query must never be. So Find in Project and Go to File take the tree area over the way
`RootPickerBox` already takes it over, and nothing about `SettingsData` changes.

⌘F stays AppKit's own find bar in the raw pane: one document, incremental. ⇧⌘F is the project.
⌘P is Go to File, which needs `CommandGroup(replacing: .printItem) {}` - SwiftUI supplies a
Print item by default and it would otherwise own that key.

**No shell-out to ripgrep.** `rg` obeys `.gitignore` while the sidebar obeys `skipFolders` and
`documentExtensions`: two different answers to "which files does this app show you" is exactly
the duplicated fact the rest of this document is about. It is also not on a stock macOS, and
this app is a `.app` dropped into /Applications. `DocumentSearch` walks
`FileTree.documents(under:skipFolders:)`, the same one the link rewriter uses.

Measured, because the question is a fair one. On the sidebar's real roots the whole search is
3-17ms, well under the 180ms debounce - `rg` cannot beat that, since spawning the process
costs a meaningful slice of it. Pointed at `~/dev` - 3,825 documents, 128MB - it is 5.8s
against `rg`'s 0.55s, and the breakdown says why: the directory walk is 5.4s of it, reading
every byte is 103ms, and the matching is noise. `rg` wins there by parallelising *traversal*.
Spreading the read across 14 cores takes it from 103ms to 41ms, which is not worth a lock, so
the read pass is deliberately serial. If a tree that size ever has to feel quick, the thing to
parallelise is `FileTree.documents`, not anything in here.

**Case is derived, not stored.** Insensitive until the query carries a capital. One rule out
of the query itself, no toggle and no setting - the same reasoning as a theme's polarity.

**Cancellation has one trap in it.** `Task.detached` does *not* inherit cancellation, so the
handle kept in `SidebarSearch` has to be the detached task itself; cancelling an enclosing one
would leave the walk running while the next keystroke started a second beside it. The debounce
sleeps *inside* that task, so a superseded query never reaches the disk, and `isCancelled` is
polled between files so one that got going dies within a single file's work. A late result is
dropped by comparing its query against the live one - a task can finish between the
cancellation check and the hop back to the main actor.

`DocumentSearch.matches` cuts lines by scanning UTF-16 for `\n`, the way `LineIndex` does, and
deliberately not with `split(separator: "\n")`. `\r\n` is a single `Character` in Swift, so
splitting on the Character `\n` does not divide a CRLF file at all and every hit in one would
report line 1. Files here are read straight off disk, so CRLF is a real input - unlike
everywhere else in the app, where `MarkdownDocument` has already normalised it.

**`FuzzyMatch` is a full alignment, not a greedy walk.** Greedy takes the first place each
character fits, and that gets the ordering wrong in the case the feature exists for: `mtv`
against `app/Models/MarkdownDocumentValue.swift` seizes the `M` of `Models`, scores a lucky
consecutive `tV`, and beats the `MarkdownTextView` anyone typing `mtv` meant. The weights are
fzy's, and the order between them is the design - consecutive has to outrank a word boundary
or `n-o-t-e.md` wins over `notes.md`.

A hit opens through `go(toLine:)`, the same path a note takes, so it forces the raw pane open
when neither document pane is up and lands with the same band. Nothing new on that path.

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

Plus notes that show where they apply: a marked line carries an accent number and a dot in the
raw gutter, hovering it in either pane says what the note says, opening one bands the line in
the raw pane and highlights the block in the preview, and an edit above a note takes the note
with it. The preview draws no marker of its own - it stays a reading surface, and opening the
note from the pane is what points at it.

Plus front matter drawn as a property block instead of lexed as a giant heading, and GFM
alerts in five contrast-gated colours.

Plus rename and Move to Trash in the sidebar, both routed through the pass that already
repointed links after a move.

Plus markdown syntax highlighting in the raw pane, on the same palette the preview draws.
Plus Return continuing a list, and a Format menu for bold, italic and link.
Plus Find in Project and Go to File, as modes of the sidebar.

Still open, from phase 5-6 of the plan:
a new folder in the sidebar, moving folders rather than files, rewriting the moved file's
own outbound links, dropping a folder on the window, print/export, word count, footnotes,
and clickable task lists.
