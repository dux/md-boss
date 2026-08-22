import { describe, expect, test } from 'bun:test'
import { refreshIcon, rowIcon, rowIconKind } from '../src/ui/icons'

describe('rowIconKind', () => {
  test('folders follow their open state', () => {
    expect(rowIconKind('notes', true)).toBe('folder')
    expect(rowIconKind('notes', true, true)).toBe('folder-open')
  })

  test('files go by extension, unknown ones are a text page', () => {
    expect(rowIconKind('README.md', false)).toBe('markdown')
    expect(rowIconKind('a.Rmd', false)).toBe('markdown')
    expect(rowIconKind('data.csv', false)).toBe('table')
    expect(rowIconKind('settings.json', false)).toBe('json')
    expect(rowIconKind('photo.JPG', false)).toBe('image')
    expect(rowIconKind('notes.txt', false)).toBe('text')
    expect(rowIconKind('Makefile', false)).toBe('text')
  })

  test('rowIcon is one inline svg drawn in currentColor', () => {
    const svg = rowIcon('a.md', false)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('aria-hidden="true"')
  })
})

describe('refreshIcon', () => {
  test('is drawn in the same hand as the row icons', () => {
    expect(refreshIcon.startsWith('<svg ')).toBe(true)
    expect(refreshIcon).toContain('viewBox="0 0 16 16"')
    expect(refreshIcon).toContain('stroke="currentColor"')
    expect(refreshIcon).toContain('aria-hidden="true"')
  })
})
