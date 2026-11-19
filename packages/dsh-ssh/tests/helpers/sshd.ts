/**
 * Standalone real-sshd harness: spawns /usr/sbin/sshd as the current user
 * with a sandboxed config, host key, and a generated client keypair (key
 * auth only). Gives the SFTP tests a production-grade server.
 *
 * The child's stderr is piped into a file so a failure is diagnosable, and that
 * pipe is why teardown owns two things: the sink stays open for the child's
 * whole lifetime, and stop() is awaited. sshd prints its config warning twice —
 * once while reading the config and once right after it starts serving — so a
 * sink closed as soon as the port answered received the second line as
 * ERR_STREAM_WRITE_AFTER_END, which vitest reports as an unhandled error and
 * that fails the whole run.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'

/** Every spawned sshd (orphan cleanup if the test process dies early). */
const spawned: ChildProcess[] = []

/** Bound for one teardown step: a wedged sshd must not hang the suite. */
const SHUTDOWN_TIMEOUT_MS = 2_000

/**
 * Signal one child and wait for it to be gone.
 *
 * The exit listener is registered before the signal, so a fast exit cannot be
 * missed; a child that ignores SIGTERM past the bound is killed outright
 * instead of holding the suite open.
 * @param child - the spawned process.
 */
async function killAndWait(child: ChildProcess): Promise<void> {
  const alreadyGone = child.exitCode !== null || child.signalCode !== null
  const exited = alreadyGone
    ? Promise.resolve()
    : once(child, 'exit', { signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS) }).then(() => undefined, () => undefined)
  if (!alreadyGone) {
    try { child.kill() } catch { /* already gone */ }
  }
  await exited
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
}

/**
 * Detach the child's stderr and close the sink it fed.
 *
 * Detaching first is the whole point: a pipe still holding the sink writes into
 * it, and a write that arrives once the sink is ending escapes as an uncaught
 * ERR_STREAM_WRITE_AFTER_END.
 * @param child - the spawned process.
 * @param logStream - the sink created for that child.
 */
async function closeSink(child: ChildProcess, logStream: WriteStream): Promise<void> {
  child.stderr?.unpipe(logStream)
  await new Promise<void>((resolve) => { logStream.end(() => resolve()) })
}

/** Wait until the port accepts TCP connections (aborts on a spawn error). */
async function waitPort(port: number, timeoutMs: number, spawnError?: () => Error | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const error = spawnError?.()
    if (error !== undefined) throw error
    const ok = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
    })
    if (ok) return
    if (Date.now() > deadline) throw new Error('sshd did not start listening in time')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** The real-sshd harness. */
export class TestSshd {
  readonly port: number
  /** Absolute path of the client private key. */
  readonly clientKey: string
  /** The sandbox dir (also the writable remote filesystem area). */
  readonly root: string
  private readonly process: ChildProcess
  private readonly dir: string
  /** The child's stderr sink, open until stop() has the child gone. */
  private readonly logStream: WriteStream
  /** The one teardown every caller shares, so a second stop() cannot race it. */
  private stopping: Promise<void> | undefined

  private constructor(
    port: number,
    clientKey: string,
    root: string,
    process: ChildProcess,
    dir: string,
    logStream: WriteStream,
  ) {
    this.port = port
    this.clientKey = clientKey
    this.root = root
    this.process = process
    this.dir = dir
    this.logStream = logStream
  }

  /** Start sshd on a random high port. */
  static async start(): Promise<TestSshd> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-sshd-'))
    const root = join(dir, 'remote')
    mkdirSync(join(dir, 'etc'), { recursive: true })
    mkdirSync(join(dir, 'home', '.ssh'), { recursive: true })
    mkdirSync(root, { recursive: true })
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(dir, 'etc', 'host_key'), '-N', '', '-q'], { stdio: 'ignore' })
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(dir, 'client'), '-N', '', '-q'], { stdio: 'ignore' })
    const authorized = join(dir, 'home', '.ssh', 'authorized_keys')
    writeFileSync(authorized, readFileSync(join(dir, 'client.pub'), 'utf8'), 'utf8')
    chmodSync(authorized, 0o600)

    const port = 22_000 + Math.floor(Math.random() * 5_000)
    const config = [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'etc', 'host_key')}`,
      `PidFile ${join(dir, 'sshd.pid')}`,
      `AuthorizedKeysFile ${authorized}`,
      'PasswordAuthentication no',
      'PubkeyAuthentication yes',
      'UsePAM no',
      'UsePrivilegeSeparation no',
      'StrictModes no',
      `AllowUsers ${process.env.USER}`,
      'Subsystem sftp internal-sftp',
      'LogLevel ERROR',
    ].join('\n')
    writeFileSync(join(dir, 'sshd_config'), config + '\n', 'utf8')
    const log = join(dir, 'sshd.log')
    const logStream = createWriteStream(log)
    const child = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(dir, 'sshd_config')], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    spawned.push(child)
    // -e sends logs to stderr; capture them so failures are diagnosable.
    child.stderr?.pipe(logStream)
    let spawnError: Error | undefined
    child.once('error', (error) => { spawnError = error })
    try {
      await waitPort(port, 8_000, () => spawnError !== undefined
        ? new Error(`failed to spawn /usr/sbin/sshd: ${spawnError.message}`)
        : undefined)
    } catch (error) {
      await killAndWait(child)
      await closeSink(child, logStream)
      let detail = ''
      try {
        detail = readFileSync(log, 'utf8').slice(0, 2000)
      } catch { /* no log */ }
      rmSync(dir, { recursive: true, force: true })
      throw new Error(`sshd failed to start: ${String(error)} ${detail}`, { cause: error })
    }
    // The sink is not closed here: the child still writes to it (see the module
    // comment), so it is closed by stop() once the child is gone.
    return new TestSshd(port, join(dir, 'client'), root, child, dir, logStream)
  }

  /**
   * Stop sshd and clean up: signal the child, wait for it, detach and close the
   * log sink, then remove the sandbox. The kill itself is synchronous, so a
   * caller that does not await still stops the server; awaiting is what orders
   * the sink and the directory behind it.
   * @returns a promise that settles once sshd is gone and its sandbox removed.
   */
  stop(): Promise<void> {
    this.stopping ??= this.shutdown()
    return this.stopping
  }

  /** The one teardown sequence. */
  private async shutdown(): Promise<void> {
    await killAndWait(this.process)
    await closeSink(this.process, this.logStream)
    rmSync(this.dir, { recursive: true, force: true })
  }
}

// Best-effort orphan cleanup if the test process dies without stop().
process.on('exit', () => {
  for (const child of spawned) {
    try { child.kill() } catch { /* gone */ }
  }
})
