import Foundation

// MARK: - Theme -> CSS
//
// The preview page is TOLD which theme to use; it never sniffs prefers-color-scheme.
// That is the only way the web view and the SwiftUI chrome can be guaranteed to agree.

extension Theme {
    /// The :root block injected into <style id="theme">. Regenerating this and swapping
    /// the style element is what makes a theme toggle preserve scroll position.
    var rootCSS: String {
        let vars = ThemeToken.allCases
            .map { "  --\($0.rawValue): \(value($0));" }
            .joined(separator: "\n")

        // color-scheme is orthogonal to the palette: it is what makes WebKit's scrollbars,
        // form controls and default caret match. Getting it wrong gives a light scrollbar
        // on a dark page.
        return ":root {\n\(vars)\n  color-scheme: \(id == .dark ? "dark" : "light");\n}"
    }

    /// JS string literal form, ready for evaluateJavaScript("mdSetTheme(...)").
    var rootCSSLiteral: String { JSLiteral.string(rootCSS) }
}

// MARK: - JS literals

enum JSLiteral {
    /// A JSON string literal is also a valid JS string literal, and JSONEncoder already
    /// handles every escape correctly. The extra `</` replacement stops a document that
    /// contains "</script>" from closing our script tag when the result is inlined.
    static func string(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let literal = String(bytes: data, encoding: .utf8) else { return "\"\"" }
        return literal.replacingOccurrences(of: "</", with: "<\\/")
    }
}
