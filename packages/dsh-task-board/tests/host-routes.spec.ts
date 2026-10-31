import { createServer, request, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HEARTBEAT_MS, makeTaskBoardRoutes } from '../src/host-routes.ts'
import type { TaskBoardHostService } from '../src/host-service.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 7,
  revision: 0,
  tasks: [],
  scheduler: { timeZone: 'UTC' },
  power: {
    platform: 'linux', phase: 'unsupported', enabled: false,
    runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
  },
}

async function requestStatus(url: string, headers: Record<string, string>): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const outgoing = request(url, { headers }, response => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode ?? 0) })
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

describe('task-board HTTP routes', () => {
  let server: Server
  let base: string
  const apply = vi.fn(() => snapshot)

  beforeEach(async () => {
    apply.mockClear()
    const service = {
      snapshot: () => snapshot,
      apply,
      applyVerified: apply,
      ledger: { allTasks: () => [] },
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routes = makeTaskBoardRoutes(service)
    server = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    base = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) })
  })

  it('accepts loopback JSON mutations and rejects cross-origin, non-JSON, and unknown fields', async () => {
    const valid = { requestId: 'request-a', action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } } }
    const actionResponse = await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(valid),
    })
    expect(actionResponse.status).toBe(200)
    expect(actionResponse.headers.get('referrer-policy')).toBe('no-referrer')
    expect(actionResponse.headers.get('cache-control')).toBe('no-store')
    expect(apply).toHaveBeenCalledOnce()

    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid),
    })).status).toBe(403)
    const forbiddenState = await fetch(`${base}/api/task-board/state`)
    expect(forbiddenState.status).toBe(403)
    expect(forbiddenState.headers.get('referrer-policy')).toBe('no-referrer')
    expect(forbiddenState.headers.get('cache-control')).toBe('no-store')
    expect((await fetch(`${base}/api/task-board/events`)).status).toBe(403)
    const stateResponse = await fetch(`${base}/api/task-board/state`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    expect(stateResponse.status).toBe(200)
    expect(stateResponse.headers.get('referrer-policy')).toBe('no-referrer')
    expect(stateResponse.headers.get('cache-control')).toBe('no-store')

    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.invalid' }, body: JSON.stringify(valid),
    })).status).toBe(403)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base.replace('http:', 'https:') }, body: JSON.stringify(valid),
    })).status).toBe(200)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(valid),
    })).status).toBe(415)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({
        requestId: 'request-b', action: { kind: 'run', taskId: 'task-a', command: 'cmd.exe' },
      }),
    })).status).toBe(400)
  })

  it('operator sees the Desktop shell forward accepted through its browser-auth cookie', async () => {
    // Given the official DSH Desktop shell, which serves the panel from
    // dsh-app://app/ and re-issues its requests to this Host itself: origin
    // and sec-fetch-site are deleted on the way, and the authority-bound
    // browser-auth cookie the shell redeemed from the Host's launch URL is
    // attached instead.
    const shellCookie = { cookie: 'dsh-auth-cG9ydA=v1.body.signature' }
    // When the panel reads its state and submits an action through that
    // forward,
    const state = await requestStatus(`${base}/api/task-board/state`, shellCookie)
    const action = await fetch(`${base}/api/task-board/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...shellCookie },
      body: JSON.stringify({ requestId: 'request-desktop', action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } } }),
    })
    // Then both reach the board, while the credential stays a signal and not an
    // authority: an explicit cross-site marker loses, and a marker-less request
    // without the credential stays refused.
    expect(state).toBe(200)
    expect(action.status).toBe(200)
    expect(await requestStatus(`${base}/api/task-board/state`, { ...shellCookie, 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(await requestStatus(`${base}/api/task-board/state`, {})).toBe(403)
    expect(await requestStatus(`${base}/api/task-board/state`, { cookie: 'theme=dark' })).toBe(403)
  })

  it('accepts only an allowlisted same-origin proxy Host with its server token', async () => {
    const service = {
      snapshot: () => snapshot,
      apply,
      applyVerified: apply,
      ledger: { allTasks: () => [] },
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routes = makeTaskBoardRoutes(service, { trustedProxyHosts: ['tasks.example.test'], proxyToken: 'server-secret' })
    const proxy = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { proxy.listen(0, '127.0.0.1', resolve) })
    const address = proxy.address()
    if (address === null || typeof address === 'string') throw new Error('proxy test server did not bind')
    const url = `http://127.0.0.1:${address.port}/api/task-board/state`
    try {
      const browserHeaders = {
        host: 'tasks.example.test',
        origin: 'https://tasks.example.test',
        'sec-fetch-site': 'same-origin',
      }
      expect(await requestStatus(url, browserHeaders)).toBe(403)
      expect(await requestStatus(url, { ...browserHeaders, 'x-dsh-task-board-proxy-token': 'wrong' })).toBe(403)
      expect(await requestStatus(url, { ...browserHeaders, 'x-dsh-task-board-proxy-token': 'server-secret' })).toBe(200)
      expect(await requestStatus(url, {
        ...browserHeaders,
        origin: 'https://evil.example.test',
        'x-dsh-task-board-proxy-token': 'server-secret',
      })).toBe(403)
    } finally {
      await new Promise<void>((resolve, reject) => { proxy.close(error => { if (error) reject(error); else resolve() }) })
    }
  })

  it('enforces the 64 KiB ordinary-action limit', async () => {
    const response = await fetch(`${base}/api/task-board/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({
        requestId: 'large',
        action: { kind: 'create', id: 'task-a', input: { title: 'A'.repeat(70 * 1024), description: '', prompt: '' } },
      }),
    })
    expect(response.status).toBe(413)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(apply).not.toHaveBeenCalled()
  })

  it('pushes an event frame with revision/scheduler/power and no task list', async () => {
    const frame = {
      revision: 3,
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-a', lastTickAt: 7 },
      power: snapshot.power,
    }
    const service = {
      snapshot: () => snapshot,
      apply,
      eventPayload: () => frame,
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routes = makeTaskBoardRoutes(service)
    const stream = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { stream.listen(0, '127.0.0.1', resolve) })
    const address = stream.address()
    if (address === null || typeof address === 'string') throw new Error('SSE test server did not bind')
    try {
      const received = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const outgoing = request(`http://127.0.0.1:${address.port}/api/task-board/events`, {
          headers: { 'sec-fetch-site': 'same-origin' },
        }, response => {
          let buffer = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            buffer += chunk
            const line = buffer.split('\n').find(entry => entry.startsWith('data: '))
            if (line !== undefined) {
              outgoing.destroy()
              resolve(JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
            }
          })
          response.once('error', reject)
        })
        outgoing.once('error', reject)
        outgoing.end()
      })
      expect(received).toEqual(frame)
      expect(received).not.toHaveProperty('tasks')
    } finally {
      await new Promise<void>((resolve, reject) => { stream.close(error => { if (error) reject(error); else resolve() }) })
    }
  })
})

describe('task-board parse route (#1540)', () => {
  let server: Server
  let base: string
  let parseTask: ReturnType<typeof vi.fn>
  let closeServer: () => Promise<void>

  async function start(options: { parseTask?: unknown; omit?: boolean } = {}): Promise<void> {
    const service = {
      snapshot: () => snapshot,
      apply: () => snapshot,
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routeOptions = options.omit === true ? {} : { parseTask: (options.parseTask ?? parseTask) as never }
    const routes = makeTaskBoardRoutes(service, {}, routeOptions)
    server = createServer((req, res) => {
      const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
      if (route === undefined) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    base = `http://127.0.0.1:${address.port}`
    closeServer = async () => {
      if (!server.listening) return
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  }

  beforeEach(() => {
    parseTask = vi.fn(async () => ({ title: 'Parsed', description: 'From the model', prompt: 'Do it' }))
  })

  afterEach(async () => { await closeServer() })

  function post(body: unknown, headers: Record<string, string> = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }): Promise<Response> {
    return fetch(`${base}/api/task-board/parse`, { method: 'POST', headers, body: JSON.stringify(body) })
  }

  it('answers the draft the Host parser produced', async () => {
    await start()
    const response = await post({ text: 'pasted note', model: 'deepseek/deepseek-chat' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, draft: { title: 'Parsed', description: 'From the model', prompt: 'Do it' } })
    expect(parseTask).toHaveBeenCalledOnce()
    expect(parseTask.mock.calls[0]![0]).toEqual({ text: 'pasted note', model: 'deepseek/deepseek-chat' })
    expect(parseTask.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
  })

  it('keeps the same fence as the rest of the API', async () => {
    await start()
    expect((await post({ text: 'pasted note' }, { 'content-type': 'application/json' })).status).toBe(403)
    expect((await post({ text: 'pasted note' }, { 'sec-fetch-site': 'same-origin' })).status).toBe(415)
    expect(parseTask).not.toHaveBeenCalled()
  })

  it('rejects bodies that carry no usable text', async () => {
    await start()
    expect((await post({ text: '   ' })).status).toBe(400)
    expect((await post({ model: 'deepseek/deepseek-chat' })).status).toBe(400)
    expect((await post({ text: 42 })).status).toBe(400)
    expect((await fetch(`${base}/api/task-board/parse`, { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(405)
  })

  it('refuses a paste larger than the parse budget', async () => {
    await start()
    expect((await post({ text: 'x'.repeat(17 * 1024) })).status).toBe(413)
    expect(parseTask).not.toHaveBeenCalled()
  })

  it('maps each parse failure code onto a status and keeps the code', async () => {
    const { TaskParseError } = await import('../src/host-ai.ts')
    for (const [code, status] of [['no-model', 503], ['parse-failed', 502], ['model-error', 502], ['timeout', 504]] as const) {
      parseTask = vi.fn(async () => { throw new TaskParseError(code, `failed: ${code}`) })
      await start()
      const response = await post({ text: 'pasted note', model: 'p/m' })
      expect(response.status, code).toBe(status)
      expect(await response.json()).toMatchObject({ ok: false, code })
    }
  })

  it('answers a typed no-model failure when the deployment has no parse face', async () => {
    await start({ omit: true })
    const response = await post({ text: 'pasted note' })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, code: 'no-model' })
  })
})


/**
 * A pushed frame is the panel's normal way of learning that the Host moved, and
 * it is only useful if it arrives. These cases pin the two ways a stream stops
 * being useful while neither end closes it: a write that fails, and an error
 * event on the response. Either must release the connection so the browser's
 * EventSource reports an error — that error is the panel's cue to read state.
 */
describe('task-board event stream health', () => {
  /** One stream response: records every write and never closes on its own. */
  class FakeStreamResponse {
    readonly written: string[] = []
    readonly listeners = new Map<string, Array<(argument?: unknown) => void>>()
    writableEnded = false
    destroyed = false
    lastWriteCallback: ((error?: Error | null) => void) | undefined
    writeHead(): this { return this }
    once(event: string, listener: (argument?: unknown) => void): this { return this.on(event, listener) }
    on(event: string, listener: (argument?: unknown) => void): this {
      const existing = this.listeners.get(event)
      if (existing === undefined) this.listeners.set(event, [listener])
      else existing.push(listener)
      return this
    }
    write(chunk: unknown, callback?: (error?: Error | null) => void): boolean {
      this.written.push(String(chunk))
      this.lastWriteCallback = callback
      return true
    }
    emit(event: string, argument?: unknown): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(argument)
    }
    end(): void { this.writableEnded = true }
    destroy(): void { this.destroyed = true }
  }

  /** The request half of one stream: a direct browser on this machine. */
  class FakeStreamRequest {
    readonly method = 'GET'
    readonly headers = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:63500' }
    readonly socket = { remoteAddress: '127.0.0.1' }
    readonly listeners = new Map<string, Array<(argument?: unknown) => void>>()
    once(event: string, listener: (argument?: unknown) => void): this {
      const existing = this.listeners.get(event)
      if (existing === undefined) this.listeners.set(event, [listener])
      else existing.push(listener)
      return this
    }
    emit(event: string, argument?: unknown): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(argument)
    }
  }

  function openStream(): { response: FakeStreamResponse; unsubscribe: ReturnType<typeof vi.fn> } {
    const response = new FakeStreamResponse()
    const unsubscribe = vi.fn()
    const service = {
      eventPayload: () => ({ revision: 1, scheduler: { timeZone: 'UTC' }, power: snapshot.power }),
      subscribe: () => unsubscribe,
    } as unknown as TaskBoardHostService
    const route = makeTaskBoardRoutes(service).find(candidate => candidate.path === '/api/task-board/events')
    if (route === undefined) throw new Error('the events route is not registered')
    const handler = route.handler as unknown as (req: unknown, res: unknown) => void
    handler(new FakeStreamRequest(), response)
    return { response, unsubscribe }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("operator's stream ends when its write fails instead of writing into a dead connection", () => {
    // Given a stream that stopped accepting bytes while neither end closed it,
    const { response, unsubscribe } = openStream()
    expect(response.written).toHaveLength(1)
    // When that failure comes back to the route,
    expect(typeof response.lastWriteCallback).toBe('function')
    response.lastWriteCallback?.(new Error('write EPIPE'))
    // Then the connection is destroyed and released rather than kept silently,
    expect(response.destroyed).toBe(true)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    // and the heartbeat stops writing into it.
    const writes = response.written.length
    vi.advanceTimersByTime(HEARTBEAT_MS * 3)
    expect(response.written).toHaveLength(writes)
  })

  it("operator's stream is released when the response errors after it started", () => {
    // Given a started stream,
    const { response, unsubscribe } = openStream()
    // When the response reports an error (the socket died without a close),
    response.emit('error', new Error('read ECONNRESET'))
    // Then the subscription and the response are released.
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(response.destroyed).toBe(true)
  })
})
