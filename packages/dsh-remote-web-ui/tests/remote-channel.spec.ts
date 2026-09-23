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
    // WHATWG location.hostname keeps IPv6 literals bracketed.
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('192.168.1.5')).toBe(false)
    expect(isLoopbackHostname('dsh.example.com')).toBe(false)
  })

  it('rewrites fenced paths but never pair, update, settings-bridge, mobile, or asset paths', () => {
    expect(shouldRewriteFetchPath('/api/session.list')).toBe(true)
    expect(shouldRewriteFetchPath('/api/session.export')).toBe(true)
    expect(shouldRewriteFetchPath('/api/pair/accept')).toBe(false)
    expect(shouldRewriteFetchPath('/api/update/status')).toBe(false)
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
    // The sidebar's model-opened push socket (issue #1646): same family as the
    // two above, and without it sidebar_open never reaches a paired device.
    expect(shouldRewriteWsPath('/sidebar/ws/agent-opens')).toBe(true)
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
    fetchCalls: { url: string; init?: RequestInit }[]
    wsUrls: string[]
    responseStatus: number
  }
} {
  const state = {
    fetchCalls: [] as { url: string; init?: RequestInit }[],
    wsUrls: [] as string[],
    responseStatus: status,
  }
  const base = `${origin}/some/page`
  const fakeFetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    const raw = typeof _input === 'string' || _input instanceof URL ? _input.toString() : _input.url
    state.fetchCalls.push({ url: new URL(raw, base).href, init: _init })
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
    sessionStorage: { getItem: () => null },
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

  it('operator keeps a caller-owned Headers instance free of the device credential', async () => {
    // Given a paired page whose cookieless credential lives in sessionStorage.
    const window = makeWindow()
    window.sessionStorage = { getItem: () => 'dev-7' }
    const restore = installRemoteChannel(window)
    try {
      // When a caller reuses its own Headers instance for a gated fetch.
      const headers = new Headers({ 'x-caller': '1' })
      await window.fetch('/api/session.list', { method: 'POST', headers })
      // Then the credential rode a copy: the caller's instance is untouched, so
      // a later request it makes cannot leak the device credential.
      expect(headers.get('x-dsh-remote-device')).toBeNull()
      expect(headers.get('x-caller')).toBe('1')
      const sent = window.state.fetchCalls[0]?.init?.headers
      expect(sent instanceof Headers && sent.get('x-dsh-remote-device')).toBe('dev-7')
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

  it('publishes the pre-Cordis upload hook and routes it onto the gated path (issue #1580)', async () => {
    const window = makeWindow()
    window.sessionStorage = { getItem: () => 'dev-7' }
    const restore = installRemoteChannel(window)
    try {
      const hook = (window as unknown as {
        __DSH_FILE_UPLOAD__?: { fetch: (input: string | URL, init?: RequestInit) => Promise<Response> }
      }).__DSH_FILE_UPLOAD__
      expect(hook).toBeDefined()
      const body = new Blob(['bytes'])
      await hook!.fetch(new URL('https://tunnel.example.com/api/session/uploadFileBinary?sessionId=s1'), {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body,
      })
      expect(window.state.fetchCalls.map(call => call.url))
        .toEqual(['https://tunnel.example.com/remote/api/session/uploadFileBinary?sessionId=s1'])
    } finally {
      restore()
    }
  })

  it('leaves a pre-existing page-owned upload hook and other routes alone', async () => {
    const window = makeWindow() as ReturnType<typeof makeWindow> & {
      __DSH_FILE_UPLOAD__?: { fetch: () => Promise<Response> }
    }
    const existing = { fetch: () => Promise.resolve(new Response('{}')) }
    window.__DSH_FILE_UPLOAD__ = existing
    const restore = installRemoteChannel(window)
    try {
      expect(window.__DSH_FILE_UPLOAD__).toBe(existing)
      // A non-upload route never rides the hook.
      const hook = window.__DSH_FILE_UPLOAD__
      await hook!.fetch()
      expect(window.state.fetchCalls).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('retires the upload hook with the channel', async () => {
    const window = makeWindow()
    const restore = installRemoteChannel(window)
    const published = (window as unknown as { __DSH_FILE_UPLOAD__?: unknown }).__DSH_FILE_UPLOAD__
    expect(published).toBeDefined()
    restore()
    expect((window as unknown as { __DSH_FILE_UPLOAD__?: unknown }).__DSH_FILE_UPLOAD__).toBeUndefined()
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
