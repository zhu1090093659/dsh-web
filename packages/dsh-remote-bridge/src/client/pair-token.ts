/**
 * The panel's one wire call: read the one-shot bootstrap token from this
 * package's own Host route.
 *
 * The route is same-origin and document-relative (the GUI is served with
 * `<base href="./">`, so a sub-path deployment resolves it against its entry
 * directory instead of escaping to the origin root — the same rule
 * `dsh-remote-web-ui`'s pair API follows). It is NOT consumed here: the panel
 * only displays the secret, and the phone spends it in `pair.begin`, so a
 * mis-click on "new code" voids a token without ever pairing a device.
 *
 * `403` is a fact, not an error: the loopback gate in `core/loopback.ts`
 * refuses any page whose socket or `Host` is not this machine, which is exactly
 * the case the panel must name out loud.
 *
 * The origin's own source crosses too, and it is not decoration: it is what lets
 * the panel say which kind of address the code carries without printing a
 * public hostname, while still naming a LAN literal that answers only inside the
 * network the page is already on.
 * @module dsh-remote-bridge/client/pair-token
 */

import type { PairOriginSource } from '../core/pair-address.ts'
import { PAIR_TOKEN_PATH } from '../core/protocol.ts'

/** Document-relative form of the Host route, for a page served under any base. */
export const PAIR_TOKEN_URL = PAIR_TOKEN_PATH.replace(/^\/+/, '')

/** The outcome of one token read. */
export type PairTokenOutcome =
  /**
   * A live one-shot token and the instant it stops being accepted, plus the
   * address half when this machine can name its own public origin. `pairingUrl`
   * is the code a QR should carry: a `{token, url}` document the phone parses
   * into both halves of its configuration.
   */
  | {
    kind: 'ok'
    token: string
    expiresAt: number
    origin: string | null
    originSource: PairOriginSource | null
    pairingUrl: string | null
  }
  /** 403: the page is not open on the machine itself, so the loopback gate refused it. */
  | { kind: 'forbidden' }
  /** The route answered with a status the panel does not know, or with a body that is not a token. */
  | { kind: 'failed'; status: number }
  /** The request never reached the host (offline, host stopped, connection reset). */
  | { kind: 'unreachable' }

/** The minimal response surface the reader uses, so a test can inject its own. */
export interface PairTokenResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** The minimal fetch surface the reader uses, so a test can inject its own. */
export type PairTokenFetch = (url: string, init: { signal?: AbortSignal; cache: string }) => Promise<PairTokenResponse>

export interface ReadPairTokenOptions {
  /** Injected transport; defaults to the global fetch. */
  readonly fetchImpl?: PairTokenFetch
  /** Aborts an in-flight read (the panel closed, the entry unmounted). */
  readonly signal?: AbortSignal
}

/** Read a string field, treating a missing, mistyped or empty value as absent. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Read one bootstrap token.
 *
 * Never throws: every failure is one of the outcome arms, because the panel has
 * to render each of them. A `200` whose body is not `{token, expiresAt}` is
 * reported as a failure rather than shown as an empty QR.
 * @param options - injected transport and abort signal.
 * @returns the read outcome.
 */
export async function readPairToken(options: ReadPairTokenOptions = {}): Promise<PairTokenOutcome> {
  const send = options.fetchImpl ?? (globalThis.fetch as unknown as PairTokenFetch | undefined)
  if (send === undefined) return { kind: 'unreachable' }
  let response: PairTokenResponse
  try {
    response = await send(PAIR_TOKEN_URL, {
      cache: 'no-store',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    // A network failure and an aborted read are indistinguishable here, and
    // both mean "no token arrived" — the panel says so instead of guessing.
    return { kind: 'unreachable' }
  }
  if (response.status === 403) return { kind: 'forbidden' }
  if (!response.ok) return { kind: 'failed', status: response.status }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'failed', status: response.status }
  }
  if (typeof body !== 'object' || body === null) return { kind: 'failed', status: response.status }
  const token = (body as { token?: unknown }).token
  const expiresAt = (body as { expiresAt?: unknown }).expiresAt
  if (typeof token !== 'string' || token === '') return { kind: 'failed', status: response.status }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return { kind: 'failed', status: response.status }
  // Additive fields: a host that predates origin discovery answers without
  // them, and the panel then falls back to the bare-token code instead of
  // refusing to show anything.
  const origin = stringOrNull((body as { origin?: unknown }).origin)
  const candidate = stringOrNull((body as { pairingUrl?: unknown }).pairingUrl)
  const pairingUrl = candidate !== null && /^wss?:\/\/\S+$/.test(candidate) ? candidate : null
  const source = (body as { originSource?: unknown }).originSource
  const originSource = source === 'realtime' || source === 'env' || source === 'lan' ? source : null
  return { kind: 'ok', token, expiresAt, origin, originSource, pairingUrl }
}
