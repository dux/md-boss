import Testing
import Foundation
@testable import MdBoss

@Suite("Markdown link targets")
struct MarkdownLinkTargetTests {
    @Test("http and mailto links go out to the system")
    func classifiesExternal() {
        for string in ["https://apple.com", "http://example.com/a", "mailto:a@b.c"] {
            guard let url = URL(string: string) else {
                Issue.record("bad fixture \(string)")
                return
            }
            #expect(MarkdownLinkTarget.resolve(url) == .external(url))
        }
    }

    @Test("an existing file resolves to a preview target")
    func classifiesFile() throws {
        let root = try Fixture.make(["notes.md": "# notes"])
        defer { Fixture.remove(root) }
        let file = root.appendingPathComponent("notes.md")

        #expect(MarkdownLinkTarget.resolve(file) == .file(PreviewTarget(file.standardizedFileURL)))
    }

    @Test("a fragment rides alongside the URL, not inside it")
    func carriesFragment() throws {
        let root = try Fixture.make(["notes.md": "# notes"])
        defer { Fixture.remove(root) }
        let file = root.appendingPathComponent("notes.md")

        guard var components = URLComponents(url: file, resolvingAgainstBaseURL: false) else {
            Issue.record("could not build components")
            return
        }
        components.fragment = "some-heading"
        guard let withFragment = components.url else {
            Issue.record("could not build url")
            return
        }

        guard case .file(let target) = MarkdownLinkTarget.resolve(withFragment) else {
            Issue.record("expected .file")
            return
        }
        #expect(target.fragment == "some-heading")
        // The fragment must not survive in the URL - Data(contentsOf:) would fail on it.
        #expect(target.url.fragment == nil)
    }

    @Test("an existing directory resolves to a directory")
    func classifiesDirectory() throws {
        let root = try Fixture.make(["docs/a.md": "# a"])
        defer { Fixture.remove(root) }

        let docs = root.appendingPathComponent("docs")
        #expect(MarkdownLinkTarget.resolve(docs) == .directory(docs.standardizedFileURL))
    }

    @Test("an editor-style :14 suffix is stripped only after the literal path misses")
    func stripsLineSuffix() throws {
        let root = try Fixture.make(["Foo.swift": "// code"])
        defer { Fixture.remove(root) }
        let file = root.appendingPathComponent("Foo.swift")

        let withLine = URL(fileURLWithPath: file.path + ":14")
        #expect(MarkdownLinkTarget.resolve(withLine) == .file(PreviewTarget(file.standardizedFileURL)))
    }

    @Test("nothing on disk resolves to missing")
    func classifiesMissing() {
        let ghost = URL(fileURLWithPath: "/tmp/md-boss-nope-\(UUID().uuidString).md")
        #expect(MarkdownLinkTarget.resolve(ghost) == .missing(ghost.standardizedFileURL.path))
    }
}

@Suite("Local file scheme")
struct LocalFileSchemeHandlerTests {
    @Test("paths round-trip through the base64url encoding")
    func roundTripsPaths() {
        for path in ["/a/b.png", "/Users/dux/my docs/diagram (1).png", "/tmp/ünïcödé/ø.png"] {
            let src = LocalFileSchemeHandler.src(for: URL(fileURLWithPath: path))
            guard let url = URL(string: src) else {
                Issue.record("unencodable src for \(path)")
                return
            }
            #expect(LocalFileSchemeHandler.decodePath(from: url) == path)
        }
    }

    @Test("the encoding is URL-safe - no +, / or = in the payload")
    func producesURLSafeOutput() {
        let src = LocalFileSchemeHandler.src(for: URL(fileURLWithPath: "/aaa/bbb/ccc?>~"))
        guard let payload = src.split(separator: "/").last else {
            Issue.record("no payload")
            return
        }
        #expect(!payload.contains("+"))
        #expect(!payload.contains("="))
    }
}

@Suite("Preview page")
struct MarkdownPageBuilderTests {
    @Test("bundled resources are present in the module bundle")
    func bundlesResources() {
        #expect(Bundled.markedJS.contains("marked"))
        #expect(!Bundled.highlightJS.isEmpty)
        #expect(Bundled.previewJS.contains("mdRender"))
        #expect(Bundled.previewCSS.contains("--serif"))
    }

    @Test("preview.css never sniffs the colour scheme")
    func cssDoesNotSniffColourScheme() {
        // The page is told which theme to use; a media query could disagree with the app.
        #expect(!Bundled.previewCSS.contains("prefers-color-scheme"))
    }

    @Test("a document containing a closing script tag cannot break the page")
    func survivesClosingScriptTag() {
        let page = MarkdownPageBuilder.page(
            markdown: "```html\n</script><script>alert(1)</script>\n```",
            theme: .paper,
            fontSize: 17,
            nonce: "abc"
        )
        // The only closing script tags are ours, one per <script> we emit.
        #expect(page.components(separatedBy: "</script>").count - 1 == 4)
    }

    @Test("the policy carries the nonce and blocks remote loads")
    func emitsContentSecurityPolicy() {
        let page = MarkdownPageBuilder.page(markdown: "# hi", theme: .dark, fontSize: 17, nonce: "n0nce")
        #expect(page.contains("script-src 'nonce-n0nce'"))
        #expect(page.contains("default-src 'none'"))
        #expect(page.contains("connect-src 'none'"))
        #expect(page.contains("nonce=\"n0nce\""))
    }

    @Test("the theme reaches the page as tokens and a data attribute")
    func injectsTheme() {
        let page = MarkdownPageBuilder.page(markdown: "# hi", theme: .dark, fontSize: 21, nonce: "n")
        #expect(page.contains("data-theme=\"dark\""))
        #expect(page.contains("--bg: \(Theme.dark.value(.bg));"))
        #expect(page.contains("--body-size: 21px;"))
    }

    @Test("nonces differ between loads")
    func noncesAreUnique() {
        let nonces = Set((0..<32).map { _ in MarkdownPageBuilder.makeNonce() })
        #expect(nonces.count == 32)
    }
}
