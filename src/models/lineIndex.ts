// Where every line of a block of text starts, as UTF-16 offsets. Built once per edit and
// searched by bisection - scroll sync asks on every scroll frame, and a linear scan per
// frame on a long file is what this replaces. Lines are split on `\n` only: every line
// number the app stores - notes, Copy Path with Line - is counted that way, so a lone `\r`
// or a U+2028 must not silently shift the numbering.

export interface LineRange {
  start: number
  end: number
}

export class LineIndex {
  /** Offset of the first character of each line. Always starts with 0, so the empty string
   *  is one line, and a text ending in `\n` has an empty last line. */
  private readonly starts: number[]
  /** Total length in UTF-16 units, which is also the end of the last line. */
  readonly length: number

  constructor(text: string) {
    const starts = [0]
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 0x0a) starts.push(i + 1)
    }
    this.starts = starts
    this.length = text.length
  }

  get count(): number {
    return this.starts.length
  }

  /** 1-based number of the line containing `offset`. */
  lineAt(offset: number): number {
    const clamped = Math.min(Math.max(0, offset), this.length)
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.starts[mid] <= clamped) low = mid
      else high = mid - 1
    }
    return low + 1
  }

  /** The 1-based line's range, trailing newline included. */
  rangeOfLine(line: number): LineRange | null {
    if (line < 1 || line > this.starts.length) return null
    const start = this.starts[line - 1]
    const end = line < this.starts.length ? this.starts[line] : this.length
    return { start, end }
  }
}
