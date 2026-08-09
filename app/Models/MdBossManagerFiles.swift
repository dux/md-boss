import SwiftUI
import AppKit
import UniformTypeIdentifiers

// Creating a file in the sidebar, moving one out of it, and the reference fix-up that has
// to go with a move. Kept in an extension for the same reason the menu commands are -
// MdBossManager.swift stays about state.
extension MdBossManager {
    // MARK: Creating

    /// Creates an empty document in the active folder and opens it.
    ///
    /// ⌘N and the blank space below the tree both mean that folder: with several subfolders
    /// expanded at once there is no "current" one, and picking the cursor's would be a guess
    /// the user cannot see before the file lands.
    func newFile() {
        guard let root = RootFoldersManager.shared.active else { return }

        guard let typed = PromptPanel.text(
            title: "New File",
            message: "Created in \(root.lastPathComponent)",
            value: "",
            placeholder: "notes.md",
            confirm: "Create"
        ) else { return }

        let url = root.appendingPathComponent(FileTree.documentName(typed))

        guard !FileManager.default.fileExists(atPath: url.path) else {
            showError("\(url.lastPathComponent) already exists")
            return
        }

        do {
            // .withoutOverwriting rather than trusting the check above - the answer can
            // change between asking and writing, and clobbering a file here is silent.
            try Data().write(to: url, options: .withoutOverwriting)
        } catch {
            showError("Could not create \(url.lastPathComponent): \(error.localizedDescription)")
            return
        }

        // The watcher would get there on its own; refreshing now is what puts the row under
        // the cursor at once rather than at kqueue's pace.
        tree.refresh(root)
        open(url, reveal: true)
    }

    // MARK: Moving

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

        relocate(source, to: target, announcing: "Moved \(target.lastPathComponent) to \(destination.lastPathComponent)")
    }

    // MARK: Renaming

    /// Renames a file where it stands, repointing every link to it - a rename is a move that
    /// stays in its folder, so it runs the same rewrite pass rather than a second one.
    ///
    /// Renaming a *folder* is a different change: one rewrite pair per document inside it.
    /// `checkRename` refuses one.
    func rename(_ source: URL) {
        guard let typed = PromptPanel.text(
            title: "Rename",
            message: "In \(source.deletingLastPathComponent().lastPathComponent)",
            value: source.lastPathComponent,
            confirm: "Rename"
        ) else { return }

        // The same defaulting `newFile` applies, for the same reason: a file the tree then
        // hides is the one outcome worth ruling out.
        let name = FileTree.documentName(typed)
        if let refusal = FileMove.checkRename(source, to: name) {
            if let message = refusal.message(forRenaming: source, to: name) { showError(message) }
            return
        }

        let target = source.deletingLastPathComponent().appendingPathComponent(name)
        do {
            try FileManager.default.moveItem(at: source, to: target)
        } catch {
            // Nothing has been written yet, so a failure here leaves the project untouched.
            showError("Could not rename \(source.lastPathComponent): \(error.localizedDescription)")
            return
        }

        relocate(source, to: target, announcing: "Renamed to \(target.lastPathComponent)")
    }

    // MARK: Deleting

    /// Moves a file to the Trash.
    ///
    /// It asks first, because ⌘Z is the editor's and undoes text, not the filesystem - the
    /// Trash is what makes this recoverable, and only Finder can put it back.
    ///
    /// Links to the file are deliberately left alone. `followLink` already says "Not found",
    /// and rewriting other people's documents because one file went is a worse surprise than
    /// a dead link.
    func trash(_ source: URL) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: source.path, isDirectory: &isDirectory) else {
            showError("\(source.lastPathComponent) is no longer there")
            return
        }
        guard !isDirectory.boolValue else {
            showError("Only files can be moved to the Trash")
            return
        }

        let notes = AnnotationStore.shared.notes(for: source).count
        let carried = notes == 0 ? "" : " Its \(notes == 1 ? "note goes" : "\(notes) notes go") with it."
        guard PromptPanel.confirm(
            title: "Move \(source.lastPathComponent) to the Trash?",
            message: "Links to it in other documents are left as they are.\(carried)",
            confirm: "Move to Trash"
        ) else { return }

        do {
            try FileManager.default.trashItem(at: source, resultingItemURL: nil)
        } catch {
            showError("Could not trash \(source.lastPathComponent): \(error.localizedDescription)")
            return
        }

        let removed = AnnotationStore.shared.removeAll(for: source)
        // The open document finds out from its own watcher, which already has the wording
        // for a file that went out from under it - there is no second mechanism here.
        resettle(source.deletingLastPathComponent())

        if cutFile == source { cutFile = nil }
        if draggedFile == source { draggedFile = nil }
        flash(removed == 0
              ? "Moved \(source.lastPathComponent) to the Trash"
              : "Moved \(source.lastPathComponent) to the Trash - \(removed) \(removed == 1 ? "note" : "notes") removed")
    }

    // MARK: The move itself

    /// What a move and a rename share once the file is on its new path. Written once rather
    /// than twice, the same reasoning `acceptDrop` gives for being shared.
    private func relocate(_ source: URL, to target: URL, announcing message: String) {
        followMovedDocument(from: source, to: target)
        AnnotationStore.shared.repoint(from: source, to: target)
        resettleTree(from: source, to: target)

        cutFile = nil
        draggedFile = nil
        flash(message)

        rewriteReferences(from: source, to: target)
    }

    // MARK: The open document

    private func followMovedDocument(from source: URL, to target: URL) {
        guard let document, document.url.standardizedFileURL.path == source.standardizedFileURL.path else { return }

        document.relocate(to: target)
        AppSettings.shared.lastOpenedFile = target.path
    }

    // MARK: The tree

    private func resettleTree(from source: URL, to target: URL) {
        let origin = source.deletingLastPathComponent()
        let destination = target.deletingLastPathComponent()

        resettle(origin)
        // A rename never leaves its folder, so there is only the one to resettle.
        if destination.standardizedFileURL.path != origin.standardizedFileURL.path {
            resettle(destination)
        }
        tree.reveal(target)
    }

    /// A folder whose contents changed. Explicit rather than left to the watcher: a collapsed
    /// folder is not being watched, so its event would never arrive.
    private func resettle(_ folder: URL) {
        DocumentScanner.shared.invalidate(folder)
        tree.refresh(folder)
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
