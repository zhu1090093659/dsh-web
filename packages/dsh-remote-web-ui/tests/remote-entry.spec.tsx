// @vitest-environment jsdom
/** The sidebar entry + panel: issue flow, status stream, and the three actions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the apply chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
}))
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

/** fetch stub answering the pair endpoints. */
function mockFetch(issue: { ok: boolean; status?: number; code?: string; url?: string; token?: string; expiresAt?: number; lanAddresses?: string[] }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const status = init?.method === 'POST' && url === '/api/pair/issue' && !issue.ok ? (issue.status ?? 409) : 200
    const body = url === '/api/pair/issue' && issue.ok
      ? { ok: true, url: issue.url, token: issue.token, expiresAt: issue.expiresAt, lanAddresses: issue.lanAddresses ?? ['192.168.1.5'] }
      : url === '/api/pair/issue'
        ? { ok: false, code: issue.code }
        : { ok: true }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
}

function mount(issue: { ok: boolean; status?: number; code?: string; url?: string; token?: string; expiresAt?: number; lanAddresses?: string[] } = { ok: true, url: 'http://192.168.1.5:3080/?pair=tok-1', token: 'tok-1', expiresAt: Date.now() + 60_000, lanAddresses: ['192.168.1.5'] }) {
  const fetch = mockFetch(issue)
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  const view = render(
    <RemoteEntry
      wide={true}
      useSessions={neverHook}
      useWorkspaces={(selector: (s: { recentWorkspaceId: string }) => unknown) => selector({ recentWorkspaceId: 'ws-1' })}
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
  it('opens the panel on trigger click: title, subtitle, QR card, hint, actions', async () => {
    const { fetch } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    expect(fetch).toHaveBeenCalledWith('/api/pair/issue', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(screen.getByText('Mobile remote control')).toBeTruthy())
    expect(screen.getByText('Scan the QR code or open the link on your phone to control this workspace remotely')).toBeTruthy()
    expect(screen.getByText('Scan to connect')).toBeTruthy()
    expect(screen.getByText('Waiting for a phone')).toBeTruthy()
    // The QR svg renders from the issued URL (the trigger's phone icon is a
    // separate svg; the QR carries its own test id).
    expect(document.querySelector('[data-testid="remote-qr"]')).not.toBeNull()
    expect(screen.getByText('Cannot scan? Open the link on your phone')).toBeTruthy()
    expect(screen.getByText('http://192.168.1.5:3080/?pair=tok-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh QR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    // The issue payload carries the current workspace for the deep link.
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: 'ws-1' })
  })

  it('shows the lan-required banner instead of a QR when the bind is loopback-only', async () => {
    mount({ ok: false, code: 'lan-required' })
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    await waitFor(() => expect(screen.getByText('This feature needs dsh web started with --host 0.0.0.0, or a configured public address')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
  })

  it('shows the loopback-required banner when the loopback-only fence rejects the mint', async () => {
    // A LAN-origin desktop page (e.g. the GUI opened at 192.168.1.x) hits
    // the issue endpoint's loopback fence and gets 403 — the server may be
    // bound fine, so the banner must say "use 127.0.0.1", not "restart with
    // --host 0.0.0.0".
    mount({ ok: false, status: 403, code: 'forbidden' })
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    await waitFor(() => expect(screen.getByText('Cannot reach the pairing service')).toBeTruthy())
    expect(document.querySelector('[data-testid="remote-qr"]')).toBeNull()
  })

  it('renders the address picker on multi-homed hosts and re-mints on switch', async () => {
    const { fetch } = mount({ ok: true, url: 'http://192.168.1.5:3080/?pair=tok-1', token: 'tok-1', expiresAt: Date.now() + 60_000, lanAddresses: ['192.168.1.5', '10.0.0.3'] })
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
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
      expect(body).toEqual({ workspaceId: 'ws-1', address: '10.0.0.3' })
    })
  })

  it('hides the address picker with a single constructible literal', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    await waitFor(() => expect(screen.getByText('Waiting for a phone')).toBeTruthy())
    expect(screen.queryByText('Network the QR code points to')).toBeNull()
  })

  it('reflects live status frames: connected and back to offline', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    await waitFor(() => expect(screen.getByText('Waiting for a phone')).toBeTruthy())
    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe('/api/pair/events')
    source?.emit({ type: 'state', phase: 'connected', lanAvailable: true, tokenId: 'tok-1', tokenExpiresAt: Date.now() + 60_000, deviceCount: 1, onlineCount: 1 })
    await waitFor(() => expect(screen.getByText('1 device(s) connected')).toBeTruthy())
    source?.emit({ type: 'state', phase: 'disconnected', lanAvailable: true, tokenId: 'tok-1', tokenExpiresAt: Date.now() + 60_000, deviceCount: 1, onlineCount: 0 })
    await waitFor(() => expect(screen.getByText('Paired devices offline')).toBeTruthy())
  })

  it('stop posts the revocation; refresh mints a new QR; copy gives feedback', async () => {
    const { fetch } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mobile remote control' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fetch).toHaveBeenCalledWith('/api/pair/stop', expect.objectContaining({ method: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh QR' }))
    expect(fetch.mock.calls.filter(call => call[0] === '/api/pair/issue').length).toBe(2)
    // Clipboard: stub navigator.clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://192.168.1.5:3080/?pair=tok-1'))
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
    expect(injected).toEqual(['sidebar.remote', 'sidebar.footer.action', 'web-ui.plugin.item'])
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
    expect(registered).toEqual(['web-ui.plugin.item', 'sidebar.remote', 'sidebar.footer.action'])
  })
})
