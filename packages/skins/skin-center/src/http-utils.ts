/**
 * Shared HTTP helpers for the skin-center route families (extracted from the
 * retired v1 routes.ts; issue #506). Same-origin fence: /active writes the
 * user's GUI state, so a malicious webpage must not be able to switch the
 * user's skin through a localhost CSRF post.
 * @module @linxin666/dsh-client-ui-skin-center/http-utils
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { writeJson } from './http.ts'

/** True when an `Origin` header names a host other than the request Host.
 *  Browsers send Origin on CORS requests and on all POSTs; opaque origins
 *  (sandboxed iframes) serialize as the literal string "null". */
function hasForeignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return true
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

/**
 * Same-origin fence. Browsers send Sec-Fetch-Site on every fetch: a
 * cross-site fetch is always rejected, and an Origin that does not match the
 * request Host is rejected. Requests without either header (curl, node http,
 * old browsers) pass — this is a local single-user tool, and the fence only
 * targets the cross-site browser vector.
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  return !hasForeignOrigin(req)
}

/** Reject cross-site requests with 403. */
export function requireSameOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isSameOriginRequest(req)) return true
  writeJson(res, 403, { ok: false, error: 'cross-site-request-rejected' })
  return false
}

/**
 * Fence for the read-only wallpaper-content serving routes (/web/,
 * /shim.js, /scene-manifest/, /scene-resource/). The wallpaper iframes are
 * sandboxed without allow-same-origin, so their documents carry an opaque
 * origin and every load they make (scripts, images, fetches) arrives as
 * Sec-Fetch-Site: cross-site — the strict fence would 403 the wallpaper's
 * own assets. These GETs are token-gated and side-effect free, so the
 * Sec-Fetch-Site check is dropped while the foreign-origin rejection stays.
 */
export function requireContentOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (hasForeignOrigin(req)) {
    writeJson(res, 403, { ok: false, error: 'cross-site-request-rejected' })
    return false
  }
  return true
}

/** Lenient bounded body reader (64 KiB default cap), re-exported from the shared helper copy. */
export { readJsonBody } from './http.ts'

/** Shared family JSON writer (default headers plus caller overrides), re-exported from the shared helper copy. */
export { writeJson }
