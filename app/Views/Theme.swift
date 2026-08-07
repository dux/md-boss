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

enum ThemeID: String, CaseIterable, Sendable {
    case paper
    case dark

    var next: Self { self == .paper ? .dark : .paper }

    var title: String { self == .paper ? "Paper" : "Dark" }
}

// MARK: - Theme

struct Theme: Sendable, Equatable {
    let id: ThemeID
    let hex: [ThemeToken: String]

    /// Missing tokens resolve to magenta rather than crashing - a palette hole should be
    /// loud on screen and caught by ThemeTests, not fatal at runtime.
    func value(_ token: ThemeToken) -> String { hex[token] ?? "#FF00FF" }

    subscript(token: ThemeToken) -> Color { Color(hex: value(token)) }

    func nsColor(_ token: ThemeToken) -> NSColor { NSColor(self[token]) }

    /// Drives the titlebar, menus, NSOpenPanel and WebKit's own scrollers. Pinned
    /// explicitly on every theme change so the app never half-follows the system.
    var appearance: NSAppearance.Name { id == .dark ? .darkAqua : .aqua }

    static func named(_ id: ThemeID) -> Self { id == .dark ? .dark : .paper }
}

extension Theme: CustomStringConvertible {
    // Keeps parameterised test output readable - otherwise every case prints the palette.
    var description: String { id.rawValue }
}

// MARK: - Palettes

// The palettes are column-aligned so they read as the swatch tables they are; that is
// worth more here than the house colon spacing.
// swiftlint:disable colon

extension Theme {
    /// Warm cream stock, warm ink, burnt-sienna accent. Text on bg is ~13:1.
    static let paper = Theme(id: .paper, hex: [
        .bg:            "#FBF7EF",
        .surface:       "#F3EDE1",
        .sidebarBg:     "#F3EDE1",
        .text:          "#2B2723",
        .muted:         "#7A7166",
        .border:        "#E3D9C6",
        .borderStrong:  "#CFC4AE",
        .accent:        "#9A5B34",
        .link:          "#1F5C8B",
        .selection:     "#EADFC9",
        .codeBg:        "#F2EADA",
        .codeBorder:    "#E0D5BF",
        .quoteBar:      "#D8C7A5",
        .quoteText:     "#5C554C",
        .tableStripe:   "#F5EFE3",
        .tableHead:     "#EDE5D4",
        .rule:          "#E3D9C6",

        .hlKeyword:     "#A03E52",
        .hlString:      "#4C6B3C",
        .hlNumber:      "#8A5A20",
        .hlTitle:       "#6D4C9F",
        .hlComment:     "#94897A",
        .hlVariable:    "#2F5D8C",
        .hlType:        "#8A5A20",
        .hlMeta:        "#94897A"
    ])

    /// The same hue family rotated dark, so switching reads as the same app at night.
    /// Deliberately warm charcoal - not #000, not blue-black. Text on bg is ~12:1.
    static let dark = Theme(id: .dark, hex: [
        .bg:            "#1E1C1A",
        .surface:       "#26231F",
        .sidebarBg:     "#1A1817",
        .text:          "#E6E0D6",
        .muted:         "#9A9287",
        .border:        "#38342E",
        .borderStrong:  "#4A443C",
        .accent:        "#E0996A",
        .link:          "#7FB3D5",
        .selection:     "#3A332B",
        .codeBg:        "#26231F",
        .codeBorder:    "#39342C",
        .quoteBar:      "#6B5B45",
        .quoteText:     "#B9B1A4",
        .tableStripe:   "#232019",
        .tableHead:     "#2B2722",
        .rule:          "#38342E",

        .hlKeyword:     "#E88B9A",
        .hlString:      "#A3C48A",
        .hlNumber:      "#E0B87A",
        .hlTitle:       "#C0A6E8",
        .hlComment:     "#7E7566",
        .hlVariable:    "#8FBBDE",
        .hlType:        "#E0B87A",
        .hlMeta:        "#7E7566"
    ])
}

// swiftlint:enable colon

// MARK: - Hex

extension Color {
    /// Non-failing on purpose: an unparseable token should show up as magenta in the UI
    /// and be caught by ThemeTests, not take the app down.
    init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = Color(red: 1, green: 0, blue: 1)
            return
        }
        self = Color(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }

    /// True when the string is a well-formed #RRGGBB literal. Used by ThemeTests.
    static func isValidHex(_ hex: String) -> Bool {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        return digits.count == 6 && UInt32(digits, radix: 16) != nil
    }
}
