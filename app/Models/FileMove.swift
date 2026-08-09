import Foundation

/// Moving or renaming one file in the sidebar: what has to be true before anything is
/// touched, and what has to be rewritten afterwards.
///
/// A rename is a move that stays in the folder it started in, so the two share everything
/// past the validation - one `MarkdownLinks.Move` either way, and the rewrite pass is path
/// arithmetic that never asks the disk where the file went.
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
        /// Empty, hidden, or carrying a separator. A rename names a sibling; anything that
        /// would move the file or hide it from the tree is not one.
        case badName
        /// The name it already has.
        case unchanged

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
            case .badName, .unchanged: return nil
            }
        }

        /// The same refusals said the way a rename would say them. Nil where there is nothing
        /// to complain about: retyping the name a file already has is a no-op, not a mistake.
        func message(forRenaming source: URL, to name: String) -> String? {
            switch self {
            case .missingSource: return "\(source.lastPathComponent) is no longer there"
            case .notAFile: return "Only files can be renamed"
            case .badName: return "\(name) is not a file name"
            case .exists: return "\(source.deletingLastPathComponent().lastPathComponent) already has a \(name)"
            case .unchanged: return nil
            case .badDestination, .sameFolder, .intoItself: return nil
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

    /// Nil when the rename can go ahead. `name` is the final file name, extension included -
    /// the caller has already put it through `FileTree.documentName`.
    nonisolated static func checkRename(_ source: URL, to name: String) -> Refusal? {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: source.path, isDirectory: &isDirectory) else {
            return .missingSource
        }
        guard !isDirectory.boolValue else { return .notAFile }

        // A separator would make this a move, `.` and `..` name the folder the file is
        // already in, and a leading dot would hide it from a tree that skips hidden files -
        // renaming a file into thin air is the one outcome here worth ruling out.
        guard !name.isEmpty,
              !name.hasPrefix("."),
              !name.contains("/"),
              !name.contains(":") else { return .badName }

        guard name != source.lastPathComponent else { return .unchanged }

        let target = source.deletingLastPathComponent().appendingPathComponent(name)
        // On a case-insensitive volume `plan.md` -> `Plan.md` finds a file already sitting at
        // the target: itself. Identity tells that from a real collision; comparing the paths
        // would not, because standardizing does not fold case.
        guard !FileManager.default.fileExists(atPath: target.path) || isSameFile(target, source) else {
            return .exists
        }
        return nil
    }

    nonisolated private static func isSameFile(_ lhs: URL, _ rhs: URL) -> Bool {
        let key = URLResourceKey.fileResourceIdentifierKey
        guard let left = try? lhs.resourceValues(forKeys: [key]).fileResourceIdentifier,
              let right = try? rhs.resourceValues(forKeys: [key]).fileResourceIdentifier else { return false }
        return left.isEqual(right)
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
