/**
 * The remote desktop channel — browser half. On a non-loopback origin (LAN
 * address or public tunnel) fenced host routes refuse the request, and
 * pairing is the real access control — so same-origin traffic the desktop
 * issues is rewritten onto this plugin's gated `/remote` prefix (host half
 * in src/remote-api.ts). The host then re-issues the call to 127.0.0.1 so
 * plugin loopback fences pass.
 *
 * The rewrite is deliberately narrow:
 * - loopback origins are untouched (the desktop at 127.0.0.1 keeps original paths);
 * - the pairing routes (`/api/pair/*`) stay where they are — accept must
 *   work BEFORE a device is paired;
 * - the update endpoints (`/api/update/*`) stay loopback-only;
 * - desktop-launcher create/shutdown (`/api/dsh-desktop-launcher/*`) stay
 *   loopback-only (host-local files and process exit);
 * - the family settings bridge (`/api/dsh-web-ui-settings/*`) stays
 *   loopback-only (same plane as SDK settings.*);
 * - `/api/*` (SDK methods and `/api/<plugin>/...` plugin namespaces),
 *   `/sidebar/*`, `/git/*`, and `/pet/*` ride the channel;
 * - fetch, EventSource, WebSocket, and img/script/iframe `src` are patched;
 *   everything else calls the original unchanged.
 *
 * Pure helpers are exported for unit tests; `installRemoteChannel` patches
 * the given window and returns their restore.
 */

import {
  REMOTE_API_PREFIX,
  REMOTE_CHANNEL_RULES,
  REMOTE_PREFIX,
} from '../remote-channel-rules.ts'

export { REMOTE_API_PREFIX, REMOTE_PREFIX }
export type { RemoteChannelBootSeat } from '../remote-channel-rules.ts'
export { REMOTE_CHANNEL_BOOT_GLOBAL } from '../remote-channel-rules.ts'

const RULES = REMOTE_CHANNEL_RULES

/** Minimal settings snapshot used by the remote channel decision. */
export interface RemoteChannelSettingsSnapshot {
  status: 'ready' | 'loading' | 'unavailable' | string
  value?: { enabled?: boolean; requirePairingForLan?: boolean }
}

/** Decide whether a remote desktop channel is required from local or host policy. */
export function remoteChannelRequired(
  hostname: string,
  snapshot: RemoteChannelSettingsSnapshot,
  hostPairingPolicy: boolean | undefined,
): boolean {
  if (isLoopbackHostname(hostname)) return false
  if (snapshot.status === 'ready') {
    return (snapshot.value?.enabled ?? true) && (snapshot.value?.requirePairingForLan ?? true)
  }
  // Install provisionally while the host probe is pending so early SDK calls
  // cannot escape onto the plain remote origin. A confirmed false retires it.
  return hostPairingPolicy !== false
}

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
 * Whether one same-origin path must ride the gated channel (fetch, EventSource,
 * img/script/iframe src).
 * @param pathname - the request URL pathname.
 */
export function shouldRewriteFetchPath(pathname: string): boolean {
  if (pathname.startsWith(RULES.pairPrefix)) return false
  if (pathname.startsWith(RULES.updatePrefix)) return false
  if (pathname === RULES.desktopLauncherPrefix || pathname.startsWith(`${RULES.desktopLauncherPrefix}/`)) return false
  if (pathname === RULES.settingsBridgePrefix || pathname.startsWith(`${RULES.settingsBridgePrefix}/`)) return false
  if (pathname.startsWith(RULES.apiPrefix)) return true
  if (pathname.startsWith(RULES.sidebarPrefix) || pathname === '/sidebar') return true
  if (pathname.startsWith(RULES.gitPrefix) || pathname === '/git') return true
  if (pathname.startsWith(RULES.petPrefix) || pathname === '/pet') return true
  return false
}

/**
 * Whether one WebSocket path must ride the gated channel.
 * @param pathname - the WebSocket URL pathname.
 */
export function shouldRewriteWsPath(pathname: string): boolean {
  return RULES.wsPaths.includes(pathname)
}

/** The gated twin of one fenced path (`/remote` + original pathname). */
export function rewritePath(pathname: string): string {
  return `${REMOTE_PREFIX}${pathname}`
}

/**
 * Rewrite one raw URL string when it is same-origin and fenced. Relative
 * inputs stay relative so resource loaders do not unexpectedly absolutize.
 */
export function rewriteRawUrl(raw: string, baseHref: string, origin: string): string {
  let url: URL
  try {
    url = new URL(raw, baseHref)
  } catch {
    return raw
  }
  if (url.origin !== origin) return raw
  if (!shouldRewriteFetchPath(url.pathname)) return raw
  url.pathname = rewritePath(url.pathname)
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return `${url.pathname}${url.search}${url.hash}`
  }
  return url.href
}

/** A constructor that exposes a configurable `src` on its prototype. */
interface SrcConstructor {
  prototype: object
}

/** The subset of window the channel needs (injectable for tests). */
export interface ChannelWindow {
  fetch: typeof globalThis.fetch
  WebSocket: typeof WebSocket
  EventSource?: typeof EventSource
  HTMLImageElement?: SrcConstructor
  HTMLScriptElement?: SrcConstructor
  HTMLIFrameElement?: SrcConstructor
  location: { origin: string; href: string }
  sessionStorage?: { getItem(key: string): string | null }
}

/** Options for {@link installRemoteChannel}. */
export interface RemoteChannelOptions {
  /** Called when a gated call came back unpaired (code `unpaired`). */
  onUnpaired?: () => void
  /** Called when a gated call succeeded (an unpaired banner can retire). */
  onPaired?: () => void
}

/** Read an unpaired code from either the SDK envelope or a plugin JSON body. */
function unpairedCodeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { result?: unknown; error?: unknown }
  const nested = record.result
  if (typeof nested === 'object' && nested !== null) {
    const error = (nested as { error?: unknown }).error
    if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
      return (error as { code: string }).code
    }
  }
  const error = record.error
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return undefined
}

/**
 * Whether a gated 403 is the unpaired-device fence (not a loopback-only
 * method denial, which uses the same status with code `forbidden`).
 */
export async function isUnpairedDenied(response: Response): Promise<boolean> {
  if (response.status !== 403) return false
  try {
    return unpairedCodeOf(await response.json()) === 'unpaired'
  } catch {
    return false
  }
}

/**
 * Wrap a prototype `src` setter so fenced same-origin URLs ride `/remote`.
 * No-ops when the constructor is missing or `src` is not configurable.
 */
function patchSrcAccessor(ctor: SrcConstructor | undefined, rewrite: (value: string) => string): () => void {
  if (ctor === undefined) return () => {}
  const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, 'src')
  if (descriptor === undefined || descriptor.configurable === false) return () => {}
  if (descriptor.set === undefined) return () => {}
  const originalSet = descriptor.set
  const originalGet = descriptor.get
  Object.defineProperty(ctor.prototype, 'src', {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get: originalGet,
    set(this: unknown, value: unknown) {
      originalSet.call(this, rewrite(String(value)))
    },
  })
  return () => {
    Object.defineProperty(ctor.prototype, 'src', descriptor)
  }
}

/**
 * Patch `fetch`, `EventSource`, `WebSocket`, and resource `src` accessors on
 * one window to route fenced traffic through the gated channel.
 * @param window - the browser window (or a test double).
 * @param options - the unpaired callback.
 * @returns a function restoring the originals.
 */
export function installRemoteChannel(window: ChannelWindow, options: RemoteChannelOptions = {}): () => void {
  const originalFetch = window.fetch
  const OriginalWebSocket = window.WebSocket
  const OriginalEventSource = window.EventSource

  const sameOrigin = (url: URL): boolean => url.origin === window.location.origin
  const rewrite = (raw: string): string => rewriteRawUrl(raw, window.location.href, window.location.origin)

  // The cookieless device credential (set by the /pair-app capture script):
  // attaches as a header on gated fetches and as the device query on WS and
  // EventSource handshakes, mirroring the boot patch exactly.
  const device = (() => {
    try {
      return window.sessionStorage?.getItem(RULES.deviceKey) ?? null
    } catch {
      return null
    }
  })()
  const attach = (init?: RequestInit): RequestInit | undefined => {
    if (device === null) return init
    const headers = init?.headers
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      try { headers.set(RULES.deviceHeader, device) } catch { /* ignore */ }
      return init
    }
    if (typeof headers === 'object' && headers !== null) {
      return { ...init, headers: { ...(headers as Record<string, string>), [RULES.deviceHeader]: device } } as RequestInit
    }
    return init
  }
  const withDeviceQuery = (url: URL): URL => {
    if (device !== null) url.searchParams.set(RULES.deviceQuery, device)
    return url
  }

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
      return Promise.resolve(originalFetch.call(window, next, attach(init))).then(async (response) => {
        if (await isUnpairedDenied(response.clone())) options.onUnpaired?.()
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
        super(withDeviceQuery(rewritten), protocols)
        return
      }
      super(url, protocols)
    }
  }

  const restoreSrc = [
    patchSrcAccessor(window.HTMLImageElement, rewrite),
    patchSrcAccessor(window.HTMLScriptElement, rewrite),
    patchSrcAccessor(window.HTMLIFrameElement, rewrite),
  ]

  window.fetch = patchedFetch
  window.WebSocket = PatchedWebSocket as typeof WebSocket
  if (OriginalEventSource !== undefined) {
    class PatchedEventSource extends OriginalEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        const parsed = new URL(url.toString(), window.location.href)
        if (sameOrigin(parsed) && shouldRewriteFetchPath(parsed.pathname)) {
          const rewritten = new URL(parsed)
          rewritten.pathname = rewritePath(parsed.pathname)
          super(withDeviceQuery(rewritten), eventSourceInitDict)
          return
        }
        super(url, eventSourceInitDict)
      }
    }
    window.EventSource = PatchedEventSource
  }

  return () => {
    window.fetch = originalFetch
    window.WebSocket = OriginalWebSocket
    if (OriginalEventSource !== undefined) window.EventSource = OriginalEventSource
    for (const restore of restoreSrc) restore()
  }
}

/**
 * The remote-channel lifecycle transition between two steady states:
 * running (active + installed) and retired (inactive + not installed).
 * The client apply drives the channel with this decision and retires the
 * unpaired fence notice together with the channel itself — a notice raised
 * while the channel was briefly active must not outlive it (issue #808).
 */
export type ChannelTransition = 'install' | 'retire' | 'none'

/**
 * Decide what the channel lifecycle must do next.
 * @param active - whether the gated remote channel should be running now.
 * @param installed - whether it currently is (disposer !== undefined).
 * @returns the transition to apply.
 */
export function channelTransition(active: boolean, installed: boolean): ChannelTransition {
  if (active && !installed) return 'install'
  if (!active && installed) return 'retire'
  return 'none'
}
