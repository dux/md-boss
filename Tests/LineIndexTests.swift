import Testing
import Foundation
@testable import MdBoss

@Suite("Line index")
struct LineIndexTests {
    @Test("the empty string is one line")
    func empty() {
        let index = LineIndex("")
        #expect(index.count == 1)
        #expect(index.line(at: 0) == 1)
        #expect(index.range(ofLine: 1) == NSRange(location: 0, length: 0))
    }

    @Test("offsets map to their line")
    func linesFromOffsets() {
        let index = LineIndex("one\ntwo\nthree")
        #expect(index.count == 3)
        #expect(index.line(at: 0) == 1)
        #expect(index.line(at: 3) == 1)   // the newline belongs to the line it ends
        #expect(index.line(at: 4) == 2)
        #expect(index.line(at: 7) == 2)
        #expect(index.line(at: 8) == 3)
        #expect(index.line(at: 12) == 3)
    }

    @Test("a trailing newline opens an empty last line")
    func trailingNewline() {
        let index = LineIndex("one\ntwo\n")
        #expect(index.count == 3)
        #expect(index.line(at: 8) == 3)
        #expect(index.range(ofLine: 3) == NSRange(location: 8, length: 0))
    }

    @Test("ranges carry the trailing newline, like NSString.lineRange")
    func ranges() {
        let text = "one\ntwo\nthree"
        let index = LineIndex(text)
        #expect(index.range(ofLine: 1) == NSRange(location: 0, length: 4))
        #expect(index.range(ofLine: 2) == NSRange(location: 4, length: 4))
        #expect(index.range(ofLine: 3) == NSRange(location: 8, length: 5))
        #expect(index.range(ofLine: 0) == nil)
        #expect(index.range(ofLine: 4) == nil)

        // The same spans NSString hands back, which is what scrollRangeToVisible expects.
        let string = text as NSString
        for line in 1...3 {
            guard let range = index.range(ofLine: line) else {
                Issue.record("no range for line \(line)")
                return
            }
            #expect(string.lineRange(for: NSRange(location: range.location, length: 0)) == range)
        }
    }

    @Test("offsets outside the text clamp to the first and last line")
    func clamps() {
        let index = LineIndex("one\ntwo")
        #expect(index.line(at: -5) == 1)
        #expect(index.line(at: 9_000) == 2)
    }

    @Test("counting is by UTF-16 units, so emoji do not shift a line")
    func utf16Offsets() {
        let text = "🎉 party\nnext"
        let index = LineIndex(text)
        #expect(index.length == (text as NSString).length)
        #expect(index.line(at: (text as NSString).range(of: "next").location) == 2)
    }

    @Test("only \\n splits, so a lone carriage return stays on its line")
    func splitsOnNewlineOnly() {
        // Bookmarks, comments and Copy Path with Line all count \n. A stray \r shifting the
        // numbering would silently move every annotation below it.
        let index = LineIndex("one\rstill one\ntwo")
        #expect(index.count == 2)
        #expect(index.line(at: 5) == 1)
    }
}
