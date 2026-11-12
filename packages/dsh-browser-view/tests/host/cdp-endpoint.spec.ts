import { describe, expect, it } from 'vitest'
import { Config, effectiveConfig } from '../../src/host/config.ts'
import {
  fetchCdpVersion,
  parseCdpEndpoint,
  parseCdpWebSocketUrl,
  realBrowserConnectionError,
} from '../../src/host/cdp-endpoint.ts'

describe('real-browser configuration', () => {
  it('operator keeps the isolated browser as the default and supplies the local CDP default', () => {
    // Given no browser-view profile overrides
    // When the configuration schema resolves its defaults
    // Then real-browser mode is off, the endpoint is loopback, and pages idle out after three days
    expect(effectiveConfig(Config({}))).toEqual({
      realBrowserEnabled: false,
      cdpEndpoint: 'http://127.0.0.1:9222',
      idleCloseDays: 3,
    })
  })

  it('operator edits the idle window and the live reference reports the new value', () => {
    // Given a profile that closes idle pages after seven days
    // When the configuration resolves
    // Then the resolved window is seven, not the schema default
    expect(effectiveConfig(Config({ idleCloseDays: 7 })).idleCloseDays).toBe(7)
  })
})

describe('loopback CDP endpoints', () => {
  it.each([
    'http://127.0.0.1:9222',
    'http://localhost:9222/',
    'http://[::1]:9222',
    'http://127.1.2.3:9222',
  ])('operator accepts loopback endpoint %s', raw => {
    // Given an explicitly configured loopback HTTP origin
    // When the endpoint is parsed
    // Then its discovery document is the local /json/version URL
    expect(parseCdpEndpoint(raw).versionUrl).toContain('/json/version')
  })

  it.each([
    '',
    'localhost:9222',
    'https://127.0.0.1:9222',
    'http://0.0.0.0:9222',
    'http://10.0.0.5:9222',
    'http://example.com:9222',
    'http://127.0.0.1.evil.com:9222',
    'http://user:pw@127.0.0.1:9222',
    'http://127.0.0.1:9222/path',
    'http://127.0.0.1',
  ])('operator rejects invalid or remote endpoint %s', raw => {
    // Given a malformed, credentialed, portless, or non-loopback endpoint
    // When the endpoint is parsed
    // Then validation fails closed
    expect(() => parseCdpEndpoint(raw)).toThrow()
  })

  it('operator rejects a remote WebSocket published by a local discovery response', () => {
    // Given discovery data whose WebSocket authority is not loopback
    // When the browser WebSocket is validated
    // Then it is refused even though discovery itself was local
    expect(() => parseCdpWebSocketUrl('ws://192.168.1.20:9222/devtools/browser/id')).toThrow(/loopback/)
    expect(parseCdpWebSocketUrl('ws://127.0.0.1:9222/devtools/browser/id')).toContain('/devtools/browser/id')
  })

  it('operator validates discovery JSON and returns its loopback WebSocket', async () => {
    // Given a discovery endpoint and scripted valid and hostile responses
    // When each response is read
    // Then the valid browser is returned and the hostile WebSocket is rejected
    const endpoint = parseCdpEndpoint('http://127.0.0.1:9222')
    const version = await fetchCdpVersion(endpoint, {
      fetchImpl: async () => new Response(JSON.stringify({
        Browser: 'Chrome/140.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/id',
      }), { status: 200 }),
    })
    expect(version).toEqual({ browser: 'Chrome/140.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/id' })
    await expect(fetchCdpVersion(endpoint, {
      fetchImpl: async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://example.com:9222/devtools/browser/id' }), { status: 200 }),
    })).rejects.toThrow(/loopback/)
  })

  it('operator explains the Chrome 136 restriction and the no-fallback rule', () => {
    // Given a failed external-browser connection
    // When its operator-facing error is constructed
    // Then it names both the browser compatibility limit and the absent fallback
    const endpoint = parseCdpEndpoint('http://127.0.0.1:9222')
    expect(realBrowserConnectionError(endpoint, new Error('connection refused')).message)
      .toMatch(/Chrome 136\+.*No isolated-browser fallback was attempted/)
  })
})
