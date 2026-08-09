# MD-BOSS

A macOS markdown viewer and editor that looks like paper.

Folders and files on the left, the rendered document on the right.
A stripe above the viewer toggles three panes - raw, preview, notes - which sit side by side.
Raw and preview scroll together, anchored on source lines rather than on percentages, so a
tall fenced block or an image does not pull the two out of step.
⇧⌘D switches between light and dark, out of eight themes.
The `<` and `>` arrows narrow and widen the reading column.

Rendering is GitHub-flavored markdown - tables, task lists, code highlighting, and `> [!NOTE]`
alerts in five colours - done entirely offline by a bundled `marked.js` in an embedded web view.
No network, no telemetry, no account.

A leading `---` block is read as front matter and drawn as a dimmed key/value block above the
document, rather than as the horizontal rule and giant heading markdown would make of it.

The raw pane is highlighted too, on the same palette the preview draws: markers dimmed,
headings in the accent, code in one ink, link text apart from its destination.
A fenced block is code all the way through, so a `#` inside one stays a `#`.

Return continues a list, a quote or a task - unchecked, whatever the line above was - and an
empty item sheds its marker rather than growing another. Inside a fenced block Return is just
a newline. ⌥Return always is.

⇧⌘F searches every document in the folder, ⌘P jumps to one by name. Both take the sidebar
over rather than opening a pane, and Esc gives it back.
Search is case-insensitive until you type a capital.

The sidebar lists `.md`, `.markdown` and `.txt` files, and hides folders that have no
documents anywhere below them, so pointing it at a source repo shows you the docs rather than
the source tree.

[Demo page](https://dux.github.io/md-boss/web-demo/)

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/dux/md-boss/main/install.sh?v=43a3415 | bash
```

Downloads the latest build, unpacks it into `/Applications` and opens it.
macOS 14 or newer, and nothing else to install.

| Paper | Raw and preview |
|---|---|
| [![Paper](web-demo/assets/paper.png)](web-demo/assets/paper.png) | [![Raw and preview](web-demo/assets/split.png)](web-demo/assets/split.png) |
| **Notes** | **Dark** |
| [![Notes](web-demo/assets/notes.png)](web-demo/assets/notes.png) | [![Dark](web-demo/assets/dark.png)](web-demo/assets/dark.png) |

Click any of them for the full-size image.

### From source

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
| `hammer build` | same, without launching - `--release` for an optimised build |
| `hammer test` | `swift test` |
| `hammer lint` | `swiftlint` |
| `hammer watch` | rebuild and reinstall on every Swift file change |
| `hammer icon` | regenerate `AppIcon.icns` from `AppIcon.svg` |
| `hammer register` | re-register with LaunchServices so `.md` files bind to this build |
| `hammer gh_pub` | release build, then publish it to GitHub as the one latest release |
| `hammer demo` | serve the repo and open the demo page |
| `hammer shots` | recapture `web-demo/assets` by driving the installed app |
| `hammer clean` | remove build artifacts |

## Notes

Right-click a line in either pane to leave a note on it.
Write something or leave it blank - a note with nothing written on it is just a marked line
you can jump back to.

Every note is titled from the line it points at, so the pane reads as a table of contents
without opening anything: the first 40 characters of that line, markdown stripped out.

They are stored in a `.md-boss` JSON file at the root of the sidebar folder the document
lives under, so they can be committed alongside your notes:

```json
{
  "notes" : [
    { "line" : 42, "path" : "~/dev/notes/plan.md", "title" : "Rebuild the index first" },
    { "body" : "Needs a test.", "line" : 88, "path" : "~/dev/notes/plan.md" }
  ]
}
```

The file is watched, so editing it by hand or pulling someone else's shows up right away.

Files written before bookmarks and comments became one thing are read as they are and
rewritten in this shape the next time you touch them. A line that carried both becomes one
note with a title and a body.

## Themes

Eight of them: Paper and Dark, plus Solarized light and dark, GitHub, Nord, Dracula and
Gruvbox.
Pick one from the grid in Settings or from View > Theme.

⇧⌘D stays a light/dark switch rather than a cycle through all eight: it remembers the last
theme you used on each side of the line, so Nord to Paper and back lands on Nord again.

Every palette is gated by the test suite at 7:1 contrast for body text and 4.5:1 for
secondary text against its own background.
Several of the ported schemes ship a contrast tuned for a terminal, which is not a
long-form reading one, and those values are lifted rather than copied.

See [doc/THEMES.md](doc/THEMES.md).

## Moving files

Drag a file onto a folder in the sidebar, or right-click it, pick Cut, and pick "Move Here"
on the destination.
Every `[text](path)` and `![alt](path)` under the active folder that pointed at that file is
repointed, and its notes move with it.

The scanner that finds those links is hand-written rather than a regular expression, because
link text nests, destinations carry balanced parentheses, a code span closes only on a
backtick run of its own length, and fences are line state.
A link inside a fenced block is left alone.

Renaming does the same thing - a rename is a move that stays in its folder, so it runs the
same pass and every link to the file follows the new name.
A name that would move the file, hide it, or land on one that already exists stops the rename
rather than overwriting anything, and a file with no extension the sidebar lists becomes `.md`.

Moving and renaming are not undoable - ⌘Z belongs to the editor and undoes text, not the
filesystem.
A name collision stops the move rather than overwriting anything.

"Move to Trash" asks first, takes the file's notes with it, and says how many went.
Links pointing at it are left alone: following one says "Not found", and rewriting other
people's documents because one file went is a worse surprise than a dead link.
Getting it back is Finder's job.

Dragging a file into the raw pane inserts a relative markdown link to it instead, an image
link if it is an image.

## Command line

On launch the app writes a shim at `~/bin/md-boss` naming its own bundle, so a copy of
`MdBoss.app` installed by hand gets the command too, and moving the app repairs it:

```sh
md-boss .              # add the current folder to the sidebar, at the top
md-boss notes/x.md     # open a file, adding its folder if it is not already listed
```

Dropping a folder or a file on the Dock icon does the same thing.

A script at that path the app did not write is never overwritten, and `"installCLI": false`
in `settings.json` turns the whole thing off.

## Keyboard

| | |
|---|---|
| ⌘N | new file in the sidebar folder |
| ⌘O | add a folder to the sidebar (several at once) |
| ⇧⌘O | open a single file |
| ⇧⌘R | reveal the selection in Finder |
| ⌘⌫ | move the selected file to the Trash |
| ⌥⌘R ⌥⌘V ⌥⌘N | toggle the raw, preview and notes panes |
| ⌘\ | raw and preview side by side |
| ⇧⌘F | find in every document under the sidebar folder |
| ⌘P | go to a file by name |
| ⌘B / ⌘I | bold or italic the selection, or the word under the caret |
| ⌘K | make a link - a URL on the clipboard becomes the destination |
| ⇧⌘K | add or edit a note on the current line |
| ⇧⌘⌫ | delete the note on the current line |
| ⇧⌘D | switch between light and dark |
| ⌘0 | show or hide the sidebar |
| ⎋ | cancel a pending Cut in the sidebar |
| ⌘+ / ⌘- / ⌥⌘0 | text size (⌥⌘0 also resets the column width) |
| ⌘S | save |
| ⌘F | find in the open document |
| ↑ ↓ ← → | move through the sidebar; type a name to jump to it |

## Configuration

Settings live in `~/.config/md-boss/settings.json` and the sidebar's root folders in
`~/.config/md-boss/roots.txt`, one absolute path per line.
Both are plain text and meant to be edited by hand.

## Docs

* [doc/CODE_STRUCTURE.md](doc/CODE_STRUCTURE.md) - architecture
* [doc/THEMES.md](doc/THEMES.md) - the palettes and the rules around them
* [web-demo/](web-demo/) - the demo page, its sample documents and `hammer demo`
