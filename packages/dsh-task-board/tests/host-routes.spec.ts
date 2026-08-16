import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTaskBoardRoutes } from '../src/host-routes.ts'
import type { TaskBoardHostService } from '../src/host-service.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 2,
  revision: 0,
  tasks: [],
  scheduler: { timeZone: 'UTC' },
  power: {
    platform: 'linux', phase: 'unsupported', enabled: false,
    runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
  },
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
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid),
    })).status).toBe(200)
    expect(apply).toHaveBeenCalledOnce()

    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.invalid' }, body: JSON.stringify(valid),
    })).status).toBe(403)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base.replace('http:', 'https:') }, body: JSON.stringify(valid),
    })).status).toBe(403)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(valid),
    })).status).toBe(415)
    expect((await fetch(`${base}/api/task-board/action`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        requestId: 'request-b', action: { kind: 'run', taskId: 'task-a', command: 'cmd.exe' },
      }),
    })).status).toBe(400)
  })

  it('enforces the 64 KiB ordinary-action limit', async () => {
    const response = await fetch(`${base}/api/task-board/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'large',
        action: { kind: 'create', id: 'task-a', input: { title: 'A'.repeat(70 * 1024), description: '', prompt: '' } },
      }),
    })
    expect(response.status).toBe(413)
    expect(apply).not.toHaveBeenCalled()
  })
})
