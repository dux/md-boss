import Foundation
import WebKit

/// Serves local files to the preview through a custom scheme.
///
/// Not optional: a page loaded with `loadHTMLString` cannot pull `file://` subresources, so
/// a relative `<img src="./diagram.png">` simply will not load without this. `preview.js`
/// rewrites those `src` attributes to `previewfile://f/<base64url-of-path>`.
///
/// Ported from file_explorer_swift's HTMLPreviewView.
final class LocalFileSchemeHandler: NSObject, WKURLSchemeHandler {
    /// `nonisolated`, because `MarkdownPageBuilder` builds the page off the main actor and
    /// this is a string constant - there is nothing here for an actor to protect.
    nonisolated static let scheme = "previewfile"

    static func src(for url: URL) -> String {
        let encoded = Data(url.path.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "\(scheme)://f/\(encoded)"
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let path = Self.decodePath(from: url) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let fileURL = URL(fileURLWithPath: path)
        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = URLResponse(
            url: url,
            mimeType: Self.mimeType(for: fileURL.pathExtension.lowercased()),
            expectedContentLength: data.count,
            textEncodingName: nil
        )
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    static func decodePath(from url: URL) -> String? {
        var encoded = url.lastPathComponent
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while !encoded.count.isMultiple(of: 4) { encoded += "=" }
        guard let data = Data(base64Encoded: encoded),
              let path = String(data: data, encoding: .utf8) else { return nil }
        return path
    }

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "bmp": return "image/bmp"
        case "tiff", "tif": return "image/tiff"
        case "heic", "heif": return "image/heic"
        case "svg": return "image/svg+xml"
        case "avif": return "image/avif"
        default: return "application/octet-stream"
        }
    }
}
