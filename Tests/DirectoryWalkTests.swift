import Testing
import Foundation
@testable import MdBoss

/// `DirectoryWalk` replaced `FileManager.enumerator` underneath `FileTree.documents` for
/// speed, so what these tests state is the contract rather than the implementation: the same
/// answer as the enumerator gave, on the trees where the two could plausibly disagree.
@Suite("Walking with readdir")
struct DirectoryWalkTests {
    /// What the walk used to be, kept here so parity is checked against the real thing
    /// rather than against a list of paths someone typed out.
    /// Both sides are reported relative to the root. `/var` is a symlink to `/private/var`
    /// on macOS and the enumerator resolves it while `readdir` does not, which is a
    /// difference about the temporary directory rather than about the walk.
    private func relative(_ paths: some Sequence<String>) -> Set<String> {
        Set(paths.map { path in
            guard let slash = path.range(of: "md-boss-tests-") else { return path }
            return String(path[slash.lowerBound...]).drop { $0 != "/" }.description
        })
    }

    private func enumerated(_ root: URL, skip: Set<String>) -> Set<String> {
        guard let walker = FileManager().enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var found: Set<String> = []
        for case let url as URL in walker {
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory {
                if skip.contains(url.lastPathComponent) { walker.skipDescendants() }
            } else if FileTree.isDocument(url) {
                found.insert(url.path)
            }
        }
        return relative(found)
    }

    private func walked(_ root: URL, skip: Set<String>) -> Set<String> {
        relative(DirectoryWalk.documents(under: root.path, skipFolders: skip))
    }

    @Test("a mixed tree answers exactly what the enumerator answered")
    func parity() throws {
        let root = try Fixture.make([
            "top.md": "a",
            // A different name, not a case variant of top.md - the volume these tests run on
            // is case-insensitive and the second write would land on the first file.
            "CAPS.MD": "case",
            "one/a.markdown": "a",
            "one/deep/deeper/b.txt": "b",
            "one/b.swift": "no",
            "one/no-extension": "no",
            "two/c.qmd": "c",
            "two/d.mdx": "no",
            "two/trailing.": "no",
            "node_modules/vendored.md": "no",
            "one/node_modules/also.md": "no",
            "three/.hidden.md": "no",
            "three/visible.md": "yes"
        ])
        defer { Fixture.remove(root) }
        // A dot-directory, which is hidden the same way a dot-file is.
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent(".git"), withIntermediateDirectories: true
        )
        try "no".write(to: root.appendingPathComponent(".git/config.md"), atomically: true, encoding: .utf8)

        let skip: Set<String> = ["node_modules"]
        #expect(walked(root, skip: skip) == enumerated(root, skip: skip))
        #expect(walked(root, skip: skip).count == 6)
    }

    @Test("a symlinked directory is listed through, not descended")
    func symlinkedDirectory() throws {
        let root = try Fixture.make(["real/inside.md": "a", "anchor.md": "b"])
        defer { Fixture.remove(root) }

        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("link"),
            withDestinationURL: root.appendingPathComponent("real")
        )

        // Descending it would report inside.md twice, and a link pointing at an ancestor
        // would not terminate at all.
        let found = walked(root, skip: [])
        #expect(found == enumerated(root, skip: []))
        #expect(found.filter { $0.hasSuffix("inside.md") }.count == 1)
    }

    @Test("a symlink to a document is a document")
    func symlinkedFile() throws {
        let root = try Fixture.make(["real.md": "a"])
        defer { Fixture.remove(root) }

        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("alias.md"),
            withDestinationURL: root.appendingPathComponent("real.md")
        )

        #expect(walked(root, skip: []) == enumerated(root, skip: []))
        #expect(walked(root, skip: []).count == 2)
    }

    @Test("skipped folders are skipped at every depth")
    func skipsFolders() throws {
        let root = try Fixture.make([
            "node_modules/a.md": "no",
            "one/node_modules/b.md": "no",
            "one/two/node_modules/c.md": "no",
            "one/two/yes.md": "yes"
        ])
        defer { Fixture.remove(root) }

        #expect(walked(root, skip: ["node_modules"]).map { ($0 as NSString).lastPathComponent } == ["yes.md"])
    }

    /// Within a directory documents come before subtrees and each group is sorted, so a tree
    /// answers the same way every time rather than in whatever order `readdir` happens to use.
    @Test("the same tree answers in the same order every time")
    func ordered() throws {
        let root = try Fixture.make([
            "b.md": "x", "a.md": "x", "c.md": "x",
            "zsub/one.md": "x", "asub/two.md": "x"
        ])
        defer { Fixture.remove(root) }

        let names = DirectoryWalk.documents(under: root.path, skipFolders: [])
            .map { ($0 as NSString).lastPathComponent }
        #expect(names == ["a.md", "b.md", "c.md", "two.md", "one.md"])
    }

    @Test("a folder that is not there, or is empty, answers empty rather than trapping")
    func degenerate() throws {
        let empty = try Fixture.make([:])
        defer { Fixture.remove(empty) }
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
        #expect(DirectoryWalk.documents(under: empty.path, skipFolders: []).isEmpty)

        let gone = NSTemporaryDirectory() + "/md-boss-gone-\(UUID().uuidString)"
        #expect(DirectoryWalk.documents(under: gone, skipFolders: []).isEmpty)
    }

    @Test("a package is opaque only when the caller asks for it to be")
    func packages() throws {
        let root = try Fixture.make(["Thing.app/Contents/notes.md": "inside", "outside.md": "yes"])
        defer { Fixture.remove(root) }

        // The search walk always descended into packages, and still does.
        #expect(DirectoryWalk.documents(under: root.path, skipFolders: []).count == 2)
        // DocumentScanner asked FileManager for `.skipsPackageDescendants`; this is that.
        #expect(
            DirectoryWalk.documents(under: root.path, skipFolders: [], skipPackages: true)
                .map { ($0 as NSString).lastPathComponent } == ["outside.md"]
        )
    }

    @Test("the budget fails open, so an enormous document-free folder is shown not hidden")
    func budgetFailsOpen() throws {
        let root = try Fixture.make(
            Dictionary(uniqueKeysWithValues: (0..<20).map { ("junk/f\($0).swift", "x") })
        )
        defer { Fixture.remove(root) }

        #expect(!DirectoryWalk.containsDocument(under: root.path, skipFolders: [], budget: 10_000))
        // Hiding a folder that might hold something is the worse of the two wrong answers.
        #expect(DirectoryWalk.containsDocument(under: root.path, skipFolders: [], budget: 2))
    }
}
