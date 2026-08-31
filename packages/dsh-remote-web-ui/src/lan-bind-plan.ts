/**
 * Pure decision helpers shared by the lan-bind sync path (index.ts) and the
 * status path (lanBindStatus). Extracted so the flags-win precedence, the
 * pending-restart divergence check, and the firewall re-apply gate have one
 * implementation and direct unit coverage.
 */

/** The two bind hosts the managed block pins. */
export type LanBindPlanHost = '0.0.0.0' | '127.0.0.1'

/** webStartup facts the CLI hands the process (absent unless a flag was passed). */
export interface StartupFacts {
  host?: string
  port?: number
}

/**
 * The bind host the managed block should pin: an explicit CLI --host wins,
 * otherwise the toggle decides. CLI hosts outside the two managed literals
 * (a pinned specific IP) are not a state the toggle manages — the toggle
 * decides, and the card surfaces the divergence honestly.
 * @param lanBind - the toggle value.
 * @param startupHost - the CLI-provided bind host, when given.
 * @returns the desired bind host literal.
 */
export function desiredBindHost(lanBind: boolean, startupHost: string | undefined): LanBindPlanHost {
  if (startupHost === '0.0.0.0' || startupHost === '127.0.0.1') return startupHost
  return lanBind ? '0.0.0.0' : '127.0.0.1'
}

/**
 * The port the managed block should pin: the CLI port when given, else the
 * currently bound port. Undefined when neither is readable yet (the caller
 * skips the write and reports why).
 * @param startupPort - the CLI-provided port, when given.
 * @param livePort - the currently bound port, when finite.
 */
export function desiredBindPort(startupPort: number | undefined, livePort: number | undefined): number | undefined {
  if (typeof startupPort === 'number' && Number.isFinite(startupPort)) return startupPort
  return typeof livePort === 'number' && Number.isFinite(livePort) ? livePort : undefined
}

/**
 * Whether the running bind has not caught up with what the toggle (plus a
 * possibly overriding CLI host) will pin. Compared against the effective
 * desired host — not the raw toggle — so a flag-managed bind is not reported
 * as pending forever.
 * @param lanBind - the toggle value (undefined = untouched, never pending).
 * @param desiredHost - the effective desired host, or undefined when untouched.
 * @param liveHost - the currently bound host.
 */
export function pendingRestartOf(
  lanBind: boolean | undefined,
  desiredHost: LanBindPlanHost | undefined,
  liveHost: string | undefined,
): boolean {
  if (lanBind === undefined || desiredHost === undefined) return false
  return liveHost !== desiredHost
}

/** The last firewall state this process applied. */
export interface AppliedFirewallState {
  enabled: boolean
  port: number
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
