import SwiftUI
import AppKit

/// Draggable vertical divider between two panes. Only the sidebar has one: the preview is
/// sized to its own reading measure, so there is nothing left to drag between the documents.
struct PaneDivider: View {
    let theme: Theme
    /// Called with the drag translation in points, measured from where the drag started.
    let onDrag: (CGFloat) -> Void
    let onDragStart: () -> Void

    @State private var isDragging = false

    var body: some View {
        Rectangle()
            .fill(isDragging ? theme[.accent] : theme[.borderStrong])
            .frame(width: isDragging ? 2 : 1)
            .padding(.horizontal, 2)
            .contentShape(Rectangle())
            .onHover { hovering in
                if hovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        if !isDragging {
                            isDragging = true
                            onDragStart()
                        }
                        onDrag(value.translation.width)
                    }
                    .onEnded { _ in isDragging = false }
            )
    }
}

extension PaneDivider {
    /// Divider driving a point width, clamped to a range.
    static func width(
        _ binding: Binding<CGFloat>,
        theme: Theme,
        min lower: CGFloat,
        max upper: CGFloat
    ) -> some View {
        DividerHost(theme: theme) { start, delta in
            binding.wrappedValue = Swift.min(upper, Swift.max(lower, start + delta))
        } currentValue: {
            binding.wrappedValue
        }
    }

}

/// Holds the value the drag started from, so the pane tracks the cursor exactly instead
/// of accumulating rounding drift across drag events.
private struct DividerHost: View {
    let theme: Theme
    let apply: (CGFloat, CGFloat) -> Void
    let currentValue: () -> CGFloat

    @State private var startValue: CGFloat = 0

    var body: some View {
        PaneDivider(theme: theme) { delta in
            apply(startValue, delta)
        } onDragStart: {
            startValue = currentValue()
        }
    }
}
