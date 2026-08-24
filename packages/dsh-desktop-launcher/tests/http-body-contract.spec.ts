/**
 * HTTP failure contract after the shared writeJson migration. The create
 * route has no body reader: invalid or empty JSON bodies cannot fail it and
 * are answered with the normal success envelope (a failure-looking body
 * never reaches createDesktopShortcut). Refusals keep the loopback fence at
 * the route layer, now written through the shared writer with the family
 * JSON headers.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { makeRoutes, type CommandRunner } from '../src/routes.ts'
import { makeShutdownRoute } from '../src/shutdown-routes.ts'
import { LAUNCHER_API } from '../src/protocol.ts'

const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-http-contract-'))
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

const run: CommandRunner = async () => ({ code: 0, stderr: '' })
const { routes } = makeRoutes({
  resolveSpec: () => ({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' }),
  homeDir: dir,
  dshHomeDir: dir,
  platform: 'linux',
  run,
})
const create = routes.find(route => route.kind === 'exact' && route.path === LAUNCHER_API.create)!

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

/** One fake IncomingMessage with an optional raw body and a destroy spy. */
function fakeReq(options: { method?: string; remoteAddress?: string; headers?: Record<string, string>; rawBody?: string } = {}): { req: IncomingMessage; destroy: ReturnType<typeof vi.fn> } {
  const rawBody = options.rawBody
  const destroy = vi.fn()
  const req = {
    method: options.method ?? 'POST',
    url: LAUNCHER_API.create,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: '127.0.0.1:3080',
      ...(rawBody === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
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

describe('json response and body-tolerance contract', () => {
  it('refuses non-loopback clients with the JSON envelope and family headers', async () => {
    const { req } = fakeReq({ remoteAddress: '192.168.1.20' })
    const { res, state } = fakeRes()
    await create.handler(req, res)
    expect(state.status).toBe(403)
    expect(JSON.parse(state.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
  })

  it('answers 405 for wrong methods without reading the body', async () => {
    const { req } = fakeReq({ method: 'GET' })
    const { res, state } = fakeRes()
    await create.handler(req, res)
    expect(state.status).toBe(405)
    expect(JSON.parse(state.body)).toEqual({ error: 'method not allowed: GET' })
  })

  it('ignores an invalid JSON body (no body reader on the create route)', async () => {
    const { req, destroy } = fakeReq({ rawBody: '{not json' })
    const { res, state } = fakeRes()
    await create.handler(req, res)
    expect(state.status).toBe(200)
    expect((JSON.parse(state.body) as { result: { ok: boolean } }).result.ok).toBe(true)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('ignores an empty body (no body reader on the create route)', async () => {
    const { req, destroy } = fakeReq({ rawBody: '' })
    const { res, state } = fakeRes()
    await create.handler(req, res)
    expect(state.status).toBe(200)
    expect((JSON.parse(state.body) as { result: { ok: boolean } }).result.ok).toBe(true)
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('shutdown route JSON contract', () => {
  const shutdown = makeShutdownRoute({
    fence: () => false,
    requestExit: () => {},
    schedule: () => 0,
  })

  it('refuses non-loopback POSTs with the JSON envelope and family headers', async () => {
    const { req } = fakeReq()
    const { res, state } = fakeRes()
    await shutdown.handler(req, res)
    expect(state.status).toBe(403)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'forbidden' })
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
  })
})
