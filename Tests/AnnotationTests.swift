import Testing
import Foundation
@testable import MdBoss

@Suite("Bookmark titles")
struct SuggestedTitleTests {
    @Test("markdown markers and punctuation are stripped")
    func stripsMarkdown() {
        #expect(AnnotationPath.suggestedTitle(from: "## The **plan**, revisited!") == "The plan revisited")
        #expect(AnnotationPath.suggestedTitle(from: "- [ ] ship it") == "ship it")
        #expect(AnnotationPath.suggestedTitle(from: "`code()` here") == "code here")
    }

    @Test("indentation and runs of separators collapse to single spaces")
    func collapsesWhitespace(
    ) {
        #expect(AnnotationPath.suggestedTitle(from: "      deep    indent\t\tand tabs") == "deep indent and tabs")
        #expect(AnnotationPath.suggestedTitle(from: "snake_case-and-dashes") == "snake case and dashes")
    }

    @Test("the result is capped at 40 characters and never ends mid-space")
    func capsLength() {
        let long = String(repeating: "abcde ", count: 20)
        let title = AnnotationPath.suggestedTitle(from: long)
        #expect(title.count <= 40)
        #expect(!title.hasSuffix(" "))
    }

    @Test("a line with nothing quotable yields an empty title")
    func handlesEmptyLines() {
        #expect(AnnotationPath.suggestedTitle(from: "---").isEmpty)
        #expect(AnnotationPath.suggestedTitle(from: "   ").isEmpty)
        #expect(AnnotationPath.suggestedTitle(from: "").isEmpty)
    }

    @Test("digits survive - a heading like '2026 plan' is a fine title")
    func keepsDigits() {
        #expect(AnnotationPath.suggestedTitle(from: "# 2026 plan") == "2026 plan")
    }
}

@Suite("Annotation paths")
struct AnnotationPathTests {
    @Test("paths are stored tilde-abbreviated and round-trip back")
    func roundTripsThroughHome() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let file = home.appendingPathComponent("dev/notes/plan.md")

        let stored = AnnotationPath.store(file)
        #expect(stored.hasPrefix("~/"))
        #expect(AnnotationPath.expand(stored).path == file.path)
    }

    @Test("a path outside home is stored absolute")
    func leavesOutsidePathsAbsolute() {
        let stored = AnnotationPath.store(URL(fileURLWithPath: "/tmp/notes/plan.md"))
        #expect(stored == "/tmp/notes/plan.md")
    }
}

@Suite("Annotation file")
struct AnnotationFileTests {
    @Test("a file with only bookmarks still decodes")
    func decodesPartialFile() throws {
        let json = #"{"bookmarks":[{"path":"~/a.md","line":3,"title":"Third"}]}"#
        let file = try JSONDecoder().decode(AnnotationFile.self, from: Data(json.utf8))

        #expect(file.bookmarks.count == 1)
        #expect(file.comments.isEmpty)
        #expect(file.bookmarks[0].line == 3)
    }

    @Test("an empty object decodes to an empty file")
    func decodesEmptyObject() throws {
        let file = try JSONDecoder().decode(AnnotationFile.self, from: Data("{}".utf8))
        #expect(file.isEmpty)
    }

    @Test("encoding round-trips and keeps slashes unescaped")
    func encodesReadably() throws {
        var file = AnnotationFile()
        file.bookmarks = [Bookmark(path: "~/dev/notes/plan.md", line: 42, title: "Rebuild the index")]
        file.comments = [Comment(path: "~/dev/notes/plan.md", line: 88, body: "Needs a test.\nReally.")]

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(file)
        let text = try #require(String(bytes: data, encoding: .utf8))

        #expect(text.contains("~/dev/notes/plan.md"))
        #expect(!text.contains("\\/"))
        #expect(try JSONDecoder().decode(AnnotationFile.self, from: data) == file)
    }

    @Test("identity is path plus line, so one bookmark per line")
    func identifiesByPathAndLine() {
        let first = Bookmark(path: "~/a.md", line: 1, title: "One")
        let renamed = Bookmark(path: "~/a.md", line: 1, title: "Different title")
        let other = Bookmark(path: "~/a.md", line: 2, title: "One")

        #expect(first.id == renamed.id)
        #expect(first.id != other.id)
    }
}

@Suite("Comment scopes")
struct CommentScopeTests {
    private let active = URL(fileURLWithPath: "/work/notes")
    private let other = URL(fileURLWithPath: "/work/other")
    private let stale = URL(fileURLWithPath: "/work/archived")

    // Qualified: swift-testing has its own Comment (the #expect message type).
    private func comment(_ path: String, _ line: Int = 1) -> MdBoss.Comment {
        MdBoss.Comment(path: path, line: line, body: "body")
    }

    private func partition(
        _ all: [MdBoss.Comment],
        file: URL? = URL(fileURLWithPath: "/work/notes/open.md"),
        activeRoot: URL? = URL(fileURLWithPath: "/work/notes")
    ) -> [CommentScope: [MdBoss.Comment]] {
        CommentSections.partition(
            all: all,
            file: file,
            activeRoot: activeRoot,
            recentRoots: [active, other]
        )
    }

    /// Total comments placed anywhere. Kept out of #expect - the macro cannot rewrite
    /// `allSatisfy(\.isEmpty)` through its rethrows signature.
    private func placed(_ result: [CommentScope: [MdBoss.Comment]]) -> Int {
        result.values.map(\.count).reduce(0, +)
    }

    @Test("a comment on the open file lands in thisFile and nowhere else")
    func placesOpenFile() {
        let result = partition([comment("/work/notes/open.md", 5)])

        #expect(result[.thisFile]?.count == 1)
        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.isEmpty == true)
    }

    @Test("another file inside the active folder lands in thisProject")
    func placesSameProject() {
        let result = partition([comment("/work/notes/deep/other.md")])

        #expect(result[.thisFile]?.isEmpty == true)
        #expect(result[.thisProject]?.count == 1)
        #expect(result[.allProjects]?.isEmpty == true)
    }

    @Test("a file in a different recent folder lands in allProjects")
    func placesOtherProject() {
        let result = partition([comment("/work/other/notes.md")])

        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.count == 1)
    }

    @Test("a folder outside the recent list contributes nothing")
    func dropsStaleRoots() {
        let result = partition([comment("\(stale.path)/old.md")])

        #expect(placed(result) == 0)
    }

    @Test("matching is on path boundaries - notes-old is not part of notes")
    func respectsPathBoundaries() {
        let result = partition([comment("/work/notes-old/a.md")])

        // Neither the active root nor any recent root actually contains it.
        #expect(placed(result) == 0)
    }

    @Test("with no file open, everything in the active folder is thisProject")
    func handlesNoOpenFile() {
        let result = partition([comment("/work/notes/a.md")], file: nil)

        #expect(result[.thisFile]?.isEmpty == true)
        #expect(result[.thisProject]?.count == 1)
    }

    @Test("with no active folder, every recent folder is allProjects")
    func handlesNoActiveRoot() {
        let result = partition(
            [comment("/work/notes/a.md"), comment("/work/other/b.md")],
            file: nil,
            activeRoot: nil
        )

        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.count == 2)
    }

    @Test("the open file wins even when it sits inside the active folder")
    func prefersTheNarrowestScope() {
        let result = partition([
            comment("/work/notes/open.md", 2),
            comment("/work/notes/open.md", 1),
            comment("/work/notes/sibling.md")
        ])

        #expect(result[.thisFile]?.count == 2)
        #expect(result[.thisProject]?.count == 1)
    }

    @Test("each scope comes back sorted by path then line")
    func sortsResults() {
        let result = partition([
            comment("/work/notes/b.md", 3),
            comment("/work/notes/a.md", 9),
            comment("/work/notes/a.md", 2)
        ])

        let ordered = result[.thisProject]?.map { "\($0.path):\($0.line)" }
        #expect(ordered == ["/work/notes/a.md:2", "/work/notes/a.md:9", "/work/notes/b.md:3"])
    }

    @Test("every scope is present in the result, even when empty")
    func alwaysReturnsEveryScope() {
        let result = partition([])
        #expect(Set(result.keys) == Set(CommentScope.allCases))
    }

    @Test("only the two wider scopes fold")
    func foldsWiderScopesOnly() {
        #expect(!CommentScope.thisFile.isCollapsible)
        #expect(CommentScope.thisProject.isCollapsible)
        #expect(CommentScope.allProjects.isCollapsible)
    }
}

@Suite("Path containment")
struct PathContainmentTests {
    @Test("a root contains itself and anything beneath it")
    func matchesDescendants() {
        let root = URL(fileURLWithPath: "/work/notes")
        #expect(AnnotationPath.isUnder(root, root: root))
        #expect(AnnotationPath.isUnder(URL(fileURLWithPath: "/work/notes/a/b.md"), root: root))
    }

    @Test("a sibling with a shared prefix does not match")
    func rejectsPrefixSiblings() {
        let root = URL(fileURLWithPath: "/work/notes")
        #expect(!AnnotationPath.isUnder(URL(fileURLWithPath: "/work/notes-old/a.md"), root: root))
        #expect(!AnnotationPath.isUnder(URL(fileURLWithPath: "/work"), root: root))
    }
}

@Suite("Pane visibility")
@MainActor
struct PaneTests {
    @Test("panes always come back in declaration order")
    func ordersPanes() {
        let settings = AppSettings.shared
        let original = settings.visiblePanes
        defer { settings.visiblePanes = original }

        settings.visiblePanes = [Pane.comments.rawValue, Pane.raw.rawValue, Pane.bookmarks.rawValue]
        #expect(settings.panes == [.raw, .bookmarks, .comments])
    }

    @Test("the last visible pane cannot be turned off")
    func keepsOnePaneVisible() {
        let settings = AppSettings.shared
        let original = settings.visiblePanes
        defer { settings.visiblePanes = original }

        settings.visiblePanes = [Pane.preview.rawValue]
        settings.toggle(.preview)
        #expect(settings.panes == [.preview])
    }

    @Test("an unknown or empty stored value falls back to preview")
    func toleratesBadStoredValues() {
        let settings = AppSettings.shared
        let original = settings.visiblePanes
        defer { settings.visiblePanes = original }

        settings.visiblePanes = []
        #expect(settings.panes == [.preview])

        settings.visiblePanes = ["nonsense"]
        #expect(settings.panes == [.preview])
    }

    @Test("only bookmarks and comments claim a fixed width")
    func fixesListPaneWidths() {
        #expect(Pane.bookmarks.fixedWidth == 300)
        #expect(Pane.comments.fixedWidth == 300)
        #expect(Pane.raw.fixedWidth == nil)
        #expect(Pane.preview.fixedWidth == nil)
    }
}

@Suite("Line ranges")
@MainActor
struct LineRangeTests {
    private let text = "one\ntwo\nthree\n"

    @Test("line numbers are 1-based")
    func findsLines() {
        let first = MarkdownTextView.Coordinator.range(ofLine: 1, in: text)
        #expect(first?.location == 0)

        let second = MarkdownTextView.Coordinator.range(ofLine: 2, in: text)
        #expect(second?.location == 4)

        let third = MarkdownTextView.Coordinator.range(ofLine: 3, in: text)
        #expect(third?.location == 8)
    }

    @Test("a line past the end returns nothing rather than crashing")
    func handlesOutOfRange() {
        #expect(MarkdownTextView.Coordinator.range(ofLine: 99, in: text) == nil)
        #expect(MarkdownTextView.Coordinator.range(ofLine: 2, in: "") == nil)
    }

    @Test("an empty document still has a line 1")
    func handlesEmptyDocument() {
        #expect(MarkdownTextView.Coordinator.range(ofLine: 1, in: "") == NSRange(location: 0, length: 0))
    }
}
