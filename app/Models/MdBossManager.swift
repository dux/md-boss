import SwiftUI

/// Central app state.
///
/// A singleton rather than a `@StateObject` owned by ContentView, because SwiftUI's
/// `.commands` closures live outside the view hierarchy and cannot read view state -
/// the menu bar has to reach the same instance the views are rendering.
@MainActor
@Observable
final class MdBossManager {
    static let shared = MdBossManager()

    let tree = FileTreeModel()

    private(set) var document: MarkdownDocument?
    /// Heading the preview should scroll to, when the file was reached by a `#anchor` link.
    private(set) var previewAnchor: String?

    /// Caret position in the raw pane, 1-based, plus the text of that line. Notes anchor to
    /// it, and the pane uses it to highlight the entry you are on.
    private(set) var currentLine = 1
    private(set) var currentLineText = ""

    /// A request for the raw pane to scroll to a line. Carries an id so asking for the same
    /// line twice still moves the view.
    private(set) var scrollRequest: ScrollRequest?

    /// The line a note jump landed on. Painted as a band in the raw pane and highlighted in
    /// the preview, until the caret moves off it - so "where did I land" outlives the scroll.
    private(set) var highlightedLine: Int?

    /// The file waiting for a "Move Here". Cleared by Escape in the sidebar and by the move.
    var cutFile: URL?

    /// The row a drag started on, set before the pasteboard has decoded anything. A drop
    /// target has to decide whether to light up while the drag is still in the air, and an
    /// `isTargeted` binding cannot see the payload.
    var draggedFile: URL?

    struct ScrollRequest: Equatable {
        let line: Int
        let id = UUID()
    }

    var selectedFile: URL? { document?.url }

    /// Read straight off the document: a view reading this tracks the document's own text,
    /// so there is nothing to mirror.
    var isDirty: Bool { document?.isDirty ?? false }

    private var settings: AppSettings { AppSettings.shared }
    private var folders: RootFoldersManager { .shared }

    private init() {}

    // MARK: Launch

    /// Restores the last session once the roots have had a chance to list.
    func restoreSession() {
        guard let path = settings.lastOpenedFile else { return }
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: url.path) else {
            settings.lastOpenedFile = nil
            return
        }
        open(url, reveal: true)
    }

    // MARK: Files

    func open(_ url: URL, anchor: String? = nil, reveal: Bool = false) {
        guard FileTree.isDocument(url) else {
            NSWorkspace.shared.open(url)
            return
        }
        guard url != document?.url else {
            // Same file, new anchor - just move within it.
            previewAnchor = anchor
            return
        }
        guard confirmDiscardingChanges() else { return }

        let opened = MarkdownDocument(url: url)
        document = opened
        observeDirtyState(of: opened)
        previewAnchor = anchor
        settings.lastOpenedFile = url.path
        syncWindowEditedState()
        if reveal { tree.reveal(url) }
    }

    /// Returns false when the user cancels. Save is explicit in md-boss, so switching away
    /// from unsaved work has to ask.
    func confirmDiscardingChanges() -> Bool {
        guard let document, document.isDirty else { return true }

        let alert = NSAlert()
        alert.messageText = "Save changes to \(document.url.lastPathComponent)?"
        alert.informativeText = "Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Don't Save")
        alert.addButton(withTitle: "Cancel")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            document.save()
            return !document.isDirty
        case .alertSecondButtonReturn:
            return true
        default:
            return false
        }
    }

    /// Drives the dot in the window's close button.
    func syncWindowEditedState() {
        NSApp.windows.first?.isDocumentEdited = isDirty
    }

    /// The window's dot is an AppKit property, so nothing observes it on our behalf.
    ///
    /// Observation reports once and fires before the value lands, so this reads on the next
    /// turn and re-arms there. A document that is no longer the open one is dropped, which
    /// is also what ends the loop.
    private func observeDirtyState(of document: MarkdownDocument) {
        withObservationTracking {
            _ = document.isDirty
        } onChange: { [weak self, weak document] in
            Task { @MainActor in
                guard let self, let document, self.document === document else { return }
                self.syncWindowEditedState()
                self.observeDirtyState(of: document)
            }
        }
    }

    /// Where a link clicked inside the preview goes.
    func followLink(_ target: MarkdownLinkTarget) {
        switch target {
        case .external(let url):
            NSWorkspace.shared.open(url)

        case .file(let preview):
            guard FileTree.isDocument(preview.url) else {
                NSWorkspace.shared.open(preview.url)
                return
            }
            let isInside = folders.root(containing: preview.url) != nil
            open(preview.url, anchor: preview.fragment, reveal: isInside)
            if !isInside {
                flash("\(preview.url.lastPathComponent) is outside your folders")
            }

        case .directory(let url):
            if folders.root(containing: url) != nil {
                tree.reveal(url)
            } else {
                addRoot(url)
            }

        case .missing(let path):
            showError("Not found: \((path as NSString).lastPathComponent)")
        }
    }

    func revealInFinder(_ url: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    // MARK: Folders

    /// Always added at the top, which is also what makes it active - the folder you just
    /// asked for is the one the sidebar should be showing.
    func addRoot(_ url: URL) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            showError("Not a folder: \(url.lastPathComponent)")
            return
        }

        folders.add(url, atTop: true)
        settings.lastOpenedFolder = url.path
        tree.refresh(url)
        flash("Added \(url.lastPathComponent)")
    }

    func openFolderPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Add Folder"
        panel.message = "Choose folders to show in the sidebar"
        if let last = settings.lastOpenedFolder {
            panel.directoryURL = URL(fileURLWithPath: last)
        }

        guard panel.runModal() == .OK else { return }
        for url in panel.urls { addRoot(url) }
    }

    func openFilePanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.init(filenameExtension: "md") ?? .plainText]
        panel.allowsOtherFileTypes = true
        if let last = settings.lastOpenedFolder {
            panel.directoryURL = URL(fileURLWithPath: last)
        }

        guard panel.runModal() == .OK, let url = panel.url else { return }
        settings.lastOpenedFolder = url.deletingLastPathComponent().path
        open(url, reveal: true)
    }

    /// Entry point for command-line arguments, `open -a`, and Finder drops. A folder
    /// becomes a root; a file is opened and revealed, adding its folder as a root if it
    /// is not already under one.
    func handleExternalOpen(_ url: URL) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            showError("Not found: \(url.lastPathComponent)")
            return
        }

        if isDirectory.boolValue {
            addRoot(url)
            return
        }

        if folders.root(containing: url) == nil {
            folders.add(url.deletingLastPathComponent(), atTop: true)
        }
        open(url, reveal: true)
    }

    /// Asks the raw pane to scroll, and marks the line both panes are heading for. One
    /// mutation point, so the band and the scroll can never disagree about where you landed.
    func requestScroll(to line: Int) {
        highlightedLine = line
        scrollRequest = ScrollRequest(line: line)
    }

    /// Reported by the editor on every selection change.
    ///
    /// `navigated: false` for a whole-text swap - a file arriving in the pane is not the
    /// reader moving off the line a note just pointed at.
    func reportCursor(line: Int, text: String, navigated: Bool = true) {
        currentLineText = text
        if currentLine != line { currentLine = line }
        if navigated, let landed = highlightedLine, landed != line { highlightedLine = nil }
    }

    /// Reported by the preview when a block is right-clicked. It knows the source line from
    /// the block's `data-line` but only holds rendered HTML, so the line's text - which
    /// `addNoteAtCursor` takes a title from - is looked up here.
    func reportCursor(line: Int) {
        let lines = document?.text.components(separatedBy: "\n") ?? []
        let text = line >= 1 && line <= lines.count ? lines[line - 1] : ""
        reportCursor(line: line, text: text)
    }

    // MARK: Clipboard

    func copyPath(_ url: URL) {
        copyText(url.path, label: "Path copied")
    }

    func copyText(_ text: String, label: String = "Copied") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        Toast.shared.success(label)
    }

    // MARK: Messages

    func flash(_ message: String) { Toast.shared.info(message) }

    func showError(_ message: String) { Toast.shared.error(message) }
}
