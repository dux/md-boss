import SwiftUI

// MARK: - Nodes

struct FileNode: Identifiable, Equatable, Sendable {
    let url: URL
    let isDirectory: Bool

    var id: String { url.path }
    var name: String { url.lastPathComponent }
}

/// One visible line in the sidebar. The tree is flattened rather than nested so keyboard
/// navigation is index arithmetic and expansion state is one `Set<String>` of paths.
struct FlatRow: Identifiable, Equatable {
    let node: FileNode
    let depth: Int
    /// Directory we were not allowed to read. Non-sandboxed still means TCC prompts for
    /// ~/Desktop, ~/Documents and ~/Downloads, and "denied" must not look like "empty".
    let isDenied: Bool

    var id: String { node.id }
}

/// Which renderer a document gets. Derived from the extension in one place, because the
/// pane picker, the raw pane's highlighting and the scroll memory all have to agree - three
/// separate answers to "is this markdown" is three chances to drift.
enum DocumentKind: Sendable {
    case markdown
    /// Delimited text, drawn as a table by `CSVTable` and the csv page. Not markdown at all:
    /// a comma is not emphasis and a row is not a paragraph.
    case csv
}

// MARK: - Listing (pure, off-actor)

enum FileTree {
    /// What the sidebar lists and the document panes open. Plain text goes through the same
    /// markdown pipeline - a .txt is just markdown that mostly turns into paragraphs - while
    /// .csv gets the table renderer instead. See `DocumentKind`.
    static let documentExtensions: Set<String> = [
        "md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "qmd", "rmd", "txt", "csv"
    ]

    /// The extensions that are drawn as a table rather than as prose.
    static let tableExtensions: Set<String> = ["csv"]

    static func isDocument(_ url: URL) -> Bool {
        documentExtensions.contains(url.pathExtension.lowercased())
    }

    static func kind(of url: URL) -> DocumentKind {
        tableExtensions.contains(url.pathExtension.lowercased()) ? .csv : .markdown
    }

    /// The name a typed file name is created under. Anything the sidebar would not list
    /// becomes markdown - creating a file the tree then hides is the one outcome here
    /// worth ruling out.
    static func documentName(_ typed: String) -> String {
        isDocument(URL(fileURLWithPath: typed)) ? typed : typed + ".md"
    }

    /// What the preview can serve through `previewfile://`, and therefore what a drop into
    /// the raw pane writes as `![...]` rather than `[...]`. The sidebar still lists only
    /// documents, so this is reached by dragging in from Finder.
    static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "svg", "avif"
    ]

    static func isImage(_ url: URL) -> Bool {
        imageExtensions.contains(url.pathExtension.lowercased())
    }

    enum Listing: Sendable {
        case entries([FileNode])
        case denied
        case missing
    }

    /// Runs off the main actor - a cold iCloud or network folder blocks for seconds, and a
    /// subfolder's document scan walks its whole subtree.
    nonisolated static func list(_ directory: URL, skipFolders: Set<String>) -> Listing {
        let keys: [URLResourceKey] = [.isDirectoryKey]
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            // The same throw covers "gone" and "not allowed", and the sidebar has to say
            // something different for each - so ask, but only on the failure path.
            return FileManager.default.fileExists(atPath: directory.path) ? .denied : .missing
        }

        let nodes = contents.compactMap { url -> FileNode? in
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory {
                guard !skipFolders.contains(url.lastPathComponent),
                      DocumentScanner.shared.containsDocuments(url, skipFolders: skipFolders) else { return nil }
            } else {
                guard isDocument(url) else { return nil }
            }
            return FileNode(url: url, isDirectory: isDirectory)
        }

        return .entries(sorted(nodes))
    }

    /// Every document below `directory`, however deep. `list` answers one level and hides
    /// folders; this one is for the passes that have to read the whole project - rewriting
    /// links after a move, and searching.
    ///
    /// Split at the top level and walked one subtree per core, because the walk *is* the cost
    /// of a search. Reading and searching the documents it finds is noise beside it, which is
    /// why nothing downstream of here is parallel.
    ///
    /// The per-entry work is `DirectoryWalk`, which is `readdir(3)` rather than
    /// `FileManager.enumerator` - see there for why. Everything below stays as it was: the
    /// split at the top level, one subtree per core, and results kept in slot order so the
    /// same tree always answers the same way and search results do not shuffle between
    /// keystrokes.
    nonisolated static func documents(under directory: URL, skipFolders: Set<String>) -> [URL] {
        let root = directory.path
        var subtrees: [String] = []
        var found: [String] = []

        // Only the top level is listed here; the split needs to know the subtrees before it
        // can hand one to each core.
        DirectoryWalk.children(of: root, skipFolders: skipFolders) { name, isDirectory in
            if isDirectory { subtrees.append(name) } else { found.append(root + "/" + name) }
        }
        found.sort()
        subtrees.sort()

        guard !subtrees.isEmpty else { return found.map { URL(fileURLWithPath: $0) } }

        // Bound before dispatch: the closure must capture a value, not a var it could race on.
        let pending = subtrees.map { root + "/" + $0 }
        let collected = Subtrees(count: pending.count)
        DispatchQueue.concurrentPerform(iterations: pending.count) { index in
            collected.store(
                DirectoryWalk.documents(under: pending[index], skipFolders: skipFolders),
                at: index
            )
        }
        return (found + collected.flattened).map { URL(fileURLWithPath: $0) }
    }

    /// Each subtree owns its own slot, so the lock only orders the writes rather than
    /// serialising the walks.
    private final class Subtrees: @unchecked Sendable {
        private let lock = NSLock()
        private var results: [[String]]

        init(count: Int) {
            results = Array(repeating: [], count: count)
        }

        func store(_ paths: [String], at index: Int) {
            lock.lock()
            defer { lock.unlock() }
            results[index] = paths
        }

        var flattened: [String] { results.flatMap { $0 } }
    }

    /// Folders first, then Finder's natural order - `9.md` before `10.md`.
    nonisolated static func sorted(_ nodes: [FileNode]) -> [FileNode] {
        nodes.sorted { lhs, rhs in
            if lhs.isDirectory != rhs.isDirectory { return lhs.isDirectory }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    /// Walks the active root's contents, descending only into expanded directories, so the
    /// cost is proportional to the number of visible rows rather than the size of the tree.
    ///
    /// The root itself is never a row - the sidebar names it in the select box above the
    /// tree and dives straight into its contents, which is why it is implicitly expanded.
    static func flatten(
        root: URL?,
        children: [String: [FileNode]],
        expanded: Set<String>,
        denied: Set<String>
    ) -> [FlatRow] {
        guard let root else { return [] }
        var rows: [FlatRow] = []

        func append(_ node: FileNode, depth: Int) {
            rows.append(FlatRow(node: node, depth: depth, isDenied: denied.contains(node.id)))

            guard node.isDirectory, expanded.contains(node.id) else { return }
            for child in children[node.id] ?? [] {
                append(child, depth: depth + 1)
            }
        }

        for child in children[root.path] ?? [] {
            append(child, depth: 0)
        }
        return rows
    }
}

// MARK: - Model

@MainActor
@Observable
final class FileTreeModel {
    private(set) var rows: [FlatRow] = []
    var cursor = 0

    private let folders: RootFoldersManager
    private let settings = AppSettings.shared

    private var children: [String: [FileNode]] = [:]
    private var denied: Set<String> = []
    private var missing: Set<String> = []
    private var expanded: Set<String> = []
    private var listing: Set<String> = []

    private var watcher: DirectoryWatcher?
    /// What the last rebuild was showing, so switching folders can reset the cursor.
    private var lastActive: String?
    /// Long, because this is a backstop and not the mechanism: kqueue already answers a local
    /// change in milliseconds, and anything this catches has been wrong for a while already.
    private static let pollInterval: Duration = .seconds(30)
    /// A reveal target whose row has not been listed yet.
    private var pendingReveal: URL?

    var watchersSaturated: Bool { watcher?.isSaturated ?? false }

    /// The active folder is unreachable - an unmounted drive, or renamed in Finder.
    var activeIsMissing: Bool { folders.active.map { missing.contains($0.path) } ?? false }

    var activeIsDenied: Bool { folders.active.map { denied.contains($0.path) } ?? false }

    init(folders: RootFoldersManager = .shared) {
        self.folders = folders
        expanded = Set(settings.expandedPaths)

        watcher = DirectoryWatcher { [weak self] url, event in
            self?.handleWatchEvent(url, event)
        }

        observeRoots()
        startPolling()
    }

    /// Re-lists what is on screen every 30 seconds, whether or not anything said to.
    ///
    /// The tree is watched with kqueue, which needs a descriptor per directory and gives up
    /// past `DirectoryWatcher`'s cap - `watchersSaturated` is that already happening. It also
    /// sees nothing at all on a network volume, and a file synced in by Dropbox or an
    /// `rsync` from another machine arrives with no event of any kind. A sidebar that is
    /// quietly a few minutes stale is worse than one that costs a `readdir` every half minute.
    ///
    /// Nothing about this is visible when nothing changed: `refresh` merges rather than
    /// replaces, and `rebuild` only publishes `rows` when the rows actually differ - so a
    /// poll over an unchanged folder ends without SwiftUI being told anything at all.
    ///
    /// The same shape as `MarkdownDocument.startPolling`, and for the same reason: the loop
    /// holds `self` weakly, so the last release of the model ends it a tick later.
    private func startPolling() {
        Task { [weak self] in
            while true {
                try? await Task.sleep(for: Self.pollInterval)
                guard let self else { return }
                self.refreshAll()
            }
        }
    }

    /// Builds the tree for the folders as they stand, and again after every change to them.
    ///
    /// Observation reports once and fires before the new value lands, so the list is read on
    /// the next turn and tracking is re-armed there. The weak self is what ends the loop:
    /// the last release of the model is the last re-arm.
    private func observeRoots() {
        rootsChanged(folders.roots)

        withObservationTracking {
            _ = folders.roots
        } onChange: { [weak self] in
            Task { @MainActor in self?.observeRoots() }
        }
    }

    // MARK: Expansion

    func isExpanded(_ node: FileNode) -> Bool { expanded.contains(node.id) }

    func toggle(_ node: FileNode) {
        guard node.isDirectory else { return }
        if expanded.contains(node.id) {
            collapse(node)
        } else {
            expand(node)
        }
    }

    func expand(_ node: FileNode) {
        guard node.isDirectory, !expanded.contains(node.id) else { return }
        expanded.insert(node.id)
        persistExpansion()
        refresh(node.url)
        rebuild()
    }

    func collapse(_ node: FileNode) {
        guard expanded.remove(node.id) != nil else { return }
        persistExpansion()
        rebuild()
    }

    /// Expands every ancestor of `url` under its root, so a followed link can be revealed.
    /// A link into a different root switches the sidebar to it first.
    func reveal(_ url: URL) {
        guard let root = folders.root(containing: url) else { return }
        folders.select(root)

        var ancestors: [URL] = []
        var current = url.standardizedFileURL.deletingLastPathComponent()
        // The root is implicitly expanded, so stop one level below it.
        while current.path.hasPrefix(root.path + "/") {
            ancestors.append(current)
            current = current.deletingLastPathComponent()
        }

        refresh(root)
        for directory in ancestors.reversed() {
            expanded.insert(directory.path)
            refresh(directory)
        }
        persistExpansion()
        // Listing is async, so the row may not exist yet - rebuild() retries until it does.
        pendingReveal = url.standardizedFileURL
        rebuild()
    }

    // MARK: Cursor

    func moveCursor(to url: URL) {
        guard let index = rows.firstIndex(where: { $0.id == url.standardizedFileURL.path }) else { return }
        cursor = index
    }

    var cursorRow: FlatRow? { rows.indices.contains(cursor) ? rows[cursor] : nil }

    // MARK: Listing

    /// Lists a directory off the main actor and merges the result in. Merging rather than
    /// replacing keeps the cursor and any expanded subfolders in place when a build tool
    /// touches the folder.
    func refresh(_ directory: URL) {
        let path = directory.path
        guard !listing.contains(path) else { return }
        listing.insert(path)

        let skip = Set(settings.skipFolders)
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                FileTree.list(directory, skipFolders: skip)
            }.value

            guard let self else { return }
            self.listing.remove(path)

            switch result {
            case .entries(let nodes):
                self.denied.remove(path)
                self.missing.remove(path)
                self.children[path] = nodes
                // Drop expansion for subfolders that no longer exist.
                let names = Set(nodes.filter(\.isDirectory).map(\.id))
                self.expanded = self.expanded.filter { expandedPath in
                    guard expandedPath.hasPrefix(path + "/") else { return true }
                    let relative = expandedPath.dropFirst(path.count + 1)
                    guard !relative.contains("/") else { return true }
                    return names.contains(expandedPath)
                }
            case .denied:
                self.denied.insert(path)
                self.missing.remove(path)
                self.children[path] = []

            case .missing:
                self.denied.remove(path)
                self.missing.insert(path)
                self.children[path] = []
            }

            self.rebuild()
        }
    }

    func refreshAll() {
        guard let active = folders.active else { return }
        refresh(active)
        for path in expanded where path.hasPrefix(active.path + "/") {
            refresh(URL(fileURLWithPath: path))
        }
    }

    // MARK: Internals

    /// Only the active root is listed - the others cost nothing until they are picked.
    private func rootsChanged(_ roots: [URL]) {
        if let active = roots.first, children[active.path] == nil {
            refresh(active)
        }
        rebuild()
    }

    private func rebuild() {
        let active = folders.active
        // Which file the cursor is on, not which line - a row appearing above it shifts every
        // index below, and the poll makes that something that can happen while you are simply
        // reading. Re-anchoring is what "silently" has to mean: the keyboard stays where you
        // put it whether or not the list moved under it.
        let anchor = cursorRow?.id
        let flattened = FileTree.flatten(
            root: active,
            children: children,
            expanded: expanded,
            denied: denied
        )

        // Assigning an identical array is not free even when Observation declines to report
        // it - `rows` feeds a `ForEach` and the comparison here is one pass over what the
        // sidebar is already holding.
        if rows != flattened { rows = flattened }

        let target: Int
        if active?.path != lastActive {
            target = 0
        } else if let anchor, let moved = rows.firstIndex(where: { $0.id == anchor }) {
            target = moved
        } else {
            // The row itself is gone - deleted, or collapsed into a folder above it. Holding
            // the index keeps the cursor where it was on screen, which is what a list does
            // when the thing under it disappears.
            target = min(cursor, max(0, rows.count - 1))
        }
        lastActive = active?.path
        if cursor != target { cursor = target }

        if let target = pendingReveal, rows.contains(where: { $0.id == target.path }) {
            pendingReveal = nil
            moveCursor(to: target)
        }

        syncWatchers()
    }

    private func syncWatchers() {
        guard let active = folders.active else {
            watcher?.sync(to: [])
            return
        }

        var targets: Set<URL> = [active]
        for path in expanded where children[path] != nil && path.hasPrefix(active.path + "/") {
            targets.insert(URL(fileURLWithPath: path))
        }
        watcher?.sync(to: targets)
    }

    private func handleWatchEvent(_ url: URL, _ event: DirectoryWatcher.Event) {
        switch event {
        case .changed:
            // A new document deep in a subtree can make ancestors worth showing, so the
            // "contains documents" answer has to be dropped for this path and its line -
            // and the search index, which has just gained or lost a file.
            DocumentScanner.shared.invalidate(url)
            ProjectIndex.shared.invalidate(url)
            refresh(url)
        case .vanished:
            // A root is dimmed rather than dropped - the drive may just be unmounted.
            if folders.contains(url) {
                missing.insert(url.path)
                children[url.path] = []
            } else {
                children[url.path] = nil
                expanded.remove(url.path)
            }
            rebuild()
        }
    }

    private func persistExpansion() {
        // Capped so a runaway browsing session cannot bloat settings.json.
        settings.expandedPaths = Array(expanded.sorted().prefix(500))
    }
}
