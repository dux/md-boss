import Foundation

/// What Return does on a line that is already part of a list or a quote.
///
/// Pure, so every rule here is tested without a text view. The caller supplies whether the
/// line is inside a fenced block - `MarkdownHighlighter` already keeps that answer, and a
/// `- ` inside ``` is code, not a bullet.
enum MarkdownList {
    enum Marker: Equatable, Sendable {
        case bullet(Character)
        case ordered(Int, delimiter: Character)

        /// What the *next* item's marker reads as. Ordered lists increment rather than
        /// renumbering what follows: renumbering rewrites lines nobody touched, makes one
        /// undo step span the whole list, and CommonMark renders `1. 1. 1.` correctly anyway.
        var next: String {
            switch self {
            case .bullet(let character): return "\(character) "
            case .ordered(let number, let delimiter): return "\(number + 1)\(delimiter) "
            }
        }
    }

    /// Everything before an item's text, kept verbatim so a continuation lines up under it.
    struct Prefix: Equatable, Sendable {
        /// Leading spaces, exactly as written.
        let indent: String
        /// The `> ` runs, exactly as written. A quote can carry a list and vice versa.
        let quotes: String
        let marker: Marker?
        /// Whether the item carried a `[ ]`, `[x]` or `[*]` box.
        let isTask: Bool
        /// UTF-16 offset where the item's own text starts.
        let contentStart: Int
        /// Nothing but whitespace after the marker.
        let isEmpty: Bool

        /// What to open the next line with. A task always continues unchecked - carrying
        /// `[x]` forward would tick a box nobody has done.
        var continuation: String {
            indent + quotes + (marker?.next ?? "") + (isTask ? "[ ] " : "")
        }

        /// Everything up to the item's text, which is what an empty item sheds.
        var length: Int { contentStart }
    }

    // MARK: - Parsing

    /// Where a `- `, `* `, `+ `, `1. ` or `1) ` marker ends. Shared with `MarkdownSyntax`,
    /// which needs the same answer to paint the marker, so the two cannot drift on what a
    /// bullet is.
    static func markerEnd(of body: Substring) -> String.Index? {
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

    /// Where a `[ ]`, `[x]` or `[*]` box ends, when one follows the marker.
    static func taskEnd(of rest: Substring) -> String.Index? {
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

    /// Nil when the line opens nothing that Return should carry forward.
    static func prefix(of line: String) -> Prefix? {
        var index = line.startIndex

        let indent = String(line[index...].prefix { $0 == " " })
        index = line.index(index, offsetBy: indent.count)

        var quotes = ""
        while index < line.endIndex, line[index] == ">" {
            var end = line.index(after: index)
            if end < line.endIndex, line[end] == " " { end = line.index(after: end) }
            quotes += line[index..<end]
            index = end
        }

        // Indentation after the quote bars belongs to the list, not to the quote.
        let inner = String(line[index...].prefix { $0 == " " })
        index = line.index(index, offsetBy: inner.count)

        var marker: Marker?
        var isTask = false

        if let end = markerEnd(of: line[index...]) {
            marker = parseMarker(line[index..<end])
            index = end
            if let boxed = taskEnd(of: line[index...]) {
                isTask = true
                index = boxed
            }
        }

        guard marker != nil || !quotes.isEmpty else { return nil }

        return Prefix(
            indent: indent + inner,
            quotes: quotes,
            marker: marker,
            isTask: isTask,
            contentStart: index.utf16Offset(in: line),
            isEmpty: line[index...].allSatisfy(\.isWhitespace)
        )
    }

    private static func parseMarker(_ token: Substring) -> Marker? {
        guard let first = token.first else { return nil }
        if first == "-" || first == "*" || first == "+" { return .bullet(first) }

        let digits = token.prefix { $0.isNumber }
        guard let number = Int(digits), digits.endIndex < token.endIndex else { return nil }
        return .ordered(number, delimiter: token[digits.endIndex])
    }

    // MARK: - Return

    enum Continuation: Equatable, Sendable {
        /// Let AppKit insert the newline it was going to.
        case none
        /// A newline plus the reconstructed prefix.
        case insert(String)
        /// An empty item sheds its marker instead of growing another one - the standard way
        /// out of a list. The range is relative to the line.
        case clear(NSRange)
    }

    /// - Parameters:
    ///   - caretColumn: UTF-16 offset of the caret within `line`.
    ///   - insideFence: a `- ` inside ``` is code, and Return there is just a newline.
    static func continuation(for line: String, caretColumn: Int, insideFence: Bool) -> Continuation {
        guard !insideFence, let prefix = prefix(of: line) else { return .none }

        // Return with the caret still inside the marker splits the line rather than
        // continuing it - there is no item yet to continue.
        guard caretColumn >= prefix.contentStart else { return .none }

        if prefix.isEmpty {
            // Only when the caret is at the end of it; mid-marker is the case above.
            return .clear(NSRange(location: 0, length: prefix.length))
        }
        return .insert("\n" + prefix.continuation)
    }
}
