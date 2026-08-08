import SwiftUI

/// One open file: its text, whether it differs from disk, and what to do when something
/// else changes it underneath us.
@MainActor
final class MarkdownDocument: ObservableObject {
    enum ExternalChange: Equatable {
        /// Changed on disk while we hold unsaved edits.
        case conflict
        /// Deleted or renamed out from under us.
        case detached
    }

    /// Only `relocate(to:)` moves it, and only to follow a file the sidebar just moved.
    private(set) var url: URL

    @Published var text: String
    @Published private(set) var savedText: String
    @Published private(set) var externalChange: ExternalChange?
    /// Not decodable as UTF-8. Shown, never written - re-encoding would destroy the original.
    @Published private(set) var isReadOnly: Bool

    /// Bumped only on open and on an external reload. `MarkdownTextView` pushes the string
    /// into the text view only when this changes, so typing never resets the selection.
    @Published private(set) var reloadToken = UUID()

    var isDirty: Bool { text != savedText }

    /// How often the file is stat'd when kqueue has nothing to say. See `syncWithDisk`.
    private static let pollInterval: Duration = .seconds(2)

    /// Windows line endings are normalised in the buffer and restored on save. Otherwise
    /// every save of a CRLF file is a whole-file diff.
    private let usesCRLF: Bool
    /// The version we are holding, used to tell our own writes from someone else's.
    private var lastKnownStamp: Stamp
    private var watcher: DirectoryWatcher?

    init(url: URL) {
        self.url = url

        let loaded = Self.read(url)
        usesCRLF = loaded.usesCRLF
        isReadOnly = loaded.isReadOnly
        text = loaded.text
        savedText = loaded.text
        lastKnownStamp = Self.stamp(of: url)

        watcher = DirectoryWatcher { [weak self] changed, _ in
            self?.handleWatchEvent(changed)
        }
        watcher?.sync(to: [url])
        startPolling()
    }

    /// Follows the file after the sidebar moved it. The buffer, the undo stack and the
    /// dirty flag are untouched - the only thing that changes is where the next save lands.
    /// Reopening instead would put a save prompt in the middle of a drag and throw all
    /// three away.
    func relocate(to newURL: URL) {
        guard newURL.standardizedFileURL.path != url.standardizedFileURL.path else { return }
        url = newURL
        externalChange = nil
        lastKnownStamp = Self.stamp(of: newURL)
        // Drops the old descriptor, so the rename's own .vanished - which lands after this
        // runs - is discarded rather than raising a "moved or deleted" banner.
        watcher?.sync(to: [newURL])
    }

    // MARK: Saving

    func save() {
        guard !isReadOnly else {
            Toast.shared.error("\(url.lastPathComponent) is read-only")
            return
        }
        guard isDirty else { return }

        let payload = usesCRLF ? text.replacingOccurrences(of: "\n", with: "\r\n") : text

        do {
            try payload.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            Toast.shared.error("Could not save: \(error.localizedDescription)")
            return
        }

        savedText = text
        externalChange = nil
        lastKnownStamp = Self.stamp(of: url)

        // An atomic write renames a new inode into place, so the descriptor we were
        // watching now points at a deleted file. Without this, external-change detection
        // silently stops working after the first save.
        watcher?.rearm(url)

        Toast.shared.success("Saved \(url.lastPathComponent)")
    }

    func revert() {
        reload()
        Toast.shared.info("Reverted to saved")
    }

    /// Takes the version on disk, discarding the buffer.
    func reload() {
        let loaded = Self.read(url)
        text = loaded.text
        savedText = loaded.text
        isReadOnly = loaded.isReadOnly
        externalChange = nil
        lastKnownStamp = Self.stamp(of: url)
        reloadToken = UUID()
        watcher?.rearm(url)
    }

    /// Keeps the buffer and dismisses the banner; the next save overwrites what is on disk.
    /// The recorded version moves forward so the same change is not reported twice.
    func keepMine() {
        externalChange = nil
        lastKnownStamp = Self.stamp(of: url)
    }

    // MARK: External changes

    /// The one place that decides whether the file changed under us and what to do about it.
    ///
    /// kqueue calls it the moment it can. The poll calls it every two seconds because kqueue
    /// cannot see everything: a tool that writes atomically renames a new inode over the path,
    /// which arrives as the *old* one being deleted, and network volumes deliver nothing at all.
    func syncWithDisk() {
        guard FileManager.default.fileExists(atPath: url.path) else {
            externalChange = .detached
            return
        }

        // Something is there, so a `.vanished` was an atomic rewrite rather than a delete.
        // `dispatch` drops the entry on vanish, so `sync` re-adds it; when the entry is still
        // live this is a dictionary lookup and nothing else.
        watcher?.sync(to: [url])

        let current = Self.stamp(of: url)
        guard current != lastKnownStamp else { return }   // that write was ours

        // Nothing to lose - take the new version silently. This is the common case: you
        // edited the file in another editor and came back.
        guard isDirty else {
            reload()
            return
        }

        externalChange = .conflict
    }

    /// The event kind is deliberately ignored: `.vanished` is what an atomic rewrite looks
    /// like, so only the filesystem can say whether the file is really gone.
    private func handleWatchEvent(_ changed: URL) {
        // An event queued against the path we just moved away from says nothing about the
        // file we are now holding.
        guard changed.standardizedFileURL.path == url.standardizedFileURL.path else { return }
        syncWithDisk()
    }

    /// Not stored: the `guard let self` ends the loop a tick after the document is released,
    /// which keeps `deinit` clear of isolated state. `@MainActor` on the class carries into
    /// the task, so the body needs no hop.
    private func startPolling() {
        Task { [weak self] in
            while true {
                try? await Task.sleep(for: Self.pollInterval)
                guard let self else { return }
                self.syncWithDisk()
            }
        }
    }

    // MARK: Reading

    private struct Loaded {
        let text: String
        let usesCRLF: Bool
        let isReadOnly: Bool
    }

    private static func read(_ url: URL) -> Loaded {
        if let raw = try? String(contentsOf: url, encoding: .utf8) {
            let usesCRLF = raw.contains("\r\n")
            return Loaded(
                text: usesCRLF ? raw.replacingOccurrences(of: "\r\n", with: "\n") : raw,
                usesCRLF: usesCRLF,
                isReadOnly: false
            )
        }

        var encoding = String.Encoding.utf8
        if let raw = try? String(contentsOf: url, usedEncoding: &encoding) {
            return Loaded(text: raw, usesCRLF: raw.contains("\r\n"), isReadOnly: true)
        }

        return Loaded(text: "", usesCRLF: false, isReadOnly: true)
    }

    /// Identifies a version of the file on disk. Size as well as mtime because volumes with
    /// one-second timestamp resolution - SMB, some FUSE mounts - hide a rewrite that lands
    /// inside the same second we recorded.
    private struct Stamp: Equatable {
        let modified: Date?
        let size: Int?
    }

    /// `FileManager` rather than `URL.resourceValues`: a URL caches the values it has already
    /// been asked for, so the same instance answers with the file as it was when the document
    /// opened and every later change looks like no change at all.
    private static func stamp(of url: URL) -> Stamp {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return Stamp(
            modified: attributes?[.modificationDate] as? Date,
            size: attributes?[.size] as? Int
        )
    }
}
