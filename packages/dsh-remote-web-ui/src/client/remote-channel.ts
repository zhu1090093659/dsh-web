/**
 * The remote desktop channel — browser half. On a non-loopback origin (LAN
 * address or public tunnel) the desktop Web GUI's `/api` traffic is refused
 * by the connection plugin's Host fence, and pairing is the real access
 * control — so every same-origin `/api` request the SDK client issues is
 * rewritten onto this plugin's gated `/remote/api` prefix (host half in
 * src/remote-api.ts), where the paired-device cookie gate decides.
 *
 * The rewrite is deliberately narrow:
 * - loopback origins are untouched (the desktop at 127.0.0.1 keeps `/api`);
 * - the pairing routes (`/api/pair/*`) stay where they are — accept must
 *   work BEFORE a device is paired;
 * - the update endpoints (`/api/update/*`) stay loopback-only — a paired
 *   remote desktop must never trigger an install;
 * - only the two fixed event-stream paths are rewritten for WebSocket —
 *   every other WebSocket URL passes through the native constructor.
 *
 * Pure helpers are exported for unit tests; `installRemoteChannel` patches
 * `fetch` and `WebSocket` on the given window and returns their restore.
 */

/** The gated mirror prefix (must match src/remote-api.ts). */
export const REMOTE_API_PREFIX = '/remote/api'

const FETCH_PREFIX = '/api/'
const PAIR_PREFIX = '/api/pair/'
const UPDATE_PREFIX = '/api/update/'
const WS_MUX_PATH = '/api/events.mux'
const WS_HOST_PATH = '/api/events.host'

/**
 * Browser-safe loopback classification for the page origin (the SDK client
 * exports its own; this copy keeps the module dependency-free).
 * @param hostname - a location hostname (IPv6 without brackets).
 * @returns true for localhost, IPv6 loopback, or any 127/8 literal.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Whether one same-origin fetch path must ride the gated channel.
 * @param pathname - the request URL pathname.
 */
export function shouldRewriteFetchPath(pathname: string): boolean {
  if (!pathname.startsWith(FETCH_PREFIX)) return false
  if (pathname.startsWith(PAIR_PREFIX)) return false
  if (pathname.startsWith(UPDATE_PREFIX)) return false
  return true
}

/**
 * Whether one WebSocket path is a desktop event stream that must ride the
 * gated channel (the SDK client opens exactly these two).
 * @param pathname - the WebSocket URL pathname.
 */
export function shouldRewriteWsPath(pathname: string): boolean {
  return pathname === WS_MUX_PATH || pathname === WS_HOST_PATH
}

/** The gated twin of one `/api` path. */
export function rewritePath(pathname: string): string {
  return `${REMOTE_API_PREFIX}${pathname.slice('/api'.length)}`
}

/** The subset of window the channel needs (injectable for tests). */
export interface ChannelWindow {
  fetch: typeof globalThis.fetch
  WebSocket: typeof WebSocket
  location: { origin: string; href: string }
}

/** Options for {@link installRemoteChannel}. */
export interface RemoteChannelOptions {
  /** Called when a gated call came back 403 (the device is not paired). */
  onUnpaired?: () => void
  /** Called when a gated call succeeded (an unpaired banner can retire). */
  onPaired?: () => void
}

/**
 * Patch `fetch` and `WebSocket` on one window to route the desktop `/api`
 * traffic through the gated channel. Everything not matching the narrow
 * rules above calls the original unchanged.
 * @param window - the browser window (or a test double).
 * @param options - the unpaired callback.
 * @returns a function restoring the originals.
 */
export function installRemoteChannel(window: ChannelWindow, options: RemoteChannelOptions = {}): () => void {
  const originalFetch = window.fetch
  const OriginalWebSocket = window.WebSocket

  const sameOrigin = (url: URL): boolean => url.origin === window.location.origin

  const patchedFetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
      window.location.href,
    )
    if (sameOrigin(url) && shouldRewriteFetchPath(url.pathname)) {
      const rewritten = new URL(url)
      rewritten.pathname = rewritePath(url.pathname)
      const next: RequestInfo | URL = typeof input === 'string' || input instanceof URL
        ? rewritten.toString()
        : new Request(rewritten, input)
      return Promise.resolve(originalFetch.call(window, next, init)).then((response) => {
        if (response.status === 403) options.onUnpaired?.()
        else options.onPaired?.()
        return response
      })
    }
    return originalFetch.call(window, input, init)
  }

  class PatchedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const parsed = new URL(url.toString(), window.location.href)
      const wsOrigin = parsed.protocol === 'wss:' ? `https://${parsed.host}` : parsed.protocol === 'ws:' ? `http://${parsed.host}` : ''
      if (wsOrigin !== '' && wsOrigin === window.location.origin && shouldRewriteWsPath(parsed.pathname)) {
        const rewritten = new URL(parsed)
        rewritten.pathname = rewritePath(parsed.pathname)
        super(rewritten, protocols)
        return
      }
      super(url, protocols)
    }
  }

  window.fetch = patchedFetch
  window.WebSocket = PatchedWebSocket as typeof WebSocket
  return () => {
    window.fetch = originalFetch
    window.WebSocket = OriginalWebSocket
  }
}
