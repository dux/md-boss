import SwiftUI
import AppKit
import UniformTypeIdentifiers

// Moving a file out of the sidebar, and the reference fix-up that has to go with it.
// Kept in an extension for the same reason the menu commands are - MdBossManager.swift
// stays about state.
extension MdBossManager {
    /// Whether a drop on `destination` would do anything. Drives the highlight, so it must
    /// be cheap and must not complain about anything.
    func canMove(_ source: URL, into destination: URL) -> Bool {
        FileMove.check(source, into: destination) == nil
    }

    /// A row dropped on a folder. Shared by the tree and the root box rather than written
    /// twice, and deliberately limited to a drag that started in the sidebar - a file
    /// dragged in from Finder should not be moved out of wherever it lives.
    func acceptDrop(_ providers: [NSItemProvider], into destination: URL) -> Bool {
        guard let provider = providers.first, draggedFile != nil else { return false }

        _ = provider.loadDataRepresentation(for: .fileURL) { data, _ in
            guard let data, let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
            Task { @MainActor in
                let manager = MdBossManager.shared
                // SwiftUI reports no drag end, so a drag that was abandoned leaves
                // `draggedFile` behind. Clearing it here is what stops the next drop from
                // being judged against a file nobody is holding.
                let dragged = manager.draggedFile
                manager.draggedFile = nil
                guard dragged?.standardizedFileURL.path == url.standardizedFileURL.path else { return }
                manager.move(url, into: destination)
            }
        }
        return true
    }

    func moveCut(into destination: URL) {
        guard let source = cutFile else { return }
        move(source, into: destination)
    }

    /// Moves `source` into `destination` and repoints every link to it under the active
    /// root, notes included.
    ///
    /// The move is not undoable - Cmd-Z is the editor's, and it undoes text, not the
    /// filesystem.
    func move(_ source: URL, into destination: URL) {
        if let refusal = FileMove.check(source, into: destination) {
            if let message = refusal.message(for: source, into: destination) { showError(message) }
            if refusal == .missingSource || refusal == .sameFolder { cutFile = nil }
            return
        }

        let target = destination.appendingPathComponent(source.lastPathComponent)
        do {
            try FileManager.default.moveItem(at: source, to: target)
        } catch {
            // Nothing has been written yet, so a failure here leaves the project untouched
            // and the cut file still queued for another try.
            showError("Could not move \(source.lastPathComponent): \(error.localizedDescription)")
            return
        }

        followMovedDocument(from: source, to: target)
        AnnotationStore.shared.repoint(from: source, to: target)
        resettleTree(from: source, to: target)

        cutFile = nil
        draggedFile = nil
        flash("Moved \(target.lastPathComponent) to \(destination.lastPathComponent)")

        rewriteReferences(from: source, to: target)
    }

    // MARK: The open document

    private func followMovedDocument(from source: URL, to target: URL) {
        guard let document, document.url.standardizedFileURL.path == source.standardizedFileURL.path else { return }

        document.relocate(to: target)
        AppSettings.shared.lastOpenedFile = target.path
        // `selectedFile` is computed off the document, and a document that only changed its
        // URL republishes nothing - the sidebar highlight and the status bar read it.
        objectWillChange.send()
    }

    // MARK: The tree

    private func resettleTree(from source: URL, to target: URL) {
        let origin = source.deletingLastPathComponent()
        let destination = target.deletingLastPathComponent()

        DocumentScanner.shared.invalidate(origin)
        DocumentScanner.shared.invalidate(destination)
        tree.refresh(origin)
        tree.refresh(destination)
        // Both refreshes are explicit rather than left to the watcher: a collapsed
        // destination folder is not being watched, so its event would never arrive.
        tree.reveal(target)
    }

    // MARK: The rewrite pass

    /// Reads and rewrites off the main actor. A project of any size is a few hundred files
    /// to open, and a drop that freezes the sidebar while it thinks reads as a broken drag.
    private func rewriteReferences(from source: URL, to target: URL) {
        guard let root = RootFoldersManager.shared.active else { return }

        let moves = [MarkdownLinks.Move(old: source, new: target)]
        let skip = Set(AppSettings.shared.skipFolders)
        // The moved file's own outbound links are out of scope, and excluding it is how
        // that is enforced rather than merely left undone.
        let excluded: Set<String> = [MarkdownLinks.canonical(target).path]
        // Unsaved edits win over what is on disk, or the rewrite would be computed against
        // a stale copy and then written back over the user's work.
        let buffers: [String: String] = {
            guard let document, document.isDirty else { return [:] }
            return [MarkdownLinks.canonical(document.url).path: document.text]
        }()

        Task { [weak self] in
            let rewrites = await Task.detached(priority: .userInitiated) {
                FileMove.plan(
                    root: root,
                    skipFolders: skip,
                    moves: moves,
                    buffers: buffers,
                    excluding: excluded
                )
            }.value

            self?.apply(rewrites)
        }
    }

    private func apply(_ rewrites: [FileMove.Rewrite]) {
        guard !rewrites.isEmpty else { return }

        var links = 0
        var files = 0
        var unsaved = 0
        var failed = 0

        for rewrite in rewrites {
            // The splice only replaces destination tokens, so a CRLF file stays CRLF -
            // the opposite of MarkdownDocument.save, which rebuilds the line endings.
            if let document, document.url.standardizedFileURL.path == rewrite.url.standardizedFileURL.path {
                if document.isDirty {
                    // Saving someone's unsaved work to fix a link is worse than the link.
                    document.text = rewrite.text
                    unsaved += 1
                } else if write(rewrite) {
                    // Only a reloadToken change pushes new text into the view.
                    document.reload()
                } else {
                    failed += 1
                    continue
                }
            } else if !write(rewrite) {
                failed += 1
                continue
            }

            links += rewrite.count
            files += 1
        }

        report(links: links, files: files, unsaved: unsaved, failed: failed)
    }

    private func write(_ rewrite: FileMove.Rewrite) -> Bool {
        do {
            try rewrite.text.write(to: rewrite.url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    private func report(links: Int, files: Int, unsaved: Int, failed: Int) {
        guard failed == 0 else {
            // The move is the durable part; a stale link is visible and re-fixable, which
            // is exactly why this has to say so rather than claim success.
            showError("Moved, but \(failed) \(failed == 1 ? "file" : "files") could not be updated")
            return
        }
        guard files > 0 else { return }

        let counted = "Updated \(links) \(links == 1 ? "link" : "links") in \(files) \(files == 1 ? "file" : "files")"
        flash(unsaved > 0 ? "\(counted) - \(unsaved) unsaved" : counted)
    }
}
