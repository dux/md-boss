import SwiftUI

/// The rendered side. Re-renders 250ms after typing stops, through a JavaScript call into
/// the live page rather than a reload - so the scroll position and selection survive.
struct PreviewPane: View {
    @ObservedObject var document: MarkdownDocument

    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared
    @State private var rendered = ""

    var body: some View {
        MarkdownPreviewView(
            fileURL: document.url,
            markdown: rendered,
            theme: settings.theme,
            fontSize: settings.previewFontSize,
            measure: settings.previewMeasure,
            anchor: manager.previewAnchor,
            onLink: manager.followLink
        )
        .background(settings.theme[.bg])
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
