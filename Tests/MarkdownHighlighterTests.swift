import Testing
import Foundation
import AppKit
@testable import MdBoss

/// Drives the highlighter against a real `NSTextStorage`, which is the only part of it that
/// cannot be reached through `MarkdownSyntax` - clearing stale colour, reaching far enough
/// after a fence, and surviving a theme change.
@MainActor
private struct Editor {
    let storage = NSTextStorage()
    let highlighter: MarkdownHighlighter

    init(_ text: String, theme: Theme = .paper) {
        highlighter = MarkdownHighlighter(
            theme: theme,
            baseFont: .monospacedSystemFont(ofSize: 13, weight: .regular),
            paragraph: NSParagraphStyle.default
        )
        storage.replaceCharacters(in: NSRange(location: 0, length: 0), with: text)
        highlighter.rebuild(storage, index: LineIndex(text))
    }

    /// The colour at a character offset, as a hex-ish identity we can compare.
    func colour(at offset: Int) -> NSColor? {
        guard offset < storage.length else { return nil }
        return storage.attribute(.foregroundColor, at: offset, effectiveRange: nil) as? NSColor
    }

    /// Offset of the first occurrence of `needle`, in UTF-16.
    func offset(of needle: String) -> Int {
        (storage.string as NSString).range(of: needle).location
    }

    func colour(of needle: String) -> NSColor? {
        colour(at: offset(of: needle))
    }

    /// Replaces `needle` with `replacement` the way typing would, and re-highlights.
    mutating func replace(_ needle: String, with replacement: String) {
        let range = (storage.string as NSString).range(of: needle)
        storage.replaceCharacters(in: range, with: replacement)
        let edited = NSRange(location: range.location, length: (replacement as NSString).length)
        highlighter.update(storage, edited: edited, index: LineIndex(storage.string))
    }
}

@Suite("Highlighter painting")
@MainActor
struct HighlighterPaintTests {
    @Test("a heading is not painted in body ink")
    func heading() {
        let editor = Editor("# Title\n\nbody text\n")
        #expect(editor.colour(of: "#") != editor.colour(of: "body"))
        #expect(editor.colour(of: "body") == Theme.paper.nsColor(.text))
    }

    @Test("a line inside a fence is code even when it looks like a heading")
    func fenceSwallowsMarkup() {
        let editor = Editor("```\n# not a heading\n```\n")
        #expect(editor.colour(of: "# not") == Theme.paper.nsColor(.hlString))
    }

    @Test("a link's text and its destination are painted apart")
    func link() {
        let editor = Editor("see [the plan](./a.md)\n")
        #expect(editor.colour(of: "the plan") == Theme.paper.nsColor(.link))
        #expect(editor.colour(of: "./a.md") == Theme.paper.nsColor(.muted))
    }

    /// Every palette has to produce a painted document, not just the one the app opens on.
    @Test("every theme paints", arguments: Theme.all)
    func everyTheme(theme: Theme) {
        let editor = Editor("# Title\n\nbody\n", theme: theme)
        #expect(editor.colour(of: "body") == theme.nsColor(.text))
        #expect(editor.colour(of: "#") == theme.nsColor(.muted))
    }
}

@Suite("Highlighter after an edit")
@MainActor
struct HighlighterUpdateTests {
    /// The regression a one-shot `addAttributes` would leave behind: delete the marker and
    /// its colour stays on the text.
    @Test("deleting a marker clears the colour it left")
    func clearsStaleColour() {
        var editor = Editor("# Title\n\nbody\n")
        #expect(editor.colour(of: "Title") != Theme.paper.nsColor(.text))

        editor.replace("# ", with: "")
        #expect(editor.colour(of: "Title") == Theme.paper.nsColor(.text))
    }

    /// Typing an opener really does change how the rest of the file reads, so the repaint has
    /// to reach past the edited line.
    @Test("opening a fence recolours the lines below it")
    func fenceReachesDown() {
        var editor = Editor("intro\n\n# still a heading\n")
        #expect(editor.colour(of: "# still") == Theme.paper.nsColor(.muted))

        editor.replace("intro", with: "```")
        #expect(editor.colour(of: "# still") == Theme.paper.nsColor(.hlString))
    }

    @Test("closing a fence hands the lines below it back")
    func fenceStopsReaching() {
        var editor = Editor("```\ncode\nXXX\n# heading\n")
        #expect(editor.colour(of: "# heading") == Theme.paper.nsColor(.hlString))

        editor.replace("XXX", with: "```")
        #expect(editor.colour(of: "# heading") == Theme.paper.nsColor(.muted))
    }

    /// Highlighting is attributes only. A character changed here would re-enter
    /// `processEditing` and trap, and would land in the undo stack besides.
    @Test("painting never changes a character")
    func textIsUntouched() {
        var editor = Editor("# Title\n\nbody\n")
        let before = editor.storage.string
        editor.replace("body", with: "body text")
        #expect(editor.storage.string == before.replacingOccurrences(of: "body", with: "body text"))
    }
}

@Suite("Highlighter limits")
@MainActor
struct HighlighterCeilingTests {
    /// Fails open like `DocumentScanner.budget`: a file this size reads as plain text rather
    /// than stalling the pane on every keystroke.
    @Test("a document past the line ceiling stays plain")
    func ceiling() {
        let huge = String(repeating: "# heading\n", count: MarkdownHighlighter.lineCeiling + 2)
        let editor = Editor(huge)
        #expect(editor.colour(at: 0) == Theme.paper.nsColor(.text))
    }

    @Test("an empty document is not a crash")
    func empty() {
        let editor = Editor("")
        #expect(editor.storage.length == 0)
    }
}
