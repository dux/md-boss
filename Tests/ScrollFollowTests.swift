import Testing
import AppKit
@testable import MdBoss

@Suite("Scroll follow")
@MainActor
struct ScrollFollowTests {
    /// A scroll view carrying a visible vertical ruler, the way the raw pane is assembled.
    @MainActor
    private struct Pane {
        let scrollView: NSScrollView
        let textView: NSTextView
        let ruler: NSRulerView
        /// Held because a layout manager does not retain its text storage.
        private let storage: NSTextStorage

        init(lines: Int = 200) {
            let unbounded = CGFloat.greatestFiniteMagnitude
            storage = NSTextStorage(string: (1...lines).map { "line \($0)" }.joined(separator: "\n"))

            let layoutManager = NSLayoutManager()
            let container = NSTextContainer(size: NSSize(width: 0, height: unbounded))
            storage.addLayoutManager(layoutManager)
            layoutManager.addTextContainer(container)

            textView = NSTextView(frame: .zero, textContainer: container)
            textView.minSize = .zero
            textView.maxSize = NSSize(width: unbounded, height: unbounded)
            textView.autoresizingMask = [.width]
            textView.isVerticallyResizable = true
            textView.isHorizontallyResizable = false
            textView.textContainer?.widthTracksTextView = true
            textView.font = .monospacedSystemFont(ofSize: 14, weight: .regular)

            scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 600, height: 400))
            scrollView.documentView = textView
            scrollView.hasVerticalScroller = true

            ruler = NSRulerView(scrollView: scrollView, orientation: .verticalRuler)
            ruler.clientView = textView
            ruler.ruleThickness = 46
            scrollView.hasVerticalRuler = true
            scrollView.verticalRulerView = ruler
            scrollView.rulersVisible = true

            scrollView.tile()
            layoutManager.ensureLayout(for: container)
        }
    }

    /// The AppKit fact the follow path has to respect. If this ever stops holding, the
    /// horizontal origin no longer needs carrying and `origin(for:in:maxY:)` can go.
    @Test("a visible vertical ruler parks the clip view left of zero")
    func rulerOffsetsTheClipView() {
        let pane = Pane()
        #expect(pane.scrollView.contentView.bounds.origin.x == -pane.ruler.ruleThickness)
    }

    @Test("following the preview scrolls vertically without shifting the text sideways")
    func followKeepsHorizontalOrigin() {
        let pane = Pane()
        let clip = pane.scrollView.contentView
        let resting = clip.bounds.origin.x

        let maxY = max(0, pane.textView.bounds.height - clip.bounds.height)
        clip.scroll(to: MarkdownTextView.Coordinator.origin(for: 300, in: clip, maxY: maxY))
        pane.scrollView.reflectScrolledClipView(clip)

        #expect(clip.bounds.origin.x == resting)
        #expect(clip.bounds.origin.y == 300)
    }

    @Test("the target line is clamped to the document")
    func clampsVertically() {
        let pane = Pane()
        let clip = pane.scrollView.contentView

        #expect(MarkdownTextView.Coordinator.origin(for: -50, in: clip, maxY: 1000).y == 0)
        #expect(MarkdownTextView.Coordinator.origin(for: 5000, in: clip, maxY: 1000).y == 1000)
    }
}
