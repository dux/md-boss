import Foundation

/// Moving one file in the sidebar: what has to be true before anything is touched, and
/// what has to be rewritten afterwards.
///
/// Free functions rather than methods on the manager, so both halves can be driven from a
/// fixture without a window, a root folder or an open document.
enum FileMove {
    // MARK: - Validation

    enum Refusal: Equatable {
        case missingSource
        /// Moving a folder means one rewrite pair per document inside it, and a decision
        /// about the folder's own links. Not this change.
        case notAFile
        case badDestination
        case sameFolder
        case intoItself
        case exists

        /// Nil for a drop that changes nothing - putting a file back where it already lives
        /// is a no-op, not a mistake to complain about.
        func message(for source: URL, into destination: URL) -> String? {
            let name = source.lastPathComponent
            switch self {
            case .missingSource: return "\(name) is no longer there"
            case .notAFile: return "Only files can be moved"
            case .badDestination: return "\(destination.lastPathComponent) is not a folder"
            case .sameFolder: return nil
            case .intoItself: return "A folder cannot be moved into itself"
            case .exists: return "\(destination.lastPathComponent) already has a \(name)"
            }
        }
    }

    /// Nil when the move can go ahead.
    nonisolated static func check(_ source: URL, into destination: URL) -> Refusal? {
        var sourceIsDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: source.path, isDirectory: &sourceIsDirectory) else {
            return .missingSource
        }
        guard !sourceIsDirectory.boolValue else { return .notAFile }

        var destinationIsDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: destination.path, isDirectory: &destinationIsDirectory),
              destinationIsDirectory.boolValue else { return .badDestination }

        let parent = source.deletingLastPathComponent().standardizedFileURL
        guard parent.path != destination.standardizedFileURL.path else { return .sameFolder }
        // Vacuous for a file and exact for a folder, and it compares on path boundaries
        // rather than by prefix - `/work/notes-old` is not part of `/work/notes`.
        guard !AnnotationPath.isUnder(destination, root: source) else { return .intoItself }

        let target = destination.appendingPathComponent(source.lastPathComponent)
        guard !FileManager.default.fileExists(atPath: target.path) else { return .exists }
        return nil
    }

    // MARK: - The rewrite pass

    struct Rewrite: Sendable {
        let url: URL
        let text: String
        let count: Int
    }

    /// Every document under `root` whose text changes once `moves` have happened.
    ///
    /// `buffers` and `excluding` are keyed by `MarkdownLinks.canonical(_:).path`, which is
    /// also what the enumerator's URLs are put through - a temp folder reached as `/var`
    /// and as `/private/var` is one file and has to key as one.
    ///
    /// Runs off the main actor: a large project is a few hundred files to read, and a drop
    /// that freezes the sidebar while it thinks reads as a broken drag. The result is the
    /// same either side of the rename - resolution is path arithmetic and never asks the
    /// disk whether the file is there - so the move goes first and this follows it.
    nonisolated static func plan(
        root: URL,
        skipFolders: Set<String>,
        moves: [MarkdownLinks.Move],
        buffers: [String: String] = [:],
        excluding: Set<String> = []
    ) -> [Rewrite] {
        guard !moves.isEmpty else { return [] }

        var rewrites: [Rewrite] = []
        for url in FileTree.documents(under: root, skipFolders: skipFolders) {
            let path = MarkdownLinks.canonical(url).path
            guard !excluding.contains(path) else { continue }

            // A file we cannot decode as UTF-8 is shown but never written, the same rule
            // MarkdownDocument applies - rewriting through a re-encode destroys the original.
            guard let text = buffers[path] ?? (try? String(contentsOf: url, encoding: .utf8)) else { continue }
            guard let result = MarkdownLinks.rewriting(
                text,
                in: url.deletingLastPathComponent(),
                applying: moves
            ) else { continue }

            rewrites.append(Rewrite(url: url, text: result.text, count: result.count))
        }
        return rewrites
    }
}
