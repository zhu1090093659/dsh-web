/**
 * The lease half of the relay: one claim per tunnel start, a named connector
 * established beside the quick one, and a retry that never takes the quick
 * origin down. The control plane decides which connector is served; this half
 * only keeps both sides up.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RelayConnectorPair,
  namedTunnelChildRecordFile,
  readPluginVersion,
  relayClaimKeyOf,
  type RelayBridgeStart,
  type RelayPairState,
} from '../src/host/relay-connector.ts'
import type { RelayClaim, RelayClaimOutcome, RelayClaimRequest } from '../src/host/relay-control.ts'
import type { RelayIdentity } from '../src/host/relay-registry.ts'

const ID = 'abcd1234abcd1234'
const HOSTNAME = ID + '.dsh-market.com'

function identity(fresh = false): RelayIdentity {
  return { id: ID, secret: 'A'.repeat(43), ...(fresh ? { fresh: true } : {}) }
}

function lease(mode: 'named' | 'quick'): RelayClaim {
  return {
    mode,
    tunnel: { id: 'tunnel-uuid-1', token: 'per-instance-tunnel-token' },
    hostname: HOSTNAME,
    dns: { target: 'tunnel-uuid-1.cfargotunnel.com' },
  }
}

/** A bridged lease: the hostname and the grant, with no tunnel half at all. */
function bridgedLease(): RelayClaim {
  return {
    mode: 'bridge',
    hostname: HOSTNAME,
    bridge: { endpoint: 'wss://dsh-market.com/api/relay/bridge', instance: ID, credential: 'lease-secret' },
  }
}

/** A claim seam that answers the scripted outcomes in order and records requests. */
function scriptedClaim(outcomes: RelayClaimOutcome[]) {
  const requests: RelayClaimRequest[] = []
  const claim = async (request: RelayClaimRequest): Promise<RelayClaimOutcome> => {
    requests.push(request)
    return outcomes[Math.min(requests.length - 1, outcomes.length - 1)]
  }
  return { requests, claim }
}

/** A retry seam that captures the scheduled delay and lets the test fire it. */
function scriptedTimer() {
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  const timerFn = (fn: () => void, ms: number) => {
    scheduled.push({ fn, ms })
    return { unref() {} }
  }
  return { scheduled, timerFn }
}

/** The connector seams one pair drives. */
function connectorSeams() {
  const started: Array<{ token: string; hostname: string }> = []
  let stopped = 0
  return {
    started,
    get stopped() { return stopped },
    seams: {
      startNamed: (token: string, hostname: string) => { started.push({ token, hostname }) },
      stopNamed: () => { stopped += 1 },
    },
  }
}

describe('claiming a lease beside the quick connector', () => {
  it('operator keeps the quick connector serving while the named one idles', async () => {
    // Given a control plane that still answers the quick mode
    // When the plugin claims on tunnel start
    // Then the named connector comes up on the same hostname for the same
    // tunnel, but the quick connector stays the one the phone is served from
    const script = scriptedClaim([{ ok: true, claim: lease('quick') }])
    const connector = connectorSeams()
    const states: RelayPairState[] = []
    const pair = new RelayConnectorPair(identity(), {
      claim: script.claim,
      ...connector.seams,
      onState: (state) => { states.push(state) },
    })
    const claim = await pair.start({ port: 3080, pluginVersion: '0.4.8' })
    expect(claim).toEqual(lease('quick'))
    expect(pair.served).toBe('quick')
    expect(connector.started).toEqual([{ token: 'per-instance-tunnel-token', hostname: HOSTNAME }])
    expect(states).toEqual([
      { state: 'claiming' },
      { state: 'claimed', mode: 'quick', hostname: HOSTNAME },
    ])
    expect(script.requests[0]).toEqual({
      id: ID,
      secret: 'A'.repeat(43),
      newSecret: undefined,
      port: 3080,
      pluginVersion: '0.4.8',
    })
  })

  it('operator sees the control plane mode pick the served connector', async () => {
    // Given a control plane that has flipped the instance to the named mode
    // When the claim lands
    // Then the named connector is the one the phone is meant to be served from
    const script = scriptedClaim([{ ok: true, claim: lease('named') }])
    const pair = new RelayConnectorPair(identity(), { claim: script.claim, ...connectorSeams().seams })
    await pair.start({ port: 3080 })
    expect(pair.served).toBe('named')
    expect(pair.lease?.dns?.target).toBe('tunnel-uuid-1.cfargotunnel.com')
  })

  it('operator keeps the quick origin when the claim is refused and retries after the hint', async () => {
    // Given the control plane lost its upstream Cloudflare API
    // When the plugin claims
    // Then no named connector starts, the failure is reported, and the retry
    // waits at least as long as the retryAfterMs hint
    const script = scriptedClaim([
      { ok: false, status: 502, error: 'cf-api-unavailable', retryAfterMs: 30_000 },
      { ok: true, claim: lease('quick') },
    ])
    const connector = connectorSeams()
    const timer = scriptedTimer()
    const pair = new RelayConnectorPair(identity(true), { claim: script.claim, ...connector.seams, timerFn: timer.timerFn })
    const failed = await pair.start({ port: 3080 })
    expect(failed).toBeUndefined()
    expect(pair.state).toEqual({ state: 'failed', error: 'cf-api-unavailable' })
    expect(pair.served).toBeUndefined()
    expect(connector.started).toEqual([])
    expect(timer.scheduled[0].ms).toBe(30_000)
    expect(script.requests[0].newSecret).toBe('A'.repeat(43))

    // When the retry fires, it claims again and lands the lease
    const retry = timer.scheduled.shift()
    retry?.fn()
    await Promise.resolve()
    await Promise.resolve()
    expect(script.requests).toHaveLength(2)
    expect(connector.started).toEqual([{ token: 'per-instance-tunnel-token', hostname: HOSTNAME }])
  })

  it('operator stops retrying when the id belongs to another secret', async () => {
    // Given the control plane answers auth-failed for this id
    // When the plugin grades the refusal
    // Then nothing is scheduled: the id is owned elsewhere and no retry helps
    const script = scriptedClaim([{ ok: false, status: 403, error: 'auth-failed' }])
    const timer = scriptedTimer()
    const pair = new RelayConnectorPair(identity(), { claim: script.claim, timerFn: timer.timerFn })
    await pair.start({ port: 3080 })
    expect(pair.state).toEqual({ state: 'failed', error: 'auth-failed' })
    expect(timer.scheduled).toEqual([])
  })

  it('operator gets a bridged lease with no tunnel and starts no second connector', async () => {
    // Given a control plane that serves this instance over the bridge, whose
    // claim carries the hostname and the grant and no tunnel at all
    // When the plugin claims on tunnel start
    // Then the bridge connector starts, the named one does not, and the
    // accepted lease still lands with the mode the phone is served from
    const script = scriptedClaim([{ ok: true, claim: bridgedLease() }])
    const connector = connectorSeams()
    const bridged: RelayBridgeStart[] = []
    const pair = new RelayConnectorPair(identity(), {
      claim: script.claim,
      ...connector.seams,
      startBridge: (start) => { bridged.push(start) },
    })
    const claim = await pair.start({ port: 3080 })
    expect(claim).toEqual(bridgedLease())
    expect(pair.served).toBe('bridge')
    expect(connector.started).toEqual([])
    expect(pair.lease?.tunnel).toBeUndefined()
    expect(bridged[0].claim.hostname).toBe(HOSTNAME)
    expect(bridged[0].port).toBe(3080)
  })

  it('operator re-claims the id when the control plane lost the row', async () => {
    // Given a persisted identity whose lease row is gone, which the endpoint
    // reports as invalid-params because the claim carried no new_secret
    // When the retry fires
    // Then the claim re-claims the id with new_secret equal to the secret
    const script = scriptedClaim([
      { ok: false, status: 400, error: 'invalid-params' },
      { ok: true, claim: lease('quick') },
    ])
    const timer = scriptedTimer()
    const pair = new RelayConnectorPair(identity(), { claim: script.claim, timerFn: timer.timerFn })
    await pair.start({ port: 3080 })
    expect(script.requests[0].newSecret).toBeUndefined()
    const retry = timer.scheduled.shift()
    retry?.fn()
    await Promise.resolve()
    await Promise.resolve()
    expect(script.requests[1].newSecret).toBe('A'.repeat(43))
    expect(pair.state).toEqual({ state: 'claimed', mode: 'quick', hostname: HOSTNAME })
  })
})

describe('releasing and disposing the lease half', () => {
  it('operator releases the lease and stops the idle connector on toggle-off', async () => {
    // Given a running pair whose relay toggle is turned off
    // When the plugin releases
    // Then the identity is released exactly once and the idle connector stops,
    // while the quick connector is untouched
    const script = scriptedClaim([{ ok: true, claim: lease('quick') }])
    const released: RelayIdentity[] = []
    const connector = connectorSeams()
    const pair = new RelayConnectorPair(identity(), {
      claim: script.claim,
      ...connector.seams,
      release: async (who) => { released.push(who) },
    })
    await pair.start({ port: 3080 })
    await pair.release()
    expect(released.map((who) => who.id)).toEqual([ID])
    expect(connector.stopped).toBe(1)
  })

  it('operator stops the connector when the relay half is disposed', async () => {
    // Given a claimed pair
    // When the relay half is disposed (a plan change or plugin teardown)
    // Then the named connector stops and a pending claim cannot resurrect it
    const script = scriptedClaim([{ ok: true, claim: lease('named') }])
    const connector = connectorSeams()
    const pair = new RelayConnectorPair(identity(), { claim: script.claim, ...connector.seams })
    await pair.start({ port: 3080 })
    pair.dispose()
    expect(connector.stopped).toBe(1)
    expect(pair.state).toEqual({ state: 'idle' })
    expect(await pair.start({ port: 3080 })).toBeUndefined()
    expect(script.requests).toHaveLength(1)
  })
})

describe('the named connector side facts', () => {
  it('operator sees the named connector own its own crash-recovery slot', () => {
    // Given the quick connector records its child under the DSH home
    // When the named connector records its own
    // Then the two slots differ, so neither start reaps its sibling's child
    expect(namedTunnelChildRecordFile('/tmp/dsh')).toBe(join('/tmp/dsh', 'remote-web-ui-tunnel-child-named.json'))
  })

  it('operator sees a settings sync and a tunnel restart claim differently', () => {
    // Given a running quick tunnel at one origin port
    // When the plugin re-applies its tunnel plan without a restart, and then
    // after a restart mints a new quick hostname
    // Then the unchanged sync reuses the key (no second claim) while the
    // restart gets a new one, so the lease is refreshed on every real start
    expect(relayClaimKeyOf(3080, 'https://one.trycloudflare.com')).toBe(relayClaimKeyOf(3080, 'https://one.trycloudflare.com'))
    expect(relayClaimKeyOf(3080, 'https://two.trycloudflare.com')).not.toBe(relayClaimKeyOf(3080, 'https://one.trycloudflare.com'))
    expect(relayClaimKeyOf(3081, undefined)).not.toBe(relayClaimKeyOf(3080, undefined))
    expect(relayClaimKeyOf(undefined, undefined)).toBeUndefined()
  })

  it('operator reports the plugin version a claim carries', () => {
    // Given the published plugin manifest
    // When the claim reports its version
    // Then it is the package version the migration can measure adoption by
    expect(readPluginVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
