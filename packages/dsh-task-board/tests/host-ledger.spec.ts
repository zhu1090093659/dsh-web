import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTask, startExecution, withSchedule, type TaskRecord } from '../src/core/tasks.ts'
import { HostTaskLedger, processIsAlive, processState } from '../src/host-ledger.ts'

const roots: string[] = []
const NOW = new Date(2026, 7, 16, 10, 0, 30).getTime()

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-ledger-'))
  roots.push(root)
  return root
}

function task(id: string, updatedAt = NOW): TaskRecord {
  return { ...createTask({ title: id, description: '', prompt: id }, NOW - 1000, id), updatedAt }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * The start time of a live process exactly as the legacy `ps -o lstart=`
 * probe recorded it: whole-second resolution. Used to simulate locks written
 * by the pre-ms-probe implementation during a rolling upgrade.
 */
function secondGranularStartMs(pid: number): number | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const probe = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 3000, env: { ...process.env, LC_ALL: 'C' } })
    if (probe.status !== 0 || probe.stdout.length === 0) return undefined
    const started = Date.parse(probe.stdout.toString('utf8').trim())
    return Number.isFinite(started) ? started : undefined
  } catch {
    return undefined
  }
}

/**
 * Try to leave a short-lived orphan behind whose exit is not reaped, so it
 * occupies the PID table as a zombie (`process.kill(pid, 0)` then reports it
 * alive). Works on Linux where PID 1 does not reap promptly (containers, some
 * CI inits); returns undefined where init reaps orphans immediately, so
 * callers skip rather than flake.
 */
function spawnZombie(): number | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const probeFile = join(tmpdir(), `dsh-task-board-zombie-${process.pid}-${Math.random().toString(36).slice(2)}`)
    const shell = spawn('sh', ['-c', `sleep 0.2 & echo $! > "${probeFile}"`], { stdio: 'ignore' })
    shell.unref()
    const deadline = Date.now() + 3000
    let pid: number | undefined
    while (Date.now() < deadline) {
      try {
        const raw = readFileSync(probeFile, 'utf8').trim()
        if (raw !== '') {
          const parsed = Number(raw)
          if (Number.isSafeInteger(parsed)) pid = parsed
          break
        }
      } catch { /* shell still starting */ }
      sleepSync(50)
    }
    if (pid === undefined) return undefined
    const zombieDeadline = Date.now() + 2500
    while (Date.now() < zombieDeadline) {
      if (processState(pid) === 'Z') return pid
      sleepSync(50)
    }
    return undefined // init reaped it before we could observe the zombie
  } catch {
    return undefined
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('HostTaskLedger', () => {
  it('imports each source once and merges newer fields with the execution union', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    const old = task('same', NOW - 100)
    const opened = startExecution(old, NOW - 90, 'exec-a').task
    const newer = { ...task('same', NOW + 1), title: 'newer', executions: [
      { id: 'exec-b', sessionId: 'session-b', startedAt: NOW - 80, endedAt: NOW - 70, result: 'succeeded' as const, error: undefined },
    ] }
    ledger.applyRequest('request-a', { kind: 'import', sourceId: 'browser-a', tasks: [opened] })
    ledger.applyRequest('request-b', { kind: 'import', sourceId: 'browser-b', tasks: [newer] })
    const revision = ledger.state().revision
    ledger.applyRequest('request-c', { kind: 'import', sourceId: 'browser-a', tasks: [task('ignored')] })
    ledger.applyRequest('request-d', {
      kind: 'import', sourceId: 'browser-equal', tasks: [{ ...task('same', NOW + 1), title: 'equal-time browser copy' }],
    })
    const merged = ledger.state().tasks[0]
    expect(merged.title).toBe('newer')
    expect(merged.executions.map(entry => entry.id)).toEqual(['exec-a', 'exec-b'])
    expect(ledger.state().revision).toBe(revision + 1)
  })

  it('persists atomically, restores revision, and returns the first duplicate request result', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    const first = ledger.applyRequest('same-request', {
      kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' },
    })
    const duplicate = ledger.applyRequest('same-request', {
      kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' },
    })
    expect(duplicate.state).toEqual(first.state)
    expect(ledger.state().tasks.map(value => value.id)).toEqual(['task-a'])
    expect(() => ledger.applyRequest('same-request', {
      kind: 'create', id: 'task-b', input: { title: 'B', description: '', prompt: '' },
    })).toThrow('different action')
    expect(readdirSync(root).filter(name => name.includes('.tmp-'))).toEqual([])
    ledger.dispose()
    const restored = new HostTaskLedger(root, () => NOW + 1000)
    expect(restored.state().revision).toBe(1)
    expect(restored.state().tasks[0].title).toBe('A')
  })

  it('quarantines a corrupt document without overwriting it and reports the error', () => {
    const root = tempRoot()
    const file = join(root, 'ledger-v2.json')
    writeFileSync(file, '{not json', 'utf8')
    const ledger = new HostTaskLedger(root, () => NOW)
    const recoveredId = ledger.state().scheduler.ledgerId
    expect(ledger.state().tasks).toEqual([])
    expect(ledger.state().scheduler.error).toContain('quarantined')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 2, tasks: [] })
    const quarantined = readdirSync(root).find(name => name.startsWith('ledger-v2.json.corrupt-'))
    expect(quarantined).toBeDefined()
    expect(readFileSync(join(root, quarantined!), 'utf8')).toBe('{not json')
    ledger.dispose()
    const restarted = new HostTaskLedger(root, () => NOW + 1)
    expect(restarted.state().scheduler.ledgerId).toBe(recoveredId)
    expect(restarted.state().scheduler.error).toContain('quarantined')
  })

  it('opens one due execution and rolls a running task without queuing another', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    const due = withSchedule(task('scheduled'), {
      enabled: true, cron: '* * * * *', nextRunAt: NOW, lastTriggeredAt: undefined,
    }, NOW)
    ledger.applyRequest('import', { kind: 'import', sourceId: 'source', tasks: [due] })
    const opened = ledger.openScheduled('scheduled', NOW + 60_000, NOW)
    expect(opened).toBeDefined()
    expect(ledger.openScheduled('scheduled', NOW + 120_000, NOW + 60_000)).toBeUndefined()
    const current = ledger.state().tasks[0]
    expect(current.executions).toHaveLength(1)
    expect(current.schedule?.nextRunAt).toBe(NOW + 120_000)
  })

  it('cancels a running record without a session id after restart instead of resending it', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('run', { kind: 'run', taskId: 'task-a' })
    ledger.dispose()
    const restarted = new HostTaskLedger(root, () => NOW + 1000)
    const execution = restarted.state().tasks[0].executions[0]
    expect(execution.result).toBe('cancelled')
    expect(execution.error).toContain('restarted')
  })

  it('persists request fingerprints and scheduler metadata across Host restarts', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('run', { kind: 'run', taskId: 'task-a' })
    ledger.setScheduler({ lastTickAt: NOW })
    ledger.dispose()

    const restarted = new HostTaskLedger(root, () => NOW + 1_000)
    const beforeRetry = restarted.state()
    const duplicate = restarted.applyRequest('run', { kind: 'run', taskId: 'task-a' })
    expect(duplicate.state).toEqual(beforeRetry)
    expect(duplicate.state.tasks[0].executions).toHaveLength(1)
    expect(duplicate.state.tasks[0].executions[0].result).toBe('cancelled')
    expect(duplicate.state.scheduler.lastTickAt).toBe(NOW)
    expect(() => restarted.applyRequest('run', {
      kind: 'rerun', taskId: 'task-a',
    })).toThrow('different action')
    restarted.dispose()
  })

  it('fails closed on a second live owner of the same ledger directory', () => {
    const root = tempRoot()
    const first = new HostTaskLedger(root, () => NOW)
    expect(() => new HostTaskLedger(root, () => NOW)).toThrow('already owned')
    first.dispose()
    const successor = new HostTaskLedger(root, () => NOW)
    expect(successor.state().scheduler.ledgerId).toBeDefined()
    successor.dispose()
  })

  it('takes over a stale legacy lock whose pid was reused by a newer process', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    // Legacy lock from a crashed owner: no recorded start time, old mtime.
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: 'stale-owner' }), { encoding: 'utf8' })
    const past = Date.now() - 60 * 60 * 1000
    utimesSync(lockFile, past / 1000, past / 1000)
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().scheduler.ledgerId).toBeDefined()
    ledger.dispose()
  })

  it('takes over a lock whose recorded start time does not match the live pid', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() + 86_400_000 }), { encoding: 'utf8' })
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().scheduler.ledgerId).toBeDefined()
    ledger.dispose()
  })

  it('fails closed with a recovery hint when a fresh legacy lock cannot be disproved', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    // A legacy lock with a fresh mtime cannot be proven stale by ordering,
    // so the ledger must refuse to start and explain how to recover.
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), { encoding: 'utf8' })
    let message = ''
    try {
      new HostTaskLedger(root, () => NOW)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('already owned by process')
    expect(message).toContain('remove')
    expect(message).toContain(lockFile)
  })

  it('takes over a legacy lock whose recorded pid is dead (power-loss leftover)', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    // Issue #886: an unclean shutdown (power loss) leaves a lock whose pid
    // is no longer alive after the next boot. The dead pid must not block
    // startup: the lock is stale by liveness alone.
    const dead = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 })
    expect(dead.pid).toBeDefined()
    writeFileSync(lockFile, JSON.stringify({ pid: dead.pid, token: 'power-loss-owner' }), { encoding: 'utf8' })
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().scheduler.ledgerId).toBeDefined()
    ledger.dispose()
  })

  it('names the lock file and a recovery hint when the lock is unreadable', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    // A power-loss mid-write can leave a truncated lock. The same event
    // killed the writer, so the next start must fail closed but explain
    // exactly how to recover instead of a bare "unreadable" error.
    writeFileSync(lockFile, '{not-json', { encoding: 'utf8' })
    let message = ''
    try {
      new HostTaskLedger(root, () => NOW)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('unreadable')
    expect(message).toContain('remove')
    expect(message).toContain(lockFile)
  })

  it('takes over a lock owned by an unreaped zombie process', () => {
    const zombie = spawnZombie()
    if (zombie === undefined) return // environment reaps orphans; cannot exercise
    const root = tempRoot()
    // Record the zombie's REAL (legacy second-granularity) start time, so the
    // identity comparison alone would look like a live owner. Only the
    // zombie-state check (processIsAlive === false) lets this lock be taken
    // over — the test fails without it.
    const startedAt = secondGranularStartMs(zombie)
    if (startedAt === undefined) return // cannot simulate the legacy record
    writeFileSync(join(root, 'ledger-v2.lock'), JSON.stringify({ pid: zombie, token: 'zombie-owner', startedAt }), 'utf8')
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().scheduler.ledgerId).toBeDefined()
    ledger.dispose()
  })

  it('fails closed on a live owner whose lock records a second-granularity (legacy ps) start time', () => {
    const root = tempRoot()
    // A live old-version owner wrote its own start time through `ps -o
    // lstart=` (whole-second resolution). The new ms-precise /proc probe
    // reports the same process with a sub-second remainder; strict equality
    // would read that as PID reuse, unlink the live owner's lock and start a
    // second ledger writer during a rolling upgrade. The bounded legacy
    // tolerance must keep this owner protected (fail closed).
    const startedAt = secondGranularStartMs(process.pid)
    if (startedAt === undefined) return // ps unavailable — cannot exercise
    const lockFile = join(root, 'ledger-v2.lock')
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: 'legacy-live-owner', startedAt }), 'utf8')
    let message = ''
    try {
      new HostTaskLedger(root, () => NOW)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('already owned by process')
    // The tolerance classifies the owner as confirmed (sub-second probe
    // difference), so no misleading "PID was reused — remove the lock"
    // recovery hint is appended.
    expect(message).not.toContain('remove')
  })

  it('treats an unreaped zombie as dead even though kill(0) reports it alive', () => {
    const zombie = spawnZombie()
    if (zombie === undefined) return // environment reaps orphans; cannot exercise
    expect(processState(zombie)).toBe('Z')
    let killSaysAlive = false
    try { process.kill(zombie, 0); killSaysAlive = true } catch { /* absent */ }
    expect(killSaysAlive).toBe(true) // the lie the old probe fell for
    expect(processIsAlive(zombie)).toBe(false)
  })

  it('reports live and absent processes correctly for the liveness probe', () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { stdio: 'ignore' })
    try {
      if (child.pid === undefined) throw new Error('spawn did not yield a pid')
      expect(processIsAlive(child.pid)).toBe(true)
    } finally {
      child.kill('SIGKILL')
    }
    expect(processIsAlive(process.pid)).toBe(true)
    expect(processIsAlive(2_000_000_000)).toBe(false)
  })

  it('rejects moving or deleting a task while any execution remains open', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('run', { kind: 'run', taskId: 'task-a' })
    expect(() => ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'todo' })).toThrow('cannot be moved')
    expect(() => ledger.applyRequest('delete', { kind: 'delete', taskId: 'task-a' })).toThrow('cannot be deleted')
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
  })

  it('cancels an imported interrupted start and preserves an invalid cron as disabled', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    const interrupted = startExecution(task('legacy'), NOW - 100, 'legacy-execution').task
    const invalid = withSchedule(task('invalid'), {
      enabled: true,
      cron: '0 0 30 2 *',
      nextRunAt: NOW - 1,
      lastTriggeredAt: undefined,
    }, NOW)
    ledger.applyRequest('import', { kind: 'import', sourceId: 'legacy-browser', tasks: [interrupted, invalid] })
    const state = ledger.state()
    expect(state.tasks.find(value => value.id === 'legacy')?.executions[0].result).toBe('cancelled')
    expect(state.tasks.find(value => value.id === 'invalid')?.schedule).toMatchObject({
      enabled: false,
      cron: '0 0 30 2 *',
    })
    expect(state.tasks.find(value => value.id === 'invalid')?.schedule?.nextRunAt).toBeUndefined()
    expect(state.scheduler.error).toContain('invalid')
  })

  it('keeps archived tasks read-only at the Host boundary', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    const settled = { ...task('archived'), status: 'done' as const }
    ledger.applyRequest('import-archived', { kind: 'import', sourceId: 'browser', tasks: [settled] })
    ledger.applyRequest('archive', { kind: 'archive', taskId: 'archived' })

    expect(ledger.state().tasks[0].archivedAt).toBe(NOW)
    expect(() => ledger.applyRequest('update-archived', {
      kind: 'update', taskId: 'archived', patch: { title: 'renamed' },
    })).toThrow('archived task is read-only')
    expect(() => ledger.applyRequest('move-archived', {
      kind: 'move', taskId: 'archived', status: 'todo',
    })).toThrow('archived task is read-only')
    expect(() => ledger.applyRequest('schedule-archived', {
      kind: 'set-schedule', taskId: 'archived', patch: { enabled: true, cron: '* * * * *' },
    })).toThrow('archived task is read-only')
    expect(() => ledger.applyRequest('run-archived', {
      kind: 'run', taskId: 'archived',
    })).toThrow('archived task is read-only')
    expect(() => ledger.applyRequest('rerun-archived', {
      kind: 'rerun', taskId: 'archived',
    })).toThrow('archived task is read-only')
    expect(ledger.openScheduled('archived', NOW + 60_000, NOW)).toBeUndefined()
    expect(ledger.state().tasks[0].executions).toEqual([])
  })

  it('rejects a newly armed cron with no reachable occurrence', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    expect(() => ledger.applyRequest('create', {
      kind: 'create', id: 'impossible', input: {
        title: 'Impossible', description: '', prompt: '', schedule: { enabled: true, cron: '0 0 30 2 *' },
      },
    })).toThrow('invalid schedule')
    expect(ledger.state().tasks).toEqual([])
  })

  it('persists scheduler heartbeats to a sidecar without rewriting the ledger document', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    const before = readFileSync(join(root, 'ledger-v2.json'), 'utf8')
    ledger.setScheduler({ lastTickAt: NOW + 30_000 })
    ledger.setScheduler({ lastTickAt: NOW + 60_000 })
    expect(readFileSync(join(root, 'ledger-v2.json'), 'utf8')).toBe(before)
    expect(readdirSync(root).filter(name => name.includes('.tmp-'))).toEqual([])
    ledger.dispose()
    const restarted = new HostTaskLedger(root, () => NOW + 61_000)
    expect(restarted.state().scheduler.lastTickAt).toBe(NOW + 60_000)
    restarted.dispose()
  })

  it('takes the newer of the document and sidecar heartbeat after restart', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.setScheduler({ lastTickAt: NOW + 30_000 })
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    // Full commit persists lastTickAt; a sidecar left over from an earlier
    // crash must not roll it back, and a newer sidecar must win.
    writeFileSync(join(root, 'scheduler-v2.json'), JSON.stringify({ lastTickAt: NOW - 5_000 }), 'utf8')
    ledger.dispose()
    const older = new HostTaskLedger(root, () => NOW + 31_000)
    expect(older.state().scheduler.lastTickAt).toBe(NOW + 30_000)
    older.dispose()
    writeFileSync(join(root, 'scheduler-v2.json'), JSON.stringify({ lastTickAt: NOW + 90_000 }), 'utf8')
    const newer = new HostTaskLedger(root, () => NOW + 91_000)
    expect(newer.state().scheduler.lastTickAt).toBe(NOW + 90_000)
    newer.dispose()
  })

  it('still commits non-heartbeat scheduler patches through the full document write', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.setScheduler({ error: 'visible after restart' })
    ledger.dispose()
    const restarted = new HostTaskLedger(root, () => NOW + 1_000)
    expect(restarted.state().scheduler.error).toBe('visible after restart')
    restarted.dispose()
  })
})
