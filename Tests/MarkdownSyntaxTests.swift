import Testing
import Foundation
@testable import MdBoss

/// Spans as `(kind, the text they cover)`, which is what makes an expectation readable.
private func spans(_ line: String, inside fence: MarkdownScan.Fence? = nil) -> [(MarkdownSyntax.Kind, String)] {
    var found: [MarkdownSyntax.Span] = []
    _ = MarkdownSyntax.scan(line, inside: fence, into: &found)

    let utf16 = Array(line.utf16)
    return found.map { span in
        let slice = utf16[span.range.location..<(span.range.location + span.range.length)]
        return (span.kind, String(decoding: slice, as: UTF16.self))
    }
}

private func state(_ line: String, inside fence: MarkdownScan.Fence? = nil) -> MarkdownScan.Fence? {
    var found: [MarkdownSyntax.Span] = []
    return MarkdownSyntax.scan(line, inside: fence, into: &found)
}

@Suite("Markdown syntax - headings and rules")
struct MarkdownSyntaxHeadingTests {
    @Test("hashes and their text are separate spans")
    func heading() {
        let found = spans("## The plan")
        #expect(found.map(\.0) == [.headingMarker, .headingText])
        #expect(found.map(\.1) == ["##", " The plan"])
    }

    /// Seven is not a heading, and neither is a hash with no space after it.
    @Test("a run that is not a heading marker is left as prose", arguments: ["####### too many", "#hashtag", "a # mid line"])
    func notAHeading(line: String) {
        #expect(!spans(line).contains { $0.0 == .headingMarker })
    }

    @Test("heading text is still scanned inline")
    func headingHoldsInline() {
        #expect(spans("# The **plan**").map(\.0) == [.headingMarker, .headingText, .strong])
    }

    @Test("three or more of one marker is a rule", arguments: ["---", "***", "___", "- - -", "-----"])
    func rule(line: String) {
        #expect(spans(line).map(\.0) == [.rule])
    }

    /// Two dashes are not a rule, and a bullet is not one either.
    @Test("a short run or a bullet is not a rule", arguments: ["--", "- item"])
    func notARule(line: String) {
        #expect(!spans(line).contains { $0.0 == .rule })
    }
}

@Suite("Markdown syntax - fences")
struct MarkdownSyntaxFenceTests {
    @Test("an opener paints its run and its info string, and opens the fence")
    func opens() {
        let found = spans("```swift")
        #expect(found.map(\.0) == [.fenceMarker, .fenceInfo])
        #expect(found.map(\.1) == ["```", "swift"])
        #expect(state("```swift") == MarkdownScan.Fence(marker: "`", length: 3))
    }

    @Test("a line inside a fence is code, whatever it looks like")
    func swallowsMarkers() {
        let fence = MarkdownScan.Fence(marker: "`", length: 3)
        #expect(spans("# not a heading", inside: fence).map(\.0) == [.codeBlock])
        #expect(spans("- [a](b.md)", inside: fence).map(\.0) == [.codeBlock])
        #expect(state("# not a heading", inside: fence) == fence)
    }

    @Test("the closer ends the fence and is painted as its own marker")
    func closes() {
        let fence = MarkdownScan.Fence(marker: "`", length: 3)
        #expect(spans("```", inside: fence).map(\.0) == [.fenceMarker])
        #expect(state("```", inside: fence) == nil)
    }

    /// The rule the shared scanner carries: a tilde run cannot close a backtick fence.
    @Test("a fence closes only on its own marker")
    func wrongMarker() {
        let fence = MarkdownScan.Fence(marker: "`", length: 3)
        #expect(state("~~~", inside: fence) == fence)
        #expect(state("``", inside: fence) == fence)
    }
}

@Suite("Markdown syntax - inline")
struct MarkdownSyntaxInlineTests {
    @Test("a code span closes on a run of its own length")
    func codeSpan() {
        #expect(spans("a `code` b").filter { $0.0 == .codeSpan }.map(\.1) == ["`code`"])
        #expect(spans("a ``has ` inside`` b").filter { $0.0 == .codeSpan }.map(\.1) == ["``has ` inside``"])
    }

    @Test("an unmatched backtick run is prose")
    func unmatchedBacktick() {
        #expect(!spans("a ` lonely tick").contains { $0.0 == .codeSpan })
    }

    @Test("a link paints its brackets, text and destination apart")
    func link() {
        let found = spans("see [the plan](./a.md) now")
        #expect(found.map(\.0) == [.linkBracket, .linkText, .linkBracket, .linkDestination, .linkBracket])
        #expect(found.map(\.1) == ["[", "the plan", "](", "./a.md", ")"])
    }

    @Test("an image carries its bang")
    func image() {
        #expect(spans("![alt](a.png)").first?.0 == .imageBang)
    }

    @Test("a destination with balanced parentheses is one token")
    func balancedParens() {
        #expect(spans("[x](./a(1).md)").filter { $0.0 == .linkDestination }.map(\.1) == ["./a(1).md"])
    }

    @Test("link text is scanned inline")
    func nestedInLinkText() {
        #expect(spans("[the **plan**](a.md)").contains { $0.0 == .strong })
    }

    @Test("a bracket that opens no link is prose")
    func notALink() {
        #expect(!spans("an [aside] in prose").contains { $0.0 == .linkText })
    }

    @Test("emphasis and strong are told apart by run length")
    func emphasis() {
        #expect(spans("a *one* b").filter { $0.0 == .emphasis }.map(\.1) == ["*one*"])
        #expect(spans("a **two** b").filter { $0.0 == .strong }.map(\.1) == ["**two**"])
        #expect(spans("a ~~gone~~ b").filter { $0.0 == .strikethrough }.map(\.1) == ["~~gone~~"])
    }

    /// The three rules that keep prose from turning italic on its own.
    @Test("a run that cannot delimit is prose", arguments: ["snake_case_name", "2 * 3 * 4", "a * b"])
    func notEmphasis(line: String) {
        #expect(!spans(line).contains { $0.0 == .emphasis || $0.0 == .strong })
    }

    @Test("an escaped marker delimits nothing")
    func escaped() {
        #expect(!spans(#"\*not emphasis\*"#).contains { $0.0 == .emphasis })
    }
}

@Suite("Markdown syntax - lists and quotes")
struct MarkdownSyntaxListTests {
    @Test("every bullet and number shape is a marker", arguments: ["- a", "* a", "+ a", "1. a", "12) a"])
    func markers(line: String) {
        #expect(spans(line).first?.0 == .listMarker)
    }

    @Test("all three task states are marked")
    func tasks() {
        for box in ["[ ]", "[x]", "[X]", "[*]"] {
            let found = spans("- \(box) do it")
            #expect(found.map(\.0).prefix(2) == [.listMarker, .taskMarker], "\(box)")
        }
    }

    @Test("indentation is kept out of the marker")
    func indented() {
        #expect(spans("    - nested").filter { $0.0 == .listMarker }.map(\.1) == ["- "])
    }

    @Test("quote markers repeat and the body is tinted")
    func quotes() {
        let found = spans("> > deep")
        #expect(found.filter { $0.0 == .quoteMarker }.map(\.1) == ["> ", "> "])
        #expect(found.filter { $0.0 == .quoteText }.map(\.1) == ["deep"])
    }

    @Test("a quoted line still scans inline")
    func quotedInline() {
        #expect(spans("> see [a](b.md)").contains { $0.0 == .linkDestination })
    }
}

@Suite("Markdown syntax - spans are well formed")
struct MarkdownSyntaxRangeTests {
    private let lines = [
        "# Heading", "## The **plan** and `code`", "> quoted [link](./a.md)",
        "- [ ] task with *emphasis*", "```swift", "let x = 1", "```", "---",
        "![img](a.png) and ~~gone~~", "", "    indented", "plain prose",
        "1. numbered", "snake_case and 2 * 3", #"\*escaped\*"#, "a ``tick ` in`` b"
    ]

    /// Every span must be a real slice of its own line, or the highlighter would trap the
    /// moment it handed one to NSTextStorage.
    @Test("no span falls outside the line it came from")
    func inBounds() {
        for line in lines {
            var found: [MarkdownSyntax.Span] = []
            _ = MarkdownSyntax.scan(line, inside: nil, into: &found)
            let length = line.utf16.count
            for span in found {
                #expect(span.range.location >= 0, "\(line): \(span)")
                #expect(span.range.length > 0, "\(line): \(span)")
                #expect(span.range.location + span.range.length <= length, "\(line): \(span)")
            }
        }
    }

    /// Emoji and accents are more than one UTF-16 unit; an offset counted in Characters
    /// would land mid-run and paint the wrong text.
    @Test("offsets are UTF-16, not character counts")
    func utf16Offsets() {
        #expect(spans("🎉 **bold**").filter { $0.0 == .strong }.map(\.1) == ["**bold**"])
        #expect(spans("café *ok*").filter { $0.0 == .emphasis }.map(\.1) == ["*ok*"])
    }
}

@Suite("Fence states across a document")
@MainActor
struct FenceStateTests {
    private func states(_ text: String) -> [MarkdownScan.Fence?] {
        MarkdownHighlighter.fenceStates(of: text.split(separator: "\n", omittingEmptySubsequences: false))
    }

    @Test("a line is inside the fence only after the opener and before the closer")
    func spansTheBlock() {
        let open = MarkdownScan.Fence(marker: "`", length: 3)
        #expect(states("a\n```\ncode\n```\nb") == [nil, nil, open, open, nil])
    }

    /// The opener's own line reads as prose; it is the lines under it that are code.
    @Test("an unclosed fence runs to the end of the document")
    func unclosed() {
        #expect(states("a\n```\nb\nc").dropFirst(2).allSatisfy { $0 != nil })
    }

    @Test("a tilde run does not close a backtick fence")
    func wrongMarker() {
        #expect(states("```\n~~~\nstill code").last != nil)
    }

    // MARK: Divergence - how far a re-highlight has to reach

    @Test("nothing below an ordinary edit is re-read")
    func convergesImmediately() {
        #expect(MarkdownHighlighter.divergence(states("a\nb\nc"), states("a\nB\nc")) == nil)
    }

    /// Typing an opener at the top genuinely changes how the rest of the file reads, and the
    /// divergence has to say so from the line it starts on.
    @Test("a new fence diverges from the line after its opener")
    func fenceMovesEverythingBelow() {
        let before = states("a\nb\nc")
        let after = states("a\n```\nb\nc")
        #expect(MarkdownHighlighter.divergence(before, after) == 2)
    }

    @Test("a document that only got longer diverges at the old end")
    func lengthAlone() {
        #expect(MarkdownHighlighter.divergence(states("a\nb"), states("a\nb\nc")) == 2)
    }
}
