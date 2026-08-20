import { describe, expect, it } from 'vitest'
import { deviceNameFromUserAgent } from '../src/client/device-name.ts'

describe('deviceNameFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36', 'Windows · Chrome'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.3 Safari/605.1.15', 'macOS · Safari'],
    ['Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1', 'iOS · Safari'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/151.0.0.0', 'Windows · Edge'],
  ])('labels %s as %s', (userAgent, expected) => {
    expect(deviceNameFromUserAgent(userAgent)).toBe(expected)
  })

  it('returns no label for an absent or unrecognized User-Agent', () => {
    expect(deviceNameFromUserAgent()).toBeUndefined()
    expect(deviceNameFromUserAgent('Custom Client')).toBeUndefined()
  })
})
