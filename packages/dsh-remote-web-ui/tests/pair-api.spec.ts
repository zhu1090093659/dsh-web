/** Presence heartbeat contract: the status is surfaced so the poll can stop. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LanBindStatusError,
  readLanBindStatus,
  sendHeartbeat,
  shouldStopHeartbeat,
  shouldStopLanBindPoll,
} from '../src/client/pair-api.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('sendHeartbeat', () => {
  it('operator receives the heartbeat response status', async () => {
    // Given a server that answers the heartbeat with 200.
    const fetchStub = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    // When the phone sends a heartbeat.
    const status = await sendHeartbeat()
    // Then the caller sees the status and the request kept its contract.
    expect(status).toBe(200)
    expect(fetchStub).toHaveBeenCalledWith('/api/pair/heartbeat', { method: 'POST' })
  })

  it('operator receives a refusal status instead of a throw', async () => {
    // Given a server that refuses the heartbeat as unpaired.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    // When the phone sends a heartbeat.
    // Then the refusal is reported, not thrown: the poll decides on the status.
    await expect(sendHeartbeat()).resolves.toBe(401)
  })
})

describe('readLanBindStatus', () => {
  it('operator learns the refusal status of a loopback-only read', async () => {
    // Given a server that refuses the loopback-only endpoint.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    // When the card reads it, then the failure carries the status so the poll
    // can stop instead of retrying a refusal that can never succeed.
    await expect(readLanBindStatus()).rejects.toBeInstanceOf(LanBindStatusError)
    await expect(readLanBindStatus()).rejects.toMatchObject({ status: 403 })
  })
})

describe('shouldStopLanBindPoll', () => {
  it('operator stops the lan-bind poll only on permanent refusals', () => {
    // Given the outcomes a loopback-only read can report.
    // When the poll asks whether this origin can ever read it.
    // Then only the fence refusals stop the cadence.
    expect(shouldStopLanBindPoll(401)).toBe(true)
    expect(shouldStopLanBindPoll(403)).toBe(true)
    expect(shouldStopLanBindPoll(500)).toBe(false)
    expect(shouldStopLanBindPoll(undefined)).toBe(false)
  })
})

describe('shouldStopHeartbeat', () => {
  it('operator stops the heartbeat only on permanent refusals', () => {
    // Given the statuses a heartbeat can answer with.
    // When the poll asks whether this page can ever be accepted again.
    // Then only the permanent refusals stop it; transient answers keep the cadence.
    expect(shouldStopHeartbeat(401)).toBe(true)
    expect(shouldStopHeartbeat(403)).toBe(true)
    expect(shouldStopHeartbeat(200)).toBe(false)
    expect(shouldStopHeartbeat(429)).toBe(false)
    expect(shouldStopHeartbeat(503)).toBe(false)
  })
})
