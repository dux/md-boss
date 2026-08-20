import SwiftUI

/// Narrow and widen the preview's reading measure. In em, so the column keeps tracking
/// the text size instead of fighting it.
///
/// Pinned to the preview's top-right corner rather than sitting in the toggle stripe: the
/// stripe spans every pane, and this only affects the rendered column.
struct MeasureControls: View {
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    /// Tracks the button font, so nothing clips once it is raised.
    private var controlHeight: CGFloat { max(22, (settings.fontButtons + 10).rounded()) }

    var body: some View {
        HStack(spacing: 0) {
            arrow("chevron.left", help: "Narrower text column") {
                manager.changeMeasure(by: -MdBossManager.measureStep)
            }
            Rectangle().fill(theme[.border]).frame(width: 1, height: controlHeight - 8)
            arrow("chevron.right", help: "Wider text column") {
                manager.changeMeasure(by: MdBossManager.measureStep)
            }
        }
        .background(theme[.surface])
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme[.border], lineWidth: 1)
        )
    }

    private func arrow(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .iconStyle(.buttons, scale: 0.75, weight: .semibold)
                .foregroundColor(theme[.muted])
                .frame(width: controlHeight, height: controlHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pointerCursor()
        .help(help)
    }
}
