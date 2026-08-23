// The Insert menu as data: every construct the preview draws, written as the text that
// makes it. Pure - the rows are a list here, the raw pane turns a pick into one
// transaction, and the `/` that opens a line filters this same list rather than owning a
// second one of its own.

/** Where the caret lands in a snippet. Stripped before the text reaches the document. */
export const CARET = '\u0000'

export interface Insertion {
  id: string
  label: string
  /** The text to put in, carrying exactly one CARET. */
  snippet: string
  /** What else you might type looking for it - the `/` filter reads these as well as the
   *  label, so `todo` finds a task and `h1` a heading. */
  terms: string
}

export type InsertRow = Insertion | { separator: true }

const alert = (kind: string, label: string): Insertion => ({
  id: `alert-${kind.toLowerCase()}`,
  label,
  snippet: `> [!${kind}]\n> ${CARET}`,
  terms: 'alert info block callout',
})

/** The catalogue, in the order the menu draws it. Separators are the groups; a filtered
 *  list drops them. */
export const INSERT_MENU: InsertRow[] = [
  { id: 'heading-1', label: 'Heading 1', snippet: `# ${CARET}`, terms: 'h1 title' },
  { id: 'heading-2', label: 'Heading 2', snippet: `## ${CARET}`, terms: 'h2' },
  { id: 'heading-3', label: 'Heading 3', snippet: `### ${CARET}`, terms: 'h3' },
  { separator: true },
  { id: 'task', label: 'Task', snippet: `- [ ] ${CARET}`, terms: 'todo checkbox unchecked' },
  { id: 'task-doing', label: 'Task in progress', snippet: `- [o] ${CARET}`, terms: 'todo doing spinner' },
  { id: 'task-done', label: 'Task done', snippet: `- [x] ${CARET}`, terms: 'todo checked' },
  { separator: true },
  { id: 'bullet', label: 'Bullet list', snippet: `- ${CARET}`, terms: 'unordered item' },
  { id: 'ordered', label: 'Numbered list', snippet: `1. ${CARET}`, terms: 'ordered item' },
  { id: 'quote', label: 'Quote', snippet: `> ${CARET}`, terms: 'blockquote' },
  { separator: true },
  alert('NOTE', 'Note'),
  alert('TIP', 'Tip'),
  alert('IMPORTANT', 'Important'),
  alert('WARNING', 'Warning'),
  alert('CAUTION', 'Caution'),
  { separator: true },
  { id: 'table', label: 'Table', snippet: `| ${CARET} |  |\n|---|---|\n|  |  |`, terms: 'columns grid' },
  { id: 'code', label: 'Code block', snippet: '```' + CARET + '\n\n```', terms: 'fence pre language' },
  { id: 'rule', label: 'Horizontal rule', snippet: `---\n${CARET}`, terms: 'divider line hr' },
  { separator: true },
  { id: 'link', label: 'Link', snippet: `[${CARET}]()`, terms: 'url href' },
  { id: 'image', label: 'Image', snippet: `![${CARET}]()`, terms: 'picture figure' },
]

export function isSeparator(row: InsertRow): row is { separator: true } {
  return 'separator' in row
}

/** Letters and digits only, so `codeblock` finds "Code block" and `h1` "Heading 1". */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The menu for what has been typed after the `/`. An empty query is the whole list,
 *  groups and all; anything else is the matches alone - a separator between two rows that
 *  are no longer neighbours draws a division that is not there. */
export function insertRows(query: string): InsertRow[] {
  const wanted = normalize(query)
  if (!wanted) return INSERT_MENU
  return INSERT_MENU.filter(
    (row): row is Insertion => !isSeparator(row) && normalize(`${row.label} ${row.terms}`).includes(wanted),
  )
}

export interface InsertEdit {
  /** Document offsets the text replaces. */
  from: number
  to: number
  text: string
  /** Where the caret lands, as a document offset. */
  caret: number
}

/** Where an insertion goes, given the line it was asked for. A line with nothing on it
 *  takes the snippet; a line with text keeps it and the snippet opens the line below, on
 *  one newline the way Return does - a task added under a task stays in the same list.
 *  `consume` is the column a `/` query runs to, and swallows it. */
export function insertEdit(line: { from: number; text: string }, snippet: string, consume: number | null): InsertEdit {
  const marker = snippet.indexOf(CARET)
  const text = snippet.replace(CARET, '')
  const caret = marker < 0 ? text.length : marker
  if (consume !== null) return { from: line.from, to: line.from + consume, text, caret: line.from + caret }
  if (line.text.trim() === '') {
    return { from: line.from, to: line.from + line.text.length, text, caret: line.from + caret }
  }
  const end = line.from + line.text.length
  return { from: end, to: end, text: `\n${text}`, caret: end + 1 + caret }
}

/** What has been typed after a `/` that opens a line, or null when the caret is not in
 *  one. Nothing but indentation may come before the slash - one inside a sentence, or a
 *  path, is prose - and the query stops being one as soon as it stops looking like a word. */
export function slashQuery(text: string, column: number): string | null {
  const opening = /^\s*\//.exec(text)
  if (!opening) return null
  const start = opening[0].length
  if (column < start) return null
  const query = text.slice(start, column)
  return /^[\p{L}\p{N}]*$/u.test(query) ? query : null
}
