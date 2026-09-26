// A proposed change: what Prepare change asks the model for, how its answer is checked
// before anything trusts it, and the diff the pane shows. Pure - the chat (aiChat.ts) runs
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

/** The model's answer to a prepare or revise turn, once it has passed parseProposal. */
export interface ProposalAnswer {
  reply: string
  summary: string
  document: string
  images: Omit<ProposedImage, 'replaces'>[]
}

export const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'summary', 'document', 'images'],
  properties: {
    reply: { type: 'string', description: 'One or two sentences to the user, in the chat.' },
    summary: { type: 'string', description: 'What changed, in one line.' },
    document: { type: 'string', description: 'The complete revised document - every line, not only the changed ones.' },
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

export const PREPARE_MESSAGE = 'Prepare the change we have discussed. Return the complete revised document - every line, '
  + 'not only the changed ones - with a one-line summary of what changed and a short reply to me. Change nothing we '
  + 'did not discuss. If I asked for a diagram, or one clearly helps, draw it as SVG in images and embed it as '
  + '![alt](assets/<name>.svg); leave images empty otherwise.'

export const REVISE_INSTRUCTION = 'Revise the proposed change to reflect this, and return the complete revised '
  + 'document again in the same shape.'

/** A file name Apply may write under assets/: no folders, no dots at the front, .svg. */
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]*\.svg$/i

/** Null unless the answer has every field, every image has a writable name and starts as an
 *  SVG, and no two images share a name - a proposal is either whole or not shown. */
export function parseProposal(structured: unknown): ProposalAnswer | null {
  if (!structured || typeof structured !== 'object') return null
  const raw = structured as Record<string, unknown>
  if (typeof raw.reply !== 'string' || typeof raw.summary !== 'string' || typeof raw.document !== 'string') return null
  if (!Array.isArray(raw.images)) return null
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
  return { reply: raw.reply, summary: raw.summary, document: raw.document, images }
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
