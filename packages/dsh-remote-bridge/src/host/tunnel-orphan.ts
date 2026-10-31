/**
 * Crash recovery for the tunnel's cloudflared child. A host that dies without
 * tearing its tunnel down hands the child over to launchd/systemd, where it
 * keeps its edge registration forever: the next host then runs a second
 * connector beside an orphan nobody serves, and the old process holds a
 * hostname no tunnel answers on any more.
 *
 * The manager records the spawned child under the DSH home right after the
 * spawn (pid plus the exact command line ps/proc reports) and drops the record
 * when that child is stopped, so a record only outlives the process that wrote
 * it when that process crashed. The next start reaps exactly that pid, and
 * only while it is still alive AND its command line still equals the recorded
 * one: a recycled pid or a rewritten record can therefore never make the
 * plugin signal a process it did not spawn. Nothing here matches by pattern,
 * by process name, or by any pid this plugin did not record itself.
 *
 * A record also carries the pid of the host that spawned the child. Two live
 * hosts can share one DSH home (two profiles, or a plugin reload inside one
 * host), and each owns its own child; only a host that is gone leaves a child
 * behind, so a record whose owner is still running is left untouched.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/**
 * The spawned child as its tunnel handle exposes it (node's `ChildProcess`
 * fits: `pid` plus the argv it was spawned with).
 */
export interface TunnelChildProcess {
  /** The child's pid. */
  pid?: number
  /** The argv the child was spawned with, executable first. */
  spawnargs?: readonly string[]
}

/** What the plugin records about one child it spawned. */
export interface TunnelChildRecord {
  /** The child's pid. */
  pid: number
  /**
   * The child's full argv joined with single spaces — the same line `ps`
   * prints. Anything else (a wrapper, a rewritten command) is a mismatch.
   */
  command: string
  /** The host process that spawned the child; a live owner keeps it. */
  ownerPid: number
  /** ISO timestamp of the recording (diagnostics only). */
  recordedAt: string
}

/** How one recorded leftover was settled. */
export type TunnelOrphanVerdict =
  /** There was no usable record. */
  | 'none'
  /** The record did not identify a live child this plugin spawned: only the file was dropped. */
  | 'stale'
  /** The recorded child still belongs to a running host: it was left alone. */
  | 'owned'
  /** The recorded orphan was signalled away and the record dropped. */
  | 'reaped'

/** Injectable seams of the reaper (defaults read the real process table). */
export interface TunnelOrphanSeams {
  /** Whether a pid is still alive. */
  alive?: (pid: number) => boolean
  /** Read a pid's exact command line, or undefined when it cannot be read. */
  command?: (pid: number) => Promise<string | undefined>
  /** Signal one recorded pid (never a pattern). */
  signal?: (pid: number, signal: NodeJS.Signals) => void
  /** Bounded wait between liveness polls. */
  wait?: (ms: number) => Promise<void>
  /** How long the signalled child gets to honour SIGTERM before SIGKILL. */
  graceMs?: number
}

/** The crash-recovery face the tunnel manager drives. */
export interface TunnelChildGuard {
  /** Reap the leftover child a crashed host recorded; resolves once settled. */
  reap(): Promise<TunnelOrphanVerdict>
  /**
   * Record a freshly spawned child so the next host start can reap it.
   * @returns whether a record was written (a handle without its OS process, or
   * an unwritable home, writes nothing and must not clear a sibling's record).
   */
  record(child: TunnelChildProcess | undefined): boolean
  /** Drop the record: the child is stopped, so nothing is left to reap. */
  clear(): void
}

/** How long an orphan gets to honour SIGTERM before it is killed. */
export const DEFAULT_ORPHAN_GRACE_MS = 3_000

/** Liveness poll interval while that grace elapses. */
const ORPHAN_POLL_STEP_MS = 100

/** The record file this plugin owns: `$DSH_HOME/remote-web-ui-tunnel-child.json`. */
export function tunnelChildRecordFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-tunnel-child.json')
}

/**
 * Read one record, ignoring a file that cannot identify a child (`pid` and
 * `command` absent or malformed): only a well-formed record may ever lead to a
 * signal.
 * @param file - the record file.
 * @returns the record, or undefined when there is none to trust.
 */
export function readTunnelChildRecord(file: string): TunnelChildRecord | undefined {
  try {
    if (!existsSync(file)) return undefined
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<TunnelChildRecord>
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return undefined
    if (typeof parsed.command !== 'string' || parsed.command === '') return undefined
    // A record without a live-owner pid cannot be told apart from one a
    // running host still owns, so it is not trusted with a signal.
    if (typeof parsed.ownerPid !== 'number' || !Number.isInteger(parsed.ownerPid) || parsed.ownerPid <= 0) return undefined
    return {
      pid: parsed.pid,
      command: parsed.command,
      ownerPid: parsed.ownerPid,
      recordedAt: typeof parsed.recordedAt === 'string' ? parsed.recordedAt : '',
    }
  } catch {
    return undefined
  }
}

/**
 * Write one record owner-only, creating the DSH home when it is missing.
 * @param file - the record file.
 * @param record - what to record about the spawned child.
 */
export function recordTunnelChild(file: string, record: TunnelChildRecord): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
}

/** Drop one record; an absent file is not an error. */
export function clearTunnelChildRecord(file: string): void {
  rmSync(file, { force: true })
}

/**
 * Whether a pid is still in the process table. `EPERM` means the process
 * exists but belongs to another user, which still counts as alive.
 * @param pid - the pid to probe.
 * @returns whether the pid exists.
 */
export function processAlive(pid: number): boolean {
  // pid 0 and negative pids address process groups; this reaper only ever
  // probes one recorded pid.
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Read one pid's exact command line: `/proc/<pid>/cmdline` on Linux,
 * `ps -ww -o command=` elsewhere. Arguments are joined with single spaces in
 * both cases, which is exactly how a recorded argv is stored.
 * @param pid - the pid to read.
 * @returns the command line, or undefined when it cannot be read.
 */
export async function processCommandLine(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      return parseProcCommandLine(readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8'))
    } catch {
      return undefined
    }
  }
  return await psCommandLine(pid)
}

/**
 * Turn one `/proc/<pid>/cmdline` read (argv, NUL-separated, usually with a
 * trailing NUL) into the line `ps` prints, so both platforms compare against
 * the same recorded shape.
 * @param raw - the raw `/proc/<pid>/cmdline` text.
 * @returns the joined command line, or undefined for an empty file.
 */
export function parseProcCommandLine(raw: string): string | undefined {
  const argv = raw.split('\0').filter(part => part !== '')
  return argv.length === 0 ? undefined : argv.join(' ')
}

/** The `ps` fallback (unlimited width, so a long cloudflared line is not cut). */
function psCommandLine(pid: number): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    execFile('ps', ['-ww', '-p', String(pid), '-o', 'command='], { maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error !== null) {
        resolvePromise(undefined)
        return
      }
      const line = stdout.replace(/\s+$/, '')
      resolvePromise(line === '' ? undefined : line)
    })
  })
}

/** Signal one recorded pid, ignoring a child that is already gone. */
function nodeSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // The child left between the liveness probe and the signal.
  }
}

/** Node timers. */
function nodeWait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => { setTimeout(resolvePromise, ms) })
}

/**
 * Wait up to `graceMs` for a signalled pid to disappear, polling so a child
 * that exits at once does not cost the whole grace.
 * @returns whether the pid is gone.
 */
async function waitForGone(
  pid: number,
  alive: (pid: number) => boolean,
  wait: (ms: number) => Promise<void>,
  graceMs: number,
): Promise<boolean> {
  if (graceMs <= 0) return !alive(pid)
  const step = Math.min(ORPHAN_POLL_STEP_MS, graceMs)
  for (let elapsed = 0; elapsed < graceMs; elapsed += step) {
    if (!alive(pid)) return true
    await wait(step)
  }
  return !alive(pid)
}

/**
 * Settle one recorded leftover: reap exactly the recorded child when it is
 * still the process that record describes, and leave every other process
 * strictly alone.
 * @param file - the record file.
 * @param seams - process-table and signal seams (defaults read the real table).
 * @returns which way the record was settled.
 */
export async function reapRecordedTunnelChild(
  file: string,
  seams: TunnelOrphanSeams = {},
): Promise<TunnelOrphanVerdict> {
  const record = readTunnelChildRecord(file)
  if (record === undefined) {
    clearTunnelChildRecord(file)
    return 'none'
  }
  const alive = seams.alive ?? processAlive
  const command = seams.command ?? processCommandLine
  if (!alive(record.pid) || (await command(record.pid)) !== record.command) {
    // Gone, unreadable, or the pid now carries a different command: the
    // record does not identify a child this plugin spawned, so the process is
    // not touched and only the record is dropped.
    clearTunnelChildRecord(file)
    return 'stale'
  }
  if (record.ownerPid === process.pid || alive(record.ownerPid)) return 'owned'
  const signal = seams.signal ?? nodeSignal
  const wait = seams.wait ?? nodeWait
  const graceMs = seams.graceMs ?? DEFAULT_ORPHAN_GRACE_MS
  signal(record.pid, 'SIGTERM')
  if (!(await waitForGone(record.pid, alive, wait, graceMs))) signal(record.pid, 'SIGKILL')
  clearTunnelChildRecord(file)
  return 'reaped'
}

/** Seams of the file-backed guard (the record file defaults to the DSH home). */
export interface TunnelChildGuardOptions extends TunnelOrphanSeams {
  /** The record file; resolved per call so a changed DSH home is honoured. */
  file?: string
}

/**
 * Build the file-backed crash-recovery guard the tunnel manager uses: the
 * record lives at {@link tunnelChildRecordFile} unless a file is given.
 * @param options - record file and process seams (all optional).
 * @returns the guard.
 */
export function createTunnelChildGuard(options: TunnelChildGuardOptions = {}): TunnelChildGuard {
  const file = (): string => options.file ?? tunnelChildRecordFile()
  return {
    async reap(): Promise<TunnelOrphanVerdict> {
      return await reapRecordedTunnelChild(file(), options)
    },
    record(child: TunnelChildProcess | undefined): boolean {
      const pid = child?.pid
      const argv = child?.spawnargs
      // A handle that does not expose its OS process (test fakes, a future
      // package shape) has nothing to record; that is not an error.
      if (pid === undefined || argv === undefined || argv.length === 0) return false
      try {
        recordTunnelChild(file(), {
          pid,
          command: argv.join(' '),
          ownerPid: process.pid,
          recordedAt: new Date().toISOString(),
        })
        return true
      } catch (error) {
        // The record is crash recovery only: an unwritable DSH home must never
        // fail the tunnel that is already running.
        console.warn(`remote-bridge: could not record the tunnel child (${error instanceof Error ? error.message : String(error)})`)
        return false
      }
    },
    clear(): void {
      try {
        clearTunnelChildRecord(file())
      } catch {
        // Best effort: a stale record is harmless, it is validated on read.
      }
    },
  }
}
