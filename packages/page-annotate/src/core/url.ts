/**
 * URL normalization and validation shared by the host screenshot route and
 * the client URL bar. Pure logic: no I/O, no browser APIs.
 * @module @linxin666/dsh-page-annotate/core/url
 */

/** Maximum screenshot viewport edge in CSS pixels (guard against abuse). */
export const MAX_VIEWPORT_EDGE = 4096

/** Minimum screenshot viewport edge in CSS pixels. */
export const MIN_VIEWPORT_EDGE = 16

/**
 * Normalize a user-typed address into an http(s) URL string, or null.
 * Bare hostnames get `https://`; `localhost` gets `http://` (dev servers
 * rarely serve TLS). Fragments are stripped: screenshots and iframes share
 * the document, and a fragment is not part of the fetched resource.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (raw === '') return null
  let candidate = raw
  // A scheme counts only when followed by '//'; 'localhost:3000' would
  // otherwise read 'localhost:' as a scheme.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = (/^localhost(\:\d+)?(\/|$)/.test(candidate) ? 'http://' : 'https://') + candidate
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.toString()
}

/**
 * Validate a screenshot request URL. Accepts http(s) only — file:, data:,
 * javascript:, chrome: and friends are refused so the capture engine can
 * never be pointed at local files or privileged schemes.
 */
export function validateScreenshotUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  const url = normalizeUrl(input)
  if (url === null) {
    // normalizeUrl rejects every non-http(s) scheme; tell those apart from
    // malformed input so callers can surface the right error copy.
    const raw = input.trim()
    if (raw === '') return { ok: false, reason: 'invalid-url' }
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return { ok: false, reason: 'invalid-url' }
    }
    return { ok: false, reason: parsed.protocol === 'http:' || parsed.protocol === 'https:' ? 'invalid-url' : 'unsupported-scheme' }
  }
  return { ok: true, url }
}

/** Clamp one viewport edge into the supported range. */
export function clampEdge(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(MAX_VIEWPORT_EDGE, Math.max(MIN_VIEWPORT_EDGE, n))
}

/** Normalize a viewport size with per-edge fallbacks and clamping. */
export function clampViewport(input: unknown, fallbackWidth = 1280, fallbackHeight = 800): { width: number; height: number } {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    width: clampEdge(record.width, fallbackWidth),
    height: clampEdge(record.height, fallbackHeight),
  }
}
