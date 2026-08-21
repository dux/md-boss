import { describe, expect, test } from 'bun:test'
import { platformFromUserAgent, revealLabel } from '../src/models/platform'

describe('platform', () => {
  test('the three webviews are told apart by their user agents', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe('macos')
    expect(platformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe('windows')
    expect(platformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('linux')
    expect(platformFromUserAgent('')).toBe('linux')
  })

  test('the reveal item is named the way each OS names the thing', () => {
    expect(revealLabel('macos')).toBe('Reveal in Finder')
    expect(revealLabel('windows')).toBe('Show in Explorer')
    expect(revealLabel('linux')).toBe('Show in File Manager')
  })
})
