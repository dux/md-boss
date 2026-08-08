import Testing
import Foundation
@testable import MdBoss

@Suite("FileTree listing")
struct FileTreeListingTests {
    @Test("document extensions are recognised case-insensitively")
    func recognisesDocuments() {
        for name in ["a.md", "a.MD", "a.markdown", "a.mdown", "a.mkd", "a.qmd", "a.Rmd", "a.txt", "a.TXT"] {
            #expect(FileTree.isDocument(URL(fileURLWithPath: name)), "\(name)")
        }
        for name in ["a.swift", "a", "a.mdx", "README", "a.png"] {
            #expect(!FileTree.isDocument(URL(fileURLWithPath: name)), "\(name)")
        }
    }

    @Test("a typed name the sidebar would not list is created as markdown")
    func namesNewDocuments() {
        #expect(FileTree.documentName("notes") == "notes.md")
        #expect(FileTree.documentName("notes.md") == "notes.md")
        #expect(FileTree.documentName("notes.TXT") == "notes.TXT")
        #expect(FileTree.documentName("script.sh") == "script.sh.md")
        #expect(FileTree.documentName("v1.2 plan") == "v1.2 plan.md")
    }

    @Test("folders come first, then Finder's natural order")
    func sortsFoldersFirstThenNaturally() {
        let nodes = [
            node("10.md"), node("9.md"), node("beta", directory: true),
            node("Alpha.md"), node("alpha", directory: true)
        ]

        #expect(FileTree.sorted(nodes).map(\.name) == ["alpha", "beta", "9.md", "10.md", "Alpha.md"])
    }

    @Test("lists folders and markdown, skips everything else")
    func filtersListing() throws {
        let root = try Fixture.make([
            "notes.md": "# notes",
            "Package.swift": "// code",
            "image.png": "binary",
            "docs/nested.md": "# nested",
            "node_modules/lib.md": "# vendored"
        ])
        defer { Fixture.remove(root) }

        guard case .entries(let nodes) = FileTree.list(root, skipFolders: ["node_modules"]) else {
            Issue.record("listing was denied")
            return
        }

        #expect(nodes.map(\.name) == ["docs", "notes.md"])
    }

    @Test("folders with no documents anywhere below them are not listed")
    func hidesDocumentFreeFolders() throws {
        let root = try Fixture.make([
            "empty/assets/logo.png": "binary",
            "deep/a/b/c/buried.md": "# buried",
            "plain/notes.txt": "hello",
            "top.md": "# top"
        ])
        defer { Fixture.remove(root); DocumentScanner.shared.invalidateAll() }

        guard case .entries(let nodes) = FileTree.list(root, skipFolders: []) else {
            Issue.record("listing was denied")
            return
        }

        // "empty" is dropped; "deep" survives on a document four levels down.
        #expect(nodes.map(\.name) == ["deep", "plain", "top.md"])
    }

    @Test("a directory that is not there reports missing, not denied")
    func reportsMissing() {
        let gone = URL(fileURLWithPath: "/definitely/not/here-\(UUID().uuidString)")
        guard case .missing = FileTree.list(gone, skipFolders: []) else {
            Issue.record("expected .missing")
            return
        }
    }

    @Test("a directory that exists but cannot be read reports denied, not empty")
    func reportsDenied() throws {
        let root = try Fixture.make(["locked/a.md": "x"])
        defer { Fixture.remove(root) }

        let locked = root.appendingPathComponent("locked")
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: locked.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path) }

        guard case .denied = FileTree.list(locked, skipFolders: []) else {
            Issue.record("expected .denied")
            return
        }
    }

    private func node(_ name: String, directory: Bool = false) -> FileNode {
        FileNode(url: URL(fileURLWithPath: "/root/\(name)"), isDirectory: directory)
    }
}

@Suite("FileTree flatten")
struct FileTreeFlattenTests {
    private let root = URL(fileURLWithPath: "/r")
    private var docs: URL { root.appendingPathComponent("docs") }

    private var children: [String: [FileNode]] {
        [
            root.path: [
                FileNode(url: docs, isDirectory: true),
                FileNode(url: root.appendingPathComponent("top.md"), isDirectory: false)
            ],
            docs.path: [
                FileNode(url: docs.appendingPathComponent("deep.md"), isDirectory: false)
            ]
        ]
    }

    private func flatten(expanded: Set<String>, denied: Set<String> = []) -> [FlatRow] {
        FileTree.flatten(
            root: root,
            children: children,
            expanded: expanded,
            denied: denied
        )
    }

    @Test("the root is dived into, not drawn")
    func divesIntoRoot() {
        let rows = flatten(expanded: [])
        #expect(rows.map(\.node.name) == ["docs", "top.md"])
        #expect(rows.map(\.depth) == [0, 0])
    }

    @Test("only expanded directories contribute rows")
    func descendsOnlyIntoExpanded() {
        #expect(flatten(expanded: [docs.path]).map(\.node.name) == ["docs", "deep.md", "top.md"])
    }

    @Test("depth increases with nesting")
    func tracksDepth() {
        #expect(flatten(expanded: [docs.path]).map(\.depth) == [0, 1, 0])
    }

    @Test("a root with no listing yet has no rows")
    func toleratesUnlistedChildren() {
        #expect(FileTree.flatten(root: root, children: [:], expanded: [], denied: []).isEmpty)
    }

    @Test("no active folder means no rows")
    func toleratesNoRoot() {
        #expect(FileTree.flatten(root: nil, children: children, expanded: [], denied: []).isEmpty)
    }

    @Test("the denied flag reaches the row")
    func propagatesDenied() {
        #expect(flatten(expanded: [], denied: [docs.path])[0].isDenied)
        #expect(!flatten(expanded: [], denied: [docs.path])[1].isDenied)
    }
}

@Suite("Root folders")
struct RootFoldersTests {
    @Test("adding at the top moves an existing root instead of duplicating it")
    @MainActor
    func addAtTopDeduplicates() throws {
        let store = try Fixture.makeFile()
        defer { Fixture.remove(store.deletingLastPathComponent()) }

        let folders = RootFoldersManager(file: store)
        folders.add(URL(fileURLWithPath: "/a"))
        folders.add(URL(fileURLWithPath: "/b"))
        #expect(folders.roots.map(\.path) == ["/a", "/b"])

        folders.add(URL(fileURLWithPath: "/b"), atTop: true)
        #expect(folders.roots.map(\.path) == ["/b", "/a"])
    }

    @Test("selecting a folder makes it active without duplicating it")
    @MainActor
    func selectFloatsToTheTop() throws {
        let store = try Fixture.makeFile()
        defer { Fixture.remove(store.deletingLastPathComponent()) }

        let folders = RootFoldersManager(file: store)
        for path in ["/a", "/b", "/c"] { folders.add(URL(fileURLWithPath: path)) }
        #expect(folders.active?.path == "/a")

        folders.select(URL(fileURLWithPath: "/c"))
        #expect(folders.roots.map(\.path) == ["/c", "/a", "/b"])
        #expect(folders.active?.path == "/c")

        // Selecting what is already active is a no-op, not a reshuffle.
        folders.select(URL(fileURLWithPath: "/c"))
        #expect(folders.roots.map(\.path) == ["/c", "/a", "/b"])
    }

    @Test("recent is capped at twenty without dropping the rest")
    @MainActor
    func recentCapsAtTwenty() throws {
        let store = try Fixture.makeFile()
        defer { Fixture.remove(store.deletingLastPathComponent()) }

        let folders = RootFoldersManager(file: store)
        for index in 0..<24 { folders.add(URL(fileURLWithPath: "/f\(index)")) }

        #expect(folders.recent.count == 20)
        #expect(folders.roots.count == 24)
        #expect(folders.recent.last?.path == "/f19")
    }

    @Test("root(containing:) matches on path boundaries, not prefixes")
    @MainActor
    func matchesOnPathBoundary() throws {
        let store = try Fixture.makeFile()
        defer { Fixture.remove(store.deletingLastPathComponent()) }

        let folders = RootFoldersManager(file: store)
        folders.add(URL(fileURLWithPath: "/work/notes"))

        #expect(folders.root(containing: URL(fileURLWithPath: "/work/notes/a.md"))?.path == "/work/notes")
        #expect(folders.root(containing: URL(fileURLWithPath: "/work/notes")) != nil)
        // "/work/notes-old" must not match "/work/notes".
        #expect(folders.root(containing: URL(fileURLWithPath: "/work/notes-old/a.md")) == nil)
    }
}

// MARK: - Fixtures

enum Fixture {
    static func make(_ files: [String: String]) throws -> URL {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("md-boss-tests-\(UUID().uuidString)")
        for (path, contents) in files {
            let url = root.appendingPathComponent(path)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try contents.write(to: url, atomically: true, encoding: .utf8)
        }
        return root
    }

    static func makeFile() throws -> URL {
        let root = try make([:])
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("roots.txt")
    }

    static func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
