/**
 * Remote desktop channel constants — SDK-independent so tests and the
 * client half can pin them without importing the host SDK graph.
 */

/** Gated mirror of same-origin fenced paths (`/remote` + original pathname). */
export const REMOTE_PREFIX = '/remote'

/** Connection-plugin method prefix under the gated channel. */
export const REMOTE_API_PREFIX = `${REMOTE_PREFIX}/api`

/** WebSocket event-stream paths served by the channel (client rewrites to these). */
export const REMOTE_API_PATHS = {
  mux: `${REMOTE_API_PREFIX}/events.mux`,
  host: `${REMOTE_API_PREFIX}/events.host`,
} as const

/**
 * Exact upgrade paths registered on webServer (the SDK matches upgrades by
 * exact path, not prefix). Query strings ride on the request URL.
 */
export const REMOTE_UPGRADE_PATHS = [
  REMOTE_API_PATHS.mux,
  REMOTE_API_PATHS.host,
  `${REMOTE_PREFIX}/sidebar/ws/terminal`,
  `${REMOTE_PREFIX}/sidebar/ws/agent-terminals`,
  `${REMOTE_API_PREFIX}/dsh-ssh/terminal`,
] as const

/** Plugin-manager HTTP prefix: install/remove stay physically local. */
export const PLUGIN_MANAGER_PATH = '/api/plugin-manager'

/** Desktop-launcher HTTP prefix: shortcut create and host shutdown stay physically local. */
export const DESKTOP_LAUNCHER_PATH = '/api/dsh-desktop-launcher'

/** Family settings-bridge HTTP prefix: describe/mutate stay physically local. */
export const WEB_UI_SETTINGS_BRIDGE_PATH = '/api/dsh-web-ui-settings'

/**
 * Loopback-only methods of the host API surface, mirrored from
 * client-connection's `PRIVILEGED_METHODS` (pinned by
 * tests/remote-contract.spec.ts against the installed SDK). They stay
 * unreachable from a paired remote desktop, matching the SDK's own stance
 * that the configuration plane is loopback-same-origin only.
 */
export const LOOPBACK_ONLY_METHODS = new Set([
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])
