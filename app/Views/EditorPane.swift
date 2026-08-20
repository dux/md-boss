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
                ExternalChangeBanner(document: document, change: change)
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
                notes: store.noteTexts(for: document.url),
                isPlain: document.kind != .markdown
            )
        }
        .background(theme[.bg])
    }
}
