import SwiftUI

// MARK: - Records
//
// Paths are stored tilde-abbreviated (`~/dev/notes/plan.md`) so a `.md-boss` file stays
// readable and survives a different home directory. Line numbers are 1-based.
//
// One bookmark and one comment per (path, line): adding over an existing one edits it.
// That keeps identity stable without putting UUIDs in a file meant to be hand-edited.

struct Bookmark: Codable, Equatable, Identifiable {
    var path: String
    var line: Int
    var title: String

    var id: String { "\(path):\(line)" }
    var url: URL { AnnotationPath.expand(path) }
}

struct Comment: Codable, Equatable, Identifiable {
    var path: String
    var line: Int
    var body: String

    var id: String { "\(path):\(line)" }
    var url: URL { AnnotationPath.expand(path) }
}

/// The contents of one `.md-boss` file.
struct AnnotationFile: Codable, Equatable {
    var bookmarks: [Bookmark] = []
    var comments: [Comment] = []

    var isEmpty: Bool { bookmarks.isEmpty && comments.isEmpty }

    init() {}

    /// Hand-written so a file with only one of the two keys still loads.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bookmarks = try container.decodeIfPresent([Bookmark].self, forKey: .bookmarks) ?? []
        comments = try container.decodeIfPresent([Comment].self, forKey: .comments) ?? []
    }
}

enum AnnotationPath {
    static func store(_ url: URL) -> String {
        (url.standardizedFileURL.path as NSString).abbreviatingWithTildeInPath
    }

    static func expand(_ path: String) -> URL {
        URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    }

    /// Containment on path boundaries, so `/work/notes-old` is not treated as part of
    /// `/work/notes`. Shared with RootFoldersManager rather than written twice.
    static func isUnder(_ url: URL, root: URL) -> Bool {
        let path = url.standardizedFileURL.path
        let rootPath = root.standardizedFileURL.path
        return path == rootPath || path.hasPrefix(rootPath + "/")
    }

    /// First 40 characters of a line, letters, digits and spaces only.
    /// Markdown markers, punctuation and indentation are dropped, so `## The **plan**`
    /// suggests "The plan".
    static func suggestedTitle(from line: String, limit: Int = 40) -> String {
        var kept = ""
        for character in line {
            if character.isLetter || character.isNumber {
                kept.append(character)
            } else if character.isWhitespace || character == "-" || character == "_" {
                // Collapse runs of separators into a single space.
                if kept.last != " " { kept.append(" ") }
            }
        }

        let trimmed = kept.trimmingCharacters(in: .whitespaces)
        return String(trimmed.prefix(limit)).trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - Scopes

/// The three reaches of the comments pane, nearest first.
enum CommentScope: String, CaseIterable, Identifiable {
    case thisFile
    case thisProject
    case allProjects

    var id: String { rawValue }

    var title: String {
        switch self {
        case .thisFile: return "This file"
        case .thisProject: return "This project"
        case .allProjects: return "All projects"
        }
    }

    /// The open document's comments are the point of the pane, so that scope never folds.
    var isCollapsible: Bool { self != .thisFile }
}

enum CommentSections {
    /// Splits every known comment into the three scopes.
    ///
    /// Pure on purpose - the partitioning rules are the part worth testing, and none of them
    /// need a store or a view. `recentRoots` is `RootFoldersManager.recent`: folders past
    /// the tenth are already unreachable from the sidebar's picker, so they contribute
    /// nothing here either.
    static func partition(
        all: [Comment],
        file: URL?,
        activeRoot: URL?,
        recentRoots: [URL]
    ) -> [CommentScope: [Comment]] {
        let currentPath = file.map(AnnotationPath.store)
        let otherRoots = recentRoots.filter { root in
            activeRoot.map { !AnnotationPath.isUnder(root, root: $0) } ?? true
        }

        var result: [CommentScope: [Comment]] = [:]
        for scope in CommentScope.allCases { result[scope] = [] }

        for comment in all {
            let url = comment.url

            if let currentPath, comment.path == currentPath {
                result[.thisFile]?.append(comment)
            } else if let activeRoot, AnnotationPath.isUnder(url, root: activeRoot) {
                result[.thisProject]?.append(comment)
            } else if otherRoots.contains(where: { AnnotationPath.isUnder(url, root: $0) }) {
                result[.allProjects]?.append(comment)
            }
        }

        return result.mapValues { $0.sorted { ($0.path, $0.line) < ($1.path, $1.line) } }
    }
}

// MARK: - Store

/// Bookmarks and inline comments, kept in a `.md-boss` JSON file at the root of each
/// sidebar folder so they can be committed alongside the documents they point at.
/// Anything opened outside every root falls back to one file in the config directory.
@MainActor
final class AnnotationStore: ObservableObject {
    static let shared = AnnotationStore()

    static let fileName = ".md-boss"
    static let fallbackFile = AppSettings.configDir.appendingPathComponent("annotations.json")

    /// Keyed by the `.md-boss` file's path, so a write goes back where it came from.
    @Published private(set) var files: [String: AnnotationFile] = [:]

    private var folders: RootFoldersManager { .shared }
    private var rootsObserver: Task<Void, Never>?
    private var watcher: DirectoryWatcher?

    private init() {
        watcher = DirectoryWatcher { [weak self] _, _ in
            // A `.md-boss` is meant to be hand-editable and committed, so it has to be
            // picked up when it changes under us - after a git pull, say.
            self?.reload()
        }
        reload()

        rootsObserver = Task { [weak self] in
            for await _ in RootFoldersManager.shared.$roots.values {
                self?.reload()
            }
        }
    }

    deinit {
        rootsObserver?.cancel()
    }

    // MARK: Counts, for the pane toggle bar

    var bookmarkCount: Int { files.values.reduce(0) { $0 + $1.bookmarks.count } }

    func commentCount(for url: URL?) -> Int {
        guard let url else { return 0 }
        return comments(for: url).count
    }

    // MARK: Reading

    /// Every bookmark across every root, ordered by file then line.
    var bookmarks: [Bookmark] {
        files.values
            .flatMap(\.bookmarks)
            .sorted { ($0.path, $0.line) < ($1.path, $1.line) }
    }

    /// Every comment across every loaded `.md-boss`, ordered by file then line.
    var allComments: [Comment] {
        files.values
            .flatMap(\.comments)
            .sorted { ($0.path, $0.line) < ($1.path, $1.line) }
    }

    func comments(for url: URL) -> [Comment] {
        let path = AnnotationPath.store(url)
        return files.values
            .flatMap(\.comments)
            .filter { $0.path == path }
            .sorted { $0.line < $1.line }
    }

    func bookmark(for url: URL, line: Int) -> Bookmark? {
        let path = AnnotationPath.store(url)
        return files[storeURL(for: url).path]?.bookmarks.first { $0.path == path && $0.line == line }
    }

    func comment(for url: URL, line: Int) -> Comment? {
        let path = AnnotationPath.store(url)
        return files[storeURL(for: url).path]?.comments.first { $0.path == path && $0.line == line }
    }

    // MARK: Writing

    func addBookmark(_ url: URL, line: Int, title: String) {
        mutate(url) { file in
            let entry = Bookmark(path: AnnotationPath.store(url), line: line, title: title)
            file.bookmarks.removeAll { $0.id == entry.id }
            file.bookmarks.append(entry)
            file.bookmarks.sort { ($0.path, $0.line) < ($1.path, $1.line) }
        }
    }

    func removeBookmark(_ bookmark: Bookmark) {
        mutate(bookmark.url) { file in
            file.bookmarks.removeAll { $0.id == bookmark.id }
        }
    }

    func setComment(_ url: URL, line: Int, body: String) {
        mutate(url) { file in
            let entry = Comment(path: AnnotationPath.store(url), line: line, body: body)
            file.comments.removeAll { $0.id == entry.id }
            if !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                file.comments.append(entry)
            }
            file.comments.sort { ($0.path, $0.line) < ($1.path, $1.line) }
        }
    }

    func removeComment(_ comment: Comment) {
        mutate(comment.url) { file in
            file.comments.removeAll { $0.id == comment.id }
        }
    }

    // MARK: Files

    /// The `.md-boss` that owns annotations for `url`.
    func storeURL(for url: URL) -> URL {
        guard let root = folders.root(containing: url) else { return Self.fallbackFile }
        return root.appendingPathComponent(Self.fileName)
    }

    func reload() {
        let candidates = folders.roots.map { $0.appendingPathComponent(Self.fileName) } + [Self.fallbackFile]

        var loaded: [String: AnnotationFile] = [:]
        for store in candidates {
            guard let file = Self.read(store) else { continue }
            loaded[store.path] = file
        }
        files = loaded

        // Only existing files can be watched; a root gains a watcher when its first
        // annotation creates the file.
        watcher?.sync(to: Set(candidates.filter { FileManager.default.fileExists(atPath: $0.path) }))
    }

    private func mutate(_ url: URL, _ change: (inout AnnotationFile) -> Void) {
        let store = storeURL(for: url)
        var file = files[store.path] ?? AnnotationFile()
        change(&file)
        files[store.path] = file
        Self.write(file, to: store)
        // The atomic write replaced the inode, so the watcher has to be pointed at the
        // new one or the next external edit goes unnoticed.
        watcher?.rearm(store)
    }

    private static func read(_ url: URL) -> AnnotationFile? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(AnnotationFile.self, from: data)
    }

    private static func write(_ file: AnnotationFile, to url: URL) {
        // An emptied file is removed rather than left as `{}` littering the project root.
        guard !file.isEmpty else {
            try? FileManager.default.removeItem(at: url)
            return
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(file) else { return }

        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}
