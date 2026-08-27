/**
 * HTTP routes exposing the card's actions. Every mutating route is
 * loopback-fenced: the operations rewrite the boot profile's patch file and
 * run the migration, so a remote surface must never reach them.
 * @module better-session-manager/host/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { buildStatus, performDisable, performEnable, resolvePaths } from './service.ts'

export const API_PREFIX = '/api/dsh-perf/better-session'

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString('utf8') })
    req.on('end', () => resolvePromise(data))
    req.on('error', rejectPromise)
  })
}

function loopbackOnly(req: IncomingMessage, res: ServerResponse): boolean {
  const remote = req.socket.remoteAddress ?? ''
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') return true
  writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
  return false
}

/** The three routes the card drives; returns them for one-shot registration. */
export function makeBetterSessionRoutes(): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: API_PREFIX + '/status',
      handler: async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
          writeJson(res, 200, buildStatus())
        } catch (error) {
          writeJson(res, 500, { ok: false, error: (error as Error).message })
        }
      },
    },
    {
      kind: 'exact',
      path: API_PREFIX + '/enable',
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!loopbackOnly(req, res)) return
        try {
          const body = await readBody(req) || '{}'
          const parsed = JSON.parse(body) as { acknowledge?: unknown }
          if (parsed.acknowledge !== true) {
            writeJson(res, 400, { ok: false, error: 'missing acknowledgement of the storage switch' })
            return
          }
          const outcome = await performEnable(resolvePaths())
          writeJson(res, 200, { ok: true, ...outcome })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: (error as Error).message })
        }
      },
    },
    {
      kind: 'exact',
      path: API_PREFIX + '/disable',
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!loopbackOnly(req, res)) return
        try {
          performDisable(resolvePaths())
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: (error as Error).message })
        }
      },
    },
  ]
}
