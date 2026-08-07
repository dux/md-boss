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
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared

    var body: some Commands {
        CommandGroup(replacing: .appInfo) {
            Button("About md-boss") { AboutPanel.show() }
        }

        CommandGroup(replacing: .newItem) {
            Button("Open Folder…") { manager.openFolderPanel() }
                .keyboardShortcut("o", modifiers: .command)
            Button("Open File…") { manager.openFilePanel() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
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

        CommandMenu("Annotate") {
            Button(manager.hasBookmarkAtCursor ? "Edit Bookmark…" : "Add Bookmark…") {
                manager.addBookmarkAtCursor()
            }
            .keyboardShortcut("b", modifiers: [.command, .shift])
            .disabled(manager.selectedFile == nil)

            Button("Add Comment…") { manager.addCommentAtCursor() }
                .keyboardShortcut("k", modifiers: [.command, .shift])
                .disabled(manager.selectedFile == nil)
        }

        // .sidebar lands in the system View menu. A CommandMenu("View") would create a
        // second one next to it.
        CommandGroup(replacing: .sidebar) {
            ForEach(Array(Pane.allCases.enumerated()), id: \.element) { index, pane in
                Button("\(settings.isVisible(pane) ? "Hide" : "Show") \(pane.title)") {
                    manager.togglePane(pane)
                }
                .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
            }

            Button("Raw & Preview") { manager.toggleSideBySide() }
                .keyboardShortcut("\\", modifiers: .command)

            Divider()

            Button("\(settings.theme.id.next.title) Theme") { manager.toggleTheme() }
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
