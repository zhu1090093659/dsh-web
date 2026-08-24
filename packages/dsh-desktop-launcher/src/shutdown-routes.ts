/**
 * The /api/dsh-desktop-launcher/shutdown route: a loopback-only control
 * surface that asks the host process to exit. The response is written first
 * and the exit request is scheduled a short beat later so the browser
 * receives the acknowledgement before the process tears down.
 */

import type { IncomingMessage } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { LAUNCHER_API } from './protocol.ts'
import { isLoopbackRequest } from './loopback.ts'
import { writeJson } from './http.ts'

/** How long the exit request waits after the response is flushed. */
export const EXIT_DELAY_MS = 500

export { isLoopbackRequest }

/** Route-family dependencies (test seam). */
export interface ShutdownRouteDeps {
  /** Loopback-only fence: the control endpoint is host-surface only. */
  fence(request: IncomingMessage): boolean
  /** Request the bounded process exit (ctx.appExit, process.exit fallback). */
  requestExit(code: number): void
  /** Schedule the exit after the response; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown
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
    path: LAUNCHER_API.shutdown,
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
      // process is gone. Leave enough time for fetch to settle before appExit
      // disposes the web server and the rest of the plugin tree.
      schedule(() => deps.requestExit(0), EXIT_DELAY_MS)
    },
  }
}