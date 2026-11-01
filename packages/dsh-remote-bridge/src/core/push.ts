/**
 * What this bridge tells a phone that is not listening.
 *
 * Every fact a phone needs already has a read on the wire — a roster, a
 * baseline, a question list — and a notification is not one of them. It is the
 * `turn ended` or `something is waiting` event, delivered by APNs to a device
 * whose socket is closed, and nothing else: this module deliberately holds no
 * session state, publishes no topic, and answers no method. A client that acts
 * on a notification still has to read the fact behind it (protocol §28).
 *
 * Three rules live here, so the sender beside it cannot disagree about them:
 *
 * - the payload carries a session's NAME, its workspace's short name, the state
 *   and one deep link. Never a message, a tool output, a file name or a
 *   question's body — a notification crosses Apple's servers and sits on a lock
 *   screen, which is the last place session content should be;
 * - the same `(sessionId, event)` inside {@link PUSH_DEDUPE_MS} is one
 *   notification, because two phones following one session both see the same
 *   turn end and the user has one lock screen, and one APNs token is one
 *   delivery, because a token belongs to the app install rather than to one
 *   pairing, so the rows that share it are still that one phone;
 * - a failed delivery is logged and dropped. Nothing here is awaited by the
 *   delta path, so a broken APNs connection cannot delay, reorder or suppress a
 *   frame that a connected phone is waiting for.
 * @module dsh-remote-bridge/core/push
 */

import { basename } from 'node:path'

/** One thing a notification can be about. */
export type PushEvent = 'turn-end' | 'turn-error' | 'question' | 'approval'

/**
 * Which way this bridge delivers a notification.
 *
 * `direct` signs for APNs with this machine's own Apple key, `relay` asks the
 * hosted service to sign with the one key no deployment may hold, and `off` is a
 * bridge with neither route — the channel's original shape, byte for byte. The two
 * routes are exclusive rather than a fallback chain: a machine holding a key keeps
 * using it, so a developer's delivery never travels through the service.
 */
export type PushRoute = 'direct' | 'relay' | 'off'

/** Window inside which the same `(sessionId, event)` is one notification. */
export const PUSH_DEDUPE_MS = 30_000
/** Shortest gap between two notifications about the same session. */
export const PUSH_SESSION_INTERVAL_MS = 10_000
/** Most notifications this bridge sends in any rolling minute. */
export const PUSH_GLOBAL_PER_MINUTE = 30
/** Sessions whose workspace short name is remembered for the payload. */
export const PUSH_WORKSPACE_LIMIT = 512
/** The only deep-link form this channel emits. */
export const PUSH_DEEP_LINK_PREFIX = 'whale://session/'
/**
 * The one category a delivery may name (§28.4).
 *
 * A banner draws a button only where a category it knows is named, so this is the
 * identifier the client registered statically for the two approval answers. It is
 * the client's name rather than this bridge's: the bridge writes it verbatim and
 * holds no second opinion about what a button says.
 */
export const PUSH_APPROVAL_CATEGORY = 'dev.dsh.Whale.category.approval'

/**
 * The status line each event carries.
 *
 * Fixed strings on purpose: a body built out of host text would be session
 * content wearing a notification's clothes, and the whole point of this channel
 * is that it carries none.
 */
const PUSH_BODY: Readonly<Record<PushEvent, string>> = {
  'turn-end': '回合结束',
  'turn-error': '回合异常结束',
  question: '有待回答的问题',
  approval: '有待确认的审批',
}

/** One device a notification can be addressed to. */
export interface PushAddress {
  readonly deviceToken: string
  readonly environment: 'sandbox' | 'production'
  readonly bundle: string
  readonly locale?: string
  /**
   * The relay credential that same row registered, when it registered one.
   *
   * Present on the address rather than looked up by the sender so the two routes
   * stay one decision: a row carries the token only in relay mode, and the sender
   * that reads it is the only one this bridge built.
   */
  readonly relayToken?: string
}

/** The request body one APNs delivery carries (protocol §28.4). */
export interface PushNotification {
  readonly aps: {
    readonly alert: { readonly title: string; readonly body: string }
    readonly sound: 'default'
    /**
     * The client's registered category, named only by an approval.
     *
     * Absent for every other event rather than empty: an absent key is a banner
     * with no buttons, and an empty one would be a second way to say it.
     */
    readonly category?: string
  }
  /** Workspace short name; absent when this bridge cannot resolve one. */
  readonly w?: string
  readonly s: string
  readonly st: PushEvent
  readonly url: string
}

/** What one delivery attempt reported. */
export interface PushSendResult {
  readonly ok: boolean
  /** The status APNs answered, or the relay did, when it answered at all. */
  readonly status?: number
  /** The reason APNs named, or this bridge's own note. */
  readonly reason?: string
  /**
   * Whether the answer said this registration will never work again.
   *
   * APNs says it in a status and a reason this module can read; the relay says it
   * in a count of tokens it just retired, which names no status of its own. The
   * sender that learned it reports the fact here instead of borrowing an APNs
   * status it did not receive.
   */
  readonly dead?: boolean
}

/** One delivery a sender refused, in the words the bridge needs to read it. */
export interface PushDeliveryFailure {
  /** The registration APNs refused: the roster row holding it is a device that no longer exists. */
  readonly deviceToken: string
  /** The status APNs answered, when it answered at all. */
  readonly status?: number
  /** The reason APNs named, or this bridge's own note. */
  readonly reason?: string
  /** Whether this failure was final about the registration behind it. */
  readonly dead?: boolean
}

/** What one {@link PushNotifier.notify} ended up doing, once every attempt settled. */
export interface PushDeliveryReport {
  /** How many devices took the notification. */
  readonly delivered: number
  /** Every attempt that did not land, in target order. */
  readonly failures: readonly PushDeliveryFailure[]
}

/**
 * @param failure - one refused delivery.
 * @returns whether the registration behind it is dead for good.
 *
 * APNs says a token will never work again in three ways: 410 with
 * `Unregistered`, and 400 with `Unregistered` or `BadDeviceToken`. All three are
 * final facts about the registration — the app was removed, or this token belongs
 * to another environment or bundle — so it is cleaned up instead of retried, and
 * a claim held for it is a claim held for a phone that cannot come back.
 */
export function isDeadPushToken(failure: PushDeliveryFailure): boolean {
  if (failure.dead === true) return true
  const reason = failure.reason ?? ''
  if (reason === 'Unregistered' || reason === 'BadDeviceToken') return true
  return failure.status === 410
}

/** Whatever actually reaches a device; the APNs client implements this. */
export interface PushSender {
  send(target: PushAddress, notification: PushNotification): Promise<PushSendResult>
}

/** What the payload builder may say about one session. */
export interface PushLabels {
  readonly title?: string
  readonly workspace?: string
}

export interface PushNotifierOptions {
  /**
   * The devices that asked to be notified, read per event.
   *
   * The list may carry several rows holding the same `deviceToken`: a phone that
   * pairs again owns more than one roster row, and a token outlives any one
   * pairing. Converging them is this module's job, not the caller's.
   */
  readonly targets: () => readonly PushAddress[]
  /** The sender; absent is a bridge with no signing key, and then nothing happens. */
  readonly sender?: PushSender
  /**
   * Whether the configured route can reach a phone right now.
   *
   * Absent means "the sender is reason enough", which is what a machine holding its
   * own Apple key is: the key is configured or it is not. The relay has a second
   * fact in front of the credential — some paired row must still hold a relay
   * token — and reading it per event is what keeps a bridge with neither route
   * exactly as inert as one with no key at all.
   */
  readonly available?: () => boolean
  /** Which route this notifier stands on; `direct` by default, as before the relay existed. */
  readonly mode?: PushRoute
  /** The session's own title (§26's source), read per event. */
  readonly titles?: (sessionId: string) => string | undefined
  readonly now?: () => number
  readonly log?: (message: string) => void
  readonly dedupeMs?: number
  readonly sessionIntervalMs?: number
  readonly globalPerMinute?: number
}

/**
 * The notification the channel sends for one event (protocol §28.4).
 *
 * Pure, and exported so the shape can be asserted without a sender: the keys
 * are the contract, and the absence of any body text is the property that
 * matters most. One key is conditional — an approval names the category the
 * client registered, because naming it is the only thing that makes a banner
 * draw a button, and every other event omits it so a banner stays buttonless.
 * @param event - what happened.
 * @param sessionId - the session it happened to.
 * @param labels - the name and workspace short name, when the bridge holds them.
 * @returns the exact payload an APNs delivery carries.
 */
export function buildPushNotification(event: PushEvent, sessionId: string, labels: PushLabels = {}): PushNotification {
  const named = labels.title !== undefined && labels.title !== ''
  return {
    aps: {
      alert: { title: named ? labels.title as string : PUSH_BODY[event], body: PUSH_BODY[event] },
      sound: 'default',
      ...(event === 'approval' ? { category: PUSH_APPROVAL_CATEGORY } : {}),
    },
    ...(labels.workspace === undefined || labels.workspace === '' ? {} : { w: labels.workspace }),
    s: sessionId,
    st: event,
    url: `${PUSH_DEEP_LINK_PREFIX}${sessionId}`,
  }
}

/**
 * Which event one `turn-end` delta is.
 * @param reason - the host's own reason for ending the turn.
 * @returns the normal end for `completed`, the abnormal one for every other
 * value — including `unknown`, which is what an unreadable reason reports.
 */
export function pushEventOfTurnEnd(reason: string): PushEvent {
  return reason === 'completed' ? 'turn-end' : 'turn-error'
}

/**
 * One address per APNs token, the first row winning.
 *
 * A token is minted by the app install rather than by a pairing, so every row
 * holding the same token is the same phone: two rows are one lock screen, and
 * sending to both shows one event twice.
 * @param targets - every row the roster reported as a notification target.
 * @returns one address per token, in roster order.
 */
function perToken(targets: readonly PushAddress[]): PushAddress[] {
  const seen = new Set<string>()
  const kept: PushAddress[] = []
  for (const target of targets) {
    if (seen.has(target.deviceToken)) continue
    seen.add(target.deviceToken)
    kept.push(target)
  }
  return kept
}

/**
 * The bridge's outbound notification path.
 *
 * Deliberately inert when no sender is configured: {@link enabled} is false, no
 * target is ever read and no clock is ever consulted, so an unconfigured bridge
 * behaves — byte for byte, frame for frame — exactly as it did before this
 * channel existed.
 */
export class PushNotifier {
  readonly #options: PushNotifierOptions
  readonly #now: () => number
  readonly #log: (message: string) => void
  /** Last send per `(sessionId, event)`. */
  readonly #dedupe = new Map<string, number>()
  /** Last send per session, whatever the event. */
  readonly #sessions = new Map<string, number>()
  /** Send timestamps inside the rolling minute. */
  #recent: number[] = []
  /** Session id to workspace short name, as the roster rows this bridge served reported it. */
  readonly #workspaces = new Map<string, string>()

  constructor(options: PushNotifierOptions) {
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
    this.#log = options.log ?? (() => undefined)
  }

  /**
   * @returns whether this bridge will actually deliver anything.
   *
   * Read by every entrance — a delta path, a claim, a watcher — so a bridge whose
   * route is not armed is indistinguishable from one that never had a channel: no
   * target is read, no clock is consulted and no timer is armed.
   */
  get enabled(): boolean {
    return this.#available() && this.#options.sender !== undefined
  }

  /** @returns which road a delivery would take: this machine's key or the hosted relay. */
  get mode(): PushRoute {
    return this.#options.mode ?? 'direct'
  }

  /** @returns whether the route in front of the sender is reachable; a throwing probe reaches nothing. */
  #available(): boolean {
    const available = this.#options.available
    if (available === undefined) return true
    try {
      return available()
    } catch {
      return false
    }
  }

  /**
   * Remember the workspace each session belongs to, from a roster this bridge
   * just served.
   *
   * A notification's `w` is the only label the bridge cannot read from the
   * title service, and asking the host for a roster on every turn end would put
   * a gateway call on the notification path. The rows are already in hand when a
   * phone lists them, so the short name is picked up there and kept bounded; a
   * session never listed simply gets a payload without `w`.
   * @param rows - the roster rows that were just built for a client.
   */
  noteSessions(rows: readonly { readonly id: string; readonly cwd?: string }[]): void {
    if (!this.enabled) return
    for (const row of rows) {
      if (row.cwd === undefined || row.cwd === '') continue
      const short = basename(row.cwd)
      if (short === '') continue
      this.#workspaces.delete(row.id)
      this.#workspaces.set(row.id, short)
    }
    while (this.#workspaces.size > PUSH_WORKSPACE_LIMIT) {
      const oldest = this.#workspaces.keys().next()
      if (oldest.done === true) break
      this.#workspaces.delete(oldest.value)
    }
  }

  /**
   * Announce one event to every registered device.
   *
   * Returns before anything is sent: delivery starts on a fresh microtask, so a
   * caller on the delta path never awaits an APNs round trip and a sender that
   * throws cannot reach it.
   * @param event - what happened.
   * @param sessionId - the session it happened to.
   * @param onReport - receives how the announcement ended, once every attempt has
   * settled. A caller that held something for a phone — an offline claim (§32) —
   * needs to know whether any phone was actually told, and may not block the
   * caller's own path on an APNs round trip to find out. Not called when nothing
   * was attempted: no sender, no target, or a rate limit that dropped this event.
   */
  notify(event: PushEvent, sessionId: string, onReport?: (report: PushDeliveryReport) => void): void {
    if (!this.enabled) return
    try {
      this.#announce(event, sessionId, onReport)
    } catch (error) {
      // The caller is a frame path — a delta broadcast or a claim — and a
      // notification that cannot even be built must not end a follow stream.
      this.#log(`push ${event} for ${sessionId} could not be prepared: ${String(error)}`)
    }
  }

  /** Build and start one event's deliveries. */
  #announce(event: PushEvent, sessionId: string, onReport?: (report: PushDeliveryReport) => void): void {
    const sender = this.#options.sender
    if (sender === undefined) return
    // One token is one app install is one lock screen, so the rows converge before
    // anything is sent: the roster may hold the same phone twice without the
    // phone being told twice.
    const targets = perToken(this.#options.targets())
    if (targets.length === 0) return
    const now = this.#now()
    if (!this.#admit(event, sessionId, now)) return
    const notification = buildPushNotification(event, sessionId, this.#labelsOf(sessionId))
    const failures: PushDeliveryFailure[] = []
    let delivered = 0
    let pending = targets.length
    // One report per announcement, after the last attempt settled: a half-read
    // count is worse than none, because the caller acts on it.
    const settleOne = (failure: PushDeliveryFailure | undefined): void => {
      if (failure === undefined) delivered += 1
      else failures.push(failure)
      pending -= 1
      if (pending > 0 || onReport === undefined) return
      try {
        onReport({ delivered, failures })
      } catch (error) {
        this.#log(`push ${event} for ${sessionId} could not be reported: ${String(error)}`)
      }
    }
    for (const target of targets) {
      void Promise.resolve()
        .then(async () => await sender.send(target, notification))
        .then((result) => {
          if (result.ok) {
            settleOne(undefined)
            return
          }
          this.#log(`push ${event} for ${sessionId} was not delivered (${result.status ?? '-'} ${result.reason ?? 'no reason'})`)
          settleOne({
            deviceToken: target.deviceToken,
            ...(result.status === undefined ? {} : { status: result.status }),
            ...(result.reason === undefined ? {} : { reason: result.reason }),
            ...(result.dead === true ? { dead: true } : {}),
          })
        })
        .catch((error: unknown) => {
          this.#log(`push ${event} for ${sessionId} failed: ${String(error)}`)
          settleOne({ deviceToken: target.deviceToken })
        })
    }
  }

  /** @returns whether this event may be sent now; records the send when it may. */
  #admit(event: PushEvent, sessionId: string, now: number): boolean {
    const dedupeMs = this.#options.dedupeMs ?? PUSH_DEDUPE_MS
    const sessionMs = this.#options.sessionIntervalMs ?? PUSH_SESSION_INTERVAL_MS
    const perMinute = this.#options.globalPerMinute ?? PUSH_GLOBAL_PER_MINUTE
    this.#prune(now, dedupeMs)
    const key = `${sessionId}|${event}`
    const lastSame = this.#dedupe.get(key)
    if (lastSame !== undefined && now - lastSame < dedupeMs) return false
    const lastSession = this.#sessions.get(sessionId)
    if (lastSession !== undefined && now - lastSession < sessionMs) return false
    this.#recent = this.#recent.filter(at => now - at < 60_000)
    if (this.#recent.length >= perMinute) return false
    this.#dedupe.set(key, now)
    this.#sessions.set(sessionId, now)
    this.#recent.push(now)
    return true
  }

  /** Forget entries that can no longer suppress anything. */
  #prune(now: number, dedupeMs: number): void {
    if (this.#dedupe.size > 256) {
      for (const [key, at] of this.#dedupe) if (now - at >= dedupeMs) this.#dedupe.delete(key)
    }
    if (this.#sessions.size > 256) {
      const sessionMs = this.#options.sessionIntervalMs ?? PUSH_SESSION_INTERVAL_MS
      for (const [id, at] of this.#sessions) if (now - at >= sessionMs) this.#sessions.delete(id)
    }
  }

  #labelsOf(sessionId: string): PushLabels {
    let title: string | undefined
    try {
      title = this.#options.titles?.(sessionId)
    } catch {
      title = undefined
    }
    const workspace = this.#workspaces.get(sessionId)
    return {
      ...(title === undefined || title === '' ? {} : { title }),
      ...(workspace === undefined ? {} : { workspace }),
    }
  }
}
