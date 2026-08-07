import SwiftUI

struct SidebarView: View {
    @ObservedObject var tree: FileTreeModel
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var folders = RootFoldersManager.shared
    @ObservedObject private var manager = MdBossManager.shared

    @FocusState private var isFocused: Bool
    @State private var typeAhead = ""
    @State private var typeAheadReset: Task<Void, Never>?
    @State private var pickerIsOpen = false
    @State private var pickerCursor = 0

    private var theme: Theme { settings.theme }

    /// Box height plus its padding - what the dropdown has to clear.
    private var pickerInset: CGFloat { RootPickerBox.height + 10 + 6 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RootPickerBox(isOpen: $pickerIsOpen)
                .padding(.horizontal, 8)
                .padding(.top, 10)
                .padding(.bottom, 6)

            if tree.rows.isEmpty {
                EmptyPane(theme: theme, message: emptyMessage)
            } else {
                list
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme[.sidebarBg])
        .overlay(alignment: .top) { picker }
        .focusable()
        .focusEffectDisabled()
        .focused($isFocused)
        .onKeyPress(action: handleKey)
    }

    private var emptyMessage: String {
        guard let active = folders.active else { return "No folders yet.\nPress ⌘O to add one." }
        if tree.activeIsMissing { return "No folder or files found in\n\(active.path.abbreviatingHome)" }
        if tree.activeIsDenied { return "No access to that folder." }
        return "No documents here."
    }

    @ViewBuilder
    private var picker: some View {
        if pickerIsOpen {
            GeometryReader { proxy in
                ZStack(alignment: .top) {
                    // Anything outside the list closes it, the box included - clicking the
                    // box again is how you back out. Only the tree is tinted, so it reads
                    // as inactive while the list is up without dimming the box itself.
                    VStack(spacing: 0) {
                        Color.clear.frame(height: pickerInset)
                        theme[.sidebarBg].opacity(0.75)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { pickerIsOpen = false }

                    RootPickerList(
                        isOpen: $pickerIsOpen,
                        highlighted: pickerCursor,
                        // Leaves the same 8pt gap below the list as above it, so a capped
                        // list does not sit flush against the status bar.
                        maxHeight: proxy.size.height - pickerInset - 16
                    )
                    .padding(.horizontal, 8)
                    .padding(.top, pickerInset)
                }
            }
            .onAppear { pickerCursor = 0 }
        }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(tree.rows.enumerated()), id: \.element.id) { index, row in
                        SidebarRow(
                            row: row,
                            theme: theme,
                            isExpanded: tree.isExpanded(row.node),
                            isSelected: manager.selectedFile?.path == row.id,
                            isCursor: index == tree.cursor && isFocused
                        ) {
                            tree.toggle(row.node)
                        } onOpen: {
                            tree.cursor = index
                            isFocused = true
                            open(row)
                        }
                        .id(row.id)
                        .contextMenu { menu(for: row) }
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 8)
            }
            .onChange(of: tree.cursor) { _, index in
                guard tree.rows.indices.contains(index) else { return }
                proxy.scrollTo(tree.rows[index].id, anchor: nil)
            }
        }
    }

    @ViewBuilder
    private func menu(for row: FlatRow) -> some View {
        Button("Copy Path") { manager.copyPath(row.node.url) }
        Button("Copy Name") { manager.copyText(row.node.name) }
        Divider()
        Button("Reveal in Finder") { manager.revealInFinder(row.node.url) }
    }

    // MARK: Actions

    private func open(_ row: FlatRow) {
        if row.node.isDirectory {
            tree.toggle(row.node)
        } else {
            manager.open(row.node.url)
        }
    }

    // MARK: Keyboard
    //
    // Bare keys only. Every modified combination lives in the menu bar - overlapping
    // .onKeyPress with .keyboardShortcut makes both fire.

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard press.modifiers.isEmpty else { return .ignored }
        if pickerIsOpen { return handlePickerKey(press) }

        switch press.key {
        case .downArrow:  return moveCursor(by: 1)
        case .upArrow:    return moveCursor(by: -1)
        case .rightArrow: return expandOrDescend()
        case .leftArrow:  return collapseOrAscend()
        case .home:       return moveCursor(to: 0)
        case .end:        return moveCursor(to: tree.rows.count - 1)
        case .return, .space:
            guard let row = tree.cursorRow else { return .ignored }
            open(row)
            return .handled
        default:
            return typeToSelect(press.characters)
        }
    }

    /// The open dropdown owns the keyboard - it is a modal choice, not a second list.
    private func handlePickerKey(_ press: KeyPress) -> KeyPress.Result {
        let recent = folders.recent

        switch press.key {
        case .escape:
            pickerIsOpen = false
        case .downArrow:
            pickerCursor = min(recent.count - 1, pickerCursor + 1)
        case .upArrow:
            pickerCursor = max(0, pickerCursor - 1)
        case .return, .space:
            if recent.indices.contains(pickerCursor) { folders.select(recent[pickerCursor]) }
            pickerIsOpen = false
        default:
            return .ignored
        }
        return .handled
    }

    private func moveCursor(by delta: Int) -> KeyPress.Result {
        moveCursor(to: tree.cursor + delta)
    }

    private func moveCursor(to index: Int) -> KeyPress.Result {
        guard !tree.rows.isEmpty else { return .ignored }
        tree.cursor = min(tree.rows.count - 1, max(0, index))
        return .handled
    }

    private func expandOrDescend() -> KeyPress.Result {
        guard let row = tree.cursorRow, row.node.isDirectory else { return .ignored }
        if tree.isExpanded(row.node) {
            return moveCursor(by: 1)
        }
        tree.expand(row.node)
        return .handled
    }

    /// NSOutlineView semantics: collapse if open, otherwise jump to the parent row.
    private func collapseOrAscend() -> KeyPress.Result {
        guard let row = tree.cursorRow else { return .ignored }

        if row.node.isDirectory, tree.isExpanded(row.node) {
            tree.collapse(row.node)
            return .handled
        }

        let parentDepth = row.depth - 1
        guard parentDepth >= 0,
              let parent = tree.rows[..<tree.cursor].lastIndex(where: { $0.depth == parentDepth }) else {
            return .ignored
        }
        return moveCursor(to: parent)
    }

    private func typeToSelect(_ characters: String) -> KeyPress.Result {
        guard let character = characters.first, character.isLetter || character.isNumber else {
            return .ignored
        }

        typeAhead.append(character.lowercased())
        typeAheadReset?.cancel()
        typeAheadReset = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            typeAhead = ""
        }

        let prefix = typeAhead
        // Search forward from the cursor first so repeated prefixes cycle.
        let order = Array(tree.rows.indices.dropFirst(tree.cursor + 1)) + Array(tree.rows.indices.prefix(tree.cursor + 1))
        guard let match = order.first(where: { tree.rows[$0].node.name.lowercased().hasPrefix(prefix) }) else {
            return .handled
        }
        return moveCursor(to: match)
    }
}
