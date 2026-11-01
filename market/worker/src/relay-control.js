/**
 * dsh-market relay control plane: named-tunnel leases beside the quick-tunnel
 * registry (`relay.js`). Additive on purpose — the wildcard Worker route, the
 * proxy path and the registration endpoints keep working untouched, so every
 * instance that has not migrated still rides its quick tunnel.
 *
 * The tunnel transports (quick, named) converge three Cloudflare objects for
 * one instance: a remote-managed tunnel named `dsh-relay-<id>`, that tunnel's
 * ingress (the instance hostname plus the catch-all rule remote-managed tunnels
 * require), and an exact proxied CNAME `<id>.dsh-market.com ->
 * <tunnel-id>.cfargotunnel.com`. The lease row in D1 points at them so
 * release/retire/GC can settle them later. The bridge transport owns none of
 * them: its data plane is the instance's Durable Object, so a bridged claim
 * sends no account call at all and keeps only the hostname.
 *
 * Trust model: a lease is secret-authenticated exactly like a registration
 * (SHA-256 hash, constant-time compare, `new_secret` on the first claim) and
 * rate-limited on the same buckets. The account-wide Cloudflare API token
 * never leaves the Worker; the per-instance tunnel token is returned once to
 * the caller that proved possession of the id secret and is never logged.
 *
 * Account budget: Cloudflare counts the whole account's calls over one 300
 * second window, so once an answer is 429 every further call is refused until
 * that window turns over. Retries cannot tell the difference and would keep the
 * window full by themselves, so this isolate remembers the spent budget
 * (`CF_API_COOLDOWN_MS`) and stops dialling until the cooldown passes.
 */

import {
  ID_RE,
  REGISTER_MAX_PER_ID,
  REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_MS,
  SECRET_RE,
  json,
  retryAfterMsOf,
  sha256Hex,
  timingSafeEqualStr,
} from './relay.js'

/** Tunnel names live in the relay's own account namespace (`dsh-relay-*`). */
const TUNNEL_NAME_PREFIX = 'dsh-relay-'
/** The relay hostnames this worker also serves as its public apex zone. */
const RELAY_ZONE_SUFFIX = '.dsh-market.com'
/** The CNAME target shape a named tunnel resolves through. */
const TUNNEL_TARGET_SUFFIX = '.cfargotunnel.com'
/** Remote-managed tunnels require a rule that matches everything else. */
const CATCH_ALL_SERVICE = 'http_status:404'
/** Rows not seen for this long are recovered by the cron GC (as the registry). */
export const LEASE_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How soon a caller should retry a claim that lost its upstream. */
export const CF_RETRY_AFTER_MS = 5_000
/**
 * How soon a caller should retry once the account request budget is spent.
 * Cloudflare counts that budget over a 300 second window, so a hint shorter
 * than the window only brings the caller back into the same spent budget.
 */
export const CF_RATE_LIMIT_RETRY_AFTER_MS = 300_000
/** The status the account API answers with when that budget is spent (10500). */
const CF_TOO_MANY_REQUESTS = 429
/**
 * How long this isolate stops dialling the account API after it answered 429.
 * Long enough to keep the retry traffic from re-spending the window by itself,
 * short enough that a recovered account is not left waiting: it is one fifth of
 * the window, and the caller-facing hint stays the whole window
 * (CF_RATE_LIMIT_RETRY_AFTER_MS), which the caller cannot avoid anyway.
 */
export const CF_API_COOLDOWN_MS = 60_000
/**
 * The most lease rows one cron tick settles. A row costs up to three account
 * calls (find the record, delete it, delete the tunnel), so an unbounded loop
 * is what turns one spent budget into a tick that keeps spending it.
 */
export const LEASE_PRUNE_MAX_PER_TICK = 25
/**
 * How long a converged lease answers a claim without dialling Cloudflare.
 * A claim arrives on a tunnel start, not on a heartbeat, so ten minutes covers
 * the interval between two restarts and still re-converges the row daily.
 */
export const LEASE_CONVERGED_TTL_MS = 10 * 60 * 1000
/**
 * How long the connector token cached on the lease row is handed back before it
 * is read from the account again. The token changes only when a tunnel is
 * rotated, which is an operator action, so the window trades one call per lease
 * per day for a token that is at most a day behind a rotation; a client whose
 * cached token stopped working re-claims and gets the fresh one.
 */
export const LEASE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
/**
 * The account request budget this Worker allows itself per Cloudflare window.
 * Cloudflare counts 1200 calls per 300 seconds for the whole account and blocks
 * every call for the rest of the window once that is spent, so the gate stops at
 * half: a claim storm cannot reach the real ceiling, and the other half stays
 * available to the CLI, the dashboard and anything else on the account.
 */
export const CF_API_BUDGET_MAX = 600
/**
 * The window Cloudflare counts that budget over. Named rather than reusing the
 * rate-limit window: the two are separate budgets, and this one is the account's
 * published number (ratelimit-policy q=1200;w=300).
 */
export const CF_API_BUDGET_WINDOW_MS = 300 * 1000
/** The D1 bucket one window of the account budget is counted in. */
const CF_API_BUDGET_BUCKET = 'cf:api'
/** The Cloudflare API origin (`client/v4`). */
const CF_API_BASE = 'https://api.cloudflare.com/client/v4'
/** Where a bridge connector dials. The market apex, like the claim endpoint
 * itself: a relay hostname would route the upgrade through the data plane it
 * is trying to replace. */
export const RELAY_BRIDGE_ENDPOINT = 'wss://dsh-market.com/api/relay/bridge'
/**
 * What one bridge upgrade presents as its credential: the lease's own id and
 * secret. That pair is the only long-lived credential an instance holds, it is
 * stored here as a hash and compared in constant time, and the claim reply
 * names it instead of echoing it -- a second copy of a secret in a response
 * body is a leak surface with nothing to show for it.
 */
export const RELAY_BRIDGE_CREDENTIAL = 'lease-secret'

/** The tunnel name one instance owns. */
export function relayTunnelName(id) {
  return TUNNEL_NAME_PREFIX + id
}

/** The relay hostname one instance owns (the phone's bookmark). */
export function relayHostname(id) {
  return id + RELAY_ZONE_SUFFIX
}

/** The proxied CNAME target that routes one hostname into its tunnel. */
export function relayDnsTarget(tunnelId) {
  return tunnelId + TUNNEL_TARGET_SUFFIX
}

/**
 * The ingress a lease's tunnel must carry: the instance hostname toward the
 * local origin port the claim named, then the catch-all rule. The service is
 * loopback because the connector runs on the user's machine.
 */
export function leaseIngress(id, port) {
  return [
    { hostname: relayHostname(id), service: 'http://127.0.0.1:' + String(port) },
    { service: CATCH_ALL_SERVICE },
  ]
}

/**
 * Which connector serves the relay hostname: the deployment-wide default is
 * `bridge`, whose data plane is the instance's own Durable Object and which
 * therefore owns no object in the Cloudflare account at all -- a bridged claim
 * costs zero account calls, while the tunnel transports converge a tunnel, an
 * ingress and a CNAME.
 *
 * The per-instance column overrides it in both directions and is both the
 * migration switch and the rollback: a row that explicitly records `quick` or
 * `named` keeps riding its tunnel (every row written before this default
 * changed records one), and a row that records `bridge` hands the hostname to
 * the object. An operator flips one instance with a single UPDATE.
 *
 * `RELAY_MODE` is the deployment-wide override and it wins over the column in
 * both directions -- the value an operator sets there is the whole deployment's
 * answer, and an instance that must differ is the exception, not the rule. Set it
 * to `quick` to roll the fleet back to the tunnel transports, or to `named` to
 * select the named-tunnel transport; leaving it unset is the bridge default.
 * @param env - the Worker environment.
 * @param lease - this id's lease row, when it has one.
 */
export function relayModeOf(env, lease) {
  const recorded = lease !== undefined && lease !== null ? lease.mode : undefined
  if (recorded === 'quick' || recorded === 'named') return recorded
  if (env.RELAY_MODE === 'named') return 'named'
  if (env.RELAY_MODE === 'quick') return 'quick'
  return 'bridge'
}

/** One JSON body, or undefined for a body that is not a JSON object. */
async function readJsonBody(request) {
  try {
    const body = await request.json()
    return typeof body === 'object' && body !== null ? body : undefined
  } catch {
    return undefined
  }
}

/** The local origin port one claim names, or undefined when it is unusable. */
function originPortOf(origin) {
  if (typeof origin !== 'object' || origin === null) return undefined
  const port = origin.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return port
}

/**
 * One Cloudflare API failure, carrying the upstream HTTP status. Callers grade
 * the answer by that code: a spent account budget (429) is the whole account's
 * condition, while a resource that refuses to go is one row's own, and the
 * message text is Cloudflare's to rewrite.
 */
export class CfApiError extends Error {
  /**
   * @param status - the HTTP status the account API answered with.
   * @param message - the method, path and Cloudflare's own message.
   */
  constructor(status, message) {
    super(message)
    this.name = 'CfApiError'
    this.status = status
  }
}

/** Whether one failure is the spent account request budget, not an outage. */
export function isCfRateLimited(error) {
  return typeof error === 'object' && error !== null && error.status === CF_TOO_MANY_REQUESTS
}

/** One failure's log text: the message alone, which never carries a token. */
function errorTextOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The moment the account API may be dialled again, in epoch milliseconds, or 0
 * while the gate is open. Isolate-local on purpose: two isolates may each probe
 * once per cooldown, which costs one refused request per isolate and needs no
 * shared table, no migration and no agreement between colos to be correct.
 */
let cfApiCoolingUntil = 0

/** Whether this isolate refuses account calls right now. */
function cfApiCooling() {
  return Date.now() < cfApiCoolingUntil
}

/** Close the gate for one cooldown after the account API answered 429. */
function armCfApiCooldown() {
  cfApiCoolingUntil = Date.now() + CF_API_COOLDOWN_MS
}

/**
 * Open the gate and forget the last 429. Module state is shared by every caller
 * in one isolate, so the offline tests reset it between cases instead of
 * letting one case's 429 decide another case's upstream calls.
 */
export function resetCfApiCooldown() {
  cfApiCoolingUntil = 0
}

/**
 * Spend one unit of the account budget and report the window's total.
 *
 * Cloudflare counts 1200 calls per 300 seconds for the whole account and this
 * Worker is one of several callers on it, so the count is kept in D1 -- the only
 * state every isolate shares. The statement increments and reads the new total
 * in one write, which D1 serializes: concurrent callers queue behind each other,
 * so no two claims can both read a pre-increment count and pass on the same unit.
 * The unit is spent BEFORE the fetch, never after it: a call that fails or is
 * killed still spent account quota, and over-counting is the safe direction --
 * under-counting is what lets a storm through.
 * @returns the post-increment total, or undefined when D1 could not count it.
 */
async function spendCfApiBudget(env) {
  const windowStart = Math.floor(Date.now() / CF_API_BUDGET_WINDOW_MS) * CF_API_BUDGET_WINDOW_MS
  const result = await env.DB.prepare(
    'INSERT INTO relay_rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) '
    + 'ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
  ).bind(CF_API_BUDGET_BUCKET, windowStart).first()
  return Number(result && result.count)
}

/**
 * One Cloudflare API call against the scoped account token. Errors carry the
 * method, path and Cloudflare's own message so the logs explain a 502 — the
 * bearer token and the per-instance tunnel token never appear in either.
 */
async function cfCall(config, method, path, body) {
  // The gate stands in front of the request, not behind it: while the budget is
  // spent the account refuses every call anyway, so sending one only spends the
  // retry traffic that keeps the window full. The local 429 is graded by the
  // same code that grades Cloudflare's own, which is why every caller keeps its
  // answer and its hint.
  if (cfApiCooling()) {
    throw new CfApiError(CF_TOO_MANY_REQUESTS, 'cloudflare api ' + method + ' ' + path + ': cooling down after a 429, request not sent')
  }
  // The proactive half of the gate, and the one that holds across isolates: this
  // Worker stops at half of the account's window, so no storm of claims can reach
  // the ceiling that blocks the whole account for the rest of the window.
  if (config.env !== undefined) {
    let spent
    try {
      spent = await spendCfApiBudget(config.env)
    } catch {
      // Failing open on a D1 blip: the gate is a guard, and the reactive cooldown
      // below still catches the 429 that a blip would let through.
      spent = undefined
    }
    if (spent !== undefined && spent > CF_API_BUDGET_MAX) {
      armCfApiCooldown()
      throw new CfApiError(CF_TOO_MANY_REQUESTS, 'cloudflare api ' + method + ' ' + path + ': this worker has spent its ' + String(CF_API_BUDGET_MAX) + ' call budget for the account window, request not sent')
    }
  }
  const response = await fetch(CF_API_BASE + path, {
    method,
    headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  // One 429 is the whole account's condition, so it is recorded before this
  // call is graded: claim, retire and the cron GC share this client and all of
  // them stop dialling for one cooldown, whatever path the refused call was on.
  if (response.status === CF_TOO_MANY_REQUESTS) armCfApiCooldown()
  const payload = await response.json().catch(() => undefined)
  if (!response.ok || payload === undefined || payload.success === false) {
    const first = payload && Array.isArray(payload.errors) ? payload.errors[0] : undefined
    const detail = first && typeof first.message === 'string' ? first.message : 'HTTP ' + String(response.status)
    throw new CfApiError(response.status, 'cloudflare api ' + method + ' ' + path + ': ' + detail)
  }
  return payload.result
}

/**
 * The Cloudflare client one lease runs on. Every method returns the normalized
 * value the lease path needs, so an injected double in tests only has to answer
 * these names.
 * @param config - the scoped token, its account and zone ids, and the Worker
 * environment whose D1 carries the shared account budget.
 */
export function createCloudflareRelayApi(config) {
  const account = '/accounts/' + config.accountId
  const zone = '/zones/' + config.zoneId
  return {
    /** Find the tunnel that already carries this exact name, if any. */
    async findTunnel(name) {
      const result = await cfCall(config, 'GET', account + '/cfd_tunnel?name=' + encodeURIComponent(name) + '&is_deleted=false')
      const tunnels = Array.isArray(result) ? result : []
      return tunnels.find((tunnel) => tunnel && tunnel.name === name && !tunnel.deleted_at)
    },
    /** Create one remote-managed (dashboard-configured) tunnel. */
    async createTunnel(name) {
      return await cfCall(config, 'POST', account + '/cfd_tunnel', { name, config_src: 'cloudflare' })
    },
    /** Write the tunnel's ingress (the instance hostname plus catch-all). */
    async putTunnelConfiguration(tunnelId, ingress) {
      return await cfCall(config, 'PUT', account + '/cfd_tunnel/' + tunnelId + '/configurations', { config: { ingress } })
    },
    /** Read the connector token of one tunnel. */
    async getTunnelToken(tunnelId) {
      const result = await cfCall(config, 'GET', account + '/cfd_tunnel/' + tunnelId + '/token')
      return typeof result === 'string' ? result : result && result.token
    },
    /** Find the CNAME already standing on this exact name, if any. */
    async findDnsRecord(name) {
      const result = await cfCall(config, 'GET', zone + '/dns_records?type=CNAME&name=' + encodeURIComponent(name))
      const records = Array.isArray(result) ? result : []
      return records.find((record) => record && record.name === name)
    },
    /** Create one proxied CNAME toward the tunnel. */
    async createDnsRecord(record) {
      return await cfCall(config, 'POST', zone + '/dns_records', record)
    },
    /** Replace one CNAME whose target drifted (a re-created tunnel). */
    async updateDnsRecord(recordId, record) {
      return await cfCall(config, 'PUT', zone + '/dns_records/' + recordId, record)
    },
    /** Remove one record. */
    async deleteDnsRecord(recordId) {
      return await cfCall(config, 'DELETE', zone + '/dns_records/' + recordId)
    },
    /** Remove one tunnel. */
    async deleteTunnel(tunnelId) {
      return await cfCall(config, 'DELETE', account + '/cfd_tunnel/' + tunnelId)
    },
  }
}

/**
 * The client for one environment: an injected double wins (that is how the
 * offline tests exercise every path), otherwise the Worker secrets must all be
 * present — an unconfigured Worker answers 503 instead of inventing resources.
 */
export function relayApiOf(env) {
  if (env.CF_RELAY_API !== undefined) return env.CF_RELAY_API
  const token = env.CF_API_TOKEN
  const accountId = env.CF_ACCOUNT_ID
  const zoneId = env.CF_ZONE_ID
  if (typeof token !== 'string' || token === '') return undefined
  if (typeof accountId !== 'string' || accountId === '') return undefined
  if (typeof zoneId !== 'string' || zoneId === '') return undefined
  return createCloudflareRelayApi({ token, accountId, zoneId, env })
}

/** The lease row of one id, or undefined. */
async function leaseOf(env, id) {
  return await env.DB.prepare(
    'SELECT secret_hash, tunnel_id, hostname, state, mode, origin_port, converged_at, token_cache, token_at FROM relay_leases WHERE id = ?1'
  ).bind(id).first()
}

/** One rate-limit window of the current minute for a bucket. */
function windowOf(bucket) {
  return { bucket, windowStart: Math.floor(Date.now() / REGISTER_WINDOW_MS) * REGISTER_WINDOW_MS }
}

/** Spend one unit of a window inside the caller's batch. */
function spendStatement(env, window) {
  return env.DB.prepare(
    'INSERT INTO relay_rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
  ).bind(window.bucket, window.windowStart)
}

/** Read a window's budget before spending a Cloudflare round trip on it. */
async function spentOf(env, windows) {
  const results = await env.DB.batch(windows.map((window) =>
    env.DB.prepare('SELECT count FROM relay_rate_limit WHERE bucket = ?1 AND window_start = ?2').bind(window.bucket, window.windowStart)))
  return windows.map((_, index) => {
    const rows = results[index] && results[index].results
    return Number(rows && rows[0] && rows[0].count) || 0
  })
}

/**
 * Converge the three pieces one lease names, keyed by name rather than by the
 * row: a claim that died halfway writes nothing to D1, so the next attempt
 * must find the pieces it already created instead of duplicating them.
 * @param cachedToken - a connector token the row still carries, reused instead
 * of reading the account again: the TTL above re-converges the tunnel long
 * before a token rotates, and a token this caller already holds is not worth a
 * fifth call on the re-converging path.
 * @returns the tunnel id, hostname, CNAME target, connector token and the moment
 * that token was read (absent when the caller's own cached token was reused).
 */
async function convergeLease(api, id, port, cachedToken) {
  const name = relayTunnelName(id)
  let tunnel = await api.findTunnel(name)
  if (tunnel === undefined) tunnel = await api.createTunnel(name)
  const tunnelId = tunnel.id
  await api.putTunnelConfiguration(tunnelId, leaseIngress(id, port))
  const hostname = relayHostname(id)
  const target = relayDnsTarget(tunnelId)
  const record = await api.findDnsRecord(hostname)
  if (record === undefined) {
    await api.createDnsRecord({ type: 'CNAME', name: hostname, content: target, proxied: true })
  } else if (record.content !== target || record.proxied !== true) {
    await api.updateDnsRecord(record.id, { type: 'CNAME', name: hostname, content: target, proxied: true })
  }
  if (cachedToken !== undefined) return { tunnelId, hostname, target, token: cachedToken.token, tokenAt: cachedToken.tokenAt }
  const token = await api.getTunnelToken(tunnelId)
  if (typeof token !== 'string' || token === '') throw new Error('the tunnel token endpoint returned no token')
  // tokenAt is this read's moment: the row stores it so the next claim inside
  // LEASE_TOKEN_TTL_MS can hand the same token back without a call.
  return { tunnelId, hostname, target, token, tokenAt: Date.now() }
}

/** One stored epoch-millisecond column, or 0 for a row that predates it. */
function epochOf(value) {
  const epoch = typeof value === 'string' ? Number(value) : value
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : 0
}

/**
 * The three account pieces a claim answers with, rebuilt from the lease row.
 * The target is derived from the tunnel id rather than stored: it is a pure
 * function of it, and a stored copy could drift from the record it describes.
 */
function cachedLease(row) {
  return {
    tunnelId: row.tunnel_id,
    hostname: row.hostname,
    target: relayDnsTarget(row.tunnel_id),
    token: row.token_cache,
    // The token's own clock, carried so the row upsert can leave it alone: a
    // cached token must not be renewed by the claims that hand it back.
    tokenAt: row.token_at,
  }
}

/**
 * Whether the lease row still describes the account for this claim, so nothing
 * has to be written to Cloudflare. Every condition is a way the cached answer
 * could be wrong rather than a convenience:
 * - state 'active': a released lease is not being served, and this claim is the
 *   caller asking for it back;
 * - a tunnel id: a row without one owns no account object to describe;
 * - the hostname this id derives: a row pointing at somebody else's hostname
 *   must be re-converged, not answered;
 * - the same origin port: a different port is a different ingress, so the
 *   tunnel configuration has to be rewritten;
 * - a convergence inside LEASE_CONVERGED_TTL_MS: the account may have moved
 *   underneath a stale row (a tunnel deleted by hand, a record repointed), and
 *   the TTL bounds how long the row is trusted over the account.
 * @param row - the lease row of this id.
 * @param port - the origin port this claim named.
 */
function isCachedConvergence(row, port) {
  if (row === undefined || row === null) return false
  if (row.state !== 'active') return false
  if (typeof row.tunnel_id !== 'string' || row.tunnel_id === '') return false
  if (row.hostname !== relayHostname(row.id)) return false
  if (Number(row.origin_port) !== port) return false
  const convergedAt = epochOf(row.converged_at)
  return convergedAt > 0 && Date.now() - convergedAt <= LEASE_CONVERGED_TTL_MS
}

/**
 * Whether the connector token cached on the row is still handed back, or the
 * account has to be read for a fresh one. A rotated token is only discovered by
 * using it, so the cache runs on its own, longer clock: one call per lease per
 * day instead of one per claim.
 * @param row - the lease row of this id.
 */
function isCachedToken(row) {
  if (row === undefined || row === null) return false
  if (typeof row.token_cache !== 'string' || row.token_cache === '') return false
  const tokenAt = epochOf(row.token_at)
  return tokenAt > 0 && Date.now() - tokenAt <= LEASE_TOKEN_TTL_MS
}

/**
 * The lease of a bridged instance: the hostname it keeps and nothing in the
 * account. A bridge's data plane is its Durable Object, so this claim sends no
 * Cloudflare call at all -- not even a token fetch -- and the row's tunnel id
 * stays empty, which is exactly what the cron GC reads as "owns no account
 * resource" when it reclaims the row later.
 * @returns the same fields the tunnel transports answer with, each one explicit:
 * no tunnel id, no CNAME target, no token. The row upsert binds every one of
 * them, and D1 rejects an undefined binding outright, so a field this path does
 * not produce is named here as null rather than left out.
 */
function bridgedLease(id) {
  return { tunnelId: '', hostname: relayHostname(id), target: null, token: null, tokenAt: null }
}

/**
 * Remove one lease's public source in the order the design fixes: the DNS
 * record first, then the tunnel, so there is never a window in which the
 * hostname still resolves and points at a tunnel that is already gone.
 */
async function removeLeaseSource(api, id, tunnelId) {
  const record = await api.findDnsRecord(relayHostname(id))
  if (record !== undefined) await api.deleteDnsRecord(record.id)
  if (typeof tunnelId === 'string' && tunnelId !== '') await api.deleteTunnel(tunnelId)
}

/** Spend windows without a follow-up write (a claim that lost its upstream). */
async function spendWindows(env, windows) {
  try {
    await env.DB.batch(windows.map((window) => spendStatement(env, window)))
  } catch { /* best-effort: the limit is a guard, not a ledger */ }
}

/** The 502 every upstream failure of the lease path answers with. */
function cfUnavailable(detail) {
  if (detail !== undefined) console.warn('relay control: ' + detail)
  return json({ ok: false, error: 'cf-api-unavailable', retryAfterMs: CF_RETRY_AFTER_MS }, 502)
}

/**
 * The 502 one failed account half answers with. A spent account budget gets its
 * own error code and its own, longer hint: the caller must not come back while
 * the window is still spent, which the outage hint would have it do.
 */
function cfFailure(error, detail) {
  if (!isCfRateLimited(error)) return cfUnavailable(detail)
  console.warn('relay control: ' + detail + ' (account request budget spent)')
  return json({ ok: false, error: 'cf-api-rate-limited', retryAfterMs: CF_RATE_LIMIT_RETRY_AFTER_MS }, 502)
}

/**
 * Claim one lease: for the tunnel transports, find-or-create the tunnel,
 * converge its ingress and its CNAME and read the connector token; for the
 * bridge transport, converge nothing in the account. Either way the row is
 * upserted afterwards, so a failed claim leaves no half-written lease behind
 * and the next attempt converges by name.
 *
 * A row that converged inside LEASE_CONVERGED_TTL_MS on the same origin port,
 * with its connector token cached inside LEASE_TOKEN_TTL_MS, is answered from
 * the row: zero account calls. That is the steady state -- the account is only
 * dialled when something actually moved (a first claim, a port change, a lease
 * older than the TTL, a rotated token, or a mode flip).
 */
export async function handleRelayClaim(request, env) {
  if (request.method !== 'PUT') return json({ ok: false, error: 'method-not-allowed' }, 405)
  const body = await readJsonBody(request)
  if (body === undefined) return json({ ok: false, error: 'invalid-json' }, 400)
  const id = typeof body.id === 'string' ? body.id : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  const port = originPortOf(body.origin)
  if (!ID_RE.test(id) || !SECRET_RE.test(secret) || port === undefined) return json({ ok: false, error: 'invalid-params' }, 400)
  // Fail closed before anything is created or written: an unconfigured Worker
  // must neither touch the account nor leave a lease row behind.
  const api = relayApiOf(env)
  if (api === undefined) return json({ ok: false, error: 'cf-api-unconfigured' }, 503)

  const secretHash = await sha256Hex(secret)
  let existing
  try {
    existing = await leaseOf(env, id)
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  if (existing) {
    if (!timingSafeEqualStr(existing.secret_hash, secretHash)) return json({ ok: false, error: 'auth-failed' }, 403)
  } else {
    // First claim: the caller must present the same secret twice, exactly as
    // the registry endpoint requires, so an id cannot be squatted by a guess.
    if (body.register === false) return json({ ok: false, error: 'unknown-id' }, 404)
    if (!SECRET_RE.test(body.new_secret || '') || body.new_secret !== secret) {
      return json({ ok: false, error: 'invalid-params' }, 400)
    }
  }

  // The registry and the lease share both windows: alternating between the two
  // endpoints must not buy a second budget.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const perIp = windowOf('ip:' + ip)
  const perId = windowOf('id:' + id)
  let spent
  try {
    spent = await spentOf(env, [perIp, perId])
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  if (spent[0] >= REGISTER_MAX_PER_IP || spent[1] >= REGISTER_MAX_PER_ID) {
    // The refusal names the window it was counted in, so a client that ignores
    // the status and retries anyway at least knows when the window turns over.
    // retryAfterMs is additive: every field this endpoint answered with before
    // keeps its name and its type.
    return json({ ok: false, error: 'rate-limited', retryAfterMs: retryAfterMsOf(perId.windowStart) }, 429)
  }

  // The row's own mode decides the whole account half of this claim, so it is
  // read before anything is created: a bridged instance owns no Cloudflare
  // object and must not be given one back on every claim.
  const mode = relayModeOf(env, existing)

  const now = Date.now()
  let lease
  try {
    if (mode === 'bridge') {
      lease = bridgedLease(id)
    } else if (isCachedConvergence(existing, port)) {
      // The steady state, and the whole point of the cache: the row already
      // describes the account for this port, so the claim costs no account call
      // at all. Before this path every claim spent four (find tunnel, write
      // ingress, find record, read token) whether or not anything had moved.
      lease = cachedLease(existing)
      if (!isCachedToken(existing)) {
        // The convergence holds but the cached token has aged out of its own
        // window: refresh the one credential, one call, instead of re-writing
        // the tunnel configuration the account already carries.
        const token = await api.getTunnelToken(lease.tunnelId)
        if (typeof token !== 'string' || token === '') throw new Error('the tunnel token endpoint returned no token')
        lease = { ...lease, token, tokenAt: Date.now() }
      }
    } else {
      // A token the row still holds inside its own window is reused here too: the
      // tunnel and the record are rewritten because the convergence aged out, but
      // a token this caller already has is not worth a fifth call.
      lease = await convergeLease(api, id, port, isCachedToken(existing) ? { token: existing.token_cache, tokenAt: existing.token_at } : undefined)
    }
  } catch (error) {
    // The attempt still costs a window: a caller holding a valid secret must
    // not be able to loop upstream failures at the account API for free.
    await spendWindows(env, [perIp, perId])
    return cfFailure(error, 'claim convergence failed for ' + id + ': ' + errorTextOf(error))
  }

  const pluginVersion = typeof body.plugin === 'object' && body.plugin !== null && typeof body.plugin.version === 'string'
    ? body.plugin.version
    : null
  // A bridged claim converges nothing in the account, so it records no
  // convergence: the row's mode is the whole answer, and a later flip back to
  // the tunnel transports must find the row un-converged rather than reuse a
  // cached hostname nobody ever wrote a tunnel for.
  const convergedAt = mode === 'bridge' ? null : now
  // The token's own clock comes from the path that produced it: a converging
  // claim and a token refresh stamp this moment, a claim answered from the
  // cache carries the stamp it read.
  const tokenAt = lease.tokenAt ?? null
  try {
    await env.DB.batch([
      spendStatement(env, perIp),
      spendStatement(env, perId),
      env.DB.prepare(
        // A new row records the mode this claim ran in. The column is named in
        // the INSERT on purpose: relying on its schema default would make a
        // claim depend on the migration having run first. It is absent from the
        // DO UPDATE half, so an existing row keeps whatever an operator recorded
        // (the flip and its rollback), and a claim can never undo it.
        'INSERT INTO relay_leases (id, secret_hash, tunnel_id, hostname, origin_port, plugin_version, state, created_at, last_seen_at, converged_at, token_cache, token_at, mode) '
        + 'VALUES (?1, ?2, ?3, ?4, ?5, ?6, \'active\', ?7, ?7, ?8, ?9, ?10, ?11) '
        + 'ON CONFLICT(id) DO UPDATE SET secret_hash = excluded.secret_hash, tunnel_id = excluded.tunnel_id, hostname = excluded.hostname, '
        + 'origin_port = excluded.origin_port, plugin_version = excluded.plugin_version, state = \'active\', last_seen_at = excluded.last_seen_at, '
        + 'converged_at = excluded.converged_at, token_cache = excluded.token_cache, token_at = excluded.token_at'
      ).bind(id, secretHash, lease.tunnelId, lease.hostname, port, pluginVersion, now, convergedAt, lease.token, tokenAt, mode),
    ])
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  // A bridged claim carries neither half of the tunnel contract: the caller
  // reads the hostname and the bridge grant and must tolerate their absence,
  // which is what keeps it from starting a connector with nothing to run.
  const tunnelHalf = mode === 'bridge' ? {} : { tunnel: { id: lease.tunnelId, token: lease.token } }
  const dnsHalf = mode === 'bridge' ? {} : { dns: { target: lease.target } }
  return json({
    // The row's own mode, so a flip reaches the plugin on its next claim
    // without a redeploy; the upsert above never writes the column, so a claim
    // cannot undo an operator's flip.
    mode,
    ...tunnelHalf,
    hostname: lease.hostname,
    ...dnsHalf,
    // Everything a bridge connector needs to dial and authenticate; nothing
    // secret travels here (see RELAY_BRIDGE_CREDENTIAL).
    bridge: {
      endpoint: RELAY_BRIDGE_ENDPOINT,
      instance: id,
      credential: RELAY_BRIDGE_CREDENTIAL,
    },
  })
}

/** Authenticate one id/secret pair against its lease row. */
async function authenticatedLease(env, id, secret) {
  let lease
  try {
    lease = await leaseOf(env, id)
  } catch {
    return { status: 503, body: { ok: false, error: 'storage-unavailable' } }
  }
  // An unknown id answers like a wrong secret: the endpoint is not an
  // existence oracle for other instances' hostnames.
  if (!lease || !timingSafeEqualStr(lease.secret_hash, await sha256Hex(secret))) {
    return { status: 403, body: { ok: false, error: 'auth-failed' } }
  }
  return { status: 200, lease }
}

/**
 * Release one lease: mark the row released and touch nothing in the account.
 * The tunnel and the CNAME stay, so re-enabling an instance is a claim that
 * creates nothing and only reads one token (a bridged lease reads nothing).
 */
export async function handleRelayRelease(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405)
  const body = await readJsonBody(request)
  if (body === undefined) return json({ ok: false, error: 'invalid-json' }, 400)
  const id = typeof body.id === 'string' ? body.id : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return json({ ok: false, error: 'invalid-params' }, 400)
  const auth = await authenticatedLease(env, id, secret)
  if (auth.status !== 200) return json(auth.body, auth.status)
  try {
    await env.DB.prepare('UPDATE relay_leases SET state = \'released\', released_at = ?2 WHERE id = ?1').bind(id, Date.now()).run()
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  return json({ ok: true })
}

/**
 * Retire one lease: the only path that removes a relay source. The record goes
 * first, then the tunnel, then the row — a retry converges because removing an
 * already-absent record or tunnel is not an error.
 */
export async function handleRelayRetire(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405)
  const body = await readJsonBody(request)
  if (body === undefined) return json({ ok: false, error: 'invalid-json' }, 400)
  const id = typeof body.id === 'string' ? body.id : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return json({ ok: false, error: 'invalid-params' }, 400)
  const auth = await authenticatedLease(env, id, secret)
  if (auth.status !== 200) return json(auth.body, auth.status)
  const api = relayApiOf(env)
  if (api === undefined) return json({ ok: false, error: 'cf-api-unconfigured' }, 503)
  try {
    await removeLeaseSource(api, id, auth.lease.tunnel_id)
  } catch (error) {
    return cfFailure(error, 'retire failed for ' + id + ': ' + errorTextOf(error))
  }
  try {
    await env.DB.prepare('DELETE FROM relay_leases WHERE id = ?1').bind(id).run()
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  return json({ ok: true })
}

/**
 * Cron GC: recover leases not seen for 90 days (the registry's TTL), settling
 * each one in the retire order. One tick settles at most
 * LEASE_PRUNE_MAX_PER_TICK rows, and a spent account budget ends the tick on the
 * spot: the rows left over are stale already and lose nothing by waiting a
 * minute, while every call this tick would send is one the account refuses.
 * A cooled account skips the tick whole — the query included, so not even D1 is
 * asked about rows whose source cannot be removed yet.
 * A row whose tunnel cannot be removed is left alone — dropping it would orphan
 * a tunnel nothing points at any more — and an unconfigured Worker settles only
 * the rows that own no account resource.
 * @returns how many rows were removed, and whether a spent budget ended the tick.
 */
export async function pruneRelayLeases(env) {
  // The gate is the whole tick's answer, and it is the same answer a 429 found
  // mid-tick gives: nothing was pruned, because nothing could be removed.
  if (cfApiCooling()) {
    console.warn('relay control: lease GC skipped, the account request budget is cooling down')
    return { pruned: 0, rateLimited: true }
  }
  let stale
  try {
    stale = await env.DB.prepare('SELECT id, tunnel_id FROM relay_leases WHERE last_seen_at < ?1 LIMIT ?2')
      .bind(Date.now() - LEASE_TTL_MS, LEASE_PRUNE_MAX_PER_TICK).all()
  } catch {
    return { pruned: 0, rateLimited: false }
  }
  const rows = stale && Array.isArray(stale.results) ? stale.results : []
  if (rows.length === 0) return { pruned: 0, rateLimited: false }
  const api = relayApiOf(env)
  let pruned = 0
  let rateLimited = false
  for (const row of rows) {
    const tunnelId = typeof row.tunnel_id === 'string' ? row.tunnel_id : ''
    try {
      if (tunnelId === '') {
        await env.DB.prepare('DELETE FROM relay_leases WHERE id = ?1').bind(row.id).run()
        pruned += 1
        continue
      }
      if (api === undefined) continue
      await removeLeaseSource(api, row.id, tunnelId)
      await env.DB.prepare('DELETE FROM relay_leases WHERE id = ?1').bind(row.id).run()
      pruned += 1
    } catch (error) {
      // A spent budget belongs to the whole account, not to this row: the next
      // call is refused too, so the tick ends here and this row keeps its
      // tunnel id like the rows behind it.
      if (isCfRateLimited(error)) {
        rateLimited = true
        console.warn('relay control: lease GC stopped at ' + row.id + ' with the account request budget spent: ' + errorTextOf(error))
        break
      }
      // Best-effort: any other failure is this row's own, it keeps its tunnel
      // id and the next tick retries it.
    }
  }
  return { pruned, rateLimited }
}
