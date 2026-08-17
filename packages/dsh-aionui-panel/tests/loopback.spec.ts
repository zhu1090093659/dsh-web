/**
 * Loopback fence tests for the /aionui-panel routes: non-loopback clients get
 * the same 403 "forbidden: loopback-only" body dsh-ssh uses for every JSON
 * operation and for the SSE events route (before the root is gated or the
 * stream opens), while loopback clients keep working.
 */
import { describe, expect, it, vi } from 'vitest'
import { registerPanelRoutes } from '../src/host/routes.ts'

/** A minimal ctx/webServer registry harness. */
function fakeCtx(pairing?: { isPairedDevice: (req: unknown) => boolean }): {
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
    get: (name: string) => name === 'remoteWebUiPairing' ? pairing : undefined,
  }
  return { ctx, registrations }
}

interface RequestOptions {
  method?: string
  remoteAddress?: string
  host?: string
  body?: string
  cookie?: string
  on?: (event: string, handler: () => void) => void
}

/** One fake request: loopback socket + Host by default. */
function fakeRequest(url: string, options: RequestOptions = {}): Record<string, unknown> {
  const req: Record<string, unknown> = {
    method: options.method ?? 'POST',
    url,
    headers: {
      host: options.host ?? '127.0.0.1:3000',
      'content-type': 'application/json',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    on: options.on ?? vi.fn(),
  }
  if (options.body !== undefined) {
    req[Symbol.asyncIterator] = async function* iterate() {
      yield Buffer.from(options.body)
    }
  }
  return req
}

/** One fake response collecting status/headers/writes. */
function fakeResponse(): {
  res: Record<string, unknown>
  status: number
  headers: Record<string, string>
  body: string
  writes: string[]
} {
  const state = { status: 0, headers: {} as Record<string, string>, body: '', writes: [] as string[] }
  const res: Record<string, unknown> = {
    writeHead: (code: number, head: Record<string, string> = {}) => {
      state.status = code
      state.headers = { ...head }
    },
    write: (chunk: unknown) => { state.writes.push(String(chunk)) },
    end: (chunk?: unknown) => {
      if (chunk !== undefined && chunk !== null) state.writes.push(String(chunk))
      state.body = state.writes.join('')
    },
    on: vi.fn(),
  }
  return {
    res,
    get status() { return state.status },
    get headers() { return state.headers },
    get body() { return state.body },
    get writes() { return state.writes },
  }
}

/** Drive one request through a registered handler. */
async function drive(
  handler: (req: unknown, res: unknown) => Promise<void>,
  url: string,
  options: RequestOptions = {},
): Promise<{ status: number; headers: Record<string, string>; body: string; writes: string[] }> {
  const response = fakeResponse()
  await handler(fakeRequest(url, options), response.res)
  return { status: response.status, headers: response.headers, body: response.body, writes: response.writes }
}

describe('/aionui-panel loopback fence', () => {
  it('serves loopback JSON operations as before', async () => {
    const list = vi.fn(async () => ({ root: '/w', entries: [] }))
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, { list } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/list', {
      body: JSON.stringify({ root: '/w', path: '' }),
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, value: { root: '/w', entries: [] } })
    expect(list).toHaveBeenCalledWith('/w', '')
  })

  it('returns all repositories and routes git mutations to the selected repository', async () => {
    const status = { root: '/w/nested', branch: 'main', staged: [], unstaged: [], untracked: [] }
    const repositories = vi.fn(async () => [status])
    const stage = vi.fn(async () => ({ applied: ['inner.txt'], failed: [] }))
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, {} as never, { repositories, stage } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const listed = await drive(prefix.handler, '/aionui-panel/git-status', {
      body: JSON.stringify({ root: '/w' }),
    })
    const staged = await drive(prefix.handler, '/aionui-panel/git-stage', {
      body: JSON.stringify({ root: '/w', repository: '/w/nested', paths: ['inner.txt'] }),
    })

    expect(JSON.parse(listed.body)).toEqual({ ok: true, value: [status] })
    expect(JSON.parse(staged.body)).toEqual({ ok: true, value: { applied: ['inner.txt'], failed: [] } })
    expect(stage).toHaveBeenCalledWith('/w', ['inner.txt'], '/w/nested')
  })

  it('serves the full 127/8 range as loopback (unified fence)', async () => {
    const list = vi.fn(async () => ({ root: '/w', entries: [] }))
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, { list } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/list', {
      remoteAddress: '127.0.0.2',
      host: '127.0.0.2:3000',
      body: JSON.stringify({ root: '/w', path: '' }),
    })

    expect(result.status).toBe(200)
    expect(list).toHaveBeenCalledWith('/w', '')
  })
  it('rejects non-loopback JSON operations with 403 before touching the service', async () => {
    const list = vi.fn(async () => ({ root: '/w', entries: [] }))
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, { list } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/list', {
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
      body: JSON.stringify({ root: '/w', path: '' }),
    })

    expect(result.status).toBe(403)
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(list).not.toHaveBeenCalled()
  })

  it('rejects non-loopback GET /aionui-panel/raw with 403', async () => {
    const readRaw = vi.fn(async () => ({ abs: '/w/a.txt', mime: 'text/plain', size: 1, mtime: 1 }))
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, { readRaw } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/raw?root=%2Fw&path=a.txt', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
    })

    expect(result.status).toBe(403)
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(readRaw).not.toHaveBeenCalled()
  })

  it('rejects non-loopback SSE before gating the root or opening the stream', async () => {
    const verify = vi.fn(async () => ({ ok: true, canonical: '/w' }))
    const watch = vi.fn(() => () => {})
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, { verify, watch } as never, { status: async () => null } as never)
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/aionui-panel/events?root=%2Fw', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
    })

    expect(result.status).toBe(403)
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(result.writes.join('')).not.toContain('retry:')
    expect(verify).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
  })

  it('opens the SSE stream for loopback clients and gates the root', async () => {
    const verify = vi.fn(async () => ({ ok: true, canonical: '/w' }))
    const watch = vi.fn(() => () => {})
    const closeHandlers: Array<() => void> = []
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(
      ctx as never,
      { verify, watch } as never,
      { isRepository: vi.fn(async () => false), gitAvailable: vi.fn(async () => true), status: async () => null } as never,
    )
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/aionui-panel/events?root=%2Fw', {
      method: 'GET',
      on: (event, handler) => {
        if (event === 'close') closeHandlers.push(handler)
      },
    })

    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(result.writes.join('')).toContain('retry: 2000')
    expect(verify).toHaveBeenCalledWith('/w')
    expect(watch).toHaveBeenCalledWith('/w', expect.any(Function))
    for (const close of closeHandlers) close()
  })

  it('allows a non-loopback JSON operation when pairing reports a live device', async () => {
    const list = vi.fn(async () => ({ root: '/w', entries: [] }))
    const isPairedDevice = vi.fn(() => true)
    const { ctx, registrations } = fakeCtx({ isPairedDevice })
    registerPanelRoutes(ctx as never, { list } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/list', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
      body: JSON.stringify({ root: '/w', path: '' }),
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, value: { root: '/w', entries: [] } })
    expect(list).toHaveBeenCalledWith('/w', '')
    expect(isPairedDevice).toHaveBeenCalled()
  })

  it('still rejects a non-loopback JSON operation when pairing reports false', async () => {
    const list = vi.fn(async () => ({ root: '/w', entries: [] }))
    const { ctx, registrations } = fakeCtx({ isPairedDevice: () => false })
    registerPanelRoutes(ctx as never, { list } as never, { status: async () => null } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/aionui-panel/list', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=revoked',
      body: JSON.stringify({ root: '/w', path: '' }),
    })

    expect(result.status).toBe(403)
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(list).not.toHaveBeenCalled()
  })

  it('opens SSE for a paired non-loopback client', async () => {
    const verify = vi.fn(async () => ({ ok: true, canonical: '/w' }))
    const watch = vi.fn(() => () => {})
    const closeHandlers: Array<() => void> = []
    const { ctx, registrations } = fakeCtx({ isPairedDevice: () => true })
    registerPanelRoutes(
      ctx as never,
      { verify, watch } as never,
      { isRepository: vi.fn(async () => false), gitAvailable: vi.fn(async () => true), status: async () => null } as never,
    )
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/aionui-panel/events?root=%2Fw', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
      on: (event, handler) => {
        if (event === 'close') closeHandlers.push(handler)
      },
    })

    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(verify).toHaveBeenCalledWith('/w')
    for (const close of closeHandlers) close()
  })
})
