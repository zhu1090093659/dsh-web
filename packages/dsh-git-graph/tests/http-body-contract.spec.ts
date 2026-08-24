/**
 * HTTP body failure contract after the shared readJsonBody migration (1 MiB
 * cap): invalid JSON, empty bodies, and oversized bodies read as null, the
 * handler answers with the stable malformed-request envelope, and an
 * oversized body additionally destroys the request (the shared reader tears
 * the connection down instead of draining). The envelope shape is unchanged
 * from the pre-migration reader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGitRoutes } from '../src/host/routes.ts'

/** A minimal ctx fulfilling what registerGitRoutes touches. */
function fakeCtx(): {
  ctx: Record<string, unknown>
  registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }>
} {
  const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
  const ctx = {
    logger: { warn: vi.fn() },
    webServer: {
      register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations.push(row)
        return () => {}
      },
    },
  }
  return { ctx, registrations }
}

/** One fake ServerResponse collecting status/headers/body. */
function fakeResponse(): {
  res: Record<string, unknown>
  status: number
  headers: Record<string, string>
  body: string
} {
  const state = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res: Record<string, unknown> = {
    writeHead: (code: number, head: Record<string, string> = {}) => {
      state.status = code
      state.headers = { ...head }
    },
    end: (chunk?: unknown) => { state.body = chunk === undefined || chunk === null ? '' : String(chunk) },
    on: () => {},
  }
  return {
    res,
    get status() { return state.status },
    get headers() { return state.headers },
    get body() { return state.body },
  }
}

/** One fake IncomingMessage: loopback socket + Host, optional raw body. */
function fakeRequest(rawBody?: string): { req: Record<string, unknown>; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn()
  const req: Record<string, unknown> = {
    method: 'POST',
    url: '/git/status',
    headers: {
      host: '127.0.0.1:3000',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn(),
    destroy,
  }
  if (rawBody !== undefined) {
    req[Symbol.asyncIterator] = async function* iterate() {
      if (rawBody !== '') yield Buffer.from(rawBody)
    }
  }
  return { req, destroy }
}

let ctx: ReturnType<typeof fakeCtx>['ctx']
let registrations: ReturnType<typeof fakeCtx>['registrations']

beforeEach(() => {
  const fake = fakeCtx()
  ctx = fake.ctx
  registrations = fake.registrations
  registerGitRoutes(ctx as never, { status: async () => null } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const prefix = (): { handler: (req: unknown, res: unknown) => Promise<void> } => {
  return registrations.find(row => row.kind === 'prefix')!
}


describe('json body failure contract', () => {
  it('answers the malformed envelope for invalid JSON without destroying the request', async () => {
    const { req, destroy } = fakeRequest('{not json')
    const response = fakeResponse()
    await prefix().handler(req, response.res)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: { code: 'internal', message: 'malformed request' } })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers the malformed envelope for an empty body without destroying the request', async () => {
    const { req, destroy } = fakeRequest('')
    const response = fakeResponse()
    await prefix().handler(req, response.res)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: { code: 'internal', message: 'malformed request' } })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('answers the malformed envelope and destroys the request when the body exceeds 1 MiB', async () => {
    const { req, destroy } = fakeRequest('x'.repeat(1024 * 1024 + 1))
    const response = fakeResponse()
    await prefix().handler(req, response.res)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: { code: 'internal', message: 'malformed request' } })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps the JSON content-type on the envelope response', async () => {
    const { req } = fakeRequest('{not json')
    const response = fakeResponse()
    await prefix().handler(req, response.res)
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
  })

  it('writes family JSON headers through the shared writer', async () => {
    const { req } = fakeRequest('{not json')
    const response = fakeResponse()
    await prefix().handler(req, response.res)
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })
})
