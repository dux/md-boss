import { describe, expect, test } from 'bun:test'
import { Marked } from 'marked'
import { markedTasks } from '../src/preview/markedTasks'
import { buildPreviewPage } from '../src/preview/page'

const render = (source: string) => (new Marked({ gfm: true }, markedTasks()).parse(source) as string).replace(/\n/g, '')
const BOX = '<input class="md-mark" disabled="" type="checkbox">'
const DONE = '<input class="md-mark" checked="" disabled="" type="checkbox">'

describe('task marks in running text', () => {
  test('a box, a tick and a spinner anywhere in a paragraph', () => {
    const html = render('Buy [ ] milk, [x] bread and [X] eggs; [o] and [O] and [*] are running.')
    expect(html).toContain(`Buy ${BOX} milk, ${DONE} bread and ${DONE} eggs;`)
    expect(html.match(/class="md-spinner md-mark"/g)?.length).toBe(3)
  })

  test('in headings, table cells and quotes', () => {
    expect(render('## Launch [x]')).toBe(`<h2>Launch ${DONE}</h2>`)
    expect(render('| a | b |\n|---|---|\n| [ ] cell | [x] |')).toContain(`<td>${BOX} cell</td><td>${DONE}</td>`)
    expect(render('> [ ] quoted')).toBe(`<blockquote><p>${BOX} quoted</p></blockquote>`)
  })

  test('list items the lexer does not box: an empty task and the in-progress state', () => {
    expect(render('- [ ]')).toBe(`<ul><li>${BOX}</li></ul>`)
    expect(render('- [o] running')).toMatch(/^<ul><li><svg class="md-spinner md-mark"[^>]*>.*<\/svg> running<\/li><\/ul>$/)
  })

  test('left alone: code, an index, a link, a mark glued to other text', () => {
    expect(render('`code [ ]`')).toBe('<p><code>code [ ]</code></p>')
    expect(render('```\n[x] fenced\n```')).toContain('[x] fenced')
    expect(render('arr[x] index')).toBe('<p>arr[x] index</p>')
    expect(render('[x](https://example.com)')).toBe('<p><a href="https://example.com">x</a></p>')
    expect(render('**bold**[x]')).toBe('<p><strong>bold</strong>[x]</p>')
    expect(render('[y] is not a state')).toBe('<p>[y] is not a state</p>')
  })

  test('the preview page carries the same extension, and it stands alone', () => {
    const page = buildPreviewPage({
      markdown: '', themeCSS: '', fontSize: 17, measure: 48, baseURL: null, assetBase: '', components: [], typedBlocks: [],
    })
    expect(page).toContain(`window.mdMarkedTasks = ${markedTasks.toString()}`)
    // Evaluated on its own, with nothing from this module in scope - how the page runs it.
    const standalone = new Function(`return (${markedTasks.toString()})()`)()
    expect((new Marked(standalone).parse('[x]') as string)).toContain(DONE)
  })
})
