import SwiftUI

// Bookmarks and inline comments. Both anchor to a file and a 1-based line, and both live in
// the `.md-boss` file at the root of whichever sidebar folder the document sits under.
extension MdBossManager {
    private var store: AnnotationStore { .shared }

    // MARK: Adding

    /// Adds or retitles the bookmark on the line the caret is on. The suggested title is the
    /// first 40 characters of that line with the markdown stripped out.
    func addBookmarkAtCursor() {
        guard let url = selectedFile else { return }
        let line = currentLine
        let existing = store.bookmark(for: url, line: line)
        let suggestion = existing?.title ?? AnnotationPath.suggestedTitle(from: currentLineText)

        guard let title = PromptPanel.text(
            title: existing == nil ? "Add Bookmark" : "Edit Bookmark",
            message: "\(AnnotationPath.store(url)):\(line)",
            value: suggestion,
            placeholder: "Title",
            confirm: existing == nil ? "Add" : "Save"
        ) else { return }

        store.addBookmark(url, line: line, title: title)
        Toast.shared.success(existing == nil ? "Bookmarked line \(line)" : "Bookmark updated")
    }

    func addCommentAtCursor() {
        guard let url = selectedFile else { return }
        let line = currentLine
        let existing = store.comment(for: url, line: line)

        guard let body = PromptPanel.text(
            title: existing == nil ? "Add Comment" : "Edit Comment",
            message: "\(AnnotationPath.store(url)):\(line)",
            value: existing?.body ?? "",
            multiline: true,
            confirm: existing == nil ? "Add" : "Save"
        ) else { return }

        store.setComment(url, line: line, body: body)
        Toast.shared.success(body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                             ? "Comment removed"
                             : "Comment saved on line \(line)")
    }

    func renameBookmark(_ bookmark: Bookmark) {
        guard let title = PromptPanel.text(
            title: "Rename Bookmark",
            message: "\(bookmark.path):\(bookmark.line)",
            value: bookmark.title,
            placeholder: "Title"
        ) else { return }
        store.addBookmark(bookmark.url, line: bookmark.line, title: title)
    }

    func editComment(_ comment: Comment) {
        guard let body = PromptPanel.text(
            title: "Edit Comment",
            message: "\(comment.path):\(comment.line)",
            value: comment.body,
            multiline: true
        ) else { return }
        store.setComment(comment.url, line: comment.line, body: body)
    }

    var hasBookmarkAtCursor: Bool {
        guard let url = selectedFile else { return false }
        return store.bookmark(for: url, line: currentLine) != nil
    }

    // MARK: Navigating

    /// Opens the bookmark's file and scrolls to its line, showing the raw pane if it is
    /// hidden - a line anchor is meaningless in a pane that cannot show lines.
    func go(to bookmark: Bookmark) {
        open(bookmark.url, reveal: true)
        go(toLine: bookmark.line)
    }

    /// Same shape as `go(to bookmark:)`. For a comment on the open file `open` early-returns
    /// and only the scroll happens; for one in another folder, `reveal` switches the sidebar
    /// to that folder on the way.
    func go(to comment: Comment) {
        open(comment.url, reveal: true)
        go(toLine: comment.line)
    }

    func go(toLine line: Int) {
        AppSettings.shared.show(.raw)
        requestScroll(to: line)
    }
}
