/**
 * The second meeting point: the self-hosted relay a configured host keeps beside
 * the market edge.
 *
 * One relay identity serves both meetings — the id and the secret are minted once
 * for this profile and never re-minted for a second endpoint — but everything else
 * about the two halves is separate: their own claim, their own lease, their own
 * connector and their own release. That separation is the reason this file exists.
 * A second meeting point that refuses, times out or is switched off in the provider
 * console must leave the lease that already serves the phone over `dsh-market.com`
 * exactly as it stands, and the reverse holds as well.
 *
 * The half is off unless the mount is configured with both halves of a meeting
 * point — a control-plane base and the public suffix its origin is built from —
 * and {@link relaySecondaryOf} is the one place that decides it. A host that
 * configures nothing therefore never constructs this object, never dials anything
 * and never writes a grant into its roster, which is what keeps the default
 * behaviour of `hello`, the roster and the network byte for byte what it was.
 *
 * The grant is the phone's, not this bridge's ({@link DeviceRoster.setRelayGrant}):
 * this half only reads whatever the newest row holds and presents it to the second
 * control plane. It learns "admitted" or "not admitted" and never learns a tier, a
 * user or an account.
 *
 * A held lease is re-claimed every six hours ({@link SECONDARY_CLAIM_REFRESH_MS}),
 * because the relay only admits a connector whose lease was claimed inside the last
 * 24 hours — so what `hello` announces is a lease the relay admits right now, not one
 * this host once obtained. The market edge has no such loop: its claim follows the
 * plugin's own lifecycle events, and a default host keeps behaving exactly as it did.
 */

import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import {
  claimRelayLease,
  releaseRelayLease,
  relayControlEndpointOf,
  RELAY_GRANT_INVALID,
  RELAY_TIER_REQUIRED,
  type RelayClaimOutcome,
  type RelayClaimRequest,
} from './relay-control.ts'
import { RelayConnectorPair, type RelayBridgeStart, type RelayPairState } from './relay-connector.ts'
import type { RelayIdentity } from './relay-registry.ts'

/**
 * The refusal codes that say this instance holds no second lease at all.
 *
 * `tier-required` is the entitlement answer, `grant-invalid` the grant the account
 * service will not vouch for (an expired 30-day grant is this one), `auth-failed`
 * the id that belongs to another secret on this meeting point. Every other refusal
 * is transient by nature (a rate limit, an upstream outage, a socket that never
 * answered) and keeps the announcement: the lease the relay already recorded runs
 * on its own 24-hour clock and the connector behind it is still up, so withdrawing
 * the origin on a failed refresh would flap a working phone path back to the market
 * edge.
 */
const SECOND_LEASE_REFUSED: ReadonlySet<string> = new Set<string>([RELAY_TIER_REQUIRED, RELAY_GRANT_INVALID, 'auth-failed'])

/**
 * The subset of those refusals that also releases the lease and stops the connector.
 *
 * Exactly the two admission refusals: the host no longer has anything the relay
 * admits, so the lease row it may still hold is withdrawn and the connector that
 * would re-dial with it is stopped. `auth-failed` is deliberately NOT here — the
 * release would be refused by the same credential check, so the only thing left to
 * do is stop announcing, which the withdrawal above already did.
 */
const SECOND_LEASE_RELEASED: ReadonlySet<string> = new Set<string>([RELAY_TIER_REQUIRED, RELAY_GRANT_INVALID])

/**
 * How often a held second lease is refreshed: six hours.
 *
 * The relay stops admitting a connector when the lease behind it has not been
 * claimed within 24 hours, so the refresh has to run well inside that window, and
 * six hours is the interval the design itself names (a downgrade is then noticed at
 * the next refresh rather than at the next restart). The market edge has no such
 * loop on purpose: its lease is refreshed by the plugin's own lifecycle events, and
 * the default host must keep behaving exactly as it did.
 */
export const SECONDARY_CLAIM_REFRESH_MS = 6 * 60 * 60 * 1000

/**
 * How a refused connector attach reads in the bridge runner's state line.
 *
 * The connector reports the status it was refused with (`refused with 403`), never
 * the body, so `lease-stale` — the relay's answer to a lease nobody claimed inside
 * the 24-hour window — cannot be read by name from this side. A credential refusal
 * reads the same way (`401`), and both are repaired by the same act: claim again
 * with the identity the connector presents.
 */
const ATTACH_REFUSED_RE = /(?:refused with|upgrade answered)\s+40[13]\b/

/**
 * Where the second connector records its state
 * (`$DSH_HOME/remote-web-ui-relay-bridge-secondary.json`).
 *
 * Its own file, never the first half's: two connectors that wrote one record would
 * each overwrite the other's state, and the record exists precisely to say which
 * meeting point served which lease.
 * @param home - the DSH home (a test seam).
 * @returns the absolute record path.
 */
export function relaySecondaryBridgeStateFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-relay-bridge-secondary.json')
}

/** One configured second meeting point. */
export interface RelaySecondaryMeetingPoint {
  /** The second control-plane base: its `claim` and `release` both hang off it. */
  readonly controlUrl: string
  /** The public suffix the announced origin is built from, leading dot included. */
  readonly publicSuffix: string
}

/**
 * The second meeting point one configuration names, or undefined.
 *
 * Both halves are required and neither has a default: an origin cannot be built
 * from a control-plane base alone, and a control plane cannot be reached from a
 * suffix alone. A profile that names only one of them therefore has no second
 * meeting point at all rather than half of one, which keeps every consumer of this
 * answer able to treat "undefined" as "this host has one meeting point".
 * @param config - the resolved bridge configuration (read structurally).
 * @returns the meeting point, or undefined when this host has none.
 */
export function relaySecondaryOf(config: {
  readonly relaySecondaryControlUrl?: string
  readonly relaySecondaryPublicSuffix?: string
}): RelaySecondaryMeetingPoint | undefined {
  const controlUrl = config.relaySecondaryControlUrl?.trim()
  const suffix = config.relaySecondaryPublicSuffix?.trim()
  if (controlUrl === undefined || controlUrl === '') return undefined
  if (suffix === undefined || suffix === '') return undefined
  // 主机名是 `<id>` 直接拼上这个后缀，所以缺了那个点就会拼出一个不存在的主机名。
  // 配置是手写的，这里补上它，比让公告指向一个拨不通的地址好。
  return { controlUrl, publicSuffix: suffix.startsWith('.') ? suffix : '.' + suffix }
}

/**
 * The origin this host announces for its second meeting point.
 *
 * Built from the identity and the configured suffix, never from the hostname a
 * claim answered with: the id is the one this host has held since it minted its
 * identity, while the suffix is the operator's statement of where that identity's
 * second meeting point is. Whether it is announced at all is a different question —
 * {@link RelaySecondaryHalf.origin} answers it, and only while a fresh lease is held.
 * @param identity - the one relay identity both meetings share.
 * @param publicSuffix - the configured suffix, leading dot included.
 * @returns the `wss://` origin the greeting carries.
 */
export function relaySecondaryOriginOf(identity: RelayIdentity, publicSuffix: string): string {
  return 'wss://' + identity.id + publicSuffix
}

/** What one second meeting point needs from the mount. */
export interface RelaySecondaryOptions {
  /** The one relay identity both meeting points share. Never a second identity. */
  readonly identity: RelayIdentity
  /** The second control-plane base. */
  readonly controlUrl: string
  /** The public suffix the announced origin is built from. */
  readonly publicSuffix: string
  /**
   * The grant the roster currently holds, read once per claim.
   *
   * Read rather than captured because a phone may hand one over at any moment, and
   * the claim that lands after that has to carry it.
   */
  grant: () => string | undefined
  /** The ingress gate port a claim reports, or undefined before it settles. */
  port: () => number | undefined
  /** The plugin version a claim reports. */
  pluginVersion?: () => string | undefined
  /** Start (or restart) the connector for one accepted lease. */
  startBridge?: (start: RelayBridgeStart) => void
  /** Stop that connector. */
  stopBridge?: () => void
  /** One claim attempt (defaults to the real control plane). */
  claim?: (request: RelayClaimRequest) => Promise<RelayClaimOutcome>
  /** Release one lease (defaults to the real control plane). */
  release?: (identity: RelayIdentity) => Promise<void>
  /** Observe the lease state (logged by the mount, driven by the suites). */
  onState?: (state: RelayPairState) => void
  baseDelayMs?: number
  maxDelayMs?: number
  /** Schedule one retry; defaults to an unref'd node timer. */
  timerFn?: (fn: () => void, ms: number) => { unref?: () => void }
  /** How often a held lease is refreshed (defaults to {@link SECONDARY_CLAIM_REFRESH_MS}). */
  refreshMs?: number
  /**
   * Start the periodic refresh and return its canceller.
   *
   * Defaults to an unref'd `setInterval`: the loop must never be a reason for the
   * process to stay alive, and it must be cancelled by `dispose` and by `release`.
   */
  refreshTimer?: (tick: () => void, ms: number) => () => void
  log?: (message: string) => void
}

/**
 * Own the second meeting point's lease: claim it once per port and grant, follow
 * the grant the phone hands over, and answer the origin `hello` announces.
 *
 * Built on {@link RelayConnectorPair} on purpose — the claim/retry/release
 * lifecycle is the same one the market edge runs — but with its own injected claim
 * (which adds the grant) and its own connector and release, so the two halves share
 * the identity and nothing else.
 */
export class RelaySecondaryHalf {
  readonly #options: RelaySecondaryOptions
  readonly #pair: RelayConnectorPair
  /** Whether this instance currently holds a lease at the second meeting point. */
  #held = false
  /** The `port|grant` key of the last claim this half started. */
  #claimedFor: string | undefined
  /** The canceller of the running six-hour refresh, while there is one. */
  #stopRefresh: (() => void) | undefined
  /** The endpoint the running connector dials; undefined while no connector runs. */
  #bridgeEndpoint: string | undefined
  #disposed = false

  constructor(options: RelaySecondaryOptions) {
    this.#options = options
    const claim = options.claim ?? (async (request: RelayClaimRequest) => await claimRelayLease(
      request,
      { url: relayControlEndpointOf('claim', options.controlUrl) },
    ))
    this.#pair = new RelayConnectorPair(options.identity, {
      // 名册里那条授权是这一半自己的事实，不是某个申领实现的细节，所以它包在注入的
      // 申领外面：不论测试还是挂载用哪一个，请求都带上授权，没有就整条键都不发
      // （见 relayClaimBody）。
      claim: async request => {
        const grant = options.grant()
        return await claim({ ...request, ...(grant === undefined ? {} : { grant }) })
      },
      release: options.release ?? (async identity => {
        await releaseRelayLease(identity, { url: relayControlEndpointOf('release', options.controlUrl) })
      }),
      // A refresh claims a fresh lease, and the connector is already dialling the same
      // meeting point with the same identity: restarting it would terminate every
      // stream it carries once per interval. It is restarted only when the endpoint
      // actually moves, or when it was stopped and something has to bring it back.
      ...(options.startBridge === undefined ? {} : {
        startBridge: (start: RelayBridgeStart) => {
          const endpoint = start.claim.bridge?.endpoint
          if (endpoint !== undefined && endpoint === this.#bridgeEndpoint) return
          this.#bridgeEndpoint = endpoint
          options.startBridge?.(start)
        },
      }),
      ...(options.stopBridge === undefined ? {} : {
        stopBridge: () => {
          this.#bridgeEndpoint = undefined
          options.stopBridge?.()
        },
      }),
      ...(options.baseDelayMs === undefined ? {} : { baseDelayMs: options.baseDelayMs }),
      ...(options.maxDelayMs === undefined ? {} : { maxDelayMs: options.maxDelayMs }),
      ...(options.timerFn === undefined ? {} : { timerFn: options.timerFn }),
      onState: state => { this.#observe(state) },
    })
  }

  /** The lease half's current state (the market edge's own vocabulary). */
  get state(): RelayPairState {
    return this.#pair.state
  }

  /**
   * Claim the second meeting point once for the current port and grant.
   *
   * One claim per `port|grant` pair: a settings sync re-plans with the same key and
   * must not turn into a claim per plan, while a settled port or a grant the phone
   * just handed over is a genuinely new fact and claims again.
   * @returns whether a claim was started.
   */
  claim(): boolean {
    if (this.#disposed) return false
    const port = this.#options.port()
    if (port === undefined) return false
    const key = this.#keyOf(port)
    if (this.#claimedFor === key) return false
    this.#claimedFor = key
    this.#logFailure(this.#start(port))
    return true
  }

  /**
   * A grant just landed in the roster: claim again right away.
   *
   * Unconditional on purpose — a phone that resends the grant it already handed over
   * is asking this host to try again, and the pending wait (which may be the
   * six-hour one a downgrade armed) is cleared by the claim itself.
   * @returns when this attempt settled, so a suite can drive it deterministically.
   */
  async grantReceived(): Promise<void> {
    if (this.#disposed) return
    const port = this.#options.port()
    if (port === undefined) return
    this.#claimedFor = this.#keyOf(port)
    await this.#start(port)
  }

  /**
   * The second connector could not attach, so the lease it presents is claimed again.
   *
   * This is the stale-lease repair. The relay refuses a connector whose lease nobody
   * has claimed inside the 24-hour window (`403 lease-stale`), which the six-hour
   * refresh is meant to prevent — a suspended process, a long offline stretch or a
   * clock that jumped can still produce one, and the repair is exactly one claim with
   * the identity the connector was already presenting.
   *
   * Only a *refusal* counts: a dial timeout or a dropped socket is the connector's own
   * backoff to sort out, and asking the control plane about it every 30 seconds would
   * turn a network blip into a claim storm. Only a held lease counts too — once a
   * refusal has told this half it holds nothing, its own wait (six hours, or none at
   * all for a terminal answer) decides when to try again.
   * @param error - the failure the bridge runner reported for its connector.
   */
  connectorFailed(error: string): void {
    if (this.#disposed || !this.#held) return
    if (!ATTACH_REFUSED_RE.test(error)) return
    const port = this.#options.port()
    if (port === undefined) return
    // This claim replaces whatever the refresh had pending: it is the same act.
    this.#claimedFor = this.#keyOf(port)
    this.#logFailure(this.#start(port))
  }

  /**
   * The origin this host may announce right now, or undefined.
   *
   * Announcement follows the lease, not the configuration: an advertised meeting
   * point whose origin nobody serves is worse than no advertisement at all.
   * @returns `wss://<id><suffix>` while a lease is held.
   */
  origin(): string | undefined {
    return this.#held ? relaySecondaryOriginOf(this.#options.identity, this.#options.publicSuffix) : undefined
  }

  /**
   * Release the second lease and stop its connector.
   *
   * This never touches the first half: it releases against the second control plane
   * only and stops the connector this object was handed.
   */
  async release(): Promise<void> {
    this.#held = false
    this.#stopRefreshNow()
    await this.#pair.release()
  }

  /** Stop retrying and drop the connector (plugin teardown, or the relay turned off). */
  dispose(): void {
    this.#disposed = true
    this.#held = false
    this.#stopRefreshNow()
    this.#pair.dispose()
  }

  /**
   * Fire one claim attempt without letting its failure escape.
   *
   * A claim is a network round trip, so a failure is one line in the log and never an
   * unhandled rejection — the same exit the market edge's claimer takes.
   * @param attempt - the claim being fired.
   */
  #logFailure(attempt: Promise<void>): void {
    void attempt.catch((error: unknown) => {
      this.#options.log?.('the second meeting point claim did not land: '
        + (error instanceof Error ? error.message : String(error)))
    })
  }

  /**
   * The key one claim is deduplicated on: the settled port plus the grant in force.
   * @param port - the ingress gate port a claim reports.
   * @returns the key.
   */
  #keyOf(port: number): string {
    return String(port) + '|' + (this.#options.grant() ?? '')
  }

  /** One claim attempt for one settled port. */
  async #start(port: number): Promise<void> {
    const version = this.#options.pluginVersion?.()
    await this.#pair.start({ port, ...(version === undefined ? {} : { pluginVersion: version }) })
  }

  /**
   * Follow the lease lifecycle: this is the one place that decides what `hello`
   * announces and what the relay is told when a lease ends.
   * @param state - the state the pair just moved to.
   */
  #observe(state: RelayPairState): void {
    if (state.state === 'claimed') {
      this.#held = true
      this.#armRefresh()
    } else if (state.state === 'idle') {
      this.#held = false
      this.#stopRefreshNow()
    } else if (state.state === 'failed' && SECOND_LEASE_REFUSED.has(state.error)) {
      this.#held = false
      this.#stopRefreshNow()
      if (SECOND_LEASE_RELEASED.has(state.error)) {
        // 释放是无条件的：一个刚刚重新判定过这台宿主的会合点可能还握着上一次的租约
        // 行，而这个宿主已经不再公告那个地址了；释放是幂等的，失败也只影响这一行。
        void this.#releaseSecondLease()
      }
    }
    try {
      this.#options.onState?.(state)
    } catch {
      // A throwing observer must not break the lease lifecycle.
    }
  }

  /**
   * Start the six-hour refresh, once.
   *
   * It runs exactly while this half holds a lease: the relay's own window is 24 hours,
   * the design's refresh interval is six, and a half that was told it holds nothing
   * leaves the retry to the decision that refusal produced.
   */
  #armRefresh(): void {
    if (this.#stopRefresh !== undefined || this.#disposed) return
    const ms = this.#options.refreshMs ?? SECONDARY_CLAIM_REFRESH_MS
    const start = this.#options.refreshTimer ?? ((tick: () => void, every: number) => {
      const timer = setInterval(tick, every)
      // The loop must never be a reason for the process to stay alive.
      timer.unref?.()
      return () => { clearInterval(timer) }
    })
    this.#stopRefresh = start(() => { this.#logFailure(this.#refresh()) }, ms)
  }

  /** Cancel the refresh, if one is running. */
  #stopRefreshNow(): void {
    const stop = this.#stopRefresh
    if (stop === undefined) return
    this.#stopRefresh = undefined
    try {
      stop()
    } catch (error) {
      this.#options.log?.('the second meeting point refresh could not be cancelled: '
        + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** One periodic refresh: claim the lease the relay is about to consider stale. */
  async #refresh(): Promise<void> {
    if (this.#disposed || !this.#held) return
    const port = this.#options.port()
    if (port === undefined) return
    this.#claimedFor = this.#keyOf(port)
    await this.#start(port)
  }

  /** Release the second lease, best effort; a failure only leaves a row for the GC. */
  async #releaseSecondLease(): Promise<void> {
    try {
      await this.#pair.release()
    } catch (error) {
      this.#options.log?.('the second meeting point lease could not be released: '
        + (error instanceof Error ? error.message : String(error)))
    }
  }
}

/**
 * Build the second meeting point half.
 * @param options - the identity, the meeting point and the mount's seams.
 * @returns the half, ready to claim.
 */
export function createRelaySecondaryHalf(options: RelaySecondaryOptions): RelaySecondaryHalf {
  return new RelaySecondaryHalf(options)
}
