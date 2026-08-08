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

    /// Restored if the drag leaves again - the caret tracks the drop point while a file is
    /// over the view, and a drag that ends elsewhere should not have moved it.
    private var selectionBeforeDrag: NSRange?

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
