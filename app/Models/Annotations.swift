import SwiftUI

// MARK: - Records
//
// Paths are stored tilde-abbreviated (`~/dev/notes/plan.md`) so a `.md-boss` file stays
// readable and survives a different home directory. Line numbers are 1-based.
//
// One note per (path, line): adding over an existing one edits it. That keeps identity
// stable without putting UUIDs in a file meant to be hand-edited.

/// A marked line, with or without something written about it.
///
/// Bookmarks and comments used to be two types with the same two keys and a third field
/// called `title` in one and `body` in the other. They were the same record: a bookmark is
/// a note nothing has been written on yet.
struct Note: Codable, Equatable, Identifiable {
    var path: String
    var line: Int
    /// Taken from the source line when the note is made, so a list of them is scannable
    /// without opening every file. Comments written before the merge have none.
    var title = ""
    /// What you typed. Empty is a plain jump point - what used to be a bookmark.
    var body = ""

    var id: String { "\(path):\(line)" }
    var url: URL { AnnotationPath.expand(path) }

    /// What a row leads with. Old comments have no title, and one cannot be invented
    /// without re-reading the file they point at.
    var label: String { title.isEmpty ? body : title }

    /// What a hover over the line says. A note with no body carries no information beyond
    /// its own existence - its title came off the source line you are already looking at.
    var tooltip: String { body.isEmpty ? "Note on line \(line)" : body }

    var isEmpty: Bool {
        title.isEmpty && body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // Declared, not synthesized: writing both halves of Codable by hand suppresses it.
    enum CodingKeys: String, CodingKey {
        case path
        case line
        case title
        case body
    }

    init(path: String, line: Int, title: String = "", body: String = "") {
        self.path = path
        self.line = line
        self.title = title
        self.body = body
    }

    /// Hand-written because the synthesized decoder does not fall back to a property's
    /// default for a missing key - and that fallback is the whole migration: a `title`-only
    /// object written as a bookmark and a `body`-only one written as a comment both land
    /// here as a Note, with no conversion step in between.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decode(String.self, forKey: .path)
        line = try container.decode(Int.self, forKey: .line)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        body = try container.decodeIfPresent(String.self, forKey: .body) ?? ""
    }

    /// Empty fields are left out rather than written as `""`, so a plain jump point stays a
    /// three-key object in a file meant to be read by a person.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(line, forKey: .line)
        if !title.isEmpty { try container.encode(title, forKey: .title) }
        if !body.isEmpty { try container.encode(body, forKey: .body) }
    }
}

/// The contents of one `.md-boss` file.
struct AnnotationFile: Codable, Equatable {
    var notes: [Note] = []

    var isEmpty: Bool { notes.isEmpty }

    init() {}

    init(notes: [Note]) {
        self.notes = notes
    }

    enum CodingKeys: String, CodingKey {
        case notes
        // Written by builds from before the two were one record. Read, never written.
        case bookmarks
        case comments
    }

    /// Three shapes fold into one array. A line carrying both an old bookmark and an old
    /// comment becomes a single note with a title and a body - which is the merge, and the
    /// one part of it that cannot be undone once the file is written back.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let current = try container.decodeIfPresent([Note].self, forKey: .notes) ?? []
        let bookmarks = try container.decodeIfPresent([Note].self, forKey: .bookmarks) ?? []
        let comments = try container.decodeIfPresent([Note].self, forKey: .comments) ?? []
        notes = Self.fold(current + bookmarks + comments)
    }

    /// Only the current key is written, so a file converts itself the first time anything
    /// in it is touched.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notes, forKey: .notes)
    }

    /// One note per (path, line), first non-empty value winning per field.
    static func fold(_ notes: [Note]) -> [Note] {
        var merged: [String: Note] = [:]
        var order: [String] = []

        for note in notes {
            guard var existing = merged[note.id] else {
                merged[note.id] = note
                order.append(note.id)
                continue
            }
            if existing.title.isEmpty { existing.title = note.title }
            if existing.body.isEmpty { existing.body = note.body }
            merged[note.id] = existing
        }

        return order.compactMap { merged[$0] }.sorted { ($0.path, $0.line) < ($1.path, $1.line) }
    }

    /// Splits the notes on a file that has moved: what stays here, and what has to be
    /// repointed. Nil when nothing in this file pointed at `oldPath`, so a store that is
    /// not involved is never rewritten.
    func repointing(from oldPath: String, to newPath: String) -> (kept: Self, moved: [Note])? {
        guard notes.contains(where: { $0.path == oldPath }) else { return nil }

        var moved: [Note] = []
        var kept: [Note] = []
        for note in notes {
            guard note.path == oldPath else {
                kept.append(note)
                continue
            }
            var repointed = note
            repointed.path = newPath
            moved.append(repointed)
        }
        return (Self(notes: kept), moved)
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

/// The three reaches of the notes pane, nearest first.
enum NoteScope: String, CaseIterable, Identifiable {
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

    /// The open document's notes are the point of the pane, so that scope never folds.
    var isCollapsible: Bool { self != .thisFile }
}

enum NoteSections {
    /// Splits every known note into the three scopes.
    ///
    /// Pure on purpose - the partitioning rules are the part worth testing, and none of them
    /// need a store or a view. `recentRoots` is `RootFoldersManager.recent`: folders past
    /// the twentieth are already unreachable from the sidebar's picker, so they contribute
    /// nothing here either.
    static func partition(
        all: [Note],
        file: URL?,
        activeRoot: URL?,
        recentRoots: [URL]
    ) -> [NoteScope: [Note]] {
        let currentPath = file.map(AnnotationPath.store)
        let otherRoots = recentRoots.filter { root in
            activeRoot.map { !AnnotationPath.isUnder(root, root: $0) } ?? true
        }

        var result: [NoteScope: [Note]] = [:]
        for scope in NoteScope.allCases { result[scope] = [] }

        for note in all {
            let url = note.url

            if let currentPath, note.path == currentPath {
                result[.thisFile]?.append(note)
            } else if let activeRoot, AnnotationPath.isUnder(url, root: activeRoot) {
                result[.thisProject]?.append(note)
            } else if otherRoots.contains(where: { AnnotationPath.isUnder(url, root: $0) }) {
                result[.allProjects]?.append(note)
            }
        }

        return result.mapValues { $0.sorted { ($0.path, $0.line) < ($1.path, $1.line) } }
    }
}

/// Rules that span several `.md-boss` files at once. Pure, so the duplicate case can be
/// tested without a store on disk.
enum NoteStores {
    /// One note per (path, line) across *every* store, not just within one file.
    ///
    /// `AnnotationFile.fold` keeps a single file honest, but nothing used to keep two of them
    /// honest against each other: a file annotated outside every root landed in the fallback,
    /// and once its folder became a root the next write went to the project's own `.md-boss`
    /// instead - leaving one line with a record in each.
    ///
    /// The copies fold together field-wise, the same rule the decoder and `repoint` use, so
    /// nothing anyone typed is dropped. `home` names the store a note *should* be in, and a
    /// contested one goes there when it has a copy to spare - otherwise the project's own
    /// `.md-boss` could lose a note to the fallback on nothing but alphabetical luck, and the
    /// point of a `.md-boss` is that it is committed next to the documents it points at.
    ///
    /// A note sitting on its own is never moved. Stores emptied by the fold still come back
    /// in the result, because the caller has to write them out to finish the repair.
    static func deduplicated(
        _ stores: [String: AnnotationFile],
        preferring home: (Note) -> String? = { _ in nil }
    ) -> [String: AnnotationFile] {
        // Sorted, so the tie-break does not depend on dictionary ordering.
        var copies: [String: [(store: String, note: Note)]] = [:]
        for path in stores.keys.sorted() {
            for note in stores[path]?.notes ?? [] {
                copies[note.id, default: []].append((path, note))
            }
        }

        var merged = stores.mapValues { _ in [Note]() }
        for found in copies.values {
            merged[keeper(among: found, preferring: home), default: []] += found.map(\.note)
        }

        return merged.mapValues { AnnotationFile(notes: AnnotationFile.fold($0)) }
    }

    private static func keeper(
        among found: [(store: String, note: Note)],
        preferring home: (Note) -> String?
    ) -> String {
        guard found.count > 1 else { return found[0].store }
        guard let wanted = home(found[0].note), found.contains(where: { $0.store == wanted }) else {
            return found[0].store
        }
        return wanted
    }
}

// MARK: - Store

/// Notes, kept in a `.md-boss` JSON file at the root of each sidebar folder so they can be
/// committed alongside the documents they point at.
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

    func noteCount(for url: URL?) -> Int {
        guard let url else { return 0 }
        return notes(for: url).count
    }

    // MARK: Reading

    /// Every note across every loaded `.md-boss`, ordered by file then line.
    var notes: [Note] {
        files.values
            .flatMap(\.notes)
            .sorted { ($0.path, $0.line) < ($1.path, $1.line) }
    }

    func notes(for url: URL) -> [Note] {
        let path = AnnotationPath.store(url)
        return files.values
            .flatMap(\.notes)
            .filter { $0.path == path }
            .sorted { $0.line < $1.line }
    }

    /// Every store, not just the one `storeURL` would pick today - that answer moves, and a
    /// lookup that missed is what used to offer "Add Note" on a line that already had one.
    func note(for url: URL, line: Int) -> Note? {
        let path = AnnotationPath.store(url)
        return files.values
            .flatMap(\.notes)
            .first { $0.path == path && $0.line == line }
    }

    /// Asked on every edit in the raw pane, before anything more expensive is done, so a
    /// document nobody has annotated costs nothing to type in.
    func hasNotes(for url: URL) -> Bool {
        let path = AnnotationPath.store(url)
        return files.values.contains { file in file.notes.contains { $0.path == path } }
    }

    /// Line -> hover text for one document. The raw gutter's markers and both panes' hover
    /// all want the same answer, so it is given once here rather than assembled in each pane.
    /// Two `.md-boss` files can name the same (path, line), so the first one wins rather
    /// than trapping.
    func noteTexts(for url: URL?) -> [Int: String] {
        guard let url else { return [:] }
        return Dictionary(notes(for: url).map { ($0.line, $0.tooltip) }, uniquingKeysWith: { first, _ in first })
    }

    // MARK: Writing

    /// A note with neither a title nor a body is removed rather than stored - there would be
    /// nothing to show in the pane and nothing to click. Clearing a body no longer deletes
    /// the note, which is what leaves a plain jump point reachable.
    func setNote(_ url: URL, line: Int, title: String, body: String) {
        mutate(store(forNoteAt: url, line: line)) { file in
            let entry = Note(path: AnnotationPath.store(url), line: line, title: title, body: body)
            file.notes.removeAll { $0.id == entry.id }
            if !entry.isEmpty {
                file.notes.append(entry)
            }
            file.notes.sort { ($0.path, $0.line) < ($1.path, $1.line) }
        }
    }

    func remove(_ note: Note) {
        mutate(store(forNoteAt: note.url, line: note.line)) { file in
            file.notes.removeAll { $0.id == note.id }
        }
    }

    /// Follows an edit in the raw pane, so a note stays on the line it was put on rather
    /// than on the number that line used to have. `NoteShift` holds the rule.
    ///
    /// Written straight through rather than held until the document is saved: adding a note
    /// mid-edit rewrites the whole file anyway, shifted numbers included, so holding them
    /// back would only be half true. The cost of that is that discarding unsaved changes
    /// leaves the notes where the edits put them.
    ///
    /// An external change - a `git pull` under an open file - swaps the whole text and hands
    /// us no edit to follow, so it shifts nothing. Notes keep their line numbers there, the
    /// same as they would for any other tool reading the file.
    func shift(_ url: URL, from old: LineIndex, to new: LineIndex, after edit: NoteShift.Edit) {
        let path = AnnotationPath.store(url)

        // Every store holding a note on this document, not the one `storeURL` names: a note
        // written under a different root still has to follow the text it points at.
        for store in stores(holding: path) {
            mutate(store) { file in
                file.notes = file.notes.map { note in
                    guard note.path == path,
                          let line = NoteShift.line(note.line, from: old, to: new, after: edit) else { return note }
                    var moved = note
                    moved.line = line
                    return moved
                }
                // Deleting a span that held two noted lines lands them both on the line the
                // edit began at. `fold` is the rule for that everywhere else in here.
                file.notes = AnnotationFile.fold(file.notes)
            }
        }
    }

    /// Follows a file the sidebar moved. Written as its own method rather than through
    /// `mutate`, because the destination can be owned by a different `.md-boss` - notes
    /// have to leave one file and land in another, and `mutate` only knows about one.
    func repoint(from old: URL, to new: URL) {
        let oldPath = AnnotationPath.store(old)
        let newPath = AnnotationPath.store(new)
        guard oldPath != newPath else { return }

        let destination = storeURL(for: new)
        var moved: [Note] = []
        var touched: Set<String> = []

        for (path, file) in files {
            guard let split = file.repointing(from: oldPath, to: newPath) else { continue }
            files[path] = split.kept
            moved += split.moved
            touched.insert(path)
        }
        guard !moved.isEmpty else { return }

        var landing = files[destination.path] ?? AnnotationFile()
        landing.notes = AnnotationFile.fold(landing.notes + moved)
        files[destination.path] = landing
        touched.insert(destination.path)

        for path in touched {
            let store = URL(fileURLWithPath: path)
            Self.write(files[path] ?? AnnotationFile(), to: store)
            watcher?.rearm(store)
        }
    }

    // MARK: Files

    /// The `.md-boss` a *new* annotation for `url` belongs in.
    ///
    /// Not necessarily the one an existing note is already in: `root(containing:)` answers
    /// from `roots`, which is MRU-ordered, so nested roots swap places, and a file annotated
    /// before its folder became a root has its note in the fallback. Anything touching a note
    /// that already exists goes through `store(forNoteAt:line:)` instead.
    func storeURL(for url: URL) -> URL {
        guard let root = folders.root(containing: url) else { return Self.fallbackFile }
        return root.appendingPathComponent(Self.fileName)
    }

    /// Where a change to one note has to land: wherever it already lives, or - for a new one -
    /// the store that owns the document. Writing to `storeURL` regardless is what used to put
    /// a second record on a line that already had one.
    private func store(forNoteAt url: URL, line: Int) -> URL {
        let path = AnnotationPath.store(url)
        let owner = files.keys.sorted().first { key in
            files[key]?.notes.contains { $0.path == path && $0.line == line } ?? false
        }
        return owner.map { URL(fileURLWithPath: $0) } ?? storeURL(for: url)
    }

    /// Every loaded store with a note on this document. One, normally.
    private func stores(holding path: String) -> [URL] {
        files.keys.sorted()
            .filter { files[$0]?.notes.contains { $0.path == path } ?? false }
            .map { URL(fileURLWithPath: $0) }
    }

    func reload() {
        let candidates = folders.roots.map { $0.appendingPathComponent(Self.fileName) } + [Self.fallbackFile]

        var loaded: [String: AnnotationFile] = [:]
        for store in candidates {
            guard let file = Self.read(store) else { continue }
            loaded[store.path] = file
        }

        // A contested note goes to the store that owns its document today, so a repair moves
        // it into the project rather than stranding it in the fallback.
        let healed = NoteStores.deduplicated(loaded) { self.storeURL(for: $0.url).path }
        files = healed

        // A repair rather than a view, so it is written back instead of re-done on every
        // launch, and only the stores that actually lost a copy are touched. It converges:
        // the reload our own write provokes finds nothing left to fold.
        for (path, file) in healed where file != loaded[path] {
            Self.write(file, to: URL(fileURLWithPath: path))
        }

        // Only existing files can be watched; a root gains a watcher when its first
        // annotation creates the file.
        watcher?.sync(to: Set(candidates.filter { FileManager.default.fileExists(atPath: $0.path) }))
    }

    private func mutate(_ store: URL, _ change: (inout AnnotationFile) -> Void) {
        var file = files[store.path] ?? AnnotationFile()
        let before = file
        change(&file)
        // An unchanged file is not rewritten. Note shifting runs on every edit in the raw
        // pane and moves nothing on almost all of them.
        guard file != before else { return }
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
