import AppKit

/// Paints `MarkdownSyntax` spans onto the raw pane's text storage.
///
/// Owned by `MarkdownTextView.Coordinator` and driven from the storage delegate, because
/// `NSTextStorage` has exactly one delegate and the coordinator already is it.
///
/// Two things this is forbidden to do, both of which would be bugs rather than style: it
/// never changes a character - a mutation from `didProcessEditing` re-enters `processEditing`
/// and traps - and it never goes through `shouldChangeText`, so nothing it paints reaches the
/// undo stack. Attribute-only edits post `.editedAttributes` and register no undo.
@MainActor
final class MarkdownHighlighter {
    /// Past this many lines the pane stays plain text. A file this size is not being read in
    /// a markdown editor, and a stutter on every keystroke is worse than no colour at all.
    /// Fails open the way `DocumentScanner.budget` does.
    static let lineCeiling = 20_000

    var theme: Theme {
        didSet { if theme != oldValue { fontCache.removeAll() } }
    }

    var baseFont: NSFont {
        didSet { if baseFont != oldValue { fontCache.removeAll() } }
    }

    var paragraph: NSParagraphStyle

    /// The open file is not markdown - a CSV. The pane still shows its text and still needs
    /// its base attributes laid down; nothing in it is a heading, and colouring a quoted
    /// field because it happens to hold an asterisk is worse than plain text.
    ///
    /// The same path the line ceiling already takes, rather than a second way to be plain.
    var isPlain = false

    /// The fence open at the start of each line, one entry per line. The single copy of "am I
    /// inside a fence" - what decides how far a re-highlight has to reach, and later what
    /// tells Return-in-a-list from Return-in-code.
    private(set) var fences: [MarkdownScan.Fence?] = []

    private var fontCache: [Int: NSFont] = [:]

    init(theme: Theme, baseFont: NSFont, paragraph: NSParagraphStyle) {
        self.theme = theme
        self.baseFont = baseFont
        self.paragraph = paragraph
    }

    /// Whether line `line` (1-based) sits inside a fenced block.
    func isInsideFence(line: Int) -> Bool {
        guard line >= 1, line <= fences.count else { return false }
        return fences[line - 1] != nil
    }

    // MARK: - Painting

    /// The whole document. Runs on load, on a theme change and on a font change.
    func rebuild(_ storage: NSTextStorage, index: LineIndex) {
        let lines = Self.lines(of: storage.string)
        fences = Self.fenceStates(of: lines)

        guard !isPlain, lines.count <= Self.lineCeiling else {
            storage.setAttributes(base, range: NSRange(location: 0, length: storage.length))
            return
        }
        paint(storage, lines: lines, index: index, from: 1, to: lines.count)
    }

    /// What one edit could have changed.
    ///
    /// The lines the edit touched always, one further back because an edit can join two
    /// lines - and everything below when the fence state moved, which is exactly when it had
    /// to: typing ``` at the top really does change how the rest of the file reads.
    ///
    /// The fence pass is re-run over the whole document because it is only a predicate per
    /// line and costs nothing. What is deliberately *not* redone everywhere is the attribute
    /// write, which invalidates layout and is the part that would stutter.
    func update(_ storage: NSTextStorage, edited: NSRange, index: LineIndex) {
        let lines = Self.lines(of: storage.string)
        let previous = fences
        fences = Self.fenceStates(of: lines)

        guard !isPlain, lines.count <= Self.lineCeiling else {
            storage.setAttributes(base, range: NSRange(location: 0, length: storage.length))
            return
        }

        let first = max(1, index.line(at: edited.location) - 1)
        var last = index.line(at: min(NSMaxRange(edited), index.length))
        if let moved = Self.divergence(previous, fences) {
            last = lines.count
            paint(storage, lines: lines, index: index, from: min(first, moved + 1), to: last)
            return
        }
        paint(storage, lines: lines, index: index, from: first, to: last)
    }

    private func paint(_ storage: NSTextStorage, lines: [Substring], index: LineIndex, from: Int, to: Int) {
        guard from <= to else { return }

        var spans: [MarkdownSyntax.Span] = []
        storage.beginEditing()
        defer { storage.endEditing() }

        for number in max(1, from)...min(to, lines.count) {
            guard let lineRange = index.range(ofLine: number),
                  NSMaxRange(lineRange) <= storage.length else { continue }

            // Clears whatever was there before in one write, so a deleted marker cannot
            // leave its colour behind.
            storage.setAttributes(base, range: lineRange)

            spans.removeAll(keepingCapacity: true)
            _ = MarkdownSyntax.scan(String(lines[number - 1]), inside: fences[number - 1], into: &spans)

            for span in spans {
                let absolute = NSRange(
                    location: lineRange.location + span.range.location,
                    length: span.range.length
                )
                guard NSMaxRange(absolute) <= NSMaxRange(lineRange) else { continue }
                storage.addAttributes(attributes(for: span.kind), range: absolute)
            }
        }
    }

    // MARK: - Lines and fences

    /// Split on `\n` only, matching `LineIndex` exactly - `MarkdownDocument` normalises CRLF
    /// on load, and a lone `\r` must not shift the numbering the notes are anchored to.
    private static func lines(of text: String) -> [Substring] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
    }

    static func fenceStates(of lines: [Substring]) -> [MarkdownScan.Fence?] {
        var states: [MarkdownScan.Fence?] = []
        states.reserveCapacity(lines.count)

        var open: MarkdownScan.Fence?
        for line in lines {
            states.append(open)
            if let current = open {
                if MarkdownScan.closesFence(line, current) { open = nil }
            } else if let opened = MarkdownScan.opensFence(line) {
                open = opened
            }
        }
        return states
    }

    /// The first line whose fence state moved, or nil when nothing below the edit reads
    /// differently. A change in line *count* alone still counts from the shorter end.
    static func divergence(_ old: [MarkdownScan.Fence?], _ new: [MarkdownScan.Fence?]) -> Int? {
        let shared = min(old.count, new.count)
        for line in 0..<shared where old[line] != new[line] { return line }
        return old.count == new.count ? nil : shared
    }

    // MARK: - Attributes

    var base: [NSAttributedString.Key: Any] {
        [.font: baseFont, .foregroundColor: theme.nsColor(.text), .paragraphStyle: paragraph]
    }

    /// Every kind maps onto a token the preview already uses for the same construct, so the
    /// pane and the page are drawing one palette. Exhaustive on purpose: a new `Kind` is a
    /// compile error here until it is given a colour.
    private func attributes(for kind: MarkdownSyntax.Kind) -> [NSAttributedString.Key: Any] {
        switch kind {
        case .headingMarker:
            return [.foregroundColor: theme.nsColor(.muted), .font: font(bold: true)]
        case .headingText:
            return [.foregroundColor: theme.nsColor(.accent), .font: font(bold: true)]
        case .fenceMarker, .fenceInfo, .imageBang, .linkBracket, .linkDestination:
            return [.foregroundColor: theme.nsColor(.muted)]
        case .codeBlock, .codeSpan:
            return [.foregroundColor: theme.nsColor(.hlString)]
        case .emphasis:
            return [.font: font(italic: true)]
        case .strong:
            return [.font: font(bold: true)]
        case .strikethrough:
            return [
                .foregroundColor: theme.nsColor(.muted),
                .strikethroughStyle: NSUnderlineStyle.single.rawValue
            ]
        case .linkText:
            return [.foregroundColor: theme.nsColor(.link)]
        case .quoteMarker:
            return [.foregroundColor: theme.nsColor(.quoteBar)]
        case .quoteText:
            return [.foregroundColor: theme.nsColor(.quoteText), .font: font(italic: true)]
        case .listMarker, .taskMarker:
            return [.foregroundColor: theme.nsColor(.accent)]
        case .rule:
            return [.foregroundColor: theme.nsColor(.rule)]
        }
    }

    /// A monospaced face often has no italic, and `convert` hands back the original when it
    /// cannot oblige - which is the right answer, not a failure.
    private func font(bold: Bool = false, italic: Bool = false) -> NSFont {
        let key = (bold ? 1 : 0) | (italic ? 2 : 0)
        if let cached = fontCache[key] { return cached }

        var font = baseFont
        if bold { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
        if italic { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        fontCache[key] = font
        return font
    }
}
