/**
 * The real-browser attach path: opening the socket is bounded by its own
 * deadline, while every command keeps the ordinary CDP budget.
 *
 * The endpoint is the local scripted DevTools server, so the factory really
 * fetches `/json/version`, really connects, and really discovers targets. The
 * one injected seam is the connect call: it records what a real-browser attach
 * asks for and then hands the request to the production transport, so the
 * command deadline below is measured on the very client the attach created.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdpClient, CDP_COMMAND_TIMEOUT_MS } from '../../src/core/cdp.ts'
import {
  REAL_BROWSER_HANDSHAKE_TIMEOUT_MS,
  openExternalSession,
  type OpenSessionOptions,
} from '../../src/host/service.ts'
import { startFakeCdpEndpoint, type FakeCdpEndpoint } from '../helpers/fake-cdp-endpoint.ts'

const endpoints: FakeCdpEndpoint[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
})

/** The options the service hands its session factories. */
function sessionOptions(httpUrl: string): OpenSessionOptions {
  return {
    mode: 'cdp',
    cdpEndpoint: httpUrl,
    jpegQuality: 80,
    viewport: { width: 1280, height: 800 },
    onFrame: () => undefined,
    onTabsChanged: () => undefined,
  }
}

describe('real-browser connection budgets', () => {
  it('operator attaches with a five-second handshake while a command keeps the thirty-second budget', async () => {
    // Given a DevTools endpoint that answers discovery and never answers a navigation
    const endpoint = await startFakeCdpEndpoint({
      answers: {
        'Target.setDiscoverTargets': {},
        'Target.getTargets': { targetInfos: [] },
      },
    })
    endpoints.push(endpoint)
    const asked: Array<{ handshakeTimeoutMs?: number; commandTimeoutMs?: number }> = []

    // When the real-browser factory opens the session
    const session = await openExternalSession(sessionOptions(endpoint.httpUrl), {
      connect: (url, timeouts) => {
        asked.push({ ...timeouts })
        return CdpClient.connect(url, timeouts)
      },
    })

    // Then the attach asked for the five-second handshake and left the command budget at the CDP default
    expect(session.mode).toBe('cdp')
    expect(asked).toEqual([{ handshakeTimeoutMs: 5_000 }])
    expect(REAL_BROWSER_HANDSHAKE_TIMEOUT_MS).toBe(5_000)
    expect(CDP_COMMAND_TIMEOUT_MS).toBe(30_000)
    expect(endpoint.received.map(frame => frame.method)).toEqual(['Target.setDiscoverTargets', 'Target.getTargets'])

    // And a command the endpoint never answers survives the handshake budget and fails at the command one
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = session.transport.send('Page.navigate', { url: 'https://a.test/next' })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    const rejection = expect(pending).rejects.toThrow(`timed out after ${CDP_COMMAND_TIMEOUT_MS} ms`)
    await vi.advanceTimersByTimeAsync(REAL_BROWSER_HANDSHAKE_TIMEOUT_MS)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(CDP_COMMAND_TIMEOUT_MS - REAL_BROWSER_HANDSHAKE_TIMEOUT_MS)
    await rejection
    vi.useRealTimers()

    // Detaching closes the socket only: the browser and its pages are never asked to close
    await session.dispose()
    expect(endpoint.received.some(frame => frame.method === 'Browser.close' || frame.method === 'Target.closeTarget')).toBe(false)
  })
})
