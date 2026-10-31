/**
 * The relay control-plane client: what one claim request carries, how an
 * accepted lease is read back, and how a refusal is graded into (or out of) a
 * retry. Every case runs against an injected fetch, so the suite is offline.
 */
import { describe, expect, it } from 'vitest'
import {
  CLAIM_RETRY_BASE_MS,
  CLAIM_RETRY_MAX_MS,
  RELAY_CLAIM_URL,
  RELAY_RELEASE_URL,
  claimRelayLease,
  relayClaimBody,
  relayClaimRetryOf,
  releaseRelayLease,
} from '../src/host/relay-control.ts'
import { generateRelayIdentity } from '../src/host/relay-registry.ts'

const LEASE = {
  mode: 'named',
  tunnel: { id: 'b1f0c2d4-0000-4000-8000-000000000001', token: 'per-instance-tunnel-token' },
  hostname: 'abcd1234abcd1234.dsh-market.com',
  dns: { target: 'b1f0c2d4-0000-4000-8000-000000000001.cfargotunnel.com' },
}

/** One captured request plus the response the test decided on. */
function fakeFetch(response: () => Response | Promise<Response>) {
  const seen: Array<{ url: string; init: RequestInit }> = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} })
    return await response()
  }) as unknown as typeof fetch
  return { seen, fetchFn }
}

describe('claiming one relay lease', () => {
  it('operator sends the identity, the origin port and the plugin version', async () => {
    // Given a fresh identity that has never been accepted by the control plane
    // When the plugin claims its lease
    // Then the body names the origin port, reports the version and carries
    // new_secret so the row may be created
    const identity = generateRelayIdentity()
    const { seen, fetchFn } = fakeFetch(() => new Response(JSON.stringify(LEASE), { status: 200 }))
    const outcome = await claimRelayLease(
      { id: identity.id, secret: identity.secret, newSecret: identity.secret, port: 3080, pluginVersion: '0.4.8' },
      { fetchFn },
    )
    expect(outcome.ok).toBe(true)
    expect(seen[0].url).toBe(RELAY_CLAIM_URL)
    expect(seen[0].init.method).toBe('PUT')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      id: identity.id,
      secret: identity.secret,
      new_secret: identity.secret,
      origin: { port: 3080 },
      plugin: { version: '0.4.8' },
    })
  })

  it('operator sees a persisted identity claim without new_secret', () => {
    // Given an identity the control plane already accepted
    // When the plugin re-claims it after a restart
    // Then the body carries no new_secret at all (re-claiming a live row with
    // it is the one thing the endpoint must never see)
    const body = JSON.parse(relayClaimBody({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }))
    expect('new_secret' in body).toBe(false)
    expect('plugin' in body).toBe(false)
    expect(body.origin).toEqual({ port: 3080 })
  })

  it('operator reads an accepted lease into the connector shape', async () => {
    // Given the control plane answers a claim with the documented lease
    // When the client parses it
    // Then the mode, the per-instance token, the hostname and the CNAME target
    // all survive for the connector to use
    const { fetchFn } = fakeFetch(() => new Response(JSON.stringify(LEASE), { status: 200 }))
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome).toEqual({ ok: true, claim: LEASE })
  })

  it('operator treats an acceptance without a token as a protocol error', async () => {
    // Given an accepted response whose tunnel token is missing
    // When the client parses it
    // Then it refuses the lease rather than starting a connector with nothing
    const { fetchFn } = fakeFetch(() => new Response(JSON.stringify({ ...LEASE, tunnel: { id: 'x' } }), { status: 200 }))
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome).toEqual({ ok: false, status: 200, error: 'invalid-response' })
  })

  it('operator reads a bridged lease that carries no tunnel', async () => {
    // Given the control plane serving this instance over the bridge, whose
    // data plane owns no Cloudflare object and therefore no tunnel
    // When the client parses the reply
    // Then the hostname and the bridge grant land and the tunnel half is
    // simply absent instead of a protocol error
    const bridged = {
      mode: 'bridge',
      hostname: LEASE.hostname,
      bridge: { endpoint: 'wss://dsh-market.com/api/relay/bridge', instance: 'abcd1234abcd1234', credential: 'lease-secret' },
    }
    const { fetchFn } = fakeFetch(() => new Response(JSON.stringify(bridged), { status: 200 }))
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome).toEqual({ ok: true, claim: bridged })
  })

  it('operator keeps refusing a tunnel-transport lease without a tunnel', async () => {
    // Given a quick-mode reply, whose transport is the instance's own tunnel
    // When it arrives with no tunnel block at all
    // Then it is still a protocol error: only a bridged lease may omit it
    const { fetchFn } = fakeFetch(() => new Response(
      JSON.stringify({ mode: 'quick', hostname: LEASE.hostname, dns: LEASE.dns }),
      { status: 200 },
    ))
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome).toEqual({ ok: false, status: 200, error: 'invalid-response' })
  })

  it('operator gets the retry hint of an unavailable control plane', async () => {
    // Given the control plane lost its upstream Cloudflare API
    // When the plugin claims
    // Then the 502 code and its retryAfterMs reach the caller unchanged
    const { fetchFn } = fakeFetch(() => new Response(
      JSON.stringify({ ok: false, error: 'cf-api-unavailable', retryAfterMs: 5_000 }),
      { status: 502 },
    ))
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome).toEqual({ ok: false, status: 502, error: 'cf-api-unavailable', retryAfterMs: 5_000 })
  })

  it('operator sees a transport failure graded like an unavailable upstream', async () => {
    // Given a control plane that cannot be reached at all
    // When the plugin claims
    // Then the outcome is a retryable status 0 instead of a thrown error
    const fetchFn = (async () => { throw new Error('connect ECONNREFUSED') }) as unknown as typeof fetch
    const outcome = await claimRelayLease({ id: 'abcd1234abcd1234', secret: 'A'.repeat(43), port: 3080 }, { fetchFn })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false ? outcome.status : -1).toBe(0)
  })
})

describe('grading one refused claim', () => {
  it('operator never retries an id owned by another secret', () => {
    // Given the control plane answers auth-failed
    // When the plugin grades the refusal
    // Then it stops: no backoff can win an id another secret owns
    expect(relayClaimRetryOf({ ok: false, status: 403, error: 'auth-failed' }, 3)).toEqual({
      retry: false,
      delayMs: 0,
      refreshIdentity: false,
    })
  })

  it('operator re-claims the id when the control plane lost the row', () => {
    // Given the row is gone (a D1 restore or a manual wipe), which the endpoint
    // reports as invalid-params because the claim carried no new_secret
    // When the plugin grades the refusal
    // Then the next attempt re-claims the id with new_secret
    expect(relayClaimRetryOf({ ok: false, status: 400, error: 'invalid-params' }, 0)).toEqual({
      retry: true,
      delayMs: CLAIM_RETRY_BASE_MS,
      refreshIdentity: true,
    })
  })

  it('operator honours the control plane retry hint over the backoff', () => {
    // Given a 502 that names a 30 s retry hint and a plugin that already failed
    // When the plugin grades the refusal
    // Then the hint raises the floor above the plain exponential backoff
    const graded = relayClaimRetryOf({ ok: false, status: 502, error: 'cf-api-unavailable', retryAfterMs: 30_000 }, 0)
    expect(graded.retry).toBe(true)
    expect(graded.delayMs).toBe(30_000)
    expect(graded.refreshIdentity).toBe(false)
  })

  it('operator keeps the backoff capped during a long outage', () => {
    // Given a control plane that has been failing for many attempts
    // When the plugin grades the refusal
    // Then neither the backoff nor the hint can exceed the cap
    expect(relayClaimRetryOf({ ok: false, status: 429, error: 'rate-limited' }, 12).delayMs).toBe(CLAIM_RETRY_MAX_MS)
    expect(relayClaimRetryOf({ ok: false, status: 502, error: 'cf-api-unavailable', retryAfterMs: 600_000 }, 0).delayMs)
      .toBe(CLAIM_RETRY_MAX_MS)
  })
})

describe('releasing one relay lease', () => {
  it('operator releases the lease and never names the retire endpoint', async () => {
    // Given a running instance whose relay toggle is turned off
    // When the plugin releases its lease
    // Then it posts the identity to the release endpoint only: the hostname is
    // the phone's bookmark and must survive
    const identity = generateRelayIdentity()
    const { seen, fetchFn } = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await releaseRelayLease(identity, { fetchFn })
    expect(seen[0].url).toBe(RELAY_RELEASE_URL)
    expect(seen[0].init.method).toBe('POST')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ id: identity.id, secret: identity.secret })
  })
})
