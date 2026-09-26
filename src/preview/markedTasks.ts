// Task marks anywhere in running text, as a marked extension: `[ ]`, `[x]` / `[X]` (done)
// and `[o]` / `[O]` / `[*]` (in progress) in a paragraph, a heading, a table cell or a
// list item draw the same box or spinner a task list does. Code spans and fences are the
// lexer's already, so a mark inside one stays text.
//
// A mark needs air on both sides - the start of the text, a space or `(` before it, and
// the end, a space or punctuation after - so `arr[x]` stays an index and `[x](url)` a link.
//
// Used twice: the AI pane's replies import it, and the preview page inlines its source with
// Function.prototype.toString (page.ts). So the function must stay self-contained - it may
// not reach for anything outside its own body, not even a module-level constant.

import type { MarkedExtension, Tokens } from 'marked'

export function markedTasks(): MarkedExtension {
  const MARK = /^\[([ xXoO*])\](?=$|[\s.,;:!?)])/
  const SPINNER = '<svg class="md-spinner md-mark" viewBox="0 0 16 16" role="img" aria-label="in progress">'
    + '<circle class="md-spinner-track" cx="8" cy="8" r="6.4"></circle>'
    + '<path class="md-spinner-head" d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4"></path></svg>'
  return {
    extensions: [{
      name: 'taskMark',
      level: 'inline',
      start(src: string) {
        const at = src.search(/\[[ xXoO*]\]/)
        return at < 0 ? undefined : at
      },
      tokenizer(src: string, tokens: { raw: string }[]) {
        const match = MARK.exec(src)
        if (!match) return undefined
        const before = tokens.length ? tokens[tokens.length - 1].raw.slice(-1) : ''
        if (before && !/[\s(]/.test(before)) return undefined
        return { type: 'taskMark', raw: match[0], state: match[1] }
      },
      renderer(token: Tokens.Generic) {
        const state = String(token.state)
        if ('oO*'.includes(state)) return SPINNER
        return `<input class="md-mark" ${state === ' ' ? '' : 'checked="" '}disabled="" type="checkbox">`
      },
    }],
  }
}
