/**
 * Route-layer tests for /git/*: the trust fence must reject unpaired
 * non-loopback clients (JSON operations and the SSE stream alike) with the
 * same 403 body dsh-ssh uses, while loopback clients and paired-device
 * cookies keep working. Exercises the handlers through a fake ctx.webServer
 * registry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGitRoutes } from '../src/host/routes.ts'
import type { RepoStatus } from '../src/core/types.ts'

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

interface RequestOptions {
  method?: string
  remoteAddress?: string
  host?: string
  cookie?: string
  body?: string
  on?: (event: string, handler: () => void) => void
}

/** One fake IncomingMessage: loopback socket + Host by default. */
function fakeRequest(url: string, options: RequestOptions = {}): Record<string, unknown> {
  const body = options.body
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
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* iterate() {
      yield Buffer.from(body)
    }
  }
  return req
}

/** One fake ServerResponse collecting status/headers/body/writes. */
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
    on: () => {},
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

describe('/git loopback fence', () => {
  it('serves loopback clients exactly as before', async () => {
    const status = vi.fn(async () => makeStatus())
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { status } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')
    expect(prefix).toBeDefined()

    const result = await drive(prefix!.handler, '/git/status', {
      body: JSON.stringify({ path: '/w' }),
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, value: makeStatus() })
    expect(status).toHaveBeenCalledWith('/w', expect.any(AbortSignal))
  })

  it('aborts a hung direct status request and returns a stable envelope', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const status = vi.fn((_path: string, current: AbortSignal) => {
        signal = current
        return new Promise<RepoStatus | null>(() => {})
      })
      const { ctx, registrations } = fakeCtx()
      registerGitRoutes(ctx as never, { status } as never)
      const prefix = registrations.find((row) => row.kind === 'prefix')!

      const pending = drive(prefix.handler, '/git/status', {
        body: JSON.stringify({ path: '/w' }),
      })
      await vi.advanceTimersByTimeAsync(15_000)
      const result = await pending

      expect(signal?.aborted).toBe(true)
      expect(signal?.reason).toEqual(expect.objectContaining({ message: 'git status timed out' }))
      expect(JSON.parse(result.body)).toEqual({
        ok: false,
        error: { code: 'internal', message: 'git status timed out' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a structurally invalid status view at the route boundary', async () => {
    // The service is typed RepoStatus | null, but a malformed value (missing
    // the untracked/conflict/operation fields) must never leak to the client:
    // the boundary guard replaces it with a stable internal error.
    const status = vi.fn(async () => ({ root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 0 }))
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { status } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')

    const result = await drive(prefix!.handler, '/git/status', {
      body: JSON.stringify({ path: '/w' }),
    })

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({
      ok: false,
      error: { code: 'internal', message: 'malformed git response' },
    })
    expect(status).toHaveBeenCalledWith('/w', expect.any(AbortSignal))
  })

  it('clamps a graph limit above 1000 instead of resetting to the default', async () => {
    const graph = vi.fn(async () => ({ root: '/w', branch: 'main', commits: [], hasMore: false }))
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { graph } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/git/graph', {
      body: JSON.stringify({ path: '/w', limit: 1100 }),
    })

    expect(result.status).toBe(200)
    expect(graph).toHaveBeenCalledWith('/w', 1000)
    expect(JSON.parse(result.body)).toEqual({
      ok: true,
      value: { root: '/w', branch: 'main', commits: [], hasMore: false },
    })
  })

  it('rejects non-loopback JSON operations with 403 before touching the service', async () => {
    const status = vi.fn(async () => null)
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { status } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/git/status', {
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
      body: JSON.stringify({ path: '/w' }),
    })

    expect(result.status).toBe(403)
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(status).not.toHaveBeenCalled()
  })

  it('rejects non-loopback requests before method/content-type checks', async () => {
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, {} as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/git/status', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
    })

    expect(result.status).toBe(403)
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
  })

  it('rejects non-loopback SSE before opening the stream', async () => {
    const status = vi.fn(async () => null)
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { status } as never)
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/git/events?path=%2Fw', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
    })

    expect(result.status).toBe(403)
    expect(JSON.parse(result.body)).toEqual({ error: 'forbidden: loopback-only' })
    expect(result.writes.join('')).not.toContain('retry:')
    expect(status).not.toHaveBeenCalled()
  })

  it('allows a LAN client with a live paired-device cookie on JSON operations', async () => {
    const status = vi.fn(async () => makeStatus())
    const isPairedDevice = vi.fn(() => true)
    const { ctx, registrations } = fakeCtx()
    ctx.get = (name: string) => name === 'remoteWebUiPairing' ? { isPairedDevice } : undefined
    registerGitRoutes(ctx as never, { status } as never)
    const prefix = registrations.find((row) => row.kind === 'prefix')!

    const result = await drive(prefix.handler, '/git/status', {
      remoteAddress: '192.168.1.20',
      host: 'dsh.thinkmoon.cn',
      cookie: 'dsh_pair=dev-1',
      body: JSON.stringify({ path: '/w' }),
    })

    expect(result.status).toBe(200)
    expect(isPairedDevice).toHaveBeenCalled()
    expect(status).toHaveBeenCalled()
  })

  it('allows a LAN client with a live paired-device cookie on SSE', async () => {
    const closeHandlers: Array<() => void> = []
    const isPairedDevice = vi.fn(() => true)
    const { ctx, registrations } = fakeCtx()
    ctx.get = (name: string) => name === 'remoteWebUiPairing' ? { isPairedDevice } : undefined
    registerGitRoutes(ctx as never, { status: async () => null } as never)
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/git/events?path=%2Fw', {
      method: 'GET',
      remoteAddress: '192.168.1.20',
      host: 'dsh.thinkmoon.cn',
      cookie: 'dsh_pair=dev-1',
      on: (event, handler) => {
        if (event === 'close') closeHandlers.push(handler)
      },
    })

    expect(result.status).toBe(200)
    expect(result.writes.join('')).toContain('retry: 2000')
    expect(isPairedDevice).toHaveBeenCalled()
    for (const close of closeHandlers) close()
  })

  it('still opens the SSE stream for loopback clients', async () => {
    const closeHandlers: Array<() => void> = []
    const { ctx, registrations } = fakeCtx()
    registerGitRoutes(ctx as never, { status: async () => null } as never)
    const sse = registrations.find((row) => row.kind === 'exact')!

    const result = await drive(sse.handler, '/git/events?path=%2Fw', {
      method: 'GET',
      on: (event, handler) => {
        if (event === 'close') closeHandlers.push(handler)
      },
    })

    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(result.writes.join('')).toContain('retry: 2000')
    for (const close of closeHandlers) close()
  })
})

/** Minimal SSE poll harness exposing the exact SSE handler and the fake service. */
function makePollEnv(): {
  sse: (req: unknown, res: unknown) => Promise<void>
  status: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
  const warn = vi.fn()
  const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
  const ctx = {
    logger: { warn },
    webServer: {
      register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations.push(row)
        return () => {}
      },
    },
  }
  const status = vi.fn()
  registerGitRoutes(ctx as never, { status } as never)
  const sse = registrations.find((row) => row.kind === 'exact')
  if (sse === undefined) throw new Error('SSE route not registered')
  return { sse: sse.handler, status, warn }
}

/** Open one SSE connection; collect the bytes the host writes and a close trigger. */
function connect(sse: (req: unknown, res: unknown) => Promise<void>): { writes: string[]; close: () => void } {
  const writes: string[] = []
  const closeHandlers: Array<() => void> = []
  const res = {
    writeHead: () => {},
    write: (chunk: unknown) => { writes.push(String(chunk)) },
    end: () => {},
    on: () => {},
  }
  const req = {
    url: '/git/events?path=%2Fw',
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler)
    },
  }
  sse(req as never, res as never)
  return {
    writes,
    close: () => { for (const handler of closeHandlers) handler() },
  }
}

/** A legal repository snapshot the fake service can return. */
function makeStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 0, untrackedFiles: 0,
    conflicts: 0, operationInProgress: false,
    ...overrides,
  }
}

/** Count the `event: change` SSE pushes in the collected writes. */
function changeEvents(writes: string[]): number {
  return writes.filter((write) => write.startsWith('event: change')).length
}

describe('SSE poll loop', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('polls status once after one tick and pushes a change', async () => {
    const env = makePollEnv()
    env.status.mockResolvedValue(makeStatus())
    const conn = connect(env.sse)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(env.status).toHaveBeenCalledTimes(1)
    expect(env.status).toHaveBeenCalledWith('/w', expect.any(AbortSignal))
    expect(changeEvents(conn.writes)).toBe(1)
    conn.close()
  })

  it('does not re-push if the status is unchanged on the next tick', async () => {
    const env = makePollEnv()
    env.status.mockResolvedValue(makeStatus())
    const conn = connect(env.sse)

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(env.status).toHaveBeenCalledTimes(2)
    expect(changeEvents(conn.writes)).toBe(1)
    conn.close()
  })

  it('releases the guard when a slow status settles before the deadline, then resumes', async () => {
    // The route deadline is shorter than the poll interval, so a slow status
    // cannot straddle the next tick: once it settles (or the 15s deadline
    // fires), the finally clears the guard and the next tick polls again.
    // Here the status settles inside the deadline with no timeout warn.
    const env = makePollEnv()
    let releaseSlow!: (status: RepoStatus | null) => void
    env.status
      .mockImplementationOnce(() => new Promise<RepoStatus | null>((resolve) => { releaseSlow = resolve }))
      .mockResolvedValue(makeStatus())
    const conn = connect(env.sse)

    // tick1 at 30s starts the slow status; no second call is stacked on it.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(1)
    expect(releaseSlow).toBeTypeOf('function')

    // The slow status settles before the 15s deadline; the guard releases.
    releaseSlow(makeStatus())
    await vi.advanceTimersByTimeAsync(15_000)
    expect(env.warn).not.toHaveBeenCalled()

    // Next tick at 60s polls again.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(2)
    conn.close()
  })

  it('times out a hung status at 15s, warns, and recovers on the next tick', async () => {
    const env = makePollEnv()
    let signal: AbortSignal | undefined
    env.status
      .mockImplementationOnce((_path: string, current: AbortSignal) => {
        signal = current
        return new Promise<RepoStatus | null>(() => {})
      })
      .mockResolvedValue(makeStatus())
    const conn = connect(env.sse)

    // tick1 at 30s starts a status that never resolves; without the route
    // deadline the overlap guard would wedge polling forever.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(1)

    // The 15s deadline fires the race rejection; the catch warns and the
    // finally resets the guard.
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toEqual(expect.objectContaining({ message: 'git status timed out' }))
    expect(env.warn).toHaveBeenCalledTimes(1)
    expect(env.warn).toHaveBeenCalledWith(expect.stringContaining('git status timed out'))

    // tick2 at 60s is no longer blocked by a stuck guard: poll runs again.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(2)
    conn.close()
  })

  it('stops polling when the last subscriber closes', async () => {
    const env = makePollEnv()
    env.status.mockResolvedValue(makeStatus())
    const conn = connect(env.sse)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(1)
    conn.close()

    // With zero subscribers the PollGuard is stopped; no further ticks fire.
    await vi.advanceTimersByTimeAsync(90_000)
    expect(env.status).toHaveBeenCalledTimes(1)
  })

  it('resumes polling when a subscriber reconnects after the loop stopped', async () => {
    const env = makePollEnv()
    env.status.mockResolvedValue(makeStatus())
    const first = connect(env.sse)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(1)
    first.close()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(env.status).toHaveBeenCalledTimes(1)

    // A fresh connection creates and starts a new guard: polling resumes.
    const second = connect(env.sse)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.status).toHaveBeenCalledTimes(2)
    second.close()
  })
})
