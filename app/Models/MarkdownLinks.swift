import Foundation

/// Relative paths and inline markdown links, as text.
///
/// The preview never needed this - it loads with the markdown file as its base URL, so
/// WebKit resolves `./doc/API.md` before `MarkdownLinkTarget` ever sees it. This is the
/// first place in the app that has to read `[text](dest)` as syntax rather than follow a
/// resolved URL, which is why it is pure and off-actor: a move rewrites every document
/// under a root, and none of that wants the main actor.
enum MarkdownLinks {
    /// One file that has moved. A list rather than a pair, because moving a folder is the
    /// same algorithm with one entry per document underneath it.
    struct Move: Equatable, Sendable {
        let old: URL
        let new: URL

        init(old: URL, new: URL) {
            self.old = old
            self.new = new
        }
    }

    /// The destination token of one inline link, and where it sits in the source.
    struct Destination: Equatable {
        /// The destination as written, angle brackets included. Link text and any title
        /// sit outside it, so a rewrite that splices here cannot disturb them.
        let range: Range<String.Index>
        /// Inside the angle brackets, when there were any.
        let raw: String
        let isImage: Bool
    }

    // MARK: - Paths

    /// `/var/folders/...` is a symlink to `/private/var/folders/...`, and a directory
    /// enumerator hands back the resolved form while a path typed into a link does not - the
    /// same file, two strings. Every comparison and every relative path goes through here.
    ///
    /// Resolution stops at the deepest ancestor that exists, because
    /// `resolvingSymlinksInPath` gives up on a path that is not there: a link to a file
    /// that has just been moved away would otherwise canonicalise differently from the
    /// folder it sits in, and nothing would match.
    static func canonical(_ url: URL) -> URL {
        let standardized = url.standardizedFileURL
        var missing: [String] = []
        var current = standardized

        while !FileManager.default.fileExists(atPath: current.path) {
            let parent = current.deletingLastPathComponent()
            guard parent.path != current.path else { return standardized }
            missing.append(current.lastPathComponent)
            current = parent
        }

        var resolved = current.resolvingSymlinksInPath()
        for component in missing.reversed() { resolved.appendPathComponent(component) }
        return resolved
    }

    /// Parentheses close an inline destination and quotes open a title, so neither can be
    /// left literal. Percent-encoding rather than the `<...>` form: `%20` survives every
    /// renderer, and it keeps a rewrite shape-stable instead of churning an already-encoded
    /// link into another form.
    private static let destinationAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove(charactersIn: "()<>\"'")
        return set
    }()

    /// The path from `directory` to `target`, the way you would type it: `./a.md`,
    /// `./sub/a.md`, `../other/a.md`. Always relative, always prefixed - a bare `sub/a.md`
    /// reads as a word until you get to the slash.
    static func relativePath(from directory: URL, to target: URL) -> String {
        let from = canonical(directory).pathComponents
        let to = canonical(target).pathComponents

        var shared = 0
        while shared < from.count, shared < to.count, from[shared] == to[shared] {
            shared += 1
        }

        var parts = Array(repeating: "..", count: from.count - shared)
        parts += to[shared...]
        guard !parts.isEmpty else { return "./" }

        let joined = parts
            .map { $0.addingPercentEncoding(withAllowedCharacters: destinationAllowed) ?? $0 }
            .joined(separator: "/")
        return parts[0] == ".." ? joined : "./" + joined
    }

    /// What a file dropped into the raw pane becomes. The link text is the file name with
    /// its extension - the name you dragged is the name you get.
    static func snippet(for target: URL, relativeTo directory: URL) -> String {
        let path = relativePath(from: directory, to: target)
        let name = escapingLinkText(target.lastPathComponent)
        return FileTree.isImage(target) ? "![\(name)](\(path))" : "[\(name)](\(path))"
    }

    private static func escapingLinkText(_ text: String) -> String {
        var escaped = ""
        for character in text {
            if character == "\\" || character == "[" || character == "]" {
                escaped.append("\\")
            }
            escaped.append(character)
        }
        return escaped
    }

    // MARK: - Rewriting

    /// Repoints every inline destination in `text` that resolves to a moved file.
    /// `directory` is the folder `text` was read from - relative destinations are resolved
    /// against it. Returns nil when nothing matched, so a caller never rewrites a file it
    /// did not need to touch.
    ///
    /// The output is assembled forward from the untouched segments between destinations,
    /// so line endings, titles and link text all survive verbatim.
    static func rewriting(
        _ text: String,
        in directory: URL,
        applying moves: [Move]
    ) -> (text: String, count: Int)? {
        guard !moves.isEmpty else { return nil }

        var targets: [String: URL] = [:]
        for move in moves { targets[canonical(move.old).path] = move.new }

        var output = ""
        var cursor = text.startIndex
        var count = 0

        for destination in destinations(in: text) {
            guard let replacement = repointing(destination, in: directory, targets: targets) else { continue }
            output += text[cursor..<destination.range.lowerBound]
            output += replacement
            cursor = destination.range.upperBound
            count += 1
        }

        guard count > 0 else { return nil }
        output += text[cursor...]
        return (output, count)
    }

    /// The replacement for one destination, or nil when it does not point at a moved file.
    private static func repointing(
        _ destination: Destination,
        in directory: URL,
        targets: [String: URL]
    ) -> String? {
        let (body, fragment) = splittingFragment(destination.raw)
        let unescaped = unescaping(body)
        let decoded = unescaped.removingPercentEncoding ?? unescaped

        guard !decoded.isEmpty, !decoded.hasPrefix("//"), !hasScheme(decoded) else { return nil }

        if let url = resolving(decoded, in: directory), let new = targets[url.path] {
            return relativePath(from: directory, to: new) + fragment
        }

        // Editor-style `./app/Foo.swift:14`, tried only after the literal path misses -
        // a colon is a legal character in a file name. Same ordering as MarkdownLinkTarget.
        guard let suffix = decoded.range(of: ":[0-9]+(:[0-9]+)?$", options: .regularExpression),
              let url = resolving(String(decoded[decoded.startIndex..<suffix.lowerBound]), in: directory),
              let new = targets[url.path] else { return nil }

        return relativePath(from: directory, to: new) + decoded[suffix] + fragment
    }

    private static func resolving(_ path: String, in directory: URL) -> URL? {
        guard !path.isEmpty else { return nil }

        if path.hasPrefix("/") { return canonical(URL(fileURLWithPath: path)) }
        if path.hasPrefix("~") { return canonical(URL(fileURLWithPath: (path as NSString).expandingTildeInPath)) }
        // Joined as strings, not with URL(fileURLWithPath:relativeTo:) - that one treats the
        // base's last component as a file and drops it, so `./a.md` next to /work/notes
        // resolves to /work/a.md.
        return canonical(URL(fileURLWithPath: (directory.path as NSString).appendingPathComponent(path)))
    }

    /// `http:`, `mailto:` and friends. Two characters at least before the colon, so a file
    /// called `a` followed by a line number is not mistaken for a URL scheme.
    private static func hasScheme(_ path: String) -> Bool {
        path.range(of: "^[A-Za-z][A-Za-z0-9+.-]+:", options: .regularExpression) != nil
    }

    /// Splits at the first unescaped `#`. The fragment is carried through the rewrite
    /// exactly as written - it is the target's anchor, not ours to re-encode.
    private static func splittingFragment(_ raw: String) -> (body: String, fragment: String) {
        var index = raw.startIndex
        while index < raw.endIndex {
            if raw[index] == "\\" {
                index = raw.index(index, offsetBy: 2, limitedBy: raw.endIndex) ?? raw.endIndex
                continue
            }
            if raw[index] == "#" {
                return (String(raw[raw.startIndex..<index]), String(raw[index...]))
            }
            index = raw.index(after: index)
        }
        return (raw, "")
    }

    private static func unescaping(_ text: String) -> String {
        var result = ""
        var index = text.startIndex
        while index < text.endIndex {
            if text[index] == "\\", text.index(after: index) < text.endIndex {
                index = text.index(after: index)
            }
            result.append(text[index])
            index = text.index(after: index)
        }
        return result
    }

    // MARK: - Scanning

    /// Every inline link and image destination in `text`, in source order.
    ///
    /// Hand-rolled rather than a regular expression, because none of the four things that
    /// have to be right here are regular: link text nests (`[see ![x](a.png)](b.md)`), a
    /// destination can carry balanced parentheses, a code span closes only on a backtick
    /// run of its own length, and fences are line state. A regex gets each of those wrong,
    /// and the failure mode - silently rewriting a link inside a fenced block - is the
    /// worst one a file mover has.
    ///
    /// Deliberately not handled: reference definitions (`[id]: ./x.md`) and four-space
    /// indented code. Inside a list `    [a](b.md)` is an ordinary paragraph line, and
    /// skipping real links is the worse error.
    static func destinations(in text: String) -> [Destination] {
        var found: [Destination] = []
        var fence: (marker: Character, length: Int)?
        var index = text.startIndex
        var atLineStart = true

        while index < text.endIndex {
            if atLineStart {
                let end = text[index...].firstIndex(of: "\n") ?? text.endIndex
                let line = text[index..<end]
                let next = end < text.endIndex ? text.index(after: end) : text.endIndex

                if let open = fence {
                    if closesFence(line, open) { fence = nil }
                    index = next
                    continue
                }
                if let opened = opensFence(line) {
                    fence = opened
                    index = next
                    continue
                }
            }

            let character = text[index]
            atLineStart = character == "\n"

            switch character {
            case "\\":
                index = text.index(index, offsetBy: 2, limitedBy: text.endIndex) ?? text.endIndex

            case "`":
                index = skippingCodeSpan(text, from: index)

            case "[", "!":
                let open = character == "!" ? text.index(after: index) : index
                guard open < text.endIndex, text[open] == "[" else {
                    index = text.index(after: index)
                    continue
                }
                index = scanningLink(text, openingAt: open, isImage: character == "!", into: &found)

            default:
                index = text.index(after: index)
            }
        }

        return found.sorted { $0.range.lowerBound < $1.range.lowerBound }
    }

    /// Handles one `[...](...)`, appending its destination and any nested one, and answers
    /// where scanning resumes. A `[` that turns out not to open a link resumes just after
    /// it, so a stray `](` in prose cannot eat the rest of the file.
    private static func scanningLink(
        _ text: String,
        openingAt open: String.Index,
        isImage: Bool,
        into found: inout [Destination]
    ) -> String.Index {
        let resume = text.index(after: open)

        guard let close = matchingBracket(text, from: open) else { return resume }
        let afterClose = text.index(after: close)
        guard afterClose < text.endIndex, text[afterClose] == "(",
              let parsed = parsingDestination(text, from: afterClose) else { return resume }

        found.append(Destination(range: parsed.range, raw: parsed.raw, isImage: isImage))

        // Link text can hold an image of its own, and that image's destination points at a
        // file like any other. The nested indices belong to the copied substring, so they
        // are carried back as offsets rather than used against `text` directly.
        let inner = String(text[resume..<close])
        for nested in destinations(in: inner) {
            let lower = text.index(resume, offsetBy: inner.distance(from: inner.startIndex, to: nested.range.lowerBound))
            let upper = text.index(resume, offsetBy: inner.distance(from: inner.startIndex, to: nested.range.upperBound))
            found.append(Destination(range: lower..<upper, raw: nested.raw, isImage: nested.isImage))
        }
        return parsed.end
    }

    /// The `]` closing the `[` at `open`, honouring nesting, escapes and code spans.
    private static func matchingBracket(_ text: String, from open: String.Index) -> String.Index? {
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

    /// Parses `(dest)` or `(dest "title")` starting at the opening parenthesis.
    private static func parsingDestination(
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

    private static func skippingSpaces(_ text: String, from index: String.Index) -> String.Index {
        var scan = index
        while scan < text.endIndex, text[scan].isWhitespace { scan = text.index(after: scan) }
        return scan
    }

    private static func skippingTitle(_ text: String, from index: String.Index) -> String.Index {
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

    /// A code span closes on a backtick run of exactly the opening run's length. An
    /// unmatched run is literal text, so scanning resumes right after it.
    private static func skippingCodeSpan(_ text: String, from index: String.Index) -> String.Index {
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

    // MARK: - Fences

    private static func opensFence(_ line: Substring) -> (marker: Character, length: Int)? {
        let body = line.drop { $0 == " " }
        guard line.count - body.count <= 3, let marker = body.first, marker == "`" || marker == "~" else { return nil }

        let length = body.prefix { $0 == marker }.count
        return length >= 3 ? (marker, length) : nil
    }

    private static func closesFence(_ line: Substring, _ fence: (marker: Character, length: Int)) -> Bool {
        let body = line.drop { $0 == " " }
        guard line.count - body.count <= 3 else { return false }

        let run = body.prefix { $0 == fence.marker }
        return run.count >= fence.length && body.dropFirst(run.count).allSatisfy(\.isWhitespace)
    }
}
