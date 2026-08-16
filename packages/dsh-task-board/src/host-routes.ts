import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { TaskBoardHostService } from './host-service.ts'
import { parseActionEnvelope, TASK_BOARD_API_PREFIX } from './protocol.ts'

const ACTION_LIMIT = 64 * 1024
const IMPORT_LIMIT = 2 * 1024 * 1024
const HEARTBEAT_MS = 15_000

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function loopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return normalized === '::1' || normalized === '127.0.0.1' || (isIP(normalized) === 4 && normalized.startsWith('127.'))
}

function trustedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return loopback(req.socket.remoteAddress)
  try {
    const parsed = new URL(origin)
    const protocol = (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted === true ? 'https:' : 'http:'
    return parsed.origin === `${protocol}//${req.headers.host ?? ''}`
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; value: unknown }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > IMPORT_LIMIT) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return { raw, value: JSON.parse(raw) }
}

export function makeTaskBoardRoutes(service: TaskBoardHostService): WebRoute[] {
  const state: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/state`,
    handler: (req, res): void => {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      json(res, 200, service.snapshot())
    },
  }
  const action: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/action`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!trustedOrigin(req)) return json(res, 403, { ok: false, error: 'origin-not-allowed' })
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return json(res, 415, { ok: false, error: 'json-required' })
      }
      try {
        const body = await readBody(req)
        const parsed = parseActionEnvelope(body.value)
        if (parsed === undefined) return json(res, 400, { ok: false, error: 'invalid-action' })
        if (parsed.action.kind !== 'import' && Buffer.byteLength(body.raw) > ACTION_LIMIT) {
          return json(res, 413, { ok: false, error: 'body-too-large' })
        }
        json(res, 200, service.apply(parsed.requestId, parsed.action))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message })
      }
    },
  }
  const events: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/events`,
    handler: (req, res): void => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const push = (): void => {
        const snapshot = service.snapshot()
        res.write(`data: ${JSON.stringify({ revision: snapshot.revision, scheduler: snapshot.scheduler, power: snapshot.power })}\n\n`)
      }
      const unsubscribe = service.subscribe(push)
      const heartbeat = setInterval(() => { res.write(': ping\n\n') }, HEARTBEAT_MS)
      const close = (): void => {
        clearInterval(heartbeat)
        unsubscribe()
      }
      req.once('close', close)
      res.once('close', close)
      push()
    },
  }
  return [state, action, events]
}

export { trustedOrigin }
