import SwiftUI
import AppKit

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

    /// The pointing hand over a button. Every button the app draws itself carries this, and
    /// nothing else does - a list row that selects something keeps the arrow, which is why
    /// the sidebar tree and the folder dropdown are left alone.
    ///
    /// Pass the button's own enabled state: a control that is dimmed and does nothing must
    /// not advertise a click. `.disabled()` greys the label but says nothing about the cursor.
    func pointerCursor(_ isEnabled: Bool = true) -> some View {
        overlay(CursorArea(isEnabled: isEnabled).allowsHitTesting(false))
    }
}

/// An invisible AppKit layer that claims the cursor over whatever it covers.
///
/// Neither `pointerStyle` nor an `onHover` that calls `NSCursor.set()` survives the measure
/// arrows, which are the app's only buttons floating over a `WKWebView`: the web view sets
/// the cursor from its own mouse tracking, and whatever SwiftUI set a moment earlier is taken
/// straight back. `cursorUpdate(with:)` is the point in the event cycle where AppKit asks the
/// frontmost tracking area under the pointer what the cursor should be, so answering there
/// wins by construction rather than by winning a race.
///
/// One mechanism for every button rather than the plain case and the hard case done
/// differently - two answers to "what does the cursor do over a button" is the kind of split
/// that leaves one of them quietly wrong, which is how the arrows got missed to begin with.
private struct CursorArea: NSViewRepresentable {
    let isEnabled: Bool

    func makeNSView(context: Context) -> TrackingView { TrackingView() }

    func updateNSView(_ view: TrackingView, context: Context) {
        view.isEnabled = isEnabled
    }

    final class TrackingView: NSView {
        var isEnabled = true

        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            for area in trackingAreas { removeTrackingArea(area) }
            // `.inVisibleRect` keeps the area correct as the button resizes with the font
            // setting, which is otherwise a rect measured once at the old size.
            addTrackingArea(NSTrackingArea(
                rect: .zero,
                options: [.cursorUpdate, .activeInActiveApp, .inVisibleRect],
                owner: self
            ))
        }

        override func cursorUpdate(with event: NSEvent) {
            guard isEnabled else { return super.cursorUpdate(with: event) }
            NSCursor.pointingHand.set()
        }

        /// Never take the click. Tracking areas are dispatched off the view's frame rather
        /// than hit testing, so the cursor still arrives here while the button underneath
        /// keeps every mouse event.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

enum RowHighlightStyle {
    static func fill(theme: Theme, isSelected: Bool, isFocused: Bool, isHovered: Bool) -> Color {
        if isSelected { return theme[.selection].opacity(isFocused ? 1.0 : 0.6) }
        if isHovered { return theme[.selection].opacity(0.4) }
        return .clear
    }
}
