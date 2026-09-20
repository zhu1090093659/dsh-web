/**
 * The remote-channel rewrite contract as pure data (issue #987): both the
 * browser patch (client/remote-channel.ts) and the parse-time boot patch
 * (remote-channel-boot.ts, inlined into index.html by the host) decide from
 * these tables, so the two can never drift apart.
 * @module @linxin666/dsh-remote-web-ui/remote-channel-rules
 */

/** The gated mirror prefix (must match src/remote-methods.ts). */
export const REMOTE_PREFIX = '/remote'

import { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY } from './remote-methods.ts'

export { REMOTE_DEVICE_HEADER, REMOTE_DEVICE_QUERY }

/** Connection-plugin method prefix under the gated channel. */
export const REMOTE_API_PREFIX = `${REMOTE_PREFIX}/api`

/**
 * The official Desktop shell's page scheme. The Electron application serves
 * its official Web GUI from `dsh-app://app/` and forwards every same-origin
 * call to its OWN authenticated host, so that page is the local machine
 * talking to itself — exactly like a page opened at 127.0.0.1. Both halves
 * must classify it as host-owned; see {@link isHostOwnedOrigin}.
 */
export const DESKTOP_SHELL_SCHEME = 'dsh-app'

/** Every decision input of the remote-channel rewrite, JSON-serializable. */
export interface RemoteChannelRules {
  readonly remotePrefix: string
  readonly apiPrefix: string
  readonly pairPrefix: string
  readonly updatePrefix: string
  readonly settingsBridgePrefix: string
  readonly sidebarPrefix: string
  readonly gitPrefix: string
  readonly petPrefix: string
  readonly wsPaths: readonly string[]
  /** Header carrying the cookieless device credential on gated fetches. */
  readonly deviceHeader: string
  /** sessionStorage key holding the device credential (set by /pair-app). */
  readonly deviceKey: string
  /** Query parameter carrying it on WebSocket upgrades. */
  readonly deviceQuery: string
  /** Raw upload route the boot hook keeps on the gated channel. */
  readonly uploadPath: string
  /** Page global the pre-Cordis upload hook is published under. */
  readonly uploadHookGlobal: string
  /** Page scheme of the official Desktop shell (see {@link DESKTOP_SHELL_SCHEME}). */
  readonly desktopScheme: string
}

/** The live rule set. */
export const REMOTE_CHANNEL_RULES: RemoteChannelRules = {
  remotePrefix: REMOTE_PREFIX,
  apiPrefix: '/api/',
  pairPrefix: '/api/pair/',
  updatePrefix: '/api/update/',
  settingsBridgePrefix: '/api/dsh-web-ui-settings',
  sidebarPrefix: '/sidebar/',
  gitPrefix: '/git/',
  petPrefix: '/pet/',
  // The official 0.1.2-alpha.2 line opens exactly one stream socket (the
  // Typert gateway mux, /api/remote.mux); the legacy /api/events.* paths
  // were removed by the SDK and stay absent here.
  wsPaths: [
    '/api/remote.mux',
    '/sidebar/ws/terminal',
    '/sidebar/ws/agent-terminals',
    '/api/dsh-ssh/terminal',
  ],
  deviceHeader: REMOTE_DEVICE_HEADER,
  deviceKey: 'dsh-remote-device',
  deviceQuery: REMOTE_DEVICE_QUERY,
  uploadPath: '/api/session/uploadFileBinary',
  uploadHookGlobal: '__DSH_FILE_UPLOAD__',
  desktopScheme: DESKTOP_SHELL_SCHEME,
}

/**
 * Whether the page is the local machine itself, so no pairing may ever gate
 * it. True for a loopback hostname (localhost, ::1, 127/8) and for the
 * official Desktop shell's own page scheme.
 *
 * The Desktop shell case is not an extra trust rule but the correction of a
 * misclassification: `dsh-app://app/` IS the local desktop, yet its hostname
 * literal ('app') is not a loopback name, so a hostname-only test reads it as
 * a LAN or tunnel origin and demands a device pairing the shell can never
 * complete (its forwarded requests carry no device cookie, and the shell
 * drops every Set-Cookie on the way back).
 *
 * Scheme comparison is case-insensitive because URL parsing lowercases the
 * protocol. An empty scheme never matches, so a caller that passes only a
 * hostname keeps the hostname-only semantics.
 * @param hostname - a location hostname (IPv6 without brackets).
 * @param scheme - the page's URL scheme, without the trailing colon.
 * @param desktopScheme - the Desktop shell's scheme (defaults to the shipped one).
 * @returns true when the origin is the local machine: loopback or Desktop shell.
 */
export function isHostOwnedOrigin(
  hostname: string,
  scheme?: string,
  desktopScheme: string = DESKTOP_SHELL_SCHEME,
): boolean {
  if (isLoopbackHostname(hostname)) return true
  if (scheme === undefined || scheme === '') return false
  return normalizeScheme(scheme) === desktopScheme
}

/**
 * Lowercase a URL scheme and drop the trailing colon `location.protocol`
 * carries, so callers may pass either spelling.
 * @param scheme - a scheme, with or without the trailing colon, any case.
 * @returns the bare lowercase scheme.
 */
export function normalizeScheme(scheme: string): string {
  const trimmed = scheme.endsWith(':') ? scheme.slice(0, -1) : scheme
  return trimmed.toLowerCase()
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

/** The window global the boot patch publishes its seat under. */
export const REMOTE_CHANNEL_BOOT_GLOBAL = '__DSH_REMOTE_CHANNEL_BOOT__'

/**
 * The seat the parse-time boot patch installs: hook seats the plugin's
 * client apply adopts, a pending-unpaired flag for signals raised before
 * adoption, and restore() retiring the patch (also removes the global).
 */
export interface RemoteChannelBootSeat {
  onUnpaired: (() => void) | null
  onPaired: (() => void) | null
  pendingUnpaired: boolean
  restore(): void
}