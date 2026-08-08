import SwiftUI

struct SidebarRow: View {
    let row: FlatRow
    let theme: Theme
    let isExpanded: Bool
    let isSelected: Bool
    let isCursor: Bool
    let onToggle: () -> Void
    let onOpen: () -> Void

    @State private var isHovered = false
    private let settings = AppSettings.shared

    /// Everything in the row is measured off the sidebar font, so the tree keeps its
    /// proportions at any size instead of clipping at the fixed 22pt height.
    private var scale: CGFloat { settings.fontDefault / SettingsData().fontDefault }
    private var indent: CGFloat { CGFloat(row.depth) * (14 * scale).rounded() }
    private var height: CGFloat { max(22, (settings.fontDefault + 9).rounded()) }
    private var chevronWidth: CGFloat { (12 * scale).rounded() }
    private var iconWidth: CGFloat { (14 * scale).rounded() }

    var body: some View {
        HStack(spacing: 4) {
            chevron
            icon
            Text(row.node.name)
                .textStyle(.default)
                .foregroundColor(theme[.text])
                .lineLimit(1)
                .truncationMode(.middle)

            if row.isDenied {
                Text("no access")
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 8 + indent)
        .padding(.trailing, 8)
        .frame(height: height)
        .contentShape(Rectangle())
        .rowHighlight(theme: theme, isSelected: isSelected || isCursor, isFocused: isCursor, isHovered: isHovered)
        .onHover { isHovered = $0 }
        .onTapGesture(perform: onOpen)
    }

    @ViewBuilder
    private var chevron: some View {
        if row.node.isDirectory {
            Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                .iconStyle(.default, scale: 0.7, weight: .semibold)
                .foregroundColor(theme[.muted])
                .frame(width: chevronWidth)
                .contentShape(Rectangle())
                .onTapGesture(perform: onToggle)
        } else {
            Spacer().frame(width: chevronWidth)
        }
    }

    private var icon: some View {
        Image(systemName: row.node.isDirectory ? "folder" : "doc.text")
            .iconStyle(.default, scale: 0.85)
            .foregroundColor(row.node.isDirectory ? theme[.accent] : theme[.muted])
            .frame(width: iconWidth)
    }
}
