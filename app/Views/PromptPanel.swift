import AppKit

/// A one-field modal prompt. Used for a note's body and for renaming one.
///
/// An NSAlert rather than a SwiftUI sheet because these are invoked from context menus and
/// menu commands, which have no view to present from.
enum PromptPanel {
    @MainActor
    static func text(
        title: String,
        message: String,
        value: String,
        placeholder: String = "",
        multiline: Bool = false,
        confirm: String = "Save"
    ) -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: confirm)
        alert.addButton(withTitle: "Cancel")

        let field: NSTextField
        if multiline {
            let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 380, height: 100))
            textView.string = value
            textView.font = .systemFont(ofSize: NSFont.systemFontSize)
            textView.isRichText = false
            // Same reasoning as the editor: nothing here should turn quotes curly.
            textView.isAutomaticQuoteSubstitutionEnabled = false
            textView.isAutomaticDashSubstitutionEnabled = false
            textView.isAutomaticTextReplacementEnabled = false

            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 380, height: 100))
            scroll.documentView = textView
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            alert.accessoryView = scroll
            alert.window.initialFirstResponder = textView

            guard alert.runModal() == .alertFirstButtonReturn else { return nil }
            return textView.string
        }

        field = NSTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 24))
        field.stringValue = value
        field.placeholderString = placeholder
        alert.accessoryView = field
        alert.window.initialFirstResponder = field

        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let trimmed = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// NSMenuItem carrying its own action, so context menus can be assembled inline instead of
/// routing every item through a selector on some controller.
final class BlockMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("BlockMenuItem is created in code only")
    }

    @objc private func fire() {
        handler()
    }
}
