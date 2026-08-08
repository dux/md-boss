import SwiftUI
import WebKit
import Combine

/// The rendered document.
///
/// Two-phase rendering, because `baseURL` can only be set at load time:
/// opening a file loads the whole page once, and everything after that - typing, a theme
/// switch, a text-size change - is a JavaScript call into the live page. A reload would
/// flash white, lose the scroll position, and re-inline 162KB of libraries per keystroke.
struct MarkdownPreviewView: NSViewRepresentable {
    /// The markdown file's own URL, used as the page's base so relative hrefs reach the
    /// navigation delegate already absolute. RFC 3986 replaces the last path segment,
    /// exactly as a browser does.
    let fileURL: URL?
    let markdown: String
    let theme: Theme
    let fontSize: CGFloat
    let measure: CGFloat
    var anchor: String?
    var onLink: (MarkdownLinkTarget) -> Void

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(LocalFileSchemeHandler(), forURLScheme: LocalFileSchemeHandler.scheme)
        configuration.userContentController.add(context.coordinator, name: Coordinator.bridgeName)

        let webView = PreviewWebView(frame: .zero, configuration: configuration)
        webView.fileURL = fileURL
        webView.navigationDelegate = context.coordinator
        // Without this the rubber-band overscroll area stays white on a dark page.
        webView.underPageBackgroundColor = theme.nsColor(.bg)
        webView.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        webView.isInspectable = true
        #endif

        context.coordinator.owner = self
        context.coordinator.load(webView, page: page(context.coordinator))
        context.coordinator.observeScrolling(of: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.owner = self
        (webView as? PreviewWebView)?.fileURL = fileURL

        // A changed base URL means a different document - only that needs a real load.
        guard coordinator.loadedURL == fileURL?.absoluteString else {
            webView.underPageBackgroundColor = theme.nsColor(.bg)
            coordinator.load(webView, page: page(coordinator))
            return
        }

        if coordinator.renderedMarkdown != markdown {
            coordinator.renderedMarkdown = markdown
            coordinator.run(webView, "mdRender(\(JSLiteral.string(markdown)));")
        }

        // Keyed on the whole palette rather than its id, so an edited palette repaints too.
        if coordinator.renderedTheme != theme {
            coordinator.renderedTheme = theme
            webView.underPageBackgroundColor = theme.nsColor(.bg)
            coordinator.run(webView, "mdSetTheme(\(theme.rootCSSLiteral));")
        }

        if coordinator.renderedFontSize != fontSize {
            coordinator.renderedFontSize = fontSize
            coordinator.run(webView, "mdSetFontSize(\(Int(fontSize)));")
        }

        if coordinator.renderedMeasure != measure {
            coordinator.renderedMeasure = measure
            coordinator.run(webView, "mdSetMeasure(\(MarkdownPageBuilder.trim(measure)));")
        }

        if let anchor, coordinator.pendingAnchor != anchor {
            coordinator.pendingAnchor = anchor
            coordinator.run(webView, "mdScrollToAnchor(\(JSLiteral.string(anchor)));")
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.bridgeName)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func page(_ coordinator: Coordinator) -> String {
        coordinator.renderedMarkdown = markdown
        coordinator.renderedTheme = theme
        coordinator.renderedFontSize = fontSize
        coordinator.renderedMeasure = measure
        coordinator.loadedURL = fileURL?.absoluteString
        coordinator.pendingAnchor = anchor
        return MarkdownPageBuilder.page(
            markdown: markdown,
            theme: theme,
            fontSize: fontSize,
            measure: measure,
            nonce: MarkdownPageBuilder.makeNonce()
        )
    }

    // MARK: - Coordinator

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let bridgeName = "mdboss"

        var owner: MarkdownPreviewView?

        var loadedURL: String?
        var renderedMarkdown = ""
        var renderedTheme: Theme?
        var renderedFontSize: CGFloat = 0
        var renderedMeasure: CGFloat = 0
        var pendingAnchor: String?

        private var isReady = false
        private var queued: [String] = []
        private var syncObserver: AnyCancellable?

        func load(_ webView: WKWebView, page: String) {
            isReady = false
            queued.removeAll()
            ScrollSync.shared.reset()
            webView.loadHTMLString(page, baseURL: owner?.fileURL)
        }

        func observeScrolling(of webView: WKWebView) {
            syncObserver = ScrollSync.shared.moves
                .filter { $0.source != .preview }
                .sink { [weak self, weak webView] move in
                    // Dropped rather than queued while the page loads: a stale scroll
                    // position is worth nothing by the time it would be flushed.
                    guard let self, let webView, self.isReady else { return }
                    webView.evaluateJavaScript("mdScrollToLine(\(move.line));")
                    ScrollSync.shared.applied()
                }
        }

        /// Calls made before the page signals `ready` are queued rather than dropped -
        /// a theme toggle during load must not be lost.
        func run(_ webView: WKWebView, _ script: String) {
            guard isReady else {
                queued.append(script)
                return
            }
            webView.evaluateJavaScript(script)
        }

        // MARK: WKNavigationDelegate

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            // The preview never navigates away from the document it is rendering.
            decisionHandler(.cancel)
            owner?.onLink(MarkdownLinkTarget.resolve(url))
        }

        // MARK: WKScriptMessageHandler

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let kind = body["kind"] as? String else { return }

            switch kind {
            case "ready":
                isReady = true
                let pending = queued
                queued.removeAll()
                if let webView = message.webView {
                    for script in pending { webView.evaluateJavaScript(script) }
                    if let anchor = pendingAnchor {
                        webView.evaluateJavaScript("mdScrollToAnchor(\(JSLiteral.string(anchor)));")
                    }
                }
            case "scroll":
                guard let line = body["line"] as? Double else { return }
                ScrollSync.shared.report(line: line, from: .preview)
            case "context":
                guard let line = body["line"] as? Double else { return }
                MdBossManager.shared.reportCursor(line: Int(line))
            case "anchorMiss":
                guard let id = body["id"] as? String else { return }
                MdBossManager.shared.showError("No heading: \(id)")
            case "error":
                guard let message = body["message"] as? String else { return }
                MdBossManager.shared.showError("Preview: \(message)")
            default:
                break
            }
        }
    }
}

/// WKWebView with md-boss items in its context menu. On macOS the only hook for that is
/// `willOpenMenu`, so the web view has to be subclassed.
final class PreviewWebView: WKWebView {
    var fileURL: URL?

    /// The page reports the right-clicked block's source line over the bridge, which is
    /// asynchronous - but a `BlockMenuItem` fires when the item is *picked*, long after the
    /// message has landed, so the line it acts on is the right one. Only a title computed
    /// here could be stale, which is why it does not switch to "Edit" the way the raw pane's
    /// does; the prompt itself still says Edit when there is already a note there.
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        guard let fileURL else { return }

        let manager = MdBossManager.shared
        let items: [NSMenuItem] = [
            BlockMenuItem("Add Note…") { manager.addNoteAtCursor() },
            .separator(),
            BlockMenuItem("Copy Path") { manager.copyPath(fileURL) },
            BlockMenuItem("Reveal in Finder") { manager.revealInFinder(fileURL) },
            .separator()
        ]

        for (offset, item) in items.enumerated() {
            menu.insertItem(item, at: offset)
        }
    }
}
