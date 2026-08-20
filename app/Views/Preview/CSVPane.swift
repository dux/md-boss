import SwiftUI

/// The rendered side for a delimited file. `PreviewPane`'s counterpart: same banner, same
/// 250ms debounce, a different renderer underneath.
///
/// The parse runs off the main actor. A CSV is one long string and splitting it is linear
/// work, which is fine for the 40-row exports most of them are and is emphatically not fine
/// on the main thread for the ones that are not.
struct CSVPane: View {
    let document: MarkdownDocument

    private let settings = AppSettings.shared

    /// The parse the page is showing, and the file it came from - the pane is reused when
    /// another document arrives, and one update pass carrying the previous file's rows is a
    /// table flashing data that belongs to something else. Same guard as `PreviewPane.draft`.
    @State private var parsed: Parsed?
    /// Incremented per parse, and what the web view keys its re-render on - see
    /// `CSVPreviewView.version`.
    @State private var version = 0

    private struct Parsed {
        let url: URL
        let text: String
        let table: CSVTable
    }

    /// Nil until this document's own parse lands, which the page draws as blank rather than
    /// as an empty file.
    private var table: CSVTable? {
        parsed?.url == document.url ? parsed?.table : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            // Above the page rather than over it, exactly as the preview does it: a moved or
            // deleted file keeps rendering perfectly well, and nothing else would say so.
            if let change = document.externalChange {
                ExternalChangeBanner(document: document, change: change)
            }

            CSVPreviewView(
                fileURL: document.url,
                table: table,
                version: version,
                theme: settings.theme,
                // The preview's size: this is the rendered pane whichever renderer draws it,
                // so it answers to the same setting and to the same ⌘+/- zoom.
                fontSize: settings.previewFontSize
            )
            .background(settings.theme[.bg])
            // This is the rendered pane while a CSV is open, so it carries the same corner
            // control - otherwise following a link into one is a dead end.
            .overlay(alignment: .topLeading) {
                BackButton()
                    .padding(.leading, 12)
                    .padding(.top, 10)
            }
        }
        // Opening or reloading a file parses immediately.
        .task(id: document.reloadToken) {
            await parse(document.text)
        }
        // Typing is debounced: .task(id:) cancels the pending one on every keystroke.
        .task(id: document.text) {
            guard parsed?.text != document.text || parsed?.url != document.url else { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await parse(document.text)
        }
    }

    private func parse(_ text: String) async {
        let url = document.url
        let result = await Task.detached(priority: .userInitiated) {
            CSVTable.parse(text)
        }.value

        // The pane may be showing another file by the time a long parse comes back.
        guard !Task.isCancelled, url == document.url else { return }
        parsed = Parsed(url: url, text: text, table: result)
        version += 1
    }
}
