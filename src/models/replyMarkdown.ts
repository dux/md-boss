// A Claude reply as HTML, for the AI pane. The same marked the preview runs and the same
// task marks, but the result lands in the app window itself - next to the shell bridge -
// and not in the preview's sandboxed, CSP-locked page. So nothing in it may run or reach
// out: raw HTML is shown as the text it is, a link keeps its href only for the web, mail,
// an in-page anchor or a relative path, and an image is its alt text rather than a fetch.

import { Marked, type Tokens } from 'marked'
import { markedTasks } from '../preview/markedTasks'

/** http(s), mailto, a `#fragment`, or a path with no scheme at all. */
const SAFE_HREF = /^(?:https?:|mailto:|#)|^[^:]*$/i

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const reply = new Marked({ gfm: true, breaks: false }, markedTasks(), {
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escape(text)
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens)
      if (!SAFE_HREF.test(href)) return text
      return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`
    },
    image({ href, text }: Tokens.Image) {
      return `<span class="md-image" title="${escape(href)}">${escape(text || href)}</span>`
    },
  },
})

export function renderReply(markdown: string): string {
  return reply.parse(markdown, { async: false })
}
