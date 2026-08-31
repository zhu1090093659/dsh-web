// @vitest-environment jsdom
/** The sidebar entry + panel: issue flow, status stream, and the three actions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteEntry, type RemoteEntryProps } from '../src/client/RemoteEntry.tsx'
import { en, type RemoteKey } from '../src/client/locales.ts'

// English dictionary translate stub with {param} interpolation.
const t: RemoteEntryProps['t'] = (key, params) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const neverHook = (() => { throw new Error('shell must not read this hook') }) as never

/** Minimal EventSource stub: instances record messages for manual dispatch. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void {
    this.closed = true
  }
  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
  }
}

/** One issue() response for the fetch stub (a list feeds sequential calls). */
type MockIssue = {
  ok: boolean
  status?: number
  code?: string
  url?: string
  token?: string
  expiresAt?: number
  lanAddresses?: string[]
  publicBaseUrl?: string
}

/** fetch stub answering the pair endpoints; a list answers issue() in order. */
function mockFetch(issue: MockIssue | MockIssue[]) {
  const issues = Array.isArray(issue) ? [...issue] : [issue]
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/update/status') {
      return new Response(JSON.stringify({ mode: 'npm', packages: [], outdated: false }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const current = issues.length > 1 ? issues.shift()! : issues[0]
    const status = init?.method === 'POST' && url === '/api/pair/issue' && !current.ok ? (current.status ?? 409) : 200
    const body = url === '/api/pair/issue' && current.ok
      ? {
          ok: true,
          url: current.url,
          token: current.token,
          expiresAt: current.expiresAt,
          lanAddresses: current.lanAddresses ?? ['192.168.1.5'],
          ...(current.publicBaseUrl !== undefined ? { publicBaseUrl: current.publicBaseUrl } : {}),
        }
      : url === '/api/pair/issue'
        ? { ok: false, code: current.code }
        : { ok: true }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
}

function mount(issue: MockIssue | MockIssue[] = { ok: true, url: 'http://192.168.1.5:3080/pair-accept?pair=tok-1', token: 'tok-1', expiresAt: Date.now() + 60_000, lanAddresses: ['192.168.1.5'] }) {
  const fetch = mockFetch(issue)
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  const view = render(
    <RemoteEntry
      wide={true}
      t={t}
    />,
  )
  return { fetch, view }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeEventSource.instances = []
  vi.useRealTimers()
})

describe('RemoteEntry', () => {
  it('keeps only the phone icon in the expanded sidebar', () => {
    mount()
    const trigger = screen.getByRole('button', { name: 'Remote access' })
    expect(screen.queryByText('Remote access')).toBeNull()
    expect(trigger.querySelector('svg')).not.toBeNull()
  })

  it('opens the panel on trigger click: title, subtitle, QR card, hint, actions', async () => {
    const { fetch } = mount()
    const trigger = screen.getByRole('button', { name: 'Remote access' })
    fireEvent.click(trigger)
    expect(fetch).toHaveBeenCalledWith('/api/pair/issue', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Remote access' })).toBeTruthy())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Pair a phone or another computer to share the same Web GUI (official UI + mobile adaptation)')).toBeTruthy()
    expect(screen.getByText('Pair a device')).toBeTruthy()
    expect(screen.getByText('Waiting for a device')).toBeTruthy()
    // The QR svg renders from the issued URL (the trigger's phone icon is a
    // separate svg; the QR carries its own test id).
    expect(document.querySelector('[data-testid="remote-qr"]')).not.toBeNull()
    expect(screen.getByText('Cannot scan? Open one of the pairing links below')).toBeTruthy()
    expect(screen.getByText('http://192.168.1.5:3080/pair-accept?pair=tok-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh QR' })).toBeTruthy()
    // One origin-agnostic link: the official Web GUI for every device.
    expect(screen.getByText('Pairing link')).toBeTruthy()
    expect(screen.queryByText('Phone pairing link')).toBeNull()
    expect(screen.queryByText('Computer pairing link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    // The issue payload no longer carries a workspace deep-link target.
    const init = fetch.mock.calls.find(call => call[0] === '/api/pair/issue')?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('shows the lan-required banner instead of a QR when the bind is loopback-only', async () => {
    mount({ ok: false, code: 'lan-required' })
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('This feature needs a LAN bind or a public address')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
    // The status stream stays open on the lan-required banner: the
    // auto-tunnel may still be starting, and its running frame drives the
    // re-issue below.
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe('/api/pair/events')
  })

  it('re-issues once the auto-tunnel reaches running and renders the ready QR', async () => {
    const { fetch } = mount([
      { ok: false, code: 'lan-required' },
      {
        ok: true,
        url: 'https://tunnel.example/pair-accept?pair=tok-2',
        token: 'tok-2',
        expiresAt: Date.now() + 60_000,
        lanAddresses: ['192.168.1.5'],
        publicBaseUrl: 'https://tunnel.example',
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('This feature needs a LAN bind or a public address')).toBeTruthy())
    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe('/api/pair/events')
    source?.emit({ type: 'state', phase: 'lan-required', lanAvailable: true, deviceCount: 0, onlineCount: 0, tunnel: { state: 'running', url: 'https://tunnel.example' } })
    await waitFor(() => expect(screen.getByText('https://tunnel.example/pair-accept?pair=tok-2')).toBeTruthy())
    expect(document.querySelector('[data-testid="remote-qr"]')).not.toBeNull()
    expect(fetch.mock.calls.filter(call => call[0] === '/api/pair/issue')).toHaveLength(2)
  })

  it('stays on the lan-required banner while the auto-tunnel is starting', async () => {
    const { fetch } = mount({ ok: false, code: 'lan-required' })
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('This feature needs a LAN bind or a public address')).toBeTruthy())
    const source = FakeEventSource.instances[0]
    source?.emit({ type: 'state', phase: 'lan-required', lanAvailable: true, deviceCount: 0, onlineCount: 0, tunnel: { state: 'starting' } })
    // Let a stray re-issue surface before asserting none happened.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetch.mock.calls.filter(call => call[0] === '/api/pair/issue')).toHaveLength(1)
    expect(screen.getByText('This feature needs a LAN bind or a public address')).toBeTruthy()
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
  })

  it('shows the loopback-required banner when the loopback-only fence rejects the mint', async () => {
    // A LAN-origin desktop page (e.g. the GUI opened at 192.168.1.x) hits
    // the issue endpoint's loopback fence and gets 403 — the server may be
    // bound fine, so the banner must say "use 127.0.0.1", not "restart with
    // --host 0.0.0.0".
    mount({ ok: false, status: 403, code: 'forbidden' })
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('The pairing panel works on this machine only')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
    // No status stream on a failure banner: the events endpoint sits behind
    // the same loopback fence, so opening it would only start a doomed
    // reconnect loop.
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('shows the unreachable banner when the issue fetch fails', async () => {
    const { fetch } = mount()
    fetch.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('Cannot reach the pairing service')).toBeTruthy())
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
  })

  it('does not leak an EventSource when the panel is closed during the issue fetch', async () => {
    let resolveIssue: ((r: Response) => void) | undefined
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/update/status') {
        return Promise.resolve(new Response(JSON.stringify({ mode: 'npm', packages: [], outdated: false }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return new Promise<Response>((resolve) => { resolveIssue = resolve })
    })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    render(
      <RemoteEntry
        wide={true}
        useSessions={neverHook}
        useWorkspaces={(selector: (s: { recentWorkspaceId: string }) => unknown) => selector({ recentWorkspaceId: 'ws-1' })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    // The issue fetch is in flight; close the panel before it resolves.
    fireEvent.click(screen.getByRole('button', { name: 'Close remote access panel' }))
    resolveIssue?.(new Response(JSON.stringify({
      ok: true,
      url: 'http://192.168.1.5:3080/pair-accept?pair=tok-1',
      token: 'tok-1',
      expiresAt: Date.now() + 60_000,
      lanAddresses: ['192.168.1.5'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    // The stale issue continuation must not spawn a stream.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(0))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('renders the address picker on multi-homed hosts and re-mints on switch', async () => {
    const { fetch } = mount({ ok: true, url: 'http://192.168.1.5:3080/pair-accept?pair=tok-1', token: 'tok-1', expiresAt: Date.now() + 60_000, lanAddresses: ['192.168.1.5', '10.0.0.3'] })
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('Network the QR code points to')).toBeTruthy())
    expect(screen.getByLabelText('192.168.1.5')).toBeTruthy()
    expect(screen.getByLabelText('10.0.0.3')).toBeTruthy()
    // Switching re-mints with the chosen literal; the first interface stays
    // the default selection.
    fireEvent.click(screen.getByLabelText('10.0.0.3'))
    await waitFor(() => {
      const calls = fetch.mock.calls.filter(call => call[0] === '/api/pair/issue')
      expect(calls).toHaveLength(2)
      const body = JSON.parse(String((calls[1]?.[1] as RequestInit).body))
      expect(body).toEqual({ address: '10.0.0.3' })
    })
  })

  it('hides the address picker with a single constructible literal', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('Waiting for a device')).toBeTruthy())
    expect(screen.queryByText('Network the QR code points to')).toBeNull()
  })

  it('reflects live status frames: connected and back to offline', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByText('Waiting for a device')).toBeTruthy())
    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe('/api/pair/events')
    source?.emit({
      type: 'state',
      phase: 'connected',
      lanAvailable: true,
      tokenId: 'tok-1',
      tokenExpiresAt: Date.now() + 60_000,
      deviceCount: 1,
      onlineCount: 1,
      devices: [{
        id: 'credential-must-not-render',
        createdAt: Date.now() - 10_000,
        lastSeenAt: Date.now(),
        online: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
      }],
    })
    await waitFor(() => expect(screen.getByText('1 device(s) connected')).toBeTruthy())
    expect(screen.getByText('Windows · Chrome')).toBeTruthy()
    expect(screen.queryByText('credential-must-not-render')).toBeNull()
    expect(screen.queryByText(/Mozilla\/5\.0/)).toBeNull()
    source?.emit({ type: 'state', phase: 'disconnected', lanAvailable: true, tokenId: 'tok-1', tokenExpiresAt: Date.now() + 60_000, deviceCount: 1, onlineCount: 0 })
    await waitFor(() => expect(screen.getByText('Paired devices offline')).toBeTruthy())
  })

  it('stop posts the revocation; refresh mints a new QR; the link copies once', async () => {
    const { fetch } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remote access' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fetch).toHaveBeenCalledWith('/api/pair/stop', expect.objectContaining({ method: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh QR' }))
    expect(fetch.mock.calls.filter(call => call[0] === '/api/pair/issue').length).toBe(2)
    // Clipboard: stub navigator.clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://192.168.1.5:3080/pair-accept?pair=tok-1'))
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
  })
})

describe('apply registration', () => {
  it('registers the sidebar entry and the plugin settings card', async () => {
    const { apply } = await import('../src/client/index.ts')
    const injected: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (key: string) => { injected.push(key); return () => {} },
        register: () => () => {},
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ status: 'unavailable' as const, writable: false }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
      get: (name: string) => {
        if (name === 'connection') return { isLoopback: true }
        return undefined
      },
    }
    apply(ctx as never)
    expect(injected).toEqual(['sidebar.footer.action', 'web-ui.plugin.item'])
  })

  it('waits for the settings snapshot before mounting the sidebar entry and runtime', async () => {
    const { apply } = await import('../src/client/index.ts')
    const injected: string[] = []
    const registered: string[] = []
    let snapshot = { status: 'loading' as const, writable: false, value: undefined }
    const listeners = new Set<() => void>()
    const notify = (): void => { for (const fn of [...listeners]) fn() }
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (key: string, factory?: () => unknown) => {
          injected.push(key)
          factory?.()
          return () => {}
        },
        register: (entry: { name: string }) => {
          registered.push(entry.name)
          return () => {}
        },
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => snapshot,
          subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
          set: async () => {},
          unset: async () => {},
        }),
      },
      get: (name: string) => {
        if (name === 'connection') return { isLoopback: true }
        return undefined
      },
    }
    apply(ctx as never)
    expect(registered).toEqual(['web-ui.plugin.item'])

    snapshot = { status: 'ready' as const, writable: true, value: { enabled: false } }
    notify()
    expect(registered).toEqual(['web-ui.plugin.item'])

    snapshot = { status: 'ready' as const, writable: true, value: { enabled: true } }
    notify()
    expect(registered).toEqual(['web-ui.plugin.item', 'sidebar.footer.action'])
  })
})
