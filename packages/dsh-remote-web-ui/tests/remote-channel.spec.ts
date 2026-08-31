/**
 * The remote desktop channel — browser half: the narrow rewrite rules and
 * the install/restore behavior over a fake window.
 */
import { describe, expect, it } from 'vitest'
import {
  channelTransition,
  installRemoteChannel,
  isLoopbackHostname,
  remoteChannelRequired,
  isUnpairedDenied,
  REMOTE_API_PREFIX,
  rewriteRawUrl,
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

  it('rewrites fenced paths but never pair, update, desktop-launcher, settings-bridge, mobile, or asset paths', () => {
    expect(shouldRewriteFetchPath('/api/session.list')).toBe(true)
    expect(shouldRewriteFetchPath('/api/session.export')).toBe(true)
    expect(shouldRewriteFetchPath('/api/pair/accept')).toBe(false)
    expect(shouldRewriteFetchPath('/api/update/status')).toBe(false)
    expect(shouldRewriteFetchPath('/api/dsh-desktop-launcher/shutdown')).toBe(false)
    expect(shouldRewriteFetchPath('/api/dsh-desktop-launcher/create')).toBe(false)
    expect(shouldRewriteFetchPath('/api/dsh-web-ui-settings/describe')).toBe(false)
    expect(shouldRewriteFetchPath('/api/dsh-web-ui-settings/mutate')).toBe(false)
    expect(shouldRewriteFetchPath('/sidebar/api/fs.tree')).toBe(true)
    expect(shouldRewriteFetchPath('/git/api/status')).toBe(true)
    expect(shouldRewriteFetchPath('/pet/whale/sprite.webp')).toBe(true)
    expect(shouldRewriteFetchPath('/m/api/session.list')).toBe(false)
    expect(shouldRewriteFetchPath('/assets/index.js')).toBe(false)
    expect(rewritePath('/api/session.list')).toBe(`${REMOTE_API_PREFIX}/session.list`)
  })

  it('rewrites exactly the registered WebSocket paths', () => {
    // 0.1.2-alpha.2: the official client opens ONE stream socket (the Typert
    // gateway mux); the legacy /api/events.* paths no longer exist.
    expect(shouldRewriteWsPath('/api/remote.mux')).toBe(true)
    expect(shouldRewriteWsPath('/api/events.mux')).toBe(false)
    expect(shouldRewriteWsPath('/api/events.host')).toBe(false)
    expect(shouldRewriteWsPath('/sidebar/ws/terminal')).toBe(true)
    expect(shouldRewriteWsPath('/sidebar/ws/agent-terminals')).toBe(true)
    expect(shouldRewriteWsPath('/api/dsh-ssh/terminal')).toBe(true)
    expect(shouldRewriteWsPath('/api/session.list')).toBe(false)
    expect(shouldRewriteWsPath('/m/api/remote.mux')).toBe(false)
  })

  it('preserves relative URL shape, query, and hash', () => {
    expect(rewriteRawUrl('/pet/a.png?v=1#sprite', 'https://tunnel.example.com/page', 'https://tunnel.example.com'))
      .toBe('/remote/pet/a.png?v=1#sprite')
    expect(rewriteRawUrl('https://elsewhere.example.com/pet/a.png', 'https://tunnel.example.com/page', 'https://tunnel.example.com'))
      .toBe('https://elsewhere.example.com/pet/a.png')
  })

  it('uses the host policy while remote settings are unavailable (issue #905)', () => {
    const unavailable = { status: 'unavailable' as const }
    expect(remoteChannelRequired('192.168.1.5', unavailable, undefined)).toBe(true)
    expect(remoteChannelRequired('192.168.1.5', unavailable, false)).toBe(false)
    expect(remoteChannelRequired('192.168.1.5', unavailable, true)).toBe(true)
    expect(remoteChannelRequired('127.0.0.1', unavailable, true)).toBe(false)
    expect(remoteChannelRequired('192.168.1.5', {
      status: 'ready',
      value: { enabled: true, requirePairingForLan: false },
    }, true)).toBe(false)
  })

  it('decides the channel lifecycle transitions (issue #808)', () => {
    expect(channelTransition(true, false)).toBe('install')
    expect(channelTransition(false, true)).toBe('retire')
    expect(channelTransition(true, true)).toBe('none')
    expect(channelTransition(false, false)).toBe('none')
  })
})

const UNPAIRED_ENVELOPE = JSON.stringify({
  type: 'server-response',
  rpcId: 'invalid-request',
  result: { ok: false, error: { code: 'unpaired', message: 'this device is not paired with the desktop' } },
})
const FORBIDDEN_ENVELOPE = JSON.stringify({
  type: 'server-response',
  rpcId: 'rpc-1',
  result: { ok: false, error: { code: 'forbidden', message: 'loopback-only' } },
})

/** A minimal fake window recording resolved URLs (mutation via state object). */
function makeWindow(origin = 'https://tunnel.example.com', body = '{}', status = 200): ChannelWindow & {
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
    return Promise.resolve(new Response(body, { status: state.responseStatus, headers: { 'content-type': 'application/json' } }))
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
  it('rewrites same-origin /api fetches and reports unpaired 403', async () => {
    const window = makeWindow('https://tunnel.example.com', UNPAIRED_ENVELOPE, 403)
    let unpaired = 0
    let paired = 0
    const restore = installRemoteChannel(window, {
      onUnpaired: () => { unpaired += 1 },
      onPaired: () => { paired += 1 },
    })
    try {
      await window.fetch('/api/session.list', { method: 'POST' })
      expect(window.state.fetchCalls.map(call => call.url)).toEqual(['https://tunnel.example.com/remote/api/session.list'])
      expect(unpaired).toBe(1)
      expect(paired).toBe(0)
    } finally {
      restore()
    }
  })

  it('does not treat a loopback-only 403 as unpaired', async () => {
    const window = makeWindow('https://tunnel.example.com', FORBIDDEN_ENVELOPE, 403)
    let unpaired = 0
    let paired = 0
    const restore = installRemoteChannel(window, {
      onUnpaired: () => { unpaired += 1 },
      onPaired: () => { paired += 1 },
    })
    try {
      await window.fetch('/api/host.dialog', { method: 'POST' })
      expect(unpaired).toBe(0)
      expect(paired).toBe(1)
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

  it('rewrites the gateway stream mux and the registered WebSocket paths only', () => {
    const window = makeWindow()
    const restore = installRemoteChannel(window)
    try {
      // The official gateway mux is the one stream socket every Remote stream
      // rides on; without this rewrite the phone's workspace/session feeds die.
      new window.WebSocket('wss://tunnel.example.com/api/remote.mux')
      new window.WebSocket('wss://tunnel.example.com/api/events.mux')
      new window.WebSocket('wss://tunnel.example.com/sidebar/ws/terminal?workspace=w-1')
      new window.WebSocket('wss://tunnel.example.com/api/dsh-ssh/terminal')
      new window.WebSocket('wss://tunnel.example.com/other/ws')
      new window.WebSocket('wss://elsewhere.example.com/api/remote.mux')
      expect(window.state.wsUrls).toEqual([
        'wss://tunnel.example.com/remote/api/remote.mux',
        'wss://tunnel.example.com/api/events.mux',
        'wss://tunnel.example.com/remote/sidebar/ws/terminal?workspace=w-1',
        'wss://tunnel.example.com/remote/api/dsh-ssh/terminal',
        'wss://tunnel.example.com/other/ws',
        'wss://elsewhere.example.com/api/remote.mux',
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
    new window.WebSocket('wss://tunnel.example.com/api/remote.mux')
    expect(window.fetch).toBe(originalFetch)
    expect(window.WebSocket).toBe(OriginalWebSocket)
    expect(window.state.fetchCalls[0].url).toBe('https://tunnel.example.com/api/session.list')
    expect(window.state.wsUrls[0]).toBe('wss://tunnel.example.com/api/remote.mux')
  })
})

describe('isUnpairedDenied', () => {
  it('keys off the unpaired envelope code, not every 403', async () => {
    expect(await isUnpairedDenied(new Response(UNPAIRED_ENVELOPE, { status: 403 }))).toBe(true)
    expect(await isUnpairedDenied(new Response(FORBIDDEN_ENVELOPE, { status: 403 }))).toBe(false)
    expect(await isUnpairedDenied(new Response('{}', { status: 200 }))).toBe(false)
  })
})
