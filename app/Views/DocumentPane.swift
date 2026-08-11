import SwiftUI

/// The right-hand side: whichever panes are switched on, side by side in `Pane.allCases`
/// order. The toggles that switch them live at the top of the sidebar.
///
/// Notes take the fixed column `Pane.fixedWidth` names. Side by side with raw, the preview
/// is sized to its own reading measure plus a gutter, and raw takes what is left - the
/// column the measure asks for is the width worth showing, and it is the one the arrows
/// already control.
struct DocumentPane: View {
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private static let dividerWidth: CGFloat = 5

    /// Free space either side of the preview's reading column.
    private static let previewGutter: CGFloat = 40

    private var theme: Theme { settings.theme }

    var body: some View {
        GeometryReader { geometry in
            let panes = settings.panes
            let widths = documentWidths(in: geometry.size.width, panes: panes)

            HStack(spacing: 0) {
                ForEach(Array(panes.enumerated()), id: \.element) { index, pane in
                    if index > 0 { separator() }
                    content(for: pane)
                        .frame(width: pane.fixedWidth ?? widthFor(pane, widths: widths))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    private func separator() -> some View {
        Rectangle()
            .fill(theme[.border])
            .frame(width: 1)
            .padding(.horizontal, 2)
    }

    // MARK: Widths

    private struct Widths {
        /// Space left for preview and raw once the fixed columns and dividers are taken.
        let available: CGFloat
        let preview: CGFloat
        let raw: CGFloat
    }

    /// What the preview asks for when it is not the only document pane: the reading column
    /// the measure names, plus a gutter either side.
    ///
    /// `--measure` is em of `--body-size`, and the page builder writes that size as a whole
    /// number of pixels, so the em is rounded the same way here - a fractional font size
    /// would otherwise leave the frame a point or two off the column inside it.
    private var preferredPreviewWidth: CGFloat {
        settings.previewMeasure * CGFloat(Int(settings.previewFontSize)) + 2 * Self.previewGutter
    }

    private func documentWidths(in total: CGFloat, panes: [Pane]) -> Widths {
        let fixed = panes.compactMap(\.fixedWidth).reduce(0, +)
        let dividers = CGFloat(max(0, panes.count - 1)) * Self.dividerWidth
        let available = max(0, total - fixed - dividers)

        let hasRaw = panes.contains(.raw)
        let hasPreview = panes.contains(.preview)

        switch (hasPreview, hasRaw) {
        case (true, true):
            // Capped at four fifths, the ceiling the drag used to hold: a window too narrow
            // for the whole measure should still leave raw a usable strip, not a sliver.
            let preview = min(preferredPreviewWidth, available * 0.8)
            return Widths(available: available, preview: preview, raw: available - preview)
        case (true, false):
            return Widths(available: available, preview: available, raw: 0)
        case (false, true):
            return Widths(available: available, preview: 0, raw: available)
        case (false, false):
            return Widths(available: available, preview: 0, raw: 0)
        }
    }

    private func widthFor(_ pane: Pane, widths: Widths) -> CGFloat {
        pane == .preview ? widths.preview : widths.raw
    }
}
