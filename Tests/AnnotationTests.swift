import Testing
import Foundation
@testable import MdBoss

@Suite("Note titles")
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

@Suite("Note hover text")
struct NoteTooltipTests {
    @Test("the body is what a hover has to say")
    func showsBody() {
        let note = Note(path: "~/a.md", line: 7, title: "The plan", body: "revisit this")
        #expect(note.tooltip == "revisit this")
    }

    @Test("a body-less note falls back to saying it is there")
    func announcesItself() {
        // Its title came off the source line you are already hovering, so repeating it
        // would say nothing.
        let note = Note(path: "~/a.md", line: 7, title: "The plan")
        #expect(note.tooltip == "Note on line 7")
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
    private func decode(_ json: String) throws -> AnnotationFile {
        try JSONDecoder().decode(AnnotationFile.self, from: Data(json.utf8))
    }

    @Test("the current shape decodes")
    func decodesNotes() throws {
        let file = try decode(#"{"notes":[{"path":"~/a.md","line":3,"title":"Third","body":"Why"}]}"#)

        #expect(file.notes.count == 1)
        #expect(file.notes[0].title == "Third")
        #expect(file.notes[0].body == "Why")
    }

    @Test("a bookmark written by an older build becomes a note with only a title")
    func decodesLegacyBookmark() throws {
        let file = try decode(#"{"bookmarks":[{"path":"~/a.md","line":3,"title":"Third"}]}"#)

        #expect(file.notes.count == 1)
        #expect(file.notes[0].title == "Third")
        #expect(file.notes[0].body.isEmpty)
    }

    @Test("a comment written by an older build becomes a note with only a body")
    func decodesLegacyComment() throws {
        let file = try decode(#"{"comments":[{"path":"~/a.md","line":8,"body":"Needs a test."}]}"#)

        #expect(file.notes.count == 1)
        #expect(file.notes[0].title.isEmpty)
        #expect(file.notes[0].body == "Needs a test.")
        // With no title to lead with, the row shows the body.
        #expect(file.notes[0].label == "Needs a test.")
    }

    @Test("a bookmark and a comment on the same line fold into one note")
    func foldsBothOnOneLine() throws {
        // The one lossy case in the merge, and the reason this suite exists.
        let file = try decode("""
        {"bookmarks":[{"path":"~/a.md","line":26,"title":"Tables"}],
         "comments":[{"path":"~/a.md","line":26,"body":"Check the alignment."}]}
        """)

        #expect(file.notes.count == 1)
        #expect(file.notes[0].title == "Tables")
        #expect(file.notes[0].body == "Check the alignment.")
    }

    @Test("old and new keys in one file merge rather than one winning")
    func mergesEveryKey() throws {
        let file = try decode("""
        {"notes":[{"path":"~/a.md","line":1,"title":"One"}],
         "bookmarks":[{"path":"~/a.md","line":2,"title":"Two"}],
         "comments":[{"path":"~/a.md","line":3,"body":"Three"}]}
        """)

        #expect(file.notes.map(\.line) == [1, 2, 3])
    }

    @Test("an empty object decodes to an empty file")
    func decodesEmptyObject() throws {
        #expect(try decode("{}").isEmpty)
    }

    @Test("encoding writes only the current key, so a file converts itself")
    func encodesOneKey() throws {
        let file = try decode(#"{"bookmarks":[{"path":"~/a.md","line":3,"title":"Third"}]}"#)
        let text = try #require(String(bytes: try encoded(file), encoding: .utf8))

        #expect(text.contains("\"notes\""))
        #expect(!text.contains("\"bookmarks\""))
        #expect(!text.contains("\"comments\""))
    }

    @Test("an empty field is left out rather than written as an empty string")
    func omitsEmptyFields() throws {
        let file = AnnotationFile(notes: [Note(path: "~/a.md", line: 1, title: "Named")])
        let text = try #require(String(bytes: try encoded(file), encoding: .utf8))

        #expect(text.contains("\"title\""))
        #expect(!text.contains("\"body\""))
    }

    @Test("encoding round-trips and keeps slashes unescaped")
    func encodesReadably() throws {
        let file = AnnotationFile(notes: [
            Note(path: "~/dev/notes/plan.md", line: 42, title: "Rebuild the index"),
            Note(path: "~/dev/notes/plan.md", line: 88, body: "Needs a test.\nReally.")
        ])

        let data = try encoded(file)
        let text = try #require(String(bytes: data, encoding: .utf8))

        #expect(text.contains("~/dev/notes/plan.md"))
        #expect(!text.contains("\\/"))
        #expect(try JSONDecoder().decode(AnnotationFile.self, from: data) == file)
    }

    @Test("a note is empty only when both fields are, which is what setNote drops on")
    func reportsEmptiness() {
        // Clearing the body used to delete a comment. It must not now, or a note with only
        // a title - the old bookmark - would be impossible to make from a body-only dialog.
        #expect(Note(path: "~/a.md", line: 1, title: "Named").isEmpty == false)
        #expect(Note(path: "~/a.md", line: 1, body: "Written").isEmpty == false)
        #expect(Note(path: "~/a.md", line: 1).isEmpty)
        #expect(Note(path: "~/a.md", line: 1, body: "  \n ").isEmpty)
    }

    @Test("identity is path plus line, so one note per line")
    func identifiesByPathAndLine() {
        let first = Note(path: "~/a.md", line: 1, title: "One")
        let renamed = Note(path: "~/a.md", line: 1, title: "Different title")
        let other = Note(path: "~/a.md", line: 2, title: "One")

        #expect(first.id == renamed.id)
        #expect(first.id != other.id)
    }

    private func encoded(_ file: AnnotationFile) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(file)
    }
}

@Suite("Note scopes")
struct NoteScopeTests {
    private let active = URL(fileURLWithPath: "/work/notes")
    private let other = URL(fileURLWithPath: "/work/other")
    private let stale = URL(fileURLWithPath: "/work/archived")

    private func note(_ path: String, _ line: Int = 1) -> Note {
        Note(path: path, line: line, body: "body")
    }

    private func partition(
        _ all: [Note],
        file: URL? = URL(fileURLWithPath: "/work/notes/open.md"),
        activeRoot: URL? = URL(fileURLWithPath: "/work/notes")
    ) -> [NoteScope: [Note]] {
        NoteSections.partition(
            all: all,
            file: file,
            activeRoot: activeRoot,
            recentRoots: [active, other]
        )
    }

    /// Total notes placed anywhere. Kept out of #expect - the macro cannot rewrite
    /// `allSatisfy(\.isEmpty)` through its rethrows signature.
    private func placed(_ result: [NoteScope: [Note]]) -> Int {
        result.values.map(\.count).reduce(0, +)
    }

    @Test("a note on the open file lands in thisFile and nowhere else")
    func placesOpenFile() {
        let result = partition([note("/work/notes/open.md", 5)])

        #expect(result[.thisFile]?.count == 1)
        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.isEmpty == true)
    }

    @Test("another file inside the active folder lands in thisProject")
    func placesSameProject() {
        let result = partition([note("/work/notes/deep/other.md")])

        #expect(result[.thisFile]?.isEmpty == true)
        #expect(result[.thisProject]?.count == 1)
        #expect(result[.allProjects]?.isEmpty == true)
    }

    @Test("a file in a different recent folder lands in allProjects")
    func placesOtherProject() {
        let result = partition([note("/work/other/notes.md")])

        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.count == 1)
    }

    @Test("a folder outside the recent list contributes nothing")
    func dropsStaleRoots() {
        let result = partition([note("\(stale.path)/old.md")])

        #expect(placed(result) == 0)
    }

    @Test("matching is on path boundaries - notes-old is not part of notes")
    func respectsPathBoundaries() {
        let result = partition([note("/work/notes-old/a.md")])

        // Neither the active root nor any recent root actually contains it.
        #expect(placed(result) == 0)
    }

    @Test("with no file open, everything in the active folder is thisProject")
    func handlesNoOpenFile() {
        let result = partition([note("/work/notes/a.md")], file: nil)

        #expect(result[.thisFile]?.isEmpty == true)
        #expect(result[.thisProject]?.count == 1)
    }

    @Test("with no active folder, every recent folder is allProjects")
    func handlesNoActiveRoot() {
        let result = partition(
            [note("/work/notes/a.md"), note("/work/other/b.md")],
            file: nil,
            activeRoot: nil
        )

        #expect(result[.thisProject]?.isEmpty == true)
        #expect(result[.allProjects]?.count == 2)
    }

    @Test("the open file wins even when it sits inside the active folder")
    func prefersTheNarrowestScope() {
        let result = partition([
            note("/work/notes/open.md", 2),
            note("/work/notes/open.md", 1),
            note("/work/notes/sibling.md")
        ])

        #expect(result[.thisFile]?.count == 2)
        #expect(result[.thisProject]?.count == 1)
    }

    @Test("each scope comes back sorted by path then line")
    func sortsResults() {
        let result = partition([
            note("/work/notes/b.md", 3),
            note("/work/notes/a.md", 9),
            note("/work/notes/a.md", 2)
        ])

        let ordered = result[.thisProject]?.map { "\($0.path):\($0.line)" }
        #expect(ordered == ["/work/notes/a.md:2", "/work/notes/a.md:9", "/work/notes/b.md:3"])
    }

    @Test("every scope is present in the result, even when empty")
    func alwaysReturnsEveryScope() {
        let result = partition([])
        #expect(Set(result.keys) == Set(NoteScope.allCases))
    }

    @Test("only the two wider scopes fold")
    func foldsWiderScopesOnly() {
        #expect(!NoteScope.thisFile.isCollapsible)
        #expect(NoteScope.thisProject.isCollapsible)
        #expect(NoteScope.allProjects.isCollapsible)
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

        settings.visiblePanes = [Pane.notes.rawValue, Pane.raw.rawValue, Pane.preview.rawValue]
        #expect(settings.panes == [.raw, .preview, .notes])
    }

    @Test("a config naming the old bookmarks or comments pane opens the notes pane")
    func mapsRetiredPaneNames() {
        let settings = AppSettings.shared
        let original = settings.visiblePanes
        defer { settings.visiblePanes = original }

        // Without the mapping these decode to nothing and the viewer silently resets.
        settings.visiblePanes = ["raw", "bookmarks", "comments"]
        #expect(settings.panes == [.raw, .notes])
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

    @Test("only the notes pane claims a fixed width")
    func fixesListPaneWidths() {
        #expect(Pane.notes.fixedWidth == 350)
        #expect(Pane.raw.fixedWidth == nil)
        #expect(Pane.preview.fixedWidth == nil)
    }
}

@Suite("Repointing notes after a move")
struct NoteRepointTests {
    private let file = AnnotationFile(notes: [
        Note(path: "~/work/a.md", line: 3, title: "Third"),
        Note(path: "~/work/a.md", line: 9, body: "Ninth"),
        Note(path: "~/work/b.md", line: 1, title: "Other")
    ])

    @Test("every note on the moved file follows it, and nothing else does")
    func repointsMatches() throws {
        let split = try #require(file.repointing(from: "~/work/a.md", to: "~/work/sub/a.md"))

        #expect(split.moved.map(\.path) == ["~/work/sub/a.md", "~/work/sub/a.md"])
        #expect(split.moved.map(\.line) == [3, 9])
        #expect(split.moved.map(\.title) == ["Third", ""])
        #expect(split.kept.notes.map(\.path) == ["~/work/b.md"])
    }

    @Test("a file with nothing on the moved path is not rewritten at all")
    func nilWhenUnaffected() {
        #expect(file.repointing(from: "~/work/gone.md", to: "~/work/sub/gone.md") == nil)
    }

    @Test("landing on a line that already has a note folds rather than duplicates")
    func foldsOnCollision() throws {
        let split = try #require(file.repointing(from: "~/work/a.md", to: "~/work/b.md"))
        let folded = AnnotationFile.fold(split.kept.notes + split.moved)

        #expect(folded.count == 3)
        #expect(folded.filter { $0.line == 1 }.count == 1)
    }
}

@Suite("One note per line across stores")
struct NoteStoreDedupTests {
    /// The shape the bug left behind: annotated while the file was outside every root, so a
    /// copy sits in the fallback, then annotated again once its folder became a root.
    private let split = [
        "~/.config/md-boss/annotations.json": AnnotationFile(notes: [
            Note(path: "~/work/a.md", line: 3, title: "Third", body: "written first")
        ]),
        "~/work/.md-boss": AnnotationFile(notes: [
            Note(path: "~/work/a.md", line: 3, body: "written again"),
            Note(path: "~/work/a.md", line: 9, title: "Ninth")
        ])
    ]

    @Test("a line with a record in two stores comes back with one")
    func collapsesToOne() {
        let healed = NoteStores.deduplicated(split)
        let all = healed.values.flatMap(\.notes)

        #expect(all.filter { $0.id == "~/work/a.md:3" }.count == 1)
        #expect(all.count == 2)
    }

    /// With no preference expressed, sorted keys break the tie and `~/.config/...` claims it.
    @Test("the first store by path keeps it, and the other's copy folds in")
    func foldsIntoTheKeeper() throws {
        let healed = NoteStores.deduplicated(split)

        let kept = try #require(healed["~/.config/md-boss/annotations.json"]?.notes.first)
        #expect(kept.line == 3)
        #expect(kept.title == "Third")
        // First non-empty wins per field, so the surviving body is the one written first.
        #expect(kept.body == "written first")
        #expect(healed["~/work/.md-boss"]?.notes.map(\.line) == [9])
    }

    /// The real caller names the project as home, which is the whole point of a `.md-boss`:
    /// the survivor has to be the file that gets committed, not the fallback.
    @Test("a contested note goes to the store that owns its document")
    func prefersTheOwningStore() throws {
        let healed = NoteStores.deduplicated(split) { _ in "~/work/.md-boss" }

        let kept = try #require(healed["~/work/.md-boss"]?.notes.first { $0.line == 3 })
        #expect(kept.body == "written first")
        #expect(healed["~/work/.md-boss"]?.notes.map(\.line) == [3, 9])
        #expect(healed["~/.config/md-boss/annotations.json"]?.notes.isEmpty == true)
    }

    @Test("a home that holds no copy of the note is ignored rather than invented")
    func ignoresAnAbsentHome() {
        let healed = NoteStores.deduplicated(split) { _ in "~/elsewhere/.md-boss" }

        #expect(healed["~/elsewhere/.md-boss"] == nil)
        #expect(healed["~/.config/md-boss/annotations.json"]?.notes.map(\.line) == [3])
    }

    /// Only a contested note is ever relocated - a clean store is not reorganised on load.
    @Test("a note sitting on its own is left where it is, whatever home says")
    func neverMovesAnUncontestedNote() {
        let healed = NoteStores.deduplicated(split) { _ in "~/.config/md-boss/annotations.json" }

        #expect(healed["~/work/.md-boss"]?.notes.map(\.line) == [9])
    }

    @Test("a store emptied by the fold still comes back, so the caller can write it out")
    func keepsEmptiedStores() {
        let healed = NoteStores.deduplicated([
            "~/a/.md-boss": AnnotationFile(notes: [Note(path: "~/x.md", line: 1, title: "One")]),
            "~/b/.md-boss": AnnotationFile(notes: [Note(path: "~/x.md", line: 1, body: "dupe")])
        ])

        #expect(healed["~/b/.md-boss"]?.notes.isEmpty == true)
    }

    @Test("stores that never disagreed are handed back untouched")
    func leavesCleanStoresAlone() {
        let clean = [
            "~/a/.md-boss": AnnotationFile(notes: [Note(path: "~/a/x.md", line: 1, title: "One")]),
            "~/b/.md-boss": AnnotationFile(notes: [Note(path: "~/b/y.md", line: 1, title: "Two")])
        ]

        #expect(NoteStores.deduplicated(clean) == clean)
    }

    /// The same line in two *different* files is not a duplicate.
    @Test("identity is the path and the line together, not the line alone")
    func lineAloneIsNotIdentity() {
        let healed = NoteStores.deduplicated([
            "~/a/.md-boss": AnnotationFile(notes: [
                Note(path: "~/a/x.md", line: 4, title: "X"),
                Note(path: "~/a/y.md", line: 4, title: "Y")
            ])
        ])

        #expect(healed["~/a/.md-boss"]?.notes.count == 2)
    }
}
