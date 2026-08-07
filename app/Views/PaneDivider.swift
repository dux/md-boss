import SwiftUI
import AppKit

/// Draggable vertical divider between two panes.
///
/// Two flavours because the two uses want different units: the sidebar is a fixed point
/// width, the editor/preview split is a fraction of whatever the content area happens to be.
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

    /// Divider driving a 0...1 split fraction over a known total width.
    static func fraction(
        _ binding: Binding<CGFloat>,
        theme: Theme,
        totalWidth: CGFloat,
        min lower: CGFloat = 0.2,
        max upper: CGFloat = 0.8
    ) -> some View {
        DividerHost(theme: theme) { start, delta in
            guard totalWidth > 0 else { return }
            binding.wrappedValue = Swift.min(upper, Swift.max(lower, start + delta / totalWidth))
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
