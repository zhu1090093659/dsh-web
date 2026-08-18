/**
 * The remote desktop channel — browser half: the narrow rewrite rules and
 * the install/restore behavior over a fake window.
 */
import { describe, expect, it } from 'vitest'
import {
  installRemoteChannel,
  isLoopbackHostname,
  REMOTE_API_PREFIX,
  rewritePath,
  shouldRewriteFetchPath,
  shouldRewriteWsPath,
  type ChannelWindow,
} from '../src/client/remote-channel.ts'

describe('rewrite rules', () => {
  it('classifies loopback hostnames', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.1.2.3')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('192.168.1.5')).toBe(false)
    expect(isLoopbackHostname('dsh.example.com')).toBe(false)
  })

  it('rewrites API method paths but never pair/update/events-less paths', () => {
    expect(shouldRewriteFetchPath('/api/session.list')).toBe(true)
    expect(shouldRewriteFetchPath('/api/session.export')).toBe(true)
    expect(shouldRewriteFetchPath('/api/pair/accept')).toBe(false)
    expect(shouldRewriteFetchPath('/api/update/status')).toBe(false)
    expect(shouldRewriteFetchPath('/m/api/session.list')).toBe(false)
    expect(shouldRewriteFetchPath('/assets/index.js')).toBe(false)
    expect(rewritePath('/api/session.list')).toBe(`${REMOTE_API_PREFIX}/session.list`)
  })

  it('rewrites exactly the two event-stream WebSocket paths', () => {
    expect(shouldRewriteWsPath('/api/events.mux')).toBe(true)
    expect(shouldRewriteWsPath('/api/events.host')).toBe(true)
    expect(shouldRewriteWsPath('/api/session.list')).toBe(false)
    expect(shouldRewriteWsPath('/m/api/events.mux')).toBe(false)
  })
})

/** A minimal fake window recording resolved URLs (mutation via state object). */
function makeWindow(origin = 'https://tunnel.example.com', status = 200): ChannelWindow & {
  state: {
    fetchCalls: { url: string }[]
    wsUrls: string[]
    responseStatus: number
  }
} {
  const state = {
    fetchCalls: [] as { url: string }[],
    wsUrls: [] as string[],
    responseStatus: status,
  }
  const base = `${origin}/some/page`
  const fakeFetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    const raw = typeof _input === 'string' || _input instanceof URL ? _input.toString() : _input.url
    state.fetchCalls.push({ url: new URL(raw, base).href })
    return Promise.resolve(new Response('{}', { status: state.responseStatus }))
  }) as typeof globalThis.fetch
  class FakeWebSocket {
    constructor(url: string | URL) {
      state.wsUrls.push(new URL(url.toString(), base).href)
    }
  }
  return {
    fetch: fakeFetch,
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
    location: { origin, href: base },
    state,
  }
}

describe('installRemoteChannel', () => {
  it('rewrites same-origin /api fetches and reports 403', async () => {
    const window = makeWindow('https://tunnel.example.com', 403)
    let unpaired = 0
    const restore = installRemoteChannel(window, { onUnpaired: () => { unpaired += 1 } })
    try {
      await window.fetch('/api/session.list', { method: 'POST' })
      expect(window.state.fetchCalls.map(call => call.url)).toEqual(['https://tunnel.example.com/remote/api/session.list'])
      expect(unpaired).toBe(1)
    } finally {
      restore()
    }
  })

  it('leaves pair, update, cross-origin, and non-api fetches untouched', async () => {
    const window = makeWindow()
    const restore = installRemoteChannel(window)
    try {
      await window.fetch('/api/pair/accept', { method: 'POST' })
      await window.fetch('/api/update/status')
      await window.fetch('https://evil.example.com/api/session.list')
      await window.fetch('/assets/app.js')
      expect(window.state.fetchCalls.map(call => call.url)).toEqual([
        'https://tunnel.example.com/api/pair/accept',
        'https://tunnel.example.com/api/update/status',
        'https://evil.example.com/api/session.list',
        'https://tunnel.example.com/assets/app.js',
      ])
    } finally {
      restore()
    }
  })

  it('rewrites the two event-stream WebSocket URLs only', () => {
    const window = makeWindow()
    const restore = installRemoteChannel(window)
    try {
      new window.WebSocket('wss://tunnel.example.com/api/events.mux')
      new window.WebSocket('wss://tunnel.example.com/api/events.host')
      new window.WebSocket('wss://tunnel.example.com/other/ws')
      new window.WebSocket('wss://elsewhere.example.com/api/events.mux')
      expect(window.state.wsUrls).toEqual([
        'wss://tunnel.example.com/remote/api/events.mux',
        'wss://tunnel.example.com/remote/api/events.host',
        'wss://tunnel.example.com/other/ws',
        'wss://elsewhere.example.com/api/events.mux',
      ])
    } finally {
      restore()
    }
  })

  it('restores the originals', async () => {
    const window = makeWindow()
    const originalFetch = window.fetch
    const OriginalWebSocket = window.WebSocket
    const restore = installRemoteChannel(window)
    restore()
    await window.fetch('/api/session.list')
    new window.WebSocket('wss://tunnel.example.com/api/events.mux')
    expect(window.fetch).toBe(originalFetch)
    expect(window.WebSocket).toBe(OriginalWebSocket)
    expect(window.state.fetchCalls[0].url).toBe('https://tunnel.example.com/api/session.list')
    expect(window.state.wsUrls[0]).toBe('wss://tunnel.example.com/api/events.mux')
  })
})
