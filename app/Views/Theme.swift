import SwiftUI
import AppKit

// MARK: - Tokens
//
// Every color in the app - SwiftUI chrome and the preview web page alike - comes from
// one of these tokens. The raw value is the CSS custom property name, so the web page
// and the Swift views are guaranteed to be describing the same palette.
//
// Adding a case here without adding it to BOTH palettes fails ThemeTests.

enum ThemeToken: String, CaseIterable, Sendable {
    case bg
    case surface
    case sidebarBg = "sidebar-bg"
    case text
    case muted
    case border
    case borderStrong = "border-strong"
    case accent
    case link
    case selection
    case codeBg = "code-bg"
    case codeBorder = "code-border"
    case quoteBar = "quote-bar"
    case quoteText = "quote-text"
    case tableStripe = "table-stripe"
    case tableHead = "table-head"
    case rule

    case hlKeyword = "hl-keyword"
    case hlString = "hl-string"
    case hlNumber = "hl-number"
    case hlTitle = "hl-title"
    case hlComment = "hl-comment"
    case hlVariable = "hl-variable"
    case hlType = "hl-type"
    case hlMeta = "hl-meta"
}

/// The persisted identity of a theme. The raw value is what lands in settings.json and in
/// the preview page's `data-theme` attribute, so it is stable across builds.
///
/// Order here is picker and menu order. The palettes themselves live in ThemePalettes.swift.
enum ThemeID: String, CaseIterable, Sendable {
    case paper
    case dark
    case solarizedLight = "solarized-light"
    case solarizedDark = "solarized-dark"
    case github
    case nord
    case dracula
    case gruvbox
}

// MARK: - Theme

struct Theme: Sendable, Equatable, Identifiable {
    let id: ThemeID
    let title: String
    let hex: [ThemeToken: String]

    /// Missing tokens resolve to magenta rather than crashing - a palette hole should be
    /// loud on screen and caught by ThemeTests, not fatal at runtime.
    func value(_ token: ThemeToken) -> String { hex[token] ?? "#FF00FF" }

    subscript(token: ThemeToken) -> Color { Color(hex: value(token)) }

    func nsColor(_ token: ThemeToken) -> NSColor { NSColor(self[token]) }

    /// Derived from the background rather than declared, for the same reason caption sizes
    /// are derived from the sidebar size: a stored flag that disagrees with the palette it
    /// describes is a bug that cannot happen if the flag does not exist.
    var isDark: Bool { Color.luminance(of: value(.bg)) < 0.5 }

    /// Drives the titlebar, menus, NSOpenPanel and WebKit's own scrollers. Pinned
    /// explicitly on every theme change so the app never half-follows the system.
    var appearance: NSAppearance.Name { isDark ? .darkAqua : .aqua }

    /// An id with no palette falls back to Paper rather than rendering magenta - a
    /// hand-edited settings.json should not be able to break the app.
    static func named(_ id: ThemeID) -> Self { byID[id] ?? .paper }

    private static let byID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
}

extension Theme: CustomStringConvertible {
    // Keeps parameterised test output readable - otherwise every case prints the palette.
    var description: String { id.rawValue }
}

// MARK: - Theme choice

/// The whole theme choice as one value: which theme is active, plus the last one used on
/// each side of the light/dark line so Cmd-Shift-D stays a polarity switch rather than a
/// cycle through eight palettes.
///
/// Pure on purpose - the rule lives here and can be tested without touching the settings
/// file on disk. `AppSettings` only stores the three ids.
struct ThemeChoice: Equatable, Sendable {
    let active: ThemeID
    let light: ThemeID
    let dark: ThemeID

    /// A stored id on the wrong side of the line would make the toggle a no-op, so it is
    /// dropped back to the house default for that side.
    init(active: ThemeID = .paper, light: ThemeID = .paper, dark: ThemeID = .dark) {
        self.active = active
        self.light = Theme.named(light).isDark ? .paper : light
        self.dark = Theme.named(dark).isDark ? dark : .dark
    }

    /// Picking a theme also records it as the choice for its own side.
    func selecting(_ id: ThemeID) -> Self {
        Theme.named(id).isDark
            ? Self(active: id, light: light, dark: id)
            : Self(active: id, light: id, dark: dark)
    }

    /// Cmd-Shift-D. Flips polarity, landing on whichever theme was last used on that side.
    var flipped: Self { selecting(Theme.named(active).isDark ? light : dark) }
}

// MARK: - Hex

extension Color {
    /// Non-failing on purpose: an unparseable token should show up as magenta in the UI
    /// and be caught by ThemeTests, not take the app down.
    init(hex: String) {
        guard let (red, green, blue) = Color.rgb(of: hex) else {
            self = Color(red: 1, green: 0, blue: 1)
            return
        }
        self = Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
    }

    /// True when the string is a well-formed #RRGGBB literal. Used by ThemeTests.
    static func isValidHex(_ hex: String) -> Bool {
        rgb(of: hex) != nil
    }

    /// WCAG relative luminance, 0 (black) to 1 (white). Unparseable hex reads as mid grey so
    /// a broken token cannot flip a whole theme's polarity.
    static func luminance(of hex: String) -> Double {
        guard let (red, green, blue) = rgb(of: hex) else { return 0.5 }
        func linear(_ channel: Double) -> Double {
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// WCAG contrast ratio between two #RRGGBB literals, 1 (identical) to 21 (black on white).
    static func contrast(_ one: String, _ other: String) -> Double {
        let (lighter, darker) = (max(luminance(of: one), luminance(of: other)),
                                 min(luminance(of: one), luminance(of: other)))
        return (lighter + 0.05) / (darker + 0.05)
    }

    /// Channels in 0...1, or nil if the string is not a #RRGGBB literal.
    private static func rgb(of hex: String) -> (Double, Double, Double)? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return (Double((value >> 16) & 0xFF) / 255,
                Double((value >> 8) & 0xFF) / 255,
                Double(value & 0xFF) / 255)
    }
}
