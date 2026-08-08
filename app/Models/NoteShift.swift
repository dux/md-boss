import Foundation

/// How a line-anchored note moves when the text under it is edited.
///
/// A note marks a whole line, so what it really anchors to is that line's start offset -
/// which makes the rule the one a text marker follows: an edit entirely at or before the
/// anchor slides it, an edit after it leaves it alone, and an edit that swallows it drops it
/// back to where the edit began. Insertion *exactly* at the anchor slides it, so pressing
/// Enter at the head of a noted line takes the note down with its text rather than leaving
/// it behind on the new blank line.
///
/// Pure on purpose: this is the part worth testing, and none of it needs a store or a view.
enum NoteShift {
    /// One replacement, in UTF-16 offsets against the text *before* it happened.
    struct Edit: Equatable {
        let range: NSRange
        /// Length of what went in.
        let length: Int

        var delta: Int { length - range.length }
    }

    static func offset(_ anchor: Int, after edit: Edit) -> Int {
        if NSMaxRange(edit.range) <= anchor { return anchor + edit.delta }
        if edit.range.location >= anchor { return anchor }
        return edit.range.location
    }

    /// The line a note lands on, read back out of the new text rather than counted as a
    /// delta. That is what gets a same-length replacement right: swapping two characters for
    /// a newline and a character moves no offset, but everything below it gains a line.
    ///
    /// Nil when the old line was already out of range.
    static func line(_ line: Int, from old: LineIndex, to new: LineIndex, after edit: Edit) -> Int? {
        guard let anchor = old.range(ofLine: line)?.location else { return nil }
        return new.line(at: offset(anchor, after: edit))
    }
}
