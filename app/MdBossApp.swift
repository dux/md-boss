import SwiftUI
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            // The theme is an explicit user choice, so the appearance is pinned rather than
            // left to follow the system - otherwise the titlebar, menus and panels would
            // disagree with the palette the views and the web view are drawing.
            AppSettings.shared.applyAppearance()

            let manager = MdBossManager.shared
            manager.tree.refreshAll()

            // `md-boss .` and `open -a MdBoss --args <path>` both land here.
            if let path = CommandLine.arguments.dropFirst().first(where: { !$0.hasPrefix("-") }) {
                manager.handleExternalOpen(Self.resolve(path))
            } else {
                manager.restoreSession()
            }

            // A copy of MdBoss.app dropped in by hand should still get the `md-boss`
            // command, so the shim is the app's job rather than the build script's.
            CLIShim.installInBackground()
        }
    }

    /// A folder or file dropped on the Dock icon, or double-clicked in Finder.
    func application(_ application: NSApplication, open urls: [URL]) {
        MainActor.assumeIsolated {
            for url in urls { MdBossManager.shared.handleExternalOpen(url) }
        }
    }

    private static func resolve(_ path: String) -> URL {
        let expanded = NSString(string: path).expandingTildeInPath
        return URL(fileURLWithPath: expanded).standardizedFileURL
    }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { AppSettings.shared.flush() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Save is explicit, so quitting with unsaved edits has to ask.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        MainActor.assumeIsolated {
            MdBossManager.shared.confirmDiscardingChanges() ? .terminateNow : .terminateCancel
        }
    }
}

@main
struct MdBossApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        if let iconURL = Bundle.module.url(forResource: "AppIcon", withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .commands { MdBossCommands() }

        // macOS adds the "Settings…" item and its ⌘, shortcut on its own.
        Settings { SettingsView() }
    }
}

// MARK: - Menus

struct MdBossCommands: Commands {
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared
    private let folders = RootFoldersManager.shared

    /// Writes through the manager rather than the settings struct, so picking a theme from
    /// the menu flashes the same toast as Cmd-Shift-D.
    private var themeSelection: Binding<ThemeID> {
        Binding(get: { settings.theme.id }, set: { manager.setTheme($0) })
    }

    var body: some Commands {
        CommandGroup(replacing: .appInfo) {
            Button("About md-boss") { AboutPanel.show() }
        }

        CommandGroup(replacing: .newItem) {
            Button("New File…") { manager.newFile() }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(folders.active == nil)
            Divider()
            Button("Open Folder…") { manager.openFolderPanel() }
                .keyboardShortcut("o", modifiers: .command)
            Button("Open File…") { manager.openFilePanel() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Divider()
            // No shortcut on Rename: Return already opens in the sidebar, and every free
            // Command combination in this app already means something else.
            Button("Rename…") { manager.renameSelection() }
                .disabled(manager.actionTarget == nil)
            Button("Move to Trash") { manager.trashSelection() }
                .keyboardShortcut(.delete, modifiers: .command)
                .disabled(manager.actionTarget == nil)
            Divider()
            Button("Reveal in Finder") { manager.revealSelectionInFinder() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
        }

        CommandGroup(replacing: .saveItem) {
            Button("Save") { manager.saveDocument() }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!manager.canSave)
            Button("Revert to Saved") { manager.revertDocument() }
                .disabled(!manager.canSave)
        }

        // SwiftUI supplies a Print item here by default, and it would take ⌘P off Go to File.
        // Print and export are still on the list, so nothing is lost by clearing it.
        CommandGroup(replacing: .printItem) {}

        CommandMenu("Find") {
            // ⌘F stays the raw pane's own find bar - one document, incremental, AppKit's.
            Button("Find in Project…") { manager.findInProject() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                .disabled(!manager.canSearch)
            Button("Go to File…") { manager.goToFile() }
                .keyboardShortcut("p", modifiers: .command)
                .disabled(!manager.canSearch)
        }

        CommandMenu("Format") {
            Button("Bold") { manager.toggleBold() }
                .keyboardShortcut("b", modifiers: .command)
                .disabled(!manager.canFormat)
            Button("Italic") { manager.toggleItalic() }
                .keyboardShortcut("i", modifiers: .command)
                .disabled(!manager.canFormat)
            Divider()
            // ⌘K is free - ⇧⌘K is Add Note and stays where it is.
            Button("Link") { manager.makeLink() }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(!manager.canFormat)
        }

        CommandMenu("Annotate") {
            Button(manager.hasNoteAtCursor ? "Edit Note…" : "Add Note…") {
                manager.addNoteAtCursor()
            }
            .keyboardShortcut("k", modifiers: [.command, .shift])
            .disabled(manager.selectedFile == nil)

            Button("Delete Note") { manager.deleteNoteAtCursor() }
                .keyboardShortcut(.delete, modifiers: [.command, .shift])
                .disabled(!manager.hasNoteAtCursor)
        }

        // .sidebar lands in the system View menu. A CommandMenu("View") would create a
        // second one next to it.
        CommandGroup(replacing: .sidebar) {
            ForEach(Pane.allCases) { pane in
                Button("\(settings.isVisible(pane) ? "Hide" : "Show") \(pane.title)") {
                    manager.togglePane(pane)
                }
                .keyboardShortcut(pane.shortcut, modifiers: [.command, .option])
            }

            Button("Preview & Raw") { manager.toggleSideBySide() }
                .keyboardShortcut("\\", modifiers: .command)

            Divider()

            // An inline Picker is what gets AppKit to draw the checkmark next to the active
            // theme; a list of Buttons would have to fake one in the label text.
            Menu("Theme") {
                Picker("Theme", selection: themeSelection) {
                    ForEach(Theme.all) { theme in
                        Text(theme.title).tag(theme.id)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Button("Toggle Light/Dark") { manager.toggleTheme() }
                .keyboardShortcut("d", modifiers: [.command, .shift])

            Button(settings.showSidebar ? "Hide Sidebar" : "Show Sidebar") {
                manager.toggleSidebar()
            }
            .keyboardShortcut("0", modifiers: .command)

            Divider()

            Button("Bigger Text") { manager.changeFontSize(by: 1) }
                .keyboardShortcut("+", modifiers: .command)
            Button("Smaller Text") { manager.changeFontSize(by: -1) }
                .keyboardShortcut("-", modifiers: .command)
            Button("Actual Size") { manager.resetFontSize() }
                .keyboardShortcut("0", modifiers: [.command, .option])
        }
    }
}

enum AboutPanel {
    private static let githubURL = "https://github.com/dux/md-boss"

    @MainActor
    static func show() {
        let credits = NSMutableAttributedString(
            string: "github.com/dux/md-boss",
            attributes: [
                .link: URL(string: githubURL) as Any,
                .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
            ]
        )
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        credits.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: credits.length))

        NSApplication.shared.orderFrontStandardAboutPanel(options: [.credits: credits])
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
