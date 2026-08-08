import SwiftUI

/// The segmented control at the top of the sidebar. Each segment toggles one pane in or out;
/// the panes then sit side by side in `Pane.allCases` order.
struct PaneToggleBar: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared
    @ObservedObject private var store = AnnotationStore.shared

    private var theme: Theme { settings.theme }

    /// The folder box sits directly under this one, so the two share a height rather than
    /// each deriving its own from the button font.
    private var controlHeight: CGFloat { RootPickerBox.height }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(Pane.allCases.enumerated()), id: \.element) { index, pane in
                if index > 0 { divider(between: Pane.allCases[index - 1], and: pane) }
                button(for: pane)
            }
        }
        // `.bg` rather than `.surface`, for the same reason as the folder box below it: in
        // the paper palette surface and sidebarBg are one hex, so a surface control would
        // be invisible against the sidebar.
        .background(theme[.bg])
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme[.border], lineWidth: 1)
        )
    }

    /// Drawn only between two segments that are both off - a rule butting against the accent
    /// fill reads as a seam in it. It keeps its width either way, so toggling a pane does
    /// not shift the others by a point.
    private func divider(between previous: Pane, and pane: Pane) -> some View {
        Rectangle()
            .fill(theme[.border])
            // Height as well as width: a Rectangle left unbounded takes every point the
            // column has and drags the whole bar down with it.
            .frame(width: 1, height: controlHeight)
            .opacity(settings.isVisible(previous) || settings.isVisible(pane) ? 0 : 1)
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
            HStack(spacing: 3) {
                Text(pane.shortTitle)
                    .textStyle(.buttons, weight: isOn ? .semibold : .regular)

                if let count = count(for: pane) {
                    Text("\(count)")
                        .textStyle(.small, mono: true)
                        .opacity(0.75)
                }
            }
            .lineLimit(1)
            .foregroundColor(isOn ? theme[.bg] : theme[.muted])
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity)
            .frame(height: controlHeight)
            .background(isOn ? theme[.accent] : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(isOn ? "Hide \(pane.title)" : "Show \(pane.title)")
    }
}
