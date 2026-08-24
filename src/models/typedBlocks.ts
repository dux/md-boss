import { closesFence, opensFence, type Fence } from './markdownScan'

export interface TypedBlock {
  type: string
  attributes: Record<string, string>
  openLine: number
  closeLine: number
}

interface OpenBlock {
  type: string
  attributes: Record<string, string>
  openLine: number
}

const OPEN = /^( {0,3})(:{2,})([a-z][a-z0-9-]*)(?:[ \t]+(.*?))?[ \t]*$/
const CLOSE = /^( {0,3})(:{3,})[ \t]*$/
const ATTRIBUTE = /(?:^|\s)([a-z][a-z0-9_-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export type TypedBlockMarker =
  | { kind: 'open'; markerStart: number; markerEnd: number; typeStart: number; typeEnd: number; attributesStart: number | null; type: string; attributes: string }
  | { kind: 'close'; markerStart: number; markerEnd: number }

/** The typed-block punctuation on a whole source line, with offsets for the Raw pane. */
export function typedBlockMarker(line: string): TypedBlockMarker | null {
  const close = CLOSE.exec(line)
  if (close) {
    const markerStart = close[1].length
    return { kind: 'close', markerStart, markerEnd: markerStart + close[2].length }
  }

  const open = OPEN.exec(line)
  if (!open) return null
  const markerStart = open[1].length
  const markerEnd = markerStart + open[2].length
  const typeStart = markerEnd
  const typeEnd = typeStart + open[3].length
  const attributes = open[4] ?? ''
  return {
    kind: 'open',
    markerStart,
    markerEnd,
    typeStart,
    typeEnd,
    attributesStart: attributes ? line.indexOf(attributes, typeEnd) : null,
    type: open[3],
    attributes,
  }
}

/** HTML-like props after a typed-block name. A bare prop is the empty string, matching an
 *  HTML boolean attribute; malformed fragments are ignored without breaking the block. */
export function typedBlockAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

/** Closed typed blocks outside fenced code and leading front matter. Open lines accept the
 *  compact `::info` spelling as well as `:::info`; a close is three or more colons. Records
 *  are emitted as closes are met, so nested children come before their parents. */
export function typedBlocks(source: string): TypedBlock[] {
  const lines = source.split('\n')
  const bodyStart = frontMatterEnd(lines)
  const stack: OpenBlock[] = []
  const blocks: TypedBlock[] = []
  let fence: Fence | null = null

  for (let index = bodyStart; index < lines.length; index++) {
    const line = lines[index]
    if (fence) {
      if (closesFence(line, fence)) fence = null
      continue
    }

    const openedFence = opensFence(line)
    if (openedFence) {
      fence = openedFence
      continue
    }

    const marker = typedBlockMarker(line)
    if (marker?.kind === 'close') {
      const opened = stack.pop()
      if (opened) blocks.push({ ...opened, closeLine: index + 1 })
      continue
    }

    if (!marker || marker.kind !== 'open') continue
    stack.push({
      type: marker.type,
      attributes: typedBlockAttributes(marker.attributes),
      openLine: index + 1,
    })
  }

  // A closed child inside an unclosed parent is still part of malformed outer syntax, so
  // leave the whole run as ordinary Markdown rather than transforming only its middle.
  return blocks.filter((block) => !stack.some((opened) => block.openLine > opened.openLine))
}

/** One past a leading front-matter close, or zero when the document has no closed header. */
function frontMatterEnd(lines: readonly string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let index = 1; index < lines.length; index++) {
    const edge = lines[index].trim()
    if (edge === '---' || edge === '...') return index + 1
  }
  return 0
}
