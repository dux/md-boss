import Foundation

/// Finding a string across every document under a folder.
///
/// Pure and off-actor: a root of any size is a few hundred files to read, and the sidebar has
/// to stay live while it happens. The file list is `ProjectIndex`, which caches
/// `FileTree.documents(under:skipFolders:)` - the same walk the link rewriter uses, because
/// searching a different set of files from the one the sidebar lists would be two answers to
/// "which files does this app show you". That is also why this does not shell out to `rg`,
/// which obeys `.gitignore` instead and is not on a stock macOS besides.
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
    /// Matches are found over the whole string first, and only the lines that actually
    /// matched are then located. Cutting a file into lines *before* searching means touching
    /// every character, and doing that through `NSString.character(at:)` is an Objective-C
    /// message send each time. A query never spans a line break, so searching across them
    /// cannot invent a match.
    ///
    /// Line numbers come from `LineIndex`, which counts UTF-16 units - deliberately not from
    /// `split(separator: "\n")`, because `\r\n` is a single `Character` in Swift and
    /// splitting on the Character `\n` does not divide a CRLF file at all. Files here are read
    /// straight off disk, so CRLF is a real input; everywhere else in the app
    /// `MarkdownDocument` has already normalised it.
    static func matches(in text: String, query: String, limit: Int = .max) -> [Match] {
        guard !query.isEmpty, !text.isEmpty else { return [] }
        let options: String.CompareOptions = isCaseSensitive(query) ? [.literal] : [.caseInsensitive, .literal]
        let whole = text as NSString

        var ranges: [NSRange] = []
        var from = 0
        while from < whole.length, ranges.count < limit {
            let range = whole.range(
                of: query,
                options: options,
                range: NSRange(location: from, length: whole.length - from)
            )
            guard range.location != NSNotFound else { break }
            ranges.append(range)
            // At least one unit, so a zero-length match cannot spin.
            from = range.location + max(1, range.length)
        }
        guard !ranges.isEmpty else { return [] }

        // Built once, and only for a file that matched. It counts UTF-16 units in a Swift
        // loop, which is the same arithmetic the notes are anchored to.
        let index = LineIndex(text)

        var found: [Match] = []
        var cached: (number: Int, text: String, start: Int)?

        for range in ranges {
            let number = index.line(at: range.location)

            let line: (number: Int, text: String, start: Int)
            if let cached, cached.number == number {
                line = cached
            } else {
                guard let lineRange = index.range(ofLine: number) else { continue }
                // The range carries its trailing newline, and a file off disk may still be
                // CRLF; neither belongs to the text.
                var length = lineRange.length
                if length > 0, whole.character(at: lineRange.location + length - 1) == 0x0A { length -= 1 }
                if length > 0, whole.character(at: lineRange.location + length - 1) == 0x0D { length -= 1 }

                line = (
                    number,
                    whole.substring(with: NSRange(location: lineRange.location, length: length)),
                    lineRange.location
                )
                cached = line
            }

            found.append(Match(
                line: number,
                column: range.location - line.start,
                length: range.length,
                text: line.text
            ))
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
        isCancelled: @Sendable () -> Bool = { false }
    ) -> Result {
        guard !query.isEmpty else { return .empty }

        // The file list. Cold this is the directory walk - 330ms over 3,829 documents under
        // ~/dev, over half the search. Warm it is a dictionary lookup, which is what makes
        // the second keystroke of a query cost nothing but the read below.
        var targets: [(url: URL, path: String)] = []
        var seen: Set<String> = []
        var overflowedFiles = false

        walk: for root in roots {
            for url in ProjectIndex.shared.documents(under: root, skipFolders: skipFolders) {
                if isCancelled() { return Result(hits: [], truncated: true, filesSearched: 0) }
                // Roots can nest, and the same file reached through two of them is one file.
                let path = MarkdownLinks.canonical(url).path
                guard seen.insert(path).inserted else { continue }
                guard targets.count < limits.files else { overflowedFiles = true; break walk }
                targets.append((url, path))
            }
        }

        // Read serially, on purpose - `isCancelled` between files is what lets a superseded
        // query die within one file's work, and a parallel read would have to give that up
        // for a lock and a shared collector.
        //
        // The prescan is what pays for that. Decoding a file and asking Foundation for a
        // case-insensitive `range(of:)` over all of it costs the same whether or not the file
        // has anything to do with the query; `ByteScan.Needle` answers "possibly" on the
        // mapped bytes and only those files go any further. 1.0s to 250ms over 3,829
        // documents and 128MB under `~/dev`.
        let needle = ByteScan.Needle(query, caseSensitive: isCaseSensitive(query))

        var hits: [Hit] = []
        var truncated = overflowedFiles

        for (url, path) in targets {
            if isCancelled() { return Result(hits: hits, truncated: true, filesSearched: targets.count) }

            // A file we cannot decode is listed but never read, the same rule
            // MarkdownDocument and FileMove.plan apply.
            let text: String
            if let unsaved = buffers[path] {
                // Already a String, and the disk copy is stale by definition.
                text = unsaved
            } else {
                guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { continue }
                if let needle, !data.withUnsafeBytes({ needle.mayContain($0) }) { continue }
                guard let decoded = String(data: data, encoding: .utf8) else { continue }
                text = decoded
            }

            let room = min(limits.perFile, limits.total - hits.count)
            guard room > 0 else { return Result(hits: hits, truncated: true, filesSearched: targets.count) }

            // One past the cap, so "exactly full" can be told from "there was more".
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
        return Result(hits: hits, truncated: truncated, filesSearched: targets.count)
    }
}
