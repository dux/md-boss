import AppKit

/// The raw pane's text view.
///
/// A subclass for one reason: `NSTextViewDelegate` has no drag-*destination* hooks, only
/// the outbound `writablePasteboardTypesFor` family. A file dragged out of the sidebar is
/// therefore invisible from the coordinator, and the only place to see it is here.
///
/// It knows nothing about documents or markdown - `onDropFiles` is set by
/// `MarkdownTextView.makeNSView` and everything that decides what to insert lives there.
final class EditorTextView: NSTextView {
    /// Answers true when the drop was handled, so an unhandled one can still fall through
    /// to NSTextView's own text drag-and-drop.
    var onDropFiles: (([URL], Int) -> Bool)?

    /// Note text for a character index. The view holds no line index of its own, so the
    /// answer comes from the coordinator that does.
    var noteTooltip: ((Int) -> String?)?

    /// The line a note jump landed on. A note marks a whole line, so the band is drawn full
    /// width, and a soft-wrapped line gets all of its fragments.
    var highlightedRange: NSRange? {
        didSet {
            guard highlightedRange != oldValue else { return }
            needsDisplay = true
        }
    }

    /// Set from the theme by MarkdownTextView, alongside the caret and selection colours.
    var highlightFill: NSColor = .clear {
        didSet {
            guard highlightFill != oldValue, highlightedRange != nil else { return }
            needsDisplay = true
        }
    }

    /// Restored if the drag leaves again - the caret tracks the drop point while a file is
    /// over the view, and a drag that ends elsewhere should not have moved it.
    private var selectionBeforeDrag: NSRange?

    private var hoverTracking: NSTrackingArea?

    override init(frame: NSRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        registerForDraggedTypes([.fileURL])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("EditorTextView is created in code only")
    }

    override var acceptableDragTypes: [NSPasteboard.PasteboardType] {
        super.acceptableDragTypes + [.fileURL]
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !fileURLs(on: sender).isEmpty else { return super.draggingEntered(sender) }
        selectionBeforeDrag = selectedRange()
        return trackCaret(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !fileURLs(on: sender).isEmpty else { return super.draggingUpdated(sender) }
        return trackCaret(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        if let selection = selectionBeforeDrag {
            setSelectedRange(selection)
            selectionBeforeDrag = nil
        }
        super.draggingExited(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = fileURLs(on: sender)
        selectionBeforeDrag = nil
        guard !urls.isEmpty, let onDropFiles else { return super.performDragOperation(sender) }
        return onDropFiles(urls, insertionIndex(sender))
    }

    // MARK: The landing band

    /// On top of the view's own background fill and under the text, which is what
    /// `drawBackground(in:)` is for. Overriding `draw(_:)` instead would put the band
    /// underneath the background colour, where nothing would ever see it.
    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)

        guard let range = highlightedRange,
              let layoutManager,
              let container = textContainer else { return }

        let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        let span = layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
        // Full width: a note marks the line, not the characters that happen to be on it.
        let band = NSRect(
            x: 0,
            y: span.minY + textContainerInset.height,
            width: bounds.width,
            height: span.height
        )
        guard band.intersects(rect) else { return }

        highlightFill.setFill()
        band.fill()
    }

    // MARK: Hover

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTracking { removeTrackingArea(hoverTracking) }

        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self
        )
        addTrackingArea(area)
        hoverTracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        guard let noteTooltip else { return }
        toolTip = hoveredCharacter(at: convert(event.locationInWindow, from: nil)).flatMap(noteTooltip)
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        toolTip = nil
    }

    /// Nil past the end of the laid-out text, so the empty space under a short file does not
    /// answer with the last line's note. Only the vertical band is checked - hovering to the
    /// right of a short line is still that line.
    private func hoveredCharacter(at point: NSPoint) -> Int? {
        guard let layoutManager, let container = textContainer else { return nil }

        let used = layoutManager.usedRect(for: container)
            .offsetBy(dx: textContainerInset.width, dy: textContainerInset.height)
        guard point.y >= used.minY, point.y <= used.maxY else { return nil }

        return characterIndexForInsertion(at: point)
    }

    // MARK: Internals

    /// `.copy` and not `.move`: what lands in the buffer is a link, and the file itself
    /// stays exactly where it was.
    private func trackCaret(_ sender: NSDraggingInfo) -> NSDragOperation {
        setSelectedRange(NSRange(location: insertionIndex(sender), length: 0))
        return .copy
    }

    private func insertionIndex(_ sender: NSDraggingInfo) -> Int {
        characterIndexForInsertion(at: convert(sender.draggingLocation, from: nil))
    }

    private func fileURLs(on sender: NSDraggingInfo) -> [URL] {
        let objects = sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        )
        return objects as? [URL] ?? []
    }
}
