import { describe, expect, test } from 'bun:test'
import { buildPreviewPage, jsLiteral } from '../src/preview/page'

describe('the Markdown preview page', () => {
  test('carries packaged Fez, installed component source and parsed typed blocks', () => {
    const page = buildPreviewPage({
      markdown: ':::info\nUseful.\n:::',
      themeCSS: ':root { --bg: white; }',
      fontSize: 17,
      measure: 48,
      baseURL: null,
      assetBase: '',
      components: [{
        type: 'info',
        tag: 'md-info',
        filename: 'info.fez',
        source: '<style>display: block;</style>\n<slot />\n',
        info: 'Information.',
        demo: '<md-info>Useful.</md-info>',
        example: ':::info\nUseful.\n:::',
      }],
      typedBlocks: [{ type: 'info', attributes: {}, openLine: 1, closeLine: 3 }],
    })

    expect(page).toContain('Fez.compile("md-info"')
    expect(page).toContain('display: block;')
    expect(page).toContain('"openLine":1,"closeLine":3')
    expect(page).toContain('window.Fez')
  })

  test('allows local Fez compilation without allowing document-authored inline scripts', () => {
    const page = buildPreviewPage({
      markdown: '',
      themeCSS: '',
      fontSize: 17,
      measure: 48,
      baseURL: null,
      assetBase: '',
      components: [],
      typedBlocks: [],
    })
    const policy = /Content-Security-Policy" content="([^"]+)/.exec(page)?.[1] ?? ''
    const scripts = /script-src ([^;]+)/.exec(policy)?.[1] ?? ''

    expect(scripts).toContain("'nonce-")
    expect(scripts).toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(policy).toContain("connect-src 'none'")
  })

  test('script-safe escaping does not corrupt packaged regular expressions', () => {
    const page = buildPreviewPage({
      markdown: '</script>',
      themeCSS: '',
      fontSize: 17,
      measure: 48,
      baseURL: null,
      assetBase: '',
      components: [],
      typedBlocks: [],
    })

    expect(jsLiteral('</script>')).toBe('"<\\/script>"')
    expect(page).toContain('/>\\s+</g')
    expect(page).not.toContain('/>\\s+<\\/g')
  })

  test('carries the one-shot task celebration and reduced-motion guard', () => {
    const page = buildPreviewPage({
      markdown: '- [x] done',
      themeCSS: '',
      fontSize: 17,
      measure: 48,
      baseURL: null,
      assetBase: '',
      components: [],
      typedBlocks: [],
    })

    expect(page).toContain('function celebrateTasks(indexes)')
    expect(page).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(page).toContain('var count = 20')
    expect(page).toContain('md-confetti-ring')
    expect(page).toContain('md-confetti-pop')
  })

  test('carries the automatic contents policy and its themed presentation', () => {
    const page = buildPreviewPage({
      markdown: '# Guide\n\n## One\n\n### Detail\n\n## Two',
      themeCSS: '',
      fontSize: 17,
      measure: 48,
      baseURL: null,
      assetBase: '',
      components: [],
      typedBlocks: [],
    })

    expect(page).toContain('function insertContents()')
    expect(page).toContain("querySelectorAll('h2, h3')")
    expect(page).toContain('if (h2Count < 2 && h3Count < 2) { return; }')
    expect(page).toContain("nav.setAttribute('aria-label', 'Contents')")
    expect(page).toContain("assignSlugs();\n    insertContents();")
    expect(page).toContain('.md-toc-h3 { padding-left: 1.25em; }')
    expect(page).toContain('.md-toc a { color: var(--muted);')
  })
})
