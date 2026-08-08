import Testing
import Foundation
@testable import MdBoss

@Suite("Note shifting")
struct NoteShiftTests {
    /// Lines 1, 2 and 3 start at 0, 4 and 8.
    private let text = "one\ntwo\nthree\n"

    /// Runs an edit the way the text storage reports one, and answers where a note moved to.
    private func shift(_ line: Int, replacing range: NSRange, with replacement: String) -> Int? {
        let old = LineIndex(text)
        let updated = (text as NSString).replacingCharacters(in: range, with: replacement)
        let edit = NoteShift.Edit(range: range, length: (replacement as NSString).length)
        return NoteShift.line(line, from: old, to: LineIndex(updated), after: edit)
    }

    @Test("a line added above pushes the note down")
    func insertAbove() {
        #expect(shift(3, replacing: NSRange(location: 0, length: 0), with: "new\n") == 4)
    }

    @Test("a line removed above pulls the note up")
    func deleteAbove() {
        #expect(shift(3, replacing: NSRange(location: 0, length: 4), with: "") == 2)
    }

    @Test("Enter at the head of a noted line takes the note down with its text")
    func splitAtAnchor() {
        // The blank line left behind is line 3; the note belongs to "three", now on 4.
        #expect(shift(3, replacing: NSRange(location: 8, length: 0), with: "\n") == 4)
    }

    @Test("Enter at the tail of the line above also pushes the note down")
    func splitBeforeAnchor() {
        #expect(shift(3, replacing: NSRange(location: 7, length: 0), with: "\n") == 4)
    }

    @Test("typing within or at the head of the noted line leaves it where it is")
    func typingDoesNotMoveIt() {
        #expect(shift(3, replacing: NSRange(location: 8, length: 0), with: "X") == 3)
        #expect(shift(3, replacing: NSRange(location: 9, length: 0), with: "X") == 3)
    }

    @Test("typing on the line above leaves it where it is")
    func typingAboveDoesNotMoveIt() {
        #expect(shift(3, replacing: NSRange(location: 7, length: 0), with: "X") == 3)
    }

    /// The case a line-count delta cannot answer: nothing moves, but a line is gained.
    @Test("a same-length replacement that introduces a newline still shifts")
    func sameLengthGainingALine() {
        #expect(shift(3, replacing: NSRange(location: 4, length: 2), with: "x\n") == 4)
    }

    @Test("a note whose line is typed over lands on the line that survived")
    func swallowedAnchor() {
        // "two\nthree" replaced by "z" - the note falls back to where the edit began.
        #expect(shift(3, replacing: NSRange(location: 4, length: 9), with: "z") == 2)
    }

    @Test("a line out of range has nowhere to go")
    func outOfRange() {
        #expect(shift(99, replacing: NSRange(location: 0, length: 0), with: "new\n") == nil)
    }

    // MARK: The rule itself

    @Test("an edit at or before the anchor slides it, including insertion exactly on it")
    func offsetSlides() {
        let insert = NoteShift.Edit(range: NSRange(location: 8, length: 0), length: 1)
        #expect(NoteShift.offset(8, after: insert) == 9)

        let delete = NoteShift.Edit(range: NSRange(location: 0, length: 4), length: 0)
        #expect(NoteShift.offset(8, after: delete) == 4)
    }

    @Test("an edit starting after the anchor leaves it alone")
    func offsetHolds() {
        let edit = NoteShift.Edit(range: NSRange(location: 9, length: 3), length: 1)
        #expect(NoteShift.offset(8, after: edit) == 8)
    }

    @Test("an edit that swallows the anchor drops it to where the edit began")
    func offsetClamps() {
        let edit = NoteShift.Edit(range: NSRange(location: 4, length: 9), length: 1)
        #expect(NoteShift.offset(8, after: edit) == 4)
    }
}
