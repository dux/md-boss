import Foundation

/// Where every line of a block of text starts, as UTF-16 offsets.
///
/// Built once per edit and searched by bisection. The three places that used to answer
/// "which line is this offset on" each walked the whole string, and scroll sync now asks on
/// every scroll frame - on a long file that is a linear scan per frame.
///
/// Lines are split on `\n` only. `MarkdownDocument` normalises CRLF on load, and every line
/// number the app stores - notes, Copy Path with Line - is already counted
/// that way, so a lone `\r` or a U+2028 must not silently shift the numbering.
struct LineIndex: Equatable {
    /// Offset of the first character of each line. Always starts with 0, so the empty
    /// string is one line, and a text ending in `\n` has an empty last line.
    private let starts: [Int]
    /// Total length in UTF-16 units, which is also the end of the last line.
    let length: Int

    init(_ text: String) {
        var starts = [0]
        var offset = 0
        for unit in text.utf16 {
            offset += 1
            if unit == 0x0A { starts.append(offset) }
        }
        self.starts = starts
        self.length = offset
    }

    var count: Int { starts.count }

    /// 1-based number of the line containing `offset`.
    func line(at offset: Int) -> Int {
        let clamped = min(max(0, offset), length)

        var low = 0
        var high = starts.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if starts[mid] <= clamped { low = mid } else { high = mid - 1 }
        }
        return low + 1
    }

    /// The 1-based line's range, trailing newline included - the same span
    /// `NSString.lineRange(for:)` returns, which is what `scrollRangeToVisible` expects.
    func range(ofLine line: Int) -> NSRange? {
        guard line >= 1, line <= starts.count else { return nil }
        let start = starts[line - 1]
        let end = line < starts.count ? starts[line] : length
        return NSRange(location: start, length: end - start)
    }
}
