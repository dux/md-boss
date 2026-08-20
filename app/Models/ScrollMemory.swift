import Foundation

/// Where each document was left, so coming back to one lands where you stopped reading
/// rather than at the top of it. Reading a project means walking between files and back;
/// losing your place every time you follow a link is what makes that walk expensive.
///
/// Deliberately not `@Observable` and not a `@Published`: this is written on every scroll
/// frame, and anything observing it would re-evaluate its body sixty times a second. Same
/// reasoning as `ScrollSync` being a Combine subject.
///
/// It also stays out of `SettingsData`, which is the whole persisted surface: a position per
/// file would grow that file without bound and rewrite it while you scroll. The memory is
/// the session's.
@MainActor
final class ScrollMemory {
    static let shared = ScrollMemory()

    /// The two kinds of place a document can be left in.
    ///
    /// A *line* for text. The raw pane and the preview both speak in source lines, so one
    /// recorded number serves both, and a line survives a font or measure change that a
    /// pixel offset would not. *Pixels* for a table: a CSV has no anchors to interpolate
    /// against, and it scrolls sideways as well as down.
    struct Place: Equatable {
        var line: Double?
        var table: CGPoint?
    }

    private var places: [String: Place] = [:]

    private init() {}

    func place(for url: URL?) -> Place {
        guard let url else { return Place() }
        return places[Self.key(url)] ?? Place()
    }

    func record(line: Double, for url: URL) {
        places[Self.key(url), default: Place()].line = line
    }

    func record(table offset: CGPoint, for url: URL) {
        places[Self.key(url), default: Place()].table = offset
    }

    /// A file that moved keeps its place - it is the same document one path later.
    func relocate(from source: URL, to target: URL) {
        guard let place = places.removeValue(forKey: Self.key(source)) else { return }
        places[Self.key(target)] = place
    }

    func forget(_ url: URL) {
        places.removeValue(forKey: Self.key(url))
    }

    private static func key(_ url: URL) -> String { url.standardizedFileURL.path }
}
