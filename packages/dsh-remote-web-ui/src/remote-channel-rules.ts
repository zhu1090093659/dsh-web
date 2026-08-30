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

/** Every decision input of the remote-channel rewrite, JSON-serializable. */
export interface RemoteChannelRules {
  readonly remotePrefix: string
  readonly apiPrefix: string
  readonly pairPrefix: string
  readonly updatePrefix: string
  readonly desktopLauncherPrefix: string
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
}

/** The live rule set. */
export const REMOTE_CHANNEL_RULES: RemoteChannelRules = {
  remotePrefix: REMOTE_PREFIX,
  apiPrefix: '/api/',
  pairPrefix: '/api/pair/',
  updatePrefix: '/api/update/',
  desktopLauncherPrefix: '/api/dsh-desktop-launcher',
  settingsBridgePrefix: '/api/dsh-web-ui-settings',
  sidebarPrefix: '/sidebar/',
  gitPrefix: '/git/',
  petPrefix: '/pet/',
  // The official 0.1.2-alpha.1 line opens exactly one stream socket (the
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
