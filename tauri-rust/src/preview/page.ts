import markedJS from './marked.min.js?raw'
import highlightJS from './highlight.min.js?raw'
import previewJS from './preview.js?raw'
import previewCSS from './preview.css?raw'

export interface PreviewPageOptions {
  markdown: string
  themeCSS: string
  fontSize: number
  /** reading measure in em */
  measure: number
}

/** A JSON string literal is a JS string literal; `</` is escaped so a document holding
 *  "</script>" cannot close the script tag it is inlined into. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/')
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Markdown may carry raw HTML and this page talks back to the pane, so the policy blocks
// remote fetches, tracking pixels in READMEs, document-authored <script> and inline
// onerror=/onload= handlers while allowing the four nonce-tagged scripts below.
function csp(n: string): string {
  return [
    "default-src 'none'",
    'img-src data:',
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${n}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ')
}

/** The whole preview document as a string, for an iframe's srcdoc. */
export function buildPreviewPage(o: PreviewPageOptions): string {
  const n = nonce()
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(n)}">
<style id="theme">${o.themeCSS}</style>
<style>${previewCSS}</style>
<style>:root { --body-size: ${Math.round(o.fontSize)}px; --measure: ${o.measure}em; }</style>
</head>
<body>
<div id="content"></div>
<script nonce="${n}">${markedJS}</script>
<script nonce="${n}">${highlightJS}</script>
<script nonce="${n}">${previewJS}</script>
<script nonce="${n}">mdRender(${jsLiteral(o.markdown)});</script>
</body>
</html>`
}
