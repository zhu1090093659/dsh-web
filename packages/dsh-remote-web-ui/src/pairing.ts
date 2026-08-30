/**
 * Pairing state machine: one active one-time token, a device-session table,
 * and presence tracking. Pure TypeScript with injected clock/randomness so
 * the whole security semantics are unit-testable without cordis. The
 * cordis-facing surfaces (routes, the api/gate listener) live next door.
 *
 * Security invariants:
 * - One active token at a time; `issue()` replaces it, so a refreshed QR
 *   immediately invalidates the previous link.
 * - A token stays re-usable until it expires or is replaced: the first
 *   successful `accept()` marks it consumed, but the same link may pair
 *   again within the window (each re-accept mints a fresh device session).
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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PostureSnapshot } from './posture.ts'

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
  /** Consumed by the first successful accept(). */
  consumed: boolean
  /** Opaque, non-secret identifier surfaced in snapshots (never the pairing secret). */
  id: string
  /** Workspace the QR link should land the phone in (optional). */
  workspaceId?: string
  /** LAN IP literal the QR link was built from (optional; default first). */
  address?: string
}

/** Default idle-expiry window: 7 days without heartbeat or a gated request. */
export const DEFAULT_IDLE_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000

/** Cap on the persisted/displayed User-Agent string. */
const MAX_USER_AGENT_CHARS = 180

/** One paired device session, keyed by the device id stored in its cookie. */
export interface DeviceSession {
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last time the device passed a gated request or heartbeat. */
  lastSeenAt: number
  /** Sanitized User-Agent captured at accept (optional; missing on old files). */
  userAgent?: string
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

/** Result of one accept() attempt. */
export type AcceptResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'invalid' | 'used' }

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
  ) {
    this.loadPersisted()
  }

  /**
   * Restore device sessions persisted by a previous process run. A corrupt
   * or missing file is tolerated (an empty device table, never a throw) —
   * persistence is an availability convenience, not a security boundary.
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
        const { createdAt, lastSeenAt, userAgent } = session as {
          createdAt?: unknown
          lastSeenAt?: unknown
          userAgent?: unknown
        }
        if (typeof createdAt !== 'number' || typeof lastSeenAt !== 'number') continue
        const label = typeof userAgent === 'string' ? sanitizeUserAgent(userAgent) : undefined
        this.devices.set(deviceId, {
          createdAt,
          lastSeenAt,
          ...(label !== undefined ? { userAgent: label } : {}),
        })
      }
      this.clampToMaxDevices()
      if (this.evictIdle()) this.persist()
    } catch {
      // Unreadable/corrupt: start empty rather than refusing to boot.
    }
  }

  /** FIFO-cap the device table (a persisted file may outlive a lowered cap). */
  private clampToMaxDevices(): void {
    if (this.devices.size <= this.config.maxDevices) return
    const overflow = this.devices.size - this.config.maxDevices
    const ordered = [...this.devices.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (const [id] of ordered.slice(0, overflow)) this.devices.delete(id)
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
  private persist(): void {
    const file = this.config.devicesFile
    if (file === undefined) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      const payload: Record<string, DeviceSession> = {}
      for (const [id, session] of this.devices) payload[id] = session
      writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 })
      renameSync(temp, file)
      this.dirty = false
    } catch (error) {
      console.error('remote-web-ui: failed to persist paired devices', error)
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

  /** Set or clear the public base URL (a tunnel in front of this server). */
  setPublicBaseUrl(url: string | undefined): void {
    this.publicBase = url
    this.notify()
  }

  /** Set or clear the auto-tunnel status frame (undefined when the feature is off). */
  setTunnelStatus(status: TunnelStatus | undefined): void {
    this.tunnelStatus = status
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
   * @throws {Error} when no reachable base exists (no all-interfaces bind and
   * no public base) — callers surface this as the lan-required state instead
   * of minting an unusable QR.
   */
  issue(workspaceId?: string, address?: string): { token: string; expiresAt: number } {
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
      consumed: false,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(address !== undefined ? { address } : {}),
    })
    this.notify()
    return { token, expiresAt: now + this.config.tokenTtlMs }
  }

  /**
   * Consume a token and bind a device session. One-time: the second
   * successful call for the same token is impossible because the first
   * consumes it.
   * @param token - the token secret from the QR link.
   * @param userAgent - optional User-Agent header captured at accept.
   * @returns the new device id, or a refusal code.
   */
  accept(token: string, userAgent?: string): AcceptResult {
    const record = this.tokens.get(token)
    // A consumed token stays a valid bearer credential until expiry or
    // replacement (see the module doc): re-accept mints a fresh device.
    if (record === undefined || this.stopped || this.clock.now() > record.expiresAt) {
      return { ok: false, code: 'invalid' }
    }
    record.consumed = true
    const deviceId = this.clock.randomToken()
    const now = this.clock.now()
    if (this.devices.size >= this.config.maxDevices) {
      // Evict the oldest session (FIFO) before binding a new device.
      let oldest: { id: string; createdAt: number } | undefined
      for (const [id, session] of this.devices) {
        if (oldest === undefined || session.createdAt < oldest.createdAt) oldest = { id, createdAt: session.createdAt }
      }
      if (oldest !== undefined) this.devices.delete(oldest.id)
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
    this.persist()
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
    this.persist()
    this.notify()
    return true
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
    if (evicted || this.dirty) this.persist()
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
      this.persist()
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
  })
}

/** Tunnel frame equality (undefined equals undefined; fields compared shallowly). */
function tunnelEqual(a: TunnelStatus | undefined, b: TunnelStatus | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.state === b.state && a.url === b.url && a.error === b.error)
}

/** Element-wise string list equality (interface order is meaningful). */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** Strip control characters and cap the User-Agent stored with a session. */
export function sanitizeUserAgent(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return undefined
  return cleaned.length <= MAX_USER_AGENT_CHARS ? cleaned : cleaned.slice(0, MAX_USER_AGENT_CHARS)
}
