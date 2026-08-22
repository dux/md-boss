import csvJS from './csv.js?raw'
import csvCSS from './csv.css?raw'
import { jsLiteral } from './page'
import type { CSVTable } from '../models/csvTable'

// The csv page: csv.js and csv.css plus the theme, all inlined so the page needs nothing
// from the network or the file system. The port of CSVPageBuilder.swift.
//
// A page of its own rather than a mode of the preview page. Nothing they would share
// survives the difference: no marked, no highlight.js, no measure, no `data-line` anchors,
// no images and therefore no image CSP either. The two-phase rendering *shape* is what is
// shared, and that lives in the two pane components.

export interface CSVPageOptions {
  themeCSS: string
  fontSize: number
  /** Null draws a blank page - the parse is still on its way, and "no rows" must not be
   *  claimed before anyone has looked. */
  table: CSVTable | null
}

/** What `csvRender` is handed. A cell is data, and the page sets it with `textContent`. */
export function csvPayload(table: CSVTable | null): string {
  if (!table) return 'null'
  return jsLiteral({
    header: table.header,
    rows: table.rows,
    total: table.totalRows,
    delimiter: table.delimiter,
  })
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Tighter than the preview's: this page draws text into a table and nothing else, so it
// has no reason to be able to load an image or run a script the document brought with it.
function csp(n: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${n}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ')
}

/** The whole csv document as a string, for an iframe's srcdoc. */
export function buildCSVPage(o: CSVPageOptions): string {
  const n = nonce()
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(n)}">
<style id="theme">${o.themeCSS}</style>
<style>${csvCSS}</style>
<style>:root { --body-size: ${Math.round(o.fontSize)}px; }</style>
</head>
<body>
<div id="sheet"></div>
<script nonce="${n}">${csvJS}</script>
<script nonce="${n}">csvRender(${csvPayload(o.table)});</script>
</body>
</html>`
}
