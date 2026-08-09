import Foundation

/// What the raw pane colours, as spans over one line of source.
///
/// Line by line, with the fence state handed in and back, because that is what makes an
/// incremental highlight cheap: an edit re-scans the lines it touched, and only a fence
/// forces the work below it. It also makes the UTF-16 arithmetic local - `NSTextStorage`
/// wants offsets, and a line is short enough to convert one index at a time.
///
/// The cost is that a construct split across a line break is not coloured: a link whose `]`
/// is on the next line, a code span opened at the end of one. Both are legal markdown and
/// both are rare in writing; a per-line answer that is right about the common case beats a
/// document-wide one that has to be re-run from the top on every keystroke.
///
/// Deliberately not handled, in the same spirit as `MarkdownLinks`: setext headings (`===`
/// under a line), four-space indented code, reference definitions, and HTML.
enum MarkdownSyntax {
    /// Every distinct thing the pane can paint. Adding a case is a compile error in
    /// `MarkdownHighlighter.attributes(for:)` until it is given a colour.
    enum Kind: String, CaseIterable, Sendable {
        case headingMarker, headingText
        case fenceMarker, fenceInfo, codeBlock, codeSpan
        case emphasis, strong, strikethrough
        case imageBang, linkBracket, linkText, linkDestination
        case quoteMarker, quoteText
        case listMarker, taskMarker
        case rule
    }

    /// A run to paint, in UTF-16 units relative to the start of its own line.
    ///
    /// Spans may overlap, and later ones win: a heading emits `headingText` over its whole
    /// line and the inline pass then paints the `**bold**` inside it.
    struct Span: Equatable, Sendable {
        let range: NSRange
        let kind: Kind
    }

    /// Every span on one line, given the fence open at its start. Returns the fence state
    /// after the line, which is what the caller carries to the next one.
    static func scan(
        _ line: String,
        inside fence: MarkdownScan.Fence?,
        into spans: inout [Span]
    ) -> MarkdownScan.Fence? {
        if let fence {
            // A closer is still the fence's own punctuation, so it reads as the marker.
            let closes = MarkdownScan.closesFence(line[...], fence)
            append(line.startIndex..<line.endIndex, closes ? .fenceMarker : .codeBlock, line, &spans)
            return closes ? nil : fence
        }

        if let opened = MarkdownScan.opensFence(line[...]) {
            let body = line.drop { $0 == " " }
            let runEnd = body.prefix { $0 == opened.marker }.endIndex
            append(line.startIndex..<runEnd, .fenceMarker, line, &spans)
            append(runEnd..<line.endIndex, .fenceInfo, line, &spans)
            return opened
        }

        let prose = blockPrefix(line, &spans)
        inline(line, from: prose, until: line.endIndex, &spans)
        return nil
    }

    // MARK: - Block level

    /// Everything a line carries before its prose - quote bars, a heading's hashes, a list
    /// bullet, a task box - plus the tint over what follows. Answers where the prose starts.
    private static func blockPrefix(_ line: String, _ spans: inout [Span]) -> String.Index {
        var index = line.startIndex
        var quoted = false

        // `>` repeats: `> > a quoted quote`.
        while true {
            let marker = line[index...].drop { $0 == " " }.startIndex
            guard marker < line.endIndex, line[marker] == ">" else { break }
            var end = line.index(after: marker)
            if end < line.endIndex, line[end] == " " { end = line.index(after: end) }
            append(index..<end, .quoteMarker, line, &spans)
            index = end
            quoted = true
        }
        if quoted { append(index..<line.endIndex, .quoteText, line, &spans) }

        let start = line[index...].drop { $0 == " " }.startIndex
        guard start < line.endIndex else { return line.endIndex }
        let body = line[start...]

        if isRule(body) {
            append(start..<line.endIndex, .rule, line, &spans)
            return line.endIndex
        }

        let hashes = body.prefix { $0 == "#" }
        if (1...6).contains(hashes.count),
           hashes.endIndex == line.endIndex || line[hashes.endIndex] == " " {
            append(start..<hashes.endIndex, .headingMarker, line, &spans)
            append(hashes.endIndex..<line.endIndex, .headingText, line, &spans)
            // Still scanned inline: `# The **plan**` is a heading with bold in it.
            return hashes.endIndex
        }

        guard let afterMarker = listMarker(body) else { return start }
        append(start..<afterMarker, .listMarker, line, &spans)

        guard let afterBox = taskMarker(line[afterMarker...]) else { return afterMarker }
        append(afterMarker..<afterBox, .taskMarker, line, &spans)
        return afterBox
    }

    /// Three or more of `-`, `_` or `*`, and nothing else but spaces.
    private static func isRule(_ body: Substring) -> Bool {
        guard let marker = body.first, marker == "-" || marker == "_" || marker == "*" else { return false }

        var count = 0
        for character in body {
            if character == marker {
                count += 1
            } else if character != " " && character != "\t" {
                return false
            }
        }
        return count >= 3
    }

    /// `- `, `* `, `+ `, `1. ` or `1) `, answering where the marker ends.
    private static func listMarker(_ body: Substring) -> String.Index? {
        guard let first = body.first else { return nil }

        if first == "-" || first == "*" || first == "+" {
            let next = body.index(after: body.startIndex)
            guard next < body.endIndex, body[next] == " " else { return nil }
            return body.index(after: next)
        }

        let digits = body.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 9, digits.endIndex < body.endIndex,
              body[digits.endIndex] == "." || body[digits.endIndex] == ")" else { return nil }

        let after = body.index(after: digits.endIndex)
        guard after < body.endIndex, body[after] == " " else { return nil }
        return body.index(after: after)
    }

    /// `[ ]`, `[x]` or the app's own `[*]`, followed by a space.
    private static func taskMarker(_ rest: Substring) -> String.Index? {
        var index = rest.startIndex
        guard index < rest.endIndex, rest[index] == "[" else { return nil }

        index = rest.index(after: index)
        guard index < rest.endIndex, " xX*".contains(rest[index]) else { return nil }

        index = rest.index(after: index)
        guard index < rest.endIndex, rest[index] == "]" else { return nil }

        index = rest.index(after: index)
        guard index < rest.endIndex, rest[index] == " " else { return nil }
        return rest.index(after: index)
    }

    // MARK: - Inline

    private static func inline(
        _ line: String,
        from start: String.Index,
        until end: String.Index,
        _ spans: inout [Span]
    ) {
        var index = start
        while index < end {
            switch line[index] {
            case "\\":
                index = line.index(index, offsetBy: 2, limitedBy: end) ?? end

            case "`":
                index = code(line, at: index, until: end, &spans)

            case "[", "!":
                index = link(line, at: index, until: end, &spans)

            case "*", "_", "~":
                index = delimited(line, at: index, until: end, &spans)

            default:
                index = line.index(after: index)
            }
        }
    }

    /// An unmatched backtick run is literal text, so it is skipped rather than painted.
    private static func code(
        _ line: String,
        at index: String.Index,
        until end: String.Index,
        _ spans: inout [Span]
    ) -> String.Index {
        guard let span = MarkdownScan.closedCodeSpan(line, from: index), span.upperBound <= end else {
            return min(MarkdownScan.skippingCodeSpan(line, from: index), end)
        }
        append(span, .codeSpan, line, &spans)
        return span.upperBound
    }

    private static func link(
        _ line: String,
        at index: String.Index,
        until end: String.Index,
        _ spans: inout [Span]
    ) -> String.Index {
        let isImage = line[index] == "!"
        let open = isImage ? line.index(after: index) : index
        let next = line.index(after: index)

        guard open < end, line[open] == "[",
              let close = MarkdownScan.matchingBracket(line, from: open), close < end else { return next }

        let paren = line.index(after: close)
        guard paren < end, line[paren] == "(",
              let parsed = MarkdownScan.parsingDestination(line, from: paren), parsed.end <= end else { return next }

        if isImage { append(index..<open, .imageBang, line, &spans) }
        append(open..<line.index(after: open), .linkBracket, line, &spans)
        append(line.index(after: open)..<close, .linkText, line, &spans)
        append(close..<parsed.range.lowerBound, .linkBracket, line, &spans)
        append(parsed.range, .linkDestination, line, &spans)
        append(parsed.range.upperBound..<parsed.end, .linkBracket, line, &spans)

        // Link text can hold emphasis or an image of its own.
        inline(line, from: line.index(after: open), until: close, &spans)
        return parsed.end
    }

    /// A `*`, `_` or `~` run pairs with the next run of its own length on the same line.
    ///
    /// Not CommonMark's full flanking rule, which needs the whole document: a run followed by
    /// whitespace opens nothing, a run preceded by whitespace closes nothing, and `_` inside a
    /// word is a word - `snake_case` is not italics.
    private static func delimited(
        _ line: String,
        at index: String.Index,
        until end: String.Index,
        _ spans: inout [Span]
    ) -> String.Index {
        let marker = line[index]
        let runEnd = line[index..<end].prefix { $0 == marker }.endIndex
        let length = line.distance(from: index, to: runEnd)

        // A rule was handled at block level, so a run of three here is `***bold italic***`.
        guard length <= 3 else { return runEnd }
        // `~` is strikethrough and only ever doubled.
        guard marker != "~" || length == 2 else { return runEnd }
        guard runEnd < end, !line[runEnd].isWhitespace else { return runEnd }
        if marker == "_", index > line.startIndex, isWordCharacter(line[line.index(before: index)]) {
            return runEnd
        }

        var search = runEnd
        while search < end {
            if line[search] == "\\" {
                search = line.index(search, offsetBy: 2, limitedBy: end) ?? end
                continue
            }
            guard line[search] == marker else {
                search = line.index(after: search)
                continue
            }

            let closeEnd = line[search..<end].prefix { $0 == marker }.endIndex
            if line.distance(from: search, to: closeEnd) == length,
               !line[line.index(before: search)].isWhitespace {
                let kind: Kind = marker == "~" ? .strikethrough : (length >= 2 ? .strong : .emphasis)
                append(index..<closeEnd, kind, line, &spans)
                inline(line, from: runEnd, until: search, &spans)
                return closeEnd
            }
            search = closeEnd
        }
        return runEnd
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    // MARK: - Offsets

    /// `NSTextStorage` works in UTF-16, and a line is short enough to convert one end at a
    /// time. An empty range is dropped rather than painted.
    private static func append(
        _ range: Range<String.Index>,
        _ kind: Kind,
        _ line: String,
        _ spans: inout [Span]
    ) {
        guard range.lowerBound < range.upperBound else { return }
        let start = range.lowerBound.utf16Offset(in: line)
        let end = range.upperBound.utf16Offset(in: line)
        spans.append(Span(range: NSRange(location: start, length: end - start), kind: kind))
    }
}
