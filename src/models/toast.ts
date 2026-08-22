// Transient messages, from anywhere in the app: `manager.toast.info('Copied')`. The port of
// Toast.swift - one message on screen at a time, the newest replacing whatever was up,
// gone on its own after a few seconds or on a click. Models, menu commands and the
// preview bridge all need to say something to the user and none of them can reach a view,
// which is why this is a model with listeners and not view state.

export type ToastKind = 'info' | 'success' | 'error'

/** A button in the message - "Restart to update". Clicking it runs this and dismisses. */
export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastMessage {
  /** Distinct per message, so the same text twice still reads as a new message. */
  id: number
  text: string
  kind: ToastKind
  /** Present on a message that asks for a decision. Such a message has no timer: it stays
   *  until it is clicked or a newer message replaces it - the clock does not decide. */
  action?: ToastAction
}

/** How long a message stays. An error gets twice the time: it is the one worth reading. */
export const TOAST_MS: Record<ToastKind, number> = { info: 3_000, success: 3_000, error: 6_000 }

/** Timers, injectable so a test can run the clock by hand. */
export interface ToastTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: ToastTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class Toast {
  current: ToastMessage | null = null
  private seq = 0
  private dismissal: unknown = null
  private readonly listeners = new Set<(message: ToastMessage | null) => void>()

  constructor(private readonly timers: ToastTimers = realTimers) {}

  /** The text on screen, or null - what a test asks. */
  get text(): string | null {
    return this.current?.text ?? null
  }

  info(text: string, action?: ToastAction): void {
    this.show(text, 'info', action)
  }

  success(text: string, action?: ToastAction): void {
    this.show(text, 'success', action)
  }

  error(text: string, action?: ToastAction): void {
    this.show(text, 'error', action)
  }

  /** A click on the message, or a test. Nothing up is nothing to do. */
  dismiss(): void {
    this.cancelDismissal()
    if (!this.current) return
    this.current = null
    this.emit()
  }

  onChange(listener: (message: ToastMessage | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private show(text: string, kind: ToastKind, action?: ToastAction): void {
    this.cancelDismissal()
    const message: ToastMessage = action ? { id: ++this.seq, text, kind, action } : { id: ++this.seq, text, kind }
    this.current = message
    this.emit()
    if (action) return
    this.dismissal = this.timers.set(() => {
      // A newer message has its own timer; this one is for `message` only.
      if (this.current !== message) return
      this.dismissal = null
      this.current = null
      this.emit()
    }, TOAST_MS[kind])
  }

  private cancelDismissal(): void {
    if (this.dismissal === null) return
    this.timers.clear(this.dismissal)
    this.dismissal = null
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current)
  }
}
