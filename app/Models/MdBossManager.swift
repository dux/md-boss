import SwiftUI
import Combine

/// Central app state.
///
/// A singleton rather than a `@StateObject` owned by ContentView, because SwiftUI's
/// `.commands` closures live outside the view hierarchy and cannot read view state -
/// the menu bar has to reach the same instance the views are rendering.
@MainActor
final class MdBossManager: ObservableObject {
    static let shared = MdBossManager()

    let tree = FileTreeModel()

    @Published private(set) var document: MarkdownDocument?
    /// Heading the preview should scroll to, when the file was reached by a `#anchor` link.
    @Published private(set) var previewAnchor: String?

    /// Mirrored from the open document so menu items and the window's edited dot can
    /// react - a nested ObservableObject does not republish through its owner.
    @Published private(set) var isDirty = false

    /// Caret position in the raw pane, 1-based, plus the text of that line. Bookmarks and
    /// comments anchor to it, and the panes use it to highlight the entry you are on.
    @Published private(set) var currentLine = 1
    private(set) var currentLineText = ""

    /// A request for the raw pane to scroll to a line. Carries an id so asking for the same
    /// line twice still moves the view.
    @Published private(set) var scrollRequest: ScrollRequest?

    struct ScrollRequest: Equatable {
        let line: Int
        let id = UUID()
    }

    var selectedFile: URL? { document?.url }

    private var settings: AppSettings { AppSettings.shared }
    private var folders: RootFoldersManager { .shared }
    private var documentObserver: AnyCancellable?

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
        documentObserver = opened.objectWillChange.sink { [weak self] _ in
            // objectWillChange fires before the value lands, so read it on the next turn.
            Task { @MainActor in self?.syncWindowEditedState() }
        }
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

    /// Drives the dot in the window's close button and the enabled state of Save.
    func syncWindowEditedState() {
        let dirty = document?.isDirty ?? false
        if isDirty != dirty { isDirty = dirty }
        NSApp.windows.first?.isDocumentEdited = dirty
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

    func requestScroll(to line: Int) {
        scrollRequest = ScrollRequest(line: line)
    }

    /// Reported by the editor on every selection change.
    func reportCursor(line: Int, text: String) {
        currentLineText = text
        if currentLine != line { currentLine = line }
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
