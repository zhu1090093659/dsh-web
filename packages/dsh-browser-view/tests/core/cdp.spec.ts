/**
 * Transport deadlines: opening the DevTools socket and running one command are
 * bounded by two different settings, and a client whose socket went away says
 * so instead of pretending to be usable.
 *
 * The endpoint is a local scripted server — no Chrome, no mocked socket — so
 * the client really opens, really writes, and really gives up on its own
 * timers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdpClient, CdpError, CDP_COMMAND_TIMEOUT_MS, CDP_HANDSHAKE_TIMEOUT_MS } from '../../src/core/cdp.ts'
import { startFakeCdpEndpoint, startSilentEndpoint, type FakeCdpEndpoint, type SilentEndpoint } from '../helpers/fake-cdp-endpoint.ts'

const endpoints: Array<FakeCdpEndpoint | SilentEndpoint> = []

/** Track one endpoint so the test leaves no listener behind. */
function track<T extends FakeCdpEndpoint | SilentEndpoint>(endpoint: T): T {
  endpoints.push(endpoint)
  return endpoint
}

afterEach(async () => {
  vi.useRealTimers()
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
})

describe('command budget', () => {
  it('operator connects without options and an unanswered command keeps the thirty-second default', async () => {
    // Given a DevTools endpoint that answers discovery and never answers a command
    const endpoint = track(await startFakeCdpEndpoint())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // When a client with no deadline options sends that command
    const client = await CdpClient.connect(endpoint.wsUrl)
    const pending = client.send('Page.navigate', { url: 'https://a.test/' })
    let outcome: string | undefined
    void pending.then(() => { outcome = 'resolved' }, () => { outcome = 'rejected' })
    const rejection = expect(pending).rejects.toThrow(`timed out after ${CDP_COMMAND_TIMEOUT_MS} ms`)
    // Then it is still pending one millisecond before that budget and fails at it
    await vi.advanceTimersByTimeAsync(CDP_COMMAND_TIMEOUT_MS - 1)
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(CDP_COMMAND_TIMEOUT_MS).toBe(30_000)
  })

  it('operator sets a short command deadline and it bounds the command while the handshake keeps its own', async () => {
    // Given an endpoint that never answers the navigation
    const endpoint = track(await startFakeCdpEndpoint())
    // When the client is opened with a five-second handshake and a 40 ms command budget
    const client = await CdpClient.connect(endpoint.wsUrl, { handshakeTimeoutMs: 5_000, commandTimeoutMs: 40 })
    // Then the command gives up on the command budget, not on the handshake one
    await expect(client.send('Page.navigate', { url: 'https://a.test/' })).rejects.toThrow('timed out after 40 ms')
    client.close()
  })
})

describe('handshake budget', () => {
  it('operator points at a wedged endpoint and the handshake gives up on its own deadline', async () => {
    // Given a listener that accepts the connection and never answers the upgrade
    const silent = track(await startSilentEndpoint())
    // When the client connects with a 60 ms handshake and a five-second command budget
    const failure = await CdpClient.connect(silent.wsUrl, { handshakeTimeoutMs: 60, commandTimeoutMs: 5_000 })
      .then(() => undefined, (error: unknown) => error)
    // Then the connection itself failed on the handshake budget
    expect(failure).toBeInstanceOf(CdpError)
    expect((failure as CdpError).method).toBe('connect')
    expect((failure as CdpError).message).toMatch(/handshake has timed out/)
    expect(CDP_HANDSHAKE_TIMEOUT_MS).toBe(30_000)
  })
})

describe('closed transport', () => {
  it('operator loses the socket and the client reports itself closed', async () => {
    // Given a connected client whose endpoint then goes away
    const endpoint = track(await startFakeCdpEndpoint())
    const client = await CdpClient.connect(endpoint.wsUrl)
    // When the endpoint drops every socket
    await endpoint.close()
    // Then the client is closed and refuses further commands with the socket reason
    await vi.waitFor(() => { expect(client.closed).toBe(true) })
    await expect(client.send('Page.navigate')).rejects.toThrow('the DevTools socket closed')
  })

  it('operator closes the client and every later command names the close', async () => {
    // Given a connected client
    const endpoint = track(await startFakeCdpEndpoint())
    const client = await CdpClient.connect(endpoint.wsUrl)
    // When the caller closes it
    client.close()
    // Then it reports closed and refuses further commands with that reason
    expect(client.closed).toBe(true)
    await expect(client.send('Page.navigate')).rejects.toThrow('the DevTools client was closed')
  })
})
