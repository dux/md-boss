// What the sidebar lists and what the raw pane embeds, by extension - the one list both
// the tree and the link snippet read.

export const DOCUMENT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'qmd', 'rmd', 'txt', 'csv',
])

export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg', 'avif',
])

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isDocument = (path: string) => DOCUMENT_EXTENSIONS.has(extensionOf(path))
export const isImage = (path: string) => IMAGE_EXTENSIONS.has(extensionOf(path))

/** The name a typed file name is created under. Anything the sidebar would not list becomes
 *  markdown - creating a file the tree then hides is the one outcome here worth ruling out. */
export const documentName = (typed: string) => (isDocument(typed) ? typed : typed + '.md')
