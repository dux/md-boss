import { describe, expect, test } from 'bun:test'
import { renderReply } from '../src/models/replyMarkdown'

describe('reply markdown', () => {
  test('renders Markdown, task marks included', () => {
    const html = renderReply('**Yes.** Two steps:\n\n- [x] first\n- [o] second\n\n`code` and a [ ] box.')
    expect(html).toContain('<strong>Yes.</strong>')
    expect(html).toContain('<li><input checked="" disabled="" type="checkbox"> first</li>')
    expect(html).toContain('class="md-spinner md-mark"')
    expect(html).toContain('<code>code</code> and a <input class="md-mark" disabled="" type="checkbox"> box.')
  })

  test('raw HTML is shown, never run', () => {
    const html = renderReply('<img src=x onerror="alert(1)">\n\ninline <script>alert(2)</script> too')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  test('only web, mail, anchor and relative links keep their href', () => {
    expect(renderReply('[site](https://example.com)')).toContain('<a href="https://example.com">site</a>')
    expect(renderReply('[mail](mailto:a@b.c)')).toContain('href="mailto:a@b.c"')
    expect(renderReply('[step](#step-2)')).toContain('href="#step-2"')
    expect(renderReply('[doc](./other.md)')).toContain('href="./other.md"')
    const bad = renderReply('[click](javascript:alert(1)) and <javascript:alert(2)>')
    expect(bad).not.toContain('href')
    expect(bad).toContain('click')
  })

  test('an image is its alt text, not a fetch', () => {
    const html = renderReply('![the flow](assets/flow.svg)')
    expect(html).not.toContain('<img')
    expect(html).toContain('<span class="md-image" title="assets/flow.svg">the flow</span>')
  })
})
