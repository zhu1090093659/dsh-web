/**
 * HTTP routes for the page-annotate host half. The screenshot route is the
 * client's capture seam (loopback-fenced, URL-validated, viewport-clamped);
 * the health route reports which capture engines are available. The handler
 * logic is a pure factory so tests can drive it with fake req/res and a
 * stub capture service.
 * @module @linxin666/dsh-page-annotate/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CaptureService } from './screenshot/service.ts'
import { clampViewport, validateScreenshotUrl } from './core/url.ts'
import { isLoopbackRequest } from './loopback.ts'

/** One webserver route (mirror of dsh-host-webserver's WebRoute). */
export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Route paths the client uses. */
export const SCREENSHOT_ROUTE = '/page-annotate/screenshot'
export const HEALTH_ROUTE = '/page-annotate/health'

/** JSON request-body byte cap for screenshot requests. */
export const MAX_BODY_BYTES = 64 * 1024

/** Read a bounded JSON request body; reject on overflow or bad JSON. */
export async function readBoundedJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > maxBytes) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf-8')
  if (text.trim() === '') throw new Error('empty-body')
  return JSON.parse(text) as unknown
}

/** Write a JSON response. */
export function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** Options for the route factory (loopback fence injectable for tests). */
export interface ScreenshotRouteOptions {
  loopback?: (req: IncomingMessage) => boolean
}

/**
 * Build the screenshot + health routes. Every request must come from a
 * loopback socket (same fence family as dsh-ssh / describe-image).
 */
export function makeScreenshotRoutes(service: CaptureService, options: ScreenshotRouteOptions = {}): WebRoute[] {
  const loopback = options.loopback ?? isLoopbackRequest
  const fenced = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (loopback(req)) return true
    json(res, 403, { ok: false, error: { code: 'forbidden', message: 'loopback-only' } })
    return false
  }

  const health: WebRoute = {
    kind: 'exact',
    path: HEALTH_ROUTE,
    handler: async (req, res) => {
      if (!fenced(req, res)) return
      json(res, 200, { ok: true, value: await service.health() })
    },
  }

  const screenshot: WebRoute = {
    kind: 'exact',
    path: SCREENSHOT_ROUTE,
    handler: async (req, res) => {
      if (!fenced(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
        return
      }
      let body: unknown
      try {
        body = await readBoundedJson(req)
      } catch {
        json(res, 400, { ok: false, error: { code: 'bad-body', message: 'request body must be small JSON' } })
        return
      }
      const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
      const urlCheck = validateScreenshotUrl(typeof record.url === 'string' ? record.url : '')
      if (!urlCheck.ok) {
        json(res, 400, { ok: false, error: { code: urlCheck.reason, message: 'invalid screenshot URL' } })
        return
      }
      const viewport = clampViewport(record.viewport)
      try {
        const shot = await service.capture({ url: urlCheck.url, width: viewport.width, height: viewport.height })
        json(res, 200, {
          ok: true,
          value: {
            data: shot.data.toString('base64'),
            mediaType: shot.mimeType,
            width: shot.width,
            height: shot.height,
            engine: shot.engine,
          },
        })
      } catch (error) {
        const coded = error as { code?: string; message?: string }
        json(res, 500, { ok: false, error: { code: coded.code ?? 'capture-failed', message: coded.message ?? String(error) } })
      }
    },
  }

  return [health, screenshot]
}
