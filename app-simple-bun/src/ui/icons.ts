import { extensionOf, isImage } from '../models/fileKinds'

// Sidebar row glyphs: one 16x16 stroke icon per kind, drawn in currentColor so the row's
// CSS sets the colour. Inline SVG strings rather than files - fez components cannot
// import, and the tree redraws often enough that a data URL per row is not worth it.
export type RowIconKind = 'folder' | 'folder-open' | 'markdown' | 'table' | 'json' | 'image' | 'text'

const ATTRS = 'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'

// A page outline with a folded corner, shared by the document kinds.
const PAGE = '<path d="M4 1.8h5.2L12.8 5.4v8.8H4z"/><path d="M9.2 1.8v3.6h3.6"/>'

const ICONS: Record<RowIconKind, string> = {
  'folder': '<path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.6 1.6h5.4a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>',
  'folder-open': '<path d="M1.8 13.4V4.2a1 1 0 0 1 1-1h3.4l1.6 1.6h5.4a1 1 0 0 1 1 1v1.7"/><path d="M1.8 13.4l1.6-5.2a1 1 0 0 1 1-.7h10.2l-1.8 5.2a1 1 0 0 1-1 .7z"/>',
  'markdown': PAGE + '<path d="M6 11.4V8l1.5 1.7L9 8v3.4"/>',
  'table': PAGE + '<path d="M5.6 8h5.6M5.6 10.4h5.6M8.4 8v4.4M5.6 8v4.4h5.6V8"/>',
  'json': PAGE + '<path d="M6.6 8c-.9 0-.9.6-.9 1.2s0 .9-.7 1 .7.4.7 1 0 1.2.9 1.2M9.8 8c.9 0 .9.6.9 1.2s0 .9.7 1-.7.4-.7 1 0 1.2-.9 1.2"/>',
  'image': '<rect x="2.2" y="3" width="11.6" height="10" rx="1"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="M2.6 12.2l3.4-3.4 2.2 2.2 1.9-1.9 3.5 3.5"/>',
  'text': PAGE + '<path d="M6 8.6h4M6 10.6h4M6 12.6h2.6"/>',
}

const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'qmd', 'rmd'])

/** Which glyph a tree row gets, from its name alone: folders by open state, files by
 *  extension, anything unknown as a plain text page. */
export function rowIconKind(name: string, isDir: boolean, open = false): RowIconKind {
  if (isDir) return open ? 'folder-open' : 'folder'
  const ext = extensionOf(name)
  if (MARKDOWN.has(ext)) return 'markdown'
  if (ext === 'csv') return 'table'
  if (ext === 'json') return 'json'
  if (isImage(name)) return 'image'
  return 'text'
}

export const iconSVG = (kind: RowIconKind) => `<svg ${ATTRS} aria-hidden="true">${ICONS[kind]}</svg>`

export const rowIcon = (name: string, isDir: boolean, open = false) => iconSVG(rowIconKind(name, isDir, open))

// Sidebar controls are not tree rows, but they are drawn in the same hand: same viewBox,
// same stroke, so a button next to the tree does not read as a different icon set.
const REFRESH =
  '<path d="M14 8a6 6 0 0 0-6-6 6.5 6.5 0 0 0-4.5 1.8L2 5.3"/><path d="M2 2v3.3h3.3"/>' +
  '<path d="M2 8a6 6 0 0 0 6 6 6.5 6.5 0 0 0 4.5-1.8L14 10.7"/><path d="M10.7 10.7H14V14"/>'

/** The re-read glyph on the sidebar's root row. */
export const refreshIcon = `<svg ${ATTRS} aria-hidden="true">${REFRESH}</svg>`
