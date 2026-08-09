import SwiftUI

/// The sidebar's two search modes and the state behind them.
///
/// A mode of the sidebar rather than a fourth pane. `PaneToggleBar` fits exactly three
/// segments across a 160pt sidebar - "Preview" already had to become "View" to make three fit
/// - and a pane is *persisted* through `visiblePanes`, which a query must never be. The
/// sidebar already has the shape this needs: `RootPickerBox` takes the tree area over the
/// same way.
@MainActor
@Observable
final class SidebarSearch {
    static let shared = SidebarSearch()

    enum Mode: Equatable, Sendable {
        /// The file tree, which is what the sidebar normally is.
        case tree
        /// Find in project - text across every document under the active root.
        case text
        /// Go to file - names, matched loosely.
        case files

        var placeholder: String {
            switch self {
            case .tree: return ""
            case .text: return "Find in project"
            case .files: return "Go to file"
            }
        }
    }

    private(set) var mode: Mode = .tree

    var query = "" {
        didSet {
            guard query != oldValue else { return }
            cursor = 0
            schedule()
        }
    }

    private(set) var hits: [DocumentSearch.Hit] = []
    private(set) var files: [FuzzyMatch.Ranked] = []
    private(set) var isRunning = false
    private(set) var truncated = false

    /// Which row the keyboard is on.
    var cursor = 0

    /// The detached task itself, not an enclosing one. `Task.detached` does *not* inherit
    /// cancellation, so cancelling a parent would leave this one walking the disk while the
    /// next keystroke started a second walk beside it.
    private var task: Task<Void, Never>?

    /// Walked once when Go to File opens; every keystroke after that filters in memory,
    /// which is microseconds against a few thousand short strings.
    private var candidates: [URL] = []

    var isActive: Bool { mode != .tree }
    var rowCount: Int { mode == .files ? files.count : hits.count }

    // MARK: Opening and closing

    func open(_ mode: Mode) {
        guard mode != .tree else { return close() }
        self.mode = mode
        cursor = 0
        if mode == .files { loadCandidates() }
        schedule()
    }

    func close() {
        task?.cancel()
        task = nil
        mode = .tree
        query = ""
        hits = []
        files = []
        candidates = []
        isRunning = false
        truncated = false
        cursor = 0
    }

    func moveCursor(by step: Int) {
        guard rowCount > 0 else { return }
        cursor = min(max(0, cursor + step), rowCount - 1)
    }

    // MARK: Running

    private func schedule() {
        task?.cancel()
        guard !query.isEmpty else {
            hits = []
            files = []
            isRunning = false
            truncated = false
            return
        }

        switch mode {
        case .tree:
            return
        case .files:
            rankFiles()
        case .text:
            runSearch()
        }
    }

    private func rankFiles() {
        guard let root = RootFoldersManager.shared.active else { return }
        files = FuzzyMatch.rank(
            query,
            candidates: candidates,
            relativeTo: root,
            recent: [AppSettings.shared.lastOpenedFile].compactMap { $0 }
        )
    }

    private func runSearch() {
        guard let root = RootFoldersManager.shared.active else { return }

        let needle = query
        let skip = Set(AppSettings.shared.skipFolders)
        let buffers = unsavedBuffers()
        isRunning = true

        task = Task.detached(priority: .userInitiated) {
            // Debounced inside the task, so a superseded query never reaches the disk at all.
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }

            let result = DocumentSearch.run(
                roots: [root],
                skipFolders: skip,
                query: needle,
                buffers: buffers,
                isCancelled: { Task.isCancelled }
            )
            guard !Task.isCancelled else { return }
            await MainActor.run { Self.shared.accept(result, for: needle) }
        }
    }

    /// A late arrival for a query that has moved on is dropped - belt and braces next to the
    /// cancellation, because a task can finish between the check and the hop to the actor.
    private func accept(_ result: DocumentSearch.Result, for needle: String) {
        guard needle == query else { return }
        hits = result.hits
        truncated = result.truncated
        isRunning = false
        cursor = min(cursor, max(0, result.hits.count - 1))
    }

    private func loadCandidates() {
        guard let root = RootFoldersManager.shared.active else { return }
        let skip = Set(AppSettings.shared.skipFolders)

        Task.detached(priority: .userInitiated) {
            let found = FileTree.documents(under: root, skipFolders: skip)
            await MainActor.run { Self.shared.acceptCandidates(found) }
        }
    }

    private func acceptCandidates(_ found: [URL]) {
        candidates = found
        if mode == .files, !query.isEmpty { rankFiles() }
    }

    /// Searching the disk copy of the file you are looking at would miss what you just typed.
    /// Keyed the way `FileMove.plan` keys the same argument.
    private func unsavedBuffers() -> [String: String] {
        guard let document = MdBossManager.shared.document, document.isDirty else { return [:] }
        return [MarkdownLinks.canonical(document.url).path: document.text]
    }
}
