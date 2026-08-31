/**
 * Boot-patch tests (issue #987): the parse-time inline script must decide
 * rewrites exactly like the browser patch (client/remote-channel.ts), seat
 * the adoption hooks, and restore cleanly. Runs the generated script against
 * a fake window — no browser needed.
 */
import { describe, expect, it } from 'vitest'

import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'

import { BOOT_WATCHDOG_KEY, buildBootWatchdogScript, buildRemoteChannelBootScript, REMOTE_CHANNEL_BOOT_SCRIPT } from '../src/remote-channel-boot.ts'
import { REMOTE_CHANNEL_BOOT_GLOBAL, type RemoteChannelBootSeat } from '../src/remote-channel-rules.ts'
import { shouldRewriteFetchPath, shouldRewriteWsPath } from '../src/client/remote-channel.ts'

const PATH_MATRIX = [
  '/api/session.list',
  '/api/remote.mux',
  '/api/pair/accept',
  '/api/update/status',
  '/api/dsh-desktop-launcher/shutdown',
  '/api/dsh-web-ui-settings/mutate',
  '/sidebar/api/fs.tree',
  '/sidebar',
  '/git/api/status',
  '/git',
  '/pet/whale/sprite.webp',
  '/pet',
  '/assets/index.js',
]

const WS_MATRIX = [
  '/api/remote.mux',
  '/sidebar/ws/terminal',
  '/sidebar/ws/agent-terminals',
  '/api/dsh-ssh/terminal',
  '/api/events.mux',
  '/api/session.list',
]

interface FakeWindow {
  fetch: (input: unknown, init?: unknown) => Promise<Response>
  WebSocket: unknown
  EventSource?: unknown
  location: { origin: string; href: string; hostname: string }
  sessionStorage: { getItem(key: string): string | null }
  [REMOTE_CHANNEL_BOOT_GLOBAL]?: RemoteChannelBootSeat
  calls: string[]
  initSeen: Array<Record<string, any> | undefined>
  wsUrls: string[]
  response: () => Response
}

function makeWindow(hostname = '192.168.1.20', port = '3080'): FakeWindow {
  const origin = `http://${hostname}:${port}`
  const win: FakeWindow = {
    location: { origin, href: `${origin}/`, hostname },
    calls: [],
    initSeen: [],
    wsUrls: [],
    sessionStorage: { getItem: () => null },
    response: () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    fetch(input: unknown, init?: unknown) {
      const raw = typeof input === 'string' || input instanceof URL ? input.toString() : (input as Request).url
      win.calls.push(new URL(raw, win.location.href).href)
      win.initSeen.push((init ?? undefined) as Record<string, any> | undefined)
      return Promise.resolve(win.response())
    },
    WebSocket: class {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      constructor(url: unknown) {
        win.wsUrls.push(new URL(String(url), win.location.href).href)
      }
    },
  }
  return win
}

/** Evaluate the generated script against the fake window. */
function boot(win: FakeWindow, script = buildRemoteChannelBootScript()): void {
  new Function('window', script)(win)
}

describe('remote channel boot patch (issue #987)', () => {
  it('contains no script-closing sequence and embeds the live rules', () => {
    const script = buildRemoteChannelBootScript()
    expect(script).not.toContain('</script')
    expect(script).toContain('/api/pair/')
    // The gateway stream mux must be embedded: the workspace/session streams
    // ride that one socket.
    expect(script).toContain('/api/remote.mux')
  })

  it('renders into the head ahead of the module scripts (parse-time install)', () => {
    const html = '<html><head><script type="module" src="/assets/index.js"></script></head><body></body></html>'
    const rendered = renderIndexInjections(html, [{ kind: 'script', placement: 'head', text: REMOTE_CHANNEL_BOOT_SCRIPT }])
    const bootAt = rendered.indexOf('__DSH_REMOTE_CHANNEL_BOOT__')
    const moduleAt = rendered.indexOf('type="module"')
    expect(bootAt).toBeGreaterThan(-1)
    expect(bootAt).toBeLessThan(moduleAt)
  })

  it('attaches the cookieless device credential to gated fetches and ws handshakes', async () => {
    const win = makeWindow()
    win.sessionStorage = { getItem: () => 'dev-42' }
    boot(win)
    await win.fetch('/api/session.list', { headers: { accept: 'application/json' } })
    expect(win.calls[0]).toContain('/remote/api/session.list')
    const headers = win.initSeen[0]?.headers ?? {}
    expect(headers['x-dsh-remote-device']).toBe('dev-42')
    expect(headers.accept).toBe('application/json')
    new (win.WebSocket as unknown as new (url: string) => void)('ws://192.168.1.20:3080/api/remote.mux')
    expect(win.wsUrls[0]).toContain('/remote/api/remote.mux?device=dev-42')
  })

  it('does nothing on loopback origins', () => {
    for (const hostname of ['localhost', '127.0.0.1', '127.1.2.3']) {
      const win = makeWindow(hostname)
      const originalFetch = win.fetch
      boot(win)
      expect(win.fetch).toBe(originalFetch)
      expect(win[REMOTE_CHANNEL_BOOT_GLOBAL]).toBeUndefined()
    }
  })

  it('rewrites fetch paths exactly like the browser patch', async () => {
    const win = makeWindow()
    boot(win)
    for (const path of PATH_MATRIX) {
      await win.fetch(path, { method: 'POST' })
    }
    win.calls.forEach((called, i) => {
      const path = PATH_MATRIX[i]
      const expected = shouldRewriteFetchPath(path)
        ? `http://192.168.1.20:3080/remote${path}`
        : `http://192.168.1.20:3080${path}`
      expect(called, path).toBe(expected)
    })
  })

  it('rewrites WebSocket paths exactly like the browser patch', () => {
    const win = makeWindow()
    boot(win)
    for (const path of WS_MATRIX) {
      // eslint-disable-next-line no-new
      new (win.WebSocket as new (url: string) => unknown)(`ws://192.168.1.20:3080${path}`)
    }
    win.wsUrls.forEach((called, i) => {
      const path = WS_MATRIX[i]
      const expected = shouldRewriteWsPath(path)
        ? `ws://192.168.1.20:3080/remote${path}`
        : `ws://192.168.1.20:3080${path}`
      expect(called, path).toBe(expected)
    })
  })

  it('records an unpaired signal before adoption and replays it via the seat', async () => {
    const win = makeWindow()
    win.response = () => new Response(JSON.stringify({
      type: 'server-response',
      result: { ok: false, error: { code: 'unpaired', message: 'not paired' } },
    }), { status: 403, headers: { 'content-type': 'application/json' } })
    boot(win)
    const seat = win[REMOTE_CHANNEL_BOOT_GLOBAL]
    expect(seat).toBeDefined()
    await win.fetch('/api/session.list', { method: 'POST' })
    // No hooks yet: the signal parks on the seat instead of being lost.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seat!.pendingUnpaired).toBe(true)
    let unpaired = 0
    seat!.onUnpaired = () => { unpaired += 1 }
    // Adoption replays: the client apply flushes the pending flag.
    if (seat!.pendingUnpaired) {
      seat!.pendingUnpaired = false
      seat!.onUnpaired()
    }
    expect(unpaired).toBe(1)
  })

  it('reports paired responses through the adopted hook', async () => {
    const win = makeWindow()
    boot(win)
    const seat = win[REMOTE_CHANNEL_BOOT_GLOBAL]!
    let paired = 0
    seat.onPaired = () => { paired += 1 }
    await win.fetch('/api/session.list', { method: 'POST' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(paired).toBe(1)
  })

  it('restore() unpatches everything and removes the global', async () => {
    const win = makeWindow()
    const originalFetch = win.fetch
    const OriginalWebSocket = win.WebSocket
    boot(win)
    expect(win.fetch).not.toBe(originalFetch)
    const seat = win[REMOTE_CHANNEL_BOOT_GLOBAL]!
    seat.restore()
    expect(win.fetch).toBe(originalFetch)
    expect(win.WebSocket).toBe(OriginalWebSocket)
    expect(win[REMOTE_CHANNEL_BOOT_GLOBAL]).toBeUndefined()
    await win.fetch('/api/session.list', { method: 'POST' })
    expect(win.calls).toEqual(['http://192.168.1.20:3080/api/session.list'])
  })

  it('flips the official UI into host mode on non-loopback origins', () => {
    const win = makeWindow('192.168.1.20') as Record<string, unknown>
    boot(win as never)
    const transport = win.__DSH_TRANSPORT__ as { ownsHost?: boolean } | undefined
    expect(transport?.ownsHost).toBe(true)
  })

  it('does not flip host mode on loopback origins', () => {
    const win = makeWindow('127.0.0.1') as Record<string, unknown>
    boot(win as never)
    expect(win.__DSH_TRANSPORT__).toBeUndefined()
    // And nothing else was patched either.
    expect(win[REMOTE_CHANNEL_BOOT_GLOBAL]).toBeUndefined()
  })
})

/**
 * The boot watchdog: a remote boot whose critical requests die (tunnel-edge
 * 429, dropped stream, boot-order race) leaves a permanently blank shell.
 * The watchdog rides the parse-time script, polls for the app conversation
 * surface, and reloads once when it never appears.
 */
interface WatchWindow {
  location: { hostname: string; href: string; origin: string; reload: () => void }
  document: { querySelector: (selector: string) => unknown }
  sessionStorage: {
    store: Map<string, string>
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
  }
  setTimeout(fn: () => void, ms: number): void
  /** Minimal surfaces the channel patch wraps before the watchdog runs. */
  fetch: () => Promise<unknown>
  WebSocket: new () => unknown
  ticks: Array<() => void>
  reloads: number
}

function makeWatchWindow(appMounted: () => boolean, hostname = 'claire-grain-desire-relief.trycloudflare.com'): WatchWindow {
  const win: WatchWindow = {
    fetch: () => Promise.resolve({}),
    WebSocket: class {},
    location: {
      hostname,
      href: `https://${hostname}/`,
      origin: `https://${hostname}`,
      reload: () => { win.reloads += 1 },
    },
    document: { querySelector: (selector) => (appMounted() ? { marker: selector } : null) },
    sessionStorage: {
      store: new Map<string, string>(),
      getItem(key) { return win.sessionStorage.store.get(key) ?? null },
      setItem(key, value) { win.sessionStorage.store.set(key, value) },
      removeItem(key) { win.sessionStorage.store.delete(key) },
    },
    setTimeout(fn) { win.ticks.push(fn) },
    ticks: [],
    reloads: 0,
  }
  return win
}

function bootWatch(win: WatchWindow): void {
  // The served script already carries the watchdog (spliced into the IIFE).
  new Function('window', REMOTE_CHANNEL_BOOT_SCRIPT)(win)
}

/** Drive scheduled ticks until the watchdog reloads (or the queue drains). */
function driveTicks(win: WatchWindow, max = 40): void {
  for (let i = 0; i < max && win.reloads === 0 && win.ticks.length > 0; i++) {
    win.ticks.shift()?.()
  }
}

describe('boot watchdog', () => {
  it('is embedded in the served boot script', () => {
    const script = buildRemoteChannelBootScript()
    expect(script).toContain(BOOT_WATCHDOG_KEY)
    expect(script).toContain('location.reload()')
    // The probe matches the official conversation surface markers.
    expect(script).toContain('[data-conversation-scroll]')
  })

  it('stays unscheduled on loopback origins', () => {
    const win = makeWatchWindow(() => false, '127.0.0.1')
    bootWatch(win)
    expect(win.ticks).toHaveLength(0)
    expect(win.reloads).toBe(0)
  })

  it('reloads once when the app surface never mounts, then latches', () => {
    const win = makeWatchWindow(() => false)
    bootWatch(win)
    expect(win.ticks).toHaveLength(1)
    driveTicks(win)
    expect(win.reloads).toBe(1)
    expect(win.sessionStorage.store.get(BOOT_WATCHDOG_KEY)).toBe('1')
    // The latch holds: a second boot on the same session never reloads.
    win.ticks.length = 0
    const second = makeWatchWindow(() => false)
    second.sessionStorage.store.set(BOOT_WATCHDOG_KEY, '1')
    bootWatch(second)
    driveTicks(second)
    expect(second.reloads).toBe(0)
  })

  it('clears the latch and never reloads when the app surface mounts', () => {
    const win = makeWatchWindow(() => true)
    // A stale latch from a previous failed boot must not survive a success.
    win.sessionStorage.store.set(BOOT_WATCHDOG_KEY, '1')
    bootWatch(win)
    driveTicks(win)
    expect(win.reloads).toBe(0)
    expect(win.sessionStorage.store.has(BOOT_WATCHDOG_KEY)).toBe(false)
  })
})
