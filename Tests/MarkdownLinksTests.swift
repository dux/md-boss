import Testing
import Foundation
@testable import MdBoss

// Synthetic /work paths throughout, so nothing depends on the /var -> /private/var symlink
// that a temp-directory fixture would drag in.
private let work = URL(fileURLWithPath: "/work/notes")

private func url(_ path: String) -> URL {
    URL(fileURLWithPath: "/work/notes/\(path)")
}

@Suite("Relative paths")
struct RelativePathTests {
    @Test("a sibling is prefixed, not bare")
    func sibling() {
        #expect(MarkdownLinks.relativePath(from: work, to: url("a.md")) == "./a.md")
    }

    @Test("a file below reads as one path")
    func child() {
        #expect(MarkdownLinks.relativePath(from: work, to: url("sub/a.md")) == "./sub/a.md")
    }

    @Test("climbing out is not prefixed")
    func parent() {
        #expect(MarkdownLinks.relativePath(from: url("sub"), to: url("a.md")) == "../a.md")
        #expect(MarkdownLinks.relativePath(from: url("sub/deep"), to: url("a.md")) == "../../a.md")
    }

    @Test("a cousin climbs then descends")
    func cousin() {
        #expect(MarkdownLinks.relativePath(from: url("sub"), to: url("other/a.md")) == "../other/a.md")
    }

    @Test("characters that would end the destination are encoded")
    func encodesDestinationBreakers() {
        #expect(MarkdownLinks.relativePath(from: work, to: url("my notes.md")) == "./my%20notes.md")
        #expect(MarkdownLinks.relativePath(from: work, to: url("a#b.md")) == "./a%23b.md")
        #expect(MarkdownLinks.relativePath(from: work, to: url("a(1).md")) == "./a%281%29.md")
        #expect(MarkdownLinks.relativePath(from: work, to: url("100%.md")) == "./100%25.md")
    }

    @Test("angle brackets are never emitted")
    func neverUsesAngleBrackets() {
        let path = MarkdownLinks.relativePath(from: work, to: url("a b (c).md"))
        #expect(!path.contains("<"))
        #expect(!path.contains(">"))
    }
}

@Suite("Link snippets")
struct LinkSnippetTests {
    @Test("a document keeps its extension in the link text")
    func document() {
        #expect(MarkdownLinks.snippet(for: url("sub/notes.md"), relativeTo: work) == "[notes.md](./sub/notes.md)")
    }

    @Test("an image is an embed, case-insensitively")
    func image() {
        #expect(MarkdownLinks.snippet(for: url("img/shot.png"), relativeTo: work) == "![shot.png](./img/shot.png)")
        #expect(MarkdownLinks.snippet(for: url("img/SHOT.JPEG"), relativeTo: work) == "![SHOT.JPEG](./img/SHOT.JPEG)")
    }

    @Test("anything else is a plain link")
    func other() {
        #expect(MarkdownLinks.snippet(for: url("spec.pdf"), relativeTo: work) == "[spec.pdf](./spec.pdf)")
    }

    @Test("brackets in the name are escaped so they cannot close the link text")
    func escapesLinkText() {
        #expect(MarkdownLinks.snippet(for: url("a[1].md"), relativeTo: work) == "[a\\[1\\].md](./a%5B1%5D.md)")
    }
}

@Suite("Link scanning")
struct LinkScanningTests {
    private func raws(_ text: String) -> [String] {
        MarkdownLinks.destinations(in: text).map(\.raw)
    }

    @Test("links and images are both found, and told apart")
    func findsBoth() {
        let found = MarkdownLinks.destinations(in: "see [a](./a.md) and ![b](./b.png)")
        #expect(found.map(\.raw) == ["./a.md", "./b.png"])
        #expect(found.map(\.isImage) == [false, true])
    }

    @Test("link text can nest brackets and an image of its own")
    func nesting() {
        #expect(raws("[see [1]](./a.md)") == ["./a.md"])
        #expect(raws("[![x](./x.png) more](./a.md)") == ["./x.png", "./a.md"])
    }

    @Test("the angle-bracket form is read without its brackets")
    func angleBrackets() {
        #expect(raws("[a](<my file.md>)") == ["my file.md"])
    }

    @Test("balanced parentheses stay part of the destination")
    func balancedParens() {
        #expect(raws("[a](./a(1).md)") == ["./a(1).md"])
    }

    @Test("a title is not part of the destination")
    func title() {
        let found = MarkdownLinks.destinations(in: "[a](./a.md \"The Title\")")
        #expect(found.map(\.raw) == ["./a.md"])
    }

    @Test("fenced blocks are skipped, on either marker")
    func fences() {
        #expect(raws("```\n[a](./a.md)\n```\n[b](./b.md)") == ["./b.md"])
        #expect(raws("~~~\n[a](./a.md)\n~~~\n[b](./b.md)") == ["./b.md"])
    }

    @Test("a fence closes only on a run at least as long as its opener")
    func fenceLength() {
        #expect(raws("````\n```\n[a](./a.md)\n````\n[b](./b.md)") == ["./b.md"])
    }

    @Test("inline code spans are skipped, whatever their run length")
    func codeSpans() {
        #expect(raws("`[a](./a.md)` and [b](./b.md)") == ["./b.md"])
        #expect(raws("``a ` [x](./x.md)`` and [b](./b.md)") == ["./b.md"])
    }

    @Test("escaped brackets do not open a link")
    func escapes() {
        #expect(raws("\\[not a link\\](./a.md) [b](./b.md)") == ["./b.md"])
    }

    @Test("reference definitions and shortcut references are left alone")
    func references() {
        #expect(raws("[id]: ./a.md\n[x][id]\n[y][]").isEmpty)
    }

    @Test("a stray bracket-paren in prose does not eat the rest of the file")
    func straySyntax() {
        #expect(raws("a ]( b\n[c](./c.md)") == ["./c.md"])
    }
}

@Suite("Link rewriting")
struct LinkRewritingTests {
    private let moves = [MarkdownLinks.Move(old: url("a.md"), new: url("sub/a.md"))]

    private func rewrite(_ text: String, in directory: URL = work) -> String? {
        MarkdownLinks.rewriting(text, in: directory, applying: moves)?.text
    }

    @Test("only the destinations that point at the moved file change")
    func rewritesMatchesOnly() {
        #expect(rewrite("[a](./a.md) and [b](./b.md)") == "[a](./sub/a.md) and [b](./b.md)")
    }

    @Test("a link from a subfolder is recomputed from where it lives")
    func fromSubfolder() {
        #expect(rewrite("[a](../a.md)", in: url("deep")) == "[a](../sub/a.md)")
    }

    @Test("an absolute or tilde destination follows the move too")
    func absoluteForms() {
        #expect(rewrite("[a](/work/notes/a.md)") == "[a](./sub/a.md)")
    }

    @Test("an anchor survives the rewrite")
    func keepsFragment() {
        #expect(rewrite("[a](./a.md#plan)") == "[a](./sub/a.md#plan)")
    }

    @Test("an editor-style line suffix survives the rewrite")
    func keepsLineSuffix() {
        #expect(rewrite("[a](./a.md:14)") == "[a](./sub/a.md:14)")
        #expect(rewrite("[a](./a.md:14:3)") == "[a](./sub/a.md:14:3)")
    }

    @Test("a percent-encoded destination is matched after decoding")
    func matchesEncoded() {
        let spaced = [MarkdownLinks.Move(old: url("my notes.md"), new: url("sub/my notes.md"))]
        let result = MarkdownLinks.rewriting("[a](./my%20notes.md)", in: work, applying: spaced)
        #expect(result?.text == "[a](./sub/my%20notes.md)")
    }

    @Test("external links are never touched")
    func leavesExternalAlone() {
        let text = "[a](https://example.com/a.md) [b](mailto:x@y.z) [c](#a.md)"
        #expect(rewrite(text) == nil)
    }

    @Test("a title and the link text come through untouched")
    func keepsSurroundings() {
        #expect(rewrite("[the **a**](./a.md \"Title\")") == "[the **a**](./sub/a.md \"Title\")")
    }

    @Test("two links on one line are both rewritten and counted")
    func countsEveryHit() {
        let result = MarkdownLinks.rewriting("[a](./a.md) [again](./a.md)", in: work, applying: moves)
        #expect(result?.count == 2)
        #expect(result?.text == "[a](./sub/a.md) [again](./sub/a.md)")
    }

    @Test("nothing to do is nil, so the caller never writes the file back")
    func nilWhenUnchanged() {
        #expect(rewrite("no links here") == nil)
        #expect(rewrite("[b](./b.md)") == nil)
    }

    @Test("Windows line endings are not normalised on the way through")
    func keepsCRLF() {
        #expect(rewrite("one\r\n[a](./a.md)\r\ntwo") == "one\r\n[a](./sub/a.md)\r\ntwo")
    }

    @Test("a link inside a fenced block is left broken rather than silently edited")
    func skipsFencedBlocks() {
        #expect(rewrite("```\n[a](./a.md)\n```") == nil)
    }
}
