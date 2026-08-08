import Foundation
import Combine

/// Keeps the raw pane and the preview looking at the same part of the document.
///
/// A Combine subject rather than an `@Published` on `MdBossManager`: this fires on every
/// scroll frame, and everything observing the manager - ContentView, the sidebar, the status
/// bar - would re-evaluate its body sixty times a second. The two panes subscribe from their
/// coordinators, which are AppKit objects and need no SwiftUI update pass at all.
@MainActor
final class ScrollSync {
    static let shared = ScrollSync()

    struct Move {
        /// 1-based source line at the top of the driving pane, with the fractional part
        /// saying how far into that line it sits. Fractional rather than whole so a slow
        /// drag moves the other pane smoothly instead of in line-sized steps.
        let line: Double
        let source: Pane
    }

    let moves = PassthroughSubject<Move, Never>()

    /// How long a pane stays quiet after being moved by the other one. A programmatic
    /// scroll settles over several frames, and a trackpad fling keeps reporting well after
    /// the finger is gone; both would otherwise read as the follower taking over.
    private static let quiet: TimeInterval = 0.15

    private var driver: Pane?
    private var appliedAt = Date.distantPast

    private init() {}

    /// Reported by a pane when the user scrolls it.
    func report(line: Double, from pane: Pane) {
        let panes = AppSettings.shared.panes
        guard panes.contains(.raw), panes.contains(.preview) else { return }

        // The pane already driving keeps driving; any other one has to wait for it to go
        // quiet. That is the whole of last-driver-wins, and it is what stops the two panes
        // from pushing each other down the document.
        guard driver == pane || Date().timeIntervalSince(appliedAt) > Self.quiet else { return }

        driver = pane
        moves.send(Move(line: line, source: pane))
    }

    /// Called by the pane that just followed a move, to restart the quiet window.
    func applied() {
        appliedAt = Date()
    }

    /// Opening a different file invalidates whoever was driving.
    func reset() {
        driver = nil
        appliedAt = .distantPast
    }
}
