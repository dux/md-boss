import SwiftUI

/// Back to the document you were reading before this one.
///
/// Pinned to the rendered pane's top-left corner, opposite `MeasureControls`: following a
/// link is something you do in the rendered page, so the way back sits where you left.
///
/// Hidden rather than disabled when there is no history. In the sidebar it was drawn
/// disabled so the corner would not shuffle the pane toggles sideways; floating over the
/// page there is nothing to shuffle, and a permanently dead control on top of the text is
/// just noise. ⌘[ still works whether or not this is on screen.
struct BackButton: View {
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    /// Tracks the button font, so nothing clips once it is raised. Same rule as the
    /// measure arrows across the pane.
    private var controlHeight: CGFloat { max(22, (settings.fontButtons + 10).rounded()) }

    var body: some View {
        if manager.canGoBack {
            Button {
                manager.goBack()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .iconStyle(.buttons, scale: 0.75, weight: .semibold)
                    Text("go back")
                        .textStyle(.buttons)
                }
                .foregroundColor(theme[.muted])
                .padding(.horizontal, 8)
                .frame(height: controlHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointerCursor()
            .background(theme[.surface])
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(theme[.border], lineWidth: 1)
            )
            .help(manager.backTarget.map { "Back to \($0.lastPathComponent)" } ?? "Back")
        }
    }
}
