/**
 * The SSH engine facade: a per-alias persistent connection pool (ssh2) with
 * multi-hop jump support, command execution, PTY shells, SFTP transfers,
 * local port-forward tunnels and cluster execution. The heavy lifting lives
 * in the engine/ modules (connection-pool, pty, sftp, tunnel, cluster); this
 * class composes them behind one new SshEngine instance per plugin apply.
 */

import type { ClusterResult, ExecResult, SshHostSummary, TestResult, TransferProgress, TunnelInfo } from './protocol.ts'
import type { HostStore } from './store.ts'
import {
  DEFAULTS,
  execCommand,
  disposeRecord,
  sweepPool,
  type EngineOptions,
  type PoolRecord,
} from './engine/connection-pool.ts'
import { openShell, type ShellSession } from './engine/pty.ts'
import { download, ls, upload } from './engine/sftp.ts'
import { listTunnels, startTunnel, stopAllTunnels, stopTunnel, type TunnelRecord } from './engine/tunnel.ts'
import { cluster } from './engine/cluster.ts'

export type { EngineOptions } from './engine/connection-pool.ts'
export type { ShellSession } from './engine/pty.ts'
export type { PoolRecord } from './engine/connection-pool.ts'
export type { TunnelRecord } from './engine/tunnel.ts'

/**
 * The engine. Owns the pool, tunnels, and all operations. One instance per
 * plugin apply; dispose() closes every connection.
 */
export class SshEngine {
  readonly store: HostStore
  readonly opts: Required<EngineOptions>
  readonly pool = new Map<string, PoolRecord>()
  readonly acquireQueue = new Map<string, Promise<PoolRecord>>()
  readonly tunnels = new Map<string, TunnelRecord>()
  nextTunnelId = 1
  private sweepTimer: NodeJS.Timeout | undefined

  /**
   * @param store - the host config store.
   * @param options - engine knobs (defaults applied).
   */
  constructor(store: HostStore, options?: EngineOptions) {
    this.store = store
    this.opts = { ...DEFAULTS, ...options }
    this.sweepTimer = setInterval(() => sweepPool(this), Math.max(10_000, this.opts.idleTimeoutMs / 4))
    this.sweepTimer.unref?.()
  }

  // ---------------------------------------------------------------- config

  /** Secret-free host list (filtered by the optional query). */
  list(query?: string): SshHostSummary[] {
    const needle = query?.trim().toLowerCase()
    return this.store.list()
      .filter(entry => needle === undefined || needle === ''
        || entry.alias.toLowerCase().includes(needle)
        || (entry.description ?? '').toLowerCase().includes(needle)
        || entry.host.toLowerCase().includes(needle)
        || entry.tags.some(tag => tag.toLowerCase().includes(needle)))
      .map(entry => this.store.summarize(entry))
  }

  /** One host summary by alias. */
  find(alias: string): SshHostSummary | undefined {
    const entry = this.store.find(alias)
    return entry === undefined ? undefined : this.store.summarize(entry)
  }

  // ------------------------------------------------------------ exec

  /** Run one command on `alias` (reusing the pooled connection). */
  async exec(alias: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    return execCommand(this, alias, command, timeoutMs)
  }

  /** Run one command against many hosts concurrently. */
  async cluster(options: {
    command: string
    aliases?: string[]
    environment?: string
    tags?: string[]
    timeoutMs?: number
    maxWorkers?: number
  }): Promise<ClusterResult[]> {
    return cluster(this, options)
  }

  // -------------------------------------------------------------- shell

  /** Open a PTY shell session for the web terminal (standalone connection). */
  async openShell(alias: string, size: { cols: number; rows: number }): Promise<ShellSession> {
    return openShell(this, alias, size)
  }

  // -------------------------------------------------------------- sftp

  /** Upload one local file (or directory tree) to a remote path. */
  async upload(alias: string, localPath: string, remotePath: string, recursive: boolean, onProgress?: (progress: TransferProgress) => void): Promise<{ bytes: number; files: number }> {
    return upload(this, alias, localPath, remotePath, recursive, onProgress)
  }

  /** Download one remote file to a local path. */
  async download(alias: string, remotePath: string, localPath: string, onProgress?: (progress: TransferProgress) => void): Promise<{ bytes: number }> {
    return download(this, alias, remotePath, localPath, onProgress)
  }

  /** List a remote directory (file browser). */
  async ls(alias: string, path: string): Promise<import('./protocol.ts').RemoteDirEntry[]> {
    return ls(this, alias, path)
  }

  // ------------------------------------------------------------- tunnel

  /** Start a local port-forward tunnel (listens on 127.0.0.1 only). */
  async startTunnel(alias: string, options: { remotePort: number; remoteHost?: string; localPort?: number }): Promise<TunnelInfo> {
    return startTunnel(this, alias, options)
  }

  /** All active tunnels. */
  listTunnels(): TunnelInfo[] {
    return listTunnels(this)
  }

  /** Stop one tunnel (closes the listener, live sockets, and the pinned connection). */
  stopTunnel(id: string): boolean {
    return stopTunnel(this, id)
  }

  /** Stop all tunnels (optionally for one alias). */
  stopAllTunnels(alias?: string): number {
    return stopAllTunnels(this, alias)
  }

  /**
   * Drop every live artifact bound to one alias: stop its tunnels and close
   * the pooled connection. Host entries that are deleted or whose connection
   * fields change must never keep serving a stale, previously authenticated
   * connection — the next operation re-connects from the current config.
   */
  dropAlias(alias: string): void {
    stopAllTunnels(this, alias)
    disposeRecord(this, alias)
  }

  // ------------------------------------------------------------- misc

  /** Probe connectivity with a cross-platform shell command. */
  async test(alias: string): Promise<TestResult> {
    const started = Date.now()
    try {
      const result = await this.exec(alias, 'echo ok', 10_000)
      return result.success
        ? { ok: true, latencyMs: result.durationMs }
        : { ok: false, latencyMs: result.durationMs, error: 'remote exit code ' + result.exitCode }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Close every pooled connection and tunnel. */
  dispose(): void {
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer)
    for (const id of [...this.tunnels.keys()]) stopTunnel(this, id)
    for (const alias of [...this.pool.keys()]) disposeRecord(this, alias)
  }
}
