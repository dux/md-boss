import Darwin
import Foundation

/// Walking a subtree with `readdir(3)`.
///
/// This exists because the walk is half the cost of a project-wide search. `FileManager`'s
/// enumerator asks `resourceValues(forKeys: [.isDirectoryKey])` for every entry it yields -
/// an `lstat(2)` plus a `URL` and a resource dictionary each time. `readdir` already carries
/// the entry's type in `d_type`, so the common case needs no stat and no object at all: names
/// stay as bytes until an entry turns out to be a directory we must descend or a document we
/// must return.
///
/// Over 3,829 documents under `~/dev`, both walks split one subtree per core: 0.7-1.2s for
/// the enumerator against a steady 330ms here. The spread is the point as much as the median
/// - the enumerator's cost is a stat per entry and moves with how warm the metadata cache is,
/// while a walk that does not stat has nothing to be cold about. Re-run it with `hammer bench`.
///
/// Symlinks are never followed, the same as the enumerator, which is also what makes a cycle
/// impossible without tracking visited inodes.
enum DirectoryWalk {
    /// Byte offset of `d_name` inside `dirent`, so an entry's name can be read in place.
    /// Taking `withUnsafePointer(to: entry.pointee.d_name)` instead would copy the struct's
    /// 1024-byte name buffer once per entry, which is the cost this whole type exists to avoid.
    private static let nameOffset: Int = {
        guard let offset = MemoryLayout<dirent>.offset(of: \dirent.d_name) else {
            // Every field of an imported C struct is stored, so this cannot happen - but
            // reading a name from the wrong offset would be a wild pointer, not a wrong
            // answer, and that is not a thing to let a default paper over.
            preconditionFailure("dirent.d_name is not a stored property")
        }
        return offset
    }()

    /// Directories the sidebar treats as opaque files. `FileManager`'s
    /// `.skipsPackageDescendants` asks LaunchServices; this is the name-shaped approximation
    /// of it, and only `DocumentScanner` asks for it - see `documents(under:...)`.
    static let packageExtensions: Set<String> = [
        "app", "bundle", "framework", "kext", "plugin", "rtfd", "playground",
        "xcodeproj", "xcworkspace", "photoslibrary", "fcpbundle", "sparsebundle"
    ]

    /// Every document below `path`, however deep.
    ///
    /// Within one directory, documents come before subtrees and each group is sorted by name,
    /// so the same tree always answers the same way. `readdir` order is stable for an
    /// unchanged directory but is not defined to be anything, and search results that shuffle
    /// between keystrokes are worth a sort per directory to rule out.
    ///
    /// - Parameter skipPackages: descends into `Foo.app` and friends unless set. Off for the
    ///   search walk, which is what `FileManager.enumerator` did there; on for
    ///   `DocumentScanner`, which passed `.skipsPackageDescendants`.
    nonisolated static func documents(
        under path: String,
        skipFolders: Set<String>,
        skipPackages: Bool = false
    ) -> [String] {
        var found: [String] = []
        collect(path, skipFolders: skipFolders, skipPackages: skipPackages, into: &found)
        return found
    }

    /// Whether anything below `path` is a document, giving up after `budget` entries.
    ///
    /// Fails *open* on the budget - a folder too big to scan is shown rather than hidden,
    /// because hiding real content is the worse of the two wrong answers.
    nonisolated static func containsDocument(
        under path: String,
        skipFolders: Set<String>,
        budget: Int,
        skipPackages: Bool = true
    ) -> Bool {
        var examined = 0
        return probe(path, skipFolders: skipFolders, skipPackages: skipPackages, examined: &examined, budget: budget)
    }

    // MARK: - The walk

    private static func collect(
        _ path: String,
        skipFolders: Set<String>,
        skipPackages: Bool,
        into found: inout [String]
    ) {
        var documents: [String] = []
        var subtrees: [String] = []

        // An unreadable directory is not an error here. The sidebar reports "denied" from
        // `FileTree.list`, which asks one level at a time; a whole-project pass that stopped
        // at the first protected folder would find nothing at all.
        children(of: path, skipFolders: skipFolders, skipPackages: skipPackages) { name, isDirectory in
            if isDirectory { subtrees.append(name) } else { documents.append(name) }
        }

        documents.sort()
        subtrees.sort()

        for name in documents { found.append(path + "/" + name) }
        for name in subtrees {
            collect(path + "/" + name, skipFolders: skipFolders, skipPackages: skipPackages, into: &found)
        }
    }

    private static func probe(
        _ path: String,
        skipFolders: Set<String>,
        skipPackages: Bool,
        examined: inout Int,
        budget: Int
    ) -> Bool {
        var subtrees: [String] = []
        var hit = false

        // Every entry `readdir` handed back, not just the ones that got through the filter -
        // the budget is there to bound a huge document-free folder, and those are exactly the
        // folders where almost nothing gets through.
        examined += children(of: path, skipFolders: skipFolders, skipPackages: skipPackages) { name, isDirectory in
            if isDirectory { subtrees.append(name) } else { hit = true }
        }

        if hit { return true }
        if examined > budget { return true }

        for name in subtrees.sorted() {
            if probe(
                path + "/" + name,
                skipFolders: skipFolders,
                skipPackages: skipPackages,
                examined: &examined,
                budget: budget
            ) { return true }
        }
        return false
    }

    /// One directory, one `opendir`. Hands back only the entries that matter - directories
    /// worth descending and files the sidebar would list - and returns how many entries it
    /// had to look at to do it. Names are bare, not paths.
    ///
    /// Public because `FileTree.documents` has to see the top level before it can hand one
    /// subtree to each core.
    @discardableResult
    nonisolated static func children(
        of path: String,
        skipFolders: Set<String>,
        skipPackages: Bool = false,
        _ yield: (_ name: String, _ isDirectory: Bool) -> Void
    ) -> Int {
        guard let handle = opendir(path) else { return 0 }
        defer { closedir(handle) }

        var examined = 0
        while let entry = readdir(handle) {
            examined += 1
            let name = UnsafeRawPointer(entry)
                .advanced(by: nameOffset)
                .assumingMemoryBound(to: CChar.self)
            let length = Int(entry.pointee.d_namlen)

            // "." and ".." are dropped by the same rule that drops every dotfile, which is
            // what `.skipsHiddenFiles` amounts to in practice. A file carrying `UF_HIDDEN`
            // without a dot in its name is no longer hidden here; that would cost an lstat
            // per entry to keep, which is the exact cost this walk exists to remove.
            guard length > 0, name[0] != Int8(UInt8(ascii: ".")) else { continue }

            var isDirectory: Bool
            switch entry.pointee.d_type {
            case UInt8(DT_DIR):
                isDirectory = true
            case UInt8(DT_REG):
                isDirectory = false
            case UInt8(DT_LNK):
                // A symlink is whatever it points at, but we never descend one - so it can
                // only ever arrive here as a file, and only its extension decides.
                isDirectory = false
            default:
                // DT_UNKNOWN is real on some network and FUSE mounts. One stat for those
                // entries alone rather than dropping them, which would be a silent loss.
                var info = stat()
                guard lstat(path + "/" + String(cString: name), &info) == 0 else { continue }
                isDirectory = (info.st_mode & S_IFMT) == S_IFDIR
            }

            if isDirectory {
                let folder = String(cString: name)
                guard !skipFolders.contains(folder) else { continue }
                if skipPackages, isPackage(folder) { continue }
                yield(folder, true)
            } else {
                guard isDocument(name, length: length) else { continue }
                yield(String(cString: name), false)
            }
        }
        return examined
    }

    // MARK: - Names

    private static func isPackage(_ name: String) -> Bool {
        packageExtensions.contains((name as NSString).pathExtension.lowercased())
    }

    /// `FileTree.isDocument` without building a `URL` to ask. The extension is compared as
    /// packed lowercase bytes, so the overwhelming majority of a source tree - every `.swift`,
    /// `.js` and `.png` in it - costs a compare and no allocation.
    ///
    /// Kept in step with `FileTree.documentExtensions` by `packed`, which is built from it.
    private static func isDocument(_ name: UnsafePointer<CChar>, length: Int) -> Bool {
        var dot = -1
        var index = length - 1
        while index > 0 {
            if name[index] == Int8(UInt8(ascii: ".")) { dot = index; break }
            index -= 1
        }
        // No dot, a trailing dot, or a leading one (which `URL.pathExtension` does not
        // consider an extension either).
        guard dot > 0, dot < length - 1 else { return false }

        let count = length - dot - 1
        guard count <= 8 else { return false }

        var key: UInt64 = 0
        for offset in 0..<count {
            var byte = UInt8(bitPattern: name[dot + 1 + offset])
            if byte >= UInt8(ascii: "A"), byte <= UInt8(ascii: "Z") { byte += 32 }
            key |= UInt64(byte) << (UInt64(offset) * 8)
        }
        return packedExtensions.contains(key)
    }

    /// `FileTree.documentExtensions`, packed the way `isDocument` packs a name's suffix.
    /// Every one of them is ASCII and eight bytes or fewer, which the assertion below is
    /// there to keep true if the list ever grows.
    private static let packedExtensions: Set<UInt64> = {
        var packed: Set<UInt64> = []
        for extension_ in FileTree.documentExtensions {
            let bytes = Array(extension_.utf8)
            assert(bytes.count <= 8 && bytes.allSatisfy { $0 < 0x80 }, "\(extension_) cannot be packed")
            var key: UInt64 = 0
            for (offset, byte) in bytes.enumerated() {
                key |= UInt64(byte) << (UInt64(offset) * 8)
            }
            packed.insert(key)
        }
        return packed
    }()
}
