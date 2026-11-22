// @vitest-environment jsdom
/**
 * TunnelsTab tests: the extracted TUNNEL_POLL_MS constant, the pure diff
 * helper that makes a poll tick with no real change keep the previous state
 * reference, and a light render test proving the mount-time interval ticks
 * on that constant and is cleared on unmount.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TunnelsTab, TUNNEL_POLL_MS, diffTunnels } from '../src/client/panel/TunnelsTab.tsx'
import type { SshApi } from '../src/client/api.ts'
import type { TunnelInfo } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []

function makeTunnel(): TunnelInfo {
  return {
    id: 'tun-1',
    alias: 'db',
    localPort: 40000,
    remoteHost: '127.0.0.1',
    remotePort: 5432,
    state: 'forwarding',
    startedAt: 1000,
  }
}

afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('TunnelsTab polling contract', () => {
  it('uses the existing 5s freshness interval', () => {
    expect(TUNNEL_POLL_MS).toBe(5000)
  })

  it('diffTunnels keeps the previous reference when nothing changed', () => {
    expect(diffTunnels(null, [makeTunnel()])).toEqual([makeTunnel()])
    expect(diffTunnels([makeTunnel()], [makeTunnel()])).toBeNull()
  })

  it('diffTunnels returns next when length or a renderable field changes', () => {
    const base = [makeTunnel()]
    const added = [makeTunnel(), makeTunnel()]
    expect(diffTunnels(base, added)).toEqual(added)
    const failed = [{ ...makeTunnel(), state: 'failed' as const }]
    expect(diffTunnels(base, failed)).toEqual(failed)
    const moved = [{ ...makeTunnel(), localPort: 5000 }]
    expect(diffTunnels(base, moved)).toEqual(moved)
  })

  it('polls on TUNNEL_POLL_MS while mounted and clears the interval on unmount', async () => {
    vi.useFakeTimers()
    const listTunnels = vi.fn(async () => [makeTunnel()])
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TunnelsTab api={api} />) })
    await act(async () => { await Promise.resolve() })
    const initial = listTunnels.mock.calls.length
    expect(initial).toBeGreaterThanOrEqual(1)
    await act(async () => { vi.advanceTimersByTime(TUNNEL_POLL_MS) })
    await act(async () => { await Promise.resolve() })
    expect(listTunnels.mock.calls.length).toBe(initial + 1)
    await act(async () => { root.unmount() })
  })

  async function mount(api: SshApi, active = true) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const render = async (next: boolean) => {
      await act(async () => { root.render(<TunnelsTab api={api} active={next} />) })
    }
    await render(active)
    return { container, render }
  }

  it('does no automatic tunnel reads while closed and refreshes immediately on each reopen', async () => {
    vi.useFakeTimers()
    const listTunnels = vi.fn(async () => [makeTunnel()])
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const view = await mount(api, false)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(listTunnels).not.toHaveBeenCalled()
    await view.render(true)
    expect(listTunnels).toHaveBeenCalledOnce()
    await view.render(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(listTunnels).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await view.render(true)
    expect(listTunnels).toHaveBeenCalledTimes(2)
  })

  it('pauses in a hidden document and refreshes once when the page becomes visible', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const listTunnels = vi.fn(async () => [makeTunnel()])
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    await mount(api)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(listTunnels).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(listTunnels).toHaveBeenCalledOnce()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(listTunnels).toHaveBeenCalledOnce()
    visibility.mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(listTunnels).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { roots.pop()!.unmount() })
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(listTunnels).toHaveBeenCalledOnce()
  })

  it('allows only one automatic read in flight and resumes polling after it settles', async () => {
    vi.useFakeTimers()
    let resolveList!: (value: TunnelInfo[]) => void
    const listTunnels = vi.fn(() => new Promise<TunnelInfo[]>(resolve => { resolveList = resolve }))
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const view = await mount(api)
    await act(async () => { await vi.advanceTimersByTimeAsync(TUNNEL_POLL_MS * 4) })
    expect(listTunnels).toHaveBeenCalledOnce()
    await act(async () => { resolveList([makeTunnel()]) })
    expect(view.container.querySelector('[data-state="forwarding"]')).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(TUNNEL_POLL_MS) })
    expect(listTunnels).toHaveBeenCalledTimes(2)
    await act(async () => { resolveList([]) })
  })

  it('ignores a late failure from a read started before closing the panel', async () => {
    vi.useFakeTimers()
    let rejectList!: (reason: Error) => void
    const listTunnels = vi.fn()
      .mockImplementationOnce(() => new Promise<TunnelInfo[]>((_resolve, reject) => { rejectList = reject }))
      .mockResolvedValue([makeTunnel()])
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const view = await mount(api)
    await view.render(false)
    await view.render(true)
    await act(async () => { rejectList(new Error('stale failure')) })
    expect(view.container.querySelector('[data-state="forwarding"]')).not.toBeNull()
    expect(view.container.textContent).not.toContain('stale failure')
  })

  it('keeps one request and one pending refresh across repeated close/reopen', async () => {
    vi.useFakeTimers()
    let resolveList!: (value: TunnelInfo[]) => void
    const listTunnels = vi.fn()
      .mockImplementationOnce(() => new Promise<TunnelInfo[]>(resolve => { resolveList = resolve }))
      .mockResolvedValue([makeTunnel()])
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const view = await mount(api)
    for (let count = 0; count < 3; count += 1) {
      await view.render(false)
      await view.render(true)
    }
    expect(listTunnels).toHaveBeenCalledOnce()
    await act(async () => { resolveList([]) })
    expect(listTunnels).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('[data-state="forwarding"]')).not.toBeNull()
  })

  it('drops a deferred refresh if the panel closes before the old request settles', async () => {
    vi.useFakeTimers()
    let resolveList!: (value: TunnelInfo[]) => void
    const listTunnels = vi.fn(() => new Promise<TunnelInfo[]>(resolve => { resolveList = resolve }))
    const api = { listHosts: vi.fn(async () => []), listTunnels } as unknown as SshApi
    const view = await mount(api)
    await view.render(false)
    await view.render(true)
    await view.render(false)
    await act(async () => { resolveList([]) })
    expect(listTunnels).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('operator sees an error and keeps form inputs when startTunnel resolves in failed state', async () => {
    // Given hosts ready and an engine whose startTunnel returns state='failed'
    const api = {
      listHosts: async () => [{
        alias: 'db',
        host: '10.0.0.2',
        port: 22,
        user: 'ops',
        auth: 'key',
        keyReady: true,
        proxyJump: [],
        forwardAgent: false,
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      }],
      listTunnels: async () => [],
      startTunnel: async () => ({
        id: 'tun-fail',
        alias: 'db',
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 5432,
        state: 'failed' as const,
        error: 'ssh link closed while the tunnel was starting',
        startedAt: 1000,
      }),
    } as unknown as SshApi
    const view = await mount(api)
    const select = view.container.querySelector('select') as HTMLSelectElement
    const portInput = view.container.querySelector('input[type="number"]') as HTMLInputElement
    const startButton = [...view.container.querySelectorAll('button')].find(b => b.textContent === '新建隧道') as HTMLButtonElement

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(select, 'db')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(portInput, '5432')
      portInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // When the operator clicks start tunnel
    await act(async () => {
      startButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Then the error banner survives list refresh, no green notice renders, and remotePort stays filled
    const errorBanner = view.container.querySelector('[data-kind="error"]')
    expect(errorBanner?.textContent).toContain('ssh link closed')
    expect(view.container.querySelector('[data-kind="ok"]')).toBeNull()
    expect(portInput.value).toBe('5432')
  })
})
