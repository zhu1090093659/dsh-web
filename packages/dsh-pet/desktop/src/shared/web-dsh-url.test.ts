import { describe, expect, it } from 'vitest'

import { DEFAULT_WEB_DSH_URL, normalizeWebDshUrl } from './web-dsh-url.ts'

describe('Web DSH URL validation', () => {
  it('normalizes local HTTP and HTTPS origins', () => {
    expect(normalizeWebDshUrl(' http://127.0.0.1:3080/ ')).toBe(DEFAULT_WEB_DSH_URL)
    expect(normalizeWebDshUrl('https://localhost:8443')).toBe('https://localhost:8443')
    expect(normalizeWebDshUrl('http://[::1]:3080/')).toBe('http://[::1]:3080')
  })

  it('rejects credentials, paths, remote hosts, and executable protocols', () => {
    expect(() => normalizeWebDshUrl('http://user:secret@127.0.0.1:3080')).toThrow('invalid Web DSH URL')
    expect(() => normalizeWebDshUrl('http://127.0.0.1:3080/private')).toThrow('invalid Web DSH URL')
    expect(() => normalizeWebDshUrl('http://192.168.1.20:3080')).toThrow('invalid Web DSH URL')
    expect(() => normalizeWebDshUrl('file:///tmp/dsh')).toThrow('invalid Web DSH URL')
  })
})
