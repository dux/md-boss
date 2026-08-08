import SwiftUI

/// The Settings window. Two sections: the theme, and the four text sizes.
///
/// Hand-rolled rather than a `Form` with system `Stepper`s for the same reason the layout
/// and the root picker are hand-rolled: stock controls cannot be forced to the paper
/// palette, and this would be the one window in the app showing system chrome.
///
/// Every change writes straight through `AppSettings`, so the main window restyles live
/// behind this one - the chrome through `TextStyleModifier`, the editor through
/// `MarkdownTextView`, the preview through the existing `mdSetTheme` / `mdSetFontSize`
/// bridge calls.
struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    /// Three across fits all eight cards in three rows inside the existing 360pt window.
    private let themeColumns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Theme").textStyle(.title)

            LazyVGrid(columns: themeColumns, spacing: 12) {
                ForEach(Theme.all) { card($0) }
            }

            Divider().overlay(theme[.border])

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

    /// One theme, painted in its own palette - the grid is a preview, not a list of names.
    /// The selection ring is the exception: it belongs to the window's chrome, so it is
    /// drawn in the *active* theme's accent rather than the card's.
    private func card(_ candidate: Theme) -> some View {
        let isSelected = candidate.id == theme.id

        return Button {
            settings.setTheme(candidate.id)
        } label: {
            VStack(spacing: 5) {
                swatch(candidate)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(isSelected ? theme[.accent] : theme[.border],
                                    lineWidth: isSelected ? 2 : 1)
                    )

                Text(candidate.title)
                    .textStyle(.small)
                    .foregroundColor(isSelected ? theme[.text] : theme[.muted])
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func swatch(_ candidate: Theme) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach([ThemeToken.surface, .accent, .link], id: \.self) { token in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(candidate[token])
                        .frame(height: 8)
                }
            }

            Text("Aa")
                .textStyle(.small, weight: .semibold)
                .foregroundColor(candidate[.text])
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(candidate[.bg])
        .clipShape(RoundedRectangle(cornerRadius: 6))
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

    /// Matches the chrome of `MeasureControls` - same corner radius,
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
