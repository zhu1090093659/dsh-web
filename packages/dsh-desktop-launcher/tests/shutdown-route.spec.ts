/**
 * The /api/dsh-desktop-launcher/shutdown route contract: method gate, loopback
 * fence, and the deferred exit request (response first, exit a beat later).
 */

import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EXIT_DELAY_MS, makeShutdownRoute } from '../src/shutdown-routes.ts'

/** Capture the response state written by a handler. */
function fakeRes() {
  const state: { status: number; headers: Record<string, unknown>; body: string } = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      state.status = status
      state.headers = headers ?? {}
    },
    end: (body?: string) => { state.body = body ?? '' },
  } as unknown as ServerResponse
  return { state, res }
}

/** Build a minimal loopback-looking request. */
function fakeReq(method: string, extra: Record<string, unknown> = {}): IncomingMessage {
  return {
    method,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080', ...extra },
  } as unknown as IncomingMessage
}

describe('makeShutdownRoute', () => {
  it('rejects non-POST requests without scheduling an exit', () => {
    const scheduled: Array<() => void> = []
    const exits: number[] = []
    const route = makeShutdownRoute({
      fence: () => true,
      requestExit: code => { exits.push(code) },
      schedule: fn => { scheduled.push(fn); return 0 },
    })
    const { state, res } = fakeRes()
    void route.handler(fakeReq('GET'), res)
    expect(state.status).toBe(405)
    expect(exits).toEqual([])
    expect(scheduled).toEqual([])
  })

  it('rejects non-loopback requests with 403 and never exits', () => {
    const scheduled: Array<() => void> = []
    const exits: number[] = []
    const route = makeShutdownRoute({
      fence: () => false,
      requestExit: code => { exits.push(code) },
      schedule: fn => { scheduled.push(fn); return 0 },
    })
    const { state, res } = fakeRes()
    void route.handler(fakeReq('POST', { host: '192.168.1.5:3080' }), res)
    expect(state.status).toBe(403)
    expect(exits).toEqual([])
    expect(scheduled).toEqual([])
  })

  it('acknowledges a loopback POST, then requests exit after the flush beat', () => {
    const scheduled: Array<() => void> = []
    const exits: number[] = []
    const route = makeShutdownRoute({
      fence: () => true,
      requestExit: code => { exits.push(code) },
      schedule: (fn, ms) => { scheduled.push(fn); return ms },
    })
    const { state, res } = fakeRes()
    void route.handler(fakeReq('POST'), res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ ok: true })
    // Response already written; the exit waits for the flush beat.
    expect(exits).toEqual([])
    expect(scheduled).toHaveLength(1)
    scheduled[0]!()
    expect(exits).toEqual([0])
  })

  it('schedules the exit with the documented delay', () => {
    const delays: number[] = []
    const route = makeShutdownRoute({
      fence: () => true,
      requestExit: () => {},
      schedule: (_fn, ms) => { delays.push(ms); return 0 },
    })
    const { res } = fakeRes()
    void route.handler(fakeReq('POST'), res)
    expect(delays).toEqual([EXIT_DELAY_MS])
  })
})