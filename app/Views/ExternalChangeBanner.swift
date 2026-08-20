import SwiftUI

/// What the file did while you were looking at it.
///
/// A banner rather than an alert: file watchers fire in bursts, and a modal that steals focus
/// while someone is typing is hostile.
///
/// Drawn by *both* document panes rather than only the editor. A moved or deleted file keeps
/// its buffer either way, and with the preview on its own - which is the default set of panes
/// - the editor's banner is not on screen to say so. The document silently going stale under
/// a reader is the same bug as it going stale under a typist.
struct ExternalChangeBanner: View {
    let document: MarkdownDocument
    let change: MarkdownDocument.ExternalChange

    private let settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
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
                Button("Reload from Disk") { document.reloadFromDisk() }.pointerCursor()
                Button("Keep My Version") { document.keepMine() }.pointerCursor()
            } else {
                Button("Dismiss") { document.keepMine() }.pointerCursor()
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
