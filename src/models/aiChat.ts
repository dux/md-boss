// One document's AI chat: the transcript, the CLI session that remembers it, what the
// model has already been shown, and the change it has proposed. The only owner of that
// state - the pane renders it, the manager applies a proposal, the server only runs turns.
// Persisted to <tmpdir>/md-boss/chats/<sha1 of the path>.json after every change; a missing
// or unreadable file is a new chat, never an error.

import type { AiResult, AiTurn } from '../native/bridge'
import { native } from '../native/bridge'
import {
  systemPrompt, transcriptText, turnText,
  type AiMode, type Attachment, type PastMessage, type SvgSource,
} from './aiPrompt'
import {
  parseProposal, PREPARE_MESSAGE, PROPOSAL_SCHEMA, REVISE_INSTRUCTION,
  type Proposal, type ProposalStatus,
} from './aiProposal'
import { extensionOf } from './fileKinds'
import { localImages, relativePath } from './markdownLinks'
import { basename, dirname, normalizePath } from './paths'
import type { SettingsStore } from './settingsStore'

export interface ChatMessage {
  /** `error` is a turn that failed - shown in the transcript, never sent back to the model. */
  role: 'user' | 'assistant' | 'error'
  text: string
  /** A user turn's mode and the rows it pointed at. */
  mode?: AiMode
  attachments?: Attachment[]
  /** A user turn that was the Prepare change button rather than something typed. */
  prepare?: boolean
  /** An answer that proposed a change. */
  proposal?: Proposal
}

export interface ChatSession {
  path: string
  /** The CLI session holding the conversation; null before the first answer. */
  claudeSessionId: string | null
  /** The document as the model saw it last, so the next turn can send only the change. */
  lastSentText: string | null
  /** Images already shown to the model in this session. */
  sentImages: string[]
  mode: AiMode
  /** What the next turn tells the model happened meanwhile - a proposal applied or dropped. */
  event: string | null
  messages: ChatMessage[]
}

/** `preparing` is a turn that answers with a proposal: nothing streams, the card arrives whole. */
export type ChatState = 'idle' | 'streaming' | 'preparing'

/** What a turn may carry, so one busy document cannot make a turn huge. */
export const MAX_IMAGES_PER_TURN = 10
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_SVG_CHARS = 50_000
/** What the model reads as an image (server/claude.ts); SVG goes as source instead. */
const RASTER_IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export interface ChatDeps {
  settings: SettingsStore
  /** The md-boss Markdown the system prompt describes (aiStart.ts markdownDialect). */
  dialect: () => string
}

interface Ask {
  attachments: Attachment[]
  mode: AiMode
  message: string
}

export class AIChat {
  private _session: ChatSession
  private _state: ChatState = 'idle'
  private _streaming = ''
  private _attachments: Attachment[] = []
  private turn: AiTurn | null = null
  private saving: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  private constructor(
    private readonly file: string,
    session: ChatSession,
    private readonly deps: ChatDeps,
  ) {
    this._session = session
  }

  static async open(path: string, deps: ChatDeps): Promise<AIChat> {
    const file = await sessionFile(path)
    let session = emptySession(path)
    try {
      if (await native().fs.exists(file)) session = parseSession(await native().fs.read(file), path) ?? session
    } catch {
      // unreadable is the same as none
    }
    return new AIChat(file, session, deps)
  }

  get session(): Readonly<ChatSession> {
    return this._session
  }

  get state(): ChatState {
    return this._state
  }

  /** The reply as it arrives; empty between turns. */
  get streaming(): string {
    return this._streaming
  }

  /** Rows waiting to go with the next message. */
  get attachments(): readonly Attachment[] {
    return this._attachments
  }

  /** The change waiting for Apply or Discard. A message in Write mode revises it. */
  get pending(): Proposal | null {
    for (let i = this._session.messages.length - 1; i >= 0; i--) {
      const proposal = this._session.messages[i].proposal
      if (proposal) return proposal.status === 'pending' ? proposal : null
    }
    return null
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setMode(mode: AiMode): void {
    if (this._session.mode === mode) return
    this._session.mode = mode
    this.changed()
  }

  /** The same rows twice is one chip. */
  attach(attachment: Attachment): void {
    if (this._attachments.some((a) => a.start === attachment.start && a.end === attachment.end)) return
    this._attachments = [...this._attachments, attachment].sort((a, b) => a.start - b.start)
    this.emit()
  }

  detach(index: number): void {
    this._attachments = this._attachments.filter((_, i) => i !== index)
    this.emit()
  }

  /** A new conversation: the transcript and the CLI session go, the mode stays. */
  reset(): void {
    this.stop()
    this._session = { ...emptySession(this._session.path), mode: this._session.mode }
    this._attachments = []
    this.changed()
  }

  stop(): void {
    this.turn?.stop()
  }

  /** One turn about `document`, the text as it is in the editor now. In Write mode with a
   *  change proposed, the message revises that change. */
  async send(message: string, document: string): Promise<void> {
    const text = message.trim()
    if (!text || this._state !== 'idle') return
    const revising = this._session.mode === 'write' && this.pending !== null
    const ask = revising ? `${text}\n\n${REVISE_INSTRUCTION}` : text
    await this.exchange({ role: 'user', text }, ask, document, revising)
  }

  /** Prepare change: the conversation so far as a proposed revision of `document`. */
  async prepare(document: string): Promise<void> {
    if (this._state !== 'idle' || this._session.mode !== 'write' || this.pending) return
    await this.exchange({ role: 'user', text: 'Prepare change', prepare: true }, PREPARE_MESSAGE, document, true)
  }

  /** The pending change went into the document, which now reads as `document`. */
  markApplied(document: string): void {
    if (!this.settle('applied', 'The user applied your proposed change; the document now reads as you proposed.')) return
    // The model wrote this text, so it has seen it: the next turn sends nothing about it.
    this._session.lastSentText = document
    this.changed()
  }

  discard(): void {
    if (this.settle('discarded', 'The user discarded your proposed change.')) this.changed()
  }

  private settle(status: ProposalStatus, event: string): boolean {
    const pending = this.pending
    if (!pending || this._state !== 'idle') return false
    pending.status = status
    this._session.event = event
    return true
  }

  private async exchange(row: ChatMessage, message: string, document: string, proposing: boolean): Promise<void> {
    const history = pastMessages(this._session.messages)
    const ask: Ask = { attachments: this._attachments, mode: this._session.mode, message }
    this._attachments = []
    this._session.messages.push({ ...row, mode: ask.mode, attachments: ask.attachments })
    this._state = proposing ? 'preparing' : 'streaming'
    this._streaming = ''
    this.changed()

    let result = await this.run(document, ask, '', proposing)
    if (result.outcome.kind === 'error' && result.outcome.reason === 'no-session') {
      // The CLI no longer has the session: start one that is told everything again.
      this._session.claudeSessionId = null
      this._session.lastSentText = null
      this._session.sentImages = []
      this._streaming = ''
      result = await this.run(document, ask, transcriptText(history), proposing)
    }
    await this.finish(result.outcome, document, result.sent, proposing)
  }

  private async run(document: string, ask: Ask, preamble: string, proposing: boolean): Promise<{ outcome: AiResult; sent: string[] }> {
    const { settings, dialect } = this.deps
    const images = await this.images(document)
    const body = turnText({
      name: basename(this._session.path),
      text: document,
      lastSent: this._session.lastSentText,
      svgs: images.svgs,
      event: this._session.event,
      ...ask,
    })
    this.turn = native().ai.run({
      resume: this._session.claudeSessionId,
      systemPrompt: systemPrompt(dialect()),
      text: preamble ? `${preamble}\n\n${body}` : body,
      images: images.raster,
      schema: proposing ? PROPOSAL_SCHEMA : null,
      model: settings.data.aiModel,
      claudePath: settings.data.claudePath,
    }, (delta) => {
      this._streaming += delta
      this.emit()
    })
    const outcome = await this.turn.result
    this.turn = null
    return { outcome, sent: images.sent }
  }

  private async finish(outcome: AiResult, document: string, sent: string[], proposing: boolean): Promise<void> {
    const partial = this._streaming
    this._streaming = ''
    if (outcome.kind === 'error') {
      this._session.messages.push({ role: 'error', text: errorText(outcome.reason, outcome.message) })
    } else if (outcome.kind === 'stopped' && proposing) {
      // A stopped Prepare leaves nothing behind - and the change it would have revised stays.
    } else if (proposing && outcome.kind === 'done') {
      const answer = parseProposal(outcome.structured)
      if (!answer) {
        this._session.messages.push({ role: 'error', text: 'The proposed change came back incomplete. Try again.' })
      } else {
        const pending = this.pending
        if (pending) pending.status = 'superseded'
        const images = await Promise.all(answer.images.map(async (image) => ({ ...image, replaces: await this.inAssets(image.name) })))
        this._session.messages.push({
          role: 'assistant',
          text: answer.reply,
          proposal: { summary: answer.summary, document: answer.document, images, base: document, status: 'pending' },
        })
      }
    } else {
      const reply = outcome.kind === 'done' ? outcome.text : partial
      if (reply) this._session.messages.push({ role: 'assistant', text: reply })
    }
    if (outcome.kind !== 'error' && outcome.sessionId) {
      this._session.claudeSessionId = outcome.sessionId
      this._session.lastSentText = document
      this._session.sentImages = [...new Set([...this._session.sentImages, ...sent])]
      this._session.event = null
    }
    this._state = 'idle'
    this.changed()
  }

  private async inAssets(name: string): Promise<boolean> {
    try {
      return await native().fs.exists(`${dirname(this._session.path)}/assets/${name}`)
    } catch {
      return false
    }
  }

  /** The document's local images the model has not been shown in this session, within the
   *  turn's limits. A missing or oversized one is left for a later turn to try again. */
  private async images(document: string): Promise<{ raster: string[]; svgs: SvgSource[]; sent: string[] }> {
    const { fs } = native()
    const dir = dirname(this._session.path)
    const raster: string[] = []
    const svgs: SvgSource[] = []
    const sent: string[] = []
    for (const path of localImages(document, dir)) {
      if (sent.length >= MAX_IMAGES_PER_TURN) break
      const extension = extensionOf(path)
      if (this._session.sentImages.includes(path) || (extension !== 'svg' && !RASTER_IMAGES.has(extension))) continue
      try {
        if (extension === 'svg') {
          const source = await fs.read(path)
          if (source.length > MAX_SVG_CHARS) continue
          svgs.push({ path: relativePath(dir, path), source })
        } else {
          if ((await fs.stat(path)).size > MAX_IMAGE_BYTES) continue
          raster.push(path)
        }
        sent.push(path)
      } catch {
        // not there (yet)
      }
    }
    return { raster, svgs, sent }
  }

  private changed(): void {
    this.emit()
    void this.save()
  }

  /** Writes queue behind each other, so the file always ends up as the last state. */
  private save(): Promise<void> {
    const text = JSON.stringify(this._session)
    this.saving = this.saving.then(async () => {
      const { fs } = native()
      await fs.mkdir(dirname(this.file))
      await fs.write(this.file, text)
    }).catch(() => {})
    return this.saving
  }

  /** Settles once every pending write has landed - for quitting, and for tests. */
  flushed(): Promise<void> {
    return this.saving
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export async function sessionFile(path: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(normalizePath(path)))
  const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${await native().paths.temp()}/chats/${hash}.json`
}

function emptySession(path: string): ChatSession {
  return { path, claudeSessionId: null, lastSentText: null, sentImages: [], mode: 'write', event: null, messages: [] }
}

/** Null when the file is not a session for `path` - a hash collision or a corrupt file. A
 *  proposal that does not read whole is dropped from its message rather than trusted. */
export function parseSession(text: string, path: string): ChatSession | null {
  let raw: Partial<ChatSession>
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw.path !== path || !Array.isArray(raw.messages)) return null
  return {
    path,
    claudeSessionId: typeof raw.claudeSessionId === 'string' ? raw.claudeSessionId : null,
    lastSentText: typeof raw.lastSentText === 'string' ? raw.lastSentText : null,
    sentImages: Array.isArray(raw.sentImages) ? raw.sentImages.filter((p) => typeof p === 'string') : [],
    mode: raw.mode === 'ask' ? 'ask' : 'write',
    event: typeof raw.event === 'string' ? raw.event : null,
    messages: raw.messages
      .filter((m) => m && typeof m.text === 'string' && ['user', 'assistant', 'error'].includes(m.role))
      .map((m) => (m.proposal && !isProposal(m.proposal) ? { ...m, proposal: undefined } : m)),
  }
}

function isProposal(p: Proposal): boolean {
  return typeof p.document === 'string' && typeof p.base === 'string' && typeof p.summary === 'string'
    && Array.isArray(p.images) && ['pending', 'applied', 'discarded', 'superseded'].includes(p.status)
}

/** A proposal replays as its reply and its summary - the whole document it carried was
 *  either applied, and so is the document, or it was not. */
function pastMessages(messages: readonly ChatMessage[]): PastMessage[] {
  return messages.flatMap((m): PastMessage[] => {
    if (m.role === 'error') return []
    const text = m.proposal ? `${m.text}\n\n[Proposed change, ${m.proposal.status}: ${m.proposal.summary}]` : m.text
    return [{ role: m.role, text }]
  })
}

function errorText(reason: 'no-claude' | 'no-session' | 'failed', message: string): string {
  if (reason === 'no-claude') {
    return 'Claude Code was not found. Install it from https://claude.com/claude-code, or set "claudePath" in settings.json.'
  }
  return message
}
