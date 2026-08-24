// The example page: one document carrying every construct the preview renders, with a note
// on each. Shipped in the binary rather than written once at install, because it is a system
// page - picking Example lays it down again, so what you read is always the version this
// build knows how to render.

import exampleMarkdown from './exampleDoc.md?raw'
import type { InstalledMarkdownComponent } from './markdownComponents'

/** Under the config dir, so the example is a root like any other and the tree, the search
 *  and the asset allowance all work on it with no special case. */
export const EXAMPLE_DIR_NAME = 'example'
export const EXAMPLE_FILE_NAME = 'Markdown Example.md'

/** The page itself. */
export const exampleText = exampleMarkdown

/** The system page plus live documentation from every valid component in the config
 *  folder. The same typed Markdown is shown as source and rendered immediately below. */
export function exampleTextWithComponents(components: readonly InstalledMarkdownComponent[]): string {
  if (components.length === 0) return exampleText
  const gallery = components.map((component) => [
    `### \`:::${component.type}\``,
    '',
    component.info,
    '',
    '```md',
    component.example,
    '```',
    '',
    component.example,
  ].join('\n')).join('\n\n')

  return `${exampleText.trimEnd()}\n\n## Installed Fez component demos\n\n` +
    'Generated from the required `<info>` and `<demo>` blocks in the installed `.fez` files.\n\n' +
    `${gallery}\n`
}
