import Testing
import Foundation
@testable import MdBoss

@Suite("Search matching")
struct DocumentSearchMatchTests {
    @Test("a match reports its 1-based line and its offset in that line")
    func position() {
        let found = DocumentSearch.matches(in: "alpha\nbeta gamma\ndelta", query: "gamma")
        #expect(found.map(\.line) == [2])
        #expect(found.map(\.column) == [5])
        #expect(found.map(\.length) == [5])
        #expect(found.map(\.text) == ["beta gamma"])
    }

    @Test("every occurrence on a line is its own hit")
    func repeated() {
        #expect(DocumentSearch.matches(in: "one one one", query: "one").map(\.column) == [0, 4, 8])
    }

    /// Lowercase finds anything; a capital means you meant it.
    @Test("case is smart, not a setting")
    func smartCase() {
        #expect(DocumentSearch.matches(in: "Plan and plan", query: "plan").count == 2)
        #expect(DocumentSearch.matches(in: "Plan and plan", query: "Plan").count == 1)
        #expect(DocumentSearch.isCaseSensitive("Plan"))
        #expect(!DocumentSearch.isCaseSensitive("plan"))
    }

    /// Line numbers have to agree with LineIndex, which splits on \n only - a hit that
    /// scrolled to the wrong line would only ever show up in Windows-authored files.
    @Test("a CRLF file numbers the same as a normalised one")
    func crlf() {
        let found = DocumentSearch.matches(in: "alpha\r\nbeta\r\ngamma", query: "gamma")
        #expect(found.map(\.line) == [3])
    }

    @Test("the carriage return is kept out of the displayed line")
    func trimsReturn() {
        #expect(DocumentSearch.matches(in: "alpha\r\nbeta\r\n", query: "beta").map(\.text) == ["beta"])
    }

    @Test("a hit on the last line with no trailing newline still counts")
    func lastLine() {
        #expect(DocumentSearch.matches(in: "a\nb\nlast", query: "last").map(\.line) == [3])
    }

    @Test("a hit at the very start counts")
    func atZero() {
        #expect(DocumentSearch.matches(in: "target here", query: "target").map(\.column) == [0])
    }

    /// This is a text search, not a markdown one - a fence hides nothing from it.
    @Test("a hit inside a fenced block still counts")
    func insideFence() {
        #expect(DocumentSearch.matches(in: "```\nneedle\n```", query: "needle").count == 1)
    }

    @Test("an empty query finds nothing rather than everything")
    func emptyQuery() {
        #expect(DocumentSearch.matches(in: "anything at all", query: "").isEmpty)
    }

    @Test("the per-call limit is honoured")
    func limit() {
        #expect(DocumentSearch.matches(in: "x x x x x", query: "x", limit: 2).count == 2)
    }
}

@Suite("Search across a folder")
struct DocumentSearchRunTests {
    private func run(
        _ root: URL,
        _ query: String,
        buffers: [String: String] = [:],
        limits: DocumentSearch.Limits = DocumentSearch.Limits(),
        isCancelled: @Sendable () -> Bool = { false }
    ) -> DocumentSearch.Result {
        DocumentSearch.run(
            roots: [root],
            skipFolders: ["node_modules"],
            query: query,
            buffers: buffers,
            limits: limits,
            isCancelled: isCancelled
        )
    }

    @Test("only the documents that contain it come back")
    func findsFiles() throws {
        let root = try Fixture.make([
            "a.md": "the needle is here",
            "b.md": "nothing",
            "deep/c.md": "needle again\nand needle twice"
        ])
        defer { Fixture.remove(root) }

        let result = run(root, "needle")
        #expect(Set(result.hits.map { $0.url.lastPathComponent }) == ["a.md", "c.md"])
        #expect(result.hits.count == 3)
        #expect(!result.truncated)
    }

    /// `ByteScan` sits between the file list and the decode and is allowed to skip a file
    /// outright, so the cases it opts out of or fails open on have to survive the whole
    /// pass, not just the scanner's own tests.
    @Test("the byte prescan never costs a hit")
    func prescanFindsWhatTheMatcherWould() throws {
        let root = try Fixture.make([
            // A non-ASCII query, which has no prescan at all.
            "accents.md": "a caf\u{00E9} on the corner",
            // CRLF off disk, which nothing has normalised yet.
            "crlf.md": "first\r\nthe needle is here\r\nthird",
            // The scalars Foundation folds onto ASCII, which the prescan cannot see.
            "kelvin.md": "100 \u{212A}elvin",
            "longs.md": "\u{017F}omething",
            "sharp.md": "Stra\u{00DF}e"
        ])
        defer { Fixture.remove(root) }

        #expect(run(root, "caf\u{00E9}").hits.map { $0.url.lastPathComponent } == ["accents.md"])

        let crlf = run(root, "needle").hits
        #expect(crlf.map(\.line) == [2])
        #expect(crlf.map(\.text) == ["the needle is here"])

        #expect(run(root, "kelvin").hits.map { $0.url.lastPathComponent } == ["kelvin.md"])
        #expect(run(root, "something").hits.map { $0.url.lastPathComponent } == ["longs.md"])
        #expect(run(root, "strasse").hits.map { $0.url.lastPathComponent } == ["sharp.md"])
    }

    /// The sidebar hides these, so searching them would be a second answer to which files
    /// this app shows you.
    @Test("skipped folders are never read")
    func honoursSkipFolders() throws {
        let root = try Fixture.make(["node_modules/vendored.md": "needle"])
        defer { Fixture.remove(root) }

        #expect(run(root, "needle").hits.isEmpty)
    }

    @Test("files the sidebar would not list are not searched")
    func onlyDocuments() throws {
        let root = try Fixture.make(["a.swift": "needle", "b.md": "needle"])
        defer { Fixture.remove(root) }

        #expect(run(root, "needle").hits.map { $0.url.lastPathComponent } == ["b.md"])
    }

    /// Otherwise a hit in the file you are looking at points at a stale copy of it.
    @Test("an unsaved buffer wins over what is on disk")
    func prefersBuffers() throws {
        let root = try Fixture.make(["a.md": "nothing here"])
        defer { Fixture.remove(root) }

        let path = MarkdownLinks.canonical(root.appendingPathComponent("a.md")).path
        let result = run(root, "needle", buffers: [path: "a typed needle"])
        #expect(result.hits.map(\.text) == ["a typed needle"])
    }

    @Test("an empty query walks nothing at all")
    func emptyQuery() throws {
        let root = try Fixture.make(["a.md": "needle"])
        defer { Fixture.remove(root) }

        #expect(run(root, "").filesSearched == 0)
    }

    @Test("cancelling stops the walk and says the result is partial")
    func cancels() throws {
        let root = try Fixture.make(["a.md": "needle", "b.md": "needle", "c.md": "needle"])
        defer { Fixture.remove(root) }

        let result = run(root, "needle", isCancelled: { true })
        #expect(result.hits.isEmpty)
        #expect(result.truncated)
    }

    @Test("reaching the total cap truncates rather than quietly showing less")
    func totalCap() throws {
        let root = try Fixture.make(["a.md": String(repeating: "needle\n", count: 40)])
        defer { Fixture.remove(root) }

        var limits = DocumentSearch.Limits()
        limits.total = 5
        let result = run(root, "needle", limits: limits)
        #expect(result.hits.count == 5)
        #expect(result.truncated)
    }

    @Test("the per-file cap truncates too")
    func perFileCap() throws {
        let root = try Fixture.make(["a.md": String(repeating: "needle\n", count: 40)])
        defer { Fixture.remove(root) }

        var limits = DocumentSearch.Limits()
        limits.perFile = 3
        let result = run(root, "needle", limits: limits)
        #expect(result.hits.count == 3)
        #expect(result.truncated)
    }

    /// Roots nest, and the same file reached through two of them is one file.
    @Test("a file under two roots is searched once")
    func overlappingRoots() throws {
        let root = try Fixture.make(["sub/a.md": "needle"])
        defer { Fixture.remove(root) }

        let result = DocumentSearch.run(
            roots: [root, root.appendingPathComponent("sub")],
            skipFolders: [],
            query: "needle"
        )
        #expect(result.hits.count == 1)
    }
}

@Suite("Go to file ranking")
struct FuzzyMatchTests {
    @Test("a subsequence matches, and anything else does not")
    func subsequence() {
        #expect(FuzzyMatch.score("mtv", in: "MarkdownTextView.swift") != nil)
        #expect(FuzzyMatch.score("zzz", in: "MarkdownTextView.swift") == nil)
        #expect(FuzzyMatch.score("vtm", in: "MarkdownTextView.swift") == nil)
    }

    @Test("the offsets point at what actually matched")
    func offsets() throws {
        let hit = try #require(FuzzyMatch.score("mtv", in: "MarkdownTextView"))
        let scalars = Array("MarkdownTextView".unicodeScalars)
        #expect(hit.matched.map { String(scalars[$0]) } == ["M", "T", "V"])
    }

    /// The ordering is the whole feature - any scorer finds the matches.
    @Test("an initials match beats a scattered one")
    func prefersInitials() {
        let root = URL(fileURLWithPath: "/w")
        let ranked = FuzzyMatch.rank("mtv", candidates: [
            URL(fileURLWithPath: "/w/app/Models/MarkdownDocumentValue.swift"),
            URL(fileURLWithPath: "/w/app/Views/MarkdownTextView.swift")
        ], relativeTo: root)

        #expect(ranked.first?.display == "app/Views/MarkdownTextView.swift")
    }

    @Test("a run that stays together beats one that is spread out")
    func prefersConsecutive() {
        let root = URL(fileURLWithPath: "/w")
        let ranked = FuzzyMatch.rank("note", candidates: [
            URL(fileURLWithPath: "/w/n-o-t-e.md"),
            URL(fileURLWithPath: "/w/notes.md")
        ], relativeTo: root)

        #expect(ranked.first?.display == "notes.md")
    }

    @Test("recency breaks a tie and nothing more")
    func recencyBreaksTies() {
        let root = URL(fileURLWithPath: "/w")
        let ranked = FuzzyMatch.rank("a", candidates: [
            URL(fileURLWithPath: "/w/a1.md"),
            URL(fileURLWithPath: "/w/a2.md")
        ], relativeTo: root, recent: ["/w/a2.md"])

        #expect(ranked.first?.display == "a2.md")
    }

    @Test("paths are shown relative to the root they were found under")
    func relativeDisplay() {
        let ranked = FuzzyMatch.rank(
            "c",
            candidates: [URL(fileURLWithPath: "/w/deep/c.md")],
            relativeTo: URL(fileURLWithPath: "/w")
        )
        #expect(ranked.first?.display == "deep/c.md")
    }

    @Test("an empty query keeps everything, in name order")
    func emptyQuery() {
        let ranked = FuzzyMatch.rank("", candidates: [
            URL(fileURLWithPath: "/w/b.md"),
            URL(fileURLWithPath: "/w/a.md")
        ], relativeTo: URL(fileURLWithPath: "/w"))

        #expect(ranked.map(\.display) == ["a.md", "b.md"])
    }
}

@Suite("Sidebar search state")
@MainActor
struct SidebarSearchTests {
    /// The singleton is the app's, so every test hands it back the way it found it.
    private func withSearch(_ body: (SidebarSearch) -> Void) {
        let search = SidebarSearch.shared
        defer { search.clear(); search.focus(.text) }
        body(search)
    }

    /// The field is always on screen, so there is no "open" to be in - what is typed is the
    /// only thing that says whether the tree or a result list is showing.
    @Test("the query alone decides whether results are showing")
    func queryDrivesTheList() {
        withSearch { search in
            #expect(!search.isActive)
            search.query = "needle"
            #expect(search.isActive)
            search.query = ""
            #expect(!search.isActive)
        }
    }

    /// Swapping modes mid-query is the point of having two searches behind one field, so it
    /// must not throw away what is already typed.
    @Test("switching mode keeps the query and asks for the caret")
    func focusKeepsTheQuery() {
        withSearch { search in
            search.query = "needle"
            let before = search.focusRequest

            search.focus(.files)
            #expect(search.mode == .files)
            #expect(search.query == "needle")
            #expect(search.isActive)
            #expect(search.focusRequest > before)
        }
    }

    /// A flag that is already true is not a change the view can observe, so the same shortcut
    /// pressed twice has to read as two requests.
    @Test("asking for the caret twice is two requests")
    func focusRequestsAccumulate() {
        withSearch { search in
            search.focus(.text)
            let once = search.focusRequest
            search.focus(.text)
            #expect(search.focusRequest > once)
        }
    }

    /// A query must never outlive its use - coming back to a stale one with the tree hidden
    /// behind it would read as a broken sidebar.
    @Test("clearing empties the query and the results but keeps the mode")
    func clearResets() {
        withSearch { search in
            search.focus(.files)
            search.query = "needle"
            search.cursor = 3
            search.clear()

            #expect(search.query.isEmpty)
            #expect(search.hits.isEmpty)
            #expect(search.files.isEmpty)
            #expect(search.cursor == 0)
            #expect(!search.isActive)
            // Which search the field is doing is a preference about the field, not part of
            // the query it was cleared of.
            #expect(search.mode == .files)
        }
    }

    @Test("the cursor cannot leave the list")
    func cursorClamps() {
        withSearch { search in
            search.focus(.text)
            // No results yet, so there is nowhere to move to.
            search.moveCursor(by: 1)
            #expect(search.cursor == 0)
            search.moveCursor(by: -1)
            #expect(search.cursor == 0)
        }
    }

    @Test("typing puts the cursor back at the top")
    func typingResetsCursor() {
        withSearch { search in
            search.focus(.text)
            search.cursor = 4
            search.query = "a"
            #expect(search.cursor == 0)
        }
    }
}
