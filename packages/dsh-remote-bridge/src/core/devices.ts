/**
 * The paired-device roster: `$DSH_HOME/remote-bridge/devices.json`.
 *
 * What is stored is deliberately not a credential. Each row keeps the device's
 * public key, its fingerprint, and the SHA-256 of the bearer token it was
 * issued — never the token itself, so a leaked roster file grants nothing. The
 * directory is 0700 and the file 0600, written through a temporary file plus
 * rename, and a file that cannot be parsed is moved aside instead of being
 * silently treated as an empty roster (which would quietly un-pair every phone
 * and then overwrite the evidence on the next write).
 * @module dsh-remote-bridge/core/devices
 */

import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { base64UrlEncode, constantTimeEqualText, fingerprintOfSpki, isP256Spki, randomBase64Url, tokenHash } from './crypto.ts'

/** Entropy of one device bearer token. */
export const DEVICE_TOKEN_BYTES = 32
/** Entropy of one device id. */
export const DEVICE_ID_BYTES = 12
/**
 * On-disk schema version of the roster file.
 *
 * 1 carried the six identity fields only; 2 adds the optional `push` block per
 * row (§28); 3 adds the optional `relayToken` inside that block, the credential the
 * hosted relay signs a delivery for instead of a local Apple key; 4 adds the
 * optional `relay` block beside it, the tier grant the phone handed over and when
 * this bridge received it. Every step is additive, so an older file reads as-is:
 * no row loses a field, every paired phone stays paired, and the file is rewritten
 * as the current version the next time anything is written. The reader therefore
 * accepts any version whose row table validates rather than quarantining a file it
 * merely does not recognise — a downgrade must never un-pair every phone.
 */
export const ROSTER_VERSION = 4

/** The APNs environments a device may register for. */
export type PushEnvironment = 'sandbox' | 'production'

/** One Live Activity push token, with the session the card belongs to. */
export interface PushLiveActivityToken {
  readonly activityId: string
  readonly token: string
  /**
   * The session this card belongs to (§29.9).
   *
   * A card is about one session, and a token without this field cannot be
   * addressed at all: this bridge has nothing to put on it. Absent is therefore
   * "never pushed to", not "pushed to with whatever is at hand" — the other
   * reading would put one session's state on another session's lock screen.
   */
  readonly sessionId?: string
}

/**
 * What one device registered so this bridge can notify it.
 *
 * Stored beside the device's identity in the same row: it is a fact about that
 * device, so it disappears with the row when the device is revoked and it never
 * becomes a second identity. Nothing here is a secret of the bridge's — an APNs
 * token is the phone's, and holding it grants nothing without the signing key,
 * which never touches this file.
 */
export interface PushRegistration {
  /** APNs device token, as the hex string the system handed the app. */
  readonly deviceToken: string
  readonly environment: PushEnvironment
  /** The app's bundle id, used verbatim as `apns-topic`. */
  readonly bundle: string
  readonly locale?: string
  readonly liveActivityTokens?: readonly PushLiveActivityToken[]
  /**
   * The bearer the hosted relay accepts for this device's fingerprint.
   *
   * The App obtains it from the account service, scoped to `(userId, fingerprint)`
   * and valid for 90 days, and hands it to this bridge through `push.register`. It
   * is what lets a machine with no Apple signing key still deliver §28's events: the
   * relay signs them with the key that never leaves the service. Absent is a phone
   * whose only route is this machine's own key, which is the pre-relay behaviour.
   */
  readonly relayToken?: string
  readonly registeredAt: number
}

/**
 * One device's relay tier grant (schema 4).
 *
 * The App obtains it from the account service and hands it over through
 * `relay.grant`. This bridge never mints, parses or reissues it: it keeps the text
 * and presents it in its next claim to the second meeting point, which decides the
 * entitlement out of band and answers the host with a lease or a refusal. Nothing
 * about the account crosses the wire back — the host learns "admitted" or "not",
 * never who the phone is.
 *
 * It is a fact about the phone that gave it, so it lives in that phone's row and
 * disappears with the row when the phone is revoked; it never becomes a second
 * identity of the bridge's own.
 */
export interface RelayGrant {
  /** The grant text, exactly as the account service issued it. */
  readonly grant: string
  /** When this bridge received it, in epoch seconds. */
  readonly receivedAt: number
}

/** One device a notification can be addressed to. */
export interface PushTargetView {
  readonly deviceId: string
  readonly push: PushRegistration
}

/** One paired device as the bridge keeps it. */
export interface DeviceRecord {
  readonly deviceId: string
  /** base64url SPKI of the device's P-256 key. */
  readonly pubKey: string
  /** SHA-256 hex of the SPKI DER: the human-comparable identity of the device. */
  readonly fingerprint: string
  readonly createdAt: number
  readonly lastSeenAt: number
  /**
   * The device's APNs registration, absent until it calls `push.register`.
   * A row without it is a paired phone that asks for no notification, which is
   * every phone that predates the channel.
   */
  readonly push?: PushRegistration
  /**
   * The device's relay tier grant, absent until it calls `relay.grant`.
   *
   * A row without it is a phone whose host may still claim the second meeting
   * point — a bridged lease needs no grant at the market edge — it just cannot be
   * admitted to a tier that requires one.
   */
  readonly relay?: RelayGrant
}

/** A roster row plus the one field that never leaves the file. */
interface StoredDevice extends DeviceRecord {
  readonly tokenHash: string
}

/** What one successful enrollment hands back to the caller exactly once. */
export interface EnrollmentResult {
  readonly deviceId: string
  /** The bearer token: returned to the enrolling connection and never persisted again. */
  readonly deviceToken: string
}

export interface DeviceRosterOptions {
  /** Absolute path of the roster file. */
  readonly file: string
  readonly now?: () => number
  readonly log?: (message: string) => void
}

/**
 * Read one row's `push` block.
 *
 * A malformed block is dropped rather than quarantining the file: the roster is
 * every paired phone, and one unreadable push token is not a reason to un-pair
 * them all. The row keeps its identity and simply asks for no notification.
 * @param value - the raw `push` field of a row.
 * @param log - where a dropped block is reported.
 * @returns the registration, or undefined when there is none to read.
 */
function pushOf(value: unknown, log: (message: string) => void): PushRegistration | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    log('a device row carries an unreadable push block; ignoring it and keeping the row')
    return undefined
  }
  const row = value as Record<string, unknown>
  const environment = row.environment
  if (typeof row.deviceToken !== 'string' || row.deviceToken === ''
    || typeof row.bundle !== 'string' || row.bundle === ''
    || (environment !== 'sandbox' && environment !== 'production')) {
    log('a device row carries an unreadable push block; ignoring it and keeping the row')
    return undefined
  }
  const liveActivityTokens = Array.isArray(row.liveActivityTokens)
    ? row.liveActivityTokens.filter((entry): entry is PushLiveActivityToken => {
      if (typeof entry !== 'object' || entry === null) return false
      const token = entry as Record<string, unknown>
      return typeof token.activityId === 'string' && token.activityId !== ''
        && typeof token.token === 'string' && token.token !== ''
    }).map((entry): PushLiveActivityToken => {
      // A session id this reader cannot trust is dropped rather than repaired: the
      // entry keeps its token and simply names no session, which is the state this
      // bridge never pushes to. One unreadable card is not a reason to un-pair a
      // phone, the same way one unreadable push block is not.
      const raw = (entry as unknown as Record<string, unknown>).sessionId
      return {
        activityId: entry.activityId,
        token: entry.token,
        ...(typeof raw === 'string' && raw !== '' ? { sessionId: raw } : {}),
      }
    })
    : undefined
  return {
    deviceToken: row.deviceToken,
    environment,
    bundle: row.bundle,
    ...(typeof row.locale === 'string' && row.locale !== '' ? { locale: row.locale } : {}),
    ...(liveActivityTokens === undefined ? {} : { liveActivityTokens }),
    ...(typeof row.relayToken === 'string' && row.relayToken !== '' ? { relayToken: row.relayToken } : {}),
    registeredAt: typeof row.registeredAt === 'number' ? row.registeredAt : 0,
  }
}

/**
 * Read one row's `relay` block.
 *
 * Dropped rather than quarantined for the reason `pushOf` is: one unreadable grant
 * is not a reason to un-pair every phone, and the row keeps its identity and simply
 * carries no admission. The two fields are the whole block — a grant text and the
 * epoch second it arrived in — so anything else on that object is discarded instead
 * of being handed on to a claim body.
 * @param value - the raw `relay` field of a row.
 * @param log - where a dropped block is reported.
 * @returns the grant, or undefined when there is none to read.
 */
function relayOf(value: unknown, log: (message: string) => void): RelayGrant | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    log('a device row carries an unreadable relay block; ignoring it and keeping the row')
    return undefined
  }
  const row = value as Record<string, unknown>
  if (typeof row.grant !== 'string' || row.grant === ''
    || typeof row.receivedAt !== 'number' || !Number.isFinite(row.receivedAt)) {
    log('a device row carries an unreadable relay block; ignoring it and keeping the row')
    return undefined
  }
  return { grant: row.grant, receivedAt: row.receivedAt }
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.deviceId === 'string' && row.deviceId !== ''
    && typeof row.pubKey === 'string' && row.pubKey !== ''
    && typeof row.fingerprint === 'string' && row.fingerprint !== ''
    && typeof row.tokenHash === 'string' && row.tokenHash !== ''
    && typeof row.createdAt === 'number'
    && typeof row.lastSeenAt === 'number'
}

/**
 * Which of several rows for one phone is the one that survives.
 *
 * The most recently seen row wins and a tie is settled by the later
 * `createdAt`: a pairing refreshes `lastSeenAt` on the row that is actually on
 * the wire, so that is the row holding the credential in use.
 * @param rows - rows that share one fingerprint.
 * @returns the row to keep, or undefined when there is none.
 */
function survivorOf(rows: readonly StoredDevice[]): StoredDevice | undefined {
  let survivor: StoredDevice | undefined
  for (const row of rows) {
    if (survivor === undefined || row.lastSeenAt > survivor.lastSeenAt
      || (row.lastSeenAt === survivor.lastSeenAt && row.createdAt > survivor.createdAt)) survivor = row
  }
  return survivor
}

/**
 * The persisted, revocable device roster.
 *
 * Revocation is a file edit: protocol v1 has no revoke method, so an operator
 * removes the row (or deletes the file) and restarts. The in-memory copy is
 * loaded once per process.
 *
 * One phone is one row. Pairing again replaces the credential on the row the
 * phone already has instead of adding a second one, and a table that still
 * carries duplicates is compacted when it is read.
 */
export class DeviceRoster {
  readonly #file: string
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #devices = new Map<string, StoredDevice>()
  #loaded: Promise<void> | undefined
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(options: DeviceRosterOptions) {
    this.#file = options.file
    this.#now = options.now ?? (() => Date.now())
    this.#log = options.log ?? (() => undefined)
  }

  /**
   * Read the roster once. A missing file is an empty roster; an unreadable or
   * malformed one is moved aside and reported, never silently zeroed.
   * @returns when the in-memory roster reflects the file.
   */
  load(): Promise<void> {
    this.#loaded ??= this.#read()
    return this.#loaded
  }

  /** @returns every paired device, without the token hash. */
  devices(): readonly DeviceRecord[] {
    return [...this.#devices.values()].map(({ tokenHash: _ignored, ...record }) => record)
  }

  /**
   * Resolve a bearer token to its device.
   * @returns the device, or undefined when the token is unknown.
   */
  authenticate(token: string): DeviceRecord | undefined {
    if (token === '') return undefined
    // The frozen design asks for a fixed-length comparison on the token path. A
    // Map lookup would compare the stored hash with the map's own early-exit
    // equality, so every row is compared instead — including after a match, so
    // the number of rows examined does not depend on which one matched. The
    // roster is a handful of phones, so the scan costs nothing.
    const presented = tokenHash(token)
    let matched: StoredDevice | undefined
    for (const row of this.#devices.values()) {
      if (constantTimeEqualText(row.tokenHash, presented)) matched = row
    }
    if (matched === undefined) return undefined
    const { tokenHash: _ignored, ...record } = matched
    return record
  }

  /**
   * Admit one device for a public key it has already proven possession of.
   * @param pubKey - base64url SPKI of the device's P-256 key.
   * @returns the enrollment, or undefined when the key is not an acceptable P-256 SPKI.
   */
  async enroll(pubKey: string): Promise<EnrollmentResult | undefined> {
    if (!isP256Spki(pubKey)) return undefined
    const fingerprint = fingerprintOfSpki(pubKey)
    if (fingerprint === undefined) return undefined
    // Pairing again is a new credential for a phone that is already here, not a
    // second phone: the same public key is the same fingerprint, so the rows it
    // already owns are settled first, the newest one kept and the rest dropped.
    const sameDevice = [...this.#devices.values()].filter(row => row.fingerprint === fingerprint)
    for (const row of sameDevice) this.#devices.delete(row.tokenHash)
    const survivor = survivorOf(sameDevice)
    const now = this.#now()
    const deviceId = `dev_${randomBase64Url(DEVICE_ID_BYTES)}`
    const token = base64UrlEncode(randomBytes(DEVICE_TOKEN_BYTES))
    const hash = tokenHash(token)
    if (survivor === undefined) {
      this.#devices.set(hash, { deviceId, pubKey, fingerprint, createdAt: now, lastSeenAt: now, tokenHash: hash })
      await this.#persist()
      return { deviceId, deviceToken: token }
    }
    // The row keeps its id, its creation time and its registration; only the
    // credential moves. The old map key went with the old token, so the token
    // this phone was issued before the pairing no longer authenticates it.
    const { tokenHash: _retired, ...kept } = survivor
    this.#devices.set(hash, { ...kept, lastSeenAt: now, tokenHash: hash })
    await this.#persist()
    return { deviceId: kept.deviceId, deviceToken: token }
  }

  /** Record that a device just reconnected; the file is refreshed at most once per call. */
  async touch(deviceId: string): Promise<void> {
    let touched: StoredDevice | undefined
    for (const row of this.#devices.values()) {
      if (row.deviceId !== deviceId) continue
      touched = { ...row, lastSeenAt: this.#now() }
      this.#devices.set(row.tokenHash, touched)
      break
    }
    if (touched !== undefined) await this.#persist()
  }

  /**
   * Record this device's APNs registration, replacing any it had.
   *
   * Registering twice is what a token rotation looks like from here, so this is
   * a plain overwrite rather than a merge: the newest complete registration is
   * the only one worth sending to, and a half-merged pair of rows would send to
   * a token the phone already retired.
   * @param deviceId - the device that just registered.
   * @param registration - what it registered.
   * @returns false when no such device is paired.
   */
  async registerPush(deviceId: string, registration: PushRegistration): Promise<boolean> {
    for (const [hash, row] of this.#devices) {
      if (row.deviceId !== deviceId) continue
      this.#devices.set(hash, { ...row, push: registration })
      await this.#persist()
      return true
    }
    return false
  }

  /**
   * Record the relay grant one device just handed over (schema 4).
   *
   * A grant the phone resends replaces the one on the row: the account service
   * reissues them periodically, and the newest text is the one the second meeting
   * point will verify against the current plan. Nothing else on the row moves, so a
   * grant that arrives between two reconnects cannot disturb a push registration.
   * @param deviceId - the device that sent `relay.grant`.
   * @param grant - the grant text as the account service issued it.
   * @returns false when no such device is paired.
   */
  async setRelayGrant(deviceId: string, grant: string): Promise<boolean> {
    // Epoch seconds, not milliseconds: the block crosses to the phone as the
    // protocol's own timestamps do, and a reader comparing it with a claim time
    // would otherwise disagree by three orders of magnitude.
    const receivedAt = Math.floor(this.#now() / 1000)
    for (const [hash, row] of this.#devices) {
      if (row.deviceId !== deviceId) continue
      this.#devices.set(hash, { ...row, relay: { grant, receivedAt } })
      await this.#persist()
      return true
    }
    return false
  }

  /**
   * @returns the relay grant this bridge claims with, or undefined when no row
   * holds one.
   *
   * The newest one wins, because one host holds one lease at the second meeting
   * point and the phone that most recently handed a grant over is the one whose
   * subscription is being claimed. A pairing with several phones of mixed tiers is
   * then the accepted asymmetry the design names: the host is admitted while at
   * least one paired phone holds a tier that is, and the free-tier phone simply
   * keeps using the market edge.
   */
  relayGrant(): RelayGrant | undefined {
    let newest: RelayGrant | undefined
    for (const row of this.#devices.values()) {
      const held = row.relay
      if (held === undefined) continue
      if (newest === undefined || held.receivedAt > newest.receivedAt) newest = held
    }
    return newest
  }

  /**
   * Forget one Live Activity token the phone no longer holds.
   *
   * APNs answers 410 (or 400 `BadDeviceToken`) for the token of a card the app
   * already ended, and such a token never works again: the next card arrives as a
   * new activity with a new token through `push.register`, which is a complete
   * replacement of this set. Dropping it here is therefore the whole recovery —
   * retrying would only repeat the same refusal (§29 token lifecycle).
   * @param activityId - the card the token belonged to.
   * @param token - the token APNs refused.
   * @returns whether any row changed.
   */
  async removeLiveActivityToken(activityId: string, token: string): Promise<boolean> {
    for (const [hash, row] of this.#devices) {
      const registration = row.push
      if (registration === undefined) continue
      const held = registration.liveActivityTokens
      if (held === undefined) continue
      const kept = held.filter(entry => !(entry.activityId === activityId && entry.token === token))
      if (kept.length === held.length) continue
      this.#devices.set(hash, { ...row, push: { ...registration, liveActivityTokens: kept } })
      await this.#persist()
      return true
    }
    return false
  }

  /**
   * Forget one device's notification registration for a token APNs will never
   * accept again.
   *
   * A dead alert token is the whole app install's refusal: the phone was restored,
   * reinstalled, or the token belongs to another environment or bundle, so the
   * Live Activity tokens that same install registered are dead by the same fact
   * and go with it. The next `push.register` — which a live app performs on launch
   * — writes a complete new block. The device itself stays paired: revoking a
   * phone is a roster edit, never something a push refusal may do.
   * @param deviceToken - the token APNs refused.
   * @returns whether any row changed.
   */
  async removePush(deviceToken: string): Promise<boolean> {
    for (const [hash, row] of this.#devices) {
      const registration = row.push
      if (registration === undefined || registration.deviceToken !== deviceToken) continue
      // Only the push block goes: a dead APNs token says nothing about the relay
      // grant the same phone handed over, which rides its own block on this row.
      const { push: _dropped, ...rest } = row
      this.#devices.set(hash, rest)
      await this.#persist()
      return true
    }
    return false
  }

  /** @returns every paired device that registered for notifications. */
  pushTargets(): readonly PushTargetView[] {
    const targets: PushTargetView[] = []
    for (const row of this.#devices.values()) {
      if (row.push === undefined) continue
      targets.push({ deviceId: row.deviceId, push: row.push })
    }
    return targets
  }

  /**
   * @returns every paired device that holds a relay token.
   *
   * The relay path's own reachability question: a row that registered an APNs
   * token before the relay existed is a phone this machine cannot notify without a
   * local key, so counting {@link pushTargets} there would claim a delivery that
   * has no route at all.
   */
  relayTargets(): readonly PushTargetView[] {
    return this.pushTargets().filter(({ push }) => push.relayToken !== undefined)
  }

  /**
   * Collapse what earlier enrollments left behind, in memory.
   *
   * Two rules, both saying one phone is one row. Rows are collapsed to one per
   * fingerprint first, because a table written before `enroll` reused a row
   * carries a row per pairing. Then an APNs token is kept on the row that
   * registered it last: a token belongs to the app install, so every other row
   * holding it is the same phone and would be a second delivery of the same
   * event. A row that loses its registration keeps its identity and simply asks
   * for no notification, exactly as {@link removePush} leaves it.
   * @returns how many rows and registrations this pass retired.
   */
  #compact(): { readonly rows: number; readonly registrations: number } {
    const phones = new Map<string, StoredDevice[]>()
    for (const row of this.#devices.values()) {
      const held = phones.get(row.fingerprint)
      if (held === undefined) phones.set(row.fingerprint, [row])
      else held.push(row)
    }
    let rows = 0
    for (const held of phones.values()) {
      if (held.length < 2) continue
      const survivor = survivorOf(held)
      if (survivor === undefined) continue
      for (const row of held) {
        if (row === survivor) continue
        this.#devices.delete(row.tokenHash)
        rows += 1
      }
      // A survivor that never registered takes the newest registration one of
      // its dropped rows carried: same phone, same install, same tokens. The
      // relay grant follows the same rule for the same reason — collapsing rows
      // must not withdraw an admission the phone already handed over.
      let newest: PushRegistration | undefined
      let newestGrant: RelayGrant | undefined
      for (const row of held) {
        if (row === survivor) continue
        if (row.push !== undefined && (newest === undefined || row.push.registeredAt > newest.registeredAt)) newest = row.push
        if (row.relay !== undefined && (newestGrant === undefined || row.relay.receivedAt > newestGrant.receivedAt)) newestGrant = row.relay
      }
      const push = survivor.push ?? newest
      const relay = survivor.relay ?? newestGrant
      if (push === survivor.push && relay === survivor.relay) continue
      this.#devices.set(survivor.tokenHash, {
        ...survivor,
        ...(push === undefined ? {} : { push }),
        ...(relay === undefined ? {} : { relay }),
      })
    }
    const holders = new Map<string, StoredDevice[]>()
    for (const row of this.#devices.values()) {
      const token = row.push?.deviceToken
      if (token === undefined) continue
      const held = holders.get(token)
      if (held === undefined) holders.set(token, [row])
      else held.push(row)
    }
    let registrations = 0
    for (const held of holders.values()) {
      if (held.length < 2) continue
      const keeper = held.reduce((best, row) => (row.push?.registeredAt ?? 0) > (best.push?.registeredAt ?? 0) ? row : best)
      for (const row of held) {
        if (row === keeper) continue
        if (this.#retirePush(row.tokenHash)) registrations += 1
      }
    }
    return { rows, registrations }
  }

  /**
   * Drop one row's registration and keep its identity.
   * @param hash - the map key of the row holding it.
   * @returns whether the row carried a registration to drop.
   */
  #retirePush(hash: string): boolean {
    const row = this.#devices.get(hash)
    if (row === undefined || row.push === undefined) return false
    const { push: _dropped, ...rest } = row
    this.#devices.set(hash, rest)
    return true
  }

  async #read(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.#file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.#log(`device roster ${this.#file} is unreadable (${String(error)}); continuing with an empty roster`)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      await this.#quarantine('is not JSON')
      return
    }
    const rows = (parsed as { devices?: unknown } | null)?.devices
    if (!Array.isArray(rows) || !rows.every(isStoredDevice)) {
      await this.#quarantine('has no valid device table')
      return
    }
    const declared = (parsed as { version?: unknown }).version
    if (typeof declared === 'number' && declared !== ROSTER_VERSION) {
      // Not an error and not a quarantine: the row table above already validated,
      // so an older file is read as the roster it is and written back as the
      // current schema on the next write.
      this.#log(`device roster ${this.#file} is schema ${declared}; reading it as ${ROSTER_VERSION}`)
    }
    for (const row of rows) {
      // The raw block is re-read per row instead of trusted from the guard, so a
      // row that carries an unreadable token keeps its identity and loses only
      // its notification. The relay grant takes the same route: a block this
      // reader cannot trust costs the row its admission, never its pairing.
      const { push: raw, relay: rawRelay, ...rest } = row as StoredDevice & {
        readonly push?: unknown
        readonly relay?: unknown
      }
      const push = pushOf(raw, this.#log)
      const relay = relayOf(rawRelay, this.#log)
      this.#devices.set(row.tokenHash, {
        ...rest,
        ...(push === undefined ? {} : { push }),
        ...(relay === undefined ? {} : { relay }),
      })
    }
    this.#log(`device roster ${this.#file}: ${rows.length} paired device(s)`)
    const compacted = this.#compact()
    if (compacted.rows === 0 && compacted.registrations === 0) return
    this.#log(`device roster ${this.#file}: compacted ${compacted.rows} duplicate row(s), retired ${compacted.registrations} stale registration(s)`)
    await this.#persist()
  }

  /** Move a corrupt roster aside so the failure survives and the next write cannot erase it. */
  async #quarantine(reason: string): Promise<void> {
    const target = `${this.#file}.corrupt-${this.#now()}`
    try {
      await rename(this.#file, target)
      this.#log(`device roster ${this.#file} ${reason}; moved to ${target} and starting empty`)
    } catch (error) {
      this.#log(`device roster ${this.#file} ${reason} and could not be moved aside (${String(error)}); starting empty`)
    }
  }

  /**
   * Write the roster atomically: same directory, 0600 from creation, flushed
   * before the rename so a crash cannot leave a truncated file in place.
   * Writes are serialized per roster so concurrent token retirement cannot race
   * the replacement (Windows rejects overlapping renames).
   */
  async #persist(): Promise<void> {
    const pending = this.#writeQueue.then(() => this.#write())
    this.#writeQueue = pending.catch(() => undefined)
    return pending
  }

  async #write(): Promise<void> {
    const directory = dirname(this.#file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const payload = JSON.stringify({ version: ROSTER_VERSION, devices: [...this.#devices.values()] }, null, 2)
    const temporary = `${this.#file}.${process.pid}.${randomBase64Url(6)}.tmp`
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, this.#file)
    // The mode is set at creation; the explicit chmod also covers a rename over
    // a pre-existing file with wider permissions.
    await chmod(this.#file, 0o600)
  }
}
