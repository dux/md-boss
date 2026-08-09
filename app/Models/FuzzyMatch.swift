import Foundation

/// Ranking file names against what has been typed so far, for Go to File.
///
/// A subsequence match rather than a substring one, so `mtv` finds
/// `app/Views/MarkdownTextView.swift`. Pure, so the ordering can be pinned by test - which is
/// the whole difficulty here: any scorer finds the matches, and only the order is the feature.
enum FuzzyMatch {
    struct Ranked: Identifiable, Equatable, Sendable {
        let url: URL
        /// Root-relative, which is what the row shows and what the score was computed over.
        let display: String
        let score: Int
        /// UTF-16 offsets in `display` that the query landed on, for marking the row.
        let matched: [Int]

        var id: String { url.path }
    }

    // Weighted the way fzy weights them, and the ordering between these is the whole design:
    // a run that stays together beats one that lands on boundaries, or `n-o-t-e.md` would
    // outrank `notes.md` for "note". Gaps cost almost nothing - being far into a long path is
    // not the same as being a bad match.
    private static let consecutive = 100
    private static let afterSlash = 90
    private static let afterWord = 80
    private static let camelHump = 70
    private static let afterDot = 60
    private static let gapPenalty = 1
    private static let gapCap = 20

    /// Nil when the query is not a subsequence of the candidate.
    ///
    /// A full alignment rather than a greedy walk. Greedy takes the first place each
    /// character fits, which gets the ordering wrong in exactly the case this is for:
    /// `mtv` against `app/Models/MarkdownDocumentValue.swift` would seize the `M` of
    /// `Models`, then score a lucky consecutive `tV`, and beat the `M`/`T`/`V` of
    /// `MarkdownTextView` that anyone typing `mtv` actually meant.
    ///
    /// `M[i][j]` is the best score with query character `i` sitting at candidate position
    /// `j`; `D[i][j]` is the best way to place the first `i + 1` characters anywhere up to
    /// `j`. Each match is either a continuation of the previous one or a fresh start, which
    /// is what lets the consecutive bonus be earned rather than assumed.
    static func score(_ query: String, in candidate: String) -> (score: Int, matched: [Int])? {
        guard !query.isEmpty else { return (0, []) }

        let needle = Array(query.lowercased().unicodeScalars)
        let hay = Array(candidate.unicodeScalars)
        let lowered = Array(candidate.lowercased().unicodeScalars)
        // Lowercasing can change the scalar count for some scripts, and the offsets would
        // then point into a string of a different length.
        guard lowered.count == hay.count, !hay.isEmpty, needle.count <= hay.count else { return nil }

        let rows = needle.count
        let columns = hay.count
        let floor = Int.min / 4

        var best = Array(repeating: Array(repeating: floor, count: columns), count: rows)
        var reach = Array(repeating: Array(repeating: floor, count: columns), count: rows)
        /// Where `reach[i][j]` took its value, so the alignment can be walked back.
        var from = Array(repeating: Array(repeating: -1, count: columns), count: rows)
        /// Whether `best[i][j]` continued the previous character rather than starting fresh.
        var chained = Array(repeating: Array(repeating: false, count: columns), count: rows)

        for i in 0..<rows {
            for j in 0..<columns {
                if lowered[j] == needle[i] {
                    if i == 0 {
                        best[i][j] = bonus(hay, at: j) - min(j, gapCap) * gapPenalty
                    } else if j > 0 {
                        let continued = best[i - 1][j - 1] > floor ? best[i - 1][j - 1] + consecutive : floor
                        let fresh = reach[i - 1][j - 1] > floor ? reach[i - 1][j - 1] + bonus(hay, at: j) : floor
                        if continued >= fresh {
                            best[i][j] = continued
                            chained[i][j] = true
                        } else {
                            best[i][j] = fresh
                        }
                    }
                }

                if j == 0 {
                    reach[i][j] = best[i][j]
                    from[i][j] = best[i][j] > floor ? 0 : -1
                } else if best[i][j] > reach[i][j - 1] {
                    reach[i][j] = best[i][j]
                    from[i][j] = j
                } else {
                    reach[i][j] = reach[i][j - 1]
                    from[i][j] = from[i][j - 1]
                }
            }
        }

        guard reach[rows - 1][columns - 1] > floor else { return nil }

        var matched = Array(repeating: 0, count: rows)
        var row = rows - 1
        var column = from[rows - 1][columns - 1]
        while row >= 0 {
            matched[row] = column
            if row == 0 { break }
            // A fresh start came from the best reach up to the previous column, so `j > 0`.
            column = chained[row][column] ? column - 1 : from[row - 1][column - 1]
            row -= 1
        }

        // A short candidate that matched is a better answer than a long one that also did.
        return (reach[rows - 1][columns - 1] - columns / 8, matched)
    }

    /// The very start of the string counts as a boundary, the same as one after a slash.
    private static func bonus(_ hay: [Unicode.Scalar], at index: Int) -> Int {
        guard index > 0 else { return afterSlash }

        let previous = hay[index - 1]
        if previous == "/" { return afterSlash }
        if previous == "-" || previous == "_" || previous == " " { return afterWord }
        if previous == "." { return afterDot }
        // CamelCase opens a word too: the T of MarkdownTextView.
        if Character(previous).isLowercase && Character(hay[index]).isUppercase { return camelHump }
        return 0
    }

    /// - Parameter recent: most-recently-opened paths, nearest first. It breaks ties only -
    ///   a better match always wins over a more recent one.
    static func rank(
        _ query: String,
        candidates: [URL],
        relativeTo root: URL,
        recent: [String] = [],
        limit: Int = 200
    ) -> [Ranked] {
        let rootPath = root.standardizedFileURL.path
        var recency: [String: Int] = [:]
        for (position, path) in recent.enumerated() { recency[path] = recent.count - position }

        var ranked: [Ranked] = []
        for url in candidates {
            let path = url.standardizedFileURL.path
            let display = path.hasPrefix(rootPath + "/")
                ? String(path.dropFirst(rootPath.count + 1))
                : url.lastPathComponent

            guard let hit = score(query, in: display) else { continue }
            ranked.append(Ranked(url: url, display: display, score: hit.score, matched: hit.matched))
        }

        return ranked
            .sorted { left, right in
                if left.score != right.score { return left.score > right.score }
                let leftRecent = recency[left.url.standardizedFileURL.path] ?? 0
                let rightRecent = recency[right.url.standardizedFileURL.path] ?? 0
                if leftRecent != rightRecent { return leftRecent > rightRecent }
                return left.display.localizedStandardCompare(right.display) == .orderedAscending
            }
            .prefix(limit)
            .map { $0 }
    }
}
