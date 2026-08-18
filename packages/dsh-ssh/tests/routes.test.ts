/**
 * Route-layer tests: the loopback fence, hosts CRUD dispatch (single handler
 * per path), upload NDJSON framing, download headers, and the terminal
 * upgrade bridge speaking real RFC 6455 WebSocket frames.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeRoutes } from '../src/routes.ts'
import { HostStore } from '../src/store.ts'
import { SSH_API, type SshHostSummary } from '../src/protocol.ts'
import type { SshEngine, ShellSession } from '../src/engine.ts'

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
  async openShell(_alias: string): Promise<ShellSession> {
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

    const del = await fetch('http://127.0.0.1:' + port + SSH_API.hosts + '?alias=web-01', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(store.list()).toHaveLength(0)
    expect(stub.dropAliasCalls).toEqual(['web-01', 'web-01'])
  })

  it('rejects unknown methods on the hosts path with 405', async () => {
    const result = await get(SSH_API.hosts, {})
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
    expect(mode).toBe(0o700)
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
    expect(stub.downloadMode).toBe(0o600)
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
})
