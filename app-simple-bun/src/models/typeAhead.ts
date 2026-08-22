// Type-a-name-to-jump: letters and digits typed in quick succession build a prefix, a
// pause starts over. Time is passed in rather than read, so the reset is testable.

export const TYPE_AHEAD_RESET_MS = 700

export class TypeAhead {
  private prefix = ''
  private lastAt = -Infinity

  /** Appends one typed character and returns the prefix to look for, or null when the
   *  character is not one that names a file - punctuation and control keys are somebody
   *  else's, and must not swallow a pending prefix either. */
  append(character: string, now: number): string | null {
    if (!isNameCharacter(character)) return null
    if (now - this.lastAt > TYPE_AHEAD_RESET_MS) this.prefix = ''
    this.lastAt = now
    this.prefix += character.toLowerCase()
    return this.prefix
  }

  reset(): void {
    this.prefix = ''
    this.lastAt = -Infinity
  }
}

/** One letter or digit in any script, the way Swift's `isLetter || isNumber` reads it. */
export function isNameCharacter(character: string): boolean {
  return [...character].length === 1 && /^[\p{L}\p{N}]$/u.test(character)
}
