import Testing
import Foundation
@testable import MdBoss

/// The index is a cache in front of `FileTree.documents`, and a cache is only as good as the
/// things that drop it. These pin the two rules that make it safe to read from: the skip set
/// is part of the answer's identity, and an edit the app made itself invalidates immediately
/// rather than waiting for FSEvents to notice.
///
/// Serialised because `ProjectIndex.shared` is one cache for the process.
@Suite("Project index", .serialized)
struct ProjectIndexTests {
    private func names(_ found: [URL]) -> Set<String> {
        Set(found.map(\.lastPathComponent))
    }

    @Test("the second answer is the same as the first")
    func caches() throws {
        ProjectIndex.shared.reset()
        let root = try Fixture.make(["a.md": "x", "sub/b.md": "x"])
        defer { Fixture.remove(root); ProjectIndex.shared.reset() }

        let first = ProjectIndex.shared.documents(under: root, skipFolders: [])
        #expect(names(first) == ["a.md", "b.md"])
        #expect(ProjectIndex.shared.documents(under: root, skipFolders: []).map(\.path) == first.map(\.path))
    }

    /// settings.json is hand-editable while the app is running, so a list walked under the
    /// old skip set is not an answer to the new question.
    @Test("a different skip set is a different answer, not a cache hit")
    func skipFoldersAreIdentity() throws {
        ProjectIndex.shared.reset()
        let root = try Fixture.make(["keep.md": "x", "vendor/skipped.md": "x"])
        defer { Fixture.remove(root); ProjectIndex.shared.reset() }

        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["keep.md", "skipped.md"])
        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: ["vendor"])) == ["keep.md"])
        // And back again - the second call must not have poisoned the first answer.
        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["keep.md", "skipped.md"])
    }

    @Test("invalidating forces a fresh walk")
    func invalidates() throws {
        ProjectIndex.shared.reset()
        let root = try Fixture.make(["a.md": "x"])
        defer { Fixture.remove(root); ProjectIndex.shared.reset() }

        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["a.md"])

        try "x".write(to: root.appendingPathComponent("b.md"), atomically: true, encoding: .utf8)
        // Still the cached answer - which is the point, and why the app invalidates its own
        // edits rather than waiting for FSEvents to coalesce.
        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["a.md"])

        ProjectIndex.shared.invalidate(root)
        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["a.md", "b.md"])
    }

    /// Invalidation is by containment, because the sidebar's roots can nest and an edit deep
    /// in a subtree is an edit to every root above it.
    @Test("invalidating a subfolder drops the root that contains it")
    func containment() throws {
        ProjectIndex.shared.reset()
        let root = try Fixture.make(["sub/a.md": "x"])
        defer { Fixture.remove(root); ProjectIndex.shared.reset() }

        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["a.md"])

        let sub = root.appendingPathComponent("sub")
        try "x".write(to: sub.appendingPathComponent("b.md"), atomically: true, encoding: .utf8)
        ProjectIndex.shared.invalidate(sub)

        #expect(names(ProjectIndex.shared.documents(under: root, skipFolders: [])) == ["a.md", "b.md"])
    }

    @Test("a root that is not there answers empty and is not cached as gospel")
    func missing() {
        ProjectIndex.shared.reset()
        defer { ProjectIndex.shared.reset() }

        let gone = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("md-boss-gone-\(UUID().uuidString)")
        #expect(ProjectIndex.shared.documents(under: gone, skipFolders: []).isEmpty)
    }
}
