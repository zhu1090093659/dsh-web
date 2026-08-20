// @vitest-environment jsdom
/**
 * TerminalTab xterm lifecycle test: documents that the terminal is disposed
 * on teardown (unmount / disconnect) and that the window resize listener it
 * registers is removed again on unmount, so no xterm instance or dangling
 * listener survives the tab going away.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalTab } from '../src/client/panel/TerminalTab.tsx'
import type { SshApi, TerminalConnection } from '../src/client/api.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function fakeApi(): SshApi {
  return {
    listHosts: vi.fn(async () => []),
    openTerminal: vi.fn(() => ({
      onReady: undefined,
      onOutput: undefined,
      onExit: undefined,
      send: () => undefined,
      resize: () => undefined,
      close: () => undefined,
    }) as TerminalConnection),
  } as unknown as SshApi
}

describe('TerminalTab L2 semantic attributes (#506)', () => {
  it('tags the terminal container as the terminal part', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TerminalTab api={fakeApi()} />) })
    await act(async () => { await Promise.resolve() })
    const terminal = container.querySelector('[data-dsh-part="terminal"]')
    expect(terminal).not.toBeNull()
    await act(async () => { root.unmount() })
  })
})

describe('TerminalTab dispose and resize cleanup', () => {
  it('registers a resize listener on mount and removes it on unmount', async () => {
    const addResize = vi.fn()
    const removeResize = vi.fn()
    vi.spyOn(window, 'addEventListener').mockImplementation(addResize)
    vi.spyOn(window, 'removeEventListener').mockImplementation(removeResize)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TerminalTab api={fakeApi()} />) })
    await act(async () => { await Promise.resolve() })
    expect(addResize.mock.calls.some(call => call[0] === 'resize')).toBe(true)
    await act(async () => { root.unmount() })
    // Unmount must remove the resize listener it added.
    expect(removeResize.mock.calls.some(call => call[0] === 'resize')).toBe(true)
  })

  it('teardown disposes the xterm terminal and its onData subscription', () => {
    // The teardown path is the lifecycle contract: on disconnect or unmount
    // the component must release the terminal instance and the input
    // subscription. Assert that the source wires both disposes so a future
    // refactor cannot silently drop them.
    const source = readFileSync(join(process.cwd(), 'src', 'client', 'panel', 'TerminalTab.tsx'), 'utf8')
    expect(source).toContain('dataSubRef.current?.dispose()')
    expect(source).toContain('termRef.current?.dispose()')
    expect(source).toContain('window.removeEventListener(\'resize\', sync)')
  })

  it('observes the terminal container so banner/panel resizes refit', () => {
    // The connected banner shrinks the container after the initial fit;
    // without a container-level observer the viewport keeps the old height
    // and the last line is clipped. Guard the contract at source level
    // (jsdom has no ResizeObserver to exercise at runtime).
    const source = readFileSync(join(process.cwd(), 'src', 'client', 'panel', 'TerminalTab.tsx'), 'utf8')
    expect(source).toContain('new ResizeObserver(')
    expect(source).toContain('observer.observe(container)')
    expect(source).toContain('observer.disconnect()')
  })
})