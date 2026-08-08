import SwiftUI
import UniformTypeIdentifiers

/// The sidebar's root-folder select box.
///
/// Hand-rolled rather than a `Picker`/`Menu` for the same reason the layout is a hand-rolled
/// `HStack`: system popup chrome cannot be forced to the paper palette, and this box sits
/// directly on the sidebar where any mismatch shows.
///
/// The fill is `.bg` and not `.surface` - in the paper palette `surface` and `sidebarBg` are
/// the same hex, so a `.surface` box would be invisible against the sidebar.
struct RootPickerBox: View {
    @Binding var isOpen: Bool

    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var folders = RootFoldersManager.shared
    @ObservedObject private var manager = MdBossManager.shared

    @State private var isHovered = false
    @State private var isDropTarget = false

    private var theme: Theme { settings.theme }

    /// One definition, read here and by the sidebar to place the dropdown below the box.
    @MainActor
    static var height: CGFloat { max(26, (AppSettings.shared.fontButtons + 14).rounded()) }

    var body: some View {
        Button {
            if folders.active == nil {
                manager.openFolderPanel()
            } else {
                isOpen.toggle()
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .iconStyle(.buttons, scale: 0.9)
                    .foregroundColor(theme[folders.active == nil ? .muted : .accent])

                Text(folders.active?.lastPathComponent ?? "Add a folder…")
                    .textStyle(.buttons, weight: .medium)
                    .foregroundColor(theme[folders.active == nil ? .muted : .text])
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer(minLength: 0)

                Image(systemName: "chevron.up.chevron.down")
                    .iconStyle(.buttons, scale: 0.75, weight: .semibold)
                    .foregroundColor(theme[.muted])
            }
            .padding(.horizontal, 8)
            .frame(height: Self.height)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(theme[.bg])
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(
                                // The plain button gives no drop feedback of its own, so the
                                // border it already has does the work.
                                theme[isDropTarget ? .accent : (isHovered || isOpen ? .borderStrong : .border)],
                                lineWidth: isDropTarget ? 1.5 : 1
                            )
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help(folders.active?.path ?? "Add a folder (⌘O)")
        .onDrop(of: [.fileURL], isTargeted: dropBinding) { providers in
            isDropTarget = false
            guard let active = folders.active else { return false }
            return manager.acceptDrop(providers, into: active)
        }
        .contextMenu { menu }
    }

    private var dropBinding: Binding<Bool> {
        Binding(
            get: { isDropTarget },
            set: { isTargeted in
                guard isTargeted else {
                    isDropTarget = false
                    return
                }
                guard let active = folders.active,
                      let dragged = manager.draggedFile,
                      manager.canMove(dragged, into: active) else { return }
                isDropTarget = true
            }
        )
    }

    @ViewBuilder
    private var menu: some View {
        if let active = folders.active {
            if let cut = manager.cutFile, manager.canMove(cut, into: active) {
                Button("Move \(cut.lastPathComponent) Here") { manager.moveCut(into: active) }
                Divider()
            }
            Button("Copy Path") { manager.copyPath(active) }
            Button("Copy Name") { manager.copyText(active.lastPathComponent) }
            Divider()
            Button("Reveal in Finder") { manager.revealInFinder(active) }
            Divider()
            Button("Remove from Sidebar") { folders.remove(active) }
        }
    }
}

/// The dropped-open list. Drawn as an overlay so it covers the tree instead of pushing it
/// down, which is what makes it read as a select box rather than a disclosure group.
struct RootPickerList: View {
    @Binding var isOpen: Bool
    /// Keyboard highlight, driven by the sidebar's key handler.
    let highlighted: Int
    /// Room the sidebar has left below the box. Twenty entries are taller than a short window.
    let maxHeight: CGFloat

    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var folders = RootFoldersManager.shared

    @State private var hovered: String?

    private var theme: Theme { settings.theme }

    private var rowHeight: CGFloat { max(22, (settings.fontDefault + 9).rounded()) }

    /// A `ScrollView` fills whatever it is given, so the height is computed rather than
    /// left to fit - otherwise three folders would still draw a full-height list.
    private var height: CGFloat {
        let count = CGFloat(folders.recent.count)
        let natural = count * rowHeight + max(0, count - 1)
        return min(natural, max(rowHeight, maxHeight - 8))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(folders.recent.enumerated()), id: \.element) { index, url in
                        row(url, isHighlighted: index == highlighted).id(index)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            // Arrowing down a long list must not walk the highlight out of sight.
            .onChange(of: highlighted) { _, index in proxy.scrollTo(index, anchor: nil) }
        }
        .frame(height: height)
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(theme[.bg])
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(theme[.borderStrong], lineWidth: 1)
                )
                // Without a shadow the tree peeking out either side of the list reads as a
                // drawing glitch rather than as something the list is sitting on top of.
                .shadow(color: theme[.borderStrong].opacity(0.6), radius: 6, y: 2)
        )
    }

    private func row(_ url: URL, isHighlighted: Bool) -> some View {
        let isActive = url == folders.active

        return HStack(spacing: 6) {
            Image(systemName: "checkmark")
                .iconStyle(.default, scale: 0.7, weight: .semibold)
                .foregroundColor(theme[.accent])
                .frame(width: (10 * settings.fontDefault / SettingsData().fontDefault).rounded())
                .opacity(isActive ? 1 : 0)

            Text(url.lastPathComponent)
                .textStyle(.default, weight: isActive ? .semibold : .regular)
                .foregroundColor(theme[.text])
                .lineLimit(1)

            // Two folders called "docs" are otherwise indistinguishable.
            Text(url.deletingLastPathComponent().path.abbreviatingHome)
                .textStyle(.small)
                .foregroundColor(theme[.muted])
                .lineLimit(1)
                .truncationMode(.head)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .frame(height: rowHeight)
        .contentShape(Rectangle())
        .rowHighlight(
            theme: theme,
            isSelected: isHighlighted,
            isFocused: isHighlighted,
            isHovered: hovered == url.path
        )
        .onHover { hovered = $0 ? url.path : nil }
        .onTapGesture {
            folders.select(url)
            isOpen = false
        }
        .help(url.path)
    }
}

extension String {
    /// `/Users/me/dev` reads as `~/dev` - the home prefix is noise in a sidebar this narrow.
    var abbreviatingHome: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard self == home || hasPrefix(home + "/") else { return self }
        return "~" + dropFirst(home.count)
    }
}
