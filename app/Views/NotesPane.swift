import SwiftUI

/// Notes in three reaches: the open document, the rest of the active folder, and every other
/// recent folder.
///
/// All three titles are always shown, so an empty scope reads as "nothing here" rather than
/// leaving you wondering whether the pane is broken. The two wider ones fold, and start
/// folded, so the notes on what you are actually reading stay at the top of the column.
struct NotesPane: View {
    private let settings = AppSettings.shared
    private let store = AnnotationStore.shared
    private let manager = MdBossManager.shared

    private var theme: Theme { settings.theme }

    private var sections: [NoteScope: [Note]] {
        NoteSections.partition(
            all: store.notes,
            file: manager.selectedFile,
            activeRoot: RootFoldersManager.shared.active,
            recentRoots: RootFoldersManager.shared.recent
        )
    }

    var body: some View {
        let sections = sections

        return VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Notes", theme: theme)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(NoteScope.allCases.enumerated()), id: \.element) { index, scope in
                        if index > 0 {
                            Rectangle()
                                .fill(theme[.border])
                                .frame(height: 1)
                                .padding(.top, 10)
                        }
                        section(scope, notes: sections[scope] ?? [])
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
    private func section(_ scope: NoteScope, notes: [Note]) -> some View {
        let isOpen = isExpanded(scope)

        header(scope, count: notes.count, isOpen: isOpen)

        if isOpen {
            if notes.isEmpty {
                Text(emptyMessage(for: scope))
                    .textStyle(.small)
                    .foregroundColor(theme[.muted])
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            } else if scope == .thisFile {
                rows(notes)
            } else {
                grouped(notes, showingProject: scope == .allProjects)
            }
        }
    }

    private func header(_ scope: NoteScope, count: Int, isOpen: Bool) -> some View {
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

    private func rows(_ notes: [Note]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(notes) { note in
                row(note)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
    }

    /// A bare basename from another folder is ambiguous, so the project name rides along
    /// in the wider scope.
    private func grouped(_ notes: [Note], showingProject: Bool) -> some View {
        let groups = Dictionary(grouping: notes, by: \.path)
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

                ForEach(group.items) { note in
                    row(note)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
    }

    /// The line number leads, then the title - or the body, when there is no title to lead
    /// with. A note carrying both shows the body underneath.
    private func row(_ note: Note) -> some View {
        let isCurrent = manager.selectedFile.map(AnnotationPath.store) == note.path
        let hasBoth = !note.title.isEmpty && !note.body.isEmpty

        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(note.line)")
                    .textStyle(.small, mono: true)
                    .foregroundColor(theme[.muted])
                    .frame(minWidth: 26, alignment: .trailing)

                Text(note.label)
                    .textStyle(.default)
                    .foregroundColor(theme[.text])
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)
            }

            if hasBoth {
                // Same size as the title above it - a note's body is its content, not a
                // caption on it. Only the colour steps back.
                Text(note.body)
                    .textStyle(.default)
                    .foregroundColor(theme[.muted])
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 32)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6).fill(theme[.surface])
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(isCurrent && manager.currentLine == note.line ? theme[.accent] : theme[.quoteBar])
                .frame(width: 3)
                .padding(.vertical, 6)
        }
        .contentShape(Rectangle())
        .onTapGesture { manager.go(to: note) }
        .contextMenu {
            Button("Edit…") { manager.editNote(note) }
            Button("Rename…") { manager.renameNote(note) }
            if !note.body.isEmpty {
                Button("Copy Text") { manager.copyText(note.body) }
            }
            Button("Copy Path") { manager.copyText("\(note.path):\(note.line)", label: "Path copied") }
            Divider()
            Button("Delete") { store.remove(note) }
        }
    }

    // MARK: Details

    private func emptyMessage(for scope: NoteScope) -> String {
        guard scope == .thisFile else { return "no notes" }
        if manager.selectedFile == nil { return "no file open" }
        // With nothing anywhere, this is the only line that can say how to make one.
        if store.notes.isEmpty { return "no notes - right-click in the raw pane to add one" }
        return "no notes"
    }

    private func projectName(for path: String) -> String? {
        RootFoldersManager.shared
            .root(containing: AnnotationPath.expand(path))?
            .lastPathComponent
    }

    // MARK: Folding

    private func isExpanded(_ scope: NoteScope) -> Bool {
        !scope.isCollapsible || settings.expandedNoteScopes.contains(scope.rawValue)
    }

    private func toggle(_ scope: NoteScope) {
        guard scope.isCollapsible else { return }
        var open = Set(settings.expandedNoteScopes)
        if open.remove(scope.rawValue) == nil { open.insert(scope.rawValue) }
        settings.expandedNoteScopes = NoteScope.allCases
            .map(\.rawValue)
            .filter { open.contains($0) }
    }
}

/// Shared header for the list panes.
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
