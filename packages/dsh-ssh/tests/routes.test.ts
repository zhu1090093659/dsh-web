/**
 * Route-layer tests: the loopback fence, hosts CRUD dispatch (single handler
 * per path), upload NDJSON framing, download headers, and the terminal
 * upgrade bridge speaking real RFC 6455 WebSocket frames.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeRoutes } from '../src/routes.ts'
import { HostStore } from '../src/store.ts'
import { SSH_API, type SshHostSummary } from '../src/protocol.ts'
import { SshEngine, type PoolRecord, type ShellSession } from '../src/engine.ts'

/** In-memory engine stub for route-level tests. */
class StubEngine {
  hosts: SshHostSummary[] = []
  uploadBytes = 0
  uploadError: Error | undefined
  openShellSession: ShellSession | undefined
  shellInputs: string[] = []
  dropAliasCalls: string[] = []

  list(): SshHostSummary[] {
    return this.hosts
  }
  find(): SshHostSummary | undefined {
    return undefined
  }
  async exec(): Promise<{ success: boolean; exitCode: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }> {
    return { success: true, exitCode: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 }
  }
  async cluster(): Promise<unknown[]> {
    return []
  }
  async upload(): Promise<{ bytes: number; files: number }> {
    if (this.uploadError !== undefined) throw this.uploadError
    return { bytes: this.uploadBytes, files: 1 }
  }
  /** Mode of the staged destination file, recorded when download writes it. */
  downloadMode: number | undefined

  async download(_alias: string, _remotePath: string, localPath: string): Promise<{ bytes: number }> {
    // Materialize the staged file the download route streams out.
    this.downloadMode = statSync(localPath).mode & 0o777
    writeFileSync(localPath, 'hello', 'utf8')
    return { bytes: 5 }
  }
  async ls(): Promise<unknown[]> {
    return []
  }
  listTunnels(): unknown[] {
    return []
  }
  async startTunnel(): Promise<unknown> {
    throw new Error('n/a')
  }
  stopTunnel(): boolean {
    return false
  }
  stopAllTunnels(): number {
    return 0
  }
  dropAlias(alias: string): void {
    this.dropAliasCalls.push(alias)
  }
  openShellCallback?: (name: string, instructions: string, lang: string, prompts: Array<{ prompt: string; echo: boolean }>, finish: (res: string[]) => void) => void
  async openShell(_alias: string, _size: unknown, onKeyboardInteractive?: (name: string, instructions: string, lang: string, prompts: Array<{ prompt: string; echo: boolean }>, finish: (res: string[]) => void) => void): Promise<ShellSession> {
    this.openShellCallback = onKeyboardInteractive
    const session: ShellSession = {
      send: (data) => { this.shellInputs.push(data) },
      resize: () => undefined,
      close: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
    }
    this.openShellSession = session
    return session
  }
  async test(): Promise<{ ok: boolean }> {
    return { ok: true }
  }
}

const engine = (stub: StubEngine): SshEngine => stub as unknown as SshEngine

let server: Server
let port: number
let store: HostStore
let stub: StubEngine
const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-routes-'))

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => {
      let text = ''
      res.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  store = new HostStore(join(dir, 'hosts.json'))
  stub = new StubEngine()
  const { routes, upgrade } = makeRoutes({ store, engine: engine(stub), stagingDir: join(dir, 'staging'), maxUploadBytes: 64 })
  server = createServer((req, res) => {
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    const route = routes.find(r => r.kind === 'exact' && r.path === rawPath)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  server.on('upgrade', (req, socket, head) => {
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    if (rawPath === SSH_API.terminal) {
      upgrade.handler(req, socket, head)
    } else {
      socket.destroy()
    }
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
  rmSync(dir, { recursive: true, force: true })
})

describe('loopback fence', () => {
  it('rejects cross-site requests with 403', async () => {
    const result = await get(SSH_API.hosts, { 'sec-fetch-site': 'cross-site' })
    expect(result.status).toBe(403)
  })

  it('rejects non-loopback Host headers with 403', async () => {
    const result = await get(SSH_API.hosts, { host: 'evil.example.com' })
    expect(result.status).toBe(403)
  })

  it('rejects wrong methods with 405', async () => {
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: SSH_API.download + '?alias=a&remotePath=/x', method: 'POST' }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      })
      req.on('error', reject)
      req.end()
    })
    expect(result.status).toBe(405)
  })
})

describe('host connection trust', () => {
  it('operator through a Host-admitted reverse proxy reaches the hosts API', async () => {
    // Given a forwarded request that the legacy loopback fence would reject
    const requestRejection = vi.fn(() => undefined)
    const made = makeRoutes({
      store: new HostStore(join(dir, 'trusted-proxy-hosts.json')),
      engine: engine(new StubEngine()),
      stagingDir: join(dir, 'trusted-proxy-staging'),
      connection: () => ({ requestRejection }),
    })
    const { req } = fakeJsonRequest(SSH_API.hosts, undefined, 'GET')
    req.headers['x-forwarded-for'] = '203.0.113.20'
    // When the Host connection service admits the request
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, made.routes).handler(req, res)
    // Then the API answers normally and the Host decision was consulted
    expect(state.status).toBe(200)
    expect(requestRejection).toHaveBeenCalledWith(req)
    expect(made.routes.every(route => 'auth' in route && route.auth === 'anonymous')).toBe(true)
    expect(made.upgrade).toMatchObject({ auth: 'anonymous' })
    made.terminalSessions.dispose()
  })

  it('operator through an untrusted reverse proxy keeps the 403 refusal', async () => {
    // Given a forwarded request the Host connection service rejects
    const made = makeRoutes({
      store: new HostStore(join(dir, 'untrusted-proxy-hosts.json')),
      engine: engine(new StubEngine()),
      stagingDir: join(dir, 'untrusted-proxy-staging'),
      connection: () => ({ requestRejection: () => 403 }),
    })
    const { req } = fakeJsonRequest(SSH_API.hosts, undefined, 'GET')
    req.headers['x-forwarded-for'] = '203.0.113.20'
    // When the hosts API checks admission
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, made.routes).handler(req, res)
    // Then the pre-existing fence still refuses it
    expect(state.status).toBe(403)
    made.terminalSessions.dispose()
  })
})

describe('managed key API (#2069)', () => {
  it('operator creates a key, assigns it to a host and deletes only the managed record', async () => {
    // Given one local path registered through the real HTTP route
    const keyPath = join(dir, 'route-managed-key')
    writeFileSync(keyPath, 'fixture-not-a-private-key')
    const createdResponse = await fetch('http://127.0.0.1:' + port + SSH_API.keys, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Route key', path: keyPath, passphrase: 'route-secret' }),
    })
    const createdBody = await createdResponse.json() as any
    expect(createdResponse.status).toBe(201)
    expect(createdBody.key).toMatchObject({ path: keyPath, hasPassphrase: true, exists: true })
    expect(JSON.stringify(createdBody)).not.toContain('route-secret')
    // When a host selects that managed key
    const hostResponse = await fetch('http://127.0.0.1:' + port + SSH_API.hosts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        alias: 'managed-route', host: '127.0.0.2', user: 'root',
        managedKeyId: createdBody.key.id, auth: { kind: 'key', keyPath: '/ignored' },
      }),
    })
    const hostBody = await hostResponse.json() as any
    // Then the browser receives the panel path and the Host stores the managed passphrase
    expect(hostResponse.status).toBe(201)
    expect(hostBody.host.keyPath).toBe(keyPath)
    expect(store.find('managed-route')?.auth.passphrase).toBe('route-secret')
    const listed = await (await fetch('http://127.0.0.1:' + port + SSH_API.keys)).json() as any
    expect(listed.keys[0].usedBy).toEqual(['managed-route'])
    // And deleting the managed record never rewrites the host
    await fetch('http://127.0.0.1:' + port + SSH_API.keys + '?id=' + createdBody.key.id, { method: 'DELETE' })
    expect(store.find('managed-route')?.auth.keyPath).toBe(keyPath)
    store.delete('managed-route')
  })
})

describe('hosts CRUD (one handler per path)', () => {
  it('creates, lists, patches, and deletes through the shared route', async () => {
    const create = await fetch('http://127.0.0.1:' + port + SSH_API.hosts, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        alias: 'web-01',
        host: '10.0.0.1',
        user: 'root',
        auth: { kind: 'password', password: 'pw' },
      }),
    })
    expect(create.status).toBe(201)
    expect(store.list()).toHaveLength(1)
    expect(store.find('web-01')?.auth.password).toBe('pw')

    // The GET surface lists through the engine; the summary never carries secrets.
    stub.hosts = [store.summarize(store.find('web-01')!)]
    const list = await fetch('http://127.0.0.1:' + port + SSH_API.hosts)
    expect(list.status).toBe(200)
    const body = await list.json() as { hosts: SshHostSummary[] }
    expect(body.hosts).toHaveLength(1)
    expect(body.hosts[0]?.alias).toBe('web-01')
    expect('password' in body.hosts[0]!).toBe(false)

    const patch = await fetch('http://127.0.0.1:' + port + SSH_API.hosts + '?alias=web-01', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'renewed' }),
    })
    expect(patch.status).toBe(200)
    expect(store.find('web-01')?.description).toBe('renewed')
    expect(store.find('web-01')?.auth.password).toBe('pw')
    // Metadata-only patches keep the pooled connection alive.
    expect(stub.dropAliasCalls).toHaveLength(0)

    // Credential changes invalidate the pooled connection immediately.
    const authPatch = await fetch('http://127.0.0.1:' + port + SSH_API.hosts + '?alias=web-01', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auth: { kind: 'password', password: 'pw2' } }),
    })
    expect(authPatch.status).toBe(200)
    expect(stub.dropAliasCalls).toEqual(['web-01'])

    // A transport change (ProxyCommand) is just as connection-relevant.
    const proxyPatch = await fetch('http://127.0.0.1:' + port + SSH_API.hosts + '?alias=web-01', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxyCommand: 'corp proxy %h %p' }),
    })
    expect(proxyPatch.status).toBe(200)
    expect(store.find('web-01')?.proxyCommand).toBe('corp proxy %h %p')
    expect(stub.dropAliasCalls).toEqual(['web-01', 'web-01'])

    const del = await fetch('http://127.0.0.1:' + port + SSH_API.hosts + '?alias=web-01', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(store.list()).toHaveLength(0)
    expect(stub.dropAliasCalls).toEqual(['web-01', 'web-01', 'web-01'])
  })

  it('rejects unknown methods on the hosts path with 405', async () => {
    await get(SSH_API.hosts, {})
    // GET via httpRequest has no body; use OPTIONS to hit the fallback.
    const options = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: SSH_API.hosts, method: 'OPTIONS' }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      })
      req.on('error', reject)
      req.end()
    })
    expect(options.status).toBe(405)
  })
})

describe('upload', () => {
  it('streams progress and result frames as NDJSON', async () => {
    stub.uploadBytes = 7
    const res = await fetch('http://127.0.0.1:' + port + SSH_API.upload + '?alias=web-01&remotePath=/tmp/x.txt', {
      method: 'POST',
      body: 'payload',
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.some(line => line.type === 'progress')).toBe(true)
    const result = lines.find(line => line.type === 'result')
    expect(result?.ok).toBe(true)
  })

  it('enforces the byte cap for chunked uploads with no content-length', async () => {
    const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: SSH_API.upload + '?alias=web-01&remotePath=/tmp/big.bin', method: 'POST' }, (res) => {
        let text = ''
        res.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      })
      req.on('error', reject)
      // Chunked transfer: no content-length pre-check can save us.
      req.write('x'.repeat(48))
      req.write('y'.repeat(48))
      req.end()
    })
    expect(result.status).toBe(200)
    const frames = result.text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    const frame = frames.find(line => line.type === 'result')
    expect(frame?.ok).toBe(false)
    expect(String(frame?.error)).toContain('too large')
    expect(readdirSync(join(dir, 'staging'))).toHaveLength(0)
  })

  it('reports engine failures through the result frame', async () => {
    stub.uploadError = new Error('remote rejected')
    const res = await fetch('http://127.0.0.1:' + port + SSH_API.upload + '?alias=web-01&remotePath=/tmp/x.txt', {
      method: 'POST',
      body: 'payload',
    })
    const text = await res.text()
    const lines = text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    const result = lines.find(line => line.type === 'result')
    expect(result?.ok).toBe(false)
    expect(String(result?.error)).toContain('remote rejected')
  })

  it('keeps the staging directory private (0700)', () => {
    const mode = statSync(join(dir, 'staging')).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o700)
  })
})

describe('download', () => {
  it('serves the file with content-disposition', async () => {
    const res = await fetch('http://127.0.0.1:' + port + SSH_API.download + '?alias=web-01&remotePath=/tmp/app.tar.gz')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('app.tar.gz')
    expect(res.headers.get('content-length')).toBe('5')
  })

  it('stages the download in a 0600 file', async () => {
    await fetch('http://127.0.0.1:' + port + SSH_API.download + '?alias=web-01&remotePath=/tmp/private.tar.gz')
    if (process.platform !== 'win32') expect(stub.downloadMode).toBe(0o600)
  })
})

describe('terminal upgrade', () => {
  it('round-trips JSON frames over a real WebSocket (ready/output/input/exit)', async () => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + SSH_API.terminal + '?alias=web-01&cols=80&rows=24')
    const messages: string[] = []
    ws.on('message', (data) => { messages.push(String(data)) })
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', (error) => reject(error))
    })
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (messages.some(m => (JSON.parse(m) as { type: string }).type === 'ready')) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
    })
    const ready = JSON.parse(messages.find(m => (JSON.parse(m) as { type: string }).type === 'ready')!) as { type: string; alias: string }
    expect(ready.alias).toBe('web-01')

    // Client -> server input must reach the shell session.
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }))
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(stub.shellInputs).toContain('ls\r')

    // Server -> client output must arrive as decodable frames.
    stub.openShellSession?.onData?.(Buffer.from('hello from remote'))
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (messages.some(m => {
          const parsed = JSON.parse(m) as { type: string; data?: string }
          return parsed.type === 'output' && parsed.data === 'hello from remote'
        })) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
    })

    // Remote exit closes the socket cleanly.
    stub.openShellSession?.onExit?.(0)
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (closeCode) => resolve(closeCode))
      setTimeout(() => resolve(-1), 2000)
    })
    expect(code).toBe(1000)
    ws.terminate()
  })

  it('handles 2FA keyboard-interactive auth_prompt and auth_response (#806)', async () => {
    let authRes: string[] | undefined
    stub.openShell = async (_alias, _size, onKeyboardInteractive) => {
      setTimeout(() => {
        onKeyboardInteractive?.('2FA Verification', 'Please enter your TOTP code', '', [{ prompt: 'Verification code: ', echo: true }], (res) => {
          authRes = res
        })
      }, 50)
      const session: ShellSession = {
        send: () => undefined,
        resize: () => undefined,
        close: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
      }
      stub.openShellSession = session
      return session
    }

    const ws = new WebSocket('ws://127.0.0.1:' + port + SSH_API.terminal + '?alias=web-01&cols=80&rows=24')
    const messages: string[] = []
    ws.on('message', (data) => { messages.push(String(data)) })

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    // Wait for the auth_prompt frame
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (messages.some(m => (JSON.parse(m) as { type: string }).type === 'auth_prompt')) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
    })

    const promptFrame = JSON.parse(messages.find(m => (JSON.parse(m) as { type: string }).type === 'auth_prompt')!) as {
      type: string
      name: string
      instructions: string
      prompts: Array<{ prompt: string; echo: boolean }>
    }

    expect(promptFrame.name).toBe('2FA Verification')
    expect(promptFrame.instructions).toBe('Please enter your TOTP code')
    expect(promptFrame.prompts).toEqual([{ prompt: 'Verification code: ', echo: true }])

    // Send auth_response
    ws.send(JSON.stringify({ type: 'auth_response', responses: ['654321'] }))
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(authRes).toEqual(['654321'])
    ws.terminate()
  })
})

describe('cluster route', () => {
  it('rejects with 400 when no selectors are provided', async () => {
    const res = await fetch('http://127.0.0.1:' + port + SSH_API.cluster, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uptime' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('ssh_cluster requires aliases, environment, or tags')
  })

  it('accepts cluster requests with valid selectors', async () => {
    const res = await fetch('http://127.0.0.1:' + port + SSH_API.cluster, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uptime', aliases: ['web-01'] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { results: unknown[] }
    expect(Array.isArray(body.results)).toBe(true)
  })
})

/** One handler-table entry for a path, from a route table made with the shared store. */
function handlerFor(path: string, routes: ReturnType<typeof makeRoutes>['routes']) {
  return routes.find(route => route.kind === 'exact' && route.path === path)!
}

/** One fake ServerResponse capturing status, headers and body. */
function fakeJsonResponse(): { res: ServerResponse; state: { status: number; headers: Record<string, unknown>; body: string } } {
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

/** One fake IncomingMessage: loopback socket + Host, optional raw body, destroy spy. */
function fakeJsonRequest(url: string, rawBody?: string, method = 'POST'): { req: IncomingMessage; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn()
  const req = {
    method,
    url,
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
  /** A route table over the shared store; the hosts endpoint reads a default 64 KiB body. */
  const jsonMakes = () => makeRoutes({
    store: new HostStore(join(dir, 'body-contract-hosts.json')),
    engine: engine(new StubEngine()),
    stagingDir: join(dir, 'body-contract-staging'),
  }).routes

  it('user posting invalid JSON gets 400 and the request is not destroyed', async () => {
    // Given: a loopback POST to the hosts endpoint whose body is not JSON
    const { req, destroy } = fakeJsonRequest(SSH_API.hosts, '{not json')

    // When: the registered handler reads the body
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, jsonMakes()).handler(req, res)

    // Then: the route answers 400 with the invalid-JSON envelope and the connection stays up
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('user posting an empty body gets 400 and the request is not destroyed', async () => {
    // Given: a loopback POST to the hosts endpoint with no bytes to read
    const { req, destroy } = fakeJsonRequest(SSH_API.hosts, '')

    // When: the registered handler reads the body
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, jsonMakes()).handler(req, res)

    // Then: the route answers 400 and the connection stays up
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('user posting a body past the 64 KiB default cap gets 400 and the request is destroyed', async () => {
    // Given: a loopback POST to the hosts endpoint one byte past the default cap
    const { req, destroy } = fakeJsonRequest(SSH_API.hosts, 'x'.repeat(64 * 1024 + 1))

    // When: the registered handler reads the body
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, jsonMakes()).handler(req, res)

    // Then: the route answers 400 and the shared reader tore the connection down
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ error: 'invalid JSON body' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('user reading the 400 refusal sees the family JSON headers', async () => {
    // Given: a loopback POST to the hosts endpoint with an unreadable body
    const { req, destroy } = fakeJsonRequest(SSH_API.hosts, '{not json')

    // When: the registered handler answers it
    const { res, state } = fakeJsonResponse()
    await handlerFor(SSH_API.hosts, jsonMakes()).handler(req, res)

    // Then: the shared writer's family headers are on the response
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('hosts PATCH connection invalidation', () => {
  it('operator patching agent forwarding drops the pooled connection for that alias', async () => {
    // Given a host with forwarding off and a live pooled connection for it
    const realStore = new HostStore(join(dir, 'forward-patch-hosts.json'))
    realStore.create({
      alias: 'forward-patch',
      host: '10.0.0.9',
      user: 'root',
      auth: { kind: 'password', password: 'pw' },
    })
    const realEngine = new SshEngine(realStore, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000 })
    const closed: string[] = []
    realEngine.pool.set('forward-patch', {
      client: { end: () => { closed.push('target') } },
      hops: [],
      idleAt: Date.now(),
      pinned: false,
      broken: false,
      inFlight: 0,
    } as unknown as PoolRecord)
    const routes = makeRoutes({
      store: realStore,
      engine: realEngine,
      stagingDir: join(dir, 'forward-patch-staging'),
    }).routes
    try {
      // When the forwarding flag is toggled through the PATCH route
      const { req } = fakeJsonRequest(SSH_API.hosts + '?alias=forward-patch', JSON.stringify({ forwardAgent: true }), 'PATCH')
      const { res, state } = fakeJsonResponse()
      await handlerFor(SSH_API.hosts, routes).handler(req, res)

      // Then the setting is stored and the pooled connection is gone, so the
      // next operation reconnects with forwarding negotiated
      expect(state.status).toBe(200)
      expect(realStore.find('forward-patch')?.forwardAgent).toBe(true)
      expect(realEngine.pool.has('forward-patch')).toBe(false)
      expect(closed).toEqual(['target'])
    } finally {
      realEngine.dispose()
    }
  })

  it('operator patching only managedKeyId updates credentials and drops the pooled connection', async () => {
    // Given a host using key A, a second managed key B, and an active pooled connection
    const realStore = new HostStore(join(dir, 'managed-key-patch-hosts.json'))
    const keyAPath = join(dir, 'key-a')
    const keyBPath = join(dir, 'key-b')
    writeFileSync(keyAPath, 'key-a')
    writeFileSync(keyBPath, 'key-b')
    const keyB = realStore.createKey({ name: 'Key B', path: keyBPath, passphrase: 'pb' })
    realStore.create({
      alias: 'key-patch',
      host: '10.0.0.10',
      user: 'root',
      auth: { kind: 'key', keyPath: keyAPath },
    })
    const realEngine = new SshEngine(realStore, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000 })
    const closed: string[] = []
    realEngine.pool.set('key-patch', {
      client: { end: () => { closed.push('target') } },
      hops: [],
      idleAt: Date.now(),
      pinned: false,
      broken: false,
      inFlight: 0,
    } as unknown as PoolRecord)
    const routes = makeRoutes({
      store: realStore,
      engine: realEngine,
      stagingDir: join(dir, 'managed-key-patch-staging'),
    }).routes
    try {
      // When PATCH carries only managedKeyId without an explicit auth block
      const { req } = fakeJsonRequest(SSH_API.hosts + '?alias=key-patch', JSON.stringify({ managedKeyId: keyB.id }), 'PATCH')
      const { res, state } = fakeJsonResponse()
      await handlerFor(SSH_API.hosts, routes).handler(req, res)

      // Then the host switches to key B and its stale pooled connection is dropped
      expect(state.status).toBe(200)
      expect(realStore.find('key-patch')?.auth.keyPath).toBe(keyBPath)
      expect(realEngine.pool.has('key-patch')).toBe(false)
      expect(closed).toEqual(['target'])
    } finally {
      realEngine.dispose()
    }
  })

  it('operator downloading a file with control chars in basename gets sanitized header and clean staging after abort', async () => {
    // Given an isolated download route serving a larger payload into a dedicated staging directory
    const localStaging = join(dir, 'download-abort-staging')
    const localStore = new HostStore(join(dir, 'download-abort-hosts.json'))
    const largePayload = Buffer.alloc(512 * 1024, 0x61)
    const localStub = new StubEngine()
    localStub.download = async (_alias: string, _remotePath: string, localPath: string) => {
      writeFileSync(localPath, largePayload)
      return { bytes: largePayload.byteLength }
    }
    const localRoutes = makeRoutes({ store: localStore, engine: engine(localStub), stagingDir: localStaging }).routes
    const downloadRoute = handlerFor(SSH_API.download, localRoutes)

    let handlerPromise: Promise<void> | undefined
    const abortServer = createServer((req, res) => {
      handlerPromise = Promise.resolve(downloadRoute.handler(req, res))
    })
    await new Promise<void>((resolve) => { abortServer.listen(0, '127.0.0.1', resolve) })
    const abortPort = (abortServer.address() as AddressInfo).port
    try {
      // When the client reads headers for a basename with quotes/backslash/CR/LF and aborts mid-download
      const disposition = await new Promise<string>((resolve, reject) => {
        const clientReq = httpRequest({
          host: '127.0.0.1',
          port: abortPort,
          path: `${SSH_API.download}?alias=web-01&remotePath=${encodeURIComponent('/tmp/bad"\r\n\\name.bin')}`,
          method: 'GET',
        }, (clientRes) => {
          const rawHeader = String(clientRes.headers['content-disposition'] ?? '')
          clientRes.destroy()
          clientReq.destroy()
          resolve(rawHeader)
        })
        clientReq.on('error', reject)
        clientReq.end()
      })
      await handlerPromise

      // Then Content-Disposition strips CR/LF/quotes/backslash and staging retains no leaked temp file
      expect(disposition).toBe('attachment; filename="badname.bin"')
      expect(readdirSync(localStaging)).toEqual([])
    } finally {
      await new Promise<void>((resolve) => { abortServer.close(() => resolve()) })
    }
  })
})
