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

export class Prompts {
  /** Null until a panel mounts; a prompt with nobody to answer it is cancelled. */
  handler: TextPromptHandler | null = null

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
}
