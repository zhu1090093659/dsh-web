/**
 * The /api/dsh-ssh route family: host CRUD, exec, cluster, SFTP transfer
 * (NDJSON progress stream for uploads, binary stream for downloads), remote
 * listing, tunnels, and the WebSocket PTY terminal upgrade. Every route
 * carries a loopback-only trust fence (plus browser same-origin markers) —
 * these endpoints execute commands on remote servers, so LAN-exposed dsh web
 * deployments must not serve them.
 */

import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SshEngine, ShellSession } from './engine.ts'
import { isLoopbackRequest } from './loopback.ts'
import { SSH_API, type HostPayload, type TerminalClientFrame, type TerminalServerFrame } from './protocol.ts'
import type { HostStore } from './store.ts'

/** Cap on JSON request bodies (host entries and exec payloads are small). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Cap on declared upload bodies (staged to disk before SFTP). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024

/**
 * One noServer WebSocket server for terminal upgrades: the browser half uses
 * a standards-compliant WebSocket, so the host must speak real RFC 6455
 * frames (the webserver hands us the raw upgraded socket).
 */
const terminalWss = new WebSocketServer({ noServer: true })

/** Pause the shell when the socket's send buffer exceeds this… */
const BACKPRESSURE_HIGH_WATER = 1024 * 1024

/** …and resume once it drains below this. */
const BACKPRESSURE_LOW_WATER = 512 * 1024

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Route family dependencies. */
export interface SshRoutesDeps {
  /** The host store (CRUD). */
  store: HostStore
  /** The engine (ops). */
  engine: SshEngine
  /** Temp dir for upload/download staging (tests inject a sandbox). */
  stagingDir?: string
/** Upload byte cap override (tests); defaults to MAX_UPLOAD_BYTES. */
maxUploadBytes?: number
}

/**
 * Build every /api/dsh-ssh route (exact paths) plus the terminal upgrade.
 * @param deps - store, engine, staging dir.
 * @returns routes and the upgrade route.
 */
export function makeRoutes(deps: SshRoutesDeps): { routes: WebRoute[]; upgrade: WebUpgradeRoute } {
  const { store, engine } = deps
  const staging = deps.stagingDir ?? join(tmpdir(), 'dsh-ssh-uploads')
const maxUploadBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES
  // The upload route stages request bodies here; it must exist before the
  // first request (a missing dir would hang the first upload forever).
  // 0700 keeps in-flight transfers unreadable to other local users (the
  // staged files below are 0600; downloads are pre-created 0600 as well).
  mkdirSync(staging, { recursive: true, mode: 0o700 })

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const routes: WebRoute[] = [
    // ------------------------------------------------------------ hosts
    {
      kind: 'exact',
      path: SSH_API.hosts,
      handler: async (req, res) => {
        // One handler per path (the webserver keyed route registry rejects
        // duplicate (kind, path)); dispatch by HTTP method here.
        const method = req.method ?? 'GET'
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (method === 'GET') {
          writeJson(res, 200, { hosts: engine.list(queryParam(url, 'query')) })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.create(body as unknown as HostPayload)
            writeJson(res, 201, { host: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method !== 'PATCH' && method !== 'DELETE') {
          writeJson(res, 405, { error: `method not allowed: ${method}` })
          return
        }
        const alias = queryParam(url, 'alias')
        if (alias === undefined || alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        if (method === 'PATCH') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.update(alias, body as unknown as Partial<HostPayload>)
            // Connection-relevant changes invalidate the pooled connection:
            // without this the pool would keep running commands on the old
            // host/credentials until the idle sweep (up to 30 min later).
            const patch = body as Record<string, unknown>
            if (['host', 'port', 'user', 'auth', 'proxyJump'].some(key => patch[key] !== undefined)) {
              engine.dropAlias(alias)
            }
            writeJson(res, 200, { host: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method === 'DELETE') {
          try {
            engine.dropAlias(alias)
            store.delete(alias)
            writeJson(res, 200, { ok: true })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
    {
      kind: 'exact',
      path: SSH_API.importSshConfig,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          writeJson(res, 200, { result: store.importFromSshConfig() })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ------------------------------------------------------------ ops
    {
      kind: 'exact',
      path: SSH_API.test,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.test(alias) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SSH_API.exec,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias : ''
        const command = typeof body?.command === 'string' ? body.command : ''
        if (alias === '' || command === '') {
          writeJson(res, 400, { error: 'alias and command are required' })
          return
        }
        const timeoutMs = typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined
        try {
          writeJson(res, 200, { result: await engine.exec(alias, command, timeoutMs) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: SSH_API.cluster,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const command = typeof body?.command === 'string' ? body.command : ''
        if (command === '') {
          writeJson(res, 400, { error: 'command is required' })
          return
        }
        const aliases = Array.isArray(body?.aliases) ? body.aliases.filter((x): x is string => typeof x === 'string') : undefined
        const tags = Array.isArray(body?.tags) ? body.tags.filter((x): x is string => typeof x === 'string') : undefined
        const environment = typeof body?.environment === 'string' ? body.environment : undefined
        const timeoutMs = typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined
        const maxWorkers = typeof body?.maxWorkers === 'number' ? body.maxWorkers : undefined
        try {
          writeJson(res, 200, { results: await engine.cluster({ command, aliases, environment, tags, timeoutMs, maxWorkers }) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ------------------------------------------------------------- ls
    {
      kind: 'exact',
      path: SSH_API.ls,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = queryParam(url, 'alias')
        const path = queryParam(url, 'path') ?? '/'
        if (alias === undefined || alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        try {
          writeJson(res, 200, { entries: await engine.ls(alias, path) })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // --------------------------------------------------------- tunnel
    {
      kind: 'exact',
      path: SSH_API.tunnel,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const action = typeof body?.action === 'string' ? body.action : ''
        if (action === 'list') {
          writeJson(res, 200, { tunnels: engine.listTunnels() })
          return
        }
        if (action === 'start') {
          const alias = typeof body?.alias === 'string' ? body.alias : ''
          const remotePort = typeof body?.remotePort === 'number' ? body.remotePort : undefined
          if (alias === '' || remotePort === undefined) {
            writeJson(res, 400, { error: 'alias and remotePort are required' })
            return
          }
          try {
            const tunnel = await engine.startTunnel(alias, {
              remotePort,
              remoteHost: typeof body?.remoteHost === 'string' && body.remoteHost !== '' ? body.remoteHost : undefined,
              localPort: typeof body?.localPort === 'number' ? body.localPort : undefined,
            })
            writeJson(res, 200, { tunnel })
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (action === 'stop') {
          const id = typeof body?.tunnelId === 'string' ? body.tunnelId : ''
          if (id === '') {
            writeJson(res, 400, { error: 'tunnelId is required' })
            return
          }
          writeJson(res, 200, { ok: engine.stopTunnel(id) })
          return
        }
        if (action === 'stop-all') {
          const alias = typeof body?.alias === 'string' ? body.alias : undefined
          writeJson(res, 200, { stopped: engine.stopAllTunnels(alias === '' ? undefined : alias) })
          return
        }
        writeJson(res, 400, { error: `unknown action '${action}'` })
      },
    },
    // --------------------------------------------------------- upload
    {
      kind: 'exact',
      path: SSH_API.upload,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = queryParam(url, 'alias')
        const remotePath = queryParam(url, 'remotePath')
        if (alias === undefined || remotePath === undefined) {
          writeJson(res, 400, { error: 'alias and remotePath query parameters are required' })
          return
        }
        const declared = Number(req.headers['content-length'])
        if (Number.isFinite(declared) && declared > maxUploadBytes) {
          writeJson(res, 413, { error: 'upload body too large' })
          return
        }
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-cache',
          'referrer-policy': 'no-referrer',
        })
        const emit = (line: unknown): void => {
          try { res.write(JSON.stringify(line) + '\n') } catch { /* client gone */ }
        }
        // Stage the uploaded bytes, then SFTP them out with progress frames.
        const tmp = join(staging, `upload-${randomBytes(6).toString('hex')}`)
        const sink = createWriteStream(tmp, { mode: 0o600 })
        let settled = false
        // Every terminal path (sink error, client abort, response loss) must
        // emit a result frame, end the response, and remove the tmp file.
        const fail = (error: unknown): void => {
          if (settled) return
          settled = true
          emit({ type: 'result', ok: false, error: error instanceof Error ? error.message : String(error) })
          // End the response only after the tmp file is gone, and unlink only
          // after the sink is fully closed: destroying a WriteStream whose
          // fs.open is still pending lets the open RE-CREATE the file after
          // an early unlink, leaving staging populated (this raced the
          // response end and made the byte-cap test flaky).
          const cleanup = (): void => {
            void unlink(tmp).catch(() => undefined).finally(() => {
              try { res.end() } catch { /* closed */ }
            })
          }
          if (sink.destroyed) {
            cleanup()
          } else {
            sink.once('close', cleanup)
            try { sink.destroy() } catch { cleanup() }
          }
        }
        const done = (): void => {
          if (settled) return
          settled = true
          try { res.end() } catch { /* closed */ }
        }
        sink.on('error', (error) => fail(error))
        req.on('error', (error) => fail(error))
        req.on('aborted', () => fail('upload aborted by the client'))
        res.on('error', () => fail('response stream closed'))
        res.on('close', () => { if (!res.writableEnded) fail('connection closed') })
        // The content-length pre-check above can be bypassed by chunked or
        // header-less requests: count the bytes as they actually arrive and
        // abort the moment the cap is exceeded.
        let received = 0
        let capped = false
        req.on('data', (chunk: Buffer) => {
          received += chunk.byteLength
          if (received > maxUploadBytes && !capped) {
            capped = true
            fail('upload body too large')
            // Keep the socket alive until the response flush finishes:
            // destroying the request here races res.end() and the client
            // sees a hang-up instead of the result frame. Drain the rest of
            // the body so the socket can close cleanly afterwards.
            res.on('finish', () => { try { req.destroy() } catch { /* closed */ } })
            req.resume()
          }
        })
        req.pipe(sink)
        sink.on('finish', async () => {
          if (settled) return
          emit({ type: 'progress', progress: { phase: 'connecting', file: remotePath, transferred: 0, total: 0, percent: 0 } })
          try {
            const outcome = await engine.upload(alias, tmp, remotePath, false, progress => emit({ type: 'progress', progress }))
            emit({ type: 'result', ok: true, transferredBytes: outcome.bytes })
          } catch (error) {
            emit({ type: 'result', ok: false, error: error instanceof Error ? error.message : String(error) })
          } finally {
            await unlink(tmp).catch(() => undefined)
            done()
          }
        })
      },
    },
    // ------------------------------------------------------- download
    {
      kind: 'exact',
      path: SSH_API.download,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = queryParam(url, 'alias')
        const remotePath = queryParam(url, 'remotePath')
        if (alias === undefined || remotePath === undefined) {
          writeJson(res, 400, { error: 'alias and remotePath query parameters are required' })
          return
        }
        const tmp = join(staging, `download-${randomBytes(6).toString('hex')}`)
        try {
          // Pre-create with 0600: ssh2's fastGet opens the destination with
          // umask-default permissions and a pre-created file keeps the mode.
          closeSync(openSync(tmp, 'w', 0o600))
          const outcome = await engine.download(alias, remotePath, tmp)
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': String(outcome.bytes),
            'content-disposition': `attachment; filename="${basename(remotePath).replace(/"/g, '')}"`,
            'referrer-policy': 'no-referrer',
          })
          await new Promise<void>((resolve, reject) => {
            const source = createReadStream(tmp)
            source.on('error', reject)
            res.on('error', reject)
            source.pipe(res)
            source.on('end', resolve)
          })
        } catch (error) {
          if (!res.headersSent) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          } else {
            // Mid-stream failure after headers: destroy so the browser does
            // not hang waiting for the promised content-length bytes.
            res.destroy()
          }
        } finally {
          await unlink(tmp).catch(() => undefined)
        }
      },
    },
  ]

  // ---------------------------------------------- terminal (upgrade)
  const upgrade: WebUpgradeRoute = {
    path: SSH_API.terminal,
    handler: (req, socket, head) => {
      if (!isLoopbackRequest(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const alias = queryParam(url, 'alias')
      if (alias === undefined) {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const cols = Number.parseInt(queryParam(url, 'cols') ?? '80', 10)
      const rows = Number.parseInt(queryParam(url, 'rows') ?? '24', 10)
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        let session: ShellSession | undefined
        let closed = false
        let paused = false
        // Resume the shell once the socket's send buffer drains below the
        // low-water mark (transport backpressure).
        const resume = (): void => {
          if (paused && ws.bufferedAmount < BACKPRESSURE_LOW_WATER) {
            paused = false
            session?.resume()
          }
        }
        const sendFrame = (frame: TerminalServerFrame): void => {
          if (closed || ws.readyState !== WebSocket.OPEN) return
          ws.send(JSON.stringify(frame), resume)
          if (!paused && ws.bufferedAmount > BACKPRESSURE_HIGH_WATER) {
            paused = true
            session?.pause()
          }
        }
        const closeSession = (): void => {
          const opened = session
          session = undefined
          if (opened !== undefined) opened.close()
        }
        engine.openShell(alias, {
          cols: Number.isFinite(cols) ? cols : 80,
          rows: Number.isFinite(rows) ? rows : 24,
        }).then((opened) => {
          if (ws.readyState !== WebSocket.OPEN) {
            opened.close()
            return
          }
          session = opened
          sendFrame({ type: 'ready', alias })
          opened.onData = (data) => sendFrame({ type: 'output', data: data.toString('utf8') })
          opened.onExit = (code, error) => {
            sendFrame({ type: 'exit', code, error })
            closed = true
            try { ws.close(1000) } catch { /* already closed */ }
          }
        }).catch((error) => {
          sendFrame({ type: 'exit', code: null, error: error instanceof Error ? error.message : String(error) })
          closed = true
          try { ws.close(1000) } catch { /* already closed */ }
        })
        ws.on('message', (data) => {
          let frame: TerminalClientFrame
          try {
            frame = JSON.parse(String(data)) as TerminalClientFrame
          } catch {
            return
          }
          if (frame.type === 'input') {
            session?.send(frame.data)
          } else if (frame.type === 'resize') {
            session?.resize(Math.max(2, frame.cols), Math.max(1, frame.rows))
          }
        })
        ws.on('close', () => {
          closed = true
          closeSession()
        })
        ws.on('error', () => {
          closed = true
          closeSession()
        })
      })
    },
  }

  return { routes, upgrade }
}
