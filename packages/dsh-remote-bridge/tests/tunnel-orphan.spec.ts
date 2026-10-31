/**
 * Crash recovery for the tunnel's cloudflared child: the record the manager
 * writes under the DSH home, and the reap the next start performs on it.
 *
 * Every case drives real child processes (a distinctive `node -e` command line
 * that outlives the test that spawned it) against a throwaway DSH home: no
 * child_process mock, no fixed sleep, and the only injected seam is the
 * manager's documented spawn factory.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  clearTunnelChildRecord,
  createTunnelChildGuard,
  parseProcCommandLine,
  processAlive,
  processCommandLine,
  reapRecordedTunnelChild,
  readTunnelChildRecord,
  recordTunnelChild,
  tunnelChildRecordFile,
  type TunnelChildRecord,
} from '../src/host/tunnel-orphan.ts'
import { TunnelManager, type TunnelHandle } from '../src/host/tunnel.ts'

/** A pid no process can hold, so a probe reads it as gone on every platform. */
const ABSENT_PID = 9_999_999

/**
 * Whether this platform can report another pid's command line. The reaper
 * identifies a recorded child by comparing the recorded line against
 * `/proc/<pid>/cmdline` (Linux) or `ps -ww -o command=` (the rest); a platform
 * with neither — Windows — reads every command line as unreadable, which is the
 * documented fail-safe ("Windows never reaps", 2026-10-17 note) and settles
 * every record as `stale`. The cases that assert a reap or an `owned` verdict
 * therefore have nothing to observe there, so they skip instead of asserting a
 * behaviour this platform deliberately does not have. The record-shape and
 * ordinary-stop cases below keep running everywhere.
 */
const canReadCommandLines = process.platform !== 'win32'

let home = ''
const spawned: ChildProcess[] = []

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-tunnel-orphan-'))
  // The manager's guard resolves the record from the DSH home on every call.
  process.env.DSH_HOME = home
})

afterAll(() => {
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

/** Script of a probe child: announce readiness, then idle on stdin. */
const READY = 'process.stdout.write("ready\\n"); process.stdin.resume()'

/** Script of a probe child that installs its own SIGTERM handler and survives. */
const STUBBORN = 'process.on("SIGTERM", () => {}); ' + READY

/**
 * Spawn one probe child whose argv carries a distinctive marker, so a recorded
 * command line cannot belong to any other process by accident.
 * `process.stdin.resume()` keeps its event loop alive without a timer.
 */
function spawnProbe(marker: string, script: string = READY): ChildProcess {
  const child = spawn(process.execPath, ['-e', script, '--', marker], { stdio: ['pipe', 'pipe', 'ignore'] })
  spawned.push(child)
  return child
}

/**
 * Spawn one probe child and wait for its readiness line: a case then acts on a
 * running process instead of racing the interpreter's own startup (a signal
 * that arrives before the handler is installed would kill it by default).
 */
async function spawnChild(marker: string, script: string = READY): Promise<ChildProcess> {
  const child = spawnProbe(marker, script)
  const stdout = child.stdout
  if (stdout === null) throw new Error('the probe child did not get a stdout pipe')
  await once(stdout, 'data')
  return child
}

/** Wait for one child to leave the process table. */
async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'exit')
}

/** The record a crashed host would leave for one live child. */
function recordOf(child: ChildProcess, ownerPid = ABSENT_PID): TunnelChildRecord {
  return {
    pid: child.pid ?? 0,
    command: child.spawnargs.join(' '),
    ownerPid,
    recordedAt: new Date().toISOString(),
  }
}

/** The record file the plugin owns under the test's DSH home. */
function recordFile(): string {
  return tunnelChildRecordFile(home)
}

/** A timer seam that never fires: these cases observe the spawn, not the URL. */
const idleTimer = {
  setTimeout: (): number => 1,
  clearTimeout: (): void => {},
}

/** A tunnel handle around one real child process (the manager's spawn seam). */
class ChildHandle extends EventEmitter implements TunnelHandle {
  constructor(readonly process: ChildProcess) {
    super()
  }

  stop = (): boolean => {
    this.process.kill('SIGTERM')
    return true
  }
}

/** A tunnel handle with no OS process behind it (nothing to record). */
class ProcesslessHandle extends EventEmitter implements TunnelHandle {
  stop(): boolean {
    return true
  }
}

/** Build a manager whose spawn factory returns a real child process. */
function makeManager(graceMs = 50): { manager: TunnelManager; children: ChildProcess[] } {
  const children: ChildProcess[] = []
  const manager = new TunnelManager({
    factory: () => {
      const child = spawnProbe('dsh-tunnel-fresh-probe')
      children.push(child)
      return new ChildHandle(child)
    },
    ensureBinary: async () => {},
    orphan: createTunnelChildGuard({ graceMs }),
    timer: idleTimer,
    urlTimeoutMs: 30_000,
    healthCheckIntervalMs: 0,
  })
  return { manager, children }
}

describe('leftover tunnel child recovery', () => {
  it.skipIf(!canReadCommandLines)('operator gets the leftover child of a crashed host reaped on the next start', async () => {
    // Given a host that died without stopping its tunnel child: the child is
    // still running and the host's record — pid plus exact command line —
    // outlived it under the DSH home.
    const orphan = await spawnChild('dsh-tunnel-orphan-crash-probe')
    const file = recordFile()
    recordTunnelChild(file, recordOf(orphan))
    expect(processAlive(orphan.pid ?? 0)).toBe(true)
    const { manager, children } = makeManager()
    // When the next start settles its binary and spawns a fresh tunnel,
    const orphanGone = exited(orphan)
    manager.start('http://127.0.0.1:19387')
    await orphanGone
    // Then exactly the recorded child was signalled away ...
    expect(orphan.signalCode).toBe('SIGTERM')
    // ... and the record now describes this host's own child instead.
    await vi.waitFor(() => { expect(children).toHaveLength(1) })
    await vi.waitFor(() => { expect(readTunnelChildRecord(file)?.pid).toBe(children[0].pid) })
    // The fresh tunnel is then torn down through the ordinary stop path.
    const freshGone = exited(children[0])
    manager.stop()
    await freshGone
    expect(existsSync(file)).toBe(false)
  })

  it('operator gets no signal when the recorded pid is already gone', async () => {
    // Given a record whose pid is not in the process table any more.
    const file = recordFile()
    recordTunnelChild(file, {
      pid: ABSENT_PID,
      command: 'node -e process.stdin.resume() -- dsh-tunnel-orphan-gone-probe',
      ownerPid: ABSENT_PID,
      recordedAt: new Date().toISOString(),
    })
    const signals: Array<[number, NodeJS.Signals]> = []
    // When the next start reaps the record,
    const verdict = await reapRecordedTunnelChild(file, {
      signal: (pid, signal) => { signals.push([pid, signal]) },
    })
    // Then no pid was signalled and only the record was dropped.
    expect(verdict).toBe('stale')
    expect(signals).toEqual([])
    expect(existsSync(file)).toBe(false)
  })

  it.skipIf(!canReadCommandLines)('operator keeps a live child whose command line no longer matches the record', async () => {
    // Given a live child and a record whose command line is not the one ps
    // reports for its pid (a recycled pid, or a record rewritten since).
    const child = await spawnChild('dsh-tunnel-orphan-mismatch-probe')
    const recorded = recordOf(child)
    const file = recordFile()
    recordTunnelChild(file, { ...recorded, command: `${recorded.command} --tampered` })
    expect(await processCommandLine(child.pid ?? 0)).toBe(recorded.command)
    const signals: number[] = []
    // When the next start reaps the record,
    const verdict = await reapRecordedTunnelChild(file, {
      signal: (pid) => { signals.push(pid) },
    })
    // Then the live process is left alone and only the record is dropped.
    expect(verdict).toBe('stale')
    expect(signals).toEqual([])
    expect(processAlive(child.pid ?? 0)).toBe(true)
    expect(existsSync(file)).toBe(false)
    child.kill('SIGKILL')
    await exited(child)
  })

  it.skipIf(!canReadCommandLines)('operator keeps the child a live sibling host owns and its record', async () => {
    // Given a record whose owner host is still running: this test process
    // stands in for a second DSH host sharing the same home.
    const child = await spawnChild('dsh-tunnel-orphan-sibling-probe')
    const file = recordFile()
    recordTunnelChild(file, recordOf(child, process.pid))
    const signals: number[] = []
    // When the next start reaps the record,
    const verdict = await reapRecordedTunnelChild(file, {
      signal: (pid) => { signals.push(pid) },
    })
    // Then the running host keeps its child and its record.
    expect(verdict).toBe('owned')
    expect(signals).toEqual([])
    expect(processAlive(child.pid ?? 0)).toBe(true)
    expect(readTunnelChildRecord(file)?.pid).toBe(child.pid)
    clearTunnelChildRecord(file)
    child.kill('SIGKILL')
    await exited(child)
  })

  it('operator gets the same command line from the Linux proc file as from ps', () => {
    // Given one argv as the kernel stores it (NUL separated, trailing NUL),
    // when it is read, then it joins into the line ps prints and a recorded
    // command line compares equal on both platforms.
    expect(parseProcCommandLine('cloudflared\0tunnel\0--url\0http://127.0.0.1:19387\0--no-autoupdate\0'))
      .toBe('cloudflared tunnel --url http://127.0.0.1:19387 --no-autoupdate')
    // And an empty read names no process at all, so the record reads as stale.
    expect(parseProcCommandLine('')).toBeUndefined()
  })

  it.skipIf(!canReadCommandLines)('operator gets a child that ignores SIGTERM killed after the bounded wait', async () => {
    // Given an orphan that installs a SIGTERM handler and therefore survives.
    const stubborn = await spawnChild('dsh-tunnel-orphan-stubborn-probe', STUBBORN)
    const file = recordFile()
    recordTunnelChild(file, recordOf(stubborn))
    // When the next start reaps the record,
    const verdict = await reapRecordedTunnelChild(file, { graceMs: 150 })
    await exited(stubborn)
    // Then it was killed rather than left running.
    expect(verdict).toBe('reaped')
    expect(stubborn.signalCode).toBe('SIGKILL')
    expect(existsSync(file)).toBe(false)
  })
})

describe('tunnel child record ownership', () => {
  it.skipIf(!canReadCommandLines)('operator keeps another host record when the handle exposes no process to record', async () => {
    // Given a record a live sibling host owns, and a manager whose handle
    // exposes no OS process, so this manager records nothing of its own.
    const sibling = await spawnChild('dsh-tunnel-orphan-processless-probe')
    const file = recordFile()
    recordTunnelChild(file, recordOf(sibling, process.pid))
    let spawned = 0
    const manager = new TunnelManager({
      factory: () => {
        spawned += 1
        return new ProcesslessHandle()
      },
      ensureBinary: async () => {},
      orphan: createTunnelChildGuard({ graceMs: 50 }),
      timer: idleTimer,
      urlTimeoutMs: 30_000,
      healthCheckIntervalMs: 0,
    })
    // When this host starts the tunnel and then disposes it,
    manager.start('http://127.0.0.1:19387')
    await vi.waitFor(() => { expect(spawned).toBe(1) })
    manager.dispose()
    // Then the sibling's child and its record are left untouched.
    expect(processAlive(sibling.pid ?? 0)).toBe(true)
    expect(readTunnelChildRecord(file)?.pid).toBe(sibling.pid)
    clearTunnelChildRecord(file)
    sibling.kill('SIGKILL')
    await exited(sibling)
  })
})

describe('tunnel child record on the ordinary stop path', () => {
  it('operator leaves no residue when the tunnel is disposed: the child dies and the record is gone', async () => {
    // Given a running manager whose spawned child is recorded for recovery.
    const { manager, children } = makeManager()
    const file = recordFile()
    manager.start('http://127.0.0.1:19387')
    await vi.waitFor(() => { expect(children).toHaveLength(1) })
    await vi.waitFor(() => { expect(readTunnelChildRecord(file)?.pid).toBe(children[0].pid) })
    // When the host disposes the tunnel through the ordinary path,
    const gone = exited(children[0])
    manager.dispose()
    await gone
    // Then the child is stopped and nothing is left for a later start to reap.
    expect(children[0].signalCode).toBe('SIGTERM')
    expect(existsSync(file)).toBe(false)
    expect(manager.info.phase).toBe('stopped')
  })
})
