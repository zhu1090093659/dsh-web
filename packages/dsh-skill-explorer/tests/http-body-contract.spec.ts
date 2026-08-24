/**
 * HTTP body failure contract after the shared readJsonBody/writeJson
 * migration (128 KiB object-only reader): invalid JSON, empty bodies, and
 * non-object payloads read as null and the route answers 400 with the
 * invalid-JSON error envelope. An oversized body additionally destroys the
 * request (the shared reader tears the connection down instead of draining);
 * the 400 is the route-layer answer to the null read.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ROUTES, makeRoutes } from '../src/routes.ts'

const dir = mkdtempSync(join(tmpdir(), 'skill-explorer-http-contract-'))
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

const routes = makeRoutes({} as never, {
  dshHome: join(dir, 'home'),
  agentsHome: join(dir, 'agents'),
  customSkillDirs: [],
  registry: { snapshot: async () => ({ skills: [], complete: true }) },
  activeSessionCwds: () => [],
  logger: { warn: () => {} },
})
const setEnabled = routes.find(route => route.path === ROUTES.setEnabled)!

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
    url: ROUTES.setEnabled,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: 'localhost:3080',
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
    await setEnabled.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty body without destroying the request', async () => {
    const { req, destroy } = fakeReq('')
    const { res, state } = fakeRes()
    await setEnabled.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers 400 for a non-object payload without destroying the request', async () => {
    const { req, destroy } = fakeReq('[]')
    const { res, state } = fakeRes()
    await setEnabled.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers 400 and destroys the request when the body exceeds 128 KiB', async () => {
    const { req, destroy } = fakeReq('x'.repeat(128 * 1024 + 1))
    const { res, state } = fakeRes()
    await setEnabled.handler(req, res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('writes family JSON headers through the shared writer', async () => {
    const { req, destroy } = fakeReq('{not json')
    const { res, state } = fakeRes()
    await setEnabled.handler(req, res)
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
    expect(destroy).not.toHaveBeenCalled()
  })
})
