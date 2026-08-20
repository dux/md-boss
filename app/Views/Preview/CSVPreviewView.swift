import SwiftUI
import WebKit

/// The rendered side of a delimited file: one table, as wide as its widest row.
///
/// Two-phase like the markdown preview - the page loads once per file and everything after
/// that is an `evaluateJavaScript` call - but a great deal smaller, because a table has no
/// anchors, no links, no images and no measure. What it does have that the preview does not
/// is a horizontal position worth remembering, so the place it reports is a point.
struct CSVPreviewView: NSViewRepresentable {
    let fileURL: URL?
    /// Nil while the first parse is still running, which is a blank page rather than an
    /// empty table - "no rows" is a thing the file can be, and it must not be claimed early.
    let table: CSVTable?
    /// Bumped by the pane every time a parse lands, and the only thing change detection
    /// compares. Two 5,000-row tables are 100,000 strings to walk, and an update pass runs
    /// on every keystroke, theme change and window resize.
    let version: Int
    let theme: Theme
    let fontSize: CGFloat

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: Coordinator.bridgeName)

        let webView = PreviewWebView(frame: .zero, configuration: configuration)
        webView.fileURL = fileURL
        // A table hangs no notes: they anchor to a source line, and this page draws none.
        webView.canAnnotate = false
        webView.underPageBackgroundColor = theme.nsColor(.bg)
        webView.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        webView.isInspectable = true
        #endif

        context.coordinator.owner = self
        context.coordinator.load(webView, page: page(context.coordinator))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.owner = self
        (webView as? PreviewWebView)?.fileURL = fileURL

        // A different file is a different page, and a different place to restore to.
        guard coordinator.loadedURL == fileURL?.absoluteString else {
            webView.underPageBackgroundColor = theme.nsColor(.bg)
            coordinator.load(webView, page: page(coordinator))
            return
        }

        if coordinator.renderedVersion != version {
            coordinator.renderedVersion = version
            coordinator.run(webView, "csvRender(\(CSVPageBuilder.payload(table)));")
        }

        if coordinator.renderedTheme != theme {
            coordinator.renderedTheme = theme
            webView.underPageBackgroundColor = theme.nsColor(.bg)
            coordinator.run(webView, "csvSetTheme(\(theme.rootCSSLiteral));")
        }

        if coordinator.renderedFontSize != fontSize {
            coordinator.renderedFontSize = fontSize
            coordinator.run(webView, "csvSetFontSize(\(Int(fontSize)));")
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.bridgeName)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func page(_ coordinator: Coordinator) -> String {
        coordinator.renderedVersion = version
        coordinator.renderedTheme = theme
        coordinator.renderedFontSize = fontSize
        coordinator.loadedURL = fileURL?.absoluteString
        return CSVPageBuilder.page(
            theme: theme,
            fontSize: fontSize,
            table: table,
            nonce: MarkdownPageBuilder.makeNonce()
        )
    }

    // MARK: - Coordinator

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler {
        static let bridgeName = "mdboss"

        var owner: CSVPreviewView?

        var loadedURL: String?
        var renderedVersion = -1
        var renderedTheme: Theme?
        var renderedFontSize: CGFloat = 0

        private var isReady = false
        private var queued: [String] = []

        func load(_ webView: WKWebView, page: String) {
            isReady = false
            queued.removeAll()
            // No base URL: this page loads nothing and links nowhere.
            webView.loadHTMLString(page, baseURL: nil)

            // Queued rather than sent later, so the file opens where it was left instead of
            // jumping there once the next update pass happens to run.
            guard let url = owner?.fileURL,
                  let place = ScrollMemory.shared.place(for: url).table else { return }
            run(webView, "csvScrollTo(\(place.x), \(place.y));")
        }

        /// Calls made before the page signals `ready` are queued rather than dropped.
        func run(_ webView: WKWebView, _ script: String) {
            guard isReady else {
                queued.append(script)
                return
            }
            webView.evaluateJavaScript(script)
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
                }
            case "scroll":
                // Not before ready: a page on its way out would file its own position under
                // the document that is replacing it.
                guard isReady,
                      let url = owner?.fileURL,
                      let x = body["x"] as? Double,
                      let y = body["y"] as? Double else { return }
                ScrollMemory.shared.record(table: CGPoint(x: x, y: y), for: url)
            case "error":
                guard let message = body["message"] as? String else { return }
                MdBossManager.shared.showError("Table: \(message)")
            default:
                break
            }
        }
    }
}
