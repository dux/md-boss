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

@Suite("File rename checks")
struct FileRenameCheckTests {
    @Test("the name it already has is a no-op, not an error")
    func unchanged() throws {
        let root = try Fixture.make(["a.md": "# a"])
        defer { Fixture.remove(root) }

        let source = root.appendingPathComponent("a.md")
        let refusal = FileMove.checkRename(source, to: "a.md")
        #expect(refusal == .unchanged)
        #expect(refusal?.message(forRenaming: source, to: "a.md") == nil)
    }

    /// Every one of these would put the file somewhere the sidebar cannot show it.
    @Test("a name that is not a file name is refused", arguments: ["", ".", "..", ".hidden.md", "sub/a.md", "a:b.md"])
    func badNames(name: String) throws {
        let root = try Fixture.make(["a.md": "# a"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("a.md"), to: name) == .badName)
    }

    @Test("a name already taken in the folder refuses before anything is touched")
    func collision() throws {
        let root = try Fixture.make(["a.md": "# a", "b.md": "# b"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("a.md"), to: "b.md") == .exists)
    }

    /// On a case-insensitive volume the target "already exists" - it is the source. Identity
    /// is what tells that from a collision, so this must pass either way.
    @Test("changing only the case of a name is a rename, not a collision")
    func caseOnly() throws {
        let root = try Fixture.make(["plan.md": "# a"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("plan.md"), to: "Plan.md") == nil)
    }

    @Test("folders are refused - every document inside would need repointing")
    func folder() throws {
        let root = try Fixture.make(["sub/a.md": "# a"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("sub"), to: "other") == .notAFile)
    }

    @Test("a source that is gone is refused")
    func missing() throws {
        let root = try Fixture.make(["a.md": "# a"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("gone.md"), to: "b.md") == .missingSource)
    }

    @Test("a legal rename refuses nothing")
    func allowed() throws {
        let root = try Fixture.make(["a.md": "# a"])
        defer { Fixture.remove(root) }

        #expect(FileMove.checkRename(root.appendingPathComponent("a.md"), to: "b.md") == nil)
    }

    /// The point of routing a rename through `FileMove`: inbound links are repointed by the
    /// same pass a move uses, so a renamed file does not leave every reference to it dead -
    /// and a link inside a fenced block is left alone, which is the failure mode that matters.
    @Test("a rename repoints inbound links the way a move does, fences excepted")
    func repointsInboundLinks() throws {
        let root = try Fixture.make([
            "a.md": "# a",
            "index.md": "see [a](./a.md)",
            "deep/x.md": "see [a](../a.md) and [a](../a.md)\n\n```\n[a](../a.md)\n```\n"
        ])
        defer { Fixture.remove(root) }

        let rewrites = FileMove.plan(
            root: root,
            skipFolders: [],
            moves: [MarkdownLinks.Move(
                old: root.appendingPathComponent("a.md"),
                new: root.appendingPathComponent("b.md")
            )]
        ).sorted { $0.url.lastPathComponent < $1.url.lastPathComponent }

        #expect(rewrites.map { $0.url.lastPathComponent } == ["index.md", "x.md"])
        #expect(rewrites.map(\.count) == [1, 2])
        #expect(rewrites.map(\.text) == [
            "see [a](./b.md)",
            "see [a](../b.md) and [a](../b.md)\n\n```\n[a](../a.md)\n```\n"
        ])
    }

    /// The other half of a rename: the notes on the file follow it to the new name, and
    /// nothing else in the store moves. `relocate` runs both passes for move and rename alike.
    @Test("a rename takes the file's notes with it")
    func repointsNotes() throws {
        let file = AnnotationFile(notes: [
            Note(path: "~/work/a.md", line: 4, title: "Fourth"),
            Note(path: "~/work/index.md", line: 1, body: "keep me")
        ])

        let split = try #require(file.repointing(from: "~/work/a.md", to: "~/work/b.md"))
        #expect(split.moved.map(\.path) == ["~/work/b.md"])
        #expect(split.moved.map(\.line) == [4])
        #expect(split.kept.notes.map(\.path) == ["~/work/index.md"])
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
