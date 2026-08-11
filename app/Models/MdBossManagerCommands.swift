import SwiftUI
import AppKit

// Menu-bar entry points. Kept in an extension so MdBossManager.swift stays about state
// and this file stays about what the menus do.
extension MdBossManager {
    // MARK: File

    func saveDocument() {
        document?.save()
        syncWindowEditedState()
    }

    func revertDocument() {
        guard let document, document.isDirty else { return }
        document.revert()
        syncWindowEditedState()
    }

    var canSave: Bool { isDirty }

    /// What a File-menu action acts on: the open document, or the row the sidebar cursor is
    /// on when nothing is open. Named once rather than spelled out at each menu item.
    var actionTarget: URL? { selectedFile ?? tree.cursorRow?.node.url }

    func revealSelectionInFinder() {
        guard let url = actionTarget else { return }
        revealInFinder(url)
    }

    func renameSelection() {
        guard let url = actionTarget else { return }
        rename(url)
    }

    func trashSelection() {
        guard let url = actionTarget else { return }
        trash(url)
    }

    // MARK: Format

    /// Sent down the responder chain rather than to a text view this holds.
    ///
    /// `sendAction(to: nil)` asks AppKit for the first responder that implements the
    /// selector, which is the one authoritative answer to "who has focus" - a reference kept
    /// here would be a second copy of it, and would go stale the first time there are two
    /// editors. Nothing happens when focus is in the sidebar, which is correct.
    func toggleBold() { NSApp.sendAction(#selector(EditorTextView.markdownToggleBold(_:)), to: nil, from: nil) }
    func toggleItalic() { NSApp.sendAction(#selector(EditorTextView.markdownToggleItalic(_:)), to: nil, from: nil) }
    func makeLink() { NSApp.sendAction(#selector(EditorTextView.markdownMakeLink(_:)), to: nil, from: nil) }

    /// The Format menu is about the raw pane, so it greys out when that pane is not up.
    var canFormat: Bool { document != nil && AppSettings.shared.isVisible(.raw) }

    // MARK: View

    func setTheme(_ id: ThemeID) {
        guard id != AppSettings.shared.theme.id else { return }
        AppSettings.shared.setTheme(id)
        flash("\(Theme.named(id).title) theme")
    }

    /// Cmd-Shift-D. Stays a light/dark switch with eight themes installed - see
    /// AppSettings.toggleLightDark.
    func toggleTheme() {
        AppSettings.shared.toggleLightDark()
        flash("\(AppSettings.shared.theme.title) theme")
    }

    func toggleSidebar() {
        AppSettings.shared.showSidebar.toggle()
    }

    func togglePane(_ pane: Pane) {
        AppSettings.shared.toggle(pane)
    }

    /// Cmd-\ puts preview and raw side by side, or drops back to preview alone.
    func toggleSideBySide() {
        let settings = AppSettings.shared
        if settings.isVisible(.raw) && settings.isVisible(.preview) {
            settings.toggle(.raw)
        } else {
            settings.show(.raw)
            settings.show(.preview)
        }
    }

    // MARK: Text size

    /// Cmd-+/- is a document zoom, so it leaves the chrome alone. The settings window is
    /// where the sidebar and button sizes are changed.
    nonisolated static let zoomable: [FontSetting] = [.editor, .preview]

    func changeFontSize(by delta: CGFloat) {
        for setting in Self.zoomable {
            AppSettings.shared.changeFontSize(setting, by: delta)
        }
    }

    /// One step is 2em, about 5% of the default measure.
    func changeMeasure(by delta: CGFloat) {
        let settings = AppSettings.shared
        settings.previewMeasure = min(96, max(26, settings.previewMeasure + delta))
    }

    static let measureStep: CGFloat = 2

    func resetFontSize() {
        for setting in Self.zoomable {
            AppSettings.shared.setFontSize(setting, to: setting.defaultValue)
        }
        AppSettings.shared.previewMeasure = SettingsData().previewMeasure
    }
}
