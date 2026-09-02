/**
 * Relay registry client: a stable `https://<id>.dsh-market.com` origin in
 * front of the plugin-managed quick tunnel, so a paired phone keeps one
 * bookmark and one cookie context across `dsh web` restarts.
 *
 * The plugin mints an id + secret on first run and persists them per profile
 * under `$DSH_HOME/remote-web-ui-registry/`; every tunnel (re)start
 * re-registers the current quick URL with the market worker. Registration is
 * best-effort: a registry outage never blocks the tunnel — the QR just falls
 * back to the raw quick URL for that session (the pre-relay behavior).
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** The market worker's registration endpoints (dsh-market.com edge API). */
export const RELAY_REGISTER_URL = 'https://dsh-market.com/api/relay/register'
export const RELAY_UNREGISTER_URL = 'https://dsh-market.com/api/relay/unregister'
/**
 * The public origin template: one stable single-label subdomain per
 * registration id. Single label on purpose — Universal SSL covers exactly
 * one subdomain level, so a two-level hostname would get no certificate.
 */
export const RELAY_BASE_SUFFIX = '.dsh-market.com'

export const RELAY_ID_RE = /^[a-z0-9]{16}$/
export const RELAY_SECRET_RE = /^[A-Za-z0-9_-]{43}$/

/** Persisted per-profile relay identity. */
export interface RelayIdentity {
  id: string
  secret: string
  /**
   * True only for an identity minted in this process that has never been
   * accepted by the registry: the first register carries `new_secret` so
   * the endpoint may create the row; refreshes authenticate with `secret`
   * alone and must not re-claim an id that already exists.
   */
  fresh?: boolean
}

/** The observable relay lifecycle the settings card renders. */
export type RelayState =
  | { state: 'off' }
  | { state: 'registering' }
  | { state: 'running'; url: string }
  | { state: 'failed'; error: string }

/** Registry storage layout: one file per profile under the relay directory. */
export function relayIdentityFile(profile: string, home: string = dshHome()): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) {
    throw new Error(`relay registry: profile ${JSON.stringify(profile)} is not a safe path segment`)
  }
  return join(home, 'remote-web-ui-registry', `${profile}.json`)
}

/** Generate one identity pair (id: 8-byte hex slug; secret: 32-byte base64url). */
export function generateRelayIdentity(random: (size: number) => Buffer = randomBytes): RelayIdentity {
  return {
    id: random(8).toString('hex'),
    secret: random(32).toString('base64url'),
    fresh: true,
  }
}

/**
 * Load (or lazily mint) the per-profile relay identity. The file is written
 * owner-only on first mint; a corrupt file is reminted (the phone then
 * re-pairs once — the same cost as losing the devices file).
 */
export function loadRelayIdentity(profile: string, home: string = dshHome(), random: (size: number) => Buffer = randomBytes): RelayIdentity {
  const file = relayIdentityFile(profile, home)
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RelayIdentity>
      if (typeof parsed.id === 'string' && RELAY_ID_RE.test(parsed.id)
        && typeof parsed.secret === 'string' && RELAY_SECRET_RE.test(parsed.secret)) {
        // A persisted identity has certainly been registered before.
        return { id: parsed.id, secret: parsed.secret }
      }
      console.warn(`relay registry: ${file} is malformed — reminting the identity (paired devices must scan the QR once more)`)
    }
  } catch (error) {
    console.warn(`relay registry: could not read ${file} (${error instanceof Error ? error.message : String(error)}) — reminting`)
  }
  const identity = generateRelayIdentity(random)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ id: identity.id, secret: identity.secret }, null, 2) + '\n', { mode: 0o600 })
  return identity
}

/** Build the registration request body for one identity + tunnel target. */
function registrationBody(identity: RelayIdentity, target: string): string {
  return JSON.stringify({
    id: identity.id,
    secret: identity.secret,
    new_secret: identity.fresh === true ? identity.secret : undefined,
    target,
  })
}

/** Best-effort removal of the mapping (used on disable; errors are swallowed). */
export async function unregisterRelay(
  identity: RelayIdentity,
  endpoint: string = RELAY_UNREGISTER_URL,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: identity.id, secret: identity.secret }),
  })
}

/**
 * The stable relay base for one identity — the origin the QR and the phone
 * bookmark use while (or after) the registration is accepted.
 */
export function relayBaseOf(identity: RelayIdentity): string {
  return `https://${identity.id}${RELAY_BASE_SUFFIX}`
}

/**
 * Registration loop with capped exponential backoff. Re-registration happens
 * on every tunnel start (the quick URL can change after a crash-restart);
 * failures retry with backoff and surface the last error to the card.
 */
export class RelayRegistrar {
  private timer: NodeJS.Timeout | undefined
  private attempts = 0
  private lastError: string | undefined
  private disposed = false

  constructor(
    private readonly identity: RelayIdentity,
    private readonly setState: (state: RelayState) => void,
    private readonly options: {
      fetchFn?: typeof fetch
      registerUrl?: string
      unregisterUrl?: string
      baseDelayMs?: number
      maxDelayMs?: number
      timerFn?: (fn: () => void, ms: number) => NodeJS.Timeout
    } = {},
  ) {}

  /** The stable relay base for the QR while registered. */
  get baseUrl(): string {
    return relayBaseOf(this.identity)
  }

  /** The last registration failure detail (undefined while healthy). */
  get error(): string | undefined {
    return this.lastError
  }

  /** Push one tunnel target; resolves the stable base once accepted. */
  async announce(target: string): Promise<string | undefined> {
    // A disposed registrar stays disposed: a pending retry timer must not
    // resurrect it (re-enabling creates a fresh registrar instead).
    if (this.disposed) return undefined
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.setState({ state: 'registering' })
    try {
      const fetchFn = this.options.fetchFn ?? fetch
      const response = await fetchFn(this.options.registerUrl ?? RELAY_REGISTER_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: registrationBody(this.identity, target),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => undefined)
        const error = detail && typeof detail.error === 'string' ? detail.error : `HTTP ${String(response.status)}`
        throw new Error(error)
      }
      // The row exists now: never claim a fresh id twice.
      this.identity.fresh = false
      this.attempts = 0
      this.lastError = undefined
      this.setState({ state: 'running', url: this.baseUrl })
      return this.baseUrl
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      if (this.lastError === 'invalid-params' && this.identity.fresh !== true) {
        // The registry lost the row (a D1 restore or manual wipe): re-claim
        // the id with a fresh claim on the next retry. A 403 auth-failed
        // means the id is owned by another secret and stays failed.
        this.identity.fresh = true
      }
      this.setState({ state: 'failed', error: this.lastError })
      this.scheduleRetry(target)
      return undefined
    }
  }

  /** Best-effort removal of the registry row (the relay toggle turned off). */
  async unregister(): Promise<void> {
    await unregisterRelay(this.identity, this.options.unregisterUrl, this.options.fetchFn)
  }

  private scheduleRetry(target: string): void {
    if (this.disposed) return
    const base = this.options.baseDelayMs ?? 5_000
    const max = this.options.maxDelayMs ?? 60_000
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    const timerFn = this.options.timerFn ?? ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      timer.unref?.()
      return timer
    })
    this.timer = timerFn(() => {
      this.timer = undefined
      void this.announce(target)
    }, delay)
  }

  /** Stop retrying and clear the card state (tunnel stopped or disabled). */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.setState({ state: 'off' })
  }
}