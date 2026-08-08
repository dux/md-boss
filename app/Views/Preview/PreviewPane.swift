import SwiftUI

/// The rendered side. Re-renders 250ms after typing stops, through a JavaScript call into
/// the live page rather than a reload - so the scroll position and selection survive.
struct PreviewPane: View {
    @ObservedObject var document: MarkdownDocument

    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared
    /// Observed so a note added, deleted or shifted by an edit updates the page's hover text.
    @ObservedObject private var store = AnnotationStore.shared
    @State private var rendered = ""

    var body: some View {
        MarkdownPreviewView(
            fileURL: document.url,
            markdown: rendered,
            theme: settings.theme,
            fontSize: settings.previewFontSize,
            measure: settings.previewMeasure,
            anchor: manager.previewAnchor,
            notes: store.noteTexts(for: document.url),
            highlightLine: manager.highlightedLine,
            onLink: manager.followLink
        )
        .background(settings.theme[.bg])
        // Outside the page's scroll, so it stays in the corner while the page moves under it.
        .overlay(alignment: .topTrailing) {
            MeasureControls()
                .padding(.trailing, 32)
                .padding(.top, 10)
        }
        // Opening or reloading a file shows immediately.
        .task(id: document.reloadToken) {
            rendered = document.text
        }
        // Typing is debounced: .task(id:) cancels the pending one on every keystroke.
        .task(id: document.text) {
            guard rendered != document.text else { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            rendered = document.text
        }
    }
}
