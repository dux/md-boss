import SwiftUI

/// One-line footer showing what is open. Transient messages go to the Toast overlay
/// instead - a markdown reader should not push the text around to say something.
struct StatusBarView: View {
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    let url: URL?

    private var theme: Theme { settings.theme }

    /// The bar tracks the caption size the way the sidebar rows track theirs. A fixed 24pt
    /// strip clips its own text at the top of the sidebar font range, and the button in it
    /// has to agree with it about how tall the row is.
    private var buttonHeight: CGFloat { (settings.fontSmall + 7).rounded() }
    private var barHeight: CGFloat { buttonHeight + 6 }

    var body: some View {
        HStack(spacing: 8) {
            // The one control down here, and only when there is something to do with it.
            if manager.isDirty {
                saveButton
            }

            if let url {
                Text((url.path as NSString).abbreviatingWithTildeInPath)
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
                    .lineLimit(1)
                    .truncationMode(.head)
                    .help("Right-click to copy")
                    .contextMenu {
                        Button("Copy Path") { manager.copyPath(url) }
                        Button("Copy File Name") { manager.copyText(url.lastPathComponent) }
                        Divider()
                        Button("Reveal in Finder") { manager.revealInFinder(url) }
                    }
            }

            Spacer(minLength: 12)
        }
        .padding(.horizontal, 12)
        .frame(height: barHeight)
        .background(theme[.surface])
        .overlay(alignment: .top) {
            Rectangle().fill(theme[.border]).frame(height: 1)
        }
    }

    /// It says what the "edited" label used to say and also does something about it, so the
    /// label is gone - two ways of reading the same flag is one too many.
    ///
    /// `.link` rather than `.accent`: this is the blue call to action, and accent is a warm
    /// sienna in the house palette. The label takes `.bg`, the same trick the filled pane
    /// toggle uses, which is what keeps it readable on every palette's blue.
    private var saveButton: some View {
        Button {
            manager.saveDocument()
        } label: {
            Text("Save")
                .textStyle(.small, weight: .semibold)
                .foregroundColor(theme[.bg])
                .padding(.horizontal, 9)
                .frame(height: buttonHeight)
                .background(RoundedRectangle(cornerRadius: 4).fill(theme[.link]))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pointerCursor()
        .help("Save (⌘S)")
    }
}
