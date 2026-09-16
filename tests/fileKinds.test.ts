import { describe, expect, test } from 'bun:test'
import { codeLanguage } from '../src/models/fileKinds'

describe('code document languages', () => {
  test('JSON keeps its language and both YAML extensions select YAML', () => {
    expect(codeLanguage('settings.json')).toBe('json')
    expect(codeLanguage('config.yaml')).toBe('yaml')
    expect(codeLanguage('CONFIG.YML')).toBe('yaml')
    expect(codeLanguage('notes.md')).toBeNull()
  })
})
