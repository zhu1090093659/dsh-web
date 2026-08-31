/**
 * Remote desktop channel constants — SDK-independent so tests and the
 * client half can pin them without importing the host SDK graph.
 *
 * Access model on the 0.1.2-alpha.2 line: the host /api surface has no
 * per-method privilege pin — the "configuration plane is local" behavior
 * lives in the browser (client plugins branch on connection.isLoopback), and
 * the paired remote desktop flips into host mode via the transport hook
 * (ownsHost) while every call rides this gated channel as a loopback-shaped
 * request. A paired device is therefore a full-control credential by
 * design; the only paths that stay physically local are the control planes
 * below (pairing control, self-update, plugin install/remove, host power).
 */

/** Gated mirror of same-origin fenced paths (`/remote` + original pathname). */
export const REMOTE_PREFIX = '/remote'

/** Connection-plugin method prefix under the gated channel. */
export const REMOTE_API_PREFIX = `${REMOTE_PREFIX}/api`

/**
 * The gated mirrors of the official client WebSocket paths. On the pinned
 * 0.1.2-alpha.2 line the client opens ONE persistent stream socket — the
 * Typert gateway mux at `/api/remote.mux` — and every Remote stream
 * (workspace follow, session feed, ...) rides it. If that socket is not
 * rewritten onto the gated channel the phone's streams die at the connection
 * fence and the UI shows an empty workspace/session mirror, so the mux is
 * the one path that must never be missing here.
 */
export const REMOTE_API_PATHS = {
  mux: `${REMOTE_API_PREFIX}/remote.mux`,
} as const

/**
 * Exact upgrade paths registered on webServer (the SDK matches upgrades by
 * exact path, not prefix). Query strings ride on the request URL.
 */
export const REMOTE_UPGRADE_PATHS = [
  REMOTE_API_PATHS.mux,
  `${REMOTE_PREFIX}/sidebar/ws/terminal`,
  `${REMOTE_PREFIX}/sidebar/ws/agent-terminals`,
  `${REMOTE_API_PREFIX}/dsh-ssh/terminal`,
] as const

/** Plugin-manager HTTP prefix: install/remove stay physically local. */
export const PLUGIN_MANAGER_PATH = '/api/plugin-manager'

/** Desktop-launcher HTTP prefix: shortcut create and host shutdown stay physically local. */
export const DESKTOP_LAUNCHER_PATH = '/api/dsh-desktop-launcher'

/** Family settings-bridge HTTP prefix — re-exposed to paired devices (plain settings parity). */
export const WEB_UI_SETTINGS_BRIDGE_PATH = '/api/dsh-web-ui-settings'

/**
 * The cookieless device credential: the boot patch reads the device id from
 * the /pair-app URL, keeps it in sessionStorage, and attaches it to every
 * gated HTTP call as this header (and to WebSocket upgrades as the `device`
 * query parameter - WS handshakes cannot carry headers from the Web API).
 * The channel gate accepts it exactly like the device cookie, so the mobile
 * flow works even with browser cookies fully blocked; the cookie remains the
 * primary credential on normal browsers.
 */
export const REMOTE_DEVICE_HEADER = 'x-dsh-remote-device'
export const REMOTE_DEVICE_QUERY = 'device'

/**
 * Path prefixes that stay physically local even for a paired device. A
 * paired remote desktop may use the full host API (chat, sessions,
 * settings, credentials, presets — it is a full-control credential), but it
 * must not reach the machine-control planes: pairing control itself, the
 * dsh-web self-update installer, plugin install/remove, and desktop
 * launcher actions (host shutdown, shortcuts).
 */
export const LOCAL_ONLY_PREFIXES: readonly string[] = [
  '/api/pair',
  '/api/update',
  PLUGIN_MANAGER_PATH,
  DESKTOP_LAUNCHER_PATH,
] as const

/**
 * Whether a paired inner path must stay physically local.
 * @param innerPath - the rewritten inner path (e.g. `/api/session.list`).
 * @returns a denial message, or undefined when the path may be proxied.
 */
export function localOnlyDenial(innerPath: string): string | undefined {
  for (const prefix of LOCAL_ONLY_PREFIXES) {
    if (innerPath === prefix || innerPath.startsWith(`${prefix}/`)) {
      return `${prefix.slice(1)} stays physically local and stays unreachable from a paired remote desktop`
    }
  }
  return undefined
}
