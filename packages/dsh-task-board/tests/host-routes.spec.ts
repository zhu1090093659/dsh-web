import { createServer, request, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTaskBoardRoutes } from '../src/host-routes.ts'
import type { TaskBoardHostService } from '../src/host-service.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 3,
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

  it('accepts only an allowlisted same-origin proxy Host with its server token', async () => {
    const service = {
      snapshot: () => snapshot,
      apply,
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

