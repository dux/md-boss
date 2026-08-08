import SwiftUI
import AppKit

// MARK: - Stored settings
//
// One Codable struct is the whole persisted surface. Adding a setting means adding a
// property here and nowhere else - load() merges stored JSON over the defaults, so old
// config files stay readable and unknown keys are dropped rather than fatal.

struct SettingsData: Codable, Sendable, Equatable {
    var themeID = ThemeID.paper.rawValue
    /// The last theme used on each side of the light/dark line, so Cmd-Shift-D stays a
    /// polarity switch instead of becoming a cycle through every palette.
    var lightThemeID = ThemeID.paper.rawValue
    var darkThemeID = ThemeID.dark.rawValue

    /// Which panes the viewer shows, left to right in Pane.allCases order.
    var visiblePanes = [Pane.preview.rawValue]

    var sidebarWidth: CGFloat = 260
    var editorSplit: CGFloat = 0.5
    var showSidebar = true

    var previewFontSize: CGFloat = 17
    /// Reading measure in em, so the column tracks the text size rather than fighting it.
    /// 48em of the body serif is roughly 82 characters.
    var previewMeasure: CGFloat = 48
    var editorFontSize: CGFloat = 13
    var fontDefault: CGFloat = 13
    var fontButtons: CGFloat = 12

    /// Which note scopes are unfolded. Both wider ones start closed, so the open file's
    /// notes stay at the top of the column.
    var expandedNoteScopes: [String] = []

    var expandedPaths: [String] = []
    /// Reopened on launch.
    var lastOpenedFile: String?
    /// Where the Open Folder panel starts next time.
    var lastOpenedFolder: String?

    /// Never listed in the tree. Editable by hand in settings.json.
    var skipFolders = [
        "node_modules", ".build", ".git", "DerivedData",
        "Pods", "__pycache__", ".next", "vendor", "dist", "coverage"
    ]

    var windowX: CGFloat?
    var windowY: CGFloat?
    var windowWidth: CGFloat?
    var windowHeight: CGFloat?
}

/// The viewer's panes. The declaration order is the on-screen order.
enum Pane: String, CaseIterable, Sendable, Identifiable {
    case raw
    case preview
    case notes

    var id: String { rawValue }

    var title: String {
        switch self {
        case .raw: return "Raw"
        case .preview: return "Preview"
        case .notes: return "Notes"
        }
    }

    var icon: String {
        switch self {
        case .raw: return "chevron.left.forwardslash.chevron.right"
        case .preview: return "doc.richtext"
        case .notes: return "bookmark"
        }
    }

    /// Notes are a list, so they get a fixed column.
    /// Raw and preview are documents, so they share whatever is left.
    var fixedWidth: CGFloat? { self == .notes ? 300 : nil }

    /// Written by builds from before bookmarks and comments were one pane. Without this a
    /// config naming either one decodes to nothing and the viewer silently resets.
    static func named(_ stored: String) -> Self? {
        switch stored {
        case "bookmarks", "comments": return .notes
        default: return Self(rawValue: stored)
        }
    }
}

// MARK: - Adjustable text sizes

/// The four text sizes the settings window exposes, in on-screen order.
///
/// One list drives the window, the Bigger/Smaller Text commands and the reset, so the
/// clamps live here rather than as magic numbers at each call site.
enum FontSetting: String, CaseIterable, Sendable, Identifiable {
    case sidebar
    case buttons
    case editor
    case preview

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sidebar: return "Sidebar"
        case .buttons: return "Buttons"
        case .editor: return "Raw text"
        case .preview: return "Preview"
        }
    }

    var detail: String {
        switch self {
        case .sidebar: return "Folder and file names"
        case .buttons: return "Toolbar and pane buttons"
        case .editor: return "The editor pane"
        case .preview: return "The rendered document"
        }
    }

    var keyPath: WritableKeyPath<SettingsData, CGFloat> {
        switch self {
        case .sidebar: return \.fontDefault
        case .buttons: return \.fontButtons
        case .editor: return \.editorFontSize
        case .preview: return \.previewFontSize
        }
    }

    var range: ClosedRange<CGFloat> {
        switch self {
        case .sidebar: return 10...20
        case .buttons: return 9...18
        case .editor: return 9...24
        case .preview: return 11...28
        }
    }

    var defaultValue: CGFloat { SettingsData()[keyPath: keyPath] }

    func clamp(_ value: CGFloat) -> CGFloat {
        min(range.upperBound, max(range.lowerBound, value))
    }
}

// MARK: - AppSettings

@MainActor
@dynamicMemberLookup
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    // nonisolated: the debounced write runs off the main actor, and RootFoldersManager
    // shares the same directory.
    nonisolated static let configDir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/md-boss")
    nonisolated static let configFile = configDir.appendingPathComponent("settings.json")

    @Published var data: SettingsData {
        didSet {
            guard data != oldValue else { return }
            if data.themeID != oldValue.themeID { applyAppearance() }
            saveAsync()
        }
    }

    private var saveTask: Task<Void, Never>?

    private init() {
        data = Self.load()
    }

    /// Reads and writes settings by property name: `settings.sidebarWidth = 300`.
    /// SwiftUI bindings go through the published value instead: `$settings.data.sidebarWidth`.
    subscript<T>(dynamicMember keyPath: WritableKeyPath<SettingsData, T>) -> T {
        get { data[keyPath: keyPath] }
        set { data[keyPath: keyPath] = newValue }
    }

    // MARK: Derived

    var theme: Theme { Theme.named(ThemeID(rawValue: data.themeID) ?? .paper) }

    // MARK: Theme

    /// The three stored ids as the one value that carries the rules. See `ThemeChoice`.
    var themeChoice: ThemeChoice {
        ThemeChoice(
            active: ThemeID(rawValue: data.themeID) ?? .paper,
            light: ThemeID(rawValue: data.lightThemeID) ?? .paper,
            dark: ThemeID(rawValue: data.darkThemeID) ?? .dark
        )
    }

    /// The only two ways the theme changes.
    func setTheme(_ id: ThemeID) { apply(themeChoice.selecting(id)) }

    func toggleLightDark() { apply(themeChoice.flipped) }

    private func apply(_ choice: ThemeChoice) {
        data.themeID = choice.active.rawValue
        data.lightThemeID = choice.light.rawValue
        data.darkThemeID = choice.dark.rawValue
    }

    /// Captions and section headers track the sidebar size instead of being settings of
    /// their own - a status bar still at 11pt under an 18pt tree reads as a bug.
    /// These shadow the dynamic member lookup, so `settings.fontSmall` finds them first.
    nonisolated static func captionSize(base: CGFloat) -> CGFloat { max(9, base - 2) }

    var fontSmall: CGFloat { Self.captionSize(base: data.fontDefault) }
    var fontTitle: CGFloat { Self.captionSize(base: data.fontDefault) }

    // MARK: Text sizes

    func fontSize(_ setting: FontSetting) -> CGFloat { data[keyPath: setting.keyPath] }

    func setFontSize(_ setting: FontSetting, to value: CGFloat) {
        data[keyPath: setting.keyPath] = setting.clamp(value)
    }

    func changeFontSize(_ setting: FontSetting, by delta: CGFloat) {
        setFontSize(setting, to: fontSize(setting) + delta)
    }

    func canChangeFontSize(_ setting: FontSetting, by delta: CGFloat) -> Bool {
        setting.range.contains(fontSize(setting) + delta)
    }

    func resetFontSizes() {
        for setting in FontSetting.allCases {
            setFontSize(setting, to: setting.defaultValue)
        }
    }

    /// Always in declaration order, and never empty - a viewer with nothing in it is a bug,
    /// not a state worth supporting.
    var panes: [Pane] {
        let shown = Set(data.visiblePanes.compactMap(Pane.named))
        let ordered = Pane.allCases.filter { shown.contains($0) }
        return ordered.isEmpty ? [.preview] : ordered
    }

    func isVisible(_ pane: Pane) -> Bool { panes.contains(pane) }

    /// Turning off the last remaining pane is ignored.
    func toggle(_ pane: Pane) {
        var shown = Set(panes.map(\.rawValue))
        if shown.contains(pane.rawValue) {
            guard shown.count > 1 else { return }
            shown.remove(pane.rawValue)
        } else {
            shown.insert(pane.rawValue)
        }
        data.visiblePanes = Pane.allCases.map(\.rawValue).filter { shown.contains($0) }
    }

    func show(_ pane: Pane) {
        guard !isVisible(pane) else { return }
        toggle(pane)
    }

    func applyAppearance() {
        NSApp.appearance = NSAppearance(named: theme.appearance)
    }

    // MARK: Persistence

    /// Stored JSON is merged over the encoded defaults, so a config file written by an
    /// older build (missing keys) or a newer one (extra keys) still loads cleanly.
    private static func load() -> SettingsData {
        let fallback = SettingsData()
        guard let stored = try? Data(contentsOf: configFile),
              let storedJSON = (try? JSONSerialization.jsonObject(with: stored)) as? [String: Any],
              let defaultData = try? JSONEncoder().encode(fallback),
              let defaultJSON = (try? JSONSerialization.jsonObject(with: defaultData)) as? [String: Any] else {
            return fallback
        }

        let merged = defaultJSON.merging(storedJSON) { _, stored in stored }
        guard let mergedData = try? JSONSerialization.data(withJSONObject: merged),
              let decoded = try? JSONDecoder().decode(SettingsData.self, from: mergedData) else {
            return fallback
        }
        return decoded
    }

    private func saveAsync() {
        saveTask?.cancel()
        let snapshot = data
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            Self.writeToDisk(snapshot)
        }
    }

    nonisolated private static func writeToDisk(_ snapshot: SettingsData) {
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(snapshot) else { return }
        try? data.write(to: configFile, options: .atomic)
    }

    /// Flushes a pending debounced write. Called on terminate so the last drag or
    /// resize is never lost.
    func flush() {
        saveTask?.cancel()
        Self.writeToDisk(data)
    }
}
