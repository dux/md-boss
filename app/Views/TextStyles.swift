import SwiftUI

// MARK: - Text Styles
// Use like CSS classes: Text("Hello").textStyle(.default)
// Sizes come from AppSettings, never hardcoded at the call site.
//
// The app chrome is deliberately system sans. The serif lives only inside the preview
// page - that contrast is what signals "the middle pane is the document".

enum TextStyle {
    /// File and folder names in the sidebar, list items - 13pt default
    case `default`
    /// Buttons, toolbar items, breadcrumbs - 12pt medium
    case buttons
    /// Status bar, metadata, captions, paths - 11pt
    case small
    /// Section headers like "FOLDERS" - 11pt semibold uppercase muted
    case title
}

extension TextStyle {
    @MainActor
    var size: CGFloat {
        let settings = AppSettings.shared
        switch self {
        case .default: return settings.fontDefault
        case .buttons: return settings.fontButtons
        case .small: return settings.fontSmall
        case .title: return settings.fontTitle
        }
    }
}

private struct TextStyleModifier: ViewModifier {
    let style: TextStyle
    let weight: Font.Weight?
    let mono: Bool
    private let settings = AppSettings.shared

    private var resolvedSize: CGFloat { style.size }

    private var resolvedWeight: Font.Weight {
        if let weight { return weight }
        switch style {
        case .default: return .regular
        case .buttons: return .medium
        case .small: return .regular
        case .title: return .semibold
        }
    }

    private var resolvedFont: Font {
        .system(size: resolvedSize, weight: resolvedWeight, design: mono ? .monospaced : .default)
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if style == .title {
            content
                .font(resolvedFont)
                .foregroundColor(settings.theme[.muted])
                .textCase(.uppercase)
                .kerning(0.6)
        } else {
            content
                .font(resolvedFont)
        }
    }
}

/// SF Symbols that sit next to a label. Sized off the same setting as that label, so
/// raising the sidebar font does not leave 9pt chevrons behind.
private struct IconStyleModifier: ViewModifier {
    let style: TextStyle
    let scale: CGFloat
    let weight: Font.Weight
    private let settings = AppSettings.shared

    func body(content: Content) -> some View {
        content.font(.system(size: (style.size * scale).rounded(), weight: weight))
    }
}

extension View {
    func textStyle(_ style: TextStyle, weight: Font.Weight? = nil, mono: Bool = false) -> some View {
        modifier(TextStyleModifier(style: style, weight: weight, mono: mono))
    }

    /// The icon counterpart of `textStyle`. `scale` is relative to the label it accompanies.
    func iconStyle(_ style: TextStyle, scale: CGFloat = 1, weight: Font.Weight = .regular) -> some View {
        modifier(IconStyleModifier(style: style, scale: scale, weight: weight))
    }

    /// Unified row highlight for the sidebar.
    ///
    /// States (priority high to low):
    /// - `isSelected` + `isFocused`: accent fill, the row the keyboard is on
    /// - `isSelected`: muted selection fill, pane not focused
    /// - `isHovered`: barely-there wash
    func rowHighlight(theme: Theme, isSelected: Bool, isFocused: Bool = false, isHovered: Bool = false) -> some View {
        background(
            RoundedRectangle(cornerRadius: 5)
                .fill(RowHighlightStyle.fill(theme: theme, isSelected: isSelected, isFocused: isFocused, isHovered: isHovered))
        )
    }
}

enum RowHighlightStyle {
    static func fill(theme: Theme, isSelected: Bool, isFocused: Bool, isHovered: Bool) -> Color {
        if isSelected { return theme[.selection].opacity(isFocused ? 1.0 : 0.6) }
        if isHovered { return theme[.selection].opacity(0.4) }
        return .clear
    }
}
