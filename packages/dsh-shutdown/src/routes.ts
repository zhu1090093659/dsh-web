/**
 * The /api/dsh-shutdown route: a loopback-only control surface that asks the
 * host process to exit. The response is written first and the exit request is
 * scheduled a short beat later so the browser receives the acknowledgement
 * before the process tears down.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SHUTDOWN_PATH } from './core/shutdown.ts'

/** How long the exit request waits after the response is flushed. */
export const EXIT_DELAY_MS = 80

/** Loopback check plus browser same-origin markers (mirrors dsh-ssh's fence). */
export function isLoopbackRequest(request: IncomingMessage): boolean {
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

/** Route-family dependencies (test seam). */
export interface ShutdownRouteDeps {
  /** Loopback-only fence: the control endpoint is host-surface only. */
  fence(request: IncomingMessage): boolean
  /** Request the bounded process exit (ctx.appExit, process.exit fallback). */
  requestExit(code: number): void
  /** Schedule the exit after the response; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/**
 * Build the shutdown route.
 * @param deps - fence + exit seam (and an optional schedule seam for tests).
 * @returns the exact route to register on webServer.
 */
export function makeShutdownRoute(deps: ShutdownRouteDeps): WebRoute {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  return {
    kind: 'exact',
    path: SHUTDOWN_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      if (!deps.fence(req)) {
        writeJson(res, 403, { ok: false, code: 'forbidden' })
        return
      }
      writeJson(res, 200, { ok: true })
      // Flush first: the browser must see the acknowledgement before the
      // process is gone. The beat also lets the response socket drain.
      schedule(() => deps.requestExit(0), EXIT_DELAY_MS)
    },
  }
}
