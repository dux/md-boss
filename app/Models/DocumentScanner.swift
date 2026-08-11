import Foundation

/// Answers "does this folder contain anything worth showing?" so the sidebar can hide
/// subtrees with no documents in them.
///
/// The answer needs a recursive walk, so it is memoised and every lookup early-exits on the
/// first document found - which is the common case, since a docs folder normally has one
/// near the top.
final class DocumentScanner: @unchecked Sendable {
    static let shared = DocumentScanner()

    /// Entries examined before giving up on a single folder. Hitting it means the folder is
    /// enormous and document-free; the scan then fails open and shows the folder, because
    /// hiding real content is worse than showing an empty one.
    static let budget = 20_000

    private var cache: [String: Bool] = [:]
    private let lock = NSLock()

    func containsDocuments(_ directory: URL, skipFolders: Set<String>) -> Bool {
        let path = directory.path

        lock.lock()
        if let cached = cache[path] {
            lock.unlock()
            return cached
        }
        lock.unlock()

        let result = scan(directory, skipFolders: skipFolders)

        lock.lock()
        cache[path] = result
        lock.unlock()

        return result
    }

    /// A change inside a folder can flip the answer for that folder and every folder above
    /// it (a new .md deep down makes all its ancestors worth showing), and invalidates
    /// everything below it.
    func invalidate(_ directory: URL) {
        let path = directory.path
        lock.lock()
        defer { lock.unlock() }
        cache = cache.filter { cached, _ in
            !(cached == path || cached.hasPrefix(path + "/") || path.hasPrefix(cached + "/"))
        }
    }

    func invalidateAll() {
        lock.lock()
        cache.removeAll()
        lock.unlock()
    }

    /// `skipPackages` is what `.skipsPackageDescendants` bought here before `DirectoryWalk`
    /// took the enumerator's place - a `Foo.app` with a stray .txt inside it is not a folder
    /// worth showing. The search walk never asked for it and still does not.
    private func scan(_ directory: URL, skipFolders: Set<String>) -> Bool {
        DirectoryWalk.containsDocument(
            under: directory.path,
            skipFolders: skipFolders,
            budget: Self.budget,
            skipPackages: true
        )
    }
}
