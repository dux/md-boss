# md-boss

A macOS markdown viewer and editor that looks like paper.

Folders and files on the left, the rendered document on the right.
A stripe above the viewer toggles four panes - raw, preview, bookmarks, comments - which sit
side by side. ⇧⌘D switches between the warm paper theme and a matching dark one.
The `<` and `>` arrows narrow and widen the reading column.

Rendering is GitHub-flavored markdown - tables, task lists, code highlighting - done entirely
offline by a bundled `marked.js` in an embedded web view.
No network, no telemetry, no account.

The sidebar lists `.md`, `.markdown` and `.txt` files, and hides folders that have no
documents anywhere below them, so pointing it at a source repo shows you the docs rather than
the source tree.

## Install

```sh
git clone https://github.com/dux/md-boss
cd md-boss
hammer dev
```

Requires macOS 14, a Swift 6.2 toolchain, [hammer](https://github.com/dux/hammer) and
`swiftlint`.

## Tasks

| command | what it does |
|---|---|
| `hammer dev` | lint, test, build, install to /Applications, launch - the inner loop |
| `hammer build` | same, without launching |
| `hammer test` | `swift test` |
| `hammer lint` | `swiftlint` |
| `hammer watch` | rebuild and reinstall on every Swift file change |
| `hammer icon` | regenerate `AppIcon.icns` from `AppIcon.svg` |
| `hammer link` | install the `md-boss` CLI shim into `~/bin` |
| `hammer register` | re-register with LaunchServices so `.md` files bind to this build |
| `hammer clean` | remove build artifacts |

## Bookmarks and comments

Right-click in the raw pane to bookmark a line or leave a comment on it.
The suggested bookmark title is the first 40 characters of that line with the markdown
stripped out.

Both are stored in a `.md-boss` JSON file at the root of the sidebar folder the document
lives under, so they can be committed alongside your notes:

```json
{
  "bookmarks" : [
    { "path" : "~/dev/notes/plan.md", "line" : 42, "title" : "Rebuild the index first" }
  ],
  "comments" : [
    { "path" : "~/dev/notes/plan.md", "line" : 88, "body" : "Needs a test." }
  ]
}
```

The file is watched, so editing it by hand or pulling someone else's shows up right away.

## Command line

`hammer build` installs a shim at `~/bin/md-boss`:

```sh
md-boss .              # add the current folder to the sidebar, at the top
md-boss notes/x.md     # open a file, adding its folder if it is not already listed
```

Dropping a folder or a file on the Dock icon does the same thing.

## Keyboard

| | |
|---|---|
| ⌘O | add a folder to the sidebar |
| ⌘1 ⌘2 ⌘3 ⌘4 | toggle the raw, preview, bookmarks and comments panes |
| ⌘\ | raw and preview side by side |
| ⇧⌘B | bookmark the current line |
| ⇧⌘K | comment on the current line |
| ⇧⌘D | switch theme |
| ⌘0 | show or hide the sidebar |
| ⌘+ / ⌘- / ⌥⌘0 | text size (⌥⌘0 also resets the column width) |
| ⌘S | save |
| ⌘F | find |
| ↑ ↓ ← → | move through the sidebar; type a name to jump to it |

## Configuration

Settings live in `~/.config/md-boss/settings.json` and the sidebar's root folders in
`~/.config/md-boss/roots.txt`, one absolute path per line.
Both are plain text and meant to be edited by hand.

## Docs

* [doc/CODE_STRUCTURE.md](doc/CODE_STRUCTURE.md) - architecture
* [doc/THEMES.md](doc/THEMES.md) - the palettes and the rules around them
