// Relative paths and inline markdown links, as text. The first place in the app that has
// to read `[text](dest)` as syntax rather than follow a resolved URL. Pure: a move rewrites
// every document under a root and none of that wants the UI thread.

import { isImage } from './fileKinds'
import {
  closesFence, matchingBracket, opensFence, parsingDestination, skippingCodeSpan,
  type Fence, type Range,
} from './markdownScan'
import { basename, components, joinPath, normalizePath } from './paths'

/** One file that has moved. A list rather than a pair, because moving a folder is the
 *  same algorithm with one entry per document underneath it. */
export interface Move {
  old: string
  new: string
}

/** The destination token of one inline link, and where it sits in the source. */
export interface Destination {
  /** As written, angle brackets included - link text and any title sit outside it. */
  range: Range
  /** Inside the angle brackets, when there were any. */
  raw: string
  isImage: boolean
}

export interface RewriteOptions {
  /** What `~` expands to. A `~` destination is left alone without it. */
  home?: string
}

// MARK: - Paths

// Parentheses close an inline destination and quotes open a title, so neither can be left
// literal. Percent-encoding rather than the `<...>` form: `%20` survives every renderer and
// keeps a rewrite shape-stable instead of churning an already-encoded link into another form.
// The set is CharacterSet.urlPathAllowed minus ()<>"' - what the Swift app emitted.
const DESTINATION_ALLOWED = /[A-Za-z0-9!$&*+,;=:@\-._~]/

function encodeComponent(part: string): string {
  let out = ''
  for (const ch of part) {
    if (DESTINATION_ALLOWED.test(ch)) {
      out += ch
      continue
    }
    for (const byte of new TextEncoder().encode(ch)) {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

/** The path from `directory` to `target`, the way you would type it: `./a.md`,
 *  `./sub/a.md`, `../other/a.md`. Always relative, always prefixed - a bare `sub/a.md`
 *  reads as a word until you get to the slash. */
export function relativePath(directory: string, target: string): string {
  const from = components(directory)
  const to = components(target)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++

  const parts = [...Array<string>(from.length - shared).fill('..'), ...to.slice(shared)]
  if (parts.length === 0) return './'
  const joined = parts.map(encodeComponent).join('/')
  return parts[0] === '..' ? joined : './' + joined
}

/** What a file dropped into the raw pane becomes. The link text is the file name with its
 *  extension - the name you dragged is the name you get. */
export function snippet(target: string, directory: string): string {
  const path = relativePath(directory, target)
  const name = basename(target).replace(/[\\[\]]/g, (c) => '\\' + c)
  return isImage(target) ? `![${name}](${path})` : `[${name}](${path})`
}

// MARK: - Rewriting

/** Repoints every inline destination in `text` that resolves to a moved file. `directory`
 *  is the folder `text` was read from. Returns null when nothing matched, so a caller never
 *  rewrites a file it did not need to touch. The output is assembled forward from the
 *  untouched segments between destinations, so line endings, titles and link text all
 *  survive verbatim. */
export function rewriting(
  text: string,
  directory: string,
  moves: Move[],
  options: RewriteOptions = {},
): { text: string; count: number } | null {
  if (moves.length === 0) return null

  const targets = new Map<string, string>()
  for (const move of moves) targets.set(normalizePath(move.old), move.new)

  let output = ''
  let cursor = 0
  let count = 0

  for (const destination of destinations(text)) {
    const replacement = repointing(destination, directory, targets, options)
    if (replacement === null) continue
    output += text.slice(cursor, destination.range.start) + replacement
    cursor = destination.range.end
    count++
  }

  if (count === 0) return null
  return { text: output + text.slice(cursor), count }
}

function repointing(
  destination: Destination,
  directory: string,
  targets: Map<string, string>,
  options: RewriteOptions,
): string | null {
  const { body, fragment } = splittingFragment(destination.raw)
  const unescaped = unescaping(body)
  let decoded: string
  try {
    decoded = decodeURIComponent(unescaped)
  } catch {
    decoded = unescaped
  }

  if (!decoded || decoded.startsWith('//') || hasScheme(decoded)) return null

  const direct = resolving(decoded, directory, options)
  if (direct !== null && targets.has(direct)) {
    return relativePath(directory, targets.get(direct)!) + fragment
  }

  // Editor-style `./app/Foo.swift:14`, tried only after the literal path misses - a colon
  // is a legal character in a file name. Same ordering as the link target resolver.
  const suffix = /:[0-9]+(:[0-9]+)?$/.exec(decoded)
  if (!suffix) return null
  const resolved = resolving(decoded.slice(0, suffix.index), directory, options)
  if (resolved === null || !targets.has(resolved)) return null
  return relativePath(directory, targets.get(resolved)!) + suffix[0] + fragment
}

function resolving(path: string, directory: string, options: RewriteOptions): string | null {
  if (!path) return null
  if (path.startsWith('/')) return normalizePath(path)
  if (path.startsWith('~')) {
    if (!options.home) return null
    return normalizePath(options.home + path.slice(1))
  }
  return joinPath(directory, path)
}

/** `http:`, `mailto:` and friends. Two characters at least before the colon, so a file
 *  called `a` followed by a line number is not mistaken for a URL scheme. */
function hasScheme(path: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]+:/.test(path)
}

/** Splits at the first unescaped `#`. The fragment is carried through the rewrite exactly
 *  as written - it is the target's anchor, not ours to re-encode. */
function splittingFragment(raw: string): { body: string; fragment: string } {
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i += 2
      continue
    }
    if (raw[i] === '#') return { body: raw.slice(0, i), fragment: raw.slice(i) }
    i++
  }
  return { body: raw, fragment: '' }
}

function unescaping(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) i++
    out += text[i]
  }
  return out
}

// MARK: - Scanning

/** Every inline link and image destination in `text`, in source order. Fenced blocks are
 *  skipped whole. Deliberately not handled: reference definitions (`[id]: ./x.md`) and
 *  four-space indented code - inside a list `    [a](b.md)` is an ordinary paragraph line,
 *  and skipping real links is the worse error. */
export function destinations(text: string): Destination[] {
  const found: Destination[] = []
  let fence: Fence | null = null
  let index = 0
  let atLineStart = true

  while (index < text.length) {
    if (atLineStart) {
      const newline = text.indexOf('\n', index)
      const end = newline === -1 ? text.length : newline
      const line = text.slice(index, end)
      const next = newline === -1 ? text.length : newline + 1

      if (fence) {
        if (closesFence(line, fence)) fence = null
        index = next
        continue
      }
      const opened = opensFence(line)
      if (opened) {
        fence = opened
        index = next
        continue
      }
    }

    const ch = text[index]
    atLineStart = ch === '\n'

    if (ch === '\\') {
      index += 2
    } else if (ch === '`') {
      index = skippingCodeSpan(text, index)
    } else if (ch === '[' || ch === '!') {
      const open = ch === '!' ? index + 1 : index
      if (open >= text.length || text[open] !== '[') {
        index++
        continue
      }
      index = scanningLink(text, open, ch === '!', found)
    } else {
      index++
    }
  }

  return found.sort((a, b) => a.range.start - b.range.start)
}

/** Handles one `[...](...)`, appending its destination and any nested one, and answers
 *  where scanning resumes. A `[` that turns out not to open a link resumes just after it,
 *  so a stray `](` in prose cannot eat the rest of the file. */
function scanningLink(text: string, open: number, image: boolean, found: Destination[]): number {
  const resume = open + 1
  const close = matchingBracket(text, open)
  if (close === null) return resume
  const afterClose = close + 1
  if (afterClose >= text.length || text[afterClose] !== '(') return resume
  const parsed = parsingDestination(text, afterClose)
  if (!parsed) return resume

  found.push({ range: parsed.range, raw: parsed.raw, isImage: image })

  // Link text can hold an image of its own, and that image's destination points at a file
  // like any other. Nested offsets are relative to the inner text, so shift them back.
  for (const nested of destinations(text.slice(resume, close))) {
    found.push({
      range: { start: resume + nested.range.start, end: resume + nested.range.end },
      raw: nested.raw,
      isImage: nested.isImage,
    })
  }
  return parsed.end
}
