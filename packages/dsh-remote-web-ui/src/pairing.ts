/**
 * Pairing state machine: one active one-time token, a device-session table,
 * and presence tracking. Pure TypeScript with injected clock/randomness so
 * the whole security semantics are unit-testable without cordis. The
 * cordis-facing surfaces (routes, the api/gate listener) live next door.
 *
 * Security invariants:
 * - One active token at a time; `issue()` replaces it, so a refreshed QR
 *   immediately invalidates the previous link.
 * - A token is consumed by the first successful `accept()` — reuse is
 *   refused with `'used'`.
 * - Tokens expire; `accept()` on an expired token is refused like an
 *   unknown one (no oracle for validity).
 * - `stop()` revokes every device session and clears the token, so paired
 *   devices are cut off on their next gated request.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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

/** One paired device session, keyed by the device id stored in its cookie. */
export interface DeviceSession {
  /** Pairing time (ms epoch). */
  createdAt: number
  /** Last time the device passed a gated request or heartbeat. */
  lastSeenAt: number
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
  /** Opaque (non-secret) id of the active token (undefined when stopped/lan-required). */
  tokenId?: string
  /** Absolute expiry of the active token. */
  tokenExpiresAt?: number
  /** Count of ever-paired devices. */
  deviceCount: number
  /** Count of devices active within the offline window. */
  onlineCount: number
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
   * Path to a JSON file where paired device sessions are persisted. When
   * set, sessions survive process restarts (the phone keeps its 365-day
   * cookie), so re-pairing after a dsh web restart is not required. When
   * unset (default), sessions stay memory-only — the previous behavior.
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
 * The pairing state machine. All mutations notify state listeners after the
 * commit point that makes them true, and notification dedupes against the
 * last emitted snapshot — time-driven transitions (a device aging offline)
 * surface on the next sweep without any mutation.
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
        const { createdAt, lastSeenAt } = session as { createdAt?: unknown; lastSeenAt?: unknown }
        if (typeof createdAt !== 'number' || typeof lastSeenAt !== 'number') continue
        this.devices.set(deviceId, { createdAt, lastSeenAt })
      }
    } catch {
      // Unreadable/corrupt: start empty rather than refusing to boot.
    }
  }

  /**
   * Write the current device table to the configured file. Called on the
   * mutation boundaries that change the set of live sessions (accept and
   * stop); `lastSeenAt` refreshes are deliberately not persisted here so a
   * per-request write storm is avoided — after a restart the phone's first
   * heartbeat re-warms its own session.
   */
  private persist(): void {
    const file = this.config.devicesFile
    if (file === undefined) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(Object.fromEntries(this.devices)))
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
   * @returns the new device id, or a refusal code.
   */
  accept(token: string): AcceptResult {
    const record = this.tokens.get(token)
    if (record === undefined || record.consumed || this.stopped || this.clock.now() > record.expiresAt) {
      return { ok: false, code: record?.consumed === true ? 'used' : 'invalid' }
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
    this.devices.set(deviceId, { createdAt: now, lastSeenAt: now })
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
   * The api/gate path: record activity for a device id and report whether
   * the request may proceed. Unknown or revoked ids (including any device
   * after stop()) are refused.
   * @param deviceId - the cookie value of the requesting device.
   * @returns true when the device session is live and was refreshed.
   */
  touchDevice(deviceId: string): boolean {
    const session = this.devices.get(deviceId)
    if (session === undefined || this.stopped) return false
    session.lastSeenAt = this.clock.now()
    this.notify()
    return true
  }

  /** Explicit presence heartbeat (the phone's client sends these). */
  heartbeat(deviceId: string): boolean {
    return this.touchDevice(deviceId)
  }

  /**
   * Periodic sweep: re-evaluate the derived snapshot (a device aging past
   * the offline window flips the phase to disconnected). Emits only when
   * the snapshot actually changed.
   */
  sweep(): void {
    this.notify()
  }

  /** The current snapshot (fresh object per call — stable between emits). */
  snapshot(): PairingSnapshot {
    const now = this.clock.now()
    const onlineCount = [...this.devices.values()].filter(session => this.isOnlineAt(session, now)).length
    const token = this.activeToken()
    return {
      phase: this.derivePhase(onlineCount, token !== undefined),
      lanAvailable: this.lanBases.size > 0,
      lanAddresses: [...this.lanBases.keys()],
      ...(this.publicBase !== undefined ? { publicUrl: this.publicBase } : {}),
      ...(this.tunnelStatus !== undefined ? { tunnel: this.tunnelStatus } : {}),
      ...(token !== undefined ? { tokenId: token.record.id, tokenExpiresAt: token.record.expiresAt } : {}),
      deviceCount: this.devices.size,
      onlineCount,
    }
  }

  /** Whether a cookie value names a currently live device session. */
  hasDevice(deviceId: string): boolean {
    const session = this.devices.get(deviceId)
    return session !== undefined && !this.stopped
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
