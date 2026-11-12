/**
 * Pairing state machine: one active one-time token, a device-session table,
 * and presence tracking. Pure TypeScript with injected clock/randomness so
 * the whole security semantics are unit-testable without cordis. The
 * cordis-facing surfaces (routes, the api/gate listener) live next door.
 *
 * Security invariants:
 * - One active token at a time; `issue()` replaces it, so a refreshed QR
 *   immediately invalidates the previous link.
 * - A token is a bearer credential for its whole window: it is refused only
 *   when unknown, expired, or after `stop()`, and the same link may pair
 *   repeatedly within that window (each accept mints a fresh device session).
 *   Mobile flows routinely split across cookie contexts (camera preview to
 *   in-app browser to the system browser), and the later context must be
 *   able to complete its own pairing from the same link.
 * - Tokens expire; `accept()` on an expired token is refused like an
 *   unknown one (no oracle for validity).
 * - `stop()` revokes every device session and clears the token, so paired
 *   devices are cut off on their next gated request.
 * - `revoke()` drops one device session; idle sessions older than
 *   `idleExpireMs` are deleted on sweep, load, and the next gated request.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PostureHost, PostureSnapshot } from './posture.ts'
import { sameIngressFrame, type IngressSyncFrame } from './ingress-sync.ts'

/** The observable pairing phases the panel renders. */
export type PairingPhase =
  /** The server is not bound all-interfaces: no usable QR exists. */
  | 'lan-required'
  /** Remote control was stopped; a fresh QR (issue) re-enables it. */
  | 'stopped'
  /** A token is live and no device has paired with it yet. */
  | 'waiting'
  /** At least one paired device was active recently. */
  | 'connected'
  /** Devices are paired but none has been active within the offline window. */
  | 'disconnected'

/** One issued pairing token (keyed by its secret). */
export interface TokenRecord {
  /** Monotonic issue time (ms epoch), drives refresh ordering. */
  issuedAt: number
  /** Absolute expiry (ms epoch); accept() past this is refused. */
  expiresAt: number
  /** Opaque, non-secret identifier surfaced in snapshots (never the pairing secret). */
  id: string
  /** Workspace the QR link should land the phone in (optional). */
  workspaceId?: string
  /** LAN IP literal the QR link was built from (optional; default first). */
  address?: string
}

/**
 * Default idle-expiry window: 30 days without a heartbeat or a gated
 * request. The reopen service worker refreshes lastSeenAt on every
 * navigation it serves, so the window only runs out through genuine
 * disuse; 30 days matches the browser-credential lifetimes the surrounding
 * flow was built around, while the effective device lifetime stays shorter
 * than the 365-day cookie because of this sweep. Override per deployment
 * through the idleExpireMs config.
 */
export const DEFAULT_IDLE_EXPIRE_MS = 30 * 24 * 60 * 60 * 1000

/** Cap on the persisted/displayed User-Agent string. */
const MAX_USER_AGENT_CHARS = 180

/** Cap on a user-defined device name. */
const MAX_DEVICE_NAME_CHARS = 64

/** One paired device session, keyed by the device id stored in its cookie. */
export interface DeviceSession {
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last time the device passed a gated request or heartbeat. */
  lastSeenAt: number
  /** Sanitized User-Agent captured at accept (optional; missing on old files). */
  userAgent?: string
  /**
   * User-defined label shown instead of the User-Agent-derived name. Display
   * metadata only: it is never read by an authorization decision, and a
   * missing value keeps the derived-name fallback (optional; missing on old
   * files).
   */
  name?: string
}

/** One device row in a loopback snapshot (ids are session credentials). */
export interface DeviceSnapshot {
  /** Cookie value / session credential of this device. */
  id: string
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last heartbeat or gated request (ms epoch). */
  lastSeenAt: number
  /** Whether lastSeenAt is within the offline window. */
  online: boolean
  /** Sanitized User-Agent captured at accept, when known. */
  userAgent?: string
  /** User-defined label, when the operator renamed this device. */
  name?: string
}

/** One tunnel status frame (auto-tunnel only; undefined when disabled). */
export interface TunnelStatus {
  /** starting: binary/process warming up; running: URL minted; failed: no URL. */
  state: 'starting' | 'running' | 'failed'
  /** The minted public URL, once the tunnel reports it. */
  url?: string
  /** Human-readable failure detail. */
  error?: string
}

/**
 * One relay-registry status frame (undefined while the stable-origin relay
 * is not in play: autoTunnel off, or the relay toggle disabled).
 */
export interface RelayStatus {
  /** registering: a sync is in flight; running: the mapping is accepted. */
  state: 'off' | 'registering' | 'running' | 'failed'
  /** The stable relay origin (`https://<id>.dsh-market.com`). */
  url?: string
  /** Human-readable failure detail of the last sync attempt. */
  error?: string
}

/** One snapshot frame pushed to desktop status streams. */
export interface PairingSnapshot {
  phase: PairingPhase
  /** Whether the server bind is all-interfaces (a QR is constructible). */
  lanAvailable: boolean
  /** The LAN IP literals a QR can be built from (interface order). */
  lanAddresses: string[]
  /** Configured public (tunneled) base URL, when present. */
  publicUrl?: string
  /** Auto-tunnel status, while the auto-tunnel feature is active. */
  tunnel?: TunnelStatus
  /** Relay-registry status, while the stable-origin relay is in play. */
  relay?: RelayStatus
  /**
   * Update-only Cloudflare ingress sync status (issue #1948), once the feature
   * has been enabled in this process. The public hostname, the local port and
   * the two service strings are audit facts, not credentials.
   */
  ingress?: IngressSyncFrame
  /** Latest /api posture probe (undefined until the first round completes). */
  posture?: PostureSnapshot
  /** Opaque (non-secret) id of the active token (undefined when stopped/lan-required). */
  tokenId?: string
  /** Absolute expiry of the active token. */
  tokenExpiresAt?: number
  /** Count of ever-paired devices. */
  deviceCount: number
  /** Count of devices active within the offline window. */
  onlineCount: number
  /** Per-device roster for the loopback panel (never sent on /api/pair/status). */
  devices: DeviceSnapshot[]
}

/** Service tunables (config-validated upstream; plain numbers here). */
export interface PairingConfig {
  /** Token lifetime; the QR stops working after this. */
  tokenTtlMs: number
  /** A device is "online" while its lastSeenAt is newer than this. */
  offlineAfterMs: number
  /** Hard cap on paired device sessions (oldest-evicted when full). */
  maxDevices: number
  /** Cookie name carrying the device id. */
  cookieName: string
  /**
   * Idle sessions older than this are deleted (memory and disk). Defaults
   * to {@link DEFAULT_IDLE_EXPIRE_MS} when omitted.
   */
  idleExpireMs?: number
  /**
   * Path to a JSON file where paired device sessions are persisted. When
   * set, sessions survive process restarts (the phone keeps its 365-day
   * cookie), so re-pairing after a dsh web restart is not required. When
   * unset, sessions stay memory-only.
   */
  devicesFile?: string
}

/**
 * Result of one accept() attempt. A token is a bearer credential for its whole
 * window (see the module doc), so the only refusal is `invalid`: unknown,
 * expired, or after stop(). There is no "already used" outcome.
 */
export type AcceptResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'invalid' }

/**
 * Result of collapsing duplicate pairing records that one physical device
 * minted by pairing repeatedly. `not-duplicates` is a refusal, not a
 * no-op: the ids must name two or more live sessions sharing one User-Agent.
 */
export type MergeDevicesResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'unknown-device' | 'not-duplicates' }

/** Thrown by issue() for an address outside the sampled LAN literals. */
export class UnknownLanAddressError extends Error {
  /**
   * @param address - the offending literal.
   */
  constructor(address: string) {
    super(`remote-web-ui: unknown LAN address ${JSON.stringify(address)}`)
    this.name = 'UnknownLanAddressError'
  }
}

/** Clock and entropy injection for tests. */
export interface PairingClock {
  now(): number
  randomToken(): string
}

/** File-operation seam for the revocation-durability step (tests). */
export interface PairingFsSeams {
  /** Remove the stale device store (defaults to fs.rmSync with force). */
  removeFile?(path: string): void
}

/** Real clock/entropy: 32 random hex chars per token. */
export const defaultClock: PairingClock = {
  now: () => Date.now(),
  randomToken: () => randomBytes(16).toString('hex'),
}

/**
 * The pairing state machine. Structural mutations issue/accept/stop/revoke
 * and config updates (LAN bases, tunnel, posture) notify state listeners
 * after the commit point that makes them true, and notification dedupes
 * against the last emitted snapshot. Presence-only updates (touchDevice /
 * heartbeat) just mark the store dirty and broadcast on the next sweep,
 * which also surfaces time-driven transitions (a device aging offline)
 * without any mutation.
 */
export class PairingService {
  private readonly tokens = new Map<string, TokenRecord>()
  private readonly devices = new Map<string, DeviceSession>()
  private readonly listeners = new Set<(snapshot: PairingSnapshot) => void>()
  private lastEmitted: PairingSnapshot | undefined
  private stopped = false
  private tokenSerial = 0
  /** LAN base URLs keyed by the advertised IP literal (interface order). */
  private lanBases = new Map<string, string>()
  /** Public (tunneled) base URL, e.g. a Cloudflare Tunnel quick URL. */
  private publicBase: string | undefined
  /** Auto-tunnel status, while the auto-tunnel feature is active. */
  private tunnelStatus: TunnelStatus | undefined
  private relayStatus: RelayStatus | undefined
  private ingressStatus: IngressSyncFrame | undefined
  private posture: PostureSnapshot | undefined
  /** True when lastSeenAt changed since the last persist (flushed on sweep). */
  private dirty = false

  /**
   * @param config - tunables. The settings surface replaces the object (a
   * fresh literal) when a committed section changes; every operation reads
   * the current one.
   * @param clock - clock/entropy source (injectable for tests).
   */
  constructor(
    public config: PairingConfig,
    private readonly clock: PairingClock = defaultClock,
    private readonly fs: PairingFsSeams = {},
  ) {
    this.loadPersisted()
  }

  /**
   * Restore device sessions persisted by a previous process run. A corrupt
   * or missing file is tolerated (an empty device table, never a throw) —
   * persistence is an availability convenience, not a security boundary.
   *
   * Every still-valid session is restored, deliberately without applying
   * `maxDevices`: the constructor runs with whatever cap the configuration
   * layer has delivered so far (the schema default until the saved settings
   * row is applied), and trimming here would permanently drop authorizations
   * the user never revoked — the trimmed table reaches disk on the next
   * heartbeat/sweep write. The cap is enforced where a device is admitted
   * (see `accept`), against the configuration in force at that moment.
   */
  private loadPersisted(): void {
    const file = this.config.devicesFile
    if (file === undefined) return
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (typeof saved !== 'object' || saved === null) return
      for (const [deviceId, session] of Object.entries(saved)) {
        if (typeof deviceId !== 'string') continue
        if (typeof session !== 'object' || session === null) continue
        const { createdAt, lastSeenAt, userAgent, name } = session as {
          createdAt?: unknown
          lastSeenAt?: unknown
          userAgent?: unknown
          name?: unknown
        }
        if (typeof createdAt !== 'number' || typeof lastSeenAt !== 'number') continue
        const label = typeof userAgent === 'string' ? sanitizeUserAgent(userAgent) : undefined
        const customName = typeof name === 'string' ? sanitizeDeviceName(name) : undefined
        this.devices.set(deviceId, {
          createdAt,
          lastSeenAt,
          ...(label !== undefined ? { userAgent: label } : {}),
          ...(customName !== undefined ? { name: customName } : {}),
        })
      }
      if (this.evictIdle()) this.persistRevocation()
    } catch {
      // Unreadable/corrupt: start empty rather than refusing to boot.
    }
  }

  /** Drop sessions whose lastSeenAt is older than idleExpireMs. */
  private evictIdle(): boolean {
    const now = this.clock.now()
    const limit = this.config.idleExpireMs ?? DEFAULT_IDLE_EXPIRE_MS
    let removed = false
    for (const [id, session] of [...this.devices]) {
      if (now - session.lastSeenAt > limit) {
        this.devices.delete(id)
        removed = true
      }
    }
    return removed
  }

  /**
   * Write the current device table to the configured file. Called on the
   * mutation boundaries that change the set of live sessions (accept, stop,
   * revoke, idle eviction) and, throttled, from sweep() so lastSeenAt
   * survives a restart without a write per request.
   *
   * Device ids are session credentials (the gate authorizes requests by the
   * cookie's device id), so the file is written 0600 via a temp file and
   * atomic rename; a crash mid-write can never leave a half-written store.
   */
  private persist(): boolean {
    const file = this.config.devicesFile
    if (file === undefined) return true
    try {
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      const payload: Record<string, DeviceSession> = {}
      for (const [id, session] of this.devices) payload[id] = session
      writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 })
      renameSync(temp, file)
      this.dirty = false
      return true
    } catch (error) {
      console.error('remote-web-ui: failed to persist paired devices', error)
      return false
    }
  }

  /**
   * Persist a table change that REVOKES access (stop, per-device revoke, idle
   * eviction). A failed write would leave the revoked session on disk, and
   * {@link loadPersisted} restores that file verbatim on the next start — the
   * device's still-valid cookie would authorize again after an explicit
   * revocation. When the write cannot be made durable, the stale store is
   * removed instead (a missing file already loads as an empty table), so the
   * failure costs a re-pair rather than silently undoing the revocation.
   */
  private persistRevocation(): void {
    if (this.persist()) return
    const file = this.config.devicesFile
    if (file === undefined) return
    try {
      if (this.fs.removeFile !== undefined) this.fs.removeFile(file)
      else rmSync(file, { force: true })
      console.error('remote-web-ui: the device revocation could not be persisted; removed the stale device store so a restart cannot restore it')
    } catch (error) {
      console.error('remote-web-ui: the device revocation could not be persisted and the stale device store could not be removed', error)
    }
  }

  /** The default LAN base URL (the first interface; undefined when not LAN-reachable). */
  get lanBaseUrl(): string | undefined {
    return this.lanBases.values().next().value as string | undefined
  }

  /** The LAN base URL for one specific literal (undefined when not constructible). */
  lanBaseUrlFor(address: string): string | undefined {
    return this.lanBases.get(address)
  }

  /** The LAN IP literals QR links can be built from (interface order). */
  get lanAddresses(): string[] {
    return [...this.lanBases.keys()]
  }

  /** Set the LAN base URLs once the server bind is known (interface order). */
  setLanBases(entries: readonly { address: string; base: string }[]): void {
    this.lanBases = new Map(entries.map(entry => [entry.address, entry.base]))
    this.notify()
  }

  /** The configured public (tunneled) base URL, when present. */
  get publicBaseUrl(): string | undefined {
    return this.publicBase
  }

  /**
   * Set or clear the public base URL (a tunnel in front of this server). The
   * value is canonicalized to its origin: a trailing slash (what a browser
   * address-bar copy produces) or a path would mint a dead `//pair-accept`
   * link, which WHATWG resolves as an authority rather than a path.
   */
  setPublicBaseUrl(url: string | undefined): void {
    this.publicBase = url === undefined ? undefined : canonicalBaseUrl(url)
    this.notify()
  }

  /** Set or clear the auto-tunnel status frame (undefined when the feature is off). */
  setTunnelStatus(status: TunnelStatus | undefined): void {
    this.tunnelStatus = status
    this.notify()
  }

  /** Set or clear the relay-registry status frame (undefined when not in play). */
  setRelayStatus(status: RelayStatus | undefined): void {
    this.relayStatus = status
    this.notify()
  }

  /** Set or clear the ingress-sync status frame (undefined before it ever ran). */
  setIngressStatus(status: IngressSyncFrame | undefined): void {
    this.ingressStatus = status
    this.notify()
  }

  /** Set the latest /api posture probe result (see posture.ts). */
  setPosture(snapshot: PostureSnapshot | undefined): void {
    this.posture = snapshot
    this.notify()
  }

  /**
   * Issue a fresh token, replacing (invalidating) any previous one. A
   * stopped service re-arms through this call (the panel's refresh button).
   * @param workspaceId - optional workspace the QR link should land in.
   * @param address - optional LAN IP literal the QR must be built from; the
   * default is the public base (when configured) or the first interface.
   * Unknown addresses are refused.
   * @returns the token secret and its expiry.
   * @throws {Error} when no reachable base exists (no non-loopback bind and
   * no public base) — callers surface this as the lan-required state instead
   * of minting an unusable QR.
   */
  issue(workspaceId?: string, address?: string): { token: string; expiresAt: number } {
    // The rule lives in the bases the caller registered, not in this message:
    // a non-loopback bind (the wildcard where the host still accepts it, a
    // concrete interface literal where it does not — see lanBasesOf in
    // index.ts) or a public base is what makes a QR reachable. The message
    // keeps the wildcard wording only as the operator's most familiar form.
    if (this.lanBases.size === 0 && this.publicBase === undefined) {
      throw new Error('remote-web-ui: pairing requires a reachable bind (--host 0.0.0.0 or publicBaseUrl)')
    }
    if (address !== undefined && !this.lanBases.has(address)) {
      throw new UnknownLanAddressError(address)
    }
    const now = this.clock.now()
    const token = this.clock.randomToken()
    this.tokens.clear()
    this.stopped = false
    this.tokenSerial += 1
    this.tokens.set(token, {
      id: `t${this.tokenSerial}`,
      issuedAt: now,
      expiresAt: now + this.config.tokenTtlMs,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(address !== undefined ? { address } : {}),
    })
    this.notify()
    return { token, expiresAt: now + this.config.tokenTtlMs }
  }

  /**
   * Redeem a token and bind a device session. The token is a bearer
   * credential for its whole window, not a single-use nonce: it is refused
   * only when unknown, past its expiry, or after stop(), and every successful
   * call — including a repeat within the same window — mints a fresh device
   * session (see the module doc for the mobile cookie-context rationale).
   * @param token - the token secret from the QR link.
   * @param userAgent - optional User-Agent header captured at accept.
   * @returns the new device id, or a refusal code.
   */
  accept(token: string, userAgent?: string): AcceptResult {
    const record = this.tokens.get(token)
    if (record === undefined || this.stopped || this.clock.now() > record.expiresAt) {
      return { ok: false, code: 'invalid' }
    }
    const deviceId = this.clock.randomToken()
    const now = this.clock.now()
    // FIFO-evict until a slot is free. The loop (not a single delete) covers a
    // table that is already over the cap: restore keeps every persisted session
    // (see loadPersisted), so the excess is collected here, once the store is
    // actually asked to admit a new device, rather than at startup on a cap the
    // configuration may not have delivered yet.
    while (this.devices.size >= this.config.maxDevices) {
      let oldest: { id: string; createdAt: number } | undefined
      for (const [id, session] of this.devices) {
        if (oldest === undefined || session.createdAt < oldest.createdAt) oldest = { id, createdAt: session.createdAt }
      }
      if (oldest === undefined) break
      this.devices.delete(oldest.id)
    }
    const label = sanitizeUserAgent(userAgent)
    this.devices.set(deviceId, {
      createdAt: now,
      lastSeenAt: now,
      ...(label !== undefined ? { userAgent: label } : {}),
    })
    this.persist()
    this.notify()
    return { ok: true, deviceId }
  }

  /**
   * Stop remote control: revoke every device session and clear the token.
   * The phone's next gated /api request 403s; the panel falls back to
   * stopped until a fresh QR is issued.
   */
  stop(): void {
    this.tokens.clear()
    this.devices.clear()
    this.persistRevocation()
    this.stopped = true
    this.notify()
  }

  /**
   * Revoke one paired device. The next gated request from that cookie is
   * refused; other sessions stay live. Unknown ids are a no-op.
   * @param deviceId - the cookie value of the device to drop.
   * @returns true when a live session was removed.
   */
  revoke(deviceId: string): boolean {
    if (this.stopped) return false
    if (!this.devices.delete(deviceId)) return false
    this.persistRevocation()
    this.notify()
    return true
  }

  /**
   * Set or clear one device's user-defined name. The label is display
   * metadata only — the device id stays the sole credential — so renaming
   * never widens or narrows what that cookie can reach. A blank name clears
   * the label and restores the User-Agent-derived fallback.
   * @param deviceId - the cookie value of the device to rename.
   * @param name - the new label (cleared when blank after sanitizing).
   * @returns true when a live session was renamed.
   */
  rename(deviceId: string, name: string): boolean {
    const session = this.liveSession(deviceId)
    if (session === undefined) return false
    const cleaned = sanitizeDeviceName(name)
    if (cleaned === undefined) delete session.name
    else session.name = cleaned
    this.persist()
    this.notify()
    return true
  }

  /**
   * Collapse pairing records the operator identifies as one physical device:
   * keep the most recently active session and revoke the rest, so repeated
   * scans stop consuming `maxDevices` slots. The survivor keeps its own
   * name when it has one; otherwise it adopts a name from the records being
   * dropped, so collapsing never loses a label the operator typed.
   *
   * Pairing deliberately mints a session per accept (mobile cookie contexts
   * split), so this is an explicit operator action rather than an automatic
   * merge at accept: two different phones can present the same User-Agent,
   * and silently dropping one session would revoke a credential the user
   * never revoked.
   * @param deviceIds - the records to collapse (two or more).
   * @returns the surviving device id, or a refusal when the ids are not a
   *   same-User-Agent group of live sessions.
   */
  mergeDuplicates(deviceIds: readonly string[]): MergeDevicesResult {
    if (this.stopped) return { ok: false, code: 'unknown-device' }
    const ids = [...new Set(deviceIds)]
    if (ids.length < 2) return { ok: false, code: 'not-duplicates' }
    const sessions: DeviceSession[] = []
    for (const id of ids) {
      const session = this.devices.get(id)
      if (session === undefined) return { ok: false, code: 'unknown-device' }
      sessions.push(session)
    }
    // One User-Agent is the whole duplicate-group definition the panel uses;
    // refusing a mixed set keeps this from becoming a bulk-revoke shortcut
    // for rows the operator never grouped together.
    if (new Set(sessions.map(session => session.userAgent ?? '')).size !== 1) {
      return { ok: false, code: 'not-duplicates' }
    }
    let keep = 0
    for (let index = 1; index < ids.length; index += 1) {
      const candidate = sessions[index]!
      const current = sessions[keep]!
      if (candidate.lastSeenAt > current.lastSeenAt
        || (candidate.lastSeenAt === current.lastSeenAt && candidate.createdAt < current.createdAt)) {
        keep = index
      }
    }
    const survivor = sessions[keep]!
    if (survivor.name === undefined) {
      const inherited = sessions.find(session => session.name !== undefined)?.name
      if (inherited !== undefined) survivor.name = inherited
    }
    const keptId = ids[keep]!
    for (const id of ids) {
      if (id !== keptId) this.devices.delete(id)
    }
    this.persistRevocation()
    this.notify()
    return { ok: true, deviceId: keptId }
  }

  /**
   * The api/gate path: record activity for a device id and report whether
   * the request may proceed. Unknown or revoked ids (including any device
   * after stop() or idle expiry) are refused.
   *
   * Presence refreshes are throttled on purpose: every gated request (and
   * the mobile SSE keepalive) lands here, so a broadcast per call would fan
   * a full snapshot out to every status stream on the hot path. The refresh
   * only updates lastSeenAt and marks the store dirty; the snapshot reaches
   * listeners at the next sweep() (structural changes notify immediately).
   * @param deviceId - the cookie value of the requesting device.
   * @returns true when the device session is live and was refreshed.
   */
  touchDevice(deviceId: string): boolean {
    const session = this.liveSession(deviceId)
    if (session === undefined) return false
    session.lastSeenAt = this.clock.now()
    this.dirty = true
    return true
  }

  /** Explicit presence heartbeat (the phone's client sends these). */
  heartbeat(deviceId: string): boolean {
    return this.touchDevice(deviceId)
  }

  /**
   * Periodic sweep: drop idle sessions, flush a dirty lastSeenAt, and
   * re-evaluate the derived snapshot (a device aging past the offline
   * window flips the phase to disconnected). Emits only when the snapshot
   * actually changed.
   */
  sweep(): void {
    const evicted = this.evictIdle()
    if (evicted) this.persistRevocation()
    else if (this.dirty) this.persist()
    this.notify()
  }

  /** The current snapshot (fresh object per call — stable between emits). */
  snapshot(): PairingSnapshot {
    const now = this.clock.now()
    const devices = [...this.devices.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .map(([id, session]) => this.toDeviceSnapshot(id, session, now))
    const onlineCount = devices.filter(device => device.online).length
    const token = this.activeToken()
    return {
      phase: this.derivePhase(onlineCount, token !== undefined),
      lanAvailable: this.lanBases.size > 0,
      lanAddresses: [...this.lanBases.keys()],
      ...(this.publicBase !== undefined ? { publicUrl: this.publicBase } : {}),
      ...(this.tunnelStatus !== undefined ? { tunnel: this.tunnelStatus } : {}),
      ...(this.relayStatus !== undefined ? { relay: this.relayStatus } : {}),
      ...(this.ingressStatus !== undefined ? { ingress: this.ingressStatus } : {}),
      ...(this.posture !== undefined ? { posture: this.posture } : {}),
      ...(token !== undefined ? { tokenId: token.record.id, tokenExpiresAt: token.record.expiresAt } : {}),
      deviceCount: this.devices.size,
      onlineCount,
      devices,
    }
  }

  /** Whether a cookie value names a currently live (non-idle) device session. */
  hasDevice(deviceId: string): boolean {
    return this.liveSession(deviceId) !== undefined
  }

  /**
   * Number of device sessions in the table, including idle ones whose idle
   * window has not been swept yet. Restore keeps every persisted session
   * (see `loadPersisted`), so this can exceed the configured cap until the
   * next `accept` trims the excess.
   */
  deviceCount(): number {
    return this.devices.size
  }

  /** Subscribe to snapshot changes (each emit passes a fresh snapshot). */
  onState(listener: (snapshot: PairingSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private activeToken(): { token: string; record: TokenRecord } | undefined {
    for (const [token, record] of this.tokens) {
      if (this.stopped) return undefined
      if (this.clock.now() > record.expiresAt) continue
      return { token, record }
    }
    return undefined
  }

  /**
   * Return a live session, deleting it first when idle-expired. Side-effecting
   * so a stale cookie cannot pass the gate between sweeps.
   */
  private liveSession(deviceId: string): DeviceSession | undefined {
    if (this.stopped) return undefined
    const session = this.devices.get(deviceId)
    if (session === undefined) return undefined
    const limit = this.config.idleExpireMs ?? DEFAULT_IDLE_EXPIRE_MS
    if (this.clock.now() - session.lastSeenAt > limit) {
      this.devices.delete(deviceId)
      this.persistRevocation()
      this.notify()
      return undefined
    }
    return session
  }

  private toDeviceSnapshot(id: string, session: DeviceSession, now: number): DeviceSnapshot {
    return {
      id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      online: this.isOnlineAt(session, now),
      ...(session.userAgent !== undefined ? { userAgent: session.userAgent } : {}),
      ...(session.name !== undefined ? { name: session.name } : {}),
    }
  }

  private derivePhase(onlineCount: number, hasToken: boolean): PairingPhase {
    if (this.lanBases.size === 0 && this.publicBase === undefined) return 'lan-required'
    if (this.stopped) return 'stopped'
    if (onlineCount > 0) return 'connected'
    if (this.devices.size > 0) return 'disconnected'
    if (hasToken) return 'waiting'
    return 'stopped'
  }

  private isOnlineAt(session: DeviceSession, now: number): boolean {
    return now - session.lastSeenAt <= this.config.offlineAfterMs
  }

  private notify(): void {
    const snapshot = this.snapshot()
    if (this.lastEmitted !== undefined && snapshotsEqual(this.lastEmitted, snapshot)) return
    this.lastEmitted = snapshot
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        // A throwing subscriber must not break the emit loop or the caller.
        console.error('remote-web-ui: pairing state listener failed', error)
      }
    }
  }
}

/** Structural equality over the snapshot's wire fields. */
function snapshotsEqual(a: PairingSnapshot, b: PairingSnapshot): boolean {
  return a.phase === b.phase
    && a.lanAvailable === b.lanAvailable
    && sameStrings(a.lanAddresses, b.lanAddresses)
    && a.publicUrl === b.publicUrl
    && tunnelEqual(a.tunnel, b.tunnel)
    && relayEqual(a.relay, b.relay)
    && ingressEqual(a.ingress, b.ingress)
    && postureEqual(a.posture, b.posture)
    && a.tokenId === b.tokenId
    && a.tokenExpiresAt === b.tokenExpiresAt
    && a.deviceCount === b.deviceCount
    && a.onlineCount === b.onlineCount
    && devicesEqual(a.devices, b.devices)
}

/** Per-device roster equality (order is pairing time). */
function devicesEqual(a: readonly DeviceSnapshot[], b: readonly DeviceSnapshot[]): boolean {
  return a.length === b.length && a.every((device, index) => {
    const other = b[index]
    return other !== undefined
      && device.id === other.id
      && device.createdAt === other.createdAt
      && device.lastSeenAt === other.lastSeenAt
      && device.online === other.online
      && device.userAgent === other.userAgent
      && device.name === other.name
  })
}

/** Tunnel frame equality (undefined equals undefined; fields compared shallowly). */
function tunnelEqual(a: TunnelStatus | undefined, b: TunnelStatus | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.state === b.state && a.url === b.url && a.error === b.error)
}

/**
 * Ingress frame equality: the audit state, not the timestamp. A re-read that
 * proves the same convergence must not emit a second snapshot.
 * @param a - one frame (or undefined).
 * @param b - the other frame (or undefined).
 * @returns whether both describe the same audit state.
 */
function ingressEqual(a: IngressSyncFrame | undefined, b: IngressSyncFrame | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return sameIngressFrame(a, b)
}

/** Relay frame equality (same shape as the tunnel frame). */
function relayEqual(a: RelayStatus | undefined, b: RelayStatus | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.state === b.state && a.url === b.url && a.error === b.error)
}

/**
 * Posture equality. A probe round can change this frame while every other field
 * stays put — the common case, since the probe re-runs on a settings change and
 * on a tunnel reaching running, and a quick-tunnel restart churns the probed
 * host set. Leaving the frame out of the comparison suppressed those emits, so
 * the loopback SSE stream and the desktop panel could sit on a stale "exposed"
 * (or stale "clean") verdict for as long as the phase and roster stayed put.
 */
function postureEqual(a: PostureSnapshot | undefined, b: PostureSnapshot | undefined): boolean {
  if (a === b) return true
  // A frame that is not an object at all (a hand-built context can pass
  // anything) counts as changed instead of throwing out of the setter.
  if (!isPostureFrame(a) || !isPostureFrame(b)) return false
  return a.checkedAt === b.checkedAt && hostsEqual(a.hosts, b.hosts)
}

/** Whether a value has the shape a posture frame is compared on. */
function isPostureFrame(value: unknown): value is PostureSnapshot {
  return typeof value === 'object' && value !== null
}

/**
 * Per-host posture equality (a round's verdicts, in probe order). Tolerates a
 * frame that is not the expected shape: this runs inside the emit path, outside
 * the listener error containment, so a malformed snapshot handed in by another
 * host-fiber caller must degrade to "changed" instead of throwing out of the
 * setter that produced it.
 */
function hostsEqual(a: readonly PostureHost[] | undefined, b: readonly PostureHost[] | undefined): boolean {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return a.length === b.length && a.every((host, index) => {
    const other = b[index]
    return isPostureHost(host) && isPostureHost(other) && host.host === other.host && host.exposed === other.exposed
  })
}

/** Whether a value has the shape one probed host is compared on. */
function isPostureHost(value: unknown): value is PostureHost {
  return typeof value === 'object' && value !== null
}

/** Element-wise string list equality (interface order is meaningful). */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Canonical origin of a public base URL. An unparsable value is returned
 * verbatim so the caller's malformed-base warning stays the single owner of
 * that case.
 * @param url - the configured public base.
 */
export function canonicalBaseUrl(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** Strip control characters and cap the User-Agent stored with a session. */
export function sanitizeUserAgent(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return sanitizeLabel(raw, MAX_USER_AGENT_CHARS)
}

/**
 * Strip control characters and cap a user-defined device name. A blank result
 * clears the label (undefined), restoring the User-Agent-derived fallback.
 * @param raw - the operator's input.
 * @returns the cleaned label, or undefined when nothing visible remains.
 */
export function sanitizeDeviceName(raw: string): string | undefined {
  return sanitizeLabel(raw, MAX_DEVICE_NAME_CHARS)
}

/** Shared cleaner: collapse whitespace/control characters, cap, and blank-to-undefined. */
function sanitizeLabel(raw: string, max: number): string | undefined {
  // oxlint-disable-next-line no-control-regex -- folding control characters into spaces IS the cleaner.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return undefined
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max)
}
