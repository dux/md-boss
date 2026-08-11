import SwiftUI

/// The sidebar's two search modes and the state behind them.
///
/// The field is permanent chrome, above the folder box and below the pane toggles, and the
/// *query* is what decides whether the tree or a result list is showing. So there is no
/// "search is open" state to get out of step with what you can see: an empty field is the
/// tree, and anything typed into it is a search. `mode` only says which of the two searches
/// that is, and ⇧⌘F / ⌘P set it.
///
/// Not a fourth pane, for the same reason it never was: `PaneToggleBar` fits exactly three
/// segments across a 160pt sidebar, and a pane is *persisted* through `visiblePanes`, which
/// a query must never be.
@MainActor
@Observable
final class SidebarSearch {
    static let shared = SidebarSearch()

    enum Mode: Equatable, Sendable {
        /// Find in project - text across every document under the active root.
        case text
        /// Go to file - names, matched loosely.
        case files

        var placeholder: String {
            switch self {
            case .text: return "Find in project"
            case .files: return "Go to file"
            }
        }
    }

    private(set) var mode: Mode = .text

    /// Bumped by `focus`, and watched by the view so ⇧⌘F puts the caret in the field. A
    /// counter rather than a flag: pressing ⇧⌘F twice has to focus twice, and a flag that is
    /// already true is not a change anything can observe.
    private(set) var focusRequest = 0

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

    /// Walked once when Go to File is first asked for; every keystroke after that filters in
    /// memory, which is microseconds against a few thousand short strings.
    private var candidates: [URL] = []

    /// Whether a result list is showing instead of the tree. The query *is* the answer -
    /// there is no second flag that could disagree with what the field says.
    var isActive: Bool { !query.isEmpty }
    var rowCount: Int { mode == .files ? files.count : hits.count }

    // MARK: Choosing a search

    /// ⇧⌘F and ⌘P. Switches which search the field is doing and puts the caret in it,
    /// deliberately keeping whatever is already typed - swapping modes mid-query is the whole
    /// point of having two of them on one field.
    func focus(_ mode: Mode) {
        if self.mode != mode {
            self.mode = mode
            cursor = 0
        }
        focusRequest += 1
        if mode == .files, candidates.isEmpty { loadCandidates() }
        schedule()
    }

    /// Back to the tree. The mode survives, because it is a preference about the field rather
    /// than part of the query.
    func clear() {
        task?.cancel()
        task = nil
        query = ""
        hits = []
        files = []
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
            let found = ProjectIndex.shared.documents(under: root, skipFolders: skip)
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
