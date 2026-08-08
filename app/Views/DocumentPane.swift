import SwiftUI

/// The right-hand side: a toggle stripe over whichever panes are switched on, side by side
/// in `Pane.allCases` order.
///
/// Notes take a fixed 300pt column; raw and preview share whatever is
/// left, split by a draggable divider.
struct DocumentPane: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var manager = MdBossManager.shared

    private static let fixedPaneWidth: CGFloat = 300
    private static let dividerWidth: CGFloat = 5

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            PaneToggleBar()

            GeometryReader { geometry in
                let panes = settings.panes
                let widths = documentWidths(in: geometry.size.width, panes: panes)

                HStack(spacing: 0) {
                    ForEach(Array(panes.enumerated()), id: \.element) { index, pane in
                        if index > 0 { separator(before: pane, after: panes[index - 1], total: widths.available) }
                        content(for: pane)
                            .frame(width: pane.fixedWidth ?? widthFor(pane, widths: widths))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme[.bg])
    }

    // MARK: Panes

    @ViewBuilder
    private func content(for pane: Pane) -> some View {
        switch pane {
        case .raw:
            if let document = manager.document {
                EditorPane(document: document)
            } else {
                EmptyPane(theme: theme, message: "Select a file.")
            }
        case .preview:
            if let document = manager.document {
                PreviewPane(document: document)
            } else {
                EmptyPane(theme: theme, message: "Select a file.")
            }
        case .notes:
            NotesPane()
        }
    }

    /// The divider between raw and preview is draggable; the others are plain rules.
    @ViewBuilder
    private func separator(before pane: Pane, after previous: Pane, total: CGFloat) -> some View {
        if previous == .raw && pane == .preview {
            PaneDivider.fraction($settings.data.editorSplit, theme: theme, totalWidth: total)
        } else {
            Rectangle()
                .fill(theme[.border])
                .frame(width: 1)
                .padding(.horizontal, 2)
        }
    }

    // MARK: Widths

    private struct Widths {
        /// Space left for raw and preview once the fixed columns and dividers are taken.
        let available: CGFloat
        let raw: CGFloat
        let preview: CGFloat
    }

    private func documentWidths(in total: CGFloat, panes: [Pane]) -> Widths {
        let fixed = panes.compactMap(\.fixedWidth).reduce(0, +)
        let dividers = CGFloat(max(0, panes.count - 1)) * Self.dividerWidth
        let available = max(0, total - fixed - dividers)

        let hasRaw = panes.contains(.raw)
        let hasPreview = panes.contains(.preview)

        switch (hasRaw, hasPreview) {
        case (true, true):
            let raw = available * settings.editorSplit
            return Widths(available: available, raw: raw, preview: available - raw)
        case (true, false):
            return Widths(available: available, raw: available, preview: 0)
        case (false, true):
            return Widths(available: available, raw: 0, preview: available)
        case (false, false):
            return Widths(available: available, raw: 0, preview: 0)
        }
    }

    private func widthFor(_ pane: Pane, widths: Widths) -> CGFloat {
        pane == .raw ? widths.raw : widths.preview
    }
}
