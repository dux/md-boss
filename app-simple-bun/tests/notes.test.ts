import { describe, expect, test } from 'bun:test'
import {
  NOTE_SCOPES, deduplicated, expandPath, fold, noteId, noteIsEmpty, noteLabel, noteTooltip, note,
  parseAnnotationFile, partitionNotes, removingPath, repointing, scopeIsCollapsible,
  serializeAnnotationFile, storePath, suggestedTitle,
} from '../src/models/notes'

describe('note titles', () => {
  test('markdown markers and punctuation are stripped', () => {
    expect(suggestedTitle('## The **plan**, revisited!')).toBe('The plan revisited')
    expect(suggestedTitle('- [ ] ship it')).toBe('ship it')
    expect(suggestedTitle('`code()` here')).toBe('code here')
  })

  test('indentation and runs of separators collapse to single spaces', () => {
    expect(suggestedTitle('      deep    indent\t\tand tabs')).toBe('deep indent and tabs')
    expect(suggestedTitle('snake_case-and-dashes')).toBe('snake case and dashes')
  })

  test('the result is capped at 40 characters and never ends mid-space', () => {
    const title = suggestedTitle('abcde '.repeat(20))
    expect(title.length).toBeLessThanOrEqual(40)
    expect(title.endsWith(' ')).toBe(false)
  })

  test('a line with nothing quotable yields an empty title', () => {
    expect(suggestedTitle('---')).toBe('')
    expect(suggestedTitle('   ')).toBe('')
    expect(suggestedTitle('')).toBe('')
  })

  test('digits survive', () => {
    expect(suggestedTitle('# 2026 plan')).toBe('2026 plan')
  })
})

describe('note hover text and identity', () => {
  test('the body is what a hover has to say, or the note announces itself', () => {
    expect(noteTooltip(note('~/a.md', 7, 'The plan', 'revisit this'))).toBe('revisit this')
    expect(noteTooltip(note('~/a.md', 7, 'The plan'))).toBe('Note on line 7')
  })

  test('a note is empty only when both fields are', () => {
    expect(noteIsEmpty(note('~/a.md', 1, 'Named'))).toBe(false)
    expect(noteIsEmpty(note('~/a.md', 1, '', 'Written'))).toBe(false)
    expect(noteIsEmpty(note('~/a.md', 1))).toBe(true)
    expect(noteIsEmpty(note('~/a.md', 1, '', '  \n '))).toBe(true)
  })

  test('identity is path plus line, so one note per line', () => {
    expect(noteId(note('~/a.md', 1, 'One'))).toBe(noteId(note('~/a.md', 1, 'Different')))
    expect(noteId(note('~/a.md', 1, 'One'))).not.toBe(noteId(note('~/a.md', 2, 'One')))
  })
})

describe('annotation paths', () => {
  test('paths under home are stored tilde-abbreviated and round-trip back', () => {
    const stored = storePath('/Users/me/dev/notes/plan.md', '/Users/me')
    expect(stored).toBe('~/dev/notes/plan.md')
    expect(expandPath(stored, '/Users/me')).toBe('/Users/me/dev/notes/plan.md')
  })

  test('a path outside home is stored absolute', () => {
    expect(storePath('/tmp/notes/plan.md', '/Users/me')).toBe('/tmp/notes/plan.md')
    expect(storePath('/Users/meow/x.md', '/Users/me')).toBe('/Users/meow/x.md')
  })
})

describe('annotation file', () => {
  test('the current shape decodes', () => {
    const file = parseAnnotationFile('{"notes":[{"path":"~/a.md","line":3,"title":"Third","body":"Why"}]}')
    expect(file.notes).toEqual([note('~/a.md', 3, 'Third', 'Why')])
  })

  test('a bookmark written by an older build becomes a note with only a title', () => {
    const file = parseAnnotationFile('{"bookmarks":[{"path":"~/a.md","line":3,"title":"Third"}]}')
    expect(file.notes).toEqual([note('~/a.md', 3, 'Third', '')])
  })

  test('a comment written by an older build becomes a note with only a body', () => {
    const file = parseAnnotationFile('{"comments":[{"path":"~/a.md","line":8,"body":"Needs a test."}]}')
    expect(file.notes).toEqual([note('~/a.md', 8, '', 'Needs a test.')])
    expect(noteLabel(file.notes[0])).toBe('Needs a test.')
  })

  test('a bookmark and a comment on the same line fold into one note', () => {
    const file = parseAnnotationFile(
      '{"bookmarks":[{"path":"~/a.md","line":26,"title":"Tables"}],"comments":[{"path":"~/a.md","line":26,"body":"Check the alignment."}]}',
    )
    expect(file.notes).toEqual([note('~/a.md', 26, 'Tables', 'Check the alignment.')])
  })

  test('old and new keys in one file merge rather than one winning', () => {
    const file = parseAnnotationFile(
      '{"notes":[{"path":"~/a.md","line":1,"title":"One"}],"bookmarks":[{"path":"~/a.md","line":2,"title":"Two"}],"comments":[{"path":"~/a.md","line":3,"body":"Three"}]}',
    )
    expect(file.notes.map((n) => n.line)).toEqual([1, 2, 3])
  })

  test('an empty or broken object decodes to an empty file', () => {
    expect(parseAnnotationFile('{}').notes).toEqual([])
    expect(parseAnnotationFile('nope').notes).toEqual([])
    expect(parseAnnotationFile('{"notes":[{"path":1}]}').notes).toEqual([])
  })

  test('encoding writes only the current key and leaves empty fields out', () => {
    const text = serializeAnnotationFile(parseAnnotationFile('{"bookmarks":[{"path":"~/a.md","line":3,"title":"Third"}]}'))
    expect(text).toContain('"notes"')
    expect(text).not.toContain('"bookmarks"')
    expect(text).toContain('"title"')
    expect(text).not.toContain('"body"')
  })

  test('encoding round-trips, keeps slashes unescaped, sorts keys', () => {
    const file = { notes: [note('~/dev/notes/plan.md', 42, 'Rebuild the index'), note('~/dev/notes/plan.md', 88, '', 'Needs a test.\nReally.')] }
    const text = serializeAnnotationFile(file)
    expect(text).toContain('~/dev/notes/plan.md')
    expect(text).not.toContain('\\/')
    expect(text.indexOf('"line"')).toBeLessThan(text.indexOf('"path"'))
    expect(parseAnnotationFile(text)).toEqual(file)
  })
})

describe('note scopes', () => {
  const home = '/Users/me'
  const mk = (path: string, line = 1) => note(path, line, '', 'body')
  const partition = (all: ReturnType<typeof mk>[], file: string | null = '/work/notes/open.md', activeRoot: string | null = '/work/notes') =>
    partitionNotes(all, file, activeRoot, ['/work/notes', '/work/other'], home)
  const placed = (r: Record<string, unknown[]>) => Object.values(r).reduce((n, list) => n + list.length, 0)

  test('a note on the open file lands in thisFile and nowhere else', () => {
    const r = partition([mk('/work/notes/open.md', 5)])
    expect(r.thisFile).toHaveLength(1)
    expect(r.thisProject).toHaveLength(0)
    expect(r.allProjects).toHaveLength(0)
  })

  test('another file inside the active folder lands in thisProject', () => {
    const r = partition([mk('/work/notes/deep/other.md')])
    expect(r.thisProject).toHaveLength(1)
    expect(r.thisFile).toHaveLength(0)
  })

  test('a file in a different recent folder lands in allProjects', () => {
    const r = partition([mk('/work/other/notes.md')])
    expect(r.allProjects).toHaveLength(1)
    expect(r.thisProject).toHaveLength(0)
  })

  test('a folder outside the recent list, or a prefix sibling, contributes nothing', () => {
    expect(placed(partition([mk('/work/archived/old.md')]))).toBe(0)
    expect(placed(partition([mk('/work/notes-old/a.md')]))).toBe(0)
  })

  test('with no file open, everything in the active folder is thisProject', () => {
    const r = partition([mk('/work/notes/a.md')], null)
    expect(r.thisFile).toHaveLength(0)
    expect(r.thisProject).toHaveLength(1)
  })

  test('with no active folder, every recent folder is allProjects', () => {
    const r = partition([mk('/work/notes/a.md'), mk('/work/other/b.md')], null, null)
    expect(r.thisProject).toHaveLength(0)
    expect(r.allProjects).toHaveLength(2)
  })

  test('the open file wins even when it sits inside the active folder', () => {
    const r = partition([mk('/work/notes/open.md', 2), mk('/work/notes/open.md', 1), mk('/work/notes/sibling.md')])
    expect(r.thisFile).toHaveLength(2)
    expect(r.thisProject).toHaveLength(1)
  })

  test('each scope comes back sorted by path then line, and every scope is present', () => {
    const r = partition([mk('/work/notes/b.md', 3), mk('/work/notes/a.md', 9), mk('/work/notes/a.md', 2)])
    expect(r.thisProject.map(noteId)).toEqual(['/work/notes/a.md:2', '/work/notes/a.md:9', '/work/notes/b.md:3'])
    expect(Object.keys(partition([])).sort()).toEqual([...NOTE_SCOPES].sort())
  })

  test('tilde-stored paths are expanded against home', () => {
    const r = partitionNotes([mk('~/notes/a.md')], null, '/Users/me/notes', ['/Users/me/notes'], home)
    expect(r.thisProject).toHaveLength(1)
  })

  test('only the two wider scopes fold', () => {
    expect(scopeIsCollapsible('thisFile')).toBe(false)
    expect(scopeIsCollapsible('thisProject')).toBe(true)
    expect(scopeIsCollapsible('allProjects')).toBe(true)
  })
})

describe('repointing and removing', () => {
  const file = { notes: [note('~/work/a.md', 3, 'Third'), note('~/work/a.md', 9, '', 'Ninth'), note('~/work/b.md', 1, 'Other')] }

  test('every note on the moved file follows it, and nothing else does', () => {
    const split = repointing(file, '~/work/a.md', '~/work/sub/a.md')!
    expect(split.moved.map((n) => n.path)).toEqual(['~/work/sub/a.md', '~/work/sub/a.md'])
    expect(split.moved.map((n) => n.line)).toEqual([3, 9])
    expect(split.moved.map((n) => n.title)).toEqual(['Third', ''])
    expect(split.kept.notes.map((n) => n.path)).toEqual(['~/work/b.md'])
  })

  test('a file with nothing on the moved path is not rewritten at all', () => {
    expect(repointing(file, '~/work/gone.md', '~/work/sub/gone.md')).toBeNull()
  })

  test('landing on a line that already has a note folds rather than duplicates', () => {
    const split = repointing(file, '~/work/a.md', '~/work/b.md')!
    const folded = fold([...split.kept.notes, ...split.moved])
    expect(folded).toHaveLength(3)
    expect(folded.filter((n) => n.line === 1)).toHaveLength(1)
  })

  test('removing drops every note on the file, and nothing else', () => {
    const kept = removingPath(file, '~/work/a.md')!
    expect(kept.notes.map((n) => n.path)).toEqual(['~/work/b.md'])
    expect(removingPath({ notes: [note('~/work/a.md', 1)] }, '~/work/a.md')!.notes).toEqual([])
    expect(removingPath(file, '~/work/gone.md')).toBeNull()
  })
})

describe('one note per line across stores', () => {
  const split = {
    '~/.config/md-boss/annotations.json': { notes: [note('~/work/a.md', 3, 'Third', 'written first')] },
    '~/work/.md-boss': { notes: [note('~/work/a.md', 3, '', 'written again'), note('~/work/a.md', 9, 'Ninth')] },
  }

  test('a line with a record in two stores comes back with one', () => {
    const all = Object.values(deduplicated(split)).flatMap((f) => f.notes)
    expect(all.filter((n) => noteId(n) === '~/work/a.md:3')).toHaveLength(1)
    expect(all).toHaveLength(2)
  })

  test('the first store by path keeps it, and the other copy folds in', () => {
    const healed = deduplicated(split)
    const kept = healed['~/.config/md-boss/annotations.json'].notes[0]
    expect(kept).toEqual(note('~/work/a.md', 3, 'Third', 'written first'))
    expect(healed['~/work/.md-boss'].notes.map((n) => n.line)).toEqual([9])
  })

  test('a contested note goes to the store that owns its document', () => {
    const healed = deduplicated(split, () => '~/work/.md-boss')
    expect(healed['~/work/.md-boss'].notes.map((n) => n.line)).toEqual([3, 9])
    expect(healed['~/work/.md-boss'].notes[0].body).toBe('written first')
    expect(healed['~/.config/md-boss/annotations.json'].notes).toEqual([])
  })

  test('a home that holds no copy is ignored, and an uncontested note never moves', () => {
    const absent = deduplicated(split, () => '~/elsewhere/.md-boss')
    expect(absent['~/elsewhere/.md-boss']).toBeUndefined()
    expect(absent['~/.config/md-boss/annotations.json'].notes.map((n) => n.line)).toEqual([3])
    const stay = deduplicated(split, () => '~/.config/md-boss/annotations.json')
    expect(stay['~/work/.md-boss'].notes.map((n) => n.line)).toEqual([9])
  })

  test('an emptied store still comes back, clean stores are untouched, identity is path plus line', () => {
    const healed = deduplicated({
      '~/a/.md-boss': { notes: [note('~/x.md', 1, 'One')] },
      '~/b/.md-boss': { notes: [note('~/x.md', 1, '', 'dupe')] },
    })
    expect(healed['~/b/.md-boss'].notes).toEqual([])
    const clean = { '~/a/.md-boss': { notes: [note('~/a/x.md', 1, 'One')] }, '~/b/.md-boss': { notes: [note('~/b/y.md', 1, 'Two')] } }
    expect(deduplicated(clean)).toEqual(clean)
    const two = deduplicated({ '~/a/.md-boss': { notes: [note('~/a/x.md', 4, 'X'), note('~/a/y.md', 4, 'Y')] } })
    expect(two['~/a/.md-boss'].notes).toHaveLength(2)
  })
})
