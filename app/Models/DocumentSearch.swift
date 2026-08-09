import Foundation

/// Finding a string across every document under a folder.
///
/// Pure and off-actor: a root of any size is a few hundred files to read, and the sidebar has
/// to stay live while it happens. The walk is `FileTree.documents(under:skipFolders:)`, the
/// same one the link rewriter uses - searching a different set of files from the one the
/// sidebar lists would be two answers to "which files does this app show you".
///
/// Deliberately not handled: regular expressions, whole-word matching, and multi-line
/// patterns. A regex on untrusted input can backtrack catastrophically and hang a walk that
/// then cannot be cancelled mid-match; if it is ever wanted, the house-style form is a
/// `/pattern/` query matched per line, so a pathological one is bounded by line length.
enum DocumentSearch {
    struct Hit: Identifiable, Equatable, Sendable {
        let url: URL
        /// 1-based, counted the way `LineIndex` counts - split on `\n` only.
        let line: Int
        /// UTF-16 offset of the match within `text`.
        let column: Int
        let length: Int
        /// The whole line, so the row can show the match in context and mark it.
        let text: String

        var id: String { "\(url.path):\(line):\(column)" }
    }

    /// Budgets, so a query typed into a huge tree cannot walk forever. Reaching one sets
    /// `truncated`, which the pane says out loud rather than quietly showing less.
    struct Limits: Sendable {
        var perFile = 50
        var total = 2000
        var files = 5000

        init() {}
    }

    struct Result: Sendable {
        let hits: [Hit]
        let truncated: Bool
        let filesSearched: Int

        static let empty = Self(hits: [], truncated: false, filesSearched: 0)
    }

    struct Match: Equatable, Sendable {
        let line: Int
        let column: Int
        let length: Int
        let text: String
    }

    /// Case-insensitive until the query carries a capital, then exact.
    ///
    /// Derived from the query rather than stored behind a toggle, the same reasoning that
    /// keeps a theme's light/dark polarity derived from its own background.
    static func isCaseSensitive(_ query: String) -> Bool {
        query.contains { $0.isUppercase }
    }

    /// Every match in one string. Pure over text, so most of the suite needs no disk at all.
    ///
    /// Lines are cut by scanning UTF-16 for `\n`, the way `LineIndex` does, and *not* with
    /// `split(separator: "\n")`: `\r\n` is a single `Character` in Swift, so splitting on the
    /// Character `\n` does not divide a CRLF file at all and every hit in one would report
    /// line 1. Files here come straight off disk, so CRLF is a real input.
    static func matches(in text: String, query: String, limit: Int = .max) -> [Match] {
        guard !query.isEmpty else { return [] }
        let options: String.CompareOptions = isCaseSensitive(query) ? [.literal] : [.caseInsensitive, .literal]
        let whole = text as NSString
        let needleLength = (query as NSString).length

        var found: [Match] = []
        var lineStart = 0
        var number = 1

        while lineStart <= whole.length {
            var lineEnd = lineStart
            while lineEnd < whole.length, whole.character(at: lineEnd) != 0x0A { lineEnd += 1 }

            // The carriage return belongs to the line ending, not to the text.
            var contentEnd = lineEnd
            if contentEnd > lineStart, whole.character(at: contentEnd - 1) == 0x0D { contentEnd -= 1 }

            let content = NSRange(location: lineStart, length: contentEnd - lineStart)
            var display: String?

            var start = content.location
            while start + needleLength <= NSMaxRange(content), found.count < limit {
                let range = whole.range(
                    of: query,
                    options: options,
                    range: NSRange(location: start, length: NSMaxRange(content) - start)
                )
                guard range.location != NSNotFound else { break }

                // Built once per line, and only for a line that actually matched.
                let line = display ?? whole.substring(with: content)
                display = line
                found.append(Match(
                    line: number,
                    column: range.location - content.location,
                    length: range.length,
                    text: line
                ))
                // At least one unit, so a zero-length match cannot spin.
                start = range.location + max(1, range.length)
            }

            if found.count >= limit { break }
            lineStart = lineEnd + 1
            number += 1
        }
        return found
    }

    /// - Parameters:
    ///   - buffers: unsaved text, keyed by `MarkdownLinks.canonical(_:).path` - the same
    ///     shape `FileMove.plan` takes, and for the same reason: searching the disk copy of
    ///     the file you are looking at would miss what you just typed.
    ///   - isCancelled: polled between files, so a superseded query dies within one file's
    ///     work rather than walking the whole tree first.
    nonisolated static func run(
        roots: [URL],
        skipFolders: Set<String>,
        query: String,
        buffers: [String: String] = [:],
        limits: Limits = Limits(),
        isCancelled: () -> Bool = { false }
    ) -> Result {
        guard !query.isEmpty else { return .empty }

        var hits: [Hit] = []
        var truncated = false
        var searched = 0
        // Roots can nest, and the same file reached through two of them is one file.
        var seen: Set<String> = []

        for root in roots {
            for url in FileTree.documents(under: root, skipFolders: skipFolders) {
                if isCancelled() { return Result(hits: hits, truncated: true, filesSearched: searched) }

                let path = MarkdownLinks.canonical(url).path
                guard seen.insert(path).inserted else { continue }
                guard searched < limits.files else {
                    return Result(hits: hits, truncated: true, filesSearched: searched)
                }
                searched += 1

                // A file we cannot decode is shown but never read, the same rule
                // MarkdownDocument and FileMove.plan apply.
                guard let text = buffers[path] ?? (try? String(contentsOf: url, encoding: .utf8)) else { continue }

                let room = min(limits.perFile, limits.total - hits.count)
                guard room > 0 else { return Result(hits: hits, truncated: true, filesSearched: searched) }

                let found = matches(in: text, query: query, limit: room + 1)
                if found.count > room { truncated = true }

                for match in found.prefix(room) {
                    hits.append(Hit(
                        url: url,
                        line: match.line,
                        column: match.column,
                        length: match.length,
                        text: match.text
                    ))
                }
            }
        }
        return Result(hits: hits, truncated: truncated, filesSearched: searched)
    }
}
