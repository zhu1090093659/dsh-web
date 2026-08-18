/**
 * Remote desktop channel constants — SDK-independent so tests and the
 * client half can pin them without importing the host SDK graph.
 */

/** The remote desktop channel prefix (everything under it is a method name). */
export const REMOTE_API_PREFIX = '/remote/api'

/** WebSocket event-stream paths served by the channel (client rewrites to these). */
export const REMOTE_API_PATHS = {
  mux: `${REMOTE_API_PREFIX}/events.mux`,
  host: `${REMOTE_API_PREFIX}/events.host`,
} as const

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
