import detailsSource from '../components/md-details.fez?raw'
import infoSource from '../components/md-info.fez?raw'
import warningSource from '../components/md-warning.fez?raw'
import { native, type Unwatch } from '../native/bridge'

export const COMPONENTS_DIR_NAME = 'components'
export const FEZ_AGENTS_URL = 'https://github.com/dux/fez/blob/main/AGENTS.md'

export interface InstalledMarkdownComponent {
  type: string
  tag: string
  filename: string
  source: string
  info: string
  demo: string
  example: string
}

export interface ComponentDocumentation {
  info: string
  demo: string
}

const DEFAULTS = [
  { filename: 'md-info.fez', source: infoSource },
  { filename: 'md-warning.fez', source: warningSource },
  { filename: 'md-details.fez', source: detailsSource },
] as const

/** Editable Fez components installed under the config directory. The release carries their
 *  initial source inside dist; only this directory is read at runtime, never a package or
 *  network location. */
export class MarkdownComponents {
  readonly dir: string
  readonly guideURL = FEZ_AGENTS_URL
  items: InstalledMarkdownComponent[] = []
  private readonly listeners = new Set<() => void>()
  private unwatch: Unwatch | null = null

  private constructor(dir: string) {
    this.dir = dir
  }

  static async load(configDir: string): Promise<MarkdownComponents> {
    const { fs, paths } = native()
    const dir = await paths.join(configDir, COMPONENTS_DIR_NAME)
    const existed = await fs.exists(dir)
    await fs.mkdir(dir)
    if (!existed) {
      for (const component of DEFAULTS) {
        const path = await paths.join(dir, component.filename)
        await fs.write(path, component.source)
      }
    }

    const library = new MarkdownComponents(dir)
    await library.reload()
    return library
  }

  async start(): Promise<void> {
    if (this.unwatch) return
    this.unwatch = await native().watch(this.dir, () => {
      void this.reload().catch((error) => console.error('Fez components could not reload:', error))
    })
  }

  stop(): void {
    this.unwatch?.()
    this.unwatch = null
  }

  async reload(): Promise<void> {
    const { fs, paths } = native()
    const entries = await fs.list(this.dir)
    const items: InstalledMarkdownComponent[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile) continue
      const type = componentType(entry.name)
      if (!type) continue
      const path = await paths.join(this.dir, entry.name)
      const source = await fs.read(path)
      const documentation = componentDocumentation(source)
      if (!documentation) continue
      const example = componentExample(type, documentation.demo)
      if (!example) continue
      items.push({ type, tag: `md-${type}`, filename: entry.name, source, ...documentation, example })
    }
    if (JSON.stringify(items) === JSON.stringify(this.items)) return
    this.items = items
    for (const listener of this.listeners) listener()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async openFolder(): Promise<void> {
    await native().fs.mkdir(this.dir)
    await native().shell.openPath(this.dir)
  }

  starterPrompt(): string {
    return `Build a Fez component for an md-boss typed Markdown block.

Read the Fez authoring instructions first:
${FEZ_AGENTS_URL}

Work directly in this installed component directory:
${this.dir}

md-boss component rules:
* Create one lowercase kebab-case file named md-<type>.fez.
* The filename maps to both :::type Markdown and the md-type Fez tag.
* Include a non-empty <info> block describing the component and its props.
* Include a non-empty <demo> block containing a representative <md-type> example.
* The block body is already rendered Markdown. Include <slot /> where that body belongs.
* Opening-line attributes become string props. For example, title="More" is props.title.
* Use scoped <style> and theme variables such as var(--bg), var(--surface), var(--text), var(--muted), var(--border), var(--accent), and var(--alert-warning).
* Never use literal colors.
* Keep the component offline: no imports, fetches, remote assets, scripts, or Fez.head calls.
* Do not use <style global>.
* Validate during authoring with: bunx @dinoreic/fez compile ${this.dir}/md-<type>.fez

Example Markdown:
:::details title="Implementation details"
Longer optional explanation with **rendered Markdown**.
:::

Start by asking what typed block I want to build and how it should look or behave. Then create the component file and validate it.`
  }
}

/** A config filename is also author-facing Markdown syntax, so keep it portable across
 *  case-sensitive and case-insensitive filesystems. */
export function componentType(filename: string): string | null {
  const match = /^md-([a-z][a-z0-9-]*)\.fez$/.exec(filename)
  return match?.[1] ?? null
}

/** Fez keeps its documentation beside the implementation. Both blocks are required because
 *  md-boss uses them to build the installed-component gallery on the Example page. */
export function componentDocumentation(source: string): ComponentDocumentation | null {
  const info = documentationBlock(source, 'info')
  const demo = documentationBlock(source, 'demo')
  return info && demo ? { info, demo } : null
}

function documentationBlock(source: string, name: 'info' | 'demo'): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(source)
  const content = match?.[1]?.trim() ?? ''
  return content || null
}

/** Converts the representative Fez tag into the Markdown syntax md-boss readers use. */
export function componentExample(type: string, demo: string): string | null {
  const tag = `md-${type}`
  const paired = new RegExp(`^<${tag}(\\s[^>]*)?>([\\s\\S]*)<\\/${tag}>$`, 'i').exec(demo.trim())
  const empty = paired ? null : new RegExp(`^<${tag}(\\s[^>]*)?\\s*/>$`, 'i').exec(demo.trim())
  if (!paired && !empty) return null

  const attributes = (paired?.[1] ?? empty?.[1] ?? '').trim()
  const body = paired ? demoMarkdown(paired[2]) : ''
  const opening = `:::${type}${attributes ? ` ${attributes}` : ''}`
  return body ? `${opening}\n${body}\n:::` : `${opening}\n:::`
}

function demoMarkdown(source: string): string {
  return source
    .replace(/<(?:strong|b)(?:\s[^>]*)?>/gi, '**').replace(/<\/(?:strong|b)>/gi, '**')
    .replace(/<(?:em|i)(?:\s[^>]*)?>/gi, '*').replace(/<\/(?:em|i)>/gi, '*')
    .replace(/<code(?:\s[^>]*)?>/gi, '`').replace(/<\/code>/gi, '`')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<li(?:\s[^>]*)?>/gi, '- ')
    .replace(/<\/(?:p|div|li|h[1-6]|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
}
