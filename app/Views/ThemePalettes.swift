import Foundation

// MARK: - Palettes
//
// The one place a hex literal is allowed to appear. Every palette fills every ThemeToken;
// ThemeTests fails on a hole, a stale token, a bad literal, or text that does not clear
// 7:1 against its own background.
//
// Six of the eight are ports of schemes people already recognise. Where a scheme's canonical
// body text is too pale for a document reader - Solarized Light's base00 sits at 4.5:1 - the
// emphasized-text value is used instead. This is a reading app before it is a tribute.
//
// The tables are column-aligned so they read as the swatch tables they are; that is worth
// more here than the house colon spacing.
// swiftlint:disable colon

extension Theme {
    /// Every theme, in picker and menu order. One list drives the Settings grid, the
    /// View > Theme submenu, Theme.named and the tests.
    static let all: [Theme] = [
        .paper, .dark,
        .solarizedLight, .solarizedDark,
        .github, .nord, .dracula, .gruvbox
    ]

    // MARK: Paper / Dark - the house pair

    /// Warm cream stock, warm ink, burnt-sienna accent. Text on bg is ~13:1.
    static let paper = Theme(id: .paper, title: "Paper", hex: [
        .bg:            "#FBF7EF",
        .surface:       "#F3EDE1",
        .sidebarBg:     "#F3EDE1",
        .text:          "#2B2723",
        .muted:         "#756C61",
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

        .alertNote:      "#2F5D8C",
        .alertTip:       "#4C6B3C",
        .alertImportant: "#6D4C9F",
        .alertWarning:   "#8A5A20",
        .alertCaution:   "#A03E52",

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
    static let dark = Theme(id: .dark, title: "Dark", hex: [
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

        .alertNote:      "#8FBBDE",
        .alertTip:       "#A3C48A",
        .alertImportant: "#C0A6E8",
        .alertWarning:   "#E0B87A",
        .alertCaution:   "#E88B9A",

        .hlKeyword:     "#E88B9A",
        .hlString:      "#A3C48A",
        .hlNumber:      "#E0B87A",
        .hlTitle:       "#C0A6E8",
        .hlComment:     "#7E7566",
        .hlVariable:    "#8FBBDE",
        .hlType:        "#E0B87A",
        .hlMeta:        "#7E7566"
    ])

    // MARK: Solarized - Ethan Schoonover

    /// base3 stock. Body text is base02 and secondary text base01, rather than the canonical
    /// base00 - that takes text on bg from 4.5:1 to ~12:1. Those are terminal contrasts,
    /// not long-form reading ones.
    static let solarizedLight = Theme(id: .solarizedLight, title: "Solarized Light", hex: [
        .bg:            "#FDF6E3",
        .surface:       "#EEE8D5",
        .sidebarBg:     "#EEE8D5",
        .text:          "#073642",
        .muted:         "#586E75",
        .border:        "#E0D9C2",
        .borderStrong:  "#CFC7B0",
        .accent:        "#CB4B16",
        .link:          "#268BD2",
        .selection:     "#E8E0C8",
        .codeBg:        "#EEE8D5",
        .codeBorder:    "#DDD6C1",
        .quoteBar:      "#D3CBB7",
        .quoteText:     "#586E75",
        .tableStripe:   "#F5EFDC",
        .tableHead:     "#EBE4D0",
        .rule:          "#E0D9C2",

        // Solarized's accents are a terminal contrast: blue lands at 3.4:1 on base3 and
        // yellow at 3.0:1. Lifted along lightness, hue and saturation held.
        .alertNote:      "#2074AF",
        .alertTip:       "#667500",
        .alertImportant: "#6166C0",
        .alertWarning:   "#8C6A00",
        .alertCaution:   "#D72724",

        .hlKeyword:     "#859900",
        .hlString:      "#2AA198",
        .hlNumber:      "#D33682",
        .hlTitle:       "#268BD2",
        .hlComment:     "#93A1A1",
        .hlVariable:    "#B58900",
        .hlType:        "#CB4B16",
        .hlMeta:        "#93A1A1"
    ])

    /// base03 stock. Links are lifted off the canonical base blue, which only manages
    /// 4.3:1 against base03.
    static let solarizedDark = Theme(id: .solarizedDark, title: "Solarized Dark", hex: [
        .bg:            "#002B36",
        .surface:       "#073642",
        .sidebarBg:     "#01242E",
        .text:          "#EEE8D5",
        .muted:         "#93A1A1",
        .border:        "#0E4451",
        .borderStrong:  "#1A5A6B",
        .accent:        "#CB4B16",
        .link:          "#58A6DE",
        .selection:     "#0B3A46",
        .codeBg:        "#073642",
        .codeBorder:    "#0F4553",
        .quoteBar:      "#2C5D68",
        .quoteText:     "#93A1A1",
        .tableStripe:   "#05303B",
        .tableHead:     "#083C48",
        .rule:          "#0E4451",

        .alertNote:      "#58A6DE",
        .alertTip:       "#859900",
        .alertImportant: "#9A9AE0",
        .alertWarning:   "#B58900",
        // Solarized red on base03 is 3.3:1 - the one accent that has to come up here.
        .alertCaution:   "#E56866",

        .hlKeyword:     "#859900",
        .hlString:      "#2AA198",
        .hlNumber:      "#D33682",
        .hlTitle:       "#58A6DE",
        .hlComment:     "#586E75",
        .hlVariable:    "#B58900",
        .hlType:        "#CB4B16",
        .hlMeta:        "#586E75"
    ])

    // MARK: GitHub Light - Primer

    /// The neutral option: plain white stock, no warmth at all. Links sit a shade darker
    /// than the accent so a link inside a selected row is still distinguishable.
    static let github = Theme(id: .github, title: "GitHub Light", hex: [
        .bg:            "#FFFFFF",
        .surface:       "#F6F8FA",
        .sidebarBg:     "#F6F8FA",
        .text:          "#1F2328",
        .muted:         "#656D76",
        .border:        "#D0D7DE",
        .borderStrong:  "#AFB8C1",
        .accent:        "#0969DA",
        .link:          "#0550AE",
        .selection:     "#DDF4FF",
        .codeBg:        "#F6F8FA",
        .codeBorder:    "#D0D7DE",
        .quoteBar:      "#D0D7DE",
        .quoteText:     "#656D76",
        .tableStripe:   "#FAFBFC",
        .tableHead:     "#EAEEF2",
        .rule:          "#D0D7DE",

        // Primer ships these five for its own alerts, and they already clear the gate.
        .alertNote:      "#0550AE",
        .alertTip:       "#116329",
        .alertImportant: "#8250DF",
        .alertWarning:   "#9A6700",
        .alertCaution:   "#CF222E",

        .hlKeyword:     "#CF222E",
        .hlString:      "#0A3069",
        .hlNumber:      "#0550AE",
        .hlTitle:       "#8250DF",
        .hlComment:     "#6E7781",
        .hlVariable:    "#953800",
        .hlType:        "#953800",
        .hlMeta:        "#6E7781"
    ])

    // MARK: Nord - Arctic Ice Studio

    /// Cool polar night stock with the frost blues as accent. Muted sits between nord3 and
    /// nord4; nord3 alone is too dark to read as secondary text on nord0.
    static let nord = Theme(id: .nord, title: "Nord", hex: [
        .bg:            "#2E3440",
        .surface:       "#3B4252",
        .sidebarBg:     "#292E39",
        .text:          "#ECEFF4",
        .muted:         "#98A3B7",
        .border:        "#3B4252",
        .borderStrong:  "#4C566A",
        .accent:        "#88C0D0",
        .link:          "#81A1C1",
        .selection:     "#434C5E",
        .codeBg:        "#3B4252",
        .codeBorder:    "#434C5E",
        .quoteBar:      "#4C566A",
        .quoteText:     "#D8DEE9",
        .tableStripe:   "#333A47",
        .tableHead:     "#3F4757",
        .rule:          "#434C5E",

        .alertNote:      "#81A1C1",
        .alertTip:       "#A3BE8C",
        // nord15 and nord11 both sit under the gate on nord0; lifted, not swapped for
        // another hue - Aurora only has the one purple and the one red.
        .alertImportant: "#B793B0",
        .alertWarning:   "#EBCB8B",
        .alertCaution:   "#D08B91",

        .hlKeyword:     "#81A1C1",
        .hlString:      "#A3BE8C",
        .hlNumber:      "#B48EAD",
        .hlTitle:       "#88C0D0",
        .hlComment:     "#616E88",
        .hlVariable:    "#D8DEE9",
        .hlType:        "#8FBCBB",
        .hlMeta:        "#616E88"
    ])

    /// The loud one. Muted is lifted off the canonical #6272A4 comment color, which is
    /// under 3:1 against the background and unreadable as UI text.
    static let dracula = Theme(id: .dracula, title: "Dracula", hex: [
        .bg:            "#282A36",
        .surface:       "#343746",
        .sidebarBg:     "#21222C",
        .text:          "#F8F8F2",
        .muted:         "#9BA3C4",
        .border:        "#363948",
        .borderStrong:  "#474A5C",
        .accent:        "#FF79C6",
        .link:          "#8BE9FD",
        .selection:     "#44475A",
        .codeBg:        "#343746",
        .codeBorder:    "#44475A",
        .quoteBar:      "#6272A4",
        .quoteText:     "#C7CAE0",
        .tableStripe:   "#2D2F3D",
        .tableHead:     "#383B4B",
        .rule:          "#44475A",

        .alertNote:      "#8BE9FD",
        .alertTip:       "#50FA7B",
        .alertImportant: "#BD93F9",
        .alertWarning:   "#FFB86C",
        .alertCaution:   "#FF5858",

        .hlKeyword:     "#FF79C6",
        .hlString:      "#F1FA8C",
        .hlNumber:      "#BD93F9",
        .hlTitle:       "#50FA7B",
        .hlComment:     "#6272A4",
        .hlVariable:    "#8BE9FD",
        .hlType:        "#FFB86C",
        .hlMeta:        "#6272A4"
    ])

    // MARK: Gruvbox Dark - morhetz

    /// The closest of the ports to the house pair: warm retro stock, warm ink, orange accent.
    static let gruvbox = Theme(id: .gruvbox, title: "Gruvbox Dark", hex: [
        .bg:            "#282828",
        .surface:       "#32302F",
        .sidebarBg:     "#1D2021",
        .text:          "#EBDBB2",
        .muted:         "#A89984",
        .border:        "#3C3836",
        .borderStrong:  "#504945",
        .accent:        "#FE8019",
        .link:          "#83A598",
        .selection:     "#45403C",
        .codeBg:        "#32302F",
        .codeBorder:    "#3C3836",
        .quoteBar:      "#665C54",
        .quoteText:     "#D5C4A1",
        .tableStripe:   "#2E2B2A",
        .tableHead:     "#3C3836",
        .rule:          "#3C3836",

        .alertNote:      "#83A598",
        .alertTip:       "#B8BB26",
        .alertImportant: "#D3869B",
        .alertWarning:   "#FABD2F",
        .alertCaution:   "#FB5946",

        .hlKeyword:     "#FB4934",
        .hlString:      "#B8BB26",
        .hlNumber:      "#D3869B",
        .hlTitle:       "#FABD2F",
        .hlComment:     "#928374",
        .hlVariable:    "#83A598",
        .hlType:        "#FE8019",
        .hlMeta:        "#928374"
    ])
}

// swiftlint:enable colon
