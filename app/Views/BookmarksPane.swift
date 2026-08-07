import SwiftUI

/// Every bookmark across every root folder, grouped by file.
/// Bookmarks are navigation, so they are not scoped to the open document.
struct BookmarksPane: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var store = AnnotationStore.shared
    @ObservedObject private var manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    private var grouped: [(path: String, items: [Bookmark])] {
        Dictionary(grouping: store.bookmarks, by: \.path)
            .map { (path: $0.key, items: $0.value.sorted { $0.line < $1.line }) }
            .sorted { $0.path < $1.path }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Bookmarks", theme: theme, count: store.bookmarks.count)

            if store.bookmarks.isEmpty {
                EmptyPane(theme: theme, message: "No bookmarks yet.\nRight-click in the raw pane to add one.")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(grouped, id: \.path) { group in
                            Text((group.path as NSString).lastPathComponent)
                                .textStyle(.title)
                                .padding(.horizontal, 12)
                                .padding(.top, 10)
                                .padding(.bottom, 2)
                                .help(group.path)

                            ForEach(group.items) { bookmark in
                                row(bookmark)
                            }
                        }
                    }
                    .padding(.bottom, 10)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme[.sidebarBg])
    }

    private func row(_ bookmark: Bookmark) -> some View {
        let isCurrent = manager.selectedFile.map(AnnotationPath.store) == bookmark.path

        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("\(bookmark.line)")
                .textStyle(.small, mono: true)
                .foregroundColor(theme[.muted])
                .frame(minWidth: 26, alignment: .trailing)

            Text(bookmark.title)
                .textStyle(.default)
                .foregroundColor(theme[.text])
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .rowHighlight(theme: theme, isSelected: isCurrent && manager.currentLine == bookmark.line)
        .onTapGesture { manager.go(to: bookmark) }
        .contextMenu {
            Button("Copy Path") { manager.copyText("\(bookmark.path):\(bookmark.line)", label: "Path copied") }
            Button("Rename…") { manager.renameBookmark(bookmark) }
            Divider()
            Button("Delete") { store.removeBookmark(bookmark) }
        }
    }
}

/// Shared header for the two list panes.
struct PaneHeader: View {
    let title: String
    let theme: Theme
    var count: Int?

    var body: some View {
        HStack {
            Text(title).textStyle(.title)
            if let count, count > 0 {
                Text("\(count)")
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }
}
