// One document's AI chat: the transcript, the CLI session that remembers it, and what the
// model has already been shown. The only owner of that state - the pane renders it, the
// server only runs turns. Persisted to <tmpdir>/md-boss/chats/<sha1 of the path>.json after
// every change; a missing or unreadable file is a new chat, never an error.

import type { AiResult, AiTurn } from '../native/bridge'
import { native } from '../native/bridge'
import {
  systemPrompt, transcriptText, turnText,
  type AiMode, type Attachment, type PastMessage, type SvgSource,
} from './aiPrompt'
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
  messages: ChatMessage[]
}

export type ChatState = 'idle' | 'streaming'

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

  /** One turn about `document`, the text as it is in the editor now. */
  async send(message: string, document: string): Promise<void> {
    const text = message.trim()
    if (!text || this._state !== 'idle') return
    const history = pastMessages(this._session.messages)
    const attachments = this._attachments
    const mode = this._session.mode
    this._attachments = []
    this._session.messages.push({ role: 'user', text, mode, attachments })
    this._state = 'streaming'
    this._streaming = ''
    this.changed()

    let result = await this.run(document, { attachments, mode, message: text }, '')
    if (result.outcome.kind === 'error' && result.outcome.reason === 'no-session') {
      // The CLI no longer has the session: start one that is told everything again.
      this._session.claudeSessionId = null
      this._session.lastSentText = null
      this._session.sentImages = []
      this._streaming = ''
      result = await this.run(document, { attachments, mode, message: text }, transcriptText(history))
    }
    this.finish(result.outcome, document, result.sent)
  }

  private async run(
    document: string,
    ask: { attachments: Attachment[]; mode: AiMode; message: string },
    preamble: string,
  ): Promise<{ outcome: AiResult; sent: string[] }> {
    const { settings, dialect } = this.deps
    const images = await this.images(document)
    const body = turnText({
      name: basename(this._session.path),
      text: document,
      lastSent: this._session.lastSentText,
      svgs: images.svgs,
      ...ask,
    })
    this.turn = native().ai.run({
      resume: this._session.claudeSessionId,
      systemPrompt: systemPrompt(dialect()),
      text: preamble ? `${preamble}\n\n${body}` : body,
      images: images.raster,
      schema: null,
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

  private finish(outcome: AiResult, document: string, sent: string[]): void {
    const partial = this._streaming
    this._state = 'idle'
    this._streaming = ''
    if (outcome.kind === 'error') {
      this._session.messages.push({ role: 'error', text: errorText(outcome.reason, outcome.message) })
    } else {
      const reply = outcome.kind === 'done' ? outcome.text : partial
      if (reply) this._session.messages.push({ role: 'assistant', text: reply })
      if (outcome.sessionId) {
        this._session.claudeSessionId = outcome.sessionId
        this._session.lastSentText = document
        this._session.sentImages = [...new Set([...this._session.sentImages, ...sent])]
      }
    }
    this.changed()
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
  return { path, claudeSessionId: null, lastSentText: null, sentImages: [], mode: 'write', messages: [] }
}

/** Null when the file is not a session for `path` - a hash collision or a corrupt file. */
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
    messages: raw.messages.filter((m) => m && typeof m.text === 'string' && ['user', 'assistant', 'error'].includes(m.role)),
  }
}

function pastMessages(messages: readonly ChatMessage[]): PastMessage[] {
  return messages.flatMap((m) => (m.role === 'error' ? [] : [{ role: m.role, text: m.text }]))
}

function errorText(reason: 'no-claude' | 'no-session' | 'failed', message: string): string {
  if (reason === 'no-claude') {
    return 'Claude Code was not found. Install it from https://claude.com/claude-code, or set "claudePath" in settings.json.'
  }
  return message
}
