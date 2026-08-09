import Testing
import Foundation
@testable import MdBoss

@Suite("Return continues a list")
struct MarkdownListTests {
    /// Return pressed at the end of the line, which is where it is pressed.
    private func atEnd(_ line: String, insideFence: Bool = false) -> MarkdownList.Continuation {
        MarkdownList.continuation(for: line, caretColumn: line.utf16.count, insideFence: insideFence)
    }

    @Test("every bullet shape carries its own character forward", arguments: ["-", "*", "+"])
    func bullets(marker: String) {
        #expect(atEnd("\(marker) item") == .insert("\n\(marker) "))
    }

    @Test("an ordered list increments rather than renumbering")
    func ordered() {
        #expect(atEnd("1. first") == .insert("\n2. "))
        #expect(atEnd("41) other") == .insert("\n42) "))
    }

    @Test("indentation is carried verbatim")
    func indent() {
        #expect(atEnd("    - nested") == .insert("\n    - "))
    }

    @Test("a quote continues with its bars, list or not")
    func quotes() {
        #expect(atEnd("> quoted") == .insert("\n> "))
        #expect(atEnd("> > deep") == .insert("\n> > "))
        #expect(atEnd("> - item") == .insert("\n> - "))
    }

    /// Carrying `[x]` forward would tick a box nobody has done.
    @Test("a task continues unchecked, whatever state it was in", arguments: ["[ ]", "[x]", "[X]", "[*]"])
    func tasks(box: String) {
        #expect(atEnd("- \(box) done") == .insert("\n- [ ] "))
    }

    @Test("an empty item sheds its marker instead of growing another")
    func emptyItem() {
        #expect(atEnd("- ") == .clear(NSRange(location: 0, length: 2)))
        #expect(atEnd("  1. ") == .clear(NSRange(location: 0, length: 5)))
        #expect(atEnd("- [ ] ") == .clear(NSRange(location: 0, length: 6)))
    }

    /// The one that makes this safe to hang on Return at all.
    @Test("inside a fence a bullet is code, so Return is just a newline")
    func insideFence() {
        #expect(atEnd("- item", insideFence: true) == .none)
    }

    @Test("a line that opens nothing is left alone", arguments: ["plain prose", "# heading", "", "3 - 2 = 1"])
    func notAList(line: String) {
        #expect(atEnd(line) == .none)
    }

    /// There is no item yet to continue, so Return splits the line as usual.
    @Test("Return inside the marker itself does not continue")
    func caretInsideMarker() {
        #expect(MarkdownList.continuation(for: "- item", caretColumn: 1, insideFence: false) == .none)
    }

    @Test("Return mid-item still carries the prefix")
    func caretMidItem() {
        #expect(MarkdownList.continuation(for: "- one two", caretColumn: 6, insideFence: false) == .insert("\n- "))
    }
}

@Suite("Wrapping a selection")
struct MarkdownWrapTests {
    private func apply(_ text: String, _ edit: MarkdownWrap.Edit) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    @Test("a selection is wrapped")
    func wraps() {
        let text = "make this bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 5, length: 4), marker: "**")
        #expect(apply(text, edit) == "make **this** bold")
    }

    @Test("markers selected along with the text come off")
    func unwrapsFromInside() {
        let text = "make **this** bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 5, length: 8), marker: "**")
        #expect(apply(text, edit) == "make this bold")
    }

    @Test("markers just outside the selection come off too")
    func unwrapsFromOutside() {
        let text = "make **this** bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 7, length: 4), marker: "**")
        #expect(apply(text, edit) == "make this bold")
    }

    @Test("an empty selection takes the word under the caret")
    func expandsToWord() {
        let text = "make this bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 7, length: 0), marker: "_")
        #expect(apply(text, edit) == "make _this_ bold")
    }

    @Test("with no word to take, the caret lands between a fresh pair")
    func emptyPair() {
        let text = "a  b"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 2, length: 0), marker: "**")
        #expect(apply(text, edit) == "a **** b")
        #expect(edit.selection == NSRange(location: 4, length: 0))
    }

    /// `**foo **` renders literally, so the space has to end up outside the markers.
    @Test("whitespace migrates outside the markers")
    func trailingSpace() {
        let text = "make this  bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 5, length: 6), marker: "**")
        #expect(apply(text, edit) == "make **this**  bold")
    }

    @Test("the selection afterwards still covers the same text")
    func keepsSelection() {
        let text = "make this bold"
        let edit = MarkdownWrap.toggling(text as NSString, selection: NSRange(location: 5, length: 4), marker: "**")
        let after = apply(text, edit) as NSString
        #expect(after.substring(with: edit.selection) == "this")
    }
}

@Suite("Making a link")
struct MarkdownLinkWrapTests {
    private func apply(_ text: String, _ edit: MarkdownWrap.Edit) -> String {
        (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    @Test("a URL on the clipboard becomes the destination")
    func fromClipboard() {
        let text = "see the plan"
        let edit = MarkdownWrap.link(
            text as NSString,
            selection: NSRange(location: 4, length: 8),
            clipboard: "https://example.com/x"
        )
        #expect(apply(text, edit) == "see [the plan](https://example.com/x)")
        #expect(edit.selection.length == 0)
    }

    /// The other half is what is missing, so the caret goes in the brackets.
    @Test("a selected URL becomes the destination instead")
    func fromSelection() {
        let text = "https://example.com"
        let edit = MarkdownWrap.link(text as NSString, selection: NSRange(location: 0, length: 19), clipboard: nil)
        #expect(apply(text, edit) == "[](https://example.com)")
        #expect(edit.selection == NSRange(location: 1, length: 0))
    }

    @Test("with neither, the caret lands in the empty parens")
    func neither() {
        let text = "the plan"
        let edit = MarkdownWrap.link(text as NSString, selection: NSRange(location: 0, length: 8), clipboard: nil)
        #expect(apply(text, edit) == "[the plan]()")
        #expect(edit.selection == NSRange(location: 11, length: 0))
    }

    @Test("prose on the clipboard is not a destination")
    func clipboardProse() {
        let text = "word"
        let edit = MarkdownWrap.link(text as NSString, selection: NSRange(location: 0, length: 4), clipboard: "not a url")
        #expect(apply(text, edit) == "[word]()")
    }

    @Test("a scheme and something after it is a URL, a bare host is not")
    func urlShapes() {
        #expect(MarkdownWrap.isURL("https://example.com"))
        #expect(MarkdownWrap.isURL("mailto:a@b.c"))
        #expect(MarkdownWrap.isURL("file:///tmp/x.md"))
        #expect(!MarkdownWrap.isURL("example.com"))
        #expect(!MarkdownWrap.isURL("some prose here"))
        #expect(!MarkdownWrap.isURL(""))
    }
}
