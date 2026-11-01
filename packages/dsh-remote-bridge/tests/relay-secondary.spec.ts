/**
 * The second meeting point beside the market edge: one identity, another control
 * plane, another lease, another connector.
 *
 * What these cases protect is the separation, not one happy path: a claim here
 * carries the grant the phone handed over and never carries one it does not have,
 * a tier refusal releases this lease alone and stops announcing the origin, a
 * transient refusal keeps the announcement, and the backoff a downgrade armed is
 * cleared the moment a new grant arrives. The market edge's own lease is not part
 * of this file, because nothing here is allowed to touch it.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CLAIM_RETRY_MAX_MS,
  CLAIM_TIER_REQUIRED_DELAY_MS,
  relayClaimBody,
  relayClaimRetryOf,
  RELAY_GRANT_INVALID,
  RELAY_TIER_REQUIRED,
  type RelayClaim,
  type RelayClaimOutcome,
  type RelayClaimRequest,
} from '../src/host/relay-control.ts'
import { RelayConnectorPair } from '../src/host/relay-connector.ts'
import {
  createRelaySecondaryHalf,
  relaySecondaryBridgeStateFile,
  relaySecondaryOf,
  relaySecondaryOriginOf,
  SECONDARY_CLAIM_REFRESH_MS,
  type RelaySecondaryOptions,
} from '../src/host/relay-secondary.ts'
import type { RelayIdentity } from '../src/host/relay-registry.ts'
import { settle } from './support/harness.ts'

const ID = 'abcd1234abcd1234'
const SECRET = 'A'.repeat(43)
const CONTROL_URL = 'https://relay.chatwithai.icu/v1/relay'
const SUFFIX = '.relay.chatwithai.icu'
const ORIGIN = 'wss://' + ID + SUFFIX

/** The one identity both meeting points share. */
function identity(): RelayIdentity {
  return { id: ID, secret: SECRET }
}

/** The bridged lease the second meeting point answers for this identity. */
function bridgedLease(): RelayClaim {
  return {
    mode: 'bridge',
    hostname: ID + SUFFIX,
    bridge: { endpoint: 'wss://relay.chatwithai.icu/__relay/connector', instance: ID, credential: 'lease-secret' },
  }
}

/** The market edge's own lease: a tunnel transport, which is the shape it always answers. */
function marketLease(): RelayClaim {
  return {
    mode: 'quick',
    tunnel: { id: 'tunnel-uuid-1', token: 'per-instance-tunnel-token' },
    hostname: ID + '.dsh-market.com',
    dns: { target: 'tunnel-uuid-1.cfargotunnel.com' },
  }
}

/** A claim seam that answers the scripted outcomes in order and records requests. */
function scriptedClaim(outcomes: RelayClaimOutcome[]): {
  readonly requests: RelayClaimRequest[]
  claim: (request: RelayClaimRequest) => Promise<RelayClaimOutcome>
} {
  const requests: RelayClaimRequest[] = []
  return {
    requests,
    claim: async (request: RelayClaimRequest) => {
      requests.push(request)
      return outcomes[Math.min(requests.length - 1, outcomes.length - 1)] ?? { ok: false, status: 0, error: 'no-script' }
    },
  }
}

/** A retry seam that records the wait it was asked for and lets a test fire it. */
function scriptedTimer(): { readonly scheduled: { fn: () => void; ms: number }[]; timerFn: (fn: () => void, ms: number) => { unref(): void } } {
  const scheduled: { fn: () => void; ms: number }[] = []
  return {
    scheduled,
    timerFn: (fn: () => void, ms: number) => {
      scheduled.push({ fn, ms })
      return { unref() {} }
    },
  }
}

/** A refresh seam that records the interval it was asked for and lets a test fire one tick. */
function scriptedRefresh(): {
  readonly armed: { tick: () => void; ms: number }[]
  readonly cancelled: number
  refreshTimer: (tick: () => void, ms: number) => () => void
} {
  const armed: { tick: () => void; ms: number }[] = []
  let cancelled = 0
  return {
    armed,
    get cancelled(): number { return cancelled },
    refreshTimer: (tick: () => void, ms: number) => {
      armed.push({ tick, ms })
      return () => { cancelled += 1 }
    },
  }
}

/** Everything one half was handed, plus what it did with it. */
function halfOf(overrides: Partial<RelaySecondaryOptions> = {}) {
  const released: RelayIdentity[] = []
  const connectors = { started: 0, stopped: 0 }
  const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
  const half = createRelaySecondaryHalf({
    identity: identity(),
    controlUrl: CONTROL_URL,
    publicSuffix: SUFFIX,
    grant: () => undefined,
    port: () => 3080,
    claim: script.claim,
    release: async (who: RelayIdentity) => { released.push(who) },
    startBridge: () => { connectors.started += 1 },
    stopBridge: () => { connectors.stopped += 1 },
    ...overrides,
  })
  return { half, released, connectors, script }
}

describe('the claim a second meeting point reads', () => {
  it('operator claims with the grant a phone handed over and the body carries it', () => {
    // Given a host whose roster holds one relay grant
    // When the claim body is built for the second meeting point
    // Then the contract's optional key is on it, beside the identity it always carried
    const body = JSON.parse(relayClaimBody({ id: ID, secret: SECRET, port: 3080, grant: 'grant-1' })) as Record<string, unknown>
    expect(body.grant).toBe('grant-1')
    expect(body.id).toBe(ID)
    expect(body.origin).toEqual({ port: 3080 })
  })

  it('operator claims without a grant and the body carries no grant key at all', () => {
    // Given a host no phone has handed a grant to
    // When the claim body is built
    // Then the key is absent rather than null, which the meeting point would read
    // as a present but unverifiable grant
    const body = JSON.parse(relayClaimBody({ id: ID, secret: SECRET, port: 3080 })) as Record<string, unknown>
    expect('grant' in body).toBe(false)
    // An empty string is the same absence, never a key carrying nothing
    const blank = JSON.parse(relayClaimBody({ id: ID, secret: SECRET, port: 3080, grant: '' })) as Record<string, unknown>
    expect('grant' in blank).toBe(false)
  })
})

describe('grading a refusal from the second meeting point', () => {
  it('operator is refused the tier and the retry waits six hours instead of the rate-limit cap', () => {
    // Given a meeting point that answers 403 tier-required, and the shipped cap in force
    // When the refusal is graded
    // Then it retries after six hours, keeps the identity, and the 300 s cap does not clamp it
    expect(relayClaimRetryOf({ ok: false, status: 403, error: RELAY_TIER_REQUIRED }, 0, { maxDelayMs: CLAIM_RETRY_MAX_MS }))
      .toEqual({ retry: true, delayMs: 21_600_000, refreshIdentity: false })
    expect(CLAIM_TIER_REQUIRED_DELAY_MS).toBe(21_600_000)
    // And a fourth attempt grades the same wait rather than a longer one
    expect(relayClaimRetryOf({ ok: false, status: 403, error: RELAY_TIER_REQUIRED }, 3).delayMs).toBe(CLAIM_TIER_REQUIRED_DELAY_MS)
  })

  it('operator holds a grant the service will not vouch for and the retry waits the same six hours', () => {
    // Given a grant that reached the end of its 30 days, which the meeting point
    // answers exactly like a tier it will not admit
    // When it is graded
    // Then it takes the tier refusal's branch — six hours, the same identity, the
    // same freedom from the rate-limit cap — because the repair is a fresh grant or
    // another evaluation, never a new identity
    expect(relayClaimRetryOf({ ok: false, status: 403, error: RELAY_GRANT_INVALID }, 0, { maxDelayMs: CLAIM_RETRY_MAX_MS }))
      .toEqual({ retry: true, delayMs: 21_600_000, refreshIdentity: false })
  })

  it('operator holds a secret the meeting point does not know and nothing is retried', () => {
    // Given the one 403 that is about the credentials themselves
    // When it is graded
    // Then it stays terminal, with no identity refresh and no wait
    expect(relayClaimRetryOf({ ok: false, status: 403, error: 'auth-failed' }, 0))
      .toEqual({ retry: false, delayMs: 0, refreshIdentity: false })
  })
})

describe('the second lease half', () => {
  it('operator claims the second meeting point with the grant on the roster and starts announcing it', async () => {
    // Given a host holding one grant and a meeting point that admits it
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
    const connectors = { started: 0, stopped: 0 }
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      startBridge: () => { connectors.started += 1 },
      stopBridge: () => { connectors.stopped += 1 },
    })
    // Then nothing is announced before a lease exists
    expect(half.origin()).toBeUndefined()
    // When the half claims for the settled port
    const started = half.claim()
    await settle()
    // Then the claim carried the grant, the connector came up and the origin is announced
    expect(started).toBe(true)
    expect(script.requests).toHaveLength(1)
    expect(script.requests[0]?.grant).toBe('grant-1')
    expect(script.requests[0]?.port).toBe(3080)
    expect(connectors.started).toBe(1)
    expect(half.origin()).toBe(ORIGIN)
    expect(half.state).toEqual({ state: 'claimed', mode: 'bridge', hostname: ID + SUFFIX })
  })

  it('user has no grant yet and the second claim omits the key rather than sending null', async () => {
    // Given a host whose roster holds no grant
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => undefined,
      port: () => 3080,
      claim: script.claim,
    })
    // When it claims
    half.claim()
    await settle()
    // Then the request object has no grant member and the body it serializes has no key
    expect(script.requests).toHaveLength(1)
    expect('grant' in (script.requests[0] ?? {})).toBe(false)
    expect('grant' in (JSON.parse(relayClaimBody(script.requests[0] ?? { id: ID, secret: SECRET, port: 3080 })) as Record<string, unknown>)).toBe(false)
  })

  it('operator is refused the tier and only the second lease is released while the origin stops being announced', async () => {
    // Given a host that held the second lease, and a meeting point that now refuses the tier
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }, { ok: false, status: 403, error: RELAY_TIER_REQUIRED }])
    const timer = scriptedTimer()
    const released: RelayIdentity[] = []
    const connectors = { started: 0, stopped: 0 }
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      release: async (who: RelayIdentity) => { released.push(who) },
      startBridge: () => { connectors.started += 1 },
      stopBridge: () => { connectors.stopped += 1 },
      timerFn: timer.timerFn,
      maxDelayMs: CLAIM_RETRY_MAX_MS,
    })
    half.claim()
    await settle()
    expect(half.origin()).toBe(ORIGIN)
    // When the next claim is refused the tier
    await half.grantReceived()
    await settle()
    // Then the announcement is gone, the lease was released for this one identity,
    // the connector stopped, and the wait is the six-hour one rather than the cap
    expect(half.origin()).toBeUndefined()
    expect(released.map(who => who.id + '|' + who.secret)).toEqual([ID + '|' + SECRET])
    expect(connectors.stopped).toBe(1)
    expect(timer.scheduled.map(entry => entry.ms)).toEqual([CLAIM_TIER_REQUIRED_DELAY_MS])
    expect(half.state).toEqual({ state: 'failed', error: RELAY_TIER_REQUIRED })
  })

  it('operator is refused a grant the service will not verify and a fresh grant does not wait for the cooldown', async () => {
    // Given a host whose stored grant the meeting point will not verify
    const script = scriptedClaim([
      { ok: false, status: 403, error: RELAY_GRANT_INVALID },
      { ok: true, claim: bridgedLease() },
    ])
    const timer = scriptedTimer()
    let grant = 'expired-1'
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => grant,
      port: () => 3080,
      claim: script.claim,
      timerFn: timer.timerFn,
    })
    half.claim()
    await settle()
    // Then nothing is announced while the six-hour wait is armed for another try
    expect(half.origin()).toBeUndefined()
    expect(timer.scheduled.map(entry => entry.ms)).toEqual([CLAIM_TIER_REQUIRED_DELAY_MS])
    // When the phone hands a fresh grant over
    grant = 'fresh-1'
    await half.grantReceived()
    // Then that claim carries the new text, right away, and the origin comes back
    expect(script.requests).toHaveLength(2)
    expect(script.requests[1]?.grant).toBe('fresh-1')
    expect(half.origin()).toBe(ORIGIN)
  })

  it('operator holds a grant that expires mid-lease and the second lease is released like a tier refusal', async () => {
    // Given a host that holds the second lease over a running connector
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }, { ok: false, status: 403, error: RELAY_GRANT_INVALID }])
    const timer = scriptedTimer()
    const released: RelayIdentity[] = []
    const connectors = { started: 0, stopped: 0 }
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      release: async (who: RelayIdentity) => { released.push(who) },
      startBridge: () => { connectors.started += 1 },
      stopBridge: () => { connectors.stopped += 1 },
      timerFn: timer.timerFn,
      maxDelayMs: CLAIM_RETRY_MAX_MS,
    })
    half.claim()
    await settle()
    // When the next refresh is refused because the 30-day grant ran out
    await half.grantReceived()
    await settle()
    // Then it is the tier refusal's branch exactly: the announcement goes, the
    // second lease is released, the connector stops, and the wait is six hours
    expect(half.origin()).toBeUndefined()
    expect(released.map(who => who.id + '|' + who.secret)).toEqual([ID + '|' + SECRET])
    expect(connectors.stopped).toBe(1)
    expect(timer.scheduled.map(entry => entry.ms)).toEqual([CLAIM_TIER_REQUIRED_DELAY_MS])
  })

  it('user hands over a new grant and the backoff that was pending is cleared', async () => {
    // Given a refused claim whose retry is armed on the real timer
    vi.useFakeTimers()
    try {
      const script = scriptedClaim([
        { ok: false, status: 429, error: 'rate-limited' },
        { ok: true, claim: bridgedLease() },
      ])
      let grant = 'grant-1'
      const half = createRelaySecondaryHalf({
        identity: identity(),
        controlUrl: CONTROL_URL,
        publicSuffix: SUFFIX,
        grant: () => grant,
        port: () => 3080,
        claim: script.claim,
      })
      half.claim()
      await settle()
      expect(script.requests).toHaveLength(1)
      // When a fresh grant arrives before that wait is due
      grant = 'grant-2'
      await half.grantReceived()
      expect(script.requests).toHaveLength(2)
      // Then firing every pending timer claims nothing more: the armed retry was cancelled
      vi.advanceTimersByTime(10 * 60_000)
      await settle()
      expect(script.requests).toHaveLength(2)
      expect(script.requests[1]?.grant).toBe('grant-2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('operator turns the relay off and the second lease is released without touching the first', async () => {
    // Given a half holding the second lease over its own connector
    const { half, released, connectors } = halfOf({ grant: () => 'grant-1' })
    half.claim()
    await settle()
    expect(half.origin()).toBe(ORIGIN)
    // When it is released (the relay toggle turned off)
    await half.release()
    // Then exactly one lease was released, through this half's own endpoint, and the
    // announcement is withdrawn with the connector
    expect(released.map(who => who.id + '|' + who.secret)).toEqual([ID + '|' + SECRET])
    expect(connectors.stopped).toBe(1)
    expect(half.origin()).toBeUndefined()
  })

  it('operator disposes the half and a later plan cannot resurrect the claim', async () => {
    // Given a half that was disposed with the plugin teardown
    const { half, script } = halfOf()
    half.claim()
    await settle()
    half.dispose()
    // When a plan asks for a claim again
    const started = half.claim()
    await settle()
    // Then nothing more leaves the process and the half reports itself idle
    expect(started).toBe(false)
    expect(script.requests).toHaveLength(1)
    expect(half.state).toEqual({ state: 'idle' })
    expect(half.origin()).toBeUndefined()
  })
})

describe('keeping the second lease fresh', () => {
  it('user holds the second lease and it is claimed again every six hours', async () => {
    // Given a host with a grant and no lease yet
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
    const refresh = scriptedRefresh()
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      refreshTimer: refresh.refreshTimer,
    })
    // Then no loop runs before there is a lease to keep fresh
    expect(refresh.armed).toEqual([])
    // When the lease lands
    half.claim()
    await settle()
    // Then the loop is armed on the design's six hours
    expect(refresh.armed.map(entry => entry.ms)).toEqual([SECONDARY_CLAIM_REFRESH_MS])
    expect(SECONDARY_CLAIM_REFRESH_MS).toBe(21_600_000)
    // When a tick fires
    refresh.armed[0]?.tick()
    await settle()
    // Then the lease is claimed again with the same grant, which is what keeps the
    // relay from ever seeing a lease older than its 24-hour window
    expect(script.requests).toHaveLength(2)
    expect(script.requests[1]?.grant).toBe('grant-1')
    expect(half.origin()).toBe(ORIGIN)
    // And disposing the half cancels the loop
    half.dispose()
    expect(refresh.cancelled).toBe(1)
  })

  it('operator is refused the tier and the refresh stops with the announcement until a new lease lands', async () => {
    // Given a half holding the lease with its refresh running
    const script = scriptedClaim([
      { ok: true, claim: bridgedLease() },
      { ok: false, status: 403, error: RELAY_TIER_REQUIRED },
      { ok: true, claim: bridgedLease() },
    ])
    const refresh = scriptedRefresh()
    let grant = 'grant-1'
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => grant,
      port: () => 3080,
      claim: script.claim,
      timerFn: scriptedTimer().timerFn,
      refreshTimer: refresh.refreshTimer,
    })
    half.claim()
    await settle()
    // When a refresh is refused the tier
    await half.grantReceived()
    await settle()
    // Then the loop is cancelled: a half that holds nothing leaves the next attempt
    // to the six-hour wait that refusal armed
    expect(refresh.cancelled).toBe(1)
    expect(half.origin()).toBeUndefined()
    // When an admitted lease lands again after a fresh grant
    grant = 'grant-2'
    await half.grantReceived()
    // Then the loop is armed again, once, and the origin is announced
    expect(refresh.armed).toHaveLength(2)
    expect(half.origin()).toBe(ORIGIN)
  })

  it('user refreshes the lease without tearing the connector down, and a new lease brings a stopped one back', async () => {
    // Given a half holding the lease with its connector dialling that meeting point
    const script = scriptedClaim([
      { ok: true, claim: bridgedLease() },
      { ok: true, claim: bridgedLease() },
      { ok: false, status: 403, error: RELAY_TIER_REQUIRED },
      { ok: true, claim: bridgedLease() },
    ])
    const refresh = scriptedRefresh()
    const connectors = { started: 0, stopped: 0 }
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      release: async () => undefined,
      startBridge: () => { connectors.started += 1 },
      stopBridge: () => { connectors.stopped += 1 },
      timerFn: scriptedTimer().timerFn,
      refreshTimer: refresh.refreshTimer,
    })
    half.claim()
    await settle()
    expect(connectors.started).toBe(1)
    // When the six-hour refresh claims the same lease again
    refresh.armed[0]?.tick()
    await settle()
    // Then the lease is refreshed while the socket keeps serving: a refresh is not a
    // reason to terminate every stream the connector carries
    expect(script.requests).toHaveLength(2)
    expect(connectors.started).toBe(1)
    expect(connectors.stopped).toBe(0)
    // When a refused refresh stops the connector
    await half.grantReceived()
    await settle()
    expect(connectors.stopped).toBe(1)
    // Then the next accepted lease dials again instead of trusting a socket that is gone
    await half.grantReceived()
    await settle()
    expect(connectors.started).toBe(2)
    expect(half.origin()).toBe(ORIGIN)
  })

  it('operator sees a refused connector attach and the half claims again at once', async () => {
    // Given a half that believes it holds the lease
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => 'grant-1',
      port: () => 3080,
      claim: script.claim,
      refreshTimer: scriptedRefresh().refreshTimer,
    })
    half.claim()
    await settle()
    // When a dial failure is reported it is the connector's own backoff to sort out
    half.connectorFailed('connect ECONNREFUSED 127.0.0.1:18789')
    await settle()
    expect(script.requests).toHaveLength(1)
    // When the attach is refused instead — the relay's answer to a lease nobody
    // claimed inside its window
    half.connectorFailed('refused with 403')
    await settle()
    // Then one claim goes out at once, carrying the grant the connector presented
    expect(script.requests).toHaveLength(2)
    expect(script.requests[1]?.grant).toBe('grant-1')
  })

  it('operator has no lease to repair and a refused attach claims nothing', async () => {
    // Given a half that was never admitted
    const script = scriptedClaim([{ ok: false, status: 403, error: RELAY_TIER_REQUIRED }])
    const half = createRelaySecondaryHalf({
      identity: identity(),
      controlUrl: CONTROL_URL,
      publicSuffix: SUFFIX,
      grant: () => undefined,
      port: () => 3080,
      claim: script.claim,
      timerFn: scriptedTimer().timerFn,
      refreshTimer: scriptedRefresh().refreshTimer,
    })
    half.claim()
    await settle()
    // When its connector reports a refusal
    half.connectorFailed('refused with 403')
    await settle()
    // Then nothing else is claimed: the half already knows it holds nothing, and its
    // own wait decides when to try again
    expect(script.requests).toHaveLength(1)
  })
})

describe('the market edge beside the second meeting point', () => {
  it('operator holds the market lease and no refresh of its own is ever armed', async () => {
    // Given the first half's own pair, over the same identity
    const script = scriptedClaim([{ ok: true, claim: marketLease() }])
    const timer = scriptedTimer()
    const pair = new RelayConnectorPair(identity(), { claim: script.claim, timerFn: timer.timerFn })
    // When it claims its lease
    await pair.start({ port: 3080 })
    // Then not a single timer was armed: the default host's own behaviour is that a
    // claim happens on lifecycle events only, and this change adds no loop to it
    expect(timer.scheduled).toEqual([])
    expect(pair.state).toEqual({ state: 'claimed', mode: 'quick', hostname: ID + '.dsh-market.com' })
  })
})

describe('the meeting point one configuration names', () => {
  it('operator configures both halves and the host has a second meeting point with a dotted suffix', () => {
    // Given a profile naming both fields, the suffix written without its dot
    // When the meeting point is resolved
    // Then it exists, the suffix is completed, and the origin is the identity plus it
    const meeting = relaySecondaryOf({
      relaySecondaryControlUrl: CONTROL_URL,
      relaySecondaryPublicSuffix: 'relay.chatwithai.icu',
    })
    expect(meeting).toEqual({ controlUrl: CONTROL_URL, publicSuffix: SUFFIX })
    expect(relaySecondaryOriginOf(identity(), SUFFIX)).toBe(ORIGIN)
  })

  it('operator configures nothing, or only half of it, and the host has one meeting point', () => {
    // Given the three configurations that are not a second meeting point
    // When each is resolved
    // Then none of them is one: an origin cannot be built from a base alone, and a
    // base cannot be reached from a suffix alone
    expect(relaySecondaryOf({})).toBeUndefined()
    expect(relaySecondaryOf({ relaySecondaryControlUrl: CONTROL_URL })).toBeUndefined()
    expect(relaySecondaryOf({ relaySecondaryPublicSuffix: SUFFIX })).toBeUndefined()
    expect(relaySecondaryOf({ relaySecondaryControlUrl: '  ', relaySecondaryPublicSuffix: SUFFIX })).toBeUndefined()
  })

  it('operator reads the second connector state where it cannot overwrite the first one', () => {
    // Given the first connector's own record path under the same home
    // When the second connector's path is resolved
    // Then the two differ, so one meeting point's state cannot erase the other's
    expect(relaySecondaryBridgeStateFile('/tmp/dsh')).toBe('/tmp/dsh/remote-web-ui-relay-bridge-secondary.json')
    expect(relaySecondaryBridgeStateFile('/tmp/dsh')).not.toBe('/tmp/dsh/remote-web-ui-relay-bridge.json')
  })
})
