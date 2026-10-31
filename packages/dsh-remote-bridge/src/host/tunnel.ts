/**
 * Auto-tunnel manager: spawns a Cloudflare tunnel through the `cloudflared`
 * npm package — its postinstall downloads the platform binary and the
 * readiness policy below validates it and re-fetches when it cannot run (the
 * desktop payload stages one tree for every shipped OS/arch), so no
 * user-side tooling is involved — surfaces the public URL, and restarts the
 * process after unexpected exits with exponential backoff. Two modes: the
 * accountless quick tunnel (`https://xxx.trycloudflare.com`, hostname minted
 * per start) and an account named tunnel (`cloudflared tunnel run --token`,
 * fixed public hostname — the mode that lets a paired phone keep its
 * bookmark and pairing cookie across restarts).
 *
 * The cloudflared package's Tunnel is a thin spawn wrapper; this manager
 * owns the lifecycle policy (binary readiness, URL timeout, restart
 * backoff, and the public-URL readiness watchdog) around it. All seams — the
 * tunnel factory, binary readiness, the URL probe, timers — are injectable
 * so the whole lifecycle is unit-testable without a real binary or network.
 *
 * 'running' is not a terminal state: the connector can lose its edge
 * registration while the process keeps living, which leaves a hostname that
 * no longer resolves. The watchdog below probes the public URL of a running
 * tunnel and reuses the crash-restart path when it stops answering, so the
 * relay is re-registered against a freshly minted URL instead of proxying a
 * dead one (issue #1723).
 *
 * A host crash is the one exit the manager cannot cover in-process: the child
 * is reparented and keeps running, holding a hostname nobody serves. Every
 * spawn is therefore recorded under the DSH home (pid plus its exact command
 * line) and the record is dropped when that child is stopped, so the next
 * start reaps exactly the child a dead host left behind — see
 * ./tunnel-orphan.ts.
 */

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { bin, install, Tunnel } from 'cloudflared'
import { createTunnelChildGuard, type TunnelChildGuard, type TunnelChildProcess } from './tunnel-orphan.ts'

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
  | { kind: 'quick'; targetUrl: string; originHostHeader?: string }
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
  /** The spawned OS process, when the wrapper exposes it. */
  readonly process?: TunnelChildProcess
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
  // The named process is a spawn wrapper too: pass its OS process through so
  // crash recovery records this child exactly like a quick one.
  if (inner.process !== undefined) handle.process = inner.process
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
  /**
   * The spawned OS process. Crash recovery records its pid and exact command
   * line, so a host that dies without stopping it can be reaped by the next
   * start; a handle that does not expose one is simply never recorded.
   */
  process?: TunnelChildProcess
}

/**
 * Probe one public tunnel URL from the host. Resolves true when the URL is
 * served (any HTTP answer below 500 — a harness without credentials answers
 * 401/403, which is a healthy round trip), false for a DNS failure, a refused
 * connection, a timeout, or a Cloudflare 5xx (530 "Origin DNS error" / 1033)
 * — the shapes a tunnel that lost its edge registration produces.
 *
 * The probe must never reject: the watchdog reads a rejection as a dead
 * tunnel and restarts on it, so a local programming error would otherwise
 * recycle working tunnels forever.
 * @param url - the tunnel's public URL.
 * @param timeoutMs - how long one probe may take.
 * @returns whether the URL answered as a live origin.
 */
export async function probeTunnelUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    })
    // Drain so the connection is reusable instead of half-read.
    await response.body?.cancel().catch(() => undefined)
    return response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Default probe: the real network round trip. */
async function defaultProbe(url: string, timeoutMs: number): Promise<boolean> {
  return await probeTunnelUrl(url, timeoutMs)
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
  /** Probe one public URL; false means the tunnel stopped answering. */
  probe?: (url: string, timeoutMs: number) => Promise<boolean>
  /** How often to probe the public URL of a running tunnel (0 disables it). */
  healthCheckIntervalMs?: number
  /** Consecutive probe failures after which the tunnel is restarted. */
  healthCheckFailures?: number
  /** How long one probe may take. */
  probeTimeoutMs?: number
  /**
   * Crash recovery for the spawned child: reap the leftover a crashed host
   * recorded, and record this one. Defaults to the file-backed guard under the
   * DSH home (see ./tunnel-orphan.ts).
   */
  orphan?: TunnelChildGuard
}

/** Time box for the `--version` probe that validates a staged binary. */
const BINARY_PROBE_TIMEOUT_MS = 10_000

/**
 * Probe whether the binary at `path` actually executes on this machine. The
 * desktop payload stages one dependency tree for every shipped OS/arch, so a
 * binary can exist with the wrong architecture (the arm64 darwin
 * `bin/cloudflared` on an x64 mac); existence alone must not skip the
 * reinstall.
 */
export function binaryRuns(executable: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, ['--version'], { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolvePromise(false)
    }, BINARY_PROBE_TIMEOUT_MS)
    child.once('error', () => { clearTimeout(timer); resolvePromise(false) })
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code === 0) })
  })
}

/** Injectable seams of the default binary readiness (tests swap them all). */
export interface BinaryReadinessSeams {
  exists?: (path: string) => boolean
  runs?: (executable: string) => Promise<boolean>
  install?: (path: string) => Promise<unknown>
}

/**
 * Build the default readiness policy over a binary path: skip when the
 * binary has already proven runnable in this process, validate an existing
 * file before trusting it (a stale or wrong-arch binary must not disable
 * the reinstall), and re-fetch the current platform binary otherwise.
 */
export function createBinaryReadiness(executable: string, seams: BinaryReadinessSeams = {}): () => Promise<void> {
  const exists = seams.exists ?? existsSync
  const runs = seams.runs ?? binaryRuns
  const installBinary = seams.install ?? install
  const validated = new Set<string>()
  let installs = 0
  let lastFailure: Error | undefined
  return async () => {
    if (validated.has(executable)) return
    // The manager retries forever with backoff, so a permanently unrunnable
    // binary must not re-download the whole platform archive on every attempt
    // (a wrong-arch payload would otherwise fetch it once per restart round).
    // A transient install failure still gets its retries; past the cap the
    // remembered error is rethrown until the process restarts.
    if (installs >= MAX_BINARY_INSTALL_ATTEMPTS && lastFailure !== undefined) throw lastFailure
    if (exists(executable) && await runs(executable)) {
      validated.add(executable)
      return
    }
    installs += 1
    try {
      await installBinary(executable)
      if (!(await runs(executable))) {
        throw new Error(`the cloudflared binary at ${executable} still does not run after the reinstall`)
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error : new Error(String(error))
      throw lastFailure
    }
    validated.add(executable)
  }
}

/** How many archive downloads one process may attempt before giving up. */
export const MAX_BINARY_INSTALL_ATTEMPTS = 3

/** How often a running tunnel's public URL is probed (issue #1723). */
export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000
/** Consecutive failed probes before the tunnel is declared dead. */
export const DEFAULT_HEALTH_CHECK_FAILURES = 2
/** How long one public-URL probe may take. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000

/** The readiness policy the manager uses by default: the package's real binary path. */
const defaultBinaryReadiness = createBinaryReadiness(bin)

/** Default binary readiness: keep a working platform binary at `bin`. */
async function defaultEnsureBinary(): Promise<void> {
  await defaultBinaryReadiness()
}

/** The flags every tunnel mode shares (see the quick factory comment). */
const SHARED_TUNNEL_FLAGS = { '--no-autoupdate': true, '--protocol': 'http2' } as const

/**
 * Spawn flags for one quick target. `originHostHeader` stamps the Host the
 * local webserver sees: the Workers relay cannot control the origin-side Host
 * at all (fetch forces it to the URL authority), so a caller that needs one
 * exact public origin restamps it here. What any trust fence or pairing rule
 * makes of that Host is not this module's responsibility.
 */
export function quickTunnelFlags(originHostHeader?: string): Record<string, string | boolean> {
  return originHostHeader === undefined
    ? { ...SHARED_TUNNEL_FLAGS }
    : { ...SHARED_TUNNEL_FLAGS, '--http-host-header': originHostHeader }
}

/**
 * Command-line arguments for a named tunnel. The account token is deliberately
 * NOT part of the argv: `--token <t>` would expose an account credential to any
 * local user through ps/proc for the whole tunnel lifetime, while the flag's own
 * environment variable (TUNNEL_TOKEN, see cloudflared's tunnel run flags) is not
 * readable that way. Note: `--no-autoupdate` and `--protocol` are flags for the
 * `tunnel` command and must appear BEFORE the `run` subcommand. Putting them
 * after `run` causes cloudflared to exit immediately with "flag provided but not
 * defined: -no-autoupdate" (issues #1432, #1433).
 */
export function namedTunnelArgs(): string[] {
  return ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run']
}

/**
 * Run one spawn call with TUNNEL_TOKEN set, restoring the previous value
 * afterwards. The cloudflared package's Tunnel spawns with the inherited
 * environment inside its constructor, so the variable only has to exist for
 * that call; the child keeps its own copy of the environment.
 * @param token - the named-tunnel token.
 * @param spawnTunnel - the call that creates the child process.
 * @returns whatever the spawn call returns.
 */
export function withTunnelTokenEnv<T>(token: string, spawnTunnel: () => T): T {
  const previous = process.env.TUNNEL_TOKEN
  process.env.TUNNEL_TOKEN = token
  try {
    return spawnTunnel()
  } finally {
    if (previous === undefined) delete process.env.TUNNEL_TOKEN
    else process.env.TUNNEL_TOKEN = previous
  }
}

/** Spawn one named tunnel without putting its token in the child's argv. */
function spawnNamedTunnel(token: string): NamedTunnelProcess {
  return withTunnelTokenEnv(token, () => new Tunnel(namedTunnelArgs()))
}

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
    return Tunnel.quick(target.targetUrl, quickTunnelFlags(target.originHostHeader))
  }
  return namedTunnelHandle(spawnNamedTunnel(target.token), target.publicUrl)
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
  private readonly probe: (url: string, timeoutMs: number) => Promise<boolean>
  private readonly healthCheckIntervalMs: number
  private readonly healthCheckFailures: number
  private readonly probeTimeoutMs: number
  private readonly orphan: TunnelChildGuard

  private phase: TunnelPhase = 'stopped'
  private url: string | undefined
  private error: string | undefined
  private target: TunnelTarget | undefined
  private handle: TunnelHandle | undefined
  private urlTimer: unknown | undefined
  private restartTimer: unknown | undefined
  private healthTimer: unknown | undefined
  private healthFailures = 0
  private attempts = 0
  // Whether the current handler owns the crash-recovery record: only a record
  // this manager wrote is ever cleared.
  private recordedChild = false
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
    this.probe = options.probe ?? defaultProbe
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
    this.healthCheckFailures = options.healthCheckFailures ?? DEFAULT_HEALTH_CHECK_FAILURES
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    this.orphan = options.orphan ?? createTunnelChildGuard()
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
    void this.ensureBinary().then(async () => {
      // A host that died without tearing its tunnel down left its child
      // recorded; reap exactly that process before a second connector is
      // spawned beside it. The reap settles before the spawn by design.
      await this.reapLeftoverChild()
      if (this.stopping || this.target === undefined || gen !== this.generation) return
      const handle = this.factory(this.target)
      this.handle = handle
      // Recorded as the first thing after the spawn: a crash from here on
      // leaves a child the next start can identify and reap.
      this.recordedChild = this.orphan.record(handle.process)
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
    // The URL is out; from here the connector can still lose its edge
    // registration without the process exiting, so readiness is supervised.
    this.startHealthWatch(value)
    for (const listener of this.urlListeners) {
      try {
        listener(value)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }

  /**
   * Watch the readiness of a running tunnel. cloudflared can keep its process
   * (and its metrics port) alive while every edge connection is gone, leaving
   * a minted hostname that no longer resolves: the manager used to report
   * 'running' forever and the relay kept forwarding to that dead address, so
   * the phone hit Cloudflare 1016 instead of the relay's offline page
   * (issue #1723). A bounded number of consecutive probe failures ends the
   * attempt through the ordinary fail/backoff path, which mints a new URL and
   * re-announces the relay.
   */
  private startHealthWatch(url: string): void {
    this.stopHealthWatch()
    // A phase listener may have stopped the tunnel or replaced its target
    // while this URL was being announced; only a live running phase schedules.
    if (this.stopping || this.phase !== 'running') return
    if (this.healthCheckIntervalMs <= 0 || this.healthCheckFailures <= 0) return
    this.healthFailures = 0
    const schedule = (): void => {
      this.healthTimer = this.timer.setTimeout(() => {
        this.healthTimer = undefined
        void this.healthCheck(url)
      }, this.healthCheckIntervalMs)
    }
    schedule()
  }

  /** One probe round of the running tunnel's public URL. */
  private async healthCheck(url: string): Promise<void> {
    // The tunnel may have been stopped, failed, or replaced while the probe
    // was in flight; only a still-running tunnel toward this same URL is
    // judged by the result.
    if (this.stopping || this.phase !== 'running' || this.url !== url) return
    let alive = false
    try {
      alive = await this.probe(url, this.probeTimeoutMs)
    } catch {
      alive = false
    }
    if (this.stopping || this.phase !== 'running' || this.url !== url) return
    if (alive) {
      this.healthFailures = 0
    } else {
      this.healthFailures += 1
      if (this.healthFailures >= this.healthCheckFailures) {
        this.fail('the tunnel stopped answering on its public URL')
        return
      }
    }
    this.healthTimer = this.timer.setTimeout(() => {
      this.healthTimer = undefined
      void this.healthCheck(url)
    }, this.healthCheckIntervalMs)
  }

  /** Cancel the readiness watchdog (teardown, restart, stop). */
  private stopHealthWatch(): void {
    if (this.healthTimer !== undefined) {
      this.timer.clearTimeout(this.healthTimer)
      this.healthTimer = undefined
    }
    this.healthFailures = 0
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
    this.stopHandle()
    if (this.urlTimer !== undefined) {
      this.timer.clearTimeout(this.urlTimer)
      this.urlTimer = undefined
    }
    this.stopHealthWatch()
    this.setPhase('failed')
    this.attempts += 1
    const delay = Math.min(this.restartBaseMs * 2 ** (this.attempts - 1), this.restartMaxMs)
    this.restartTimer = this.timer.setTimeout(() => {
      this.restartTimer = undefined
      this.attempt()
    }, delay)
  }

  /**
   * Reap the child a crashed host recorded (see ./tunnel-orphan.ts). A failed
   * recovery only loses the cleanup, so it must never fail the attempt.
   */
  private async reapLeftoverChild(): Promise<void> {
    try {
      await this.orphan.reap()
    } catch (error) {
      console.warn(`remote-bridge: could not clear a leftover tunnel child (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  /**
   * Stop the current child and drop its crash-recovery record: the process the
   * record describes is gone, so a later start must not reap it again (and a
   * healthy host never reaps its own live child).
   */
  private stopHandle(): void {
    if (this.handle === undefined) return
    const handle = this.handle
    this.handle = undefined
    try {
      handle.stop()
    } finally {
      // Only a record this manager wrote is ours to drop: a record a sibling
      // host still owns (another profile under one DSH home) is left alone.
      if (this.recordedChild) {
        this.recordedChild = false
        this.orphan.clear()
      }
    }
  }

  /** Stop the current process and cancel every pending timer (no phase change). */
  private teardown(): void {
    this.stopping = true
    this.stopHealthWatch()
    if (this.urlTimer !== undefined) {
      this.timer.clearTimeout(this.urlTimer)
      this.urlTimer = undefined
    }
    if (this.restartTimer !== undefined) {
      this.timer.clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    this.stopHandle()
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
