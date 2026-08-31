/**
 * Auto-tunnel manager: spawns a Cloudflare quick tunnel (`cloudflared
 * tunnel --url <local>`) through the `cloudflared` npm package — its
 * postinstall downloads the platform binary, so no user-side tooling is
 * involved — surfaces the minted `https://xxx.trycloudflare.com` URL, and
 * restarts the process after unexpected exits with exponential backoff.
 *
 * The cloudflared package's Tunnel is a thin spawn wrapper; this manager
 * owns the lifecycle policy (binary readiness, URL timeout, restart
 * backoff) around it. All seams — the tunnel factory, binary readiness,
 * timers — are injectable so the whole lifecycle is unit-testable without
 * a real binary or network.
 */

import { existsSync } from 'node:fs'
import { bin, install, Tunnel } from 'cloudflared'

/** The observable tunnel lifecycle the settings/panel surfaces render. */
export type TunnelPhase = 'stopped' | 'starting' | 'running' | 'failed'

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
  /** Spawn one quick tunnel toward the local target URL. */
  factory?: (targetUrl: string) => TunnelHandle
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

/** Default factory: the cloudflared package's quick tunnel (no account). */
function defaultFactory(targetUrl: string): TunnelHandle {
  // `--no-autoupdate`: the binary must never upgrade itself out from under
  // the manager (a self-updated binary would break the pinned lifecycle).
  // `--protocol http2`: the default `auto` prefers QUIC (UDP 7844), which
  // wedges on fake-ip TUN proxies and QUIC-hostile networks — the connector
  // holds the hostname but reports readyConnections: 0 forever (edge 1033),
  // and the auto fallback never fires on a half-open QUIC handshake. http2
  // rides TCP through the same paths reliably (verified live: auto stuck at
  // ready 0 on two fresh registrations; http2 ready immediately).
  return Tunnel.quick(targetUrl, { '--no-autoupdate': true, '--protocol': 'http2' })
}

/** Node timers. */
const nodeTimer = { setTimeout, clearTimeout }

/**
 * Own the lifecycle of one auto-tunnel: start/stop, URL surfacing, and
 * crash-restart backoff.
 */
export class TunnelManager {
  private readonly factory: (targetUrl: string) => TunnelHandle
  private readonly ensureBinary: () => Promise<void>
  private readonly urlTimeoutMs: number
  private readonly restartBaseMs: number
  private readonly restartMaxMs: number
  private readonly timer: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }

  private phase: TunnelPhase = 'stopped'
  private url: string | undefined
  private error: string | undefined
  private targetUrl: string | undefined
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
   * Start (or keep) a quick tunnel toward `targetUrl`. Restarting with a
   * different target tears the old tunnel down first; restarting with the
   * same target while running is a no-op.
   * @param targetUrl - the local URL to expose, e.g. `http://127.0.0.1:3080`.
   */
  start(targetUrl: string): void {
    if (this.targetUrl === targetUrl && (this.phase === 'starting' || this.phase === 'running')) return
    this.teardown()
    this.stopping = false
    this.targetUrl = targetUrl
    this.attempts = 0
    this.generation += 1
    this.attempt()
  }

  /** Stop the tunnel for good: no restarts, no state. */
  stop(): void {
    this.teardown()
    this.stopping = false
    this.targetUrl = undefined
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
    if (this.stopping || this.targetUrl === undefined) return
    const gen = this.generation
    this.setPhase('starting')
    this.handle = undefined
    this.url = undefined
    this.error = undefined
    void this.ensureBinary().then(() => {
      if (this.stopping || this.targetUrl === undefined || gen !== this.generation) return
      const handle = this.factory(this.targetUrl)
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
      if (this.stopping || this.targetUrl === undefined || gen !== this.generation) return
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
