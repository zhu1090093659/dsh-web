// @vitest-environment jsdom
/**
 * TerminalTab xterm lifecycle test: documents that the terminal is disposed
 * on teardown (unmount / disconnect) and that the window resize listener it
 * registers is removed again on unmount, so no xterm instance or dangling
 * listener survives the tab going away.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Source-level assertions read files inside this package. Resolve them from the
// test file's own directory so a run started from the repository root, where
// process.cwd() is the monorepo root, still finds them.
function packageRoot(): string {
  const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname
  if (!dirname) throw new Error('import.meta.dirname is unavailable; run the suite through vitest')
  return join(dirname, '..')
}
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalTab } from '../src/client/panel/TerminalTab.tsx'
import { PanelController } from '../src/client/panel/controller.ts'
import type { SshApi, TerminalConnection } from '../src/client/api.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}

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
      onAuthPrompt: undefined,
      send: () => undefined,
      resize: () => undefined,
      sendAuthResponse: () => undefined,
      detach: () => undefined,
      close: () => undefined,
    }) as TerminalConnection),
  } as unknown as SshApi
}

describe('TerminalTab L2 semantic attributes (#506)', () => {
  it('tags the terminal container as the terminal part', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TerminalTab api={fakeApi()} controller={new PanelController()} />) })
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
    await act(async () => { root.render(<TerminalTab api={fakeApi()} controller={new PanelController()} />) })
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
    const source = readFileSync(join(packageRoot(), 'src', 'client', 'panel', 'TerminalTab.tsx'), 'utf8')
    expect(source).toContain('dataSubRef.current?.dispose()')
    expect(source).toContain('termRef.current?.dispose()')
    expect(source).toContain('window.removeEventListener(\'resize\', sync)')
  })

  it('observes the terminal container so banner/panel resizes refit', () => {
    // The connected banner shrinks the container after the initial fit;
    // without a container-level observer the viewport keeps the old height
    // and the last line is clipped. Guard the contract at source level
    // (jsdom has no ResizeObserver to exercise at runtime).
    const source = readFileSync(join(packageRoot(), 'src', 'client', 'panel', 'TerminalTab.tsx'), 'utf8')
    expect(source).toContain('new ResizeObserver(')
    expect(source).toContain('observer.observe(container)')
    expect(source).toContain('observer.disconnect()')
  })

  it('renders 2FA modal when server requests keyboard-interactive auth and submits response (#806)', async () => {
    let capturedConn: TerminalConnection | undefined
    const api: SshApi = {
      listHosts: vi.fn(async () => [{ alias: 'jump', host: 'jump.test', port: 22, user: 'u', auth: 'password', tags: [], proxyJump: [] }]),
      openTerminal: vi.fn((_alias, _cols, _rows) => {
        const conn: TerminalConnection = {
          onReady: undefined,
          onOutput: undefined,
          onExit: undefined,
          onAuthPrompt: undefined,
          send: vi.fn(),
          resize: vi.fn(),
          sendAuthResponse: vi.fn(),
          detach: vi.fn(),
          close: vi.fn(),
        }
        capturedConn = conn
        return conn
      }),
    } as unknown as SshApi

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<TerminalTab api={api} controller={new PanelController()} presetAlias="jump" />) })
    await act(async () => { await Promise.resolve() })

    // Click connect
    const connectBtn = container.querySelector('button[type="button"]') as HTMLButtonElement
    await act(async () => { connectBtn.click() })

    expect(capturedConn).toBeDefined()

    // Trigger auth prompt
    await act(async () => {
      capturedConn?.onAuthPrompt?.('Jump 2FA', 'Enter token from app', [{ prompt: 'Verification Code: ', echo: true }])
    })

    const title = container.querySelector('h3')
    expect(title?.textContent).toBe('Jump 2FA')
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()

    // Enter token and submit form
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '987654')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement
      submitBtn.click()
    })

    expect(capturedConn?.sendAuthResponse).toHaveBeenCalledWith(['987654'])
    await act(async () => { root.unmount() })
  })
})