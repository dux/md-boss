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

    // MARK: External changes
    //
    // `syncWithDisk` is called directly rather than waiting on the two-second poll or on a
    // kqueue event - both would make these tests wall-clock bound and flaky.

    @Test("an external write to a clean buffer is taken silently")
    func adoptsExternalWriteWhenClean() throws {
        let root = try Fixture.make(["a.md": "before\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        let before = document.reloadToken

        try "after\n".write(to: url, atomically: false, encoding: .utf8)
        document.syncWithDisk()

        #expect(document.text == "after\n")
        #expect(!document.isDirty)
        #expect(document.externalChange == nil)
        // Without a new token the text view never takes the string.
        #expect(document.reloadToken != before)
    }

    @Test("an external reload says so")
    func announcesExternalReload() throws {
        let root = try Fixture.make(["a.md": "before\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        Toast.shared.dismiss()

        try "after\n".write(to: url, atomically: false, encoding: .utf8)
        document.syncWithDisk()

        // Replacing the whole document without a word is what this is not.
        #expect(Toast.shared.current?.text == "Reloaded a.md")
        #expect(Toast.shared.current?.kind == .info)
    }

    @Test("an external write against unsaved edits raises a conflict")
    func reportsConflictWhenDirty() throws {
        let root = try Fixture.make(["a.md": "before\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        document.text = "mine\n"

        try "theirs\n".write(to: url, atomically: false, encoding: .utf8)
        document.syncWithDisk()

        #expect(document.externalChange == .conflict)
        #expect(document.text == "mine\n")
    }

    @Test("an atomic external write reloads rather than reading as a deletion")
    func survivesAtomicWrite() throws {
        let root = try Fixture.make(["a.md": "before\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)

        // What every formatter and `sed -i` does: write a temp file, rename it over the path.
        // kqueue reports that as the watched inode being deleted.
        try "after\n".write(to: url, atomically: true, encoding: .utf8)
        document.syncWithDisk()

        #expect(document.externalChange == nil)
        #expect(document.text == "after\n")

        // And detection has to survive it - a second rewrite must land too.
        try "again\n".write(to: url, atomically: true, encoding: .utf8)
        document.syncWithDisk()

        #expect(document.text == "again\n")
    }

    @Test("a rewrite of the same length is still noticed")
    func noticesSameLengthRewrite() throws {
        let root = try Fixture.make(["a.md": "aaa\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)

        try "bbb\n".write(to: url, atomically: true, encoding: .utf8)
        document.syncWithDisk()

        #expect(document.text == "bbb\n")
    }

    @Test("a deleted file is reported as detached")
    func reportsDeletion() throws {
        let root = try Fixture.make(["a.md": "gone soon\n"])
        defer { Fixture.remove(root) }
        let url = root.appendingPathComponent("a.md")

        let document = MarkdownDocument(url: url)
        try FileManager.default.removeItem(at: url)
        document.syncWithDisk()

        #expect(document.externalChange == .detached)
        // The buffer is the only copy left, so it stays.
        #expect(document.text == "gone soon\n")
    }

    @Test("our own save is not mistaken for someone else's write")
    func ignoresOurOwnWrite() throws {
        let root = try Fixture.make(["a.md": "one\n"])
        defer { Fixture.remove(root) }

        let document = MarkdownDocument(url: root.appendingPathComponent("a.md"))
        document.text = "two\n"
        document.save()

        let token = document.reloadToken
        document.syncWithDisk()

        #expect(document.externalChange == nil)
        #expect(document.reloadToken == token)
    }
}
