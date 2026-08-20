import Foundation

/// Assembles the preview page: the vendored libraries, our script and stylesheet, and the
/// theme, all inlined so the page needs nothing from the network or the file system.
enum MarkdownPageBuilder {
    static func page(
        markdown: String,
        theme: Theme,
        fontSize: CGFloat,
        measure: CGFloat = SettingsData().previewMeasure,
        nonce: String
    ) -> String {
        """
        <!DOCTYPE html>
        <html data-theme="\(theme.id.rawValue)" data-filescheme="\(LocalFileSchemeHandler.scheme)">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        \(contentSecurityPolicy(nonce: nonce))
        <style id="theme">\(theme.rootCSS)</style>
        <style>\(Bundled.previewCSS)</style>
        <style>:root { --body-size: \(Int(fontSize))px; --measure: \(trim(measure))em; }</style>
        </head>
        <body>
        <div id="content"></div>
        <script nonce="\(nonce)">\(Bundled.markedJS)</script>
        <script nonce="\(nonce)">\(Bundled.highlightJS)</script>
        <script nonce="\(nonce)">\(Bundled.previewJS)</script>
        <script nonce="\(nonce)">mdRender(\(JSLiteral.string(markdown)));</script>
        </body>
        </html>
        """
    }

    /// Markdown may carry raw HTML, and this page holds a message-handler bridge. The
    /// policy blocks remote fetches, tracking pixels in READMEs, document-authored
    /// <script>, and inline onerror=/onload= handlers, while still allowing the four
    /// nonce-tagged scripts above and the previewfile:// image scheme.
    private static func contentSecurityPolicy(nonce: String) -> String {
        let policy = [
            "default-src 'none'",
            "img-src \(LocalFileSchemeHandler.scheme): data:",
            "style-src 'unsafe-inline'",
            "script-src 'nonce-\(nonce)'",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'"
        ].joined(separator: "; ")
        return #"<meta http-equiv="Content-Security-Policy" content="\#(policy)">"#
    }

    /// 48 rather than 48.0 - the value lands in CSS.
    static func trim(_ value: CGFloat) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    static func makeNonce() -> String {
        (0..<16).map { _ in String(UInt8.random(in: 0...255), radix: 16) }.joined()
    }
}

// MARK: - Bundled resources

/// Read once and held for the process. The two vendored libraries are ~162KB together, and
/// re-reading them per render would be pure waste.
enum Bundled {
    static let markedJS = text("marked.min", "js")
    static let highlightJS = text("highlight.min", "js")
    static let previewJS = text("preview", "js")
    static let previewCSS = text("preview", "css")
    static let csvJS = text("csv", "js")
    static let csvCSS = text("csv", "css")

    private static func text(_ name: String, _ ext: String) -> String {
        guard let url = Bundle.module.url(forResource: name, withExtension: ext),
              let contents = try? String(contentsOf: url, encoding: .utf8) else {
            assertionFailure("missing bundled resource \(name).\(ext)")
            return ""
        }
        return contents
    }
}
