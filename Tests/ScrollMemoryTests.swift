import Testing
import Foundation
@testable import MdBoss

@Suite("Scroll memory")
@MainActor
struct ScrollMemoryTests {
    private func url(_ name: String) -> URL {
        URL(fileURLWithPath: "/tmp/md-boss-tests/\(name)")
    }

    @Test("a file nobody has scrolled has no place")
    func startsEmpty() {
        let memory = ScrollMemory.shared
        let file = url("unvisited-\(UUID().uuidString).md")

        #expect(memory.place(for: file).line == nil)
        #expect(memory.place(for: file).table == nil)
        #expect(memory.place(for: nil).line == nil)
    }

    @Test("text and table places are kept side by side, not one over the other")
    func keepsBothKinds() {
        let memory = ScrollMemory.shared
        let file = url("both-\(UUID().uuidString).csv")
        defer { memory.forget(file) }

        memory.record(line: 42.5, for: file)
        memory.record(table: CGPoint(x: 300, y: 900), for: file)

        // The raw pane records a line for a CSV while the table records a point; neither
        // may clobber the other, or one of the two panes reopens at the top.
        #expect(memory.place(for: file).line == 42.5)
        #expect(memory.place(for: file).table == CGPoint(x: 300, y: 900))
    }

    @Test("the last position recorded wins")
    func keepsTheLatest() {
        let memory = ScrollMemory.shared
        let file = url("latest-\(UUID().uuidString).md")
        defer { memory.forget(file) }

        memory.record(line: 10, for: file)
        memory.record(line: 260, for: file)

        #expect(memory.place(for: file).line == 260)
    }

    @Test("a file that moved keeps its place; the old path loses it")
    func followsAMove() {
        let memory = ScrollMemory.shared
        let source = url("before-\(UUID().uuidString).md")
        let target = url("after-\(UUID().uuidString).md")
        defer { memory.forget(target) }

        memory.record(line: 88, for: source)
        memory.relocate(from: source, to: target)

        #expect(memory.place(for: target).line == 88)
        #expect(memory.place(for: source).line == nil)
    }

    @Test("moving a file nobody read leaves the destination alone")
    func relocatesNothing() {
        let memory = ScrollMemory.shared
        let source = url("cold-\(UUID().uuidString).md")
        let target = url("warm-\(UUID().uuidString).md")
        defer { memory.forget(target) }

        memory.record(line: 5, for: target)
        memory.relocate(from: source, to: target)

        #expect(memory.place(for: target).line == 5)
    }

    @Test("paths are compared standardized, so /a/./b is /a/b")
    func standardizesPaths() {
        let memory = ScrollMemory.shared
        let name = "std-\(UUID().uuidString).md"
        defer { memory.forget(url(name)) }

        memory.record(line: 3, for: url("./\(name)"))

        #expect(memory.place(for: url(name)).line == 3)
    }

    @Test("a trashed file is forgotten")
    func forgets() {
        let memory = ScrollMemory.shared
        let file = url("gone-\(UUID().uuidString).md")

        memory.record(line: 7, for: file)
        memory.forget(file)

        #expect(memory.place(for: file).line == nil)
    }
}
