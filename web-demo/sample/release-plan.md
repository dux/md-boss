# Release plan

Task lists take three states rather than two: `[x]` done, `[ ]` open, and `[*]`
for the one you are in the middle of. The bullet is dropped, so a list of tasks
reads as a checklist instead of as prose with boxes in front of it.

## This week

[x] split the front matter off before the lexer
[x] anchor every rendered block on its source line
[*] scroll sync between the raw pane and the preview
[ ] rename and delete in the sidebar
[ ] print and export

## Notes

Right-click any line in either pane to leave a note on it. A note with nothing
written on it is just a marked line you can jump back to, and every note is
titled from the line it points at, so the pane reads as a table of contents
without opening anything.

They land in a `.md-boss` file at the root of the sidebar folder, pretty-printed
with sorted keys, so they diff cleanly and can be committed next to the
documents they point at.

An edit above a note takes the note down with it: what a note really anchors to
is its line's start offset, so it slides the way a text marker moves rather than
by diffing anything.

## Moving files

Dragging a file onto a folder repoints every `[text](path)` and `![alt](path)`
under the active folder that pointed at it, and takes its notes along.

> [!IMPORTANT]
> Moving is not undoable - ⌘Z belongs to the editor and undoes text, not the
> filesystem. A name collision stops the move rather than overwriting anything.
