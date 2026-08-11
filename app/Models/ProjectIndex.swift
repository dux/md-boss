import Foundation

/// The list of every document under a root, walked once and kept.
///
/// Three passes want that list - Find in Project, Go to File, and the link rewrite after a
/// move - and before this they each walked the whole tree for themselves. Opening Find in
/// Project and then Go to File walked `~/dev` twice for the same answer.
///
/// Which matters because the walk is over half of a search: 330ms over 3,829 documents under
/// `~/dev` even after `DirectoryWalk` took it down from the best part of a second. Cached,
/// that half goes away entirely on the *second* search - and the second search is the one
/// that matters, because it is the one you type while refining a query. Around 1.2s cold and
/// 280ms warm, on a tree that size.
///
/// Shaped after `DocumentScanner`, which memoises the same kind of answer for the sidebar: a
/// lock around a dictionary, no actor, because every caller is already off the main actor and
/// hopping onto one to read a cached array would cost more than the read.
final class ProjectIndex: @unchecked Sendable {
    static let shared = ProjectIndex()

    private struct Entry {
        let skipFolders: Set<String>
        let documents: [URL]
    }

    private var cache: [String: Entry] = [:]
    private let lock = NSLock()

    /// A `FSEventStream` per watched root, so an edit made in another editor does not leave
    /// the index stale.
    private var streams: [String: Stream] = [:]

    // MARK: Reading

    /// Every document under `root`, from the cache when it is warm.
    ///
    /// `skipFolders` is part of the identity of the answer, not just an argument to it -
    /// settings.json is hand-editable while the app runs, and a list walked under the old set
    /// is the wrong list.
    nonisolated func documents(under root: URL, skipFolders: Set<String>) -> [URL] {
        let path = root.path

        lock.lock()
        let cached = cache[path]
        lock.unlock()

        if let cached, cached.skipFolders == skipFolders { return cached.documents }

        let found = FileTree.documents(under: root, skipFolders: skipFolders)

        // Watching starts with the first answer rather than from a call site, so there is no
        // way to hold a cached list nobody is keeping fresh. Built before the lock is taken:
        // starting a stream can deliver an event on another thread immediately, and that
        // event wants this same lock.
        let stream = Stream(root: root) { [weak self] in self?.invalidate(root) }

        lock.lock()
        cache[path] = Entry(skipFolders: skipFolders, documents: found)
        if streams[path] == nil {
            streams[path] = stream
        } else {
            stream.stop()
        }
        lock.unlock()

        return found
    }

    // MARK: Invalidating

    nonisolated func invalidate(_ root: URL) {
        let path = root.path
        lock.lock()
        defer { lock.unlock() }
        // A change anywhere under a root invalidates that root, and a change to a root
        // invalidates any root nested inside it - the same containment rule
        // `DocumentScanner.invalidate` applies.
        cache = cache.filter { cached, _ in
            !(cached == path || cached.hasPrefix(path + "/") || path.hasPrefix(cached + "/"))
        }
    }

    nonisolated func invalidateAll() {
        lock.lock()
        cache.removeAll()
        lock.unlock()
    }

    /// Drops every cached list and stops watching. For tests, which must not leave a stream
    /// running against a temporary directory they are about to delete.
    nonisolated func reset() {
        lock.lock()
        cache.removeAll()
        let running = Array(streams.values)
        streams.removeAll()
        lock.unlock()

        // Outside the lock: `stop` waits for the stream's queue, and a callback already on
        // that queue is on its way to `invalidate`, which wants the lock.
        for stream in running { stream.stop() }
    }

    // MARK: Watching

    /// One `FSEventStream` per root.
    ///
    /// FSEvents here and deliberately not `DirectoryWatcher`. That one is kqueue, which needs
    /// a descriptor per directory and is capped at 128 of them; it cannot cover a project.
    /// The 1-3s coalescing latency that rules FSEvents out for the tree pane is a non-problem
    /// for an index - being late costs one stale search result, and the walk that replaces it
    /// is a third of a second.
    ///
    /// The stream reports which paths changed and is asked for none of them: every event
    /// under the root means the same thing here, so the callback carries no payload and the
    /// stream is created without file-level events.
    private final class Stream: @unchecked Sendable {
        private let queue = DispatchQueue(label: "md-boss.project-index.events", qos: .utility)
        private var stream: FSEventStreamRef?
        private var stopped = false

        init(root: URL, onChange: @escaping () -> Void) {
            // The callback runs on `queue` and reaches its work through this box. It is
            // handed to FSEvents *retained*, and balanced by the context's release callback,
            // because a callback already in flight when the stream is torn down would
            // otherwise be reading a freed object - which is a crash, not a stale answer.
            let box = Box(onChange)
            let info = Unmanaged.passRetained(box).toOpaque()

            var context = FSEventStreamContext(
                version: 0,
                info: info,
                retain: nil,
                release: { info in
                    guard let info else { return }
                    Unmanaged<Box>.fromOpaque(info).release()
                },
                copyDescription: nil
            )

            let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
                guard let info else { return }
                Unmanaged<Box>.fromOpaque(info).takeUnretainedValue().onChange()
            }

            guard let created = FSEventStreamCreate(
                kCFAllocatorDefault,
                callback,
                &context,
                [root.path] as CFArray,
                FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
                1.0,
                UInt32(kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot)
            ) else {
                // `create` failing means the context was never taken, so the retain above has
                // to be given back by hand.
                Unmanaged<Box>.fromOpaque(info).release()
                return
            }

            // Its own queue, not the main one: the callback drops a dictionary entry, and a
            // burst of them during a `git checkout` has no business queueing behind the UI.
            FSEventStreamSetDispatchQueue(created, queue)
            FSEventStreamStart(created)
            stream = created
        }

        /// Safe to call twice, and safe to call while an event is in flight - unsetting the
        /// dispatch queue is what makes FSEvents drain it before invalidation.
        func stop() {
            queue.sync {
                guard !stopped, let stream else { return }
                stopped = true
                FSEventStreamStop(stream)
                FSEventStreamSetDispatchQueue(stream, nil)
                FSEventStreamInvalidate(stream)
                FSEventStreamRelease(stream)
                self.stream = nil
            }
        }

        deinit {
            // Not through `stop()` - `queue.sync` from within a dealloc that the queue itself
            // triggered would deadlock.
            guard !stopped, let stream else { return }
            FSEventStreamStop(stream)
            FSEventStreamSetDispatchQueue(stream, nil)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }

        private final class Box {
            let onChange: () -> Void
            init(_ onChange: @escaping () -> Void) { self.onChange = onChange }
        }
    }
}
