import Foundation

/// Per-directory kqueue watching, ported from file_explorer_swift's `LocalFileSource.watch`.
///
/// Not FSEvents: its coalescing latency is 1-3 seconds, which reads as lag when you save in
/// another editor and tab back. md-boss only ever watches the small bounded set of expanded
/// directories, which is exactly the granularity kqueue is good at.
@MainActor
final class DirectoryWatcher {
    enum Event {
        /// Something in the directory changed - re-list it.
        case changed
        /// The directory itself was deleted or renamed out from under us.
        case vanished
    }

    /// O_EVTONLY descriptors are real file descriptors. A runaway expansion would exhaust
    /// the process limit, so watching stops here and the UI says so.
    static let maxWatchers = 128

    private var entries: [String: Entry] = [:]
    private let onEvent: (URL, Event) -> Void

    private(set) var isSaturated = false

    init(onEvent: @escaping (URL, Event) -> Void) {
        self.onEvent = onEvent
    }

    deinit {
        // Entry.deinit cancels each source, which closes the descriptor.
    }

    var count: Int { entries.count }

    // MARK: Membership

    /// Watches exactly `urls` - adds what is new, drops what is gone. Called whenever the
    /// set of expanded directories changes.
    func sync(to urls: Set<URL>) {
        let wanted = Set(urls.map(\.path))

        for path in entries.keys where !wanted.contains(path) {
            entries[path] = nil
        }

        for url in urls where entries[url.path] == nil {
            guard entries.count < Self.maxWatchers else {
                isSaturated = true
                return
            }
            entries[url.path] = makeEntry(for: url)
        }

        isSaturated = false
    }

    func unwatchAll() {
        entries.removeAll()
        isSaturated = false
    }

    /// Atomic writes replace the inode via rename(2), so the descriptor we hold is left
    /// watching a deleted file. Every save path must call this or external-change detection
    /// silently stops working after the first save.
    func rearm(_ url: URL) {
        guard entries[url.path] != nil else { return }
        entries[url.path] = makeEntry(for: url)
    }

    // MARK: Internals

    private func makeEntry(for url: URL) -> Entry? {
        let descriptor = open(url.path, O_EVTONLY)
        guard descriptor >= 0 else { return nil }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.delete, .rename, .write, .extend],
            queue: .main
        )

        source.setEventHandler { [weak self] in
            let flags = source.data
            let event: Event = flags.contains(.delete) || flags.contains(.rename) ? .vanished : .changed
            MainActor.assumeIsolated { self?.dispatch(url, event) }
        }
        source.setCancelHandler { close(descriptor) }
        source.resume()

        return Entry(source: source)
    }

    /// A `git checkout` or a build tool fires dozens of events in a burst; re-listing on
    /// each one would make the tree flicker and lose the cursor.
    private func dispatch(_ url: URL, _ event: Event) {
        guard let entry = entries[url.path] else { return }

        if event == .vanished {
            entries[url.path] = nil
            onEvent(url, .vanished)
            return
        }

        entry.debounce?.cancel()
        entry.debounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            self?.onEvent(url, .changed)
        }
    }

    private final class Entry {
        let source: DispatchSourceFileSystemObject
        var debounce: Task<Void, Never>?

        init(source: DispatchSourceFileSystemObject) {
            self.source = source
        }

        deinit {
            debounce?.cancel()
            source.cancel()
        }
    }
}
