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

    /// Nil when the pane has nothing to count, so the label stays clean.
    private func count(for pane: Pane) -> Int? {
        let value: Int
        switch pane {
        // The open file, matching what the pane leads with rather than a global total that
        // says nothing about what is on screen.
        case .notes: value = store.noteCount(for: manager.selectedFile)
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
