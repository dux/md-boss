import Testing
import Foundation
@testable import MdBoss

@Suite("Markdown document")
@MainActor
struct DocumentTests {
    @Test("a freshly opened document is clean")
    func opensClean() throws {
        let root = try Fixture.make(["a.md": "# hello\n"])
        defer { Fixture.remove(root) }

        let document = MarkdownDocument(url: root.appendingPathComponent("a.md"))
        #expect(document.text == "# hello\n")
        #expect(!document.isDirty)
        #expect(!document.isReadOnly)
    }

    @Test("editing makes it dirty, saving makes it clean again")
    func tracksDirtyState() throws {
        let root = try Fixture.make(["a.md": "one\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        document.text = "two\n"
        #expect(document.isDirty)

        document.save()
        #expect(!document.isDirty)
        #expect(try String(contentsOf: url, encoding: .utf8) == "two\n")
    }

    @Test("editing back to the saved text is not dirty")
    func comparesAgainstSavedText() throws {
        let root = try Fixture.make(["a.md": "one\n"])
        defer { Fixture.remove(root) }

        let document = MarkdownDocument(url: root.appendingPathComponent("a.md"))
        document.text = "two\n"
        document.text = "one\n"
        #expect(!document.isDirty)
    }

    @Test("CRLF is normalised in the buffer and restored on save")
    func preservesWindowsLineEndings() throws {
        let root = try Fixture.make([:])
        defer { Fixture.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("crlf.md")
        try "one\r\ntwo\r\n".write(to: url, atomically: true, encoding: .utf8)

        let document = MarkdownDocument(url: url)
        // The editor never sees a carriage return.
        #expect(document.text == "one\ntwo\n")

        document.text = "one\ntwo edited\n"
        document.save()

        // Editing one line must not rewrite every line ending in the file.
        #expect(try String(contentsOf: url, encoding: .utf8) == "one\r\ntwo edited\r\n")
    }

    @Test("a file with no trailing newline keeps not having one")
    func doesNotAddTrailingNewline() throws {
        let root = try Fixture.make(["a.md": "no newline at end"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        document.text += "!"
        document.save()

        #expect(try String(contentsOf: url, encoding: .utf8) == "no newline at end!")
    }

    @Test("reverting throws away the buffer and bumps the reload token")
    func revertRestoresDisk() throws {
        let root = try Fixture.make(["a.md": "original\n"])
        defer { Fixture.remove(root) }

        let document = MarkdownDocument(url: root.appendingPathComponent("a.md"))
        let before = document.reloadToken
        document.text = "edited\n"
        document.revert()

        #expect(document.text == "original\n")
        #expect(!document.isDirty)
        // The token has to change or the text view will not take the new string.
        #expect(document.reloadToken != before)
    }

    @Test("a non-UTF-8 file opens read-only and is never written back")
    func refusesToTranscodeUnknownEncodings() throws {
        let root = try Fixture.make([:])
        defer { Fixture.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("latin1.md")
        // 0xE9 is é in Latin-1 and invalid on its own in UTF-8.
        try Data([0x63, 0x61, 0x66, 0xE9, 0x0A]).write(to: url)
        let originalBytes = try Data(contentsOf: url)

        let document = MarkdownDocument(url: url)
        #expect(document.isReadOnly)

        document.text = "rewritten\n"
        document.save()

        #expect(try Data(contentsOf: url) == originalBytes)
    }

    @Test("keeping my version dismisses the conflict without touching the buffer")
    func keepMineLeavesTextAlone() throws {
        let root = try Fixture.make(["a.md": "disk\n"])
        defer { Fixture.remove(root) }

        let document = MarkdownDocument(url: root.appendingPathComponent("a.md"))
        document.text = "mine\n"
        document.keepMine()

        #expect(document.text == "mine\n")
        #expect(document.isDirty)
        #expect(document.externalChange == nil)
    }
}
