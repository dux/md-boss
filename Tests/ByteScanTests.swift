import Testing
import Foundation
@testable import MdBoss

/// The prescan's only job is to skip files, so every test here is about the one-sided
/// contract: it may say yes about a file with nothing in it, and must never say no about one
/// that `DocumentSearch.matches` would have found something in.
@Suite("Byte prescan")
struct ByteScanTests {
    /// A query the scanner refuses to compile has no prescan, which means every file gets
    /// through - so "may contain" is the honest answer for it too.
    private func mayContain(_ text: String, _ query: String) -> Bool {
        guard let needle = ByteScan.Needle(query, caseSensitive: DocumentSearch.isCaseSensitive(query)) else {
            return true
        }
        return Data(text.utf8).withUnsafeBytes { needle.mayContain($0) }
    }

    /// What the prescan is a filter for. If Foundation finds it, the prescan must let it past.
    private func foundationFinds(_ text: String, _ query: String) -> Bool {
        !DocumentSearch.matches(in: text, query: query).isEmpty
    }

    private func check(_ text: String, _ query: String, sourceLocation: SourceLocation = #_sourceLocation) {
        guard foundationFinds(text, query) else { return }
        #expect(
            mayContain(text, query),
            "prescan skipped a file with a real match",
            sourceLocation: sourceLocation
        )
    }

    @Test("a plain match, either case rule")
    func plain() {
        #expect(mayContain("the needle is here", "needle"))
        #expect(mayContain("the NEEDLE is here", "needle"))
        #expect(!mayContain("the needle is here", "Needle"))
        #expect(mayContain("the Needle is here", "Needle"))
        #expect(!mayContain("nothing at all", "needle"))
    }

    @Test("matches at the very start and the very end are not skipped")
    func edges() {
        #expect(mayContain("needle at the front", "needle"))
        #expect(mayContain("at the back is needle", "needle"))
        #expect(mayContain("needle", "needle"))
        #expect(!mayContain("needl", "needle"))
    }

    /// A non-ASCII query cannot be folded soundly byte-wise, so it opts out entirely and
    /// every file is decoded, exactly as before.
    @Test("a non-ASCII query has no prescan at all")
    func nonASCIIQueryOptsOut() {
        #expect(ByteScan.Needle("naïve", caseSensitive: false) == nil)
        #expect(ByteScan.Needle("日本", caseSensitive: true) == nil)
        #expect(ByteScan.Needle("", caseSensitive: false) == nil)
        #expect(ByteScan.Needle("plain", caseSensitive: false) != nil)
    }

    /// The three scalars Foundation folds onto ASCII. A byte scan cannot see them, so the
    /// prescan has to fail open on any file that carries one.
    @Test("the scalars that fold into ASCII are never skipped")
    func foldEscapes() {
        // U+212A KELVIN SIGN folds to k, U+017F LONG S to s, U+00DF sharp s matches "ss".
        check("100 \u{212A}elvin", "kelvin")
        check("\u{017F}omething", "something")
        check("Stra\u{00DF}e", "strasse")

        #expect(mayContain("100 \u{212A}elvin", "kelvin"))
        #expect(mayContain("\u{017F}omething", "something"))
        #expect(mayContain("Stra\u{00DF}e", "strasse"))
    }

    /// The escape check is only worth running for queries that could benefit from it - a
    /// query with no k and no s must not be dragged through it.
    @Test("a query with no k or s does not fail open on those scalars")
    func escapesAreNarrow() {
        #expect(!mayContain("100 \u{212A}elvin", "moon"))
        #expect(!mayContain("Stra\u{00DF}e", "moon"))
    }

    @Test("ordinary non-ASCII text does not make the prescan give up")
    func unicodeText() {
        #expect(mayContain("a line with an em dash \u{2014} in it", "dash"))
        #expect(!mayContain("a line with an em dash \u{2014} in it", "needle"))
        #expect(mayContain("\u{1F600} emoji then needle", "needle"))
    }

    /// The skip table is what makes Horspool fast and is also the easiest thing to get
    /// wrong - a repeated pattern skips differently from a distinct one.
    @Test("repeated and single-character patterns still find their match")
    func skipTable() {
        #expect(mayContain("aaaaab", "aab"))
        #expect(!mayContain("aaaaa", "aab"))
        #expect(mayContain("xyz", "z"))
        #expect(!mayContain("xyz", "q"))
        #expect(mayContain("abcabcabd", "abcabd"))
    }

    /// The property that matters, over a spread of text and queries: agreement with the
    /// matcher the prescan is standing in front of.
    @Test("the prescan never disagrees with the matcher on a real corpus")
    func agreesWithMatcher() {
        let corpus = [
            "# Heading\n\nSome ordinary prose about kqueue and FSEvents.\n",
            "Straße, naïve, café \u{2014} accented words in a paragraph.\n",
            "100 \u{212A} is a Kelvin sign; \u{017F}o is a long s.\n",
            "\r\nCRLF lines\r\nwith needle on the second\r\n",
            "",
            "AAAA aaaa AaAa",
            "```swift\nlet x = Theme.all\n```\n"
        ]
        let queries = ["needle", "kqueue", "Theme", "theme", "kelvin", "s", "ss", "strasse", "aaa", "x"]

        for text in corpus {
            for query in queries {
                check(text, query)
            }
        }
    }
}
