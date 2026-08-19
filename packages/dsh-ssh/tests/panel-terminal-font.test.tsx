// @vitest-environment jsdom
/**
 * TerminalTab font wiring (issue #577): the constructed xterm receives the
 * resolved font family, and a live settings change re-applies it (options
 * write + refit + PTY resize) without a reconnect.
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalFontSource } from '../src/client/panel/helpers.ts'

const { terminalInstances, fitSpy } = vi.hoisted(() => ({
  terminalInstances: [] as Array<{ options: Record<string, unknown> }>,
  fitSpy: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    cols = 80
    rows = 24
    constructor(options: Record<string, unknown>) {
      this.options = { ...options }
      terminalInstances.push(this as { options: Record<string, unknown> })
    }
    loadAddon(): void {}
    open(): void {}
    dispose(): void {}
    onData(): { dispose(): void } { return { dispose: () => undefined } }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit = fitSpy },
}))

import { TerminalTab } from '../src/client/panel/TerminalTab.tsx'
import type { SshApi, TerminalConnection } from '../src/client/api.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.restoreAllMocks()
  terminalInstances.length = 0
  fitSpy.mockClear()
  document.body.replaceChildren()
})

type FakeConnection = TerminalConnection & { resize: ReturnType<typeof vi.fn> }

function fakeApi(): { api: SshApi, connection: FakeConnection } {
  const connection = {
    onReady: undefined,
    onOutput: undefined,
    onExit: undefined,
    send: () => undefined,
    resize: vi.fn(),
    close: () => undefined,
  }
  return {
    api: {
      listHosts: vi.fn(async () => [{ alias: 'demo', host: 'example.com' }]),
      openTerminal: vi.fn(() => connection),
    } as unknown as SshApi,
    connection: connection as unknown as FakeConnection,
  }
}

function fontSource(initial?: string): TerminalFontSource & { set(value: string | undefined): void } {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (value) => {
      current = value
      for (const listener of listeners) listener()
    },
  }
}

describe('TerminalTab terminal font (#577)', () => {
  it('constructs xterm with the resolved font and re-applies live changes', async () => {
    const source = fontSource('"SauceCodePro Nerd Font", monospace')
    const { api, connection } = fakeApi()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TerminalTab api={api} presetAlias="demo" terminalFont={source} />) })
    await act(async () => { await Promise.resolve() })

    // presetAlias preselects the host; the first control button is Connect.
    const connect = container.querySelectorAll('button')[0] as HTMLButtonElement
    expect(connect.disabled).toBe(false)
    const fitsAfterConnect = fitSpy.mock.calls.length
    await act(async () => { connect.click() })
    expect(terminalInstances).toHaveLength(1)
    expect(terminalInstances[0]!.options.fontFamily).toBe('"SauceCodePro Nerd Font", monospace')

    // A live settings change re-applies without a reconnect: options write,
    // one extra refit, and a PTY resize with the current geometry.
    const resizesBefore = connection.resize.mock.calls.length
    await act(async () => { source.set('User Mono, monospace') })
    expect(terminalInstances[0]!.options.fontFamily).toBe('User Mono, monospace')
    expect(fitSpy.mock.calls.length).toBeGreaterThan(fitsAfterConnect)
    expect(connection.resize.mock.calls.length).toBeGreaterThan(resizesBefore)
    expect(connection.resize).toHaveBeenLastCalledWith(80, 24)

    // Clearing the setting drops back to the CSS chain (no custom properties
    // set in this environment, so the built-in fallback wins).
    await act(async () => { source.set(undefined) })
    expect(terminalInstances[0]!.options.fontFamily).toBe('Menlo, Consolas, "Liberation Mono", monospace')

    await act(async () => { root.unmount() })
  })
})
