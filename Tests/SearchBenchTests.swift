import Testing
import Foundation
@testable import MdBoss

/// A measuring stick for the search path, because the comments in `DocumentSearch`,
/// `DirectoryWalk` and `ProjectIndex` all make numeric claims and a claim nobody can re-run
/// is a claim that rots.
///
/// Not part of the suite: it needs a real tree and takes seconds, so it does nothing unless
/// `BENCH_ROOT` names a folder. `hammer bench` sets it.
@Suite("Search benchmark", .serialized)
struct SearchBenchTests {
    private static var root: URL? {
        guard let path = ProcessInfo.processInfo.environment["BENCH_ROOT"], !path.isEmpty else { return nil }
        return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    }

    private static var needle: String {
        ProcessInfo.processInfo.environment["BENCH_QUERY"] ?? "kqueue"
    }

    private func ms(_ body: () -> Void) -> Double {
        let start = DispatchTime.now().uptimeNanoseconds
        body()
        return Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    }

    /// The walk `DirectoryWalk` replaced, kept here and nowhere else - the app has no reason
    /// to carry it, and a speedup quoted against a version that no longer exists cannot be
    /// checked.
    ///
    /// Including the top-level split across cores, which the old walk already had. Timing a
    /// serial enumerator against a parallel readdir would credit `DirectoryWalk` with a
    /// speedup that was in the tree before it.
    private func enumeratorWalk(_ root: URL, skip: Set<String>) -> [URL] {
        guard let children = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var subtrees: [URL] = []
        var found: [URL] = []
        for child in children.sorted(by: { $0.path < $1.path }) {
            let isDirectory = (try? child.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory {
                if !skip.contains(child.lastPathComponent) { subtrees.append(child) }
            } else if FileTree.isDocument(child) {
                found.append(child)
            }
        }
        guard !subtrees.isEmpty else { return found }

        // Bound before dispatch, the same as `FileTree.documents`: the closure must capture a
        // value rather than a var it could race on.
        let pending = subtrees
        let collected = Slots(count: pending.count)
        DispatchQueue.concurrentPerform(iterations: pending.count) { index in
            collected.store(enumeratorSubtree(pending[index], skip: skip), at: index)
        }
        return found + collected.flattened
    }

    private func enumeratorSubtree(_ directory: URL, skip: Set<String>) -> [URL] {
        guard let walker = FileManager().enumerator(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var found: [URL] = []
        for case let url as URL in walker {
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory {
                if skip.contains(url.lastPathComponent) { walker.skipDescendants() }
            } else if FileTree.isDocument(url) {
                found.append(url)
            }
        }
        return found
    }

    private final class Slots: @unchecked Sendable {
        private let lock = NSLock()
        private var results: [[URL]]

        init(count: Int) { results = Array(repeating: [], count: count) }

        func store(_ urls: [URL], at index: Int) {
            lock.lock()
            defer { lock.unlock() }
            results[index] = urls
        }

        var flattened: [URL] { results.flatMap { $0 } }
    }

    /// On the main actor only to read `AppSettings.shared.skipFolders` - benchmarking against
    /// a skip list typed out here rather than the one the app actually uses would be the
    /// wrong measurement.
    @MainActor
    @Test("measure the search over BENCH_ROOT")
    func measure() throws {
        guard let root = Self.root else { return }
        let skip = Set(AppSettings.shared.skipFolders)
        let query = Self.needle

        ProjectIndex.shared.reset()
        // Both walks run twice and only the second is reported. The two warm *different*
        // caches - the enumerator's lstat per entry is not something readdir primes - so
        // warming with one and timing the other flatters whichever went second.
        var old: [URL] = []
        var new: [URL] = []
        _ = enumeratorWalk(root, skip: skip)
        _ = FileTree.documents(under: root, skipFolders: skip)
        let oldMs = ms { old = enumeratorWalk(root, skip: skip) }
        let newMs = ms { new = FileTree.documents(under: root, skipFolders: skip) }

        // A benchmark that measures a different set of files is measuring the wrong thing.
        #expect(Set(old.map { $0.resolvingSymlinksInPath().path }) ==
                Set(new.map { $0.resolvingSymlinksInPath().path }))

        ProjectIndex.shared.reset()
        var cold = DocumentSearch.Result.empty
        var warm = DocumentSearch.Result.empty
        let coldMs = ms { cold = DocumentSearch.run(roots: [root], skipFolders: skip, query: query) }
        let warmMs = ms { warm = DocumentSearch.run(roots: [root], skipFolders: skip, query: query) }
        #expect(cold.hits.count == warm.hits.count)

        // The read pass, the two ways round, both on a warm page cache and each run twice.
        // This is the number that says whether `ByteScan` earns its place: everything it
        // saves is a decode it did not have to do, and everything it costs is an mmap it did.
        let needle = ByteScan.Needle(query, caseSensitive: DocumentSearch.isCaseSensitive(query))
        var bytes = 0

        func decodeEverything() -> Int {
            var matched = 0
            for url in new {
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                if !DocumentSearch.matches(in: text, query: query, limit: 1).isEmpty { matched += 1 }
            }
            return matched
        }

        func prescanThenDecode() -> Int {
            var matched = 0
            for url in new {
                guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { continue }
                if let needle, !data.withUnsafeBytes({ needle.mayContain($0) }) { continue }
                guard let text = String(data: data, encoding: .utf8) else { continue }
                if !DocumentSearch.matches(in: text, query: query, limit: 1).isEmpty { matched += 1 }
            }
            return matched
        }

        for url in new { bytes += (try? Data(contentsOf: url).count) ?? 0 }
        _ = decodeEverything()
        _ = prescanThenDecode()
        var decodedFiles = 0
        var prescannedFiles = 0
        let decodeMs = ms { decodedFiles = decodeEverything() }
        let prescanMs = ms { prescannedFiles = prescanThenDecode() }
        #expect(decodedFiles == prescannedFiles)

        print("""

        search benchmark - \(root.path)
          documents             \(new.count)  (\(String(format: "%.1f", Double(bytes) / 1_048_576)) MB)
          walk, enumerator      \(String(format: "%7.1f", oldMs)) ms
          walk, readdir         \(String(format: "%7.1f", newMs)) ms   \
        (\(String(format: "%.1f", oldMs / max(newMs, 0.001)))x)
          read, decode all      \(String(format: "%7.1f", decodeMs)) ms
          read, prescan first   \(String(format: "%7.1f", prescanMs)) ms   \
          (\(String(format: "%.1f", decodeMs / max(prescanMs, 0.001)))x)
          search "\(query)" cold \(String(format: "%7.1f", coldMs)) ms   \(cold.hits.count) hits
          search "\(query)" warm \(String(format: "%7.1f", warmMs)) ms   \(warm.hits.count) hits

        """)

        ProjectIndex.shared.reset()
    }
}
