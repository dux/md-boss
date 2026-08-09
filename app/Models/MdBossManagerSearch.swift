import SwiftUI

// Opening what a search found. Kept in an extension for the same reason the menu commands
// are - MdBossManager.swift stays about state.
extension MdBossManager {
    // MARK: Opening the panel

    func findInProject() {
        AppSettings.shared.showSidebar = true
        SidebarSearch.shared.open(.text)
    }

    func goToFile() {
        AppSettings.shared.showSidebar = true
        SidebarSearch.shared.open(.files)
    }

    var canSearch: Bool { RootFoldersManager.shared.active != nil }

    // MARK: Opening a result

    /// The whole jump. `go(toLine:)` already forces the raw pane open when neither document
    /// pane is up and drives the landing band, so a search hit and a note land the same way.
    func go(to hit: DocumentSearch.Hit) {
        open(hit.url, reveal: true)
        go(toLine: hit.line)
    }

    func go(toFile url: URL) {
        open(url, reveal: true)
        // The panel has done its job; leaving it up would hide the tree behind a stale query.
        SidebarSearch.shared.close()
    }

    /// Return in the search field: open whatever the cursor is on.
    func openSearchCursor() {
        let search = SidebarSearch.shared
        switch search.mode {
        case .tree:
            return
        case .files:
            guard search.files.indices.contains(search.cursor) else { return }
            go(toFile: search.files[search.cursor].url)
        case .text:
            guard search.hits.indices.contains(search.cursor) else { return }
            go(to: search.hits[search.cursor])
        }
    }
}
