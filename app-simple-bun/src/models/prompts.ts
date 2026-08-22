// One-field prompts - a note's body, a rename - asked by commands that live outside the
// component tree (a shortcut, a context menu). The manager asks through this; the
// in-window prompt panel answers by installing itself as the handler. Tests install a stub.

export interface TextPromptOptions {
  title: string
  /** Shown under the title - the note's path and line. */
  message: string
  value: string
  placeholder?: string
  multiline?: boolean
  confirm?: string
}

export type TextPromptHandler = (options: TextPromptOptions) => Promise<string | null>

/** A yes/no for something the app cannot take back - Move to Trash. Return cancels: the
 *  destructive button is never one keystroke away, which is the convention everywhere else
 *  on the system. */
export interface ConfirmOptions {
  title: string
  message: string
  confirm: string
}

export type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>

/** The three-way question before unsaved edits would be lost - switching document, quitting.
 *  Save is the default, the one Return lands on; Don't Save is a click away; Escape cancels. */
export interface DiscardOptions {
  title: string
  message: string
}

export type DiscardAnswer = 'save' | 'discard' | 'cancel'

export type DiscardHandler = (options: DiscardOptions) => Promise<DiscardAnswer>

export class Prompts {
  /** Null until a panel mounts; a prompt with nobody to answer it is cancelled. */
  handler: TextPromptHandler | null = null
  confirmHandler: ConfirmHandler | null = null
  discardHandler: DiscardHandler | null = null

  /** The text entered, or null when cancelled. Single-line answers are trimmed and an empty
   *  one reads as cancel - a blank title is not a title. */
  async text(options: TextPromptOptions): Promise<string | null> {
    if (!this.handler) return null
    const answer = await this.handler(options)
    if (answer === null) return null
    if (options.multiline) return answer
    const trimmed = answer.trim()
    return trimmed === '' ? null : trimmed
  }

  /** True when the destructive button was chosen; closing the panel counts as cancel. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    if (!this.confirmHandler) return false
    return this.confirmHandler(options)
  }

  /** Save, Don't Save or Cancel; nobody to ask is cancel - unsaved edits are never dropped
   *  by default. */
  async discard(options: DiscardOptions): Promise<DiscardAnswer> {
    if (!this.discardHandler) return 'cancel'
    return this.discardHandler(options)
  }
}
