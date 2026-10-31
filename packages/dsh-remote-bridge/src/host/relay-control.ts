/**
 * Relay control-plane client: the lease claim that turns one relay identity
 * into a lease row (the tunnel transports get a tunnel, its ingress, a CNAME
 * and the per-instance connector token; the bridge transport gets neither
 * block, because its data plane owns no Cloudflare object) plus the release
 * bookkeeping.
 *
 * Claiming is best-effort and additive. Every failure is graded into a retry
 * decision instead of breaking the quick tunnel that already serves the phone:
 * the control plane answers `mode`, so an instance whose claim cannot land
 * keeps the origin the registry gave it.
 */

import type { RelayIdentity } from './relay-registry.ts'

/** The control-plane endpoints (market apex, never a relay hostname). */
export const RELAY_CLAIM_URL = 'https://dsh-market.com/api/relay/claim'
export const RELAY_RELEASE_URL = 'https://dsh-market.com/api/relay/release'

/** Which connector serves the relay hostname. `bridge` is the Durable Object
 * meeting point (`relay-bridge-connector.ts`), `named` the instance's own cloud
 * tunnel, `quick` today's Worker proxy path. */
export type RelayConnectorMode = 'named' | 'quick' | 'bridge'

/** What a bridge connector needs to dial: an endpoint and a credential to
 * present. The credential is the lease's own long-lived id and secret -- the
 * reply names it rather than repeating a secret in a body. */
export interface RelayBridgeGrant {
  endpoint: string
  instance: string
  credential: 'lease-secret'
}

/** One accepted lease, as the control plane answers it. */
export interface RelayClaim {
  mode: RelayConnectorMode
  /** The instance's own tunnel. Absent for a bridged lease: there is nothing
   * to run and no token to run it with. */
  tunnel?: { id: string; token: string }
  hostname: string
  /** The CNAME target behind the hostname; absent for a bridged lease too. */
  dns?: { target: string }
  /** Present when the control plane can route this instance over the bridge. */
  bridge?: RelayBridgeGrant
}

/** What one claim attempt resolved to. */
export type RelayClaimOutcome =
  | { ok: true; claim: RelayClaim }
  | { ok: false; status: number; error: string; retryAfterMs?: number }

/** One claim request (the lease the caller wants refreshed). */
export interface RelayClaimRequest {
  id: string
  secret: string
  /** Carried only by a fresh identity: the first claim creates the row. */
  newSecret?: string
  /** Local origin port the lease ingress points at (`ctx.webServer.port`). */
  port: number
  /** The plugin version, for the adoption readout of the migration. */
  pluginVersion?: string
}

/** The capped backoff a failed claim retries on. */
export const CLAIM_RETRY_BASE_MS = 5_000
export const CLAIM_RETRY_MAX_MS = 60_000

/** Build the claim body (an absent value is omitted, never sent as null). */
export function relayClaimBody(request: RelayClaimRequest): string {
  return JSON.stringify({
    id: request.id,
    secret: request.secret,
    new_secret: request.newSecret,
    origin: { port: request.port },
    plugin: request.pluginVersion === undefined ? undefined : { version: request.pluginVersion },
  })
}

/** The tunnel of one accepted claim, or undefined when it carries none. */
function relayTunnelOf(value: unknown): { id: string; token: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const tunnel = value as { id?: unknown; token?: unknown }
  if (typeof tunnel.id !== 'string' || tunnel.id === '') return undefined
  if (typeof tunnel.token !== 'string' || tunnel.token === '') return undefined
  return { id: tunnel.id, token: tunnel.token }
}

/** The CNAME target of one accepted claim, or undefined when it carries none. */
function relayDnsTargetOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const target = (value as { target?: unknown }).target
  return typeof target === 'string' && target !== '' ? target : undefined
}

/** One lease read back from an accepted claim, or undefined for a bad shape. */
export function relayClaimOf(value: unknown): RelayClaim | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const body = value as { mode?: unknown; tunnel?: unknown; hostname?: unknown; dns?: unknown; bridge?: unknown }
  const mode = body.mode
  if (mode !== 'named' && mode !== 'quick' && mode !== 'bridge') return undefined
  if (typeof body.hostname !== 'string' || body.hostname === '') return undefined
  const tunnel = relayTunnelOf(body.tunnel)
  const target = relayDnsTargetOf(body.dns)
  // The tunnel transports are served by that tunnel, so a reply without both
  // halves is a protocol error. The bridge is the one transport whose lease
  // owns no Cloudflare object, and its claim carries neither half.
  if (mode !== 'bridge' && (tunnel === undefined || target === undefined)) return undefined
  const bridge = relayBridgeGrantOf(body.bridge)
  return {
    mode,
    ...(tunnel === undefined ? {} : { tunnel }),
    hostname: body.hostname,
    ...(target === undefined ? {} : { dns: { target } }),
    ...(bridge === undefined ? {} : { bridge }),
  }
}

/** The bridge grant of one accepted lease, or undefined when it carries none. */
export function relayBridgeGrantOf(value: unknown): RelayBridgeGrant | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const grant = value as { endpoint?: unknown; instance?: unknown; credential?: unknown }
  if (typeof grant.endpoint !== 'string' || grant.endpoint === '') return undefined
  if (typeof grant.instance !== 'string' || grant.instance === '') return undefined
  if (grant.credential !== 'lease-secret') return undefined
  return { endpoint: grant.endpoint, instance: grant.instance, credential: 'lease-secret' }
}

/** The error code and retry hint of a refused claim. */
function refusalOf(status: number, detail: unknown): Extract<RelayClaimOutcome, { ok: false }> {
  const body = typeof detail === 'object' && detail !== null
    ? detail as { error?: unknown; retryAfterMs?: unknown }
    : {}
  const error = typeof body.error === 'string' ? body.error : 'http-' + String(status)
  const retryAfterMs = typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs)
    ? body.retryAfterMs
    : undefined
  return retryAfterMs === undefined ? { ok: false, status, error } : { ok: false, status, error, retryAfterMs }
}

/**
 * Claim one lease. A transport failure is graded like `502 cf-api-unavailable`
 * (status 0) so the caller retries on the same path as a refused upstream.
 * @param request - the lease to refresh.
 * @param options - endpoint and fetch seams (defaults are the real ones).
 */
export async function claimRelayLease(
  request: RelayClaimRequest,
  options: { url?: string; fetchFn?: typeof fetch } = {},
): Promise<RelayClaimOutcome> {
  const fetchFn = options.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(options.url ?? RELAY_CLAIM_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: relayClaimBody(request),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, status: 0, error: detail === '' ? 'network-error' : detail }
  }
  const detail: unknown = await response.json().catch(() => undefined)
  if (!response.ok) return refusalOf(response.status, detail)
  const claim = relayClaimOf(detail)
  return claim === undefined
    ? { ok: false, status: response.status, error: 'invalid-response' }
    : { ok: true, claim }
}

/**
 * Release one lease (the plugin's offline action: toggle off, profile
 * unmount). Best-effort — a release that never lands only leaves the row
 * marked active, which the 90-day GC recovers.
 */
export async function releaseRelayLease(
  identity: RelayIdentity,
  options: { url?: string; fetchFn?: typeof fetch } = {},
): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch
  await fetchFn(options.url ?? RELAY_RELEASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: identity.id, secret: identity.secret }),
  })
}

/** How one failed claim should be retried. */
export interface RelayClaimRetry {
  /** Whether another attempt is worth making at all. */
  retry: boolean
  /** How long to wait before that attempt. */
  delayMs: number
  /**
   * Whether the identity must be re-claimed with `new_secret`: the control
   * plane lost the row (a D1 restore or a manual wipe), which is the one
   * condition a fresh claim fixes.
   */
  refreshIdentity: boolean
}

/**
 * Grade one failed claim into a retry decision.
 *
 * `403 auth-failed` is terminal: the id belongs to another secret and no
 * number of retries can take it back. Everything else retries on a capped
 * exponential backoff, with the control plane's own `retryAfterMs` (a 502
 * names it) raising the floor so a retry cannot land inside a known outage.
 * @param outcome - the refused attempt.
 * @param attempt - how many attempts already failed (0 for the first).
 * @param options - backoff bounds (defaults are the shipped ones).
 */
export function relayClaimRetryOf(
  outcome: Extract<RelayClaimOutcome, { ok: false }>,
  attempt: number,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
): RelayClaimRetry {
  const base = options.baseDelayMs ?? CLAIM_RETRY_BASE_MS
  const max = options.maxDelayMs ?? CLAIM_RETRY_MAX_MS
  if (outcome.status === 403) return { retry: false, delayMs: 0, refreshIdentity: false }
  const backoff = Math.min(base * 2 ** attempt, max)
  const delayMs = Math.min(Math.max(backoff, outcome.retryAfterMs ?? 0), max)
  const refreshIdentity = outcome.error === 'invalid-params' || outcome.error === 'unknown-id'
  return { retry: true, delayMs, refreshIdentity }
}
