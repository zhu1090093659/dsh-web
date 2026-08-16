/**
 * /branch/* route layer: JSON envelopes for the workspace-gated file preview
 * and apply operations. Loopback-only, same fence as dsh-git-graph/dsh-ssh.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ApplyRequest, BranchEnvelope, BranchError } from '../core/types.ts'
import { BranchFsService, isApplyRequest } from './fs-service.ts'

const BODY_CAP_BYTES = 8 << 20

const MALFORMED: BranchError = { code: 'malformed', message: 'malformed request' }

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function forbidden(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: 'forbidden: loopback-only' }))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const part = chunk as Buffer
    total += part.length
    if (total > BODY_CAP_BYTES) {
      req.destroy()
      chunks.length = 0
      return null
    }
    chunks.push(part)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function json(res: ServerResponse, envelope: BranchEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

export function registerBranchRoutes(ctx: Context, service: BranchFsService): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackRequest(req)) {
      forbidden(res)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      res.writeHead(415)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (pathname !== '/branch/preview' && pathname !== '/branch/apply') {
      res.writeHead(404)
      res.end()
      return
    }
    const payload = await readJsonBody(req)
    if (!isApplyRequest(payload)) {
      json(res, { ok: false, error: MALFORMED })
      return
    }
    const request: ApplyRequest = {
      cwd: payload.cwd,
      writes: [...payload.writes],
      deletes: [...payload.deletes],
    }
    const envelope = pathname === '/branch/preview'
      ? await service.preview(request)
      : await service.apply(request)
    json(res, envelope)
  }

  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/branch', handler }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
