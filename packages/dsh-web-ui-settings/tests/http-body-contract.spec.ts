/**
 * HTTP body failure contract after the shared readJsonBody/writeJson
 * migration: invalid JSON, empty bodies, and oversized bodies read as null
 * and the mutate route answers 400 with the official-shaped refusal
 * envelope. An oversized body additionally destroys the request (the shared
 * reader tears the connection down instead of draining); the 400 is the
 * route-layer answer to the null read.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { makeBridgeRoutes } from '../src/bridge.ts'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../src/protocol.ts'

const routes = makeBridgeRoutes({
  settings: {
    describe: () => [],
    writable: true,
    mutate: async () => ({ ok: true, value: undefined, revision: 1 }),
  } as unknown as SettingsProvider,
  readSettingsYaml: () => '',
})
const mutate = routes.find(route => route.path === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate')!

/** One fake ServerResponse capturing status/headers/body. */
function fakeRes(): { res: ServerResponse; state: { status: number; headers: Record<string, unknown>; body: string } } {
  const state = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      state.status = status
      state.headers = headers
    },
    end(payload?: string) { state.body = payload ?? '' },
  } as unknown as ServerResponse
  return { res, state }
}

/** One fake IncomingMessage: loopback socket + Host, optional raw body. */
function fakeReq(rawBody?: string): { req: IncomingMessage; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn()
  const req = {
    method: 'POST',
    url: WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: '127.0.0.1:3080',
      ...(rawBody === undefined ? {} : { 'content-type': 'application/json' }),
    },
    destroy,
    ...(rawBody === undefined ? {} : {
      [Symbol.asyncIterator]: async function* iterate() {
        if (rawBody !== '') yield Buffer.from(rawBody)
      },
    }),
  } as unknown as IncomingMessage
  return { req, destroy }
}

describe('json body failure contract', () => {
  it('answers 400 for invalid JSON without destroying the request', async () => {
    const { req, destroy } = fakeReq('{not json')
    const { res, state } = fakeRes()
    await mutate.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty body without destroying the request', async () => {
    const { req, destroy } = fakeReq('')
    const { res, state } = fakeRes()
    await mutate.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers 400 and destroys the request when the body exceeds 64 KiB', async () => {
    const { req, destroy } = fakeReq('x'.repeat(64 * 1024 + 1))
    const { res, state } = fakeRes()
    await mutate.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('writes family JSON headers through the shared writer', async () => {
    const { req, destroy } = fakeReq('{not json')
    const { res, state } = fakeRes()
    await mutate.handler(req, res)
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
    expect(destroy).not.toHaveBeenCalled()
  })
})
