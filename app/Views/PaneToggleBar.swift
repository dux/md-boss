import SwiftUI

/// The slim stripe above the viewer. Each button toggles one pane in or out; the panes then
/// sit side by side in `Pane.allCases` order.
struct PaneToggleBar: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared
    @ObservedObject private var store = AnnotationStore.shared

    private var theme: Theme { settings.theme }

    /// The bar's controls track the button font, so nothing clips once it is raised.
    private var controlHeight: CGFloat { max(22, (settings.fontButtons + 10).rounded()) }

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                ForEach(Pane.allCases) { pane in
                    button(for: pane)
                }
            }
            .background(theme[.surface])
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(theme[.border], lineWidth: 1)
            )

            // After the pane buttons: these belong to the preview, so they follow the
            // button that turns it on rather than leading the bar.
            if settings.isVisible(.preview) {
                measureControls
            }

            Spacer()

            if manager.isDirty {
                Text("edited")
                    .textStyle(.small)
                    .foregroundColor(theme[.accent])
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(theme[.sidebarBg])
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme[.border]).frame(height: 1)
        }
    }

    /// Narrow and widen the preview's reading measure. In em, so the column keeps tracking
    /// the text size instead of fighting it.
    private var measureControls: some View {
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
        .help(help)
    }

    /// Nil when the pane has nothing to count, so the label stays clean.
    private func count(for pane: Pane) -> Int? {
        let value: Int
        switch pane {
        case .bookmarks: value = store.bookmarkCount
        case .comments: value = store.commentCount(for: manager.selectedFile)
        case .raw, .preview: return nil
        }
        return value > 0 ? value : nil
    }

    private func button(for pane: Pane) -> some View {
        let isOn = settings.isVisible(pane)

        return Button {
            settings.toggle(pane)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: pane.icon)
                    .iconStyle(.buttons, scale: 0.85, weight: .medium)
                Text(pane.title)
                    .textStyle(.buttons, weight: isOn ? .semibold : .regular)

                if let count = count(for: pane) {
                    Text("(\(count))")
                        .textStyle(.small, mono: true)
                        .opacity(0.75)
                }
            }
            .foregroundColor(isOn ? theme[.bg] : theme[.muted])
            .padding(.horizontal, 10)
            .frame(height: controlHeight)
            .background(isOn ? theme[.accent] : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(isOn ? "Hide \(pane.title)" : "Show \(pane.title)")
    }
}
