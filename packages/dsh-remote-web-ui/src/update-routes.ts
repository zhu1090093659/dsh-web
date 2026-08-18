/**
 * The /api/update route family: the status probe and the update run. Both
 * are loopback-only control surfaces — the run endpoint triggers a real
 * pnpm install inside the owning profile, so it must never be reachable
 * from a LAN/phone origin.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { UpdateRunResult, UpdateStatus } from './update.ts'
import { writeJson } from './http.ts'

/** Route paths (exact matches under /api). */
export const UPDATE_PATHS = {
  status: '/api/update/status',
  run: '/api/update/run',
} as const

/** Route-family dependencies (test seam). */
export interface UpdateRoutesDeps {
  /** Loopback-only fence: the control endpoints are host-surface only. */
  fence(request: IncomingMessage): boolean
  /** Probe registry versions and report the comparison. */
  check(): Promise<UpdateStatus>
  /** Run the pnpm update (resolves when pnpm exits). */
  run(): Promise<UpdateRunResult>
}

/**
 * Build the /api/update route family.
 * @param deps - fence + check/run seams.
 * @returns the exact routes to register on webServer.
 */
export function makeUpdateRoutes(deps: UpdateRoutesDeps): WebRoute[] {
  const handleStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    if (!deps.fence(req)) {
      writeJson(res, 403, { ok: false, code: "forbidden" })
      return
    }
    writeJson(res, 200, await deps.check())
  }

  const handleRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    if (!deps.fence(req)) {
      writeJson(res, 403, { ok: false, code: "forbidden" })
      return
    }
    writeJson(res, 200, await deps.run())
  }

  return [
    { kind: 'exact', path: UPDATE_PATHS.status, handler: handleStatus },
    { kind: 'exact', path: UPDATE_PATHS.run, handler: handleRun },
  ]
}
