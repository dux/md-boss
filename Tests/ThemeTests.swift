import Testing
import SwiftUI
@testable import MdBoss

private let allThemes: [Theme] = Theme.all

/// Declared rather than derived, so a bad luminance threshold shows up as a failing test
/// instead of a light theme with a dark titlebar.
private let expectedPolarity: [ThemeID: Bool] = [
    .paper: false, .dark: true,
    .solarizedLight: false, .solarizedDark: true,
    .github: false, .nord: true, .dracula: true, .gruvbox: true
]

@Suite("Theme")
struct ThemeTests {
    @Test("every palette defines every token", arguments: allThemes)
    func palettesAreComplete(theme: Theme) {
        let missing = ThemeToken.allCases.filter { theme.hex[$0] == nil }
        #expect(missing.isEmpty, "\(theme.id.rawValue) is missing: \(missing.map(\.rawValue))")
    }

    @Test("every token value is a #RRGGBB literal", arguments: allThemes)
    func valuesAreHex(theme: Theme) {
        for token in ThemeToken.allCases {
            #expect(Color.isValidHex(theme.value(token)), "\(theme.id.rawValue).\(token.rawValue) = \(theme.value(token))")
        }
    }

    @Test("no palette carries a stale token the enum dropped", arguments: allThemes)
    func noOrphanTokens(theme: Theme) {
        #expect(theme.hex.count == ThemeToken.allCases.count)
    }

    @Test("no two themes carry the same palette")
    func palettesDiffer() {
        for (index, theme) in allThemes.enumerated() {
            for other in allThemes.dropFirst(index + 1) {
                #expect(theme.hex != other.hex, "\(theme.id.rawValue) == \(other.id.rawValue)")
            }
        }
    }

    @Test("every id has exactly one palette", arguments: ThemeID.allCases)
    func everyIDIsCovered(id: ThemeID) {
        // Theme.named falls back to paper, so a case added to the enum without a palette
        // would silently resolve to the wrong theme rather than failing to compile.
        #expect(allThemes.filter { $0.id == id }.count == 1)
    }

    @Test("polarity follows the background", arguments: allThemes)
    func polarityMatchesBackground(theme: Theme) {
        #expect(theme.isDark == expectedPolarity[theme.id])
        #expect(theme.appearance == (theme.isDark ? .darkAqua : .aqua))
    }

    /// The gate that keeps a ported scheme from shipping a washed-out reading pane:
    /// several canonical palettes put body text at ~4.5:1, which is a terminal contrast,
    /// not a long-form reading one.
    @Test("body text clears 7:1 against its own background", arguments: allThemes)
    func textIsReadable(theme: Theme) {
        let ratio = Color.contrast(theme.value(.text), theme.value(.bg))
        #expect(ratio >= 7, "\(theme.id.rawValue) text on bg is \(ratio):1")
    }

    /// Secondary text is still text. 4.5:1 is the WCAG AA body threshold.
    @Test("muted text clears 4.5:1 against its own background", arguments: allThemes)
    func mutedIsReadable(theme: Theme) {
        let ratio = Color.contrast(theme.value(.muted), theme.value(.bg))
        #expect(ratio >= 4.5, "\(theme.id.rawValue) muted on bg is \(ratio):1")
    }

    @Test("rootCSS emits one custom property per token plus a color-scheme")
    func rootCSSIsComplete() {
        for theme in allThemes {
            let css = theme.rootCSS
            for token in ThemeToken.allCases {
                #expect(css.contains("--\(token.rawValue): \(theme.value(token));"))
            }
            #expect(css.contains("color-scheme: \(theme.isDark ? "dark" : "light")"))
        }
    }

    @Test("named() round-trips through the id")
    func namedRoundTrips() {
        for id in ThemeID.allCases {
            #expect(Theme.named(id).id == id)
        }
    }

    @Test("bad hex is rejected rather than silently parsed")
    func hexValidation() {
        #expect(Color.isValidHex("#FBF7EF"))
        #expect(Color.isValidHex("FBF7EF"))
        #expect(!Color.isValidHex("#FBF7E"))
        #expect(!Color.isValidHex("#GGGGGG"))
        #expect(!Color.isValidHex(""))
    }

    @Test("contrast is the WCAG ratio")
    func contrastRatio() {
        #expect(Color.contrast("#000000", "#FFFFFF") == 21)
        #expect(Color.contrast("#FFFFFF", "#FFFFFF") == 1)
        // Symmetric - the order of the two colors must not matter.
        #expect(Color.contrast("#1F2328", "#FFFFFF") == Color.contrast("#FFFFFF", "#1F2328"))
    }
}

@Suite("Theme choice")
struct ThemeChoiceTests {
    @Test("picking a theme records it on its own side", arguments: allThemes)
    func selectingRecordsSide(theme: Theme) {
        let choice = ThemeChoice().selecting(theme.id)
        #expect(choice.active == theme.id)
        #expect((theme.isDark ? choice.dark : choice.light) == theme.id)
    }

    @Test("the toggle flips polarity from every theme", arguments: allThemes)
    func toggleFlipsPolarity(theme: Theme) {
        let flipped = ThemeChoice().selecting(theme.id).flipped
        #expect(Theme.named(flipped.active).isDark != theme.isDark)
    }

    @Test("toggling twice returns to the theme you started on", arguments: allThemes)
    func toggleRoundTrips(theme: Theme) {
        let start = ThemeChoice().selecting(theme.id)
        #expect(start.flipped.flipped.active == theme.id)
    }

    @Test("the toggle remembers the last theme used on each side")
    func toggleRemembers() {
        // Nord, then back to a light theme, then Cmd-Shift-D again lands on Nord - not Dark.
        let choice = ThemeChoice().selecting(.nord).selecting(.solarizedLight)
        #expect(choice.flipped.active == .nord)
    }

    @Test("a stored id on the wrong side is dropped, so the toggle is never a no-op")
    func wrongSidedStorageIsIgnored() {
        let corrupt = ThemeChoice(active: .paper, light: .paper, dark: .github)
        #expect(corrupt.dark == .dark)
        #expect(Theme.named(corrupt.flipped.active).isDark)
    }
}

@Suite("JS literals")
struct JSLiteralTests {
    @Test("a closing script tag cannot escape the literal")
    func escapesClosingTag() {
        let literal = JSLiteral.string("before </script> after")
        #expect(!literal.contains("</script>"))
        #expect(literal.contains("<\\/script>"))
    }

    @Test("quotes, backslashes and newlines survive")
    func escapesControlCharacters() {
        let literal = JSLiteral.string("a\"b\\c\nd")
        #expect(literal.hasPrefix("\""))
        #expect(literal.hasSuffix("\""))
        #expect(literal.contains("\\\""))
        #expect(literal.contains("\\n"))
    }

    @Test("backticks and dollars need no special casing")
    func passesThroughTemplateCharacters() {
        // Unlike a template literal, a JSON string literal has nothing special to say
        // about ` or ${ - which is the reason for using one.
        let literal = JSLiteral.string("`${x}`")
        #expect(literal == "\"`${x}`\"")
    }
}
