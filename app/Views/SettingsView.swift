import SwiftUI

/// The Settings window. One section, four sizes.
///
/// Hand-rolled rather than a `Form` with system `Stepper`s for the same reason the layout
/// and the root picker are hand-rolled: stock controls cannot be forced to the paper
/// palette, and this would be the one window in the app showing system chrome.
///
/// Every change writes straight through `AppSettings`, so the main window restyles live
/// behind this one - the chrome through `TextStyleModifier`, the editor through
/// `MarkdownTextView`, the preview through the existing `mdSetFontSize` bridge call.
struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Font size").textStyle(.title)

            VStack(spacing: 10) {
                ForEach(FontSetting.allCases) { setting in
                    row(setting)
                }
            }

            Divider().overlay(theme[.border])

            HStack {
                Spacer()
                Button("Reset to defaults") { settings.resetFontSizes() }
                    .buttonStyle(.plain)
                    .textStyle(.buttons)
                    .foregroundColor(theme[.link])
                    .disabled(isDefault)
                    .opacity(isDefault ? 0.4 : 1)
            }
        }
        .padding(20)
        .frame(width: 360, alignment: .leading)
        .background(theme[.bg])
    }

    private var isDefault: Bool {
        FontSetting.allCases.allSatisfy { settings.fontSize($0) == $0.defaultValue }
    }

    private func row(_ setting: FontSetting) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(setting.title)
                    .textStyle(.default)
                    .foregroundColor(theme[.text])
                Text(setting.detail)
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
            }

            Spacer(minLength: 0)

            stepper(setting)
        }
    }

    /// Matches the chrome of the measure controls in `PaneToggleBar` - same corner radius,
    /// same border, same plain buttons.
    private func stepper(_ setting: FontSetting) -> some View {
        HStack(spacing: 0) {
            step(setting, by: -1, icon: "minus")

            Rectangle().fill(theme[.border]).frame(width: 1, height: 16)

            // Monospaced so the digits do not jiggle while stepping.
            Text("\(Int(settings.fontSize(setting)))")
                .textStyle(.small, mono: true)
                .foregroundColor(theme[.text])
                .frame(width: 30)

            Rectangle().fill(theme[.border]).frame(width: 1, height: 16)

            step(setting, by: 1, icon: "plus")
        }
        .background(theme[.surface])
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme[.border], lineWidth: 1)
        )
    }

    private func step(_ setting: FontSetting, by delta: CGFloat, icon: String) -> some View {
        let enabled = settings.canChangeFontSize(setting, by: delta)

        return Button {
            settings.changeFontSize(setting, by: delta)
        } label: {
            Image(systemName: icon)
                .iconStyle(.buttons, scale: 0.75, weight: .semibold)
                .foregroundColor(theme[.muted])
                .frame(width: 26, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
        .help(delta > 0 ? "Bigger" : "Smaller")
    }
}
