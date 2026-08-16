import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isLoopbackAddress, isLoopbackHostname, isLoopbackRequest } from '../host/loopback.ts'

/** Minimal IncomingMessage stand-in: a socket address, a Host header, and optional extra headers. */
function fakeRequest(
  remoteAddress: string | undefined,
  host: string | undefined,
  extra: Record<string, string | undefined> = {},
): IncomingMessage {
  return { socket: { remoteAddress }, headers: { host, ...extra } } as unknown as IncomingMessage
}

describe('isLoopbackAddress', () => {
  it('accepts the full IPv4 127/8 range plus IPv6 loopback and IPv4-mapped forms', () => {
    for (const address of ['127.0.0.1', '127.0.0.2', '127.255.255.255', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(address)).toBe(true)
    }
  })

  it('rejects non-loopback and malformed addresses', () => {
    for (const address of ['128.0.0.1', '10.0.0.1', '127.999.0.1']) {
      expect(isLoopbackAddress(address)).toBe(false)
    }
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

describe('isLoopbackHostname', () => {
  it('accepts localhost, bracketed IPv6 loopback and 127/8 hostnames', () => {
    for (const hostname of ['localhost', '[::1]', '127.0.0.2']) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  it('rejects non-loopback hostnames', () => {
    for (const hostname of ['example.com', '192.168.1.1']) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })
})

describe('isLoopbackRequest', () => {
  it('passes a loopback socket with a loopback Host header', () => {
    expect(isLoopbackRequest(fakeRequest('127.0.0.1', '127.0.0.1:3000'))).toBe(true)
  })

  it('rejects a non-loopback socket even with a loopback Host', () => {
    expect(isLoopbackRequest(fakeRequest('192.168.1.20', '127.0.0.1:3000'))).toBe(false)
  })

  it('rejects cross-site fetches', () => {
    expect(isLoopbackRequest(fakeRequest('127.0.0.1', '127.0.0.1:3000', { 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('rejects a mismatched origin', () => {
    expect(isLoopbackRequest(fakeRequest('127.0.0.1', '127.0.0.1:3000', { origin: 'http://evil.example' }))).toBe(false)
  })

  it('passes when no origin header is present', () => {
    const request = fakeRequest('127.0.0.1', 'localhost:3000')
    expect(request.headers.origin).toBeUndefined()
    expect(isLoopbackRequest(request)).toBe(true)
  })

  it('rejects an unparsable Host header', () => {
    expect(isLoopbackRequest(fakeRequest('127.0.0.1', '127.0.0.1:notaport'))).toBe(false)
  })
})
