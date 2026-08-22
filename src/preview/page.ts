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
  /** The document's folder as a `file:` URL, slash-terminated (documentBaseURL): the page's
   *  <base>, so relative links and images resolve against the file the way WKWebView's
   *  baseURL did. Null renders with no base - the browser build's sample files. */
  baseURL: string | null
  /** Where local images are served from - `Native.shell.assetBase()`. Empty for none. */
  assetBase: string
}

/** A JSON string literal is a JS string literal; `</` is escaped so a document holding
 *  "</script>" cannot close the script tag it is inlined into. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Markdown may carry raw HTML and this page talks back to the pane, so the policy blocks
// remote fetches, tracking pixels in READMEs, document-authored <script> and inline
// onerror=/onload= handlers while allowing the four nonce-tagged scripts below and images
// from the asset base. A custom scheme (asset:) is allowed whole - it is the app's own -
// but an http host (Windows serves assets from http://asset.localhost) only by host, since
// `http:` would let every remote image through.
function csp(n: string, assetBase: string): string {
  const scheme = assetBase.split(':')[0]
  const images = assetBase ? [assetBase, ...(/^https?$/.test(scheme) ? [] : [scheme + ':'])] : []
  return [
    "default-src 'none'",
    `img-src ${[...images, 'data:'].join(' ')}`,
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
<html data-asset-base="${escapeAttribute(o.assetBase)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(n, o.assetBase)}">
${o.baseURL === null ? '' : `<base id="base" href="${escapeAttribute(o.baseURL)}">`}
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
