/**
 * Update-only Cloudflare tunnel ingress sync (issue #1948).
 *
 * A named tunnel's public hostname is permanent — that is the whole point of
 * the mode — but the ingress rule behind it names a fixed local port. When
 * `dsh web` listens on another port (an operator changed `--port`, a profile
 * carries a different value, a second instance took the old one), the hostname
 * keeps resolving and answers 502 while this plugin still believes it is
 * published. This module converges exactly that one number and nothing else:
 *
 * - a read (GET) is the only request a healthy start makes;
 * - the plan proves the whole document except the matched rule's `service`
 *   string is unchanged, and refuses (a conflict) anything it cannot prove —
 *   no added or removed rule, no moved ingress entry, no touched top-level
 *   key, no invented catch-all;
 * - the service it retargets has to be this machine's own: loopback, or one of
 *   this host's LAN addresses. Another host's address is a conflict, never a
 *   write, because the port there belongs to whatever that address serves;
 * - only a proven drift is written, as one full-document PUT (the API offers
 *   no patch for a single rule);
 * - the write is read back once. A disagreement is a conflict, never an
 *   automatic rewrite: one tunnel document has one writer, and a deployment
 *   whose dashboard or another sync owns it has to be reconciled by a human.
 *
 * Everything is offline-testable: the HTTP call and the timers are injected
 * seams, and the default seam itself refuses to send the account token to any
 * origin but `https://api.cloudflare.com`. The token never enters a log line,
 * a status frame, a child process argument, or any browser-visible state — it
 * exists only inside the `Authorization` header of the two requests that need
 * it.
 */

import { createHash } from 'node:crypto'
import { lanIPv4Addresses } from './lan.ts'

/** The only origin the Cloudflare API token is ever sent to. */
export const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'

/** One JSON object as the API document holds it. */
export type JsonObject = Record<string, unknown>

/** Whether a value is a JSON object (not an array, not null). */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The configurations endpoint of one tunnel. The account and tunnel ids are
 * opaque path segments, so they are encoded rather than interpolated raw.
 * @param accountId - the Cloudflare account id.
 * @param tunnelId - the named tunnel id (never the tunnel's token).
 * @returns the absolute API URL the sync reads and writes.
 */
export function ingressConfigUrl(accountId: string, tunnelId: string): string {
  return `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`
}

/**
 * The lower-cased hostname a configured public base names. Wildcards are not
 * supported by this sync (the target rule must match one exact hostname), so a
 * wildcard base is refused here rather than matched loosely later.
 * @param publicBaseUrl - the configured public base URL.
 * @returns the hostname to match in the ingress, or undefined when the value
 *   is missing, unparsable, not http(s), or a wildcard.
 */
export function hostnameOf(publicBaseUrl: string | undefined): string | undefined {
  if (publicBaseUrl === undefined || publicBaseUrl.trim() === '') return undefined
  try {
    const url = new URL(publicBaseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const hostname = url.hostname.toLowerCase()
    if (hostname === '' || hostname.includes('*')) return undefined
    return hostname
  } catch {
    return undefined
  }
}

/**
 * Retarget one tunnel service string at a port, changing nothing else. The
 * authority's host (including an IPv6 literal and any userinfo), the path, the
 * query, and the fragment are preserved byte for byte, so the plan can prove
 * the only difference in the document is the port digits.
 * @param service - the rule's current service string (e.g. `http://127.0.0.1:3080`).
 * @param port - the port this host's web server actually bound.
 * @returns the retargeted service, or undefined when the value is not an
 *   http(s) origin this sync can safely rewrite.
 */
export function serviceWithPort(service: string, port: number): string | undefined {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  const match = /^(https?:\/\/)([^/?#]*)([\s\S]*)$/.exec(service)
  if (match === null) return undefined
  const scheme = match[1] as string
  const authority = match[2] as string
  const rest = match[3] as string
  const at = authority.lastIndexOf('@')
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : ''
  const hostPart = authority.slice(at + 1)
  let host: string
  if (hostPart.startsWith('[')) {
    const end = hostPart.indexOf(']')
    if (end < 0) return undefined
    host = hostPart.slice(0, end + 1)
    const after = hostPart.slice(end + 1)
    if (after !== '' && !/^:\d*$/.test(after)) return undefined
  } else {
    const colon = hostPart.lastIndexOf(':')
    const after = colon >= 0 ? hostPart.slice(colon) : ''
    if (after !== '' && !/^:\d*$/.test(after)) return undefined
    host = colon >= 0 ? hostPart.slice(0, colon) : hostPart
  }
  if (host === '' || host === '[]') return undefined
  return `${scheme}${userinfo}${host}:${String(port)}${rest}`
}

/**
 * The authority host of one service string, with IPv6 brackets kept. The port
 * and any userinfo are dropped, so the host can be judged on its own.
 * @param service - the rule's service string.
 * @returns the host, or undefined when the value is not an http(s) origin.
 */
export function serviceHostOf(service: string): string | undefined {
  const match = /^(https?:\/\/)([^/?#]*)([\s\S]*)$/.exec(service)
  if (match === null) return undefined
  const authority = match[2] as string
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1)
  if (hostPart.startsWith('[')) {
    const end = hostPart.indexOf(']')
    return end < 0 ? undefined : hostPart.slice(0, end + 1)
  }
  const colon = hostPart.lastIndexOf(':')
  const host = colon >= 0 ? hostPart.slice(0, colon) : hostPart
  return host === '' ? undefined : host
}

/**
 * One service string with its userinfo removed, for everything that leaves
 * this process. A tunnel service may carry `user:password@`, and the
 * update-only write has to preserve that byte for byte — but an audit frame, a
 * log line, or the settings card has no business showing a credential the
 * operator put there for the origin.
 * @param service - the rule's service string.
 * @returns the same service with any `userinfo@` dropped.
 */
export function redactServiceUserinfo(service: string): string {
  const match = /^(https?:\/\/)([^/?#]*)([\s\S]*)$/.exec(service)
  if (match === null) return service
  const scheme = match[1] as string
  const authority = match[2] as string
  const rest = match[3] as string
  const at = authority.lastIndexOf('@')
  return at < 0 ? service : `${scheme}${authority.slice(at + 1)}${rest}`
}

/** Whether one dotted-quad segment is a decimal octet (0-255), not a sign or a space. */
function isIpv4Octet(segment: string): boolean {
  return /^\d{1,3}$/.test(segment) && Number(segment) <= 255
}

/**
 * Whether one service authority host is a target this host may own: a loopback
 * literal (any 127.0.0.0/8 address, `::1`, or `localhost`) or one of this
 * machine's own LAN IPv4 addresses. A service pointing anywhere else — another
 * machine, a DNS name, a NAS — is not this plugin's to retarget, and rewriting
 * its port would break whatever service that address actually is.
 * @param host - the authority host of the service (brackets kept for IPv6).
 * @param lanHosts - this machine's LAN IPv4 addresses.
 * @returns whether the service may be retargeted.
 */
export function isRetargetableHost(host: string, lanHosts: readonly string[] = []): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const name = bare.toLowerCase()
  if (name === '') return false
  if (name === 'localhost' || name === '::1') return true
  // 127.0.0.0/8 is the whole loopback block, not just 127.0.0.1 — but each
  // dotted segment still has to be a real octet, or `127.999.999.999` would
  // read as loopback and this sync would retarget a service nobody owns.
  const octets = name.split('.')
  if (octets.length === 4 && octets[0] === '127' && octets.every(isIpv4Octet)) return true
  return lanHosts.some(candidate => candidate.toLowerCase() === name)
}

/** The marker a stripped service string is replaced with, for the proof below. */
const STRIPPED_SERVICE = '\u0000remote-web-ui:ingress-service\u0000'

/**
 * One document with the target rule's `service` string replaced by a marker.
 * Two documents whose stripped forms are identical differ at that one key and
 * nowhere else — which is the invariant the plan must prove before it writes.
 * @param document - the tunnel configuration document.
 * @param ruleIndex - the ingress rule the sync owns.
 * @returns the canonical JSON of the stripped document.
 */
export function withoutTargetService(document: unknown, ruleIndex: number): string {
  const copy = structuredClone(document) as JsonObject
  const ingress = copy.ingress
  if (Array.isArray(ingress)) {
    const rule = ingress[ruleIndex]
    if (isJsonObject(rule)) rule.service = STRIPPED_SERVICE
  }
  return JSON.stringify(copy)
}

/** Why a plan refuses to write. Every code is a zero-write verdict. */
export type IngressConflictCode =
  | 'hostname'
  | 'config-shape'
  | 'ingress-shape'
  | 'rule-shape'
  | 'wildcard'
  | 'missing'
  | 'duplicate'
  | 'no-catch-all'
  | 'service-shape'
  | 'service-host'

/** What one document read asks the plan to converge on. */
export interface IngressTarget {
  /** The lower-cased public hostname of the named tunnel. */
  hostname: string
  /** The port this host's web server actually bound. */
  port: number
  /**
   * The LAN IPv4 addresses this machine owns (`lanIPv4Addresses()`). The plan
   * refuses a service that points anywhere but loopback or one of these, so an
   * update-only write can never retarget a service that belongs to another host.
   */
  allowedHosts?: readonly string[]
}

/** The verdict of one plan: read-only, one write, or a refusal. */
export type IngressPlan =
  | {
    outcome: 'unchanged'
    hostname: string
    ruleIndex: number
    ruleCount: number
    service: string
  }
  | {
    outcome: 'apply'
    hostname: string
    ruleIndex: number
    ruleCount: number
    from: string
    to: string
    /** The full document to PUT: identical to the read document except one service. */
    document: JsonObject
  }
  | {
    outcome: 'conflict'
    code: IngressConflictCode
    hostname: string
    detail: string
  }

/**
 * Plan one update-only ingress change against a document read from the API.
 *
 * The supported shape is a Cloudflare tunnel configuration: an object whose
 * `ingress` is an array of rule objects, exactly one of which carries the
 * target hostname, and whose last rule is a catch-all (no `hostname`). A
 * document outside that shape — a missing `ingress`, a wildcard anywhere, a
 * duplicated hostname, no catch-all, a rule that is not an object, a service
 * that is not an http(s) origin, or a service whose host is not this machine —
 * is a conflict and produces no document, so the caller cannot accidentally
 * write. The two service strings the verdict reports are redacted of userinfo:
 * they are audit facts, and the write itself is carried by the document.
 * @param config - the `result.config` document read from the API.
 * @param target - the hostname, the port, and this machine's own addresses.
 * @returns unchanged (one read is enough), apply (the document to PUT), or a
 *   conflict with the reason.
 */
export function planIngressUpdate(config: unknown, target: IngressTarget): IngressPlan {
  const conflict = (code: IngressConflictCode, detail: string): IngressPlan => ({ outcome: 'conflict', code, hostname: target.hostname, detail })
  if (!isJsonObject(config)) return conflict('config-shape', 'the tunnel configuration is not an object')
  const ingress = config.ingress
  if (!Array.isArray(ingress)) return conflict('config-shape', 'the tunnel configuration carries no ingress array')
  if (ingress.length === 0) return conflict('no-catch-all', 'the ingress list is empty, so it has no catch-all rule')
  let matches = 0
  let matchIndex: number | undefined
  for (let index = 0; index < ingress.length; index += 1) {
    const rule = ingress[index]
    if (!isJsonObject(rule)) return conflict('rule-shape', `ingress rule ${String(index)} is not an object`)
    const hostname = rule.hostname
    if (hostname === undefined) continue
    if (typeof hostname !== 'string') return conflict('rule-shape', `ingress rule ${String(index)} carries a hostname that is not a string`)
    if (hostname.includes('*')) {
      return conflict('wildcard', `ingress rule ${String(index)} uses the wildcard hostname ${JSON.stringify(hostname)}, which this sync never matches`)
    }
    if (hostname.toLowerCase() === target.hostname) {
      matches += 1
      matchIndex = index
    }
  }
  const last = ingress[ingress.length - 1]
  if (!isJsonObject(last) || typeof last.hostname === 'string') {
    return conflict('no-catch-all', 'the last ingress rule carries a hostname, so the list has no catch-all')
  }
  if (matches === 0) return conflict('missing', `no ingress rule names ${target.hostname}`)
  if (matches > 1 || matchIndex === undefined) {
    return conflict('duplicate', `${String(matches)} ingress rules name ${target.hostname}, so this sync cannot tell which one it owns`)
  }
  const rule = ingress[matchIndex]
  if (!isJsonObject(rule)) return conflict('rule-shape', `ingress rule ${String(matchIndex)} is not an object`)
  const service = rule.service
  if (typeof service !== 'string' || service === '') {
    return conflict('service-shape', `ingress rule ${String(matchIndex)} carries no service string`)
  }
  const serviceHost = serviceHostOf(service)
  if (serviceHost === undefined) {
    return conflict('service-shape', `ingress rule ${String(matchIndex)} service ${JSON.stringify(redactServiceUserinfo(service))} is not an http(s) origin this sync can retarget`)
  }
  // Update-only has to mean "this host's own service": retargeting the port of
  // another machine's address, or of a DNS name that resolves elsewhere, would
  // silently break a service this plugin does not own.
  if (!isRetargetableHost(serviceHost, target.allowedHosts ?? [])) {
    return conflict('service-host', `ingress rule ${String(matchIndex)} points at ${JSON.stringify(serviceHost)}, which is neither loopback nor one of this machine's LAN addresses`)
  }
  const next = serviceWithPort(service, target.port)
  if (next === undefined) {
    return conflict('service-shape', `ingress rule ${String(matchIndex)} service ${JSON.stringify(redactServiceUserinfo(service))} is not an http(s) origin this sync can retarget`)
  }
  if (next === service) {
    return { outcome: 'unchanged', hostname: target.hostname, ruleIndex: matchIndex, ruleCount: ingress.length, service: redactServiceUserinfo(service) }
  }
  const document = structuredClone(config) as JsonObject
  const rules = document.ingress as unknown[]
  const cloned = rules[matchIndex]
  if (!isJsonObject(cloned)) return conflict('rule-shape', `ingress rule ${String(matchIndex)} is not an object`)
  cloned.service = next
  if (withoutTargetService(config, matchIndex) !== withoutTargetService(document, matchIndex)) {
    return conflict('config-shape', 'the rewrite would touch a part of the document outside the target rule service')
  }
  return {
    outcome: 'apply',
    hostname: target.hostname,
    ruleIndex: matchIndex,
    ruleCount: ingress.length,
    // Audit labels only: the document above carries the userinfo untouched, so
    // the write is byte-identical to the read apart from the port.
    from: redactServiceUserinfo(service),
    to: redactServiceUserinfo(next),
    document,
  }
}

/**
 * Read the tunnel configuration out of one API envelope. The API answers
 * `{ success, result: { config: {...} }, errors }`; a body that shapes
 * differently is reported, never guessed at.
 * @param body - the parsed response body.
 * @returns the config document, or undefined when the envelope carries none.
 */
export function configOfEnvelope(body: unknown): JsonObject | undefined {
  if (!isJsonObject(body)) return undefined
  const result = body.result
  if (!isJsonObject(result)) return undefined
  const config = result.config
  return isJsonObject(config) ? config : undefined
}

/**
 * The API's own error messages from one envelope, joined for the audit frame.
 * Cloudflare answers 4xx/5xx with a populated `errors` array; the messages are
 * safe to show (they name the credential's missing permission, never its value).
 * @param body - the parsed response body.
 * @returns a short joined summary, or undefined when the envelope carries none.
 */
export function errorsOfEnvelope(body: unknown): string | undefined {
  if (!isJsonObject(body)) return undefined
  const errors = body.errors
  if (!Array.isArray(errors)) return undefined
  const messages: string[] = []
  for (const entry of errors) {
    if (!isJsonObject(entry)) continue
    const message = entry.message
    if (typeof message === 'string' && message !== '') messages.push(message)
  }
  return messages.length === 0 ? undefined : messages.join(' ')
}

/** One HTTP call the sync makes. */
export interface IngressHttpRequest {
  method: 'GET' | 'PUT'
  url: string
  headers: Record<string, string>
  body?: string
}

/** One HTTP answer the sync reads. */
export interface IngressHttpResponse {
  status: number
  /** The parsed JSON body (or the raw text when it was not JSON). */
  body: unknown
}

/** The injected HTTP seam: tests never reach a real API through it. */
export type IngressFetch = (request: IngressHttpRequest) => Promise<IngressHttpResponse>

/**
 * The default seam: one `fetch` round trip, and a hard refusal to send the
 * account token outside the Cloudflare API even if a caller builds such a URL.
 * @param request - the call to make.
 * @returns the status and parsed body.
 */
export const defaultIngressFetch: IngressFetch = async (request) => {
  if (!request.url.startsWith(`${CLOUDFLARE_API_ORIGIN}/`)) {
    throw new Error('remote-web-ui: refusing to send the Cloudflare API token outside api.cloudflare.com')
  }
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body !== undefined ? { body: request.body } : {}),
  })
  const text = await response.text()
  let body: unknown
  if (text === '') {
    body = undefined
  } else {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

/** Timer seam (injected in tests; a synchronous double makes a run immediate). */
export interface IngressTimer {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** The observable state one sync reports. */
export type IngressSyncState = 'off' | 'waiting' | 'applied' | 'failed' | 'conflict'

/**
 * One audit frame. It carries the public hostname, the local port, the two
 * service strings, the rule position, and a failure reason — never the token,
 * never the credential's account id, and never a response body.
 */
export interface IngressSyncFrame {
  state: IngressSyncState
  /** The public hostname read from `publicBaseUrl`. */
  hostname?: string
  /** The port this host's web server actually bound. */
  port?: number
  /** The service string the remote rule holds after the last run. */
  service?: string
  /** The service string an apply moved away from. */
  previousService?: string
  /** How many ingress rules the read document carried. */
  ruleCount?: number
  /** Index of the rule this sync owns. */
  ruleIndex?: number
  /** Whether the last run actually wrote the document. */
  changed?: boolean
  /** Machine-readable reason of a failed or conflict frame. */
  code?: string
  /** Human-readable detail (hostname, port, status, API message) — no secret. */
  detail?: string
  /** When this state was reached (ms epoch). */
  at: number
}

/** What one {@link IngressSync.schedule} call asks the runner to converge on. */
export interface IngressSyncInput {
  /** The master switch AND the ingress toggle; false makes no request at all. */
  enabled: boolean
  /** The lower-cased public hostname (`hostnameOf(publicBaseUrl)`). */
  hostname: string | undefined
  /** The bound web server port; undefined before the listener binds. */
  port: number | undefined
  /** Account-level API token (secret; only ever in the Authorization header). */
  token: string | undefined
  /** Cloudflare account id. */
  accountId: string | undefined
  /** Named tunnel id. */
  tunnelId: string | undefined
}

/** Injectable seams and timings. */
export interface IngressSyncOptions {
  /** HTTP seam; defaults to the guarded real `fetch`. */
  fetch?: IngressFetch
  /** Clock (injected in tests). */
  now?: () => number
  /** Short debounce before a scheduled run starts (ms). */
  debounceMs?: number
  /** First backoff step of a transient failure (ms; doubles per retry). */
  retryBaseMs?: number
  /** Retries after the first attempt; bounded for the whole run. */
  maxRetries?: number
  /** Timer seam (injected in tests). */
  timer?: IngressTimer
  /**
   * This machine's LAN IPv4 addresses (injected in tests; the live list by
   * default). The plan refuses to retarget a service hosted anywhere else.
   */
  lanHosts?: () => readonly string[]
  /** Frame sink (the host writes it into the pairing snapshot). */
  onFrame?: (frame: IngressSyncFrame) => void
}

/** Debounce before a scheduled run: a port settle and a settings save coalesce. */
export const DEFAULT_INGRESS_DEBOUNCE_MS = 300
/** First backoff step of a retried request. */
export const DEFAULT_INGRESS_RETRY_BASE_MS = 500
/** Retries after the first attempt of one request (so three attempts at most). */
export const DEFAULT_INGRESS_MAX_RETRIES = 2

/** Node timers. */
const nodeTimer: IngressTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => { clearTimeout(handle as Parameters<typeof clearTimeout>[0]) },
}

/** Cap one audit detail so a chatty API message cannot bloat a status frame. */
function tidy(text: string): string {
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`
}

/** The API's own messages as a parenthetical, when the envelope carries any. */
function errorsText(body: unknown): string {
  const errors = errorsOfEnvelope(body)
  return errors === undefined ? '' : ` (${tidy(errors)})`
}

/**
 * Two audit frames that describe the same state (the timestamp is not part of
 * it). The pairing snapshot dedupe uses this, so a re-read that proves the same
 * convergence never emits a second event.
 * @param a - one frame.
 * @param b - the other frame.
 * @returns whether both describe the same state.
 */
export function sameIngressFrame(a: IngressSyncFrame, b: IngressSyncFrame): boolean {
  return a.state === b.state && a.hostname === b.hostname && a.port === b.port
    && a.service === b.service && a.previousService === b.previousService
    && a.ruleCount === b.ruleCount && a.ruleIndex === b.ruleIndex
    && a.changed === b.changed && a.code === b.code && a.detail === b.detail
}

/**
 * A non-reversible label for the account token, so the settle identity changes
 * when the credential does without the token itself ever entering a key, a
 * frame, or a log line. Truncated: 64 bits is far more than a local dedupe
 * needs and a full digest would be a needless copy of the credential's shape.
 * @param token - the account-level API token.
 * @returns a truncated SHA-256 hex digest.
 */
function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * The identity a converged read is recorded under: the target, the tunnel, and
 * a digest of the credential. A same-port save with a different token is a
 * different identity and is read again; the same one is not read again.
 * @param hostname - the matched public hostname.
 * @param port - the bound port.
 * @param accountId - the Cloudflare account id.
 * @param tunnelId - the named tunnel id.
 * @param token - the account-level API token (digested, never stored).
 * @returns the settle key.
 */
function settleKeyOf(hostname: string, port: number, accountId: string, tunnelId: string, token: string): string {
  return `${hostname}|${String(port)}|${accountId}|${tunnelId}|${tokenDigest(token)}`
}

/** Which required settings are still missing (an explicit failure, not a retry). */
function missingConfig(input: IngressSyncInput): string[] {
  const missing: string[] = []
  if (input.token === undefined || input.token === '') missing.push('cfApiToken')
  if (input.accountId === undefined || input.accountId === '') missing.push('cfAccountId')
  if (input.tunnelId === undefined || input.tunnelId === '') missing.push('cfTunnelId')
  return missing
}

/** The resolved plugin settings this adapter reads (nothing else is consulted). */
export interface IngressSettingsSlice {
  /** The plugin master switch. */
  enabled: boolean
  /** The ingress-sync switch. */
  ingressSync?: boolean
  /** Whether the quick tunnel runs (it owns the public base and mints its own hostname). */
  autoTunnel?: boolean
  /** The fixed public hostname of the named tunnel. */
  publicBaseUrl?: string
  /** Account-level API token (a settings secret). */
  cfApiToken?: string
  /** Cloudflare account id. */
  cfAccountId?: string
  /** Named tunnel id. */
  cfTunnelId?: string
}

/** One configured string, or undefined when it is missing or blank. */
function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Normalize one web server port into a target or into nothing. A recompose pass
 * can hand the plugin a half-read webServer whose port is `NaN` or
 * `Infinity`; that is not a port, and treating it as one would either mint a
 * `127.0.0.1:NaN` target or leave the caller waiting forever. The host reads
 * the port through this, so a non-finite value takes exactly the path an
 * unbound one does: the existing port-settle retry re-plans it.
 * @param port - the live `ctx.webServer.port`.
 * @returns the port, or undefined when it is not a finite number.
 */
export function livePortOf(port: number | undefined): number | undefined {
  return typeof port === 'number' && Number.isFinite(port) ? port : undefined
}

/**
 * The one place resolved settings become a sync input, so "which switch turns
 * this on" is testable without a cordis context. Three conditions, all
 * required: the master switch, the ingress toggle, and the quick tunnel being
 * off — a quick tunnel mints a new hostname per start and owns the public base,
 * so that deployment has no named tunnel to update and the sync reads as off
 * instead of editing an unrelated tunnel.
 * @param value - the resolved settings.
 * @param port - the bound web server port, undefined before the listener binds.
 * @returns the input to schedule.
 */
export function ingressInputOf(value: IngressSettingsSlice, port: number | undefined): IngressSyncInput {
  return {
    enabled: value.enabled && value.ingressSync === true && value.autoTunnel !== true,
    hostname: hostnameOf(value.publicBaseUrl),
    // A compose pass can hand a half-read webServer through: NaN or Infinity is
    // not a target, it is a wait for the port-settle re-plan that delivers it.
    port: livePortOf(port),
    token: blankToUndefined(value.cfApiToken),
    accountId: blankToUndefined(value.cfAccountId),
    tunnelId: blankToUndefined(value.cfTunnelId),
  }
}

/** The first run's terminal reason for one request, when it is not retryable. */
type RequestFailure = { ok: false; code: string; detail: string }

/**
 * Converge one named tunnel's ingress service onto this host's actual port.
 *
 * Scheduling is single-flight and generation-guarded: a later schedule (a
 * settings save, a port settle) supersedes an in-flight run at its next
 * checkpoint — before every request attempt, so a running backoff cannot
 * outlive its target, and again immediately before the single PUT. Ports
 * arrive late, and a half-read webServer can hand a non-finite number: neither
 * one schedules anything, so no request is made and the caller's existing
 * port-settle re-plan delivers the real port.
 */
export class IngressSync {
  private readonly http: IngressFetch
  private readonly now: () => number
  private readonly debounceMs: number
  private readonly retryBaseMs: number
  private readonly maxRetries: number
  private readonly timer: IngressTimer
  private readonly onFrame: (frame: IngressSyncFrame) => void
  private readonly lanHosts: () => readonly string[]

  private current: IngressSyncFrame
  private input: IngressSyncInput | undefined
  private generation = 0
  private pending = false
  private debounce: unknown
  /** The serialized run chain: one run at a time, queued schedules after it. */
  private chain: Promise<void> = Promise.resolve()
  /** Whether the chain currently holds a live run (a later schedule only queues). */
  private running = false
  /** Whether the sink has been told about a state yet (the first one always goes out). */
  private emitted = false
  /** The `hostname|port|account|tunnel|token-digest` a read last proved converged. */
  private settledKey: string | undefined
  /** Backoff waits in flight, so a dispose can cut them short. */
  private readonly waits = new Set<{ handle: unknown; resolve: () => void }>()
  private disposed = false

  /**
   * @param options - seams, timings, and the frame sink.
   */
  constructor(options: IngressSyncOptions = {}) {
    this.http = options.fetch ?? defaultIngressFetch
    this.now = options.now ?? (() => Date.now())
    this.debounceMs = options.debounceMs ?? DEFAULT_INGRESS_DEBOUNCE_MS
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_INGRESS_RETRY_BASE_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_INGRESS_MAX_RETRIES
    this.timer = options.timer ?? nodeTimer
    this.onFrame = options.onFrame ?? (() => undefined)
    this.lanHosts = options.lanHosts ?? lanIPv4Addresses
    this.current = { state: 'off', at: this.now() }
  }

  /** The latest audit frame. */
  get frame(): IngressSyncFrame {
    return this.current
  }

  /**
   * Ask the sync to converge on one input. Safe to call on every settings save
   * and every port settle: an already-converged target is a no-op, and an
   * unchanged schedule does not repeat its frame.
   * @param input - the switch, the target, and the credentials to use.
   */
  schedule(input: IngressSyncInput): void {
    if (this.disposed) return
    this.input = input
    if (!input.enabled) {
      this.invalidate()
      this.publish({ state: 'off', at: this.now() })
      return
    }
    if (input.hostname === undefined) {
      // No hostname is no target: the in-flight run has to lose its claim the
      // same way a switch-off does, or it could still write (and report an
      // applied frame) for a target the operator has already unset.
      this.invalidate()
      this.publish({
        state: 'failed',
        code: 'hostname',
        detail: 'ingress sync needs publicBaseUrl to name the fixed public hostname of the named tunnel',
        at: this.now(),
      })
      return
    }
    const port = input.port
    // A port that is not a finite number is not a target: a compose pass can
    // hand NaN/Infinity through a half-read webServer, and that must wait for
    // the settle re-plan instead of becoming a "conflict" about our own config.
    if (typeof port !== 'number' || !Number.isFinite(port)) {
      // No listener yet: make no request. The caller re-schedules once the port
      // settles (its existing retry), so waiting is the whole behavior here —
      // and the in-flight run is invalidated so it cannot write without one.
      this.invalidate()
      this.publish({ state: 'waiting', hostname: input.hostname, at: this.now() })
      return
    }
    const missing = missingConfig(input)
    if (missing.length > 0) {
      this.invalidate()
      this.publish({
        state: 'failed',
        code: 'not-configured',
        hostname: input.hostname,
        port,
        detail: `ingress sync is on but these settings are empty: ${missing.join(', ')}`,
        at: this.now(),
      })
      return
    }
    const key = settleKeyOf(input.hostname, port, input.accountId ?? '', input.tunnelId ?? '', input.token ?? '')
    if (key === this.settledKey && this.current.state === 'applied') return
    this.generation += 1
    this.pending = true
    this.publish({ state: 'waiting', hostname: input.hostname, port, at: this.now() })
    this.armDebounce()
  }

  /**
   * Await every run scheduled so far. A test seam: the host never awaits it,
   * and a synchronous timer double makes the whole chain settle immediately.
   * @returns the settled run chain.
   */
  settled(): Promise<void> {
    return this.chain
  }

  /** Release the timers; an in-flight run finishes its checkpoints as no-ops. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.pending = false
    this.input = undefined
    this.settledKey = undefined
    this.cancelDebounce()
    this.cancelWaits()
  }

  /**
   * Drop every claim this sync holds on a target: a newer generation (so an
   * in-flight run cannot write, settle, or report an applied frame), no queued
   * run, no converged identity, no pending debounce. Every branch of
   * {@link schedule} that ends up without a target calls this, so "there is
   * nothing to converge on" and "the switch is off" are one rule rather than
   * four that can drift apart.
   */
  private invalidate(): void {
    this.generation += 1
    this.pending = false
    this.settledKey = undefined
    this.cancelDebounce()
  }

  private armDebounce(): void {
    this.cancelDebounce()
    this.debounce = this.timer.setTimeout(() => {
      this.debounce = undefined
      this.pump()
    }, this.debounceMs)
  }

  private cancelDebounce(): void {
    if (this.debounce === undefined) return
    this.timer.clearTimeout(this.debounce)
    this.debounce = undefined
  }

  /**
   * Append one run to the serialized chain. The `running` flag is raised before
   * the link starts, so a schedule that lands while a run is in flight only
   * raises `pending` and the live loop picks it up with the newest generation
   * instead of stacking a second link that would read again after it settled.
   */
  private pump(): void {
    if (this.running) {
      this.pending = true
      return
    }
    this.running = true
    this.chain = this.chain.then(async () => {
      try {
        if (this.disposed) return
        do {
          this.pending = false
          await this.run(this.generation)
        } while (this.pending && !this.disposed)
      } finally {
        this.running = false
      }
    }).catch((error: unknown) => {
      // A programming error must not become an unhandled rejection: the request
      // seam own its failures, so anything reaching here is a bug worth a line.
      console.warn(`remote-web-ui: ingress sync run failed (${error instanceof Error ? error.message : String(error)})`)
    })
  }

  /** One converge attempt toward the current target, superseded by any newer schedule. */
  private async run(generation: number): Promise<void> {
    const input = this.input
    if (this.disposed || generation !== this.generation) return
    if (input === undefined || !input.enabled) return
    const hostname = input.hostname
    const port = input.port
    const token = input.token
    const accountId = input.accountId
    const tunnelId = input.tunnelId
    if (hostname === undefined || port === undefined) return
    if (token === undefined || accountId === undefined || tunnelId === undefined) return
    const url = ingressConfigUrl(accountId, tunnelId)
    // The live LAN list is read here, per run: a machine that changed networks
    // must not be judged by the addresses it had when the process started.
    const target: IngressTarget = { hostname, port, allowedHosts: this.lanHosts() }
    // The same identity `schedule` dedupes on: a converged target is only
    // skipped when the tunnel and a digest of the credential are unchanged too.
    const key = settleKeyOf(hostname, port, accountId, tunnelId, token)
    const audit = (extra: Omit<IngressSyncFrame, 'at' | 'hostname' | 'port'> & Partial<IngressSyncFrame>): IngressSyncFrame => ({
      hostname,
      port,
      ...extra,
      at: this.now(),
    })

    const read = await this.send('GET', url, token, generation)
    if (this.disposed || generation !== this.generation) return
    if (!read.ok) {
      // A superseded target says nothing about the current one: the queued run
      // reports instead of this one publishing a failure for a stale port.
      if (read.code === 'stale' || read.code === 'disposed') return
      this.publish(audit({ state: 'failed', code: read.code, detail: tidy(read.detail) }))
      return
    }
    const config = configOfEnvelope(read.response.body)
    if (config === undefined) {
      this.publish(audit({
        state: 'failed',
        code: 'config-shape',
        detail: tidy(`the Cloudflare API answered without a tunnel configuration${errorsText(read.response.body)}`),
      }))
      return
    }
    const plan = planIngressUpdate(config, target)
    if (plan.outcome === 'conflict') {
      this.publish(audit({ state: 'conflict', code: plan.code, detail: tidy(plan.detail) }))
      return
    }
    if (plan.outcome === 'unchanged') {
      this.converged(key, audit({
        state: 'applied',
        changed: false,
        service: plan.service,
        ruleCount: plan.ruleCount,
        ruleIndex: plan.ruleIndex,
      }))
      return
    }
    // The one checkpoint that matters: a newer schedule or a dispose cancels
    // the only write this run would make.
    if (this.disposed || generation !== this.generation) return
    const write = await this.send('PUT', url, token, generation, { config: plan.document })
    if (this.disposed || generation !== this.generation) return
    if (!write.ok) {
      if (write.code === 'stale' || write.code === 'disposed') return
      const state = write.code === 'write-rejected' ? 'conflict' : 'failed'
      this.publish(audit({ state, code: write.code, detail: tidy(write.detail) }))
      return
    }
    // Read the document back once. A disagreement is a conflict and is never
    // rewritten here: one tunnel document has one writer.
    const verify = await this.send('GET', url, token, generation)
    if (this.disposed || generation !== this.generation) return
    if (!verify.ok) {
      if (verify.code === 'stale' || verify.code === 'disposed') return
      this.publish(audit({
        state: 'failed',
        code: verify.code,
        detail: tidy(`the write succeeded but its verification read failed: ${verify.detail}`),
        service: plan.to,
        previousService: plan.from,
        ruleCount: plan.ruleCount,
        ruleIndex: plan.ruleIndex,
        changed: true,
      }))
      return
    }
    const verified = configOfEnvelope(verify.response.body)
    const check = verified === undefined ? undefined : planIngressUpdate(verified, target)
    if (check === undefined || check.outcome !== 'unchanged') {
      this.publish(audit({
        state: 'conflict',
        code: 'verify-mismatch',
        detail: tidy('the tunnel configuration read back does not hold the applied service; another writer may own this document, so it is not rewritten'),
        service: plan.to,
        previousService: plan.from,
        ruleCount: plan.ruleCount,
        ruleIndex: plan.ruleIndex,
        changed: true,
      }))
      return
    }
    this.converged(key, audit({
      state: 'applied',
      changed: true,
      service: plan.to,
      previousService: plan.from,
      ruleCount: plan.ruleCount,
      ruleIndex: plan.ruleIndex,
    }))
  }

  /** Record the converged target identity and publish the frame that says so. */
  private converged(key: string, frame: IngressSyncFrame): void {
    if (this.disposed) return
    this.settledKey = key
    this.publish(frame)
  }

  /**
   * Publish one frame, dropping a repeat that describes the same state. The
   * first publish always goes out, so a sink that starts from nothing learns
   * the current state even when it is the initial `off`.
   */
  private publish(frame: IngressSyncFrame): void {
    if (this.disposed) return
    if (this.emitted && sameIngressFrame(this.current, frame)) return
    this.current = frame
    this.emitted = true
    this.onFrame(frame)
  }

  /**
   * One request with the bounded retry policy: 429, 5xx, and a network failure
   * are retried at most {@link DEFAULT_INGRESS_MAX_RETRIES} times; 401/403 and
   * any other 4xx are terminal, because repeating them cannot help.
   *
   * The run's generation is part of the request: it is checked before every
   * attempt, retries included, so a target superseded while a 429/5xx/network
   * backoff was running stops there instead of writing a document for a port
   * this host no longer serves. The answer is `stale` (or `disposed`) and the
   * caller drops it without publishing.
   */
  private async send(
    method: 'GET' | 'PUT',
    url: string,
    token: string,
    generation: number,
    body?: JsonObject,
  ): Promise<{ ok: true; response: IngressHttpResponse } | RequestFailure> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let retries = 0
    let code = 'network'
    let detail = 'the request could not be made'
    for (;;) {
      if (this.disposed) return { ok: false, code: 'disposed', detail: 'the sync was disposed' }
      if (generation !== this.generation) {
        return { ok: false, code: 'stale', detail: 'a newer schedule superseded this request' }
      }
      let response: IngressHttpResponse | undefined
      try {
        response = await this.http({
          method,
          url,
          headers,
          ...(payload !== undefined ? { body: payload } : {}),
        })
      } catch (error) {
        response = undefined
        code = 'network'
        detail = error instanceof Error ? error.message : String(error)
      }
      if (response !== undefined) {
        const status = response.status
        if (status === 401) return { ok: false, code: 'unauthorized', detail: 'the Cloudflare API rejected the token (401)' }
        if (status === 403) return { ok: false, code: 'forbidden', detail: `the Cloudflare API refused this credential for the tunnel (403)${errorsText(response.body)}` }
        if (status < 400) return { ok: true, response }
        if (status !== 429 && status < 500) {
          return {
            ok: false,
            code: method === 'PUT' ? 'write-rejected' : 'http',
            detail: `the Cloudflare API answered ${String(status)}${errorsText(response.body)}`,
          }
        }
        code = 'http'
        detail = `the Cloudflare API answered ${String(status)}${errorsText(response.body)}`
      }
      if (retries >= this.maxRetries) return { ok: false, code, detail }
      retries += 1
      await this.wait(this.retryBaseMs * 2 ** (retries - 1))
    }
  }

  /**
   * Wait one backoff step on the injected timer. The wait is tracked so a
   * dispose can release it at once: the interrupted run then wakes, sees the
   * dispose at its next attempt check, and stops instead of sleeping out a
   * backoff nobody is waiting for.
   * @param ms - how long the step lasts.
   * @returns a promise that settles when the step ends or is cancelled.
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const entry: { handle: unknown; resolve: () => void } = { handle: undefined, resolve }
      // Registered before the timer is armed: a synchronous timer double fires
      // the callback during the arming call, and the entry must already exist
      // for that callback to retire it.
      this.waits.add(entry)
      entry.handle = this.timer.setTimeout(() => {
        this.waits.delete(entry)
        resolve()
      }, ms)
    })
  }

  /** Release every pending backoff wait (dispose); the interrupted run aborts. */
  private cancelWaits(): void {
    for (const entry of [...this.waits]) {
      this.waits.delete(entry)
      this.timer.clearTimeout(entry.handle)
      entry.resolve()
    }
  }
}
