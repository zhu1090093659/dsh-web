/**
 * Connection pool: per-alias persistent ssh2 connections with multi-hop jump
 * support, the acquire / dispose / sweep lifecycle, and the pooled exec path.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import { Client, type ConnectConfig } from 'ssh2'
import type { ExecResult, SshHostEntry } from '../protocol.ts'
import { expandHome, normalizeAgentPath, type HostStore } from '../store.ts'
import { startProxyCommand, type ProxyTarget } from './proxy-command.ts'

/** Default engine knobs. */
export interface EngineOptions {
  /** Connections idle longer than this are closed (ms). */
  idleTimeoutMs?: number
  /**
   * Ceiling for the whole pre-ready sequence (ms): TCP connect, SSH key
   * exchange and user authentication. Passed to ssh2's `readyTimeout`.
   */
  connectTimeoutMs?: number
  /** Keepalive ping interval (ms). */
  keepaliveIntervalMs?: number
  /** Cap on captured stdout/stderr bytes per exec (ms). */
  maxOutputBytes?: number
  /** Default exec timeout (ms). */
  defaultExecTimeoutMs?: number
  /** Default cluster concurrency. */
  defaultMaxWorkers?: number
  /** SFTP concurrent channel count for transfers. */
  sftpConcurrency?: number
}

/**
 * Default ceiling for TCP connect, SSH key exchange and user authentication
 * together (ms). Password authentication behind PAM / LDAP can outlast the
 * previous 15 s ceiling while the server still eventually accepts it.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

/** Default engine knobs (applied when an option is omitted). */
export const DEFAULTS: Required<EngineOptions> = {
  idleTimeoutMs: 30 * 60_000,
  connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
  keepaliveIntervalMs: 15_000,
  maxOutputBytes: 2 * 1024 * 1024,
  defaultExecTimeoutMs: 60_000,
  defaultMaxWorkers: 8,
  sftpConcurrency: 8,
}

/** One pooled connection record. */
export interface PoolRecord {
  client: Client
  /** Jump-chain clients kept alive under the target. */
  hops: Client[]
  idleAt: number
  /** Pinned connections (tunnels) are never swept. */
  pinned: boolean
  broken: boolean
  /** Operations currently running on this connection (sweep guard). */
  inFlight: number
}

/**
 * The slice of the engine the pool and exec paths need. The host class
 * (engine.ts facade) satisfies this structurally.
 */
export interface PoolEngine {
  readonly store: HostStore
  readonly opts: Required<EngineOptions>
  readonly pool: Map<string, PoolRecord>
  readonly acquireQueue: Map<string, Promise<PoolRecord>>
}

/** Build the ssh2 connect config for one entry (key read from disk). */
export function buildConnectConfig(entry: SshHostEntry, sock: ConnectConfig['sock'] | undefined, opts: Required<EngineOptions>): ConnectConfig {
  const config: ConnectConfig = {
    host: entry.host,
    port: entry.port,
    username: entry.user,
    readyTimeout: opts.connectTimeoutMs,
    keepaliveInterval: opts.keepaliveIntervalMs,
    keepaliveCountMax: 3,
    tryKeyboard: true,
  }
  if (sock !== undefined) config.sock = sock
  if (entry.auth.kind === 'password') {
    config.password = entry.auth.password
  } else if (entry.auth.kind === 'agent') {
    const agentPath = resolveAgentPath(entry.auth.agentPath)
    if (agentPath === undefined) {
      throw new Error('ssh-agent is not available: set SSH_AUTH_SOCK or configure an agent path (use \'pageant\' for PuTTY Pageant on Windows)')
    }
    config.agent = agentPath
  } else {
    const keyPath = entry.auth.keyPath === undefined ? undefined : expandHome(entry.auth.keyPath)
    if (keyPath === undefined || !existsSync(keyPath)) {
      throw new Error('private key not found: ' + (entry.auth.keyPath ?? '(unset)'))
    }
    config.privateKey = readFileSync(keyPath, 'utf8')
    if (entry.auth.passphrase !== undefined && entry.auth.passphrase !== '') {
      config.passphrase = entry.auth.passphrase
    }
  }
  // Agent forwarding is additive: it never changes how the host
  // authenticates, it only lets this connection broker signatures from the
  // local agent for the remote side (OpenSSH ForwardAgent / ssh -A).
  if (entry.forwardAgent === true) {
    // Agent auth already resolved an endpoint, and reusing it keeps the
    // forwarded agent identical to the one that authenticated.
    const agentPath = typeof config.agent === 'string'
      ? config.agent
      : resolveForwardAgentPath(entry.auth.agentPath)
    if (agentPath === undefined) {
      // ssh2's own message for this case ("You must set a valid agent path to
      // allow agent forwarding") names neither the host nor a way out, so the
      // engine refuses first with an actionable one.
      throw new Error('agent forwarding is enabled for this host but no ssh-agent endpoint is available: '
        + 'set SSH_AUTH_SOCK, start Pageant on Windows, or configure an agent path')
    }
    config.agent = agentPath
    config.agentForward = true
  }
  return config
}

/**
 * The default ssh-agent endpoint on Windows: the named pipe the native
 * OpenSSH ssh-agent service listens on. ssh2 connects to a named pipe for any
 * path matching its Windows pipe form, so the default is a real endpoint
 * rather than a protocol name (#1910). PuTTY Pageant is still reachable — it
 * is what the literal `pageant` agent path selects — but it is no longer the
 * assumption.
 */
export const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

/** Resolve the ssh2 agent path for 'agent' auth. */
export function resolveAgentPath(agentPath?: string): string | undefined {
  const explicit = normalizeAgentPath(agentPath)
  if (explicit !== undefined) return explicit
  const sock = process.env.SSH_AUTH_SOCK
  if (sock !== undefined && sock !== '') return sock
  if (process.platform === 'win32') return WINDOWS_AGENT_PIPE
  return undefined
}

/**
 * Resolve the ssh-agent endpoint that forwarding brokers signatures through:
 * an explicitly configured agent path wins, then SSH_AUTH_SOCK, then the
 * native OpenSSH named pipe on Windows. Undefined means no endpoint exists on
 * this machine.
 *
 * Forwarding shares the auth resolution on purpose — the endpoint a host
 * signs through is the same one it authenticates with — but it is a separate
 * name so the forwarding path can evolve without touching auth.
 */
export function resolveForwardAgentPath(agentPath?: string): string | undefined {
  return resolveAgentPath(agentPath)
}

/** Keyboard-interactive handler callback for 2FA / dynamic prompt flow. */
export type KeyboardInteractiveHandler = (
  name: string,
  instructions: string,
  instructionsLang: string,
  prompts: Array<{ prompt: string; echo: boolean }>,
  finish: (responses: string[]) => void,
) => void

/**
 * Name the phase that actually stalled. ssh2 reports every pre-ready timeout
 * as "Timed out while waiting for handshake", including one that expires
 * during user authentication after a completed key exchange.
 *
 * @param timeoutMs - the configured `readyTimeout` (0 disables it).
 * @param handshakeComplete - whether ssh2 completed the key exchange.
 * @returns the operator-facing timeout message.
 */
export function readyTimeoutMessage(timeoutMs: number | undefined, handshakeComplete: boolean): string {
  const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? ' after ' + timeoutMs + ' ms' : ''
  const hint = ' - raise the dsh-ssh connectTimeoutMs setting if this host is slow'
  return handshakeComplete
    ? 'SSH authentication timed out' + budget + ': TCP connect and key exchange completed, but the server did not finish authenticating the user' + hint
    : 'SSH connection timed out' + budget + ' before key exchange completed: TCP connect or the SSH key exchange did not finish' + hint
}

/**
 * Whether ssh2 ended the attempt with its pre-ready timeout. The level is the
 * stable discriminator; the message is reused for connect, key exchange and
 * authentication alike.
 */
export function isReadyTimeout(error: Error): boolean {
  return (error as Error & { level?: unknown }).level === 'client-timeout'
}

/** Connect one ssh2 client (resolve on ready, reject on error/close). */
export function connectClient(config: ConnectConfig, onKeyboardInteractive?: KeyboardInteractiveHandler): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    // Key exchange completion is the only public phase boundary ssh2 exposes
    // between "TCP connect / SSH handshake" and "user authentication".
    let handshakeComplete = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      // A caller-supplied transport (a jump forwardOut stream or a
      // ProxyCommand) must not outlive the client that failed to use it, or
      // its child process leaks.
      const sock = config.sock
      if (sock !== undefined && typeof (sock as { destroy?: unknown }).destroy === 'function') {
        try { (sock as { destroy: () => void }).destroy() } catch { /* already closed */ }
      }
      try { client.destroy() } catch { /* already closed */ }
      const cause = error instanceof Error ? error : new Error(String(error))
      reject(isReadyTimeout(cause) ? new Error(readyTimeoutMessage(config.readyTimeout, handshakeComplete)) : cause)
    }
    client.once('handshake', () => {
      handshakeComplete = true
    })
    client.once('ready', () => {
      if (settled) return
      settled = true
      resolve(client)
    })
    client.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
      if (onKeyboardInteractive !== undefined) {
        onKeyboardInteractive(name, instructions, instructionsLang, prompts.map(p => ({ prompt: p.prompt, echo: Boolean(p.echo) })), finish)
        return
      }
      // Step 1: Automatic PAM password fallback: if a password is configured and all prompts ask for password
      if (config.password !== undefined && prompts.length > 0 && prompts.every(p => /password/i.test(p.prompt))) {
        finish(prompts.map(() => config.password as string))
        return
      }
      fail(new Error('Authentication failed (keyboard-interactive): ' + (prompts.map(p => p.prompt.trim()).join(', ') || 'unsupported interactive challenge')))
    })
    // Keep an error listener attached after the handshake: when TCP connects
    // but the handshake drops, ssh2 can emit a second 'error' after a single
    // once-listener is gone, which would surface as an unhandled 'error' event.
    // The settled guard turns later emissions into a no-op; other callers
    // (like doAcquire) attach their own error listeners and all fire together.
    client.on('error', fail)
    try {
      client.connect(config)
    } catch (error) {
      fail(error)
    }
  })
}

/** Cap captured output at the configured byte budget (marks truncation). */
export function appendOutput(target: { text: string; truncated: boolean }, chunk: Buffer, maxBytes: number): void {
  if (target.truncated) return
  if (target.text.length + chunk.length > maxBytes) {
    let cut = chunk.toString('utf8').slice(0, maxBytes - target.text.length)
    // Never split a surrogate pair at the cut boundary.
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
    target.text += cut + '…[output truncated]'
    target.truncated = true
    return
  }
  target.text += chunk.toString('utf8')
}

/** The ProxyCommand token source for one entry. */
function proxyTargetOf(entry: SshHostEntry): ProxyTarget {
  return { host: entry.host, port: entry.port, user: entry.user, alias: entry.alias }
}

/**
 * Parse an OpenSSH jump hop written as an address: `[user@]host[:port]`
 * (an IPv6 literal must be bracketed). Returns undefined when the value is not
 * an address at all.
 */
export function parseJumpSpec(spec: string): { host: string; port?: number; user?: string } | undefined {
  const trimmed = spec.trim()
  if (trimmed === '') return undefined
  const at = trimmed.lastIndexOf('@')
  const user = at >= 0 ? trimmed.slice(0, at) : undefined
  const rest = at >= 0 ? trimmed.slice(at + 1) : trimmed
  if (rest === '') return undefined
  let host = rest
  let portText: string | undefined
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']')
    if (end < 0) return undefined
    host = rest.slice(1, end)
    const tail = rest.slice(end + 1)
    if (tail.startsWith(':')) portText = tail.slice(1)
    else if (tail !== '') return undefined
  } else {
    const colon = rest.indexOf(':')
    if (colon >= 0) {
      host = rest.slice(0, colon)
      portText = rest.slice(colon + 1)
    }
  }
  if (host === '') return undefined
  let port: number | undefined
  if (portText !== undefined) {
    port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  }
  return {
    host,
    ...(port !== undefined ? { port } : {}),
    ...(user !== undefined && user !== '' ? { user } : {}),
  }
}

/**
 * Resolve one ProxyJump spec: an alias configured in this plugin wins, and any
 * other value is read as an OpenSSH address whose credentials come from the
 * target entry (an ad-hoc hop has no stored auth of its own).
 *
 * An address hop deliberately carries no forwardAgent flag: OpenSSH's
 * ForwardAgent is a per-Host setting and an ad-hoc address was never
 * configured, so it must never inherit the target's opt-in. A hop written as
 * an alias uses that alias's own entry, which is how a user forwards on a
 * bastion on purpose.
 */
export function resolveHop(engine: PoolEngine, entry: SshHostEntry, spec: string): SshHostEntry {
  const configured = engine.store.find(spec)
  if (configured !== undefined) return configured
  const parsed = parseJumpSpec(spec)
  if (parsed === undefined) {
    throw new Error('proxyJump \'' + spec + '\' is neither a configured alias nor a [user@]host[:port] address')
  }
  const now = Date.now()
  return {
    alias: spec,
    host: parsed.host,
    port: parsed.port ?? 22,
    user: parsed.user ?? process.env.USER ?? entry.user,
    auth: entry.auth,
    proxyJump: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Build one full jump chain for an entry: hop clients connected through in
 * order, each forwarding a stream to the next destination, ending with the
 * target client. Shared by the pool and standalone shell sessions.
 *
 * A ProxyCommand is the transport that reaches its own host, so the entry's
 * own command seeds the chain when there is no jump chain, and the first hop's
 * command is used when the hop carries one.
 */
export async function connectChain(
  engine: PoolEngine,
  entry: SshHostEntry,
  onKeyboardInteractive?: KeyboardInteractiveHandler,
): Promise<{ client: Client; hops: Client[] }> {
  const hops: Client[] = []
  const chain = entry.proxyJump
  // The store rejects both transports on one entry; a hand-edited store file
  // can still carry both, and silently picking one would hide the mistake.
  if (chain.length > 0 && entry.proxyCommand !== undefined) {
    throw new Error('entry \'' + entry.alias + '\' declares both proxyCommand and proxyJump — pick one transport per host')
  }
  /** Transports this call started; destroyed on every failure path. */
  const transports: Duplex[] = []
  const startTransport = (owner: SshHostEntry): ConnectConfig['sock'] => {
    const { stream } = startProxyCommand(owner.proxyCommand as string, proxyTargetOf(owner))
    transports.push(stream)
    return stream
  }
  let sock: ConnectConfig['sock'] = entry.proxyCommand !== undefined ? startTransport(entry) : undefined
  try {
    for (let index = 0; index < chain.length; index += 1) {
      const spec = chain[index]
      const hop = resolveHop(engine, entry, spec)
      if (index > 0 && hop.proxyCommand !== undefined) {
        throw new Error('proxyJump hop \'' + spec + '\' declares a proxyCommand, which is only supported on the first hop')
      }
      const hopSock = index === 0 && hop.proxyCommand !== undefined ? startTransport(hop) : sock
      let hopClient: Client
      try {
        hopClient = await connectClient(buildConnectConfig(hop, hopSock, engine.opts), onKeyboardInteractive)
      } catch (error) {
        // Name the hop: an address hop (or a typo'd alias) must stay
        // diagnosable from the error alone.
        throw new Error('proxyJump hop \'' + spec + '\' (' + hop.user + '@' + hop.host + ':' + hop.port + '): '
          + (error instanceof Error ? error.message : String(error)))
      }
      hops.push(hopClient)
      const next = index + 1 < chain.length ? resolveHop(engine, entry, chain[index + 1]) : undefined
      const nextHost = next !== undefined ? next.host : entry.host
      const nextPort = next !== undefined ? next.port : entry.port
      sock = await new Promise<ConnectConfig['sock']>((resolve, reject) => {
        hopClient.forwardOut('127.0.0.1', 0, nextHost, nextPort, (error, stream) => {
          if (error !== undefined) {
            reject(new Error('proxyJump hop \'' + spec + '\' could not forward to ' + nextHost + ':' + nextPort + ': ' + error.message))
          } else {
            resolve(stream)
          }
        })
      })
    }
  } catch (error) {
    // A missing alias, a failed hop connect, or a failed forwardOut must all
    // close the hops already connected — and the proxy commands behind them —
    // so a failed ProxyJump never leaks either.
    for (const client of hops) client.end()
    for (const stream of transports) {
      try { stream.destroy() } catch { /* already closed */ }
    }
    throw error
  }
  let target: Client | undefined
  try {
    target = await connectClient(buildConnectConfig(entry, sock, engine.opts), onKeyboardInteractive)
    return { client: target, hops }
  } catch (error) {
    for (const client of hops) client.end()
    for (const stream of transports) {
      try { stream.destroy() } catch { /* already closed */ }
    }
    // connectClient already destroys the failed target on its own failure
    // path; destroy defensively only when a reference leaked through, and
    // guard it so a second destroy is never an issue.
    if (target !== undefined) {
      try { target.destroy() } catch { /* already destroyed */ }
    }
    throw error
  }
}

/** Connect (or reuse) the pooled chain for one alias; pins nothing. */
export async function acquire(engine: PoolEngine, alias: string): Promise<PoolRecord> {
  const pending = engine.acquireQueue.get(alias)
  if (pending !== undefined) return pending
  const task = doAcquire(engine, alias)
  engine.acquireQueue.set(alias, task)
  try {
    return await task
  } finally {
    if (engine.acquireQueue.get(alias) === task) engine.acquireQueue.delete(alias)
  }
}

async function doAcquire(engine: PoolEngine, alias: string): Promise<PoolRecord> {
  const entry = engine.store.find(alias)
  if (entry === undefined) throw new Error('alias \'' + alias + '\' not found — add it first')
  const { client, hops } = await connectChain(engine, entry)
  const record: PoolRecord = { client, hops, idleAt: Date.now(), pinned: false, broken: false, inFlight: 0 }
  client.on('error', () => { record.broken = true })
  client.on('close', () => { record.broken = true })
  engine.pool.set(alias, record)
  return record
}

/**
 * Tear down one alias's record. When `record` is given and no longer the
 * pooled record for the alias (a concurrent acquire replaced it), nothing
 * is torn down — the connection belongs to someone else now.
 */
export function disposeRecord(engine: PoolEngine, alias: string, record?: PoolRecord): void {
  const current = engine.pool.get(alias)
  if (record !== undefined && current !== record) return
  if (current === undefined) return
  engine.pool.delete(alias)
  endRecordChain(current)
}

/** End one record's client and hop chain (best-effort, safe to repeat). */
export function endRecordChain(record: PoolRecord): void {
  try { record.client.end() } catch { /* already closed */ }
  for (const hop of record.hops) {
    try { hop.end() } catch { /* already closed */ }
  }
}

/** Close connections idle beyond the threshold (skips pinned and in-flight). */
export function sweepPool(engine: PoolEngine): void {
  const cutoff = Date.now() - engine.opts.idleTimeoutMs
  for (const [alias, record] of engine.pool) {
    if (!record.pinned && record.inFlight === 0 && record.idleAt < cutoff) {
      disposeRecord(engine, alias, record)
    }
  }
}

/**
 * Run `fn` with a live client for `alias`, reconnecting (up to the
 * attempt budget) when the connection broke mid-flight.
 */
export async function withClient<T>(engine: PoolEngine, alias: string, fn: (client: Client) => Promise<T>, attempts = 3, signal?: AbortSignal): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let record = engine.pool.get(alias)
    if (record === undefined || record.broken) {
      if (record !== undefined) disposeRecord(engine, alias, record)
      record = await acquire(engine, alias)
    }
    record.idleAt = Date.now()
    record.inFlight += 1
    try {
      const result = await fn(record.client)
      record.idleAt = Date.now()
      return result
    } catch (error) {
      lastError = error
      // A cancelled call is never replayed: the caller asked for it to stop,
      // and a retry would re-run a command that may not be idempotent.
      if (signal?.aborted === true) throw error
      // Retry only when the connection actually broke mid-flight: drop the
      // corpse and let the next attempt reconnect (a reconnect may replay a
      // non-idempotent command — the documented trade-off). A failure on a
      // healthy connection is a logic error and is rethrown, not replayed.
      if (!record.broken) throw error
      disposeRecord(engine, alias, record)
    } finally {
      record.inFlight -= 1
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Run one command on `alias` (reusing the pooled connection). */
export async function execCommand(engine: PoolEngine, alias: string, command: string, timeoutMs?: number, signal?: AbortSignal): Promise<ExecResult> {
  const started = Date.now()
  const budget = timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : engine.opts.defaultExecTimeoutMs
  return withClient(engine, alias, async (client) => {
    return await new Promise<ExecResult>((resolve, reject) => {
      // Caller cancellation is cooperative and quiescent: aborting closes the
      // remote channel and settles this call like a timeout does, so the
      // command stops without the pool replaying it. The channel is captured
      // in a mutable slot because abort may fire before client.exec calls back.
      let aborted = signal !== undefined && signal.aborted
      let kill = (): void => { /* channel not open yet */ }
      const onAbort = (): void => {
        aborted = true
        kill()
      }
      if (signal !== undefined && !signal.aborted) signal.addEventListener('abort', onAbort, { once: true })
      client.exec(command, (error, stream) => {
        if (error !== undefined) {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
          return
        }
        kill = (): void => {
          try { stream.signal('KILL') } catch { /* channel gone */ }
          try { stream.close() } catch { /* channel gone */ }
        }
        // The abort may already have arrived while this channel opened.
        if (aborted) kill()
        const stdout = { text: '', truncated: false }
        const stderr = { text: '', truncated: false }
        let timedOut = false
        let settled = false
        /** One cancelled outcome: the remote channel was killed on caller request. */
        const cancelledResult = (): ExecResult => ({
          success: false,
          exitCode: null,
          timedOut: false,
          stdout: stdout.text,
          stderr: stderr.text,
          durationMs: Date.now() - started,
          error: 'command cancelled by the caller',
        })
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve({
            success: false,
            exitCode: null,
            timedOut,
            stdout: stdout.text,
            stderr: stderr.text,
            durationMs: Date.now() - started,
            error: timedOut ? 'command timed out after ' + budget + ' ms' : undefined,
          })
        }
        const timer = setTimeout(() => {
          timedOut = true
          try { stream.signal('KILL') } catch { /* channel gone */ }
          try { stream.close() } catch { /* channel gone */ }
          // Hard deadline: settle now even if the peer never acks the
          // channel close (the stream 'close' handler is then a no-op).
          finish()
        }, budget)
        stream.on('data', (chunk: Buffer) => appendOutput(stdout, chunk, engine.opts.maxOutputBytes))
        stream.stderr.on('data', (chunk: Buffer) => appendOutput(stderr, chunk, engine.opts.maxOutputBytes))
        stream.on('close', (code: number | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          // A caller cancellation settles as cancelled, never as a broken
          // connection: the latter would send withClient into a retry that
          // re-runs a command the caller asked to stop.
          if (aborted) {
            resolve(cancelledResult())
            return
          }
          if (typeof code !== 'number' && !timedOut) {
            // The channel closed without an exit status: the connection
            // dropped mid-flight. Reject so withClient can reconnect and
            // retry within the attempt budget.
            reject(new Error('ssh: connection lost mid-flight (channel closed without an exit status)'))
            return
          }
          resolve({
            success: code === 0,
            exitCode: code,
            timedOut,
            stdout: stdout.text,
            stderr: stderr.text,
            durationMs: Date.now() - started,
          })
        })
        stream.on('error', (streamError: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          if (aborted) {
            resolve(cancelledResult())
            return
          }
          reject(streamError)
        })
      })
    })
  })
}