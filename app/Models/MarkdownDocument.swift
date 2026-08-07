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

    let url: URL

    @Published var text: String
    @Published private(set) var savedText: String
    @Published private(set) var externalChange: ExternalChange?
    /// Not decodable as UTF-8. Shown, never written - re-encoding would destroy the original.
    @Published private(set) var isReadOnly: Bool

    /// Bumped only on open and on an external reload. `MarkdownTextView` pushes the string
    /// into the text view only when this changes, so typing never resets the selection.
    @Published private(set) var reloadToken = UUID()

    var isDirty: Bool { text != savedText }

    /// Windows line endings are normalised in the buffer and restored on save. Otherwise
    /// every save of a CRLF file is a whole-file diff.
    private let usesCRLF: Bool
    /// The mtime of our own last write, used to tell our changes from someone else's.
    private var lastKnownModDate: Date?
    private var watcher: DirectoryWatcher?

    init(url: URL) {
        self.url = url

        let loaded = Self.read(url)
        usesCRLF = loaded.usesCRLF
        isReadOnly = loaded.isReadOnly
        text = loaded.text
        savedText = loaded.text
        lastKnownModDate = Self.modificationDate(of: url)

        watcher = DirectoryWatcher { [weak self] _, event in
            self?.handleWatchEvent(event)
        }
        watcher?.sync(to: [url])
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
        lastKnownModDate = Self.modificationDate(of: url)

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
        lastKnownModDate = Self.modificationDate(of: url)
        reloadToken = UUID()
        watcher?.rearm(url)
    }

    /// Keeps the buffer and dismisses the banner; the next save overwrites what is on disk.
    /// The recorded mtime moves forward so the same change is not reported twice.
    func keepMine() {
        externalChange = nil
        lastKnownModDate = Self.modificationDate(of: url)
    }

    // MARK: External changes

    private func handleWatchEvent(_ event: DirectoryWatcher.Event) {
        guard event == .changed else {
            externalChange = .detached
            return
        }

        let current = Self.modificationDate(of: url)
        guard current != lastKnownModDate else { return }   // that write was ours

        // Nothing to lose - take the new version silently. This is the common case: you
        // edited the file in another editor and came back.
        guard isDirty else {
            reload()
            return
        }

        externalChange = .conflict
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

    private static func modificationDate(of url: URL) -> Date? {
        try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
    }
}
