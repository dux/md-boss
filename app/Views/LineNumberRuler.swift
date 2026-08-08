import AppKit

/// Line numbers down the left edge of the raw pane.
///
/// An NSRulerView rather than a second text view: the ruler is already pinned to the
/// scroll position, and asking the layout manager for line fragments is the only way to
/// stay right when a long line soft-wraps - a wrapped continuation gets no number of its
/// own, so the gutter keeps matching the file's line numbering that notes
/// are anchored to.
final class LineNumberRuler: NSRulerView {
    private enum Metric {
        /// Breathing room either side of the number column.
        static let padding: CGFloat = 8
        static let minWidth: CGFloat = 30
        /// Numbers read as chrome, not content, so they sit under the body size.
        static let scale: CGFloat = 0.8
        static let minSize: CGFloat = 9
        /// Muted is tuned for readable secondary *text*; the gutter should recede further
        /// than that so the eye lands on the line, not on its number.
        static let numberAlpha: CGFloat = 0.55
    }

    var theme: Theme {
        didSet {
            guard theme != oldValue else { return }
            needsDisplay = true
        }
    }

    /// The editor's own font. The gutter derives its size and its baselines from it.
    var bodyFont: NSFont {
        didSet {
            guard bodyFont != oldValue else { return }
            refresh()
        }
    }

    /// Rebuilt on every edit, and asked for the first visible number on every draw.
    private var index = LineIndex("")

    private var numberFont: NSFont {
        .monospacedDigitSystemFont(ofSize: max(Metric.minSize, bodyFont.pointSize * Metric.scale), weight: .regular)
    }

    private var attributes: [NSAttributedString.Key: Any] {
        [.font: numberFont, .foregroundColor: theme.nsColor(.muted).withAlphaComponent(Metric.numberAlpha)]
    }

    init(scrollView: NSScrollView, textView: NSTextView, theme: Theme, bodyFont: NSFont) {
        self.theme = theme
        self.bodyFont = bodyFont
        super.init(scrollView: scrollView, orientation: .verticalRuler)

        clientView = textView
        // The dirty rect handed to a ruler is the whole window, and NSView no longer clips
        // to its bounds by default - without this the gutter paints over the entire app.
        clipsToBounds = true
        refresh()

        // Redraw on scroll and on the text view growing; recount on every edit.
        scrollView.contentView.postsBoundsChangedNotifications = true
        textView.postsFrameChangedNotifications = true

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(refresh), name: NSText.didChangeNotification, object: textView)
        center.addObserver(self, selector: #selector(redraw), name: NSView.boundsDidChangeNotification, object: scrollView.contentView)
        center.addObserver(self, selector: #selector(redraw), name: NSView.frameDidChangeNotification, object: textView)
    }

    required init(coder: NSCoder) {
        fatalError("LineNumberRuler is created in code, never from a nib")
    }

    @objc private func redraw() {
        needsDisplay = true
    }

    /// The text baseline inside a line fragment.
    ///
    /// Not `layoutManager.location(forGlyphAt:)`: on an empty line the only glyph is the
    /// newline, and the layout manager reports it sitting on the bottom of the fragment rather
    /// than on the line's baseline, which drops every blank line's number by the font's descent
    /// and leaves the gutter unevenly spaced. Fragment rects are uniform, so measuring up from
    /// the fragment keeps the column on a grid.
    static func baseline(in fragment: NSRect, font: NSFont, layoutManager: NSLayoutManager) -> CGFloat {
        let descent = layoutManager.defaultLineHeight(for: font) - layoutManager.defaultBaselineOffset(for: font)
        return fragment.maxY - descent
    }

    /// Recount the lines and widen the gutter if the file just gained a digit.
    @objc func refresh() {
        index = LineIndex((clientView as? NSTextView)?.string ?? "")

        let digits = max(2, String(index.count).count)
        let widest = String(repeating: "0", count: digits) as NSString
        let width = widest.size(withAttributes: attributes).width
        ruleThickness = max(Metric.minWidth, ceil(width) + Metric.padding * 2)

        needsDisplay = true
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        theme.nsColor(.bg).setFill()
        rect.intersection(bounds).fill()

        guard let textView = clientView as? NSTextView,
              let layoutManager = textView.layoutManager,
              let container = textView.textContainer else { return }

        let text = textView.string as NSString
        let inset = textView.textContainerInset

        // Container coordinates, which is what the layout manager answers in.
        let visible = textView.visibleRect.offsetBy(dx: -inset.width, dy: -inset.height)
        let glyphRange = layoutManager.glyphRange(forBoundingRect: visible, in: container)
        let charRange = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)

        var number = index.line(at: charRange.location)
        var lastLineStart = -1
        var glyphIndex = glyphRange.location

        while glyphIndex < NSMaxRange(glyphRange) {
            var fragmentGlyphs = NSRange()
            let fragment = layoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: &fragmentGlyphs, withoutAdditionalLayout: true)
            let charIndex = layoutManager.characterIndexForGlyph(at: fragmentGlyphs.location)
            let lineStart = text.lineRange(for: NSRange(location: charIndex, length: 0)).location

            if lineStart != lastLineStart {
                if lastLineStart >= 0 { number += 1 }
                lastLineStart = lineStart

                // Only the fragment a line actually starts on gets a number.
                if charIndex == lineStart {
                    let baseline = Self.baseline(in: fragment, font: bodyFont, layoutManager: layoutManager)
                    draw(number, baseline: baseline + inset.height, in: textView)
                }
            }

            glyphIndex = NSMaxRange(fragmentGlyphs)
        }

        // A file ending in a newline has one more, empty, line that owns no glyphs.
        if layoutManager.extraLineFragmentTextContainer != nil {
            let fragment = layoutManager.extraLineFragmentRect
            if lastLineStart >= 0 { number += 1 }
            let baseline = Self.baseline(in: fragment, font: bodyFont, layoutManager: layoutManager)
            draw(number, baseline: baseline + inset.height, in: textView)
        }
    }

    private func draw(_ number: Int, baseline: CGFloat, in textView: NSTextView) {
        let attributes = self.attributes
        let label = String(number) as NSString
        let size = label.size(withAttributes: attributes)

        let font = numberFont
        let y = convert(NSPoint(x: 0, y: baseline), from: textView).y - font.ascender
        let x = ruleThickness - Metric.padding - size.width

        label.draw(at: NSPoint(x: x, y: y), withAttributes: attributes)
    }
}
