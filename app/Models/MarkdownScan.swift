import Foundation

/// The parts of markdown that are not regular, in one place: fences are line state, a code
/// span closes only on a backtick run of its own length, link text nests, and a destination
/// carries balanced parentheses.
///
/// Extracted so the link rewriter and the editor's highlighter read the same rules instead of
/// each carrying a copy. The two walk the text differently on purpose - `MarkdownLinks` skips
/// a fenced block whole, and `MarkdownSyntax` has to colour it - but they must never disagree
/// about what a fence *is*. A regex gets each of these wrong, and the failure mode on the
/// rewriting side - silently repointing a link inside a fence - is the worst one a file mover
/// has, which is why the rules moved rather than being written twice.
enum MarkdownScan {
    struct Fence: Equatable, Sendable {
        let marker: Character
        let length: Int
    }

    // MARK: - Fences

    /// Up to three leading spaces, then a run of at least three backticks or tildes.
    static func opensFence(_ line: Substring) -> Fence? {
        let body = line.drop { $0 == " " }
        guard line.count - body.count <= 3, let marker = body.first, marker == "`" || marker == "~" else { return nil }

        let length = body.prefix { $0 == marker }.count
        return length >= 3 ? Fence(marker: marker, length: length) : nil
    }

    /// A closer matches the opener's character, runs at least as long, and carries nothing
    /// but whitespace after it.
    static func closesFence(_ line: Substring, _ fence: Fence) -> Bool {
        let body = line.drop { $0 == " " }
        guard line.count - body.count <= 3 else { return false }

        let run = body.prefix { $0 == fence.marker }
        return run.count >= fence.length && body.dropFirst(run.count).allSatisfy(\.isWhitespace)
    }

    // MARK: - Code spans

    /// A code span closes on a backtick run of exactly the opening run's length. An unmatched
    /// run is literal text, so scanning resumes right after it.
    static func skippingCodeSpan(_ text: String, from index: String.Index) -> String.Index {
        var scan = index
        var opening = 0
        while scan < text.endIndex, text[scan] == "`" {
            opening += 1
            scan = text.index(after: scan)
        }

        var search = scan
        while search < text.endIndex {
            guard text[search] == "`" else {
                search = text.index(after: search)
                continue
            }
            var run = 0
            var end = search
            while end < text.endIndex, text[end] == "`" {
                run += 1
                end = text.index(after: end)
            }
            if run == opening { return end }
            search = end
        }
        return scan
    }

    /// Whether the run at `index` actually closed. The highlighter colours a closed span and
    /// leaves an unmatched run as prose; the rewriter only needs to know where to resume.
    static func closedCodeSpan(_ text: String, from index: String.Index) -> Range<String.Index>? {
        var scan = index
        while scan < text.endIndex, text[scan] == "`" { scan = text.index(after: scan) }

        let end = skippingCodeSpan(text, from: index)
        return end > scan ? index..<end : nil
    }

    // MARK: - Links

    /// The `]` closing the `[` at `open`, honouring nesting, escapes and code spans.
    static func matchingBracket(_ text: String, from open: String.Index) -> String.Index? {
        var depth = 1
        var index = text.index(after: open)

        while index < text.endIndex {
            switch text[index] {
            case "\\":
                index = text.index(index, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex
                continue
            case "`":
                index = skippingCodeSpan(text, from: index)
                continue
            case "[":
                depth += 1
            case "]":
                depth -= 1
                if depth == 0 { return index }
            default:
                break
            }
            index = text.index(after: index)
        }
        return nil
    }

    /// Parses `(dest)` or `(dest "title")` starting at the opening parenthesis. `range` covers
    /// the destination token only, angle brackets included - link text and any title sit
    /// outside it, so a rewrite that splices there cannot disturb them.
    static func parsingDestination(
        _ text: String,
        from paren: String.Index
    ) -> (range: Range<String.Index>, raw: String, end: String.Index)? {
        var index = skippingSpaces(text, from: text.index(after: paren))
        guard index < text.endIndex else { return nil }

        let range: Range<String.Index>
        let raw: String

        if text[index] == "<" {
            let start = index
            var scan = text.index(after: index)
            while scan < text.endIndex, text[scan] != ">" {
                if text[scan] == "\\" {
                    scan = text.index(scan, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex
                    continue
                }
                scan = text.index(after: scan)
            }
            guard scan < text.endIndex else { return nil }
            raw = String(text[text.index(after: start)..<scan])
            index = text.index(after: scan)
            range = start..<index
        } else {
            let start = index
            var depth = 0
            while index < text.endIndex {
                let character = text[index]
                if character == "\\" {
                    index = text.index(index, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex
                    continue
                }
                if character.isWhitespace { break }
                if character == "(" { depth += 1 }
                if character == ")" {
                    if depth == 0 { break }
                    depth -= 1
                }
                index = text.index(after: index)
            }
            raw = String(text[start..<index])
            range = start..<index
        }

        index = skippingSpaces(text, from: index)
        index = skippingTitle(text, from: index)
        index = skippingSpaces(text, from: index)

        guard index < text.endIndex, text[index] == ")" else { return nil }
        return (range, raw, text.index(after: index))
    }

    static func skippingSpaces(_ text: String, from index: String.Index) -> String.Index {
        var scan = index
        while scan < text.endIndex, text[scan].isWhitespace { scan = text.index(after: scan) }
        return scan
    }

    static func skippingTitle(_ text: String, from index: String.Index) -> String.Index {
        guard index < text.endIndex else { return index }
        let closer: Character
        switch text[index] {
        case "\"": closer = "\""
        case "'": closer = "'"
        case "(": closer = ")"
        default: return index
        }

        var scan = text.index(after: index)
        while scan < text.endIndex, text[scan] != closer {
            if text[scan] == "\\" {
                scan = text.index(scan, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex
                continue
            }
            scan = text.index(after: scan)
        }
        return scan < text.endIndex ? text.index(after: scan) : index
    }
}
