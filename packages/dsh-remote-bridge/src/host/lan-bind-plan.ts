/**
 * Pure decision helpers shared by the lan-bind sync path (index.ts) and the
 * status path (lanBindStatus). Extracted so the LAN-edge plan and the firewall
 * re-apply gate have one implementation and direct unit coverage.
 *
 * Since issue #1917 the plugin owns no bind: the host stays on loopback and LAN
 * reachability comes from the forwarder in lan-forward.ts, so the only decision
 * left here is which LAN address (if any) that forwarder may listen on.
 */

import { isLoopbackBind } from './host-bind-capability.ts'

/** webStartup facts the CLI hands the process (absent unless a flag was passed). */
export interface StartupFacts {
  host?: string
  port?: number
}

/**
 * What the running host accepts, and which concrete addresses it could pin.
 * Sampled once per boot: the webserver package cannot change under a running
 * process, and the interface list is frozen for the same reason the QR bases
 * are (see src/lan.ts).
 */
export interface LanBindCapability {
  /** Whether the installed webserver schema accepts the wildcard bind (reported, never written). */
  wildcardSupported: boolean
  /** Local non-loopback IPv4 literals, in preference order (`lanIPv4Addresses()`). */
  candidates: string[]
}

/** Why the LAN forwarder is not listening, when it is not. */
export type ForwardStopReason =
  /** The toggle is off (or was never flipped). */
  | 'off'
  /** The host itself binds a non-loopback address (`--host`): the forwarder yields the port. */
  | 'host-bind'
  /** The toggle is on but this machine has no LAN IPv4 address to listen on. */
  | 'no-address'

/** The LAN edge one sync should run: an address to listen on, or why not. */
export interface ForwardPlan {
  /** The LAN address the forwarder listens on; undefined when it must stay off. */
  host: string | undefined
  /** Why it stays off; undefined when a host is planned. */
  reason: ForwardStopReason | undefined
}

/**
 * The LAN address the forwarder may listen on, or the reason it must not.
 *
 * The order is: the toggle off keeps LAN off; a non-loopback `--host` means the
 * operator asked the HOST to bind the network itself, so the forwarder yields
 * the port instead of fighting it for the same address:port (issue #1917);
 * otherwise this machine's first LAN candidate. A host with no LAN IPv4 address
 * has nothing to listen on, which the caller reports instead of failing.
 *
 * Only a concrete interface address is ever returned: the wildcard would
 * collide with the loopback listener on the same port, and a forwarder bound to
 * `0.0.0.0` would additionally answer the loopback port a second time.
 * @param lanBind - the toggle value.
 * @param startupHost - the CLI-provided bind host, when given.
 * @param capability - the sampled interface candidates.
 * @returns the address to listen on, or the reason there is none.
 */
export function forwardPlanOf(
  lanBind: boolean | undefined,
  startupHost: string | undefined,
  capability: LanBindCapability,
): ForwardPlan {
  if (lanBind !== true) return { host: undefined, reason: 'off' }
  if (typeof startupHost === 'string' && startupHost !== '' && isLanReachableBind(startupHost)) {
    return { host: undefined, reason: 'host-bind' }
  }
  const host = capability.candidates[0]
  return host === undefined ? { host: undefined, reason: 'no-address' } : { host, reason: undefined }
}

/**
 * The reachability decision behind the QR bases, the status `lanUrls`, the
 * firewall summary and the boot's LAN warning: a bind that is not loopback is
 * reachable from another device, whatever literal it names. Equality with the
 * wildcard is deliberately not the test - on a host that refuses wildcard
 * binds the only LAN bind is a concrete interface address.
 * @param host - the block host or the live bind (absent before it settles).
 * @returns true when another device could dial the listener.
 */
export function isLanReachableBind(host: string | undefined): boolean {
  return !isLoopbackBind(host)
}

/** The last firewall state this process applied. */
export interface AppliedFirewallState {
  enabled: boolean
  port: number
}

/** The managed profile when neither the config nor the runtime names one. */
export const DEFAULT_MANAGED_PROFILE = 'web'

/**
 * The profile whose `cordis.patch.yml` the LAN bind toggle manages. An
 * explicit `profile` config wins; otherwise the launched profile the Host
 * publishes is authoritative, because the DSH Desktop client boots the
 * `desktop` profile without exporting `DSH_PROFILE` — an environment-only
 * fallback edited `profiles/web` there, so the toggle looked applied while
 * the running host never followed the block.
 * @param configured - the explicit `profile` plugin config, when set.
 * @param launched - the launched profile name the Host published, when available.
 * @param env - the DSH_PROFILE environment value, when set.
 */
export function resolveManagedProfile(
  configured: string | undefined,
  launched: string | undefined,
  env: string | undefined,
): string {
  return configured ?? launched ?? env ?? DEFAULT_MANAGED_PROFILE
}

/**
 * Whether the firewall rule must be (re)applied: only when the toggle or the
 * bound port moved since the last application. Keeps unrelated settings
 * saves from spawning netsh/firewall-cmd delete+add churn.
 * @param previous - the state applied earlier by this process, if any.
 * @param next - the state the settings now ask for, if derivable.
 */
export function firewallActionNeeded(
  previous: AppliedFirewallState | undefined,
  next: AppliedFirewallState | undefined,
): boolean {
  if (next === undefined) return false
  if (previous === undefined) return true
  return previous.enabled !== next.enabled || previous.port !== next.port
}
