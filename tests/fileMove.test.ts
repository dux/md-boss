import { beforeEach, describe, expect, test } from 'bun:test'
import { documentName } from '../src/models/fileKinds'
import { checkMove, checkRename, moveMessage, renameMessage } from '../src/models/fileMove'
import { isUnder } from '../src/models/paths'
import { installNative } from '../src/native/bridge'
import { memoryNative } from '../src/native/memory'

const root = '/work'
const at = (p: string) => `${root}/${p}`
const fixture = (files: Record<string, string>) =>
  installNative(memoryNative(Object.fromEntries(Object.entries(files).map(([k, v]) => [at(k), v]))))

describe('file move checks', () => {
  test('a file already in that folder is a no-op, not an error', async () => {
    fixture({ 'a.md': '# a' })
    const refusal = await checkMove(at('a.md'), root)
    expect(refusal).toBe('sameFolder')
    expect(moveMessage(refusal!, at('a.md'), root)).toBeNull()
  })

  test('a name already taken at the destination refuses before anything is touched', async () => {
    fixture({ 'a.md': '# a', 'sub/a.md': '# other' })
    expect(await checkMove(at('a.md'), at('sub'))).toBe('exists')
    expect(moveMessage('exists', at('a.md'), at('sub'))).toBe('sub already has a a.md')
  })

  test('folders are refused - their contents would each need repointing', async () => {
    fixture({ 'sub/a.md': '# a', 'other/b.md': '# b' })
    expect(await checkMove(at('sub'), at('other'))).toBe('notAFile')
  })

  test('a destination that is a file, or gone, is refused', async () => {
    fixture({ 'a.md': '# a', 'b.md': '# b' })
    expect(await checkMove(at('a.md'), at('b.md'))).toBe('badDestination')
    expect(await checkMove(at('gone.md'), root)).toBe('missingSource')
  })

  test('a legal move refuses nothing', async () => {
    fixture({ 'a.md': '# a', 'sub/b.md': '# b' })
    expect(await checkMove(at('a.md'), at('sub'))).toBeNull()
  })

  test('containment is on path boundaries', () => {
    expect(isUnder('/work/notes/a.md', '/work/notes')).toBe(true)
    expect(isUnder('/work/notes', '/work/notes')).toBe(true)
    expect(isUnder('/work/notes-old/a.md', '/work/notes')).toBe(false)
  })
})

describe('file rename checks', () => {
  beforeEach(() => fixture({ 'a.md': '# a', 'b.md': '# b', 'plan.md': '# p', 'sub/c.md': '# c' }))

  test('the name it already has is a no-op, not an error', async () => {
    const refusal = await checkRename(at('a.md'), 'a.md')
    expect(refusal).toBe('unchanged')
    expect(renameMessage(refusal!, at('a.md'), 'a.md')).toBeNull()
  })

  test.each(['', '.', '..', '.hidden.md', 'sub/a.md', 'a:b.md', 'a\\b.md'])('%p is not a file name', async (name) => {
    expect(await checkRename(at('a.md'), name)).toBe('badName')
    expect(renameMessage('badName', at('a.md'), name)).toBe(`${name} is not a file name`)
  })

  test('a name already taken in the folder refuses before anything is touched', async () => {
    expect(await checkRename(at('a.md'), 'b.md')).toBe('exists')
    expect(renameMessage('exists', at('a.md'), 'b.md')).toBe('work already has a b.md')
  })

  test('changing only the case of a name is a rename, not a collision', async () => {
    expect(await checkRename(at('plan.md'), 'Plan.md')).toBeNull()
  })

  test('folders are refused, a gone source is refused, a legal rename is not', async () => {
    expect(await checkRename(at('sub'), 'other')).toBe('notAFile')
    expect(await checkRename(at('gone.md'), 'b.md')).toBe('missingSource')
    expect(await checkRename(at('a.md'), 'z.md')).toBeNull()
  })

  test('a typed name without a document extension becomes markdown', () => {
    expect(documentName('plan')).toBe('plan.md')
    expect(documentName('plan.txt')).toBe('plan.txt')
    expect(documentName('archive.tar.gz')).toBe('archive.tar.gz.md')
  })
})
