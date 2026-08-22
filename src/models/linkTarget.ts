// What a link clicked inside the preview points at - the MarkdownLinkTarget.swift rules.
// Links arrive already absolute: the page loads with the document's folder as its <base>,
// so the browser resolves `./doc/API.md` before it reaches here. The one look at the disk
// is a probe passed in, so the classification is tested without a filesystem.

import { dirname, normalizePath } from './paths'

export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; fragment: string | null }
  | { kind: 'directory'; path: string }
  /** Nothing on disk at this path. */
  | { kind: 'missing'; path: string }

/** What is at a path: a file, a directory, or nothing. */
export type PathProbe = (path: string) => Promise<'file' | 'dir' | null>

/** `/Users/me/a b.md` -> `file:///Users/me/a%20b.md`, `C:\x\y` -> `file:///C:/x/y`. Each
 *  component is encoded as a URL component - `#` and `?` in a name must not read as a
 *  fragment or a query - with the drive colon put back, which browsers want literal. */
export function fileURL(path: string): string {
  const n = normalizePath(path)
  const body = n.startsWith('/') ? n : '/' + n
  return 'file://' + body.split('/').map((part) => encodeURIComponent(part).replace(/%3A/gi, ':')).join('/')
}

/** The page's <base>: the document's folder, slash-terminated, so RFC 3986 replaces the
 *  last segment the way a browser does for a page at that file. */
export function documentBaseURL(documentPath: string): string {
  const url = fileURL(dirname(documentPath))
  return url.endsWith('/') ? url : url + '/'
}

/** A `file:` URL back to a path, the fragment kept aside. Null for any other scheme. The
 *  fragment is left percent-encoded: the page decodes it when it scrolls. */
export function pathFromFileURL(url: string): { path: string; fragment: string | null } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:') return null
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    path = parsed.pathname
  }
  // `file:///C:/x` parses to the pathname `/C:/x`.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  const fragment = parsed.hash.length > 1 ? parsed.hash.slice(1) : null
  return { path: normalizePath(path), fragment }
}

/** Editor-style refs like `./app/Foo.swift:14` or `:14:3`. Null when there is no suffix. */
export function strippingLineSuffix(path: string): string | null {
  const match = /:[0-9]+(:[0-9]+)?$/.exec(path)
  return match ? path.slice(0, match.index) : null
}

export async function resolveLinkTarget(href: string, probe: PathProbe): Promise<LinkTarget> {
  const local = pathFromFileURL(href)
  if (!local) return { kind: 'external', url: href }
  const { path, fragment } = local

  const literal = await classify(path, fragment, probe)
  if (literal) return literal

  // Only tried after the literal path misses, since a colon is a legal character in a
  // file name.
  const trimmed = strippingLineSuffix(path)
  if (trimmed) {
    const found = await classify(trimmed, fragment, probe)
    if (found) return found
  }
  return { kind: 'missing', path }
}

async function classify(path: string, fragment: string | null, probe: PathProbe): Promise<LinkTarget | null> {
  const found = await probe(path)
  if (found === null) return null
  return found === 'dir' ? { kind: 'directory', path } : { kind: 'file', path, fragment }
}
