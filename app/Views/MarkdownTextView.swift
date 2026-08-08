import SwiftUI
import AppKit

/// The plain-text editor.
///
/// NSTextView rather than SwiftUI's TextEditor, mainly because the smart substitutions
/// have to be off and TextEditor gives no way to say so. Curly quotes appearing inside a
/// fenced code block, or `--` turning into an em dash in YAML front matter, is the bug that
/// makes a markdown editor unusable.
struct MarkdownTextView: NSViewRepresentable {
    @ObservedObject var document: MarkdownDocument
    let theme: Theme
    let fontSize: CGFloat
    /// Indent width in spaces, used by Tab and Shift-Tab.
    var indent = 2

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        guard let textView = scrollView.documentView as? NSTextView else { return scrollView }

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
        textView.drawsBackground = false

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

        textView.string = document.text
        context.coordinator.loadedToken = document.reloadToken
        apply(theme: textView)

        let ruler = LineNumberRuler(scrollView: scrollView, textView: textView, theme: theme, bodyFont: editorFont)
        scrollView.hasVerticalRuler = true
        scrollView.verticalRulerView = ruler
        scrollView.rulersVisible = true

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        context.coordinator.document = document
        context.coordinator.indent = indent
        context.coordinator.applyScrollRequest(to: textView)

        // Only replace the string when the document identity changed or an external reload
        // happened. Assigning it unconditionally would destroy the selection, the undo
        // stack and any in-progress input-method composition on every keystroke.
        if context.coordinator.loadedToken != document.reloadToken {
            context.coordinator.loadedToken = document.reloadToken
            textView.string = document.text
            textView.undoManager?.removeAllActions()
        }

        apply(theme: textView)

        if let ruler = scrollView.verticalRulerView as? LineNumberRuler {
            ruler.theme = theme
            ruler.bodyFont = editorFont
            // Setting `string` in code posts no NSText.didChangeNotification.
            ruler.refresh()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(document: document, indent: indent) }

    private var editorFont: NSFont { .monospacedSystemFont(ofSize: fontSize, weight: .regular) }

    private func apply(theme textView: NSTextView) {
        let font = editorFont
        guard textView.font != font || textView.textColor != theme.nsColor(.text) else { return }

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = 1.35

        textView.font = font
        textView.defaultParagraphStyle = paragraph
        textView.textColor = theme.nsColor(.text)
        textView.insertionPointColor = theme.nsColor(.accent)
        textView.selectedTextAttributes = [.backgroundColor: theme.nsColor(.selection)]
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
    final class Coordinator: NSObject, NSTextViewDelegate {
        var document: MarkdownDocument
        var indent: Int
        var loadedToken: UUID?
        private var appliedScroll: MdBossManager.ScrollRequest?

        init(document: MarkdownDocument, indent: Int) {
            self.document = document
            self.indent = indent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            document.text = textView.string
            reportCursor(textView)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            reportCursor(textView)
        }

        /// Notes anchor to the caret, so the manager needs to know where it
        /// is and what is on that line.
        private func reportCursor(_ textView: NSTextView) {
            let text = textView.string as NSString
            let caret = min(textView.selectedRange().location, text.length)
            let line = text.substring(to: caret).components(separatedBy: "\n").count
            let lineText = text.substring(with: text.lineRange(for: NSRange(location: caret, length: 0)))
            MdBossManager.shared.reportCursor(line: line, text: lineText)
        }

        // MARK: Scrolling

        func applyScrollRequest(to textView: NSTextView) {
            guard let request = MdBossManager.shared.scrollRequest, request != appliedScroll else { return }
            appliedScroll = request

            guard let range = Self.range(ofLine: request.line, in: textView.string) else { return }
            textView.setSelectedRange(NSRange(location: range.location, length: 0))
            textView.scrollRangeToVisible(range)
            textView.window?.makeFirstResponder(textView)
        }

        /// 1-based line number to its character range.
        static func range(ofLine line: Int, in string: String) -> NSRange? {
            let text = string as NSString
            var current = 1
            var location = 0

            while location <= text.length {
                let lineRange = text.lineRange(for: NSRange(location: location, length: 0))
                if current == line { return lineRange }
                guard lineRange.length > 0 else { return nil }
                location = lineRange.location + lineRange.length
                current += 1
            }
            return nil
        }

        // MARK: Context menu

        func textView(_ view: NSTextView, menu: NSMenu, for event: NSEvent, at charIndex: Int) -> NSMenu? {
            let manager = MdBossManager.shared
            guard let url = manager.selectedFile else { return menu }

            // Right-clicking somewhere other than the caret should act on where you clicked.
            let text = view.string as NSString
            let clamped = min(charIndex, text.length)
            let line = text.substring(to: clamped).components(separatedBy: "\n").count
            let lineText = text.substring(with: text.lineRange(for: NSRange(location: clamped, length: 0)))
            manager.reportCursor(line: line, text: lineText)

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
