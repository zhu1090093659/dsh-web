/**
 * Auto-tunnel manager: spawns a Cloudflare tunnel through the `cloudflared`
 * npm package — its postinstall downloads the platform binary, so no
 * user-side tooling is involved — surfaces the public URL, and restarts the
 * process after unexpected exits with exponential backoff. Two modes: the
 * accountless quick tunnel (`https://xxx.trycloudflare.com`, hostname minted
 * per start) and an account named tunnel (`cloudflared tunnel run --token`,
 * fixed public hostname — the mode that lets a paired phone keep its
 * bookmark and pairing cookie across restarts).
 *
 * The cloudflared package's Tunnel is a thin spawn wrapper; this manager
 * owns the lifecycle policy (binary readiness, URL timeout, restart
 * backoff) around it. All seams — the tunnel factory, binary readiness,
 * timers — are injectable so the whole lifecycle is unit-testable without
 * a real binary or network.
 */

import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { bin, install, Tunnel } from 'cloudflared'

/** The observable tunnel lifecycle the settings/panel surfaces render. */
export type TunnelPhase = 'stopped' | 'starting' | 'running' | 'failed'

/**
 * What the manager should run. `quick` is the accountless trycloudflare
 * tunnel whose hostname is minted per start (and dies with the process);
 * `named` is an account tunnel whose public hostname is fixed — the point
 * of the named mode is that a paired phone keeps its bookmark and its
 * pairing cookie across restarts.
 */
export type TunnelTarget =
  | { kind: 'quick'; targetUrl: string }
  | { kind: 'named'; token: string; publicUrl: string }

/** Compare two targets for the start idempotence check. */
function sameTarget(left: TunnelTarget | undefined, right: TunnelTarget): boolean {
  if (left === undefined) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

/** The event face the named adapter wraps (a cloudflared package Tunnel). */
interface NamedTunnelProcess {
  on(event: 'connected', listener: () => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (value: Error) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  stop(): boolean
}

/**
 * Wrap a named-tunnel process so it fits the quick-tunnel handle shape: the
 * fixed public URL is reported through the same `url` event once the first
 * edge connection registers (cloudflared fires `connected` per connection,
 * so only the first is taken), and exit/error pass through. The manager's
 * URL timeout, crash-restart backoff, and stop semantics then stay fully
 * mode-agnostic.
 * @param inner - the running named-tunnel process.
 * @param publicUrl - the fixed public hostname ingress maps to this server.
 * @returns a handle emitting `url` once the tunnel is reachable.
 */
export function namedTunnelHandle(inner: NamedTunnelProcess, publicUrl: string): TunnelHandle {
  const handle = new EventEmitter() as unknown as TunnelHandle & {
    emit(event: string, ...args: any[]): boolean
  }
  let registered = false
  const onConnected = (): void => {
    // cloudflared fires `connected` per edge connection (four on a healthy
    // registration); the fixed URL only needs reporting once.
    if (registered) return
    registered = true
    handle.emit('url', publicUrl)
  }
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    handle.emit('exit', code, signal)
  }
  const onError = (value: Error): void => {
    handle.emit('error', value)
  }
  inner.on('connected', onConnected)
  inner.on('exit', onExit)
  inner.on('error', onError)
  handle.stop = (): boolean => {
    inner.off('connected', onConnected)
    inner.off('exit', onExit)
    inner.off('error', onError)
    return inner.stop()
  }
  return handle
}

/** One tunnel status frame. */
export interface TunnelInfo {
  phase: TunnelPhase
  /** The minted public URL, once the tunnel reports it. */
  url?: string
  /** Human-readable failure detail (binary install, URL timeout, spawn error). */
  error?: string
}

/** The tunnel handle subset this manager uses (the package's Tunnel fits). */
export interface TunnelHandle {
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  stop(): boolean
}

/** Injectable seams (defaults are the real cloudflared package + node timers). */
export interface TunnelManagerOptions {
  /** Spawn one tunnel process for the target (quick or named). */
  factory?: (target: TunnelTarget) => TunnelHandle
  /** Make sure the cloudflared binary exists, downloading it when absent. */
  ensureBinary?: () => Promise<void>
  /** Wait up to this long for the tunnel URL before failing the attempt. */
  urlTimeoutMs?: number
  /** First restart delay after an unexpected failure (exponential base). */
  restartBaseMs?: number
  /** Cap on the exponential restart delay. */
  restartMaxMs?: number
  /** Timer source (injected in tests). */
  timer?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
}

/** Default binary readiness: download the platform binary on first use. */
async function defaultEnsureBinary(): Promise<void> {
  if (existsSync(bin)) return
  await install(bin)
}

/** The flags every tunnel mode shares (see the quick factory comment). */
const SHARED_TUNNEL_FLAGS = { '--no-autoupdate': true, '--protocol': 'http2' } as const

/** Default factory: the cloudflared package's quick and named tunnels. */
function defaultFactory(target: TunnelTarget): TunnelHandle {
  // `--no-autoupdate`: the binary must never upgrade itself out from under
  // the manager (a self-updated binary would break the pinned lifecycle).
  // `--protocol http2`: the default `auto` prefers QUIC (UDP 7844), which
  // wedges on fake-ip TUN proxies and QUIC-hostile networks — the connector
  // holds the hostname but reports readyConnections: 0 forever (edge 1033),
  // and the auto fallback never fires on a half-open QUIC handshake. http2
  // rides TCP through the same paths reliably (verified live: auto stuck at
  // ready 0 on two fresh registrations; http2 ready immediately).
  if (target.kind === 'quick') {
    return Tunnel.quick(target.targetUrl, { ...SHARED_TUNNEL_FLAGS })
  }
  return namedTunnelHandle(Tunnel.withToken(target.token, { ...SHARED_TUNNEL_FLAGS }), target.publicUrl)
}

/** Node timers. */
const nodeTimer = { setTimeout, clearTimeout }

/**
 * Own the lifecycle of one auto-tunnel: start/stop, URL surfacing, and
 * crash-restart backoff.
 */
export class TunnelManager {
  private readonly factory: (target: TunnelTarget) => TunnelHandle
  private readonly ensureBinary: () => Promise<void>
  private readonly urlTimeoutMs: number
  private readonly restartBaseMs: number
  private readonly restartMaxMs: number
  private readonly timer: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }

  private phase: TunnelPhase = 'stopped'
  private url: string | undefined
  private error: string | undefined
  private target: TunnelTarget | undefined
  private handle: TunnelHandle | undefined
  private urlTimer: unknown | undefined
  private restartTimer: unknown | undefined
  private attempts = 0
  // Generation counter: a stale ensureBinary resolution from an earlier
  // start() must not spawn a second handle after a stop/start cycle.
  private generation = 0
  private stopping = false
  private readonly urlListeners = new Set<(url: string) => void>()
  private readonly phaseListeners = new Set<(info: TunnelInfo) => void>()

  /**
   * @param options - seams; defaults spawn the real quick tunnel.
   */
  constructor(options: TunnelManagerOptions = {}) {
    this.factory = options.factory ?? defaultFactory
    this.ensureBinary = options.ensureBinary ?? defaultEnsureBinary
    this.urlTimeoutMs = options.urlTimeoutMs ?? 30_000
    this.restartBaseMs = options.restartBaseMs ?? 5_000
    this.restartMaxMs = options.restartMaxMs ?? 60_000
    this.timer = options.timer ?? nodeTimer
  }

  /** The current status frame. */
  get info(): TunnelInfo {
    return {
      phase: this.phase,
      ...(this.url !== undefined ? { url: this.url } : {}),
      ...(this.error !== undefined ? { error: this.error } : {}),
    }
  }

  /**
   * Start (or keep) a tunnel toward `target`. Restarting with a different
   * target tears the old tunnel down first; restarting with the same target
   * while running is a no-op. A string is the quick mode's local target URL.
   *
   * In quick mode the URL surfaces when cloudflared mints the ephemeral
   * trycloudflare hostname; in named mode the fixed `publicUrl` surfaces
   * once the first edge connection registers (see {@link namedTunnelHandle}).
   * @param target - what to run (a string means quick toward that local URL).
   */
  start(target: TunnelTarget | string): void {
    const resolved: TunnelTarget = typeof target === 'string' ? { kind: 'quick', targetUrl: target } : target
    if (sameTarget(this.target, resolved) && (this.phase === 'starting' || this.phase === 'running')) return
    this.teardown()
    this.stopping = false
    this.target = resolved
    this.attempts = 0
    this.generation += 1
    this.attempt()
  }

  /** Stop the tunnel for good: no restarts, no state. */
  stop(): void {
    this.teardown()
    this.stopping = false
    this.target = undefined
    this.setPhase('stopped')
  }

  /** Alias of {@link stop} for plugin-effect disposal. */
  dispose(): void {
    this.stop()
  }

  /** Subscribe to minted tunnel URLs (fire-and-forget duplicates dropped). */
  onUrl(listener: (url: string) => void): () => void {
    this.urlListeners.add(listener)
    return () => { this.urlListeners.delete(listener) }
  }

  /** Subscribe to every phase change. */
  onPhase(listener: (info: TunnelInfo) => void): () => void {
    this.phaseListeners.add(listener)
    return () => { this.phaseListeners.delete(listener) }
  }

  private attempt(): void {
    if (this.stopping || this.target === undefined) return
    const gen = this.generation
    this.setPhase('starting')
    this.handle = undefined
    this.url = undefined
    this.error = undefined
    void this.ensureBinary().then(() => {
      if (this.stopping || this.target === undefined || gen !== this.generation) return
      const handle = this.factory(this.target)
      this.handle = handle
      this.urlTimer = this.timer.setTimeout(() => {
        // The tunnel never reported a URL: kill it and retry with backoff.
        this.fail('timed out waiting for the tunnel URL')
      }, this.urlTimeoutMs)
      handle.on('url', (value: string) => {
        if (this.handle !== handle) return
        this.handleUrl(value)
      })
      handle.on('exit', () => {
        if (this.handle !== handle) return
        this.handleExit()
      })
      handle.on('error', (value: unknown) => {
        // Spawn/connection errors usually precede an exit; the exit path owns
        // restart, this only records diagnostics while the process still lives.
        if (this.handle !== handle || this.phase !== 'starting') return
        this.error = value instanceof Error ? value.message : String(value)
      })
    }).catch((value: unknown) => {
      // Binary install failed (no network, no platform build): report it.
      if (this.stopping || this.target === undefined || gen !== this.generation) return
      const message = value instanceof Error ? value.message : String(value)
      this.fail(`could not obtain the cloudflared binary: ${message}`)
    })
  }

  private handleUrl(value: string): void {
    if (this.urlTimer !== undefined) {
      this.timer.clearTimeout(this.urlTimer)
      this.urlTimer = undefined
    }
    this.url = value
    this.error = undefined
    this.attempts = 0
    this.setPhase('running')
    for (const listener of this.urlListeners) {
      try {
        listener(value)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }

  private handleExit(): void {
    // The exit handler is detached during teardown, so reaching this point
    // means an unexpected death: fail the current phase and schedule a retry.
    if (this.stopping) return
    this.fail('the tunnel process exited unexpectedly')
  }

  private fail(message: string): void {
    if (this.stopping) return
    this.url = undefined
    this.error = message
    if (this.handle !== undefined) {
      this.handle.stop()
      this.handle = undefined
    }
    if (this.urlTimer !== undefined) {
      this.timer.clearTimeout(this.urlTimer)
      this.urlTimer = undefined
    }
    this.setPhase('failed')
    this.attempts += 1
    const delay = Math.min(this.restartBaseMs * 2 ** (this.attempts - 1), this.restartMaxMs)
    this.restartTimer = this.timer.setTimeout(() => {
      this.restartTimer = undefined
      this.attempt()
    }, delay)
  }

  /** Stop the current process and cancel every pending timer (no phase change). */
  private teardown(): void {
    this.stopping = true
    if (this.urlTimer !== undefined) {
      this.timer.clearTimeout(this.urlTimer)
      this.urlTimer = undefined
    }
    if (this.restartTimer !== undefined) {
      this.timer.clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    if (this.handle !== undefined) {
      this.handle.stop()
      this.handle = undefined
    }
  }

  private setPhase(phase: TunnelPhase): void {
    this.phase = phase
    const info = this.info
    for (const listener of this.phaseListeners) {
      try {
        listener(info)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }
}
