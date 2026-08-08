import Testing
import Foundation
@testable import MdBoss

@Suite("File move checks")
struct FileMoveCheckTests {
    @Test("a file already in that folder is a no-op, not an error")
    func sameFolder() throws {
        let root = try Fixture.make(["a.md": "# a"])
        defer { Fixture.remove(root) }

        let refusal = FileMove.check(root.appendingPathComponent("a.md"), into: root)
        #expect(refusal == .sameFolder)
        #expect(refusal?.message(for: root, into: root) == nil)
    }

    @Test("a name already taken at the destination refuses before anything is touched")
    func collision() throws {
        let root = try Fixture.make(["a.md": "# a", "sub/a.md": "# other"])
        defer { Fixture.remove(root) }

        #expect(FileMove.check(
            root.appendingPathComponent("a.md"),
            into: root.appendingPathComponent("sub")
        ) == .exists)
    }

    @Test("folders are refused - their contents would each need repointing")
    func folder() throws {
        let root = try Fixture.make(["sub/a.md": "# a", "other/b.md": "# b"])
        defer { Fixture.remove(root) }

        #expect(FileMove.check(
            root.appendingPathComponent("sub"),
            into: root.appendingPathComponent("other")
        ) == .notAFile)
    }

    @Test("a destination that is a file, or gone, is refused")
    func badDestination() throws {
        let root = try Fixture.make(["a.md": "# a", "b.md": "# b"])
        defer { Fixture.remove(root) }

        #expect(FileMove.check(
            root.appendingPathComponent("a.md"),
            into: root.appendingPathComponent("b.md")
        ) == .badDestination)
        #expect(FileMove.check(
            root.appendingPathComponent("gone.md"),
            into: root
        ) == .missingSource)
    }

    @Test("a legal move refuses nothing")
    func allowed() throws {
        let root = try Fixture.make(["a.md": "# a", "sub/b.md": "# b"])
        defer { Fixture.remove(root) }

        #expect(FileMove.check(
            root.appendingPathComponent("a.md"),
            into: root.appendingPathComponent("sub")
        ) == nil)
    }
}

@Suite("File move plan")
struct FileMovePlanTests {
    /// Every fixture here moves `a.md` into `sub/`.
    private func plan(
        _ root: URL,
        buffers: [String: String] = [:],
        excluding: Set<String> = []
    ) -> [FileMove.Rewrite] {
        FileMove.plan(
            root: root,
            skipFolders: ["node_modules"],
            moves: [MarkdownLinks.Move(
                old: root.appendingPathComponent("a.md"),
                new: root.appendingPathComponent("sub/a.md")
            )],
            buffers: buffers,
            excluding: excluding
        )
    }

    @Test("only the documents that referenced the moved file are rewritten")
    func findsReferences() throws {
        let root = try Fixture.make([
            "index.md": "see [a](./a.md)",
            "unrelated.md": "see [b](./b.md)",
            "deep/x.md": "see [a](../a.md) twice [a](../a.md)"
        ])
        defer { Fixture.remove(root) }

        let rewrites = plan(root).sorted { $0.url.lastPathComponent < $1.url.lastPathComponent }
        #expect(rewrites.map { $0.url.lastPathComponent } == ["index.md", "x.md"])
        #expect(rewrites.map(\.count) == [1, 2])
        #expect(rewrites.map(\.text) == [
            "see [a](./sub/a.md)",
            "see [a](../sub/a.md) twice [a](../sub/a.md)"
        ])
    }

    @Test("skipped folders are never read")
    func honoursSkipFolders() throws {
        let root = try Fixture.make(["node_modules/vendored.md": "see [a](../a.md)"])
        defer { Fixture.remove(root) }

        #expect(plan(root).isEmpty)
    }

    @Test("an unsaved buffer wins over what is on disk")
    func prefersBuffers() throws {
        let root = try Fixture.make(["index.md": "nothing here"])
        defer { Fixture.remove(root) }

        let path = MarkdownLinks.canonical(root.appendingPathComponent("index.md")).path
        let rewrites = plan(root, buffers: [path: "typed [a](./a.md) but not saved"])
        #expect(rewrites.map(\.text) == ["typed [a](./sub/a.md) but not saved"])
    }

    @Test("an excluded file is never in the plan")
    func honoursExclusion() throws {
        let root = try Fixture.make(["index.md": "see [a](./a.md)"])
        defer { Fixture.remove(root) }

        let excluded = MarkdownLinks.canonical(root.appendingPathComponent("index.md")).path
        #expect(plan(root, excluding: [excluded]).isEmpty)
    }
}

@Suite("Documents under a folder")
struct DocumentWalkTests {
    @Test("recurses, keeps text files, skips code and skipped folders")
    func walks() throws {
        let root = try Fixture.make([
            "top.md": "# top",
            "notes.txt": "plain",
            "Package.swift": "// code",
            "deep/a/b/buried.md": "# buried",
            "node_modules/lib.md": "# vendored"
        ])
        defer { Fixture.remove(root) }

        let names = FileTree.documents(under: root, skipFolders: ["node_modules"])
            .map(\.lastPathComponent)
            .sorted()
        #expect(names == ["buried.md", "notes.txt", "top.md"])
    }
}
