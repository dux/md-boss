import SwiftUI

/// Inline comments in three reaches: the open document, the rest of the active folder, and
/// every other recent folder.
///
/// All three titles are always shown, so an empty scope reads as "nothing here" rather than
/// leaving you wondering whether the pane is broken. The two wider ones fold, and start
/// folded, so the comments on what you are actually reading stay at the top of the column.
struct CommentsPane: View {
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var store = AnnotationStore.shared
    @ObservedObject private var manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    private var sections: [CommentScope: [Comment]] {
        CommentSections.partition(
            all: store.allComments,
            file: manager.selectedFile,
            activeRoot: RootFoldersManager.shared.active,
            recentRoots: RootFoldersManager.shared.recent
        )
    }

    var body: some View {
        let sections = sections

        return VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Comments", theme: theme)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(CommentScope.allCases.enumerated()), id: \.element) { index, scope in
                        if index > 0 {
                            Rectangle()
                                .fill(theme[.border])
                                .frame(height: 1)
                                .padding(.top, 10)
                        }
                        section(scope, comments: sections[scope] ?? [])
                    }
                }
                .padding(.bottom, 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme[.sidebarBg])
    }

    // MARK: Sections

    @ViewBuilder
    private func section(_ scope: CommentScope, comments: [Comment]) -> some View {
        let isOpen = isExpanded(scope)

        header(scope, count: comments.count, isOpen: isOpen)

        if isOpen {
            if comments.isEmpty {
                Text(emptyMessage(for: scope))
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            } else if scope == .thisFile {
                rows(comments)
            } else {
                grouped(comments, showingProject: scope == .allProjects)
            }
        }
    }

    private func header(_ scope: CommentScope, count: Int, isOpen: Bool) -> some View {
        HStack(spacing: 4) {
            if scope.isCollapsible {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                    .iconStyle(.title, scale: 0.8, weight: .semibold)
                    .foregroundColor(theme[.muted])
            }

            Text(scope.title).textStyle(.title)

            if count > 0 {
                Text("\(count)")
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .contentShape(Rectangle())
        .onTapGesture { toggle(scope) }
    }

    private func rows(_ comments: [Comment]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(comments) { comment in
                row(comment)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
    }

    /// A bare basename from another folder is ambiguous, so the project name rides along
    /// in the wider scope.
    private func grouped(_ comments: [Comment], showingProject: Bool) -> some View {
        let groups = Dictionary(grouping: comments, by: \.path)
            .map { (path: $0.key, items: $0.value.sorted { $0.line < $1.line }) }
            .sorted { $0.path < $1.path }

        return VStack(alignment: .leading, spacing: 6) {
            ForEach(groups, id: \.path) { group in
                HStack(spacing: 4) {
                    if showingProject, let project = projectName(for: group.path) {
                        Text(project)
                            .textStyle(.small)
                            .foregroundColor(theme[.muted])
                        Text("/")
                            .textStyle(.small)
                            .foregroundColor(theme[.muted])
                    }
                    Text((group.path as NSString).lastPathComponent)
                        .textStyle(.small, weight: .medium)
                        .foregroundColor(theme[.text])
                    Spacer(minLength: 0)
                }
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 4)
                .padding(.top, 4)
                .help(group.path)

                ForEach(group.items) { comment in
                    row(comment)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
    }

    private func row(_ comment: Comment) -> some View {
        let isCurrent = manager.selectedFile.map(AnnotationPath.store) == comment.path

        return VStack(alignment: .leading, spacing: 3) {
            Text("line \(comment.line)")
                .textStyle(.small, mono: true)
                .foregroundColor(theme[.muted])

            Text(comment.body)
                .textStyle(.default)
                .foregroundColor(theme[.text])
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6).fill(theme[.surface])
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(isCurrent && manager.currentLine == comment.line ? theme[.accent] : theme[.quoteBar])
                .frame(width: 3)
                .padding(.vertical, 6)
        }
        .contentShape(Rectangle())
        .onTapGesture { manager.go(to: comment) }
        .contextMenu {
            Button("Edit…") { manager.editComment(comment) }
            Button("Copy Text") { manager.copyText(comment.body) }
            Button("Copy Path") { manager.copyText("\(comment.path):\(comment.line)", label: "Path copied") }
            Divider()
            Button("Delete") { store.removeComment(comment) }
        }
    }

    // MARK: Details

    private func emptyMessage(for scope: CommentScope) -> String {
        guard scope == .thisFile else { return "no comments" }
        if manager.selectedFile == nil { return "no file open" }
        // With nothing anywhere, this is the only line that can say how to make one.
        if store.allComments.isEmpty { return "no comments - right-click in the raw pane to add one" }
        return "no comments"
    }

    private func projectName(for path: String) -> String? {
        RootFoldersManager.shared
            .root(containing: AnnotationPath.expand(path))?
            .lastPathComponent
    }

    // MARK: Folding

    private func isExpanded(_ scope: CommentScope) -> Bool {
        !scope.isCollapsible || settings.expandedCommentScopes.contains(scope.rawValue)
    }

    private func toggle(_ scope: CommentScope) {
        guard scope.isCollapsible else { return }
        var open = Set(settings.expandedCommentScopes)
        if open.remove(scope.rawValue) == nil { open.insert(scope.rawValue) }
        settings.expandedCommentScopes = CommentScope.allCases
            .map(\.rawValue)
            .filter { open.contains($0) }
    }
}
