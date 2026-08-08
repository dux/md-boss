import SwiftUI

// Notes. Each one anchors to a file and a 1-based line, and they live in the `.md-boss` file
// at the root of whichever sidebar folder the document sits under.
extension MdBossManager {
    private var store: AnnotationStore { .shared }

    // MARK: Adding

    /// Adds or edits the note on the line the caret is on.
    ///
    /// One field, for the body. The title is taken from the source line rather than typed:
    /// it exists so the pane can be read without opening every file, and a line that already
    /// says what it is does not need naming twice. An existing title is kept, so one edited
    /// by hand survives.
    func addNoteAtCursor() {
        guard let url = selectedFile else { return }
        let line = currentLine
        let existing = store.note(for: url, line: line)

        guard let body = PromptPanel.text(
            title: existing == nil ? "Add Note" : "Edit Note",
            message: "\(AnnotationPath.store(url)):\(line)",
            value: existing?.body ?? "",
            multiline: true,
            confirm: existing == nil ? "Add" : "Save"
        ) else { return }

        let title = existing?.title ?? AnnotationPath.suggestedTitle(from: currentLineText)
        store.setNote(url, line: line, title: title, body: body)
        Toast.shared.success("Note saved on line \(line)")
    }

    /// The title is not typed when a note is made, but one that was can still be changed -
    /// including every title carried over from a bookmark.
    func renameNote(_ note: Note) {
        guard let title = PromptPanel.text(
            title: "Rename Note",
            message: "\(note.path):\(note.line)",
            value: note.title,
            placeholder: "Title"
        ) else { return }

        store.setNote(note.url, line: note.line, title: title, body: note.body)
        Toast.shared.success("Note renamed")
    }

    func editNote(_ note: Note) {
        guard let body = PromptPanel.text(
            title: "Edit Note",
            message: "\(note.path):\(note.line)",
            value: note.body,
            multiline: true
        ) else { return }

        store.setNote(note.url, line: note.line, title: note.title, body: body)
        Toast.shared.success("Note saved on line \(note.line)")
    }

    /// Deleting is explicit now. Clearing the body used to remove a comment, but that would
    /// leave no way to make a note with only a title.
    func deleteNoteAtCursor() {
        guard let url = selectedFile, let note = store.note(for: url, line: currentLine) else { return }
        store.remove(note)
        Toast.shared.success("Note removed")
    }

    var hasNoteAtCursor: Bool {
        guard let url = selectedFile else { return false }
        return store.note(for: url, line: currentLine) != nil
    }

    // MARK: Navigating

    /// Opens the note's file and scrolls to its line. For a note on the open file `open`
    /// early-returns and only the scroll happens; for one in another folder, `reveal`
    /// switches the sidebar to that folder on the way.
    func go(to note: Note) {
        open(note.url, reveal: true)
        go(toLine: note.line)
    }

    /// The raw pane is only forced open when neither it nor the preview is up - both can
    /// show the line and mark it, and a line anchor is meaningless in a window showing
    /// nothing but the notes column.
    func go(toLine line: Int) {
        let settings = AppSettings.shared
        if !settings.isVisible(.raw) && !settings.isVisible(.preview) {
            settings.show(.raw)
        }
        requestScroll(to: line)
    }
}
