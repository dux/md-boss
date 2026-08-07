import Testing
import SwiftUI
@testable import MdBoss

private let allThemes: [Theme] = [.paper, .dark]

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

    @Test("the two palettes are actually different", arguments: ThemeToken.allCases)
    func palettesDiffer(token: ThemeToken) {
        #expect(Theme.paper.value(token) != Theme.dark.value(token))
    }

    @Test("rootCSS emits one custom property per token plus a color-scheme")
    func rootCSSIsComplete() {
        for theme in allThemes {
            let css = theme.rootCSS
            for token in ThemeToken.allCases {
                #expect(css.contains("--\(token.rawValue): \(theme.value(token));"))
            }
            #expect(css.contains("color-scheme: \(theme.id == .dark ? "dark" : "light")"))
        }
    }

    @Test("named() round-trips through the id")
    func namedRoundTrips() {
        for id in ThemeID.allCases {
            #expect(Theme.named(id).id == id)
        }
    }

    @Test("toggling twice returns to the start")
    func nextIsAnInvolution() {
        for id in ThemeID.allCases {
            #expect(id.next.next == id)
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
