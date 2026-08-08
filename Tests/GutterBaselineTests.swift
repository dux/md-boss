import Testing
import AppKit
@testable import MdBoss

@Suite("Gutter baselines")
@MainActor
struct GutterBaselineTests {
    /// The raw pane's own layout: mono font, `lineHeightMultiple` 1.35, soft wrap off the
    /// container width. The storage is held here because a layout manager does not retain
    /// the text storage - let it go and every glyph query answers on a dead object.
    @MainActor
    private struct Layout {
        let storage: NSTextStorage
        let layoutManager: NSLayoutManager
        let font: NSFont

        init(_ text: String, size: CGFloat) {
            font = NSFont.monospacedSystemFont(ofSize: size, weight: .regular)

            let paragraph = NSMutableParagraphStyle()
            paragraph.lineHeightMultiple = 1.35

            storage = NSTextStorage(string: text)
            storage.addAttributes(
                [.font: font, .paragraphStyle: paragraph],
                range: NSRange(location: 0, length: (text as NSString).length)
            )

            layoutManager = NSLayoutManager()
            let container = NSTextContainer(size: NSSize(width: 400, height: CGFloat.greatestFiniteMagnitude))
            layoutManager.addTextContainer(container)
            storage.addLayoutManager(layoutManager)
            layoutManager.ensureLayout(for: container)
        }

        /// One baseline per line fragment, the way the ruler reads them.
        var baselines: [CGFloat] {
            var baselines: [CGFloat] = []
            var glyph = 0

            while glyph < layoutManager.numberOfGlyphs {
                var effective = NSRange()
                let fragment = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: &effective)
                baselines.append(LineNumberRuler.baseline(in: fragment, font: font, layoutManager: layoutManager))
                glyph = NSMaxRange(effective)
            }
            return baselines
        }
    }

    @Test("blank lines sit on the same grid as lines with text", arguments: [9.0, 14.0, 24.0] as [CGFloat])
    func evenSpacing(size: CGFloat) {
        let baselines = Layout("Alpha\n\nNumbers\n\n---\n\nBravo\n", size: size).baselines
        #expect(baselines.count == 7)

        let steps = zip(baselines, baselines.dropFirst()).map { $1 - $0 }
        #expect(steps.count == 6)
        for step in steps {
            #expect(abs(step - steps[0]) < 0.01)
        }
    }

    /// Why the helper exists rather than the layout manager's own answer: an empty line's
    /// only glyph is the newline, and it is reported on the bottom of the fragment.
    @Test("an empty line's glyph is not on its baseline")
    func emptyLineGlyphLies() {
        let layout = Layout("Alpha\n\nBravo\n", size: 14)
        let layoutManager = layout.layoutManager

        // Glyph 6 is the newline that is the whole of line 2.
        var effective = NSRange()
        let fragment = layoutManager.lineFragmentRect(forGlyphAt: 6, effectiveRange: &effective)
        let fromGlyph = fragment.minY + layoutManager.location(forGlyphAt: effective.location).y
        let fromFragment = LineNumberRuler.baseline(in: fragment, font: layout.font, layoutManager: layoutManager)

        let descent = layoutManager.defaultLineHeight(for: layout.font)
            - layoutManager.defaultBaselineOffset(for: layout.font)
        #expect(descent > 0)
        #expect(abs((fromGlyph - fromFragment) - descent) < 0.01)
    }
}
