import Darwin
import Foundation

/// "Could this file possibly contain the query?", answered on raw bytes.
///
/// Searching a project decodes every candidate file into a `String` and then asks Foundation
/// for a case-insensitive `range(of:)` over all of it, whether or not the file has anything to
/// do with the query. This answers the same question on the mapped bytes first, so both only
/// happen for files that survive it - 1.0s down to 250ms over 3,829 documents and 128MB
/// under `~/dev`, for a query that hits a few dozen of them. `hammer bench` re-runs it.
///
/// Most of that is not the decode. `NSString.range(of:options:)` with `.caseInsensitive` is
/// several times the cost of reading the same bytes, and skipping the file skips both.
///
/// The contract is one-sided and that is the whole point: `mayContain` is allowed to say yes
/// about a file that turns out to hold nothing, and must never say no about one that does.
/// A false positive costs a decode that was going to happen anyway; a false negative is a hit
/// the user never sees. `DocumentSearch.matches` remains the only thing that decides what a
/// match *is*.
enum ByteScan {
    /// A query compiled once and then asked about many files.
    struct Needle: Sendable {
        private let pattern: [UInt8]
        private let caseSensitive: Bool
        /// Boyer-Moore-Horspool bad-character shifts, over folded bytes.
        private let shift: [Int]
        /// UTF-8 for the scalars Foundation case-folds *into* ASCII. See `foldEscapes`.
        private let escapes: [[UInt8]]

        /// - Returns: nil when the query cannot be scanned soundly as bytes, which is any
        ///   query with a non-ASCII character in it. Callers fall back to decoding every file.
        ///   Folding non-ASCII correctly means implementing Unicode's case mapping, and
        ///   implementing it *slightly* differently from Foundation is exactly the kind of
        ///   quiet disagreement this app tries not to have with itself.
        init?(_ query: String, caseSensitive: Bool) {
            let bytes = Array(query.utf8)
            guard !bytes.isEmpty, bytes.allSatisfy({ $0 < 0x80 }) else { return nil }

            self.caseSensitive = caseSensitive
            pattern = caseSensitive ? bytes : bytes.map(Self.fold)

            var table = [Int](repeating: pattern.count, count: 256)
            for index in 0..<(pattern.count - 1) {
                table[Int(pattern[index])] = pattern.count - 1 - index
            }
            shift = table

            escapes = caseSensitive ? [] : Self.foldEscapes(for: pattern)
        }

        func mayContain(_ buffer: UnsafeRawBufferPointer) -> Bool {
            guard let base = buffer.baseAddress, buffer.count >= pattern.count else { return false }
            if occurs(in: buffer) { return true }
            // Nothing matched byte-wise, but a fold could still have produced a match the
            // bytes cannot show. Only then is it worth looking for one.
            return escapes.contains { escape in
                Self.occurs(escape, in: base, count: buffer.count)
            }
        }

        private func occurs(in buffer: UnsafeRawBufferPointer) -> Bool {
            guard let base = buffer.baseAddress else { return false }

            if caseSensitive {
                return Self.occurs(pattern, in: base, count: buffer.count)
            }

            // Horspool rather than memmem, because the bytes have to be folded as they are
            // read and there is no case-insensitive memmem to hand it to.
            let bytes = buffer.bindMemory(to: UInt8.self)
            let last = pattern.count - 1
            var start = 0
            while start + pattern.count <= bytes.count {
                var index = last
                while index >= 0, Self.fold(bytes[start + index]) == pattern[index] { index -= 1 }
                if index < 0 { return true }
                start += shift[Int(Self.fold(bytes[start + last]))]
            }
            return false
        }

        private static func occurs(_ needle: [UInt8], in base: UnsafeRawPointer, count: Int) -> Bool {
            needle.withUnsafeBytes { pattern in
                guard let start = pattern.baseAddress else { return false }
                return memmem(base, count, start, needle.count) != nil
            }
        }

        private static func fold(_ byte: UInt8) -> UInt8 {
            byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z") ? byte + 32 : byte
        }

        /// The three scalars that make a byte scan unsound, and only these three: Unicode has
        /// no other case-fold that lands a non-ASCII character on an ASCII one Foundation's
        /// `[.caseInsensitive, .literal]` will match.
        ///
        /// * `U+212A` KELVIN SIGN folds to `k`
        /// * `U+017F` LATIN SMALL LETTER LONG S folds to `s`
        /// * `U+00DF` sharp s matches the query `ss`
        ///
        /// A file carrying one of them is handed to the decoder rather than skipped. They are
        /// rare enough that the prescan keeps essentially all of its win, and a query with no
        /// `k` or `s` in it never pays for the check at all.
        private static func foldEscapes(for pattern: [UInt8]) -> [[UInt8]] {
            var escapes: [[UInt8]] = []
            if pattern.contains(UInt8(ascii: "k")) { escapes.append([0xE2, 0x84, 0xAA]) }
            if pattern.contains(UInt8(ascii: "s")) { escapes.append([0xC5, 0xBF]) }
            for index in 1..<pattern.count
            where pattern[index - 1] == UInt8(ascii: "s") && pattern[index] == UInt8(ascii: "s") {
                escapes.append([0xC3, 0x9F])
                break
            }
            return escapes
        }
    }
}
