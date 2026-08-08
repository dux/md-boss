import SwiftUI

/// One-line footer showing what is open. Transient messages go to the Toast overlay
/// instead - a markdown reader should not push the text around to say something.
struct StatusBarView: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared

    let url: URL?

    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 8) {
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

            // Moved off the pane toggles when they went into the sidebar - this sits next
            // to the file it is talking about, and the window's close button says it too.
            if manager.isDirty {
                Text("edited")
                    .textStyle(.small)
                    .foregroundColor(theme[.accent])
            }

            Spacer(minLength: 12)
        }
        .padding(.horizontal, 12)
        .frame(height: 24)
        .background(theme[.surface])
        .overlay(alignment: .top) {
            Rectangle().fill(theme[.border]).frame(height: 1)
        }
    }
}
