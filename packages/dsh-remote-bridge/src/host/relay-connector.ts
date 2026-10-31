/**
 * The relay's two connectors. The quick tunnel keeps serving every instance
 * that has not migrated, and the named connector is established beside it on
 * the same relay hostname and left idle while the wildcard Worker route still
 * shadows the CNAME. The control plane's `mode` names the connector the phone
 * is meant to be served from; nothing here switches the edge — it only keeps
 * both sides up, so a server-side flip needs no plugin restart and a rollback
 * is the same flip back.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import {
  claimRelayLease,
  relayClaimRetryOf,
  releaseRelayLease,
  type RelayClaim,
  type RelayClaimOutcome,
  type RelayClaimRequest,
  type RelayConnectorMode,
} from './relay-control.ts'
import type { RelayIdentity } from './relay-registry.ts'
import { createTunnelChildGuard } from './tunnel-orphan.ts'
import { TunnelManager, type TunnelInfo } from './tunnel.ts'

/**
 * The crash-recovery record slot the idle named connector owns. Kept apart
 * from the quick connector's slot so each connector's leftover child is reaped
 * by the start that belongs to it instead of overwriting its sibling's record.
 */
export function namedTunnelChildRecordFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-tunnel-child-named.json')
}

/**
 * Read this plugin's own version from its package manifest (the claim reports
 * it so the migration can measure adoption by released version).
 *
 * This module sits one level deeper than the source root (`src/host/`) while
 * the bundle stays one level under the package root (`lib/index.js`), so the
 * two depths are tried in order with the bundle's own first. A manifest that
 * cannot be read at either depth is a miss, and the claim then carries no
 * version at all.
 * @returns the version, or undefined when the manifest cannot be read.
 */
export function readPluginVersion(): string | undefined {
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const parsed = JSON.parse(readFileSync(new URL(candidate, import.meta.url), 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
    } catch {
      // Not at this depth (source tree or bundle); try the other one.
    }
  }
  return undefined
}

/**
 * The dedupe key of one claim trigger: the local origin port plus the quick
 * tunnel URL the start reported. A settings sync re-runs the tunnel plan with
 * the same key; a tunnel restart mints a new quick URL and therefore claims
 * again (which is also what keeps the lease's `last_seen_at` inside the cron
 * GC's TTL).
 * @param port - the bound web server port, or undefined before it settles.
 * @param target - the quick tunnel URL, or undefined while none is minted.
 * @returns the key, or undefined when there is nothing to claim yet.
 */
export function relayClaimKeyOf(port: number | undefined, target: string | undefined): string | undefined {
  if (port === undefined) return undefined
  return String(port) + '|' + (target ?? '')
}

/** The idle named connector: start, stop and report, nothing else. */
export interface NamedRelayConnector {
  /** Run one named connector for the lease (token via the environment). */
  start(token: string, hostname: string): void
  /** Stop the connector (the relay half was disposed). */
  stop(): void
  readonly info: TunnelInfo
}

/**
 * Build the named connector the relay keeps beside the quick tunnel.
 *
 * Health probing is off on purpose: while the wildcard Worker route answers
 * the relay hostname, a probe of the idle connector's public URL sees the
 * Worker's offline page and would declare a healthy connector dead, restarting
 * it forever (the failure mode issue #1723 fixed for the quick tunnel).
 * @param options - an existing manager (tests); defaults spawn the real one.
 */
export function createNamedRelayConnector(options: { manager?: TunnelManager } = {}): NamedRelayConnector {
  const manager = options.manager ?? new TunnelManager({
    healthCheckIntervalMs: 0,
    orphan: createTunnelChildGuard({ file: namedTunnelChildRecordFile() }),
  })
  return {
    start(token: string, hostname: string): void {
      manager.start({ kind: 'named', token, publicUrl: 'https://' + hostname })
    },
    stop(): void {
      manager.stop()
    },
    get info(): TunnelInfo {
      return manager.info
    },
  }
}

/** The lease half's observable state (logged, and read by the tests). */
export type RelayPairState =
  | { state: 'idle' }
  | { state: 'claiming' }
  | { state: 'claimed'; mode: RelayConnectorMode; hostname: string }
  | { state: 'failed'; error: string }

/** Everything the bridge connector needs to run for one accepted lease. */
export interface RelayBridgeStart {
  claim: RelayClaim
  identity: RelayIdentity
  port: number
}

/** Injectable seams of the lease half (defaults are the real control plane). */
export interface RelayConnectorPairOptions {
  /** One claim attempt. */
  claim?: (request: RelayClaimRequest) => Promise<RelayClaimOutcome>
  /** Start the named connector for one accepted lease. */
  startNamed?: (token: string, hostname: string) => void
  /** Stop the named connector. */
  stopNamed?: () => void
  /** Start (or restart) the bridge connector for one accepted lease. It runs
   * beside the quick tunnel and idles while the instance's mode is quick, so a
   * server-side flip needs no plugin restart. */
  startBridge?: (start: RelayBridgeStart) => void
  /** Stop the bridge connector. */
  stopBridge?: () => void
  /** Release the lease (the offline action, never a retire). */
  release?: (identity: RelayIdentity) => Promise<void>
  /** Observe the lease state (logs only — the card still renders the registry). */
  onState?: (state: RelayPairState) => void
  baseDelayMs?: number
  maxDelayMs?: number
  /** Schedule one retry; defaults to an unref'd node timer. */
  timerFn?: (fn: () => void, ms: number) => { unref?: () => void }
}

/**
 * Own the lease half of the relay: claim it on every tunnel start, bring the
 * named connector up beside the quick one, and retry a failed claim with a
 * capped backoff while the quick connector keeps serving.
 */
export class RelayConnectorPair {
  private stateValue: RelayPairState = { state: 'idle' }
  private leaseValue: RelayClaim | undefined
  private attempts = 0
  private timer: { unref?: () => void } | undefined
  private disposed = false

  constructor(
    private readonly identity: RelayIdentity,
    private readonly options: RelayConnectorPairOptions = {},
  ) {}

  /** The lease half's current state. */
  get state(): RelayPairState {
    return this.stateValue
  }

  /** The connector the phone is served from, for the last accepted lease. */
  get served(): RelayConnectorMode | undefined {
    return this.leaseValue?.mode
  }

  /** The last accepted lease (undefined until one lands). */
  get lease(): RelayClaim | undefined {
    return this.leaseValue
  }

  /**
   * Claim one lease and start (or restart) the named connector for it. A
   * refusal is graded into a retry and never tears down the quick connector:
   * the instance keeps the origin the registry already gave it.
   * @param input - the local origin port and the reporting plugin version.
   * @returns the accepted lease, or undefined when the attempt did not land.
   */
  async start(input: { port: number; pluginVersion?: string }): Promise<RelayClaim | undefined> {
    // A disposed pair stays disposed: a pending retry must not resurrect it.
    if (this.disposed) return undefined
    this.clearTimer()
    this.setState({ state: 'claiming' })
    const claimFn = this.options.claim ?? ((request: RelayClaimRequest) => claimRelayLease(request))
    let outcome: RelayClaimOutcome
    try {
      outcome = await claimFn({
        id: this.identity.id,
        secret: this.identity.secret,
        newSecret: this.identity.fresh === true ? this.identity.secret : undefined,
        port: input.port,
        pluginVersion: input.pluginVersion,
      })
    } catch (error) {
      outcome = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }
    }
    if (this.disposed) return undefined
    if (outcome.ok) {
      // The row exists now: never claim a fresh id twice.
      this.identity.fresh = false
      this.attempts = 0
      this.leaseValue = outcome.claim
      this.startNamed(outcome.claim)
      this.startBridge(outcome.claim, input.port)
      this.setState({ state: 'claimed', mode: outcome.claim.mode, hostname: outcome.claim.hostname })
      return outcome.claim
    }
    this.setState({ state: 'failed', error: outcome.error })
    const retry = relayClaimRetryOf(outcome, this.attempts, {
      baseDelayMs: this.options.baseDelayMs,
      maxDelayMs: this.options.maxDelayMs,
    })
    if (retry.refreshIdentity) this.identity.fresh = true
    if (retry.retry) this.scheduleRetry(input, retry.delayMs)
    return undefined
  }

  /**
   * The plugin's offline action (toggle off, profile unmount): release the
   * lease and stop the idle connector. Never retires — the hostname is the
   * phone's bookmark, and the tunnel behind it survives.
   */
  async release(): Promise<void> {
    const releaseFn = this.options.release ?? ((identity: RelayIdentity) => releaseRelayLease(identity))
    try {
      await releaseFn(this.identity)
    } catch {
      // Best effort: an unreleased row is recovered by the 90-day GC.
    }
    this.stopNamed()
  }

  /** Stop retrying and drop the connector (the relay half was disposed). */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.stopNamed()
    this.setState({ state: 'idle' })
  }

  private startNamed(claim: RelayClaim): void {
    const startNamed = this.options.startNamed
    // A bridged lease carries no tunnel: there is no token to run, and the
    // transport is the bridge connector, so no second cloudflared starts.
    if (startNamed === undefined || claim.tunnel === undefined) return
    try {
      startNamed(claim.tunnel.token, claim.hostname)
    } catch (error) {
      // The connector failing to spawn must not lose the accepted lease.
      console.warn('remote-bridge: the named connector could not start (' + (error instanceof Error ? error.message : String(error)) + ')')
    }
  }

  private stopNamed(): void {
    try {
      this.options.stopNamed?.()
    } catch {
      // Stopping an already-stopped connector is not an error worth surfacing.
    }
    try {
      this.options.stopBridge?.()
    } catch {
      // Same for the bridge half.
    }
  }

  /** Bring the bridge connector up for one accepted lease, if it carries one. */
  private startBridge(claim: RelayClaim, port: number): void {
    const startBridge = this.options.startBridge
    if (startBridge === undefined || claim.bridge === undefined) return
    try {
      startBridge({ claim, identity: this.identity, port })
    } catch (error) {
      // The bridge failing to start must not lose the accepted lease: quick
      // keeps serving, exactly as it does when the claim itself is refused.
      console.warn('remote-bridge: the bridge connector could not start (' + (error instanceof Error ? error.message : String(error)) + ')')
    }
  }

  private scheduleRetry(input: { port: number; pluginVersion?: string }, delayMs: number): void {
    if (this.disposed) return
    this.attempts += 1
    const timerFn = this.options.timerFn ?? ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      timer.unref?.()
      return timer
    })
    this.timer = timerFn(() => {
      this.timer = undefined
      void this.start(input)
    }, delayMs)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer as unknown as NodeJS.Timeout)
    this.timer = undefined
  }

  private setState(state: RelayPairState): void {
    this.stateValue = state
    try {
      this.options.onState?.(state)
    } catch {
      // A throwing observer must not break the lease lifecycle.
    }
  }
}
