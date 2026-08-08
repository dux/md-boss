import SwiftUI
import AppKit
import Combine

/// The plain-text editor.
///
/// NSTextView rather than SwiftUI's TextEditor, mainly because the smart substitutions
/// have to be off and TextEditor gives no way to say so. Curly quotes appearing inside a
/// fenced code block, or `--` turning into an em dash in YAML front matter, is the bug that
/// makes a markdown editor unusable.
struct MarkdownTextView: NSViewRepresentable {
    let document: MarkdownDocument
    /// Read off the document by the pane rather than here, so a reload reaches this view:
    /// observation is per property, and nothing else in the pane reads it.
    let reloadToken: UUID
    let theme: Theme
    let fontSize: CGFloat
    /// Where the raw pane has been asked to scroll, and the line a note jump landed on.
    /// Both are transient state on the manager, passed in for the same reason as the token.
    var scrollRequest: MdBossManager.ScrollRequest?
    var highlightLine: Int?
    /// Notes on the open document, line -> hover text. Drives the gutter markers and the
    /// tooltip; the pane never reaches the store itself.
    var notes: [Int: String] = [:]
    /// Indent width in spaces, used by Tab and Shift-Tab.
    var indent = 2

    func makeNSView(context: Context) -> NSScrollView {
        // Assembled by hand rather than by NSTextView.scrollableTextView(), because
        // accepting a file drop needs an NSTextView subclass and that factory makes no
        // promise about one. The stack is TextKit 1 explicitly, which is what the app was
        // already running: the ruler and the scroll sync both reach for `layoutManager`,
        // and the first touch of that downgrades a TextKit 2 view anyway.
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        let unbounded = CGFloat.greatestFiniteMagnitude
        let container = NSTextContainer(size: NSSize(width: 0, height: unbounded))
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)

        let textView = EditorTextView(frame: NSRect.zero, textContainer: container)
        textView.minSize = NSSize.zero
        textView.maxSize = NSSize(width: unbounded, height: unbounded)
        textView.autoresizingMask = [.width]

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        // The editor paints its own background rather than letting the SwiftUI one behind it
        // show through. A transparent document view is not opaque, and NSClipView's
        // copy-on-scroll then blits stale pixels for everything it does not consider newly
        // exposed - text slides under a rectangle of leftovers and disappears.
        scrollView.drawsBackground = true

        // Nothing in the chain from the scroll view down holds these, and losing them
        // leaves an editor that is empty rather than one that crashes.
        context.coordinator.retain(storage: storage, layout: layout)
        // Every character change passes through here, which is what notes are shifted on.
        storage.delegate = context.coordinator
        textView.onDropFiles = { [weak textView] urls, index in
            guard let textView else { return false }
            return context.coordinator.insertLinks(to: urls, at: index, in: textView)
        }
        textView.noteTooltip = { [weak coordinator = context.coordinator] charIndex in
            coordinator?.note(at: charIndex)
        }

        textView.delegate = context.coordinator
        textView.allowsUndo = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.textContainerInset = NSSize(width: 24, height: 20)
        textView.drawsBackground = true

        // Every automatic substitution off. This is the whole reason for NSTextView.
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.smartInsertDeleteEnabled = false

        context.coordinator.loadedToken = reloadToken
        context.coordinator.loadedURL = document.url
        context.coordinator.notes = notes
        context.coordinator.load(document.text, into: textView)
        apply(theme: textView, context.coordinator)

        let ruler = LineNumberRuler(scrollView: scrollView, textView: textView, theme: theme, bodyFont: editorFont)
        ruler.noteLines = Set(notes.keys)
        scrollView.hasVerticalRuler = true
        scrollView.verticalRulerView = ruler
        scrollView.rulersVisible = true

        context.coordinator.observeScrolling(of: scrollView, textView: textView)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        context.coordinator.document = document
        context.coordinator.indent = indent
        context.coordinator.notes = notes

        // Only replace the string when the document identity changed or an external reload
        // happened. Assigning it unconditionally would destroy the selection, the undo
        // stack and any in-progress input-method composition on every keystroke.
        if context.coordinator.loadedToken != reloadToken {
            // Same file coming back from disk - keep the reader where they were. A different
            // file opens at the top.
            let sameFile = context.coordinator.loadedURL == document.url
            context.coordinator.loadedToken = reloadToken
            context.coordinator.loadedURL = document.url
            context.coordinator.load(document.text, into: textView, keepingPosition: sameFile)
        }

        // After the swap, so a "open this file at line N" request lands in the new text.
        context.coordinator.applyScrollRequest(scrollRequest, to: textView)
        context.coordinator.applyHighlight(highlightLine, to: textView)

        apply(theme: textView, context.coordinator)

        if let ruler = scrollView.verticalRulerView as? LineNumberRuler {
            ruler.theme = theme
            ruler.bodyFont = editorFont
            ruler.noteLines = Set(notes.keys)
            // Setting `string` in code posts no NSText.didChangeNotification.
            ruler.refresh()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(document: document, indent: indent) }

    private var editorFont: NSFont { .monospacedSystemFont(ofSize: fontSize, weight: .regular) }

    /// Keyed on the whole theme, not on the text color: two palettes can share an ink and
    /// still differ in caret and selection, and comparing one token would leave those stale.
    private func apply(theme textView: NSTextView, _ coordinator: Coordinator) {
        let font = editorFont
        guard textView.font != font || coordinator.appliedTheme != theme else { return }
        coordinator.appliedTheme = theme

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = 1.35

        textView.font = font
        textView.defaultParagraphStyle = paragraph
        textView.backgroundColor = theme.nsColor(.bg)
        // The scroll view owns everything the text does not reach - the overscroll rubber band
        // and the gap under a document shorter than the viewport.
        textView.enclosingScrollView?.backgroundColor = theme.nsColor(.bg)
        textView.textColor = theme.nsColor(.text)
        textView.insertionPointColor = theme.nsColor(.accent)
        textView.selectedTextAttributes = [.backgroundColor: theme.nsColor(.selection)]
        (textView as? EditorTextView)?.highlightFill = theme.nsColor(.selection)
        textView.typingAttributes = [
            .font: font,
            .foregroundColor: theme.nsColor(.text),
            .paragraphStyle: paragraph
        ]
        // Re-apply to text that is already there, not just to what gets typed next.
        let whole = NSRange(location: 0, length: textView.string.utf16.count)
        textView.textStorage?.addAttributes(
            [.font: font, .foregroundColor: theme.nsColor(.text), .paragraphStyle: paragraph],
            range: whole
        )
    }

    // MARK: - Coordinator

    @MainActor
    // NSTextStorageDelegate carries no actor of its own, and the conformance is
    // @preconcurrency for that reason alone: AppKit only ever edits this storage from the
    // main thread, since the text view driving it is on it.
    final class Coordinator: NSObject, NSTextViewDelegate, @preconcurrency NSTextStorageDelegate {
        var document: MarkdownDocument
        var indent: Int
        var loadedToken: UUID?
        /// Which file the text view is currently showing, so a reload of it can be told from
        /// a switch to another one.
        var loadedURL: URL?
        var appliedTheme: Theme?
        /// Line -> hover text, mirrored from the pane so the tooltip can be answered without
        /// reaching into the store on every mouse move.
        var notes: [Int: String] = [:]
        private var appliedScroll: MdBossManager.ScrollRequest?
        /// Set while the whole text is being replaced, so the swap is not mistaken for an
        /// edit that notes should follow.
        private var isSwapping = false

        /// Rebuilt on every edit. Bisected on every scroll frame, which is why it exists.
        private var index = LineIndex("")
        private weak var textView: NSTextView?
        private var syncObserver: AnyCancellable?
        /// Set while following the preview, so our own scroll is not reported straight back.
        private var isFollowing = false

        /// The hand-built TextKit stack, which has no other owner.
        private var storage: NSTextStorage?
        private var layout: NSLayoutManager?

        init(document: MarkdownDocument, indent: Int) {
            self.document = document
            self.indent = indent
        }

        func retain(storage: NSTextStorage, layout: NSLayoutManager) {
            self.storage = storage
            self.layout = layout
        }

        // MARK: Dropped files

        /// A file dragged in from the sidebar or from Finder becomes a link to itself,
        /// relative to the document it landed in.
        ///
        /// `insertText(_:replacementRange:)` is the call Tab already uses: it registers one
        /// undo step, applies the typing attributes rather than inheriting whatever the
        /// preceding character had, and posts didChangeText - so the text reaches
        /// `document.text` through the delegate like any other edit.
        func insertLinks(to urls: [URL], at index: Int, in textView: NSTextView) -> Bool {
            guard !document.isReadOnly else {
                Toast.shared.error("\(document.url.lastPathComponent) is read-only")
                return true
            }

            let directory = document.url.deletingLastPathComponent()
            let snippet = urls
                .map { MarkdownLinks.snippet(for: $0, relativeTo: directory) }
                .joined(separator: "\n")

            let target = NSRange(location: min(index, (textView.string as NSString).length), length: 0)
            guard textView.shouldChangeText(in: target, replacementString: snippet) else { return true }

            textView.window?.makeFirstResponder(textView)
            textView.setSelectedRange(target)
            textView.insertText(snippet, replacementRange: target)
            return true
        }

        func reindex(_ textView: NSTextView) {
            index = LineIndex(textView.string)
        }

        /// Swap the whole text - a different file, or the same one reloaded from disk.
        ///
        /// Assigning `string` posts a selection change synchronously, and at that instant
        /// the line index still describes the file being replaced: the delegate would read
        /// line offsets past the end of the new text and NSString would raise. So the
        /// delegate stays detached until the index and the text agree again.
        func load(_ text: String, into textView: NSTextView, keepingPosition: Bool = false) {
            let restore = keepingPosition ? position(of: textView) : nil

            textView.delegate = nil
            isSwapping = true
            textView.string = text
            isSwapping = false
            textView.delegate = self

            textView.undoManager?.removeAllActions()
            reindex(textView)
            if let restore { apply(restore, to: textView) }
            // A file arriving in the pane is not the reader moving off the line a note just
            // pointed at, so this must not dismiss the landing band.
            reportCursor(textView, navigated: false)
        }

        // MARK: Notes following the text

        /// Notes anchor to a line, so an edit that moves a line start has to take them with
        /// it. The text storage delegate rather than `textDidChange`, because this is the
        /// only hook carrying the edited range - and unlike `shouldChangeTextIn` it sees
        /// programmatic mutations too: the outdent path, undo, a paste.
        func textStorage(
            _ storage: NSTextStorage,
            didProcessEditing mask: NSTextStorageEditActions,
            range: NSRange,
            changeInLength delta: Int
        ) {
            guard mask.contains(.editedCharacters), !isSwapping else { return }
            // Asked first: a document nobody has annotated must not pay for a second index.
            guard AnnotationStore.shared.hasNotes(for: document.url) else { return }

            // `range` is in the new text; the span that was replaced is the same start with
            // the delta undone.
            let edit = NoteShift.Edit(
                range: NSRange(location: range.location, length: range.length - delta),
                length: range.length
            )
            let old = index
            index = LineIndex(storage.string)
            AnnotationStore.shared.shift(document.url, from: old, to: index, after: edit)
        }

        /// The note on the line a character index falls on, for the hover tooltip.
        func note(at charIndex: Int) -> String? {
            guard !notes.isEmpty else { return nil }
            return notes[index.line(at: charIndex)]
        }

        // MARK: Holding position across a reload

        /// Where the reader was, in source lines rather than pixels. The file that came back
        /// from disk is a different length, so a pixel offset would land somewhere unrelated.
        private struct Position {
            let top: Double
            let caretLine: Int
            let caretColumn: Int
        }

        private func position(of textView: NSTextView) -> Position? {
            guard let top = topVisibleLine(textView) else { return nil }

            let caret = min(textView.selectedRange().location, (textView.string as NSString).length)
            let line = index.line(at: caret)
            let column = index.range(ofLine: line).map { caret - $0.location } ?? 0
            return Position(top: top, caretLine: line, caretColumn: column)
        }

        /// Both the caret and the scroll are clamped: the new text may be shorter than the
        /// one we measured against.
        private func apply(_ position: Position, to textView: NSTextView) {
            guard let scrollView = textView.enclosingScrollView,
                  let layoutManager = textView.layoutManager,
                  let container = textView.textContainer else { return }

            // Nothing is laid out yet straight after the string swap, and both the caret rect
            // and the view's own height would be answered from the text that just left.
            layoutManager.ensureLayout(for: container)

            let target = min(position.caretLine, index.count)
            if let line = index.range(ofLine: target) {
                // The range carries the trailing newline, and landing on it would put the
                // caret at the start of the next line. Only the last line has none.
                let content = target < index.count ? line.length - 1 : line.length
                let offset = min(position.caretColumn, max(0, content))
                textView.setSelectedRange(NSRange(location: line.location + offset, length: 0))
            }

            // A programmatic scroll is not the user driving the pane; without this the
            // preview would be dragged along by the restore.
            isFollowing = true
            scroll(textView, in: scrollView, toLine: position.top)
            isFollowing = false
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            document.text = textView.string
            reindex(textView)
            reportCursor(textView)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            reportCursor(textView)
        }

        /// Notes anchor to the caret, so the manager needs to know where it
        /// is and what is on that line.
        private func reportCursor(_ textView: NSTextView, navigated: Bool = true) {
            let text = textView.string as NSString
            let caret = min(textView.selectedRange().location, text.length)
            let line = index.line(at: caret)
            MdBossManager.shared.reportCursor(
                line: line,
                text: self.text(ofLine: line, in: text),
                navigated: navigated
            )
        }

        /// A line's text, clamped to what the view actually holds. An index that has fallen
        /// behind the text may name a range past its end, and NSString raises on that.
        private func text(ofLine line: Int, in text: NSString) -> String {
            let whole = NSRange(location: 0, length: text.length)
            guard let range = index.range(ofLine: line)?.intersection(whole) else { return "" }
            return text.substring(with: range)
        }

        // MARK: Scrolling

        func applyScrollRequest(_ request: MdBossManager.ScrollRequest?, to textView: NSTextView) {
            guard let request, request != appliedScroll else { return }
            appliedScroll = request

            guard let range = index.range(ofLine: request.line) else { return }
            textView.setSelectedRange(NSRange(location: range.location, length: 0))
            textView.scrollRangeToVisible(range)
            textView.window?.makeFirstResponder(textView)
        }

        /// The band on the line a note jump landed on.
        func applyHighlight(_ line: Int?, to textView: NSTextView) {
            guard let view = textView as? EditorTextView else { return }
            view.highlightedRange = line.flatMap { index.range(ofLine: $0) }
        }

        // MARK: Scroll sync

        func observeScrolling(of scrollView: NSScrollView, textView: NSTextView) {
            self.textView = textView

            scrollView.contentView.postsBoundsChangedNotifications = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(scrolled),
                name: NSView.boundsDidChangeNotification,
                object: scrollView.contentView
            )

            syncObserver = ScrollSync.shared.moves
                .filter { $0.source != .raw }
                .sink { [weak self] move in self?.follow(move.line) }
        }

        @objc private func scrolled() {
            guard !isFollowing, let textView, let line = topVisibleLine(textView) else { return }
            ScrollSync.shared.report(line: line, from: .raw)
        }

        private func follow(_ line: Double) {
            guard let textView, let scrollView = textView.enclosingScrollView else { return }
            isFollowing = true
            scroll(textView, in: scrollView, toLine: line)
            isFollowing = false
            ScrollSync.shared.applied()
        }

        /// The source line at the top of the viewport, fractional within that line.
        private func topVisibleLine(_ textView: NSTextView) -> Double? {
            guard let layoutManager = textView.layoutManager,
                  let container = textView.textContainer,
                  !textView.string.isEmpty else { return nil }

            let visible = textView.visibleRect
            guard visible.height > 0 else { return nil }

            // At the end of the file, report past the last line. The preview's tall bottom
            // padding means its last block sits well above its own end, and both panes
            // being at the bottom together is what reads as correct.
            if visible.maxY >= textView.bounds.maxY - 1 { return Double(index.count) + 1 }

            let inset = textView.textContainerInset
            // Container coordinates, which is what the layout manager answers in.
            let bounding = visible.offsetBy(dx: -inset.width, dy: -inset.height)
            let glyphRange = layoutManager.glyphRange(forBoundingRect: bounding, in: container)
            guard glyphRange.location < layoutManager.numberOfGlyphs else { return nil }

            let charIndex = layoutManager.characterIndexForGlyph(at: glyphRange.location)
            let line = index.line(at: charIndex)

            var effective = NSRange()
            let fragment = layoutManager.lineFragmentRect(
                forGlyphAt: glyphRange.location,
                effectiveRange: &effective,
                withoutAdditionalLayout: true
            )
            guard fragment.height > 0 else { return Double(line) }

            let progress = (bounding.minY - fragment.minY) / fragment.height
            return Double(line) + min(1, max(0, progress))
        }

        /// Where to park the clip view to put document `y` at the top of the viewport.
        ///
        /// The horizontal origin is carried over rather than zeroed: a visible vertical ruler
        /// parks the clip view's bounds origin at `-ruleThickness`, so scrolling to x = 0 drags
        /// the text sideways by the width of the gutter. Only the follow path ever set the
        /// origin by hand, which is why the shift showed up when the preview drove and never
        /// when the raw pane was scrolled directly.
        static func origin(for y: CGFloat, in clip: NSClipView, maxY: CGFloat) -> NSPoint {
            NSPoint(x: clip.bounds.origin.x, y: min(max(0, y), maxY))
        }

        private func scroll(_ textView: NSTextView, in scrollView: NSScrollView, toLine line: Double) {
            let clip = scrollView.contentView
            let maxY = max(0, textView.bounds.height - clip.bounds.height)

            let whole = Int(line.rounded(.down))
            guard let range = index.range(ofLine: whole),
                  let layoutManager = textView.layoutManager,
                  let container = textView.textContainer else {
                // Past the last line: the preview is at its end, so go to ours.
                clip.scroll(to: Self.origin(for: maxY, in: clip, maxY: maxY))
                scrollView.reflectScrolledClipView(clip)
                return
            }

            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
            let progress = min(1, max(0, line - Double(whole)))
            let y = rect.minY + textView.textContainerInset.height + rect.height * progress

            clip.scroll(to: Self.origin(for: y, in: clip, maxY: maxY))
            scrollView.reflectScrolledClipView(clip)
        }

        // MARK: Context menu

        func textView(_ view: NSTextView, menu: NSMenu, for event: NSEvent, at charIndex: Int) -> NSMenu? {
            let manager = MdBossManager.shared
            guard let url = manager.selectedFile else { return menu }

            // Right-clicking somewhere other than the caret should act on where you clicked.
            let text = view.string as NSString
            let line = index.line(at: min(charIndex, text.length))
            manager.reportCursor(line: line, text: self.text(ofLine: line, in: text))

            let hasNote = manager.hasNoteAtCursor
            let items: [NSMenuItem] = [
                BlockMenuItem(hasNote ? "Edit Note…" : "Add Note…") { manager.addNoteAtCursor() },
                NSMenuItem.separator(),
                BlockMenuItem("Copy Path") { manager.copyPath(url) },
                BlockMenuItem("Copy Path with Line") {
                    manager.copyText("\(AnnotationPath.store(url)):\(line)", label: "Path copied")
                },
                NSMenuItem.separator()
            ]

            for (offset, item) in items.enumerated() {
                menu.insertItem(item, at: offset)
            }
            return menu
        }

        /// Tab must indent, not move focus - nested lists and fenced code depend on it.
        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertTab(_:)):
                textView.insertText(String(repeating: " ", count: indent), replacementRange: textView.selectedRange())
                return true
            case #selector(NSResponder.insertBacktab(_:)):
                return outdent(textView)
            default:
                return false
            }
        }

        private func outdent(_ textView: NSTextView) -> Bool {
            let text = textView.string as NSString
            let lineRange = text.lineRange(for: NSRange(location: textView.selectedRange().location, length: 0))
            let line = text.substring(with: lineRange)

            let removable = line.prefix(indent).prefix { $0 == " " }.count
            guard removable > 0 else { return true }

            let target = NSRange(location: lineRange.location, length: removable)
            guard textView.shouldChangeText(in: target, replacementString: "") else { return true }
            textView.textStorage?.replaceCharacters(in: target, with: "")
            textView.didChangeText()
            return true
        }
    }
}
