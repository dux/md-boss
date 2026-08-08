import Foundation

/// The `md-boss` command line shim in `~/bin`.
///
/// The app writes it itself, on every launch, rather than leaving it to the build script -
/// a copy of MdBoss.app dropped into /Applications by hand gets a working `md-boss` too.
/// The shim names the bundle that wrote it, so moving the app repairs itself next launch.
enum CLIShim {
    /// `~/bin` rather than `/usr/local/bin`: no admin prompt, and it is where the build
    /// script has always put it.
    static let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("bin/md-boss")

    /// Only a file carrying this line is ever rewritten, so a `md-boss` of the user's own
    /// making at that path is left alone.
    private static let marker = "# Installed by md-boss."

    /// What `hammer link` used to write. Recognised so a machine set up by the old build
    /// script is adopted rather than treated as a stranger.
    private static let legacyMarker = "# Installed by `hammer link`."

    /// What a launch should do about the file that is, or is not, already there.
    enum Action: Equatable {
        case upToDate
        case write
        /// Someone else's script sits at that path.
        case foreign
        case failed
    }

    // MARK: Deciding

    /// `open -a APP <path>` sends an open-document event, which a running instance picks up.
    /// `--args` would only be seen on a cold launch.
    static func script(appPath: String) -> String {
        """
        #!/bin/sh
        \(marker) Opens a folder or file in md-boss.
        # `md-boss .` adds the current directory to the sidebar.
        APP="\(shellQuoted(appPath))"
        if [ -n "$1" ]; then
          # CDPATH makes a bare `cd` echo the directory, so send that to /dev/null.
          exec open -a "$APP" "$(cd -- "$(dirname -- "$1")" >/dev/null 2>&1 && pwd)/$(basename -- "$1")"
        else
          exec open -a "$APP"
        fi
        """
    }

    static func plan(existing: String?, appPath: String) -> Action {
        guard let existing else { return .write }
        guard existing.contains(marker) || existing.contains(legacyMarker) else { return .foreign }
        return existing == script(appPath: appPath) ? .upToDate : .write
    }

    /// The bundle path lands inside a double-quoted shell assignment. Backslashes go first,
    /// or the escapes added after them would be escaped again.
    private static func shellQuoted(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "$", with: "\\$")
            .replacingOccurrences(of: "`", with: "\\`")
    }

    // MARK: Writing

    /// Writes the shim if it is missing or names some other bundle, and reports what it did.
    @discardableResult
    static func install(appURL: URL) -> Action {
        // `swift run` and the test bundle have no .app for the shim to point at.
        guard appURL.pathExtension == "app" else { return .upToDate }

        let decision = plan(existing: try? String(contentsOf: url, encoding: .utf8), appPath: appURL.path)
        guard decision == .write else { return decision }

        do {
            let files = FileManager.default
            try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            // An atomic write replaces the file, so the mode has to be set after it.
            try script(appPath: appURL.path).write(to: url, atomically: true, encoding: .utf8)
            try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
            return .write
        } catch {
            return .failed
        }
    }

    /// The launch path. Disk work happens off the main actor, and only a change is worth
    /// saying out loud.
    @MainActor
    static func installInBackground() {
        let settings = AppSettings.shared
        guard settings.installCLI else { return }

        let appURL = Bundle.main.bundleURL
        Task.detached(priority: .utility) {
            let result = install(appURL: appURL)
            await MainActor.run {
                switch result {
                case .write:
                    Toast.shared.info("Installed the md-boss command in ~/bin")
                case .failed:
                    // Otherwise the same failure would toast on every launch from here on.
                    settings.installCLI = false
                    Toast.shared.error("Could not write ~/bin/md-boss - CLI install turned off")
                case .upToDate, .foreign:
                    break
                }
            }
        }
    }
}
