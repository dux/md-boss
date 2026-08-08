import SwiftUI

struct EditorPane: View {
    let document: MarkdownDocument
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared
    /// Observed so a note added, deleted or shifted by an edit repaints the gutter.
    private let store = AnnotationStore.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            if let change = document.externalChange {
                banner(for: change)
            }

            // The reload token and the two transient manager values are read here so the
            // pane depends on them: observation is per property, and nothing else in this
            // body touches them - so nothing would re-run `updateNSView` on a jump.
            MarkdownTextView(
                document: document,
                reloadToken: document.reloadToken,
                theme: theme,
                fontSize: settings.editorFontSize,
                scrollRequest: manager.scrollRequest,
                highlightLine: manager.highlightedLine,
                notes: store.noteTexts(for: document.url)
            )
        }
        .background(theme[.bg])
    }

    /// A banner rather than an alert: file watchers fire in bursts, and a modal that steals
    /// focus while someone is typing is hostile.
    @ViewBuilder
    private func banner(for change: MarkdownDocument.ExternalChange) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .iconStyle(.buttons, scale: 0.9, weight: .medium)
                .foregroundColor(theme[.accent])

            Text(change == .conflict
                 ? "This file changed on disk."
                 : "This file was moved or deleted. Your text is still here.")
                .textStyle(.buttons)
                .foregroundColor(theme[.text])

            Spacer()

            if change == .conflict {
                Button("Reload from Disk") { document.reloadFromDisk() }
                Button("Keep My Version") { document.keepMine() }
            } else {
                Button("Dismiss") { document.keepMine() }
            }
        }
        .textStyle(.buttons)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(theme[.surface])
        .overlay(alignment: .leading) {
            Rectangle().fill(theme[.accent]).frame(width: 3)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme[.border]).frame(height: 1)
        }
    }
}
