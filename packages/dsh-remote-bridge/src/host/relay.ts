/**
 * The hosted relay this bridge hands a notification to when it holds no Apple key.
 *
 * §28's channel needs an Apple signing key, and a distributed App cannot get one
 * onto every user's machine: the key would have to be shipped with the App's
 * operator, which is the one thing a store release may not do. So the same event
 * can be delivered two ways, and this file is the second one — one HTTPS POST to
 * a service that signs with a key no deployment holds.
 *
 * Four rules, each of them borrowed from the direct path beside it:
 *
 * - the bridge sends the EVENT, not the state: `{event, sessionId, title, workspace}`
 *   for a notification and `{event: 'live-activity', sessionId, activityId,
 *   activityEvent, contentState, dismiss?}` for a card. It no longer decides the APNs
 *   headers, the bundle, the environment or the alert bodies — the service does,
 *   from the registration the App made directly with it;
 * - a failure is a return value, never a rejection and never a retry: both callers
 *   sit on frame paths that must not learn about the network at all (§28.5);
 * - the relay token is the phone's credential, scoped to this pairing's
 *   fingerprint. It is read off the roster row and put in one header; it is never
 *   logged, echoed in a frame, or written anywhere but that row;
 * - the route is exclusive with the local key rather than a fallback chain. A
 *   machine that holds a key keeps signing for itself, so a developer's delivery
 *   never travels through the service and a hosted deployment never silently
 *   switches routes halfway through a session.
 * @module dsh-remote-bridge/host/relay
 */

import type { LiveActivityAddress, LiveActivityNotification, LiveActivitySender } from '../core/liveactivity.ts'
import type { PushAddress, PushNotification, PushRoute, PushSendResult, PushSender } from '../core/push.ts'

/**
 * Where the hosted relay lives by default.
 *
 * The account service the App already signs into: one deployment, one hostname, so
 * an operator with no relay of their own configures nothing at all.
 */
export const RELAY_DEFAULT_URL = 'https://account.chatwithai.icu'
/** The environment variable that moves the relay to another deployment. */
export const RELAY_ENV = { url: 'DSH_REMOTE_BRIDGE_RELAY_URL' } as const
/** The one path a delivery is posted to. */
export const RELAY_PATH = '/v1/push/relay'
/** How long one delivery may take before it is abandoned. */
export const RELAY_TIMEOUT_MS = 10_000

/**
 * Read the relay's base address.
 * @param env - the environment to read; defaults to this process's.
 * @returns the trimmed base with no trailing slash, or {@link RELAY_DEFAULT_URL}.
 */
export function relayUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[RELAY_ENV.url]?.trim()
  if (configured === undefined || configured === '') return RELAY_DEFAULT_URL
  return configured.endsWith('/') ? configured.slice(0, -1) : configured
}

/** The notification body the relay accepts (contract v1, frozen). */
export interface RelayNotificationRequest {
  readonly event: PushNotification['st']
  readonly sessionId: string
  /** The session's own name; the service substitutes its fixed line when absent. */
  readonly title?: string
  /** The workspace's short name, which is a directory's basename and not a path. */
  readonly workspace?: string
}

/** The Live Activity body the relay accepts (contract v1, frozen). */
export interface RelayLiveActivityRequest {
  readonly event: 'live-activity'
  readonly sessionId: string
  readonly activityId: string
  readonly activityEvent: LiveActivityNotification['aps']['event']
  readonly contentState: LiveActivityNotification['aps']['content-state']
  /**
   * Whether the card must go the moment this delivery lands, rather than at its
   * `stale-date`. Only ever `true`: the key is absent when the card stays, because
   * a `false` would be a second way to say the same thing and an older service
   * would have to learn it. The dismissal date itself is the service's to write —
   * it is the one that knows when the delivery landed (§29.3).
   */
  readonly dismiss?: boolean
}

/**
 * The notification one delivery becomes.
 *
 * Pure, and exported so the body can be asserted without a network. What crosses is
 * exactly what §28.4 already allows on a lock screen — the event, the session id,
 * the session's name and the workspace's short name — and nothing else: no message,
 * no tool output, no path, no question body.
 * @param notification - the payload the notifier built for the direct path.
 * @returns the body to POST.
 */
export function buildRelayNotification(notification: PushNotification): RelayNotificationRequest {
  return {
    event: notification.st,
    sessionId: notification.s,
    // The notifier already decided what may name this event — the session's own
    // title, or the fixed status line when it holds none — so passing it through
    // keeps one answer to "what may a notification say" for both routes.
    title: notification.aps.alert.title,
    ...(notification.w === undefined || notification.w === '' ? {} : { workspace: notification.w }),
  }
}

/**
 * The Live Activity body one delivery becomes.
 *
 * The card's content state crosses verbatim: it is the App's own
 * `SessionActivityState` (§29.3), already built by `core/liveactivity.ts` with its
 * frozen key set and Apple-reference timestamps, and rebuilding it here would be a
 * second answer to the same encoding question.
 * @param target - the card being pushed to.
 * @param notification - the payload the notifier built for the direct path.
 * @returns the body to POST, or undefined when the card names no session.
 */
export function buildRelayLiveActivity(
  target: LiveActivityAddress,
  notification: LiveActivityNotification,
): RelayLiveActivityRequest | undefined {
  if (target.sessionId === undefined) return undefined
  return {
    event: 'live-activity',
    sessionId: target.sessionId,
    activityId: target.activityId,
    activityEvent: notification.aps.event,
    contentState: notification.aps['content-state'],
    // The direct payload already decided this: it writes `dismissal-date` only for an
    // `end` whose session left the roster. Reading that decision back off the payload
    // keeps one answer to "does this card go now" for both routes, and the date is
    // left to the service, which stamps its own delivery moment.
    ...(notification.aps['dismissal-date'] === undefined ? {} : { dismiss: true }),
  }
}

/** The 200 body the relay answers with (contract v1, frozen). */
export interface RelayAnswer {
  readonly ok?: boolean
  /** How many devices took the delivery. */
  readonly delivered?: number
  /** How many registrations the relay judged dead and cleaned up. */
  readonly dead?: number
}

/** The one request shape this file makes, with the answer narrowed to what it reads. */
export type RelayFetch = (
  url: string,
  init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
    readonly signal: AbortSignal
  },
) => Promise<{ readonly status: number; text(): Promise<string> }>

export interface RelaySenderOptions {
  /** The relay's base address, from {@link relayUrlFromEnv}. */
  readonly url: string
  /** The HTTP client; the global `fetch` by default, injectable so failures need no network. */
  readonly fetch?: RelayFetch
  readonly timeoutMs?: number
}

/**
 * The relay half of the push channel.
 *
 * Every method resolves: a delivery that failed is a {@link PushSendResult} with
 * `ok: false`, never a rejection, because both callers sit on frame paths that must
 * not learn about the network at all. Nothing is retried — an alert that could not
 * be delivered is one line in the log, and the next event is the next attempt.
 */
export class RelaySender implements PushSender, LiveActivitySender {
  readonly #url: string
  readonly #fetch: RelayFetch
  readonly #timeoutMs: number

  constructor(options: RelaySenderOptions) {
    this.#url = options.url
    this.#fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.#timeoutMs = options.timeoutMs ?? RELAY_TIMEOUT_MS
  }

  /** Deliver one notification, or report why it did not arrive. */
  async send(target: PushAddress, notification: PushNotification): Promise<PushSendResult> {
    if (target.relayToken === undefined || target.relayToken === '') {
      return { ok: false, reason: 'this device row holds no relay token' }
    }
    return await this.#post(target.relayToken, buildRelayNotification(notification))
  }

  /** Deliver one Live Activity push, or report why it did not arrive. */
  async sendLiveActivity(target: LiveActivityAddress, notification: LiveActivityNotification): Promise<PushSendResult> {
    if (target.relayToken === undefined || target.relayToken === '') {
      return { ok: false, reason: 'this device row holds no relay token' }
    }
    const body = buildRelayLiveActivity(target, notification)
    if (body === undefined) return { ok: false, reason: 'this card names no session, so the relay has nothing to address' }
    return await this.#post(target.relayToken, body)
  }

  /**
   * POST one already-built body.
   *
   * The relay answers 200 for every outcome, including a delivery Apple refused:
   * `delivered` counts what landed and `dead` counts the tokens it retired. A
   * delivery that landed on nothing is therefore reported as the failure it is,
   * with `dead` telling the roster to forget a registration that can never work
   * again.
   * @param token - the relay credential of the device this is addressed to.
   * @param body - the JSON body to send.
   * @returns whether anything took it, and what the relay said when nothing did.
   */
  async #post(token: string, body: RelayNotificationRequest | RelayLiveActivityRequest): Promise<PushSendResult> {
    let status: number
    let text: string
    try {
      const response = await this.#fetch(`${this.#url}${RELAY_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
      status = response.status
      text = await response.text()
    } catch (error) {
      // A connection that never answered, a timeout, a DNS failure and a body the
      // proxy rewrote all end here, as the same one line.
      return { ok: false, reason: `relay request failed: ${String(error)}` }
    }
    if (status === 401) return { ok: false, status, reason: 'unauthorized' }
    if (status !== 200) return { ok: false, status, reason: `relay answered ${String(status)}` }
    const answer = parseAnswer(text)
    if (answer === undefined || answer.ok !== true) return { ok: false, status, reason: 'the relay answered no usable result' }
    if ((answer.delivered ?? 0) > 0) return { ok: true, status }
    if ((answer.dead ?? 0) > 0) return { ok: false, status, dead: true, reason: 'the relay retired this registration' }
    return { ok: false, status, reason: 'the relay delivered to no device' }
  }
}

/** @returns the parsed answer, or undefined when the body is not one. */
function parseAnswer(text: string): RelayAnswer | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return parsed as RelayAnswer
  } catch {
    return undefined
  }
}

/**
 * Which road this bridge stands on, given the two credentials it could hold.
 *
 * A local key wins over a relay token, deliberately: the machine that can sign for
 * itself must not route a developer's events through the hosted service, and the
 * two routes never run side by side for one event.
 * @param localKey - whether this machine holds a complete APNs credential.
 * @param relayArmed - whether some paired row holds a relay token.
 * @returns the route the channel is on.
 */
export function pushRouteOf(localKey: boolean, relayArmed: boolean): PushRoute {
  if (localKey) return 'direct'
  return relayArmed ? 'relay' : 'off'
}

/** What the mount log needs to know to say where this bridge stands. */
export interface PushChannelDescription {
  readonly route: PushRoute
  /** The key id of the local credential, when the route is `direct`. */
  readonly keyId?: string
  /** The team that key belongs to, when the route is `direct`. */
  readonly teamId?: string
  /** The relay's base address, when the route is `relay`. */
  readonly relayUrl?: string
}

/**
 * The one line the mount log says about the push channel.
 *
 * Three routes, three lines, and the line names the credential each one reads: an
 * operator reading a log has to be able to tell a bridge signing for itself from
 * one asking a service to, without opening any file.
 * @param description - the route and the parts of it worth naming.
 * @returns the line to log.
 */
export function pushChannelLine(description: PushChannelDescription): string {
  if (description.route === 'direct') return `push: direct (APNs key ${description.keyId ?? '?'} of team ${description.teamId ?? '?'})`
  if (description.route === 'relay') return `push: relay (${description.relayUrl ?? RELAY_DEFAULT_URL})`
  return `push: off (no APNs key on this machine and no paired device holds a relay token)`
}
