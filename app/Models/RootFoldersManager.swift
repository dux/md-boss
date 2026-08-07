import Foundation

/// The folders shown at the top level of the sidebar.
///
/// Stored as one absolute path per line so the file stays hand-editable, the same reasoning
/// as file_explorer_swift's `folders.txt`.
@MainActor
final class RootFoldersManager: ObservableObject {
    static let shared = RootFoldersManager()

    @Published private(set) var roots: [URL] = []

    private let file: URL

    /// The `file` parameter is a test hook; production always uses the config directory.
    init(file: URL = AppSettings.configDir.appendingPathComponent("roots.txt")) {
        self.file = file
        roots = Self.read(file)
    }

    // MARK: Active folder

    /// The folder the sidebar is showing. File order is the most-recently-used order, so
    /// the head of the list is the active one - there is no second place to keep it.
    var active: URL? { roots.first }

    /// What the sidebar's select box lists. Older roots stay in the file, they just fall
    /// off the end of the box until they are used again.
    var recent: [URL] { Array(roots.prefix(20)) }

    func select(_ url: URL) {
        guard roots.first?.path != url.standardizedFileURL.path else { return }
        add(url, atTop: true)
    }

    // MARK: Mutation

    /// Adding a folder that is already listed moves it rather than duplicating it, so
    /// opening md-boss with a folder argument reliably surfaces that folder at the top.
    func add(_ url: URL, atTop: Bool = false) {
        let folder = url.standardizedFileURL
        roots.removeAll { $0.path == folder.path }
        if atTop {
            roots.insert(folder, at: 0)
        } else {
            roots.append(folder)
        }
        save()
    }

    func remove(_ url: URL) {
        roots.removeAll { $0.path == url.standardizedFileURL.path }
        save()
    }

    func contains(_ url: URL) -> Bool {
        roots.contains { $0.path == url.standardizedFileURL.path }
    }

    /// The root `url` sits under, if any. Used to reveal a linked file in the tree.
    func root(containing url: URL) -> URL? {
        roots.first { AnnotationPath.isUnder(url, root: $0) }
    }

    // MARK: Persistence

    private static func read(_ file: URL) -> [URL] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { URL(fileURLWithPath: $0).standardizedFileURL }
    }

    private func save() {
        let text = roots.map(\.path).joined(separator: "\n") + "\n"
        let target = file
        Task.detached(priority: .utility) {
            try? FileManager.default.createDirectory(
                at: target.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? text.write(to: target, atomically: true, encoding: .utf8)
        }
    }
}
