/**
 * Pure planner for the settings-sync tunnel branch: given the resolved
 * settings slice, decide which tunnel mode runs and with what target. Kept
 * free of cordis types so the precedence matrix is unit-testable without a
 * host context.
 */

/** Whether a configured public base is a parseable http(s) URL with a host. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

/** How the settings sync should drive the tunnel for one resolved value. */
export type TunnelPlan =
  | { mode: 'off' }
  | { mode: 'quick'; targetUrl: string; ignored: Array<'tunnelToken' | 'publicBaseUrl'> }
  | { mode: 'named'; token: string; publicUrl: string }

/**
 * Decide the tunnel mode and target from one resolved settings value.
 * Precedence: the quick tunnel wins when `autoTunnel` is on (anything else
 * configured is reported as ignored); the named tunnel runs only with a
 * token AND a valid public hostname (the token does not carry the hostname,
 * so the QR base and the fence trust would have no source without it);
 * otherwise no tunnel and the manual public base applies.
 * @param value - the resolved settings slice that drives the tunnel.
 * @param port - the local webServer port the tunnel forwards to.
 */
export function tunnelPlanOf(
  value: { autoTunnel?: boolean; tunnelToken?: string; publicBaseUrl?: string },
  port: number,
): TunnelPlan {
  if (value.autoTunnel === true) {
    const ignored: Array<'tunnelToken' | 'publicBaseUrl'> = []
    if (value.tunnelToken !== undefined && value.tunnelToken !== '') ignored.push('tunnelToken')
    if (value.publicBaseUrl !== undefined && value.publicBaseUrl !== '') ignored.push('publicBaseUrl')
    return { mode: 'quick', targetUrl: `http://127.0.0.1:${String(port)}`, ignored }
  }
  if (value.tunnelToken !== undefined && value.tunnelToken !== '') {
    if (value.publicBaseUrl !== undefined && isHttpUrl(value.publicBaseUrl)) {
      return { mode: 'named', token: value.tunnelToken, publicUrl: value.publicBaseUrl }
    }
    return { mode: 'off' }
  }
  return { mode: 'off' }
}
