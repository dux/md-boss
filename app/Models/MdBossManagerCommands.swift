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

    func revealSelectionInFinder() {
        guard let url = selectedFile ?? tree.cursorRow?.node.url else { return }
        revealInFinder(url)
    }

    // MARK: View

    func toggleTheme() {
        let next = AppSettings.shared.theme.id.next
        AppSettings.shared.themeID = next.rawValue
        flash("\(next.title) theme")
    }

    func toggleSidebar() {
        AppSettings.shared.showSidebar.toggle()
    }

    func togglePane(_ pane: Pane) {
        AppSettings.shared.toggle(pane)
    }

    /// Cmd-\ puts raw and preview side by side, or drops back to preview alone.
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
