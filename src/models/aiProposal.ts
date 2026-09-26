// A proposed change: what Prepare change asks the model for, how its answer is checked
// and turned into the revised text before anything trusts it, and the diff the pane shows.
// The model answers with edits, not the whole document: retyping a long file through the
// StructuredOutput tool takes minutes for a one-line change. Pure - the chat (aiChat.ts) runs
// the turns, the manager applies the result.

import { structuredPatch } from 'diff'

/** An SVG the change draws, saved as assets/<name> beside the document. */
export interface ProposedImage {
  /** `flow-chart.svg` - a plain file name, checked by parseProposal. */
  name: string
  alt: string
  svg: string
  /** A file of that name is already in assets/ and Apply would overwrite it. */
  replaces: boolean
}

export type ProposalStatus = 'pending' | 'applied' | 'discarded' | 'superseded'

export interface Proposal {
  summary: string
  /** The whole revised document. */
  document: string
  images: ProposedImage[]
  /** The text it was prepared against. Apply refuses once the editor holds anything else. */
  base: string
  status: ProposalStatus
}

/** One replacement the model asks for: `old` is an excerpt of the document it was shown. */
export interface ProposedEdit {
  old: string
  new: string
}

/** The model's answer to a prepare or revise turn, once it has passed parseProposal and its
 *  edits have been applied to the text it was prepared against. */
export interface ProposalAnswer {
  reply: string
  summary: string
  document: string
  images: Omit<ProposedImage, 'replaces'>[]
}

export const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'summary', 'edits', 'images'],
  properties: {
    reply: { type: 'string', description: 'One or two sentences to the user, in the chat.' },
    summary: { type: 'string', description: 'What changed, in one line.' },
    edits: {
      type: 'array',
      description: 'The whole change as replacements in the current document. Edits must not overlap.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['old', 'new'],
        properties: {
          old: {
            type: 'string',
            description: 'An exact excerpt of the current document, whitespace included, that occurs in it exactly once - '
              + 'take in neighbouring lines until it does. Empty only when the document is empty.',
          },
          new: { type: 'string', description: 'What replaces it; empty deletes it.' },
        },
      },
    },
    images: {
      type: 'array',
      description: 'SVG diagrams the document embeds as ![alt](assets/<name>). Empty when there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'alt', 'svg'],
        properties: {
          name: { type: 'string', description: 'kebab-case file name ending in .svg' },
          alt: { type: 'string' },
          svg: { type: 'string', description: 'The whole SVG source, starting with <svg' },
        },
      },
    },
  },
}

export const PREPARE_MESSAGE = 'Prepare the change we have discussed. Return it as edits to the current document, with a '
  + 'one-line summary of what changed and a short reply to me. Change nothing we did not discuss. If I asked for a diagram, or one clearly helps, draw it as SVG in images and embed it as '
  + '![alt](assets/<name>.svg); leave images empty otherwise.'

export const REVISE_INSTRUCTION = 'Revise the proposed change to reflect this, and return the whole change again in the '
  + 'same shape - every edit, against the current document rather than your earlier proposal.'

/** A file name Apply may write under assets/: no folders, no dots at the front, .svg. */
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]*\.svg$/i

/** Null unless the answer has every field, every edit lands on exactly one place in `base`,
 *  every image has a writable name and starts as an SVG, and no two images share a name - a
 *  proposal is either whole or not shown. */
export function parseProposal(structured: unknown, base: string): ProposalAnswer | null {
  if (!structured || typeof structured !== 'object') return null
  const raw = structured as Record<string, unknown>
  if (typeof raw.reply !== 'string' || typeof raw.summary !== 'string') return null
  if (!Array.isArray(raw.edits) || !Array.isArray(raw.images)) return null
  const edits: ProposedEdit[] = []
  for (const item of raw.edits as unknown[]) {
    if (!item || typeof item !== 'object') return null
    const { old, new: text } = item as Record<string, unknown>
    if (typeof old !== 'string' || typeof text !== 'string') return null
    edits.push({ old, new: text })
  }
  const document = applyEdits(base, edits)
  if (document === null) return null
  const images: ProposalAnswer['images'] = []
  for (const item of raw.images as unknown[]) {
    if (!item || typeof item !== 'object') return null
    const { name, alt, svg } = item as Record<string, unknown>
    if (typeof name !== 'string' || typeof alt !== 'string' || typeof svg !== 'string') return null
    const file = name.replace(/^(\.\/)?assets\//, '')
    if (!IMAGE_NAME.test(file) || file.includes('..')) return null
    if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) return null
    if (images.some((i) => i.name === file)) return null
    images.push({ name: file, alt, svg })
  }
  return { reply: raw.reply, summary: raw.summary, document, images }
}

/** `base` with every edit made, or null when an excerpt is missing, ambiguous or overlaps
 *  another - guessing where the model meant would change text nobody reviewed. */
export function applyEdits(base: string, edits: readonly ProposedEdit[]): string | null {
  const spans: { start: number; end: number; text: string }[] = []
  for (const edit of edits) {
    const start = excerptAt(base, edit.old)
    if (start < 0) return null
    spans.push({ start, end: start + edit.old.length, text: edit.new })
  }
  spans.sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const span of spans) {
    if (span.start < at) return null
    out += base.slice(at, span.start) + span.text
    at = span.end
  }
  return out + base.slice(at)
}

/** Where `old` occurs in `base`, or -1 unless exactly once. Empty only writes an empty document. */
function excerptAt(base: string, old: string): number {
  if (!old) return base ? -1 : 0
  const at = base.indexOf(old)
  return at >= 0 && base.indexOf(old, at + 1) < 0 ? at : -1
}

export interface DiffLine {
  kind: 'add' | 'remove' | 'same' | 'gap'
  text: string
}

export interface ProposalDiff {
  added: number
  removed: number
  lines: DiffLine[]
}

/** What the card shows: changed lines with two of context, a gap between hunks. */
export function proposalDiff(base: string, document: string): ProposalDiff {
  const patch = structuredPatch('', '', base, document, undefined, undefined, { context: 2 })
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  patch.hunks.forEach((hunk, index) => {
    if (index > 0) lines.push({ kind: 'gap', text: '' })
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'same'
      if (kind === 'add') added++
      if (kind === 'remove') removed++
      lines.push({ kind, text: line.slice(1) })
    }
  })
  return { added, removed, lines }
}
