import SwiftUI

/// The search field, which sits above the folder box and is always on screen. What is typed
/// into it is what decides whether the sidebar shows the tree or a result list.
struct SearchField: View {
    @FocusState.Binding var isFocused: Bool
    /// Clearing the query and moving the keyboard back to the tree is the sidebar's to do -
    /// it owns both focus states, and the field only owns one of them.
    let onEscape: () -> Void

    private let search = SidebarSearch.shared
    private let settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        @Bindable var search = search

        return HStack(spacing: 6) {
            Image(systemName: search.mode == .files ? "doc.text.magnifyingglass" : "magnifyingglass")
                .iconStyle(.buttons, scale: 0.9)
                .foregroundColor(theme[.muted])

            TextField(search.mode.placeholder, text: $search.query)
                .textFieldStyle(.plain)
                .textStyle(.buttons)
                .foregroundColor(theme[.text])
                .focused($isFocused)
                // Bare keys drive the list below; everything else belongs to the field.
                .onKeyPress(.upArrow) { search.moveCursor(by: -1); return .handled }
                .onKeyPress(.downArrow) { search.moveCursor(by: 1); return .handled }
                .onKeyPress(.return) { open(); return .handled }
                .onKeyPress(.escape) { onEscape(); return .handled }

            if search.isRunning {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.6)
                    .frame(width: 12, height: 12)
            } else if !search.query.isEmpty {
                Text("\(search.rowCount)\(search.truncated ? "+" : "")")
                    .textStyle(.small, mono: true)
                    .foregroundColor(theme[.muted])
            }
        }
        .padding(.horizontal, 7)
        .frame(height: RootPickerBox.height)
        .background(theme[.bg])
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6).stroke(theme[.borderStrong], lineWidth: 1)
        )
    }

    private func open() {
        MdBossManager.shared.openSearchCursor()
    }
}

/// Text hits, grouped by file the way the notes pane groups its own rows.
struct SearchResultsList: View {
    private let search = SidebarSearch.shared
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    /// An empty query shows the tree, not this - so there is no "type to search" state left
    /// to draw.
    var body: some View {
        if search.hits.isEmpty && !search.isRunning {
            EmptyPane(theme: theme, message: "Nothing found.")
        } else {
            list
        }
    }

    private var list: some View {
        let groups = Dictionary(grouping: Array(search.hits.enumerated()), by: { $0.element.url.path })
            .map { (path: $0.key, items: $0.value) }
            .sorted { $0.path < $1.path }

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(groups, id: \.path) { group in
                        header(group.path, count: group.items.count)
                        ForEach(group.items, id: \.offset) { entry in
                            row(entry.element, index: entry.offset)
                                .id(entry.offset)
                        }
                    }

                    if search.truncated {
                        Text("More matches than shown.")
                            .textStyle(.small)
                            .foregroundColor(theme[.muted])
                            .padding(.horizontal, 8)
                            .padding(.top, 6)
                    }
                }
                .padding(.vertical, 6)
            }
            .onChange(of: search.cursor) { _, cursor in
                withAnimation(.none) { proxy.scrollTo(cursor, anchor: .center) }
            }
        }
    }

    private func header(_ path: String, count: Int) -> some View {
        HStack(spacing: 4) {
            Text((path as NSString).lastPathComponent)
                .textStyle(.small, weight: .medium)
                .foregroundColor(theme[.text])
            Text("\(count)")
                .textStyle(.small, mono: true)
                .foregroundColor(theme[.muted])
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .help(path)
    }

    private func row(_ hit: DocumentSearch.Hit, index: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("\(hit.line)")
                .textStyle(.small, mono: true)
                .foregroundColor(theme[.muted])
                .frame(minWidth: 26, alignment: .trailing)

            marked(hit)
                .textStyle(.small)
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .rowHighlight(theme: theme, isSelected: index == search.cursor)
        .onTapGesture { manager.go(to: hit) }
    }

    /// The match itself in the accent, the rest of the line in body ink - the row has to say
    /// *why* it is here, and a bare line does not.
    private func marked(_ hit: DocumentSearch.Hit) -> Text {
        let line = hit.text as NSString
        let start = max(0, min(hit.column, line.length))
        let end = max(start, min(start + hit.length, line.length))

        // Long lines are clipped from the left, so a match late in one is still visible.
        let leadingRoom = 24
        let cut = start > leadingRoom ? start - leadingRoom : 0
        let ellipsis = cut > 0 ? "…" : ""

        let before = line.substring(with: NSRange(location: cut, length: start - cut))
        let hitText = line.substring(with: NSRange(location: start, length: end - start))
        let after = line.substring(from: end)

        return Text(ellipsis + before).foregroundColor(theme[.muted])
            + Text(hitText).foregroundColor(theme[.accent]).fontWeight(.semibold)
            + Text(after).foregroundColor(theme[.text])
    }
}

/// Go to File: names, ranked loosely, on the same surface.
struct FileResultsList: View {
    private let search = SidebarSearch.shared
    private let settings = AppSettings.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        if search.files.isEmpty {
            EmptyPane(theme: theme, message: "No file matches.")
        } else {
            list
        }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(search.files.enumerated()), id: \.element.id) { index, ranked in
                        row(ranked, index: index).id(index)
                    }
                }
                .padding(.vertical, 6)
            }
            .onChange(of: search.cursor) { _, cursor in
                withAnimation(.none) { proxy.scrollTo(cursor, anchor: .center) }
            }
        }
    }

    private func row(_ ranked: FuzzyMatch.Ranked, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(ranked.url.lastPathComponent)
                .textStyle(.default)
                .foregroundColor(theme[.text])

            if ranked.display != ranked.url.lastPathComponent {
                Text((ranked.display as NSString).deletingLastPathComponent)
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
            }
        }
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        .rowHighlight(theme: theme, isSelected: index == search.cursor)
        .onTapGesture { manager.go(toFile: ranked.url) }
    }
}
