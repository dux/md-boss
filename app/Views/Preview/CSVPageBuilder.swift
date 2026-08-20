import Foundation

/// Assembles the csv page: our script and stylesheet plus the theme, all inlined so the page
/// needs nothing from the network or the file system.
///
/// A page of its own rather than a mode of `MarkdownPageBuilder`. Nothing they would share
/// survives the difference: no marked, no highlight.js, no measure, no `data-line` anchors,
/// no images to route through a scheme handler - and therefore no image CSP either. The
/// two-phase rendering *shape* is what is shared, and that lives in the two coordinators.
enum CSVPageBuilder {
    static func page(theme: Theme, fontSize: CGFloat, table: CSVTable?, nonce: String) -> String {
        """
        <!DOCTYPE html>
        <html data-theme="\(theme.id.rawValue)">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        \(contentSecurityPolicy(nonce: nonce))
        <style id="theme">\(theme.rootCSS)</style>
        <style>\(Bundled.csvCSS)</style>
        <style>:root { --body-size: \(Int(fontSize))px; }</style>
        </head>
        <body>
        <div id="sheet"></div>
        <script nonce="\(nonce)">\(Bundled.csvJS)</script>
        <script nonce="\(nonce)">csvRender(\(payload(table)));</script>
        </body>
        </html>
        """
    }

    /// What `csvRender` is handed, here and on every re-render. Encoded as JSON rather than
    /// spliced into HTML: a cell is data, and the page sets it with `textContent`.
    static func payload(_ table: CSVTable?) -> String {
        guard let table else { return "null" }
        return JSLiteral.json(Payload(
            header: table.header,
            rows: table.rows,
            total: table.totalRows,
            delimiter: String(table.delimiter)
        ))
    }

    private struct Payload: Encodable {
        let header: [String]
        let rows: [[String]]
        let total: Int
        let delimiter: String
    }

    /// Tighter than the preview's: this page draws text into a table and nothing else, so it
    /// has no reason to be able to load an image or run a script the document brought with it.
    private static func contentSecurityPolicy(nonce: String) -> String {
        let policy = [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            "script-src 'nonce-\(nonce)'",
            "connect-src 'none'",
            "frame-src 'none'",
            "object-src 'none'"
        ].joined(separator: "; ")
        return #"<meta http-equiv="Content-Security-Policy" content="\#(policy)">"#
    }
}
