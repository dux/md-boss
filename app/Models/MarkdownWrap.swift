import Foundation

/// Bold, italic and link, as one replacement over one range.
///
/// One range rather than several so each command is a single undo step, a single
/// `didProcessEditing` and a single note shift. Pure: the clipboard is read at the call site
/// and passed in, the same discipline `NoteSections.partition` follows with its roots.
enum MarkdownWrap {
    struct Edit: Equatable, Sendable {
        /// What to replace, in UTF-16 units over the whole document.
        let range: NSRange
        let replacement: String
        /// Where the selection lands afterwards, over the document as it will then be.
        let selection: NSRange
    }

    // MARK: - Bold and italic

    /// Wraps the selection in `marker`, or unwraps it when it is already wrapped.
    ///
    /// Already-wrapped counts both ways: markers just outside the selection (`**|foo|**`) and
    /// markers inside it (`|**foo**|`). An empty selection takes the word under the caret,
    /// and with no word to take it leaves the caret between a fresh pair.
    static func toggling(_ text: NSString, selection: NSRange, marker: String) -> Edit {
        let target = selection.length == 0 ? word(in: text, at: selection.location) : selection
        let width = (marker as NSString).length

        // `|**foo**|` - the markers were selected along with the text.
        if target.length >= 2 * width,
           text.substring(with: NSRange(location: target.location, length: width)) == marker,
           text.substring(with: NSRange(location: NSMaxRange(target) - width, length: width)) == marker {
            let inner = NSRange(location: target.location + width, length: target.length - 2 * width)
            return Edit(
                range: target,
                replacement: text.substring(with: inner),
                selection: NSRange(location: target.location, length: inner.length)
            )
        }

        // `**|foo|**` - the markers sit just outside.
        if target.location >= width, NSMaxRange(target) + width <= text.length,
           text.substring(with: NSRange(location: target.location - width, length: width)) == marker,
           text.substring(with: NSRange(location: NSMaxRange(target), length: width)) == marker {
            let outer = NSRange(location: target.location - width, length: target.length + 2 * width)
            return Edit(
                range: outer,
                replacement: text.substring(with: target),
                selection: NSRange(location: outer.location, length: target.length)
            )
        }

        // Trailing space inside the markers is not emphasis in CommonMark - `**foo **`
        // renders literally - so whitespace at either end migrates outside them.
        let trimmed = trimming(text, target)
        let body = text.substring(with: trimmed)
        let lead = text.substring(with: NSRange(location: target.location, length: trimmed.location - target.location))
        let tail = text.substring(with: NSRange(
            location: NSMaxRange(trimmed),
            length: NSMaxRange(target) - NSMaxRange(trimmed)
        ))

        return Edit(
            range: target,
            replacement: lead + marker + body + marker + tail,
            selection: NSRange(location: trimmed.location + (lead as NSString).length + width, length: trimmed.length)
        )
    }

    // MARK: - Link

    /// `[text](url)`, filling in whichever half it can.
    ///
    /// A URL on the clipboard becomes the destination and the caret lands past the link. A
    /// selection that is itself a URL becomes the destination instead, with the caret in the
    /// empty brackets where the text goes.
    static func link(_ text: NSString, selection: NSRange, clipboard: String?) -> Edit {
        let target = selection.length == 0 ? word(in: text, at: selection.location) : selection
        let body = text.substring(with: target)

        if let clipboard, isURL(clipboard) {
            let replacement = "[\(body)](\(clipboard))"
            return Edit(
                range: target,
                replacement: replacement,
                selection: NSRange(location: target.location + (replacement as NSString).length, length: 0)
            )
        }

        if isURL(body) {
            return Edit(
                range: target,
                replacement: "[](\(body))",
                // Between the brackets, which is the half still missing.
                selection: NSRange(location: target.location + 1, length: 0)
            )
        }

        return Edit(
            range: target,
            replacement: "[\(body)]()",
            selection: NSRange(location: target.location + (body as NSString).length + 3, length: 0)
        )
    }

    /// Deliberately narrow: a scheme and something after it. A bare `example.com` on the
    /// clipboard is far more often prose than a link anyone meant to paste.
    static func isURL(_ candidate: String) -> Bool {
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(where: \.isWhitespace) else { return false }
        return trimmed.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) != nil
    }

    // MARK: - Ranges

    /// The word under the caret, or an empty range where it stands when there is none.
    private static func word(in text: NSString, at location: Int) -> NSRange {
        var start = min(location, text.length)
        var end = start

        while start > 0, isWordCharacter(text.character(at: start - 1)) { start -= 1 }
        while end < text.length, isWordCharacter(text.character(at: end)) { end += 1 }
        return NSRange(location: start, length: end - start)
    }

    private static func isWordCharacter(_ unit: unichar) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.alphanumerics.contains(scalar) || scalar == "_"
    }

    private static func trimming(_ text: NSString, _ range: NSRange) -> NSRange {
        var start = range.location
        var end = NSMaxRange(range)

        while start < end, isSpace(text.character(at: start)) { start += 1 }
        while end > start, isSpace(text.character(at: end - 1)) { end -= 1 }
        return NSRange(location: start, length: end - start)
    }

    private static func isSpace(_ unit: unichar) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return CharacterSet.whitespacesAndNewlines.contains(scalar)
    }
}
