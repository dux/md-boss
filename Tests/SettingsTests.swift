import Testing
import SwiftUI
@testable import MdBoss

// Everything here is pure - nothing touches AppSettings.shared, which would read and
// rewrite the real ~/.config/md-boss/settings.json.

@Suite("Font settings")
struct FontSettingTests {
    @Test("every default sits inside its own range", arguments: FontSetting.allCases)
    func defaultsAreInRange(setting: FontSetting) {
        #expect(setting.range.contains(setting.defaultValue))
    }

    @Test("each setting points at a distinct stored size")
    func keyPathsAreDistinct() {
        var data = SettingsData()
        for (offset, setting) in FontSetting.allCases.enumerated() {
            data[keyPath: setting.keyPath] = CGFloat(100 + offset)
        }
        let written = FontSetting.allCases.map { data[keyPath: $0.keyPath] }
        #expect(Set(written).count == FontSetting.allCases.count)
    }

    @Test("clamping holds at both ends", arguments: FontSetting.allCases)
    func clampsAtBothEnds(setting: FontSetting) {
        #expect(setting.clamp(setting.range.lowerBound - 5) == setting.range.lowerBound)
        #expect(setting.clamp(setting.range.upperBound + 5) == setting.range.upperBound)
        #expect(setting.clamp(setting.defaultValue) == setting.defaultValue)
    }

    @Test("the four surfaces the settings window names are all covered")
    func coversEverySurface() {
        #expect(FontSetting.allCases.map(\.rawValue) == ["sidebar", "buttons", "editor", "preview"])
    }

    @Test("Cmd-+/- is scoped to the document panes")
    func zoomLeavesChromeAlone() {
        #expect(MdBossManager.zoomable == [.editor, .preview])
    }
}

@Suite("Derived text sizes")
struct CaptionSizeTests {
    @Test("captions track the sidebar size two points down")
    func tracksBase() {
        #expect(AppSettings.captionSize(base: 13) == 11)
        #expect(AppSettings.captionSize(base: 20) == 18)
    }

    @Test("captions never fall below nine points")
    func hasAFloor() {
        #expect(AppSettings.captionSize(base: FontSetting.sidebar.range.lowerBound) == 9)
        #expect(AppSettings.captionSize(base: 4) == 9)
    }
}
