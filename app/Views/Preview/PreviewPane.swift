import SwiftUI

/// The rendered side. Re-renders 250ms after typing stops, through a JavaScript call into
/// the live page rather than a reload - so the scroll position and selection survive.
struct PreviewPane: View {
    let document: MarkdownDocument

    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared
    /// Observed so a note added, deleted or shifted by an edit updates the page's hover text.
    private let store = AnnotationStore.shared

    /// The text the page is showing, and the file it came from.
    ///
    /// The file is half of it, because this is `@State` and the pane is *reused* when another
    /// document arrives: the update pass that hands the web view a new `fileURL` runs before
    /// the task that refreshes this, so without the check the new file's page would be built
    /// out of the old file's text. It renders, it is scrolled and the reading place is
    /// restored - all against a document that is no longer open.
    @State private var draft = Draft()

    private struct Draft: Equatable {
        var url: URL?
        var text = ""
    }

    /// The debounced text while it belongs to this document, and the document's own text the
    /// moment it does not.
    private var markdown: String {
        draft.url == document.url ? draft.text : document.text
    }

    private var current: Draft { Draft(url: document.url, text: document.text) }

    var body: some View {
        VStack(spacing: 0) {
            // Above the page rather than over it: a moved or deleted file keeps rendering
            // perfectly well, and with the preview on its own nothing else would say so.
            if let change = document.externalChange {
                ExternalChangeBanner(document: document, change: change)
            }

            MarkdownPreviewView(
                fileURL: document.url,
                markdown: markdown,
                theme: settings.theme,
                fontSize: settings.previewFontSize,
                measure: settings.previewMeasure,
                anchor: manager.previewAnchor,
                notes: store.noteTexts(for: document.url),
                highlightLine: manager.highlightedLine,
                onLink: manager.followLink
            )
            .background(settings.theme[.bg])
            // Outside the page's scroll, so they stay in the corners while the page moves
            // under them - and inside the banner's stack, so they are pushed down rather
            // than covered when one appears.
            .overlay(alignment: .topLeading) {
                BackButton()
                    .padding(.leading, 12)
                    .padding(.top, 10)
            }
            .overlay(alignment: .topTrailing) {
                MeasureControls()
                    .padding(.trailing, 32)
                    .padding(.top, 10)
            }
        }
        // Opening or reloading a file shows immediately.
        .task(id: document.reloadToken) {
            draft = current
        }
        // Typing is debounced: .task(id:) cancels the pending one on every keystroke.
        .task(id: document.text) {
            guard draft != current else { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            draft = current
        }
    }
}
