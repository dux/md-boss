import Testing
import Foundation
@testable import MdBoss

// Everything here is pure except the `sh -n` check, which writes to a temp file.
// Nothing touches ~/bin - only `CLIShim.install` does, and it is never called.

@Suite("CLI shim")
struct CLIShimTests {
    private let appPath = "/Applications/MdBoss.app"

    @Test("a missing shim is written")
    func missingIsWritten() {
        #expect(CLIShim.plan(existing: nil, appPath: appPath) == .write)
    }

    @Test("the shim we already wrote is left alone")
    func matchingIsUpToDate() {
        #expect(CLIShim.plan(existing: CLIShim.script(appPath: appPath), appPath: appPath) == .upToDate)
    }

    @Test("a shim naming the old location is rewritten")
    func movedAppIsRewritten() {
        let stale = CLIShim.script(appPath: "/Users/x/Downloads/MdBoss.app")
        #expect(CLIShim.plan(existing: stale, appPath: appPath) == .write)
    }

    @Test("a shim from `hammer link` is adopted")
    func legacyIsAdopted() {
        let legacy = """
        #!/bin/sh
        # Installed by `hammer link`. Opens a folder or file in md-boss.
        APP="/Applications/MdBoss.app"
        exec open -a "$APP"
        """
        #expect(CLIShim.plan(existing: legacy, appPath: appPath) == .write)
    }

    @Test("someone else's script at that path is never overwritten")
    func foreignIsLeftAlone() {
        let mine = "#!/bin/sh\nexec my-own-thing \"$@\"\n"
        #expect(CLIShim.plan(existing: mine, appPath: appPath) == .foreign)
    }

    @Test("the bundle path is quoted for the shell")
    func quotesTheBundlePath() {
        let script = CLIShim.script(appPath: #"/Volumes/My "Disk"/$HOME/MdBoss.app"#)
        #expect(script.contains(#"APP="/Volumes/My \"Disk\"/\$HOME/MdBoss.app""#))
    }

    @Test("the shim hands the path to LaunchServices")
    func opensThroughLaunchServices() {
        let script = CLIShim.script(appPath: appPath)
        #expect(script.hasPrefix("#!/bin/sh\n"))
        #expect(script.contains(#"exec open -a "$APP""#))
    }

    /// The quoting is the whole risk in this file, so let /bin/sh be the judge of it.
    @Test("the generated script parses as shell")
    func parsesAsShell() throws {
        let path = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("md-boss-shim-test.sh")
        defer { try? FileManager.default.removeItem(at: path) }
        try CLIShim.script(appPath: #"/Volumes/My "Disk"/$HOME/MdBoss.app"#)
            .write(to: path, atomically: true, encoding: .utf8)

        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/sh")
        shell.arguments = ["-n", path.path]
        try shell.run()
        shell.waitUntilExit()
        #expect(shell.terminationStatus == 0)
    }
}
