// What the AI pane sends, as text. Pure: the chat (aiChat.ts) decides when, this decides
// what. The system prompt is the same on every turn of a session, so the CLI's prompt
// cache keeps it; a turn carries the document only when the model has not seen this
// version of it, and then the smaller of the whole text and a diff against the last one.

import { structuredPatch } from 'diff'

export type AiMode = 'ask' | 'write'

/** Rows the user pointed at, 1-based and inclusive, with their text as it was then. */
export interface Attachment {
  start: number
  end: number
  text: string
}

/** An SVG the document embeds, shown to the model as source - it does not read SVG as an image. */
export interface SvgSource {
  /** As the document refers to it, relative to the document's folder. */
  path: string
  source: string
}

export interface Turn {
  /** The document's name, for the model to call it by. */
  name: string
  text: string
  /** The text the model saw last in this session; null when it has seen none. */
  lastSent: string | null
  svgs: readonly SvgSource[]
  attachments: readonly Attachment[]
  mode: AiMode
  /** Something the user did outside the chat since the last turn - applied or discarded a
   *  proposed change. Said once, on the turn that follows it. */
  event?: string | null
  message: string
}

/** A past exchange, replayed into a new CLI session when the old one is gone. */
export interface PastMessage {
  role: 'user' | 'assistant'
  text: string
}

export function systemPrompt(dialect: string): string {
  return `You are working with the user on one Markdown document, in the chat pane of md-boss, a Markdown editor.

## How turns arrive

* <document state="full"> is the whole document. <document state="changed"> is a unified diff against the version you saw last. No <document> block means it has not changed since.
* <selected lines="12-14"> holds rows the user pointed at. "This", "here" and "these lines" mean them.
* <image path="assets/x.svg"> is the source of an SVG the document embeds. Raster images the document embeds arrive as images.
* <mode> is ask or write.
* <event> is something the user did since your last turn, such as applying the change you proposed.

## Modes

* ask: answer questions about the document - explain, check, compare, critique. Do not draft replacement text unless asked for wording.
* write: you are shaping changes together. Suggest concrete edits and wording, show short snippets of proposed text, and push back when something is unclear or wrong.

In both modes, never ask whether to write, apply or save anything, and never offer to. The user has a Prepare change button; when they press it you will be asked for the change as edits to the document. Until then, just talk it through.

Keep replies short and conversational - this is a chat pane beside the document, not a report. Replies render as Markdown (lists, code, tables and task marks all draw), but keep formatting light.

## Proposed changes

When the user presses Prepare change, or asks for a revision while a change is proposed, answer in the structure the turn asks for: edits that replace exact excerpts of the current document, a one-line summary, and a short reply. The user sees your proposal as a diff and decides whether to apply it.

## Images

You can draw diagrams as SVG when asked, or when one clearly helps. Each is saved as assets/<kebab-name>.svg next to the document and embedded with ![alt](assets/<kebab-name>.svg). In chat, say what you would draw; the SVG itself is produced with the change.

${dialect}`
}

export function turnText(turn: Turn): string {
  const blocks: string[] = []
  const document = documentBlock(turn)
  if (document) blocks.push(document)
  for (const svg of turn.svgs) blocks.push(`<image path="${svg.path}">\n${svg.source}\n</image>`)
  for (const a of turn.attachments) {
    const lines = a.start === a.end ? `${a.start}` : `${a.start}-${a.end}`
    blocks.push(`<selected lines="${lines}">\n${a.text}\n</selected>`)
  }
  if (turn.event) blocks.push(`<event>${turn.event}</event>`)
  blocks.push(`<mode>${turn.mode}</mode>`)
  blocks.push(turn.message)
  return blocks.join('\n\n')
}

/** The conversation so far, for a new CLI session that has none of it. The turn that
 *  follows carries the whole document. */
export function transcriptText(messages: readonly PastMessage[]): string {
  if (messages.length === 0) return ''
  const lines = messages.map((m) => `<${m.role}>\n${m.text}\n</${m.role}>`)
  return `<transcript>\nOur conversation so far, from a session that was lost:\n\n${lines.join('\n\n')}\n</transcript>`
}

function documentBlock(turn: Turn): string | null {
  if (turn.lastSent === turn.text) return null
  const whole = `<document path="${turn.name}" state="full">\n${turn.text}\n</document>`
  if (turn.lastSent === null) return whole
  const diff = unifiedDiff(turn.lastSent, turn.text)
  return diff.length * 2 > turn.text.length ? whole : `<document path="${turn.name}" state="changed">\n${diff}\n</document>`
}

/** Hunks only, no file headers: the model knows which file it is. */
export function unifiedDiff(before: string, after: string): string {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 2 })
  return patch.hunks
    .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'))
    .join('\n')
}
