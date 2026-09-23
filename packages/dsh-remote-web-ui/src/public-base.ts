/**
 * The public base the pairing fence trusts while a tunnel is not running
 * (issue #1547).
 *
 * The fence reads exactly one public host: `service.publicBaseUrl`. Dropping
 * it the instant the tunnel leaves `running` makes every public request from
 * the address still printed in the QR code answer 403 — including
 * `/api/pair/status`, which exists to be callable before pairing. Two of the
 * three tunnel modes never lose their host: a named tunnel keeps its fixed
 * dashboard hostname, and a registered relay keeps its stable subdomain. A
 * quick tunnel does mint a new hostname on restart, so its previous host is
 * kept only for a bounded grace window: Cloudflare's edge can still deliver a
 * connection the phone already opened, and a mobile network reconnects
 * constantly, so an instant drop turns the phone's retry into a silent 403.
 * @module @linxin666/dsh-remote-web-ui/public-base
 */

/** How long a quick-tunnel host stays trusted after the tunnel stops running. */
export const PUBLIC_BASE_GRACE_MS = 60_000

/** Tunnel ownership of the public base, as resolved from the settings document. */
export type TunnelBaseMode = 'off' | 'quick' | 'named'

/**
 * Owns the trusted public base across tunnel and relay transitions.
 *
 * The keeper never decides on its own to widen trust: it only postpones
 * dropping an address the operator (named/relay) or the tunnel (quick) had
 * already published, and it forgets it once the tunnel comes back with the
 * address that actually serves the QR.
 */
export class PublicBaseKeeper {
  private mode: TunnelBaseMode = 'off'
  private tunnelUrl: string | undefined
  private relayUrl: string | undefined
  private graceTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param onChange - receives the base the fence should trust from now on.
   * @param graceMs - how long a quick-tunnel host outlives its tunnel.
   */
  constructor(
    private readonly onChange: (base: string | undefined) => void,
    private readonly graceMs: number = PUBLIC_BASE_GRACE_MS,
  ) {}

  /** The base a fresh fence read should trust: the stable relay origin wins. */
  current(): string | undefined {
    return this.relayUrl ?? this.tunnelUrl
  }

  /** The mode that currently owns the public base. */
  setMode(mode: TunnelBaseMode): void {
    this.mode = mode
  }

  /** The last quick-tunnel URL, for callers that must announce it downstream. */
  quickUrl(): string | undefined {
    return this.tunnelUrl
  }

  /** A relay registration result; undefined withdraws the stable origin. */
  setRelay(url: string | undefined): void {
    this.relayUrl = url
    this.emit()
  }

  /** The tunnel reported a live URL: it supersedes any pending grace. */
  markRunning(url: string): void {
    this.cancelGrace()
    this.tunnelUrl = url
    this.emit()
  }

  /**
   * The tunnel left `running` (starting again, or failed). A named tunnel's
   * fixed hostname stays trusted; a quick tunnel's previous host stays
   * trusted for the grace window, then is dropped if nothing replaced it.
   */
  markReconnecting(): void {
    if (this.mode === 'named') return
    this.startGrace()
  }

  /** Re-publish the current base after a branch change that did not move it. */
  refresh(): void {
    this.emit()
  }

  /** Forget everything (teardown, or a mode change that stops the tunnel). */
  reset(): void {
    this.cancelGrace()
    this.tunnelUrl = undefined
    this.relayUrl = undefined
    this.emit()
  }

  /** Cancel the pending grace timer; the keeper keeps its last base. */
  dispose(): void {
    this.cancelGrace()
  }

  private startGrace(): void {
    if (this.tunnelUrl === undefined) return
    if (this.graceTimer !== undefined) return
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined
      this.tunnelUrl = undefined
      this.emit()
    }, this.graceMs)
  }

  private cancelGrace(): void {
    if (this.graceTimer === undefined) return
    clearTimeout(this.graceTimer)
    this.graceTimer = undefined
  }

  private emit(): void {
    this.onChange(this.current())
  }
}
