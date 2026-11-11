import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTask, EXECUTION_HISTORY_LIMIT, startExecution, withSchedule, type TaskRecord } from '../src/core/tasks.ts'
import { HostTaskLedger, processIsAlive, processState, win32StartTimeMs, type PowerShellProbe } from '../src/host-ledger.ts'
import { nextRunAtMs, resolveHostTimeZone } from '../src/core/schedule.ts'
import { TASK_BOARD_SCHEMA_VERSION } from '../src/protocol.ts'

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
 * Leave a child of this process behind that has exited but was never waited
 * on, so it occupies the PID table as a zombie (`process.kill(pid, 0)` then
 * reports it alive). The zombie has to be our own child: an orphan adopted by
 * PID 1 is reaped whenever init next runs, which lost the kill(0) probe the
 * race intermittently on CI, whereas only this process's event loop can reap
 * a child, and every caller stays synchronous from the spawn to its
 * assertions. Returns undefined where the state probe is unavailable or the
 * child was reaped after all, so callers skip rather than flake.
 */
function spawnZombie(): number | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    const child = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' })
    const pid = child.pid
    child.unref()
    if (pid === undefined) return undefined
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (processState(pid) === 'Z') return pid
      sleepSync(20)
    }
    return undefined // reaped before the state became observable
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

  it('operator applies a live subtask-depth edit, clamps it, and notifies only on change', () => {
    // Given a ledger with the default single-level limit and a subscriber
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    let notified = 0
    ledger.subscribe(() => { notified += 1 })
    expect(ledger.maxSubtaskDepth).toBe(1)

    // When a settings commit raises the limit
    ledger.setMaxSubtaskDepth(3)

    // Then the new limit holds and the subscriber heard exactly one change
    expect(ledger.maxSubtaskDepth).toBe(3)
    expect(notified).toBe(1)

    // When the same limit is committed again and an out-of-range value follows
    ledger.setMaxSubtaskDepth(3)
    ledger.setMaxSubtaskDepth(99)

    // Then the repeat is a no-op and the out-of-range value lands clamped
    expect(ledger.maxSubtaskDepth).toBe(3)
    expect(notified).toBe(1)
    ledger.setMaxSubtaskDepth(0)
    expect(ledger.maxSubtaskDepth).toBe(1)
    expect(notified).toBe(2)
  })

  it('user gets a private tasks array from a board read, so rewriting it cannot change the ledger', () => {
    // Given a ledger holding one card
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('seed-read-isolation', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })

    // When a consumer rewrites the array it was handed
    const handedOut = ledger.state().tasks
    handedOut.length = 0
    handedOut.push(task('injected'))

    // Then the ledger still reports its own card on the next read
    expect(ledger.state().tasks.map(entry => entry.id)).toEqual(['task-a'])
  })

  it('user gets a fresh array on every board read while the cards stay the ledger records', () => {
    // Given a ledger holding one card
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('seed-read-identity', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })

    // When the board is read twice
    const first = ledger.state().tasks
    const second = ledger.state().tasks

    // Then each read owns its collection while the card objects are the
    // ledger's own records: a read hands out a container a caller cannot use to
    // rewrite the board, and it no longer rebuilds the whole document to do it
    expect(second).not.toBe(first)
    expect(second[0]).toBe(first[0])
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
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 7, tasks: [] })
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
    // A cron occurrence lands on a wall-clock minute boundary, so the fixture
    // arms the rule at the boundary the engine itself would choose.
    const firstDue = nextRunAtMs('* * * * *', NOW)!
    const due = withSchedule(task('scheduled'), {
      enabled: true, cron: '* * * * *', nextRunAt: firstDue, lastTriggeredAt: undefined,
    }, NOW)
    ledger.applyRequest('import', { kind: 'import', sourceId: 'source', tasks: [due] })
    // openScheduled answers with the cascade run list: one entry for a plain
    // task, an empty list when nothing may run.
    const opened = ledger.openScheduled('scheduled', firstDue)
    expect(opened).toHaveLength(1)
    // The first run is still open, so the next occurrence is skipped rather
    // than queued: no second execution, and the rule rolls one minute forward.
    expect(ledger.openScheduled('scheduled', firstDue + 60_000)).toEqual([])
    const current = ledger.state().tasks[0]
    expect(current.executions).toHaveLength(1)
    expect(current.schedule?.nextRunAt).toBe(firstDue + 120_000)
  })

  it('derives detached runtime projections without copying settled execution details', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    const history = Array.from({ length: 2_000 }, (_, index) => ({
      id: `settled-${index}`,
      sessionId: `session-${index}`,
      startedAt: NOW - 4_000 - index * 2,
      endedAt: NOW - 3_999 - index * 2,
      result: 'succeeded' as const,
      error: undefined,
    }))
    const running = startExecution({ ...task('running'), executions: history }, NOW - 1_000, 'open').task
    const archivedSchedule = {
      ...withSchedule(task('archived-schedule'), {
        enabled: true, cron: '* * * * *', nextRunAt: NOW, lastTriggeredAt: undefined,
      }, NOW),
      status: 'done' as const,
      archivedAt: NOW - 1,
    }
    ledger.applyRequest('import-running', {
      kind: 'import',
      sourceId: 'browser',
      tasks: [
        {
          ...running,
          executions: running.executions.map(execution => execution.id === 'open'
            ? { ...execution, sessionId: 'session-open' }
            : execution),
        },
        archivedSchedule,
      ],
    })
    // A launch whose session has not resolved yet is what the runtime view has
    // to project; a stored session-less execution no longer survives import,
    // because boot cancels any open execution that never got a session.
    ledger.applyRequest('create-awaiting', {
      kind: 'create',
      id: 'awaiting-session',
      input: { title: 'Awaiting', description: '', prompt: '' },
    })
    ledger.applyRequest('run-awaiting', { kind: 'run', taskId: 'awaiting-session' })
    ledger.applyRequest('create-scheduled', {
      kind: 'create',
      id: 'scheduled',
      input: { title: 'Scheduled', description: '', prompt: '', schedule: { enabled: true, cron: '* * * * *' } },
    })

    const runtime = ledger.runtimeView()
    expect(runtime).toEqual({
      armedSchedules: 1,
      openExecutions: [{
        taskId: 'running',
        executionId: 'open',
        sessionId: 'session-open',
        startedAt: NOW - 1_000,
        teamMember: false,
      }, {
        taskId: 'awaiting-session',
        executionId: expect.any(String),
        sessionId: undefined,
        startedAt: NOW,
        teamMember: false,
      }],
      // One session id per open execution: the launch that has not resolved a
      // session yet contributes none, and the settled 2,000-row history is not
      // walked into the projection.
      openSessionIds: ['session-open'],
      needsSessionState: true,
    })
    expect(ledger.armedScheduleCount()).toBe(1)
    expect(ledger.dueSchedules(NOW + 60_000)).toEqual([{
      taskId: 'scheduled',
      mode: 'cron',
      cron: '* * * * *',
      timeZone: expect.any(String),
      nextRunAt: NOW + 30_000,
    }])
    expect(ledger.runtimeView().openExecutions[0]).not.toBe(runtime.openExecutions[0])
  })

  it('operator with an idle board sees the runtime view report no session state to reconcile', () => {
    // Given a board whose cards all settled and whose only schedule is archived
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('idle-create', { kind: 'create', id: 'idle', input: { title: 'Idle', description: '', prompt: '' } })
    ledger.applyRequest('idle-run', { kind: 'run', taskId: 'idle' })
    const execution = ledger.getTask('idle')?.executions.at(-1)
    if (execution === undefined) throw new Error('no execution')
    ledger.settle('idle', execution.id, 'succeeded')

    // When the runtime view is derived
    const idle = ledger.runtimeView()

    // Then nothing asks for the session roster
    expect(idle.openExecutions).toEqual([])
    expect(idle.openSessionIds).toEqual([])
    expect(idle.needsSessionState).toBe(false)

    // And a card parked in the running column without a tracked execution asks
    // for it again: its verdict may arrive from a settle this process never saw
    ledger.applyRequest('park', { kind: 'move', taskId: 'idle', status: 'running' })
    expect(ledger.runtimeView().needsSessionState).toBe(true)
    ledger.dispose()
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

  it('trims an over-limit execution history when loading an old ledger file', () => {
    const root = tempRoot()
    const executions = Array.from({ length: 30 }, (_, index) => ({
      id: `old-${index}`,
      sessionId: `session-${index}`,
      startedAt: NOW - 100 - index,
      endedAt: NOW - 50 - index,
      result: 'succeeded' as const,
      error: undefined,
    }))
    writeFileSync(join(root, 'ledger-v2.json'), JSON.stringify({
      schemaVersion: 2,
      revision: 7,
      tasks: [{ ...task('fat'), executions }],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-fat' },
      recentRequests: [],
    }), 'utf8')

    const ledger = new HostTaskLedger(root, () => NOW + 1000)
    const loaded = ledger.state().tasks[0]
    expect(loaded.executions).toHaveLength(EXECUTION_HISTORY_LIMIT)
    expect(loaded.executions[0].id).toBe('old-10')
    expect(loaded.executions.at(-1)?.id).toBe('old-29')
    // The initial commit persists the trimmed view, so the read and write
    // paths agree on the retention limit.
    const onDisk = JSON.parse(readFileSync(join(root, 'ledger-v2.json'), 'utf8')) as { tasks: { executions: unknown[] }[] }
    expect(onDisk.tasks[0].executions).toHaveLength(EXECUTION_HISTORY_LIMIT)
    ledger.dispose()
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

  it('reclaims a truncated lock left by an unclean shutdown (issue #1528)', () => {
    const root = tempRoot()
    const lockFile = join(root, 'ledger-v2.lock')
    // The reported Host found a 0-byte lock whose mtime was two days old: the
    // owner died between creating the file and writing its record. Nothing can
    // still be writing a lock that old, so the next start reclaims it instead
    // of leaving the Host half unmounted until someone deletes it by hand.
    writeFileSync(lockFile, '', { encoding: 'utf8' })
    const past = NOW - 2 * 24 * 60 * 60 * 1000
    utimesSync(lockFile, past / 1000, past / 1000)
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().scheduler.ledgerId).toBeDefined()
    ledger.dispose()
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

  it('operator parks a card in the running column by hand and moves it back', () => {
    // Given a card the operator parked in the running column without a run
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('park', { kind: 'move', taskId: 'task-a', status: 'running' })
    expect(ledger.state().tasks[0].status).toBe('running')

    // When the operator moves it back to the todo column
    ledger.applyRequest('unpark', { kind: 'move', taskId: 'task-a', status: 'todo' })

    // Then the column follows and no execution was ever recorded
    expect(ledger.state().tasks[0].status).toBe('todo')
    expect(ledger.state().tasks[0].executions).toHaveLength(0)
  })

  it('operator declaring a card done records the column without inventing an execution', () => {
    // Given a card that has never been run
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })

    // When the operator declares the work finished on the board
    ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'done' })

    // Then the column changes and the execution history stays empty
    const declared = ledger.state().tasks[0]
    expect(declared.status).toBe('done')
    expect(declared.executions).toHaveLength(0)
    expect(declared.updatedAt).toBe(NOW)
  })

  it('operator recording an external outcome writes one execution the column and the history both derive from', () => {
    // Given a card an agent outside this Host finished
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })

    // When that agent records the outcome
    ledger.applyRequest('ext', {
      kind: 'record-external-outcome',
      taskId: 'task-a',
      result: 'succeeded',
      initiatedBy: 'codex',
      summary: 'fixed the parser, tests green',
    })

    // Then the card is done AND the history carries the record that says why
    const task = ledger.state().tasks[0]
    expect(task.status).toBe('done')
    expect(task.executions).toHaveLength(1)
    expect(task.executions[0].result).toBe('succeeded')
    expect(task.executions[0].external).toBe(true)
    expect(task.executions[0].initiatedBy).toBe('codex')
    expect(task.executions[0].sessionId).toBeUndefined()
    expect(task.executions[0].endedAt).toBe(NOW)
    expect(task.executions[0].error).toBe('fixed the parser, tests green')
  })

  it('operator recording a failed external outcome lands in the failed column', () => {
    // Given a card an outside agent could not finish
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })

    // When that agent records the failure
    ledger.applyRequest('ext', { kind: 'record-external-outcome', taskId: 'task-a', result: 'failed', initiatedBy: 'claude-code' })

    // Then the column and the record agree, and no session is invented
    const task = ledger.state().tasks[0]
    expect(task.status).toBe('failed')
    expect(task.executions[0].result).toBe('failed')
    expect(task.executions[0].external).toBe(true)
    expect(task.executions[0].sessionId).toBeUndefined()
  })

  it('operator recording an external outcome over a run the Host is executing is refused', () => {
    // Given a card the Host is running right now
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('run', { kind: 'run', taskId: 'task-a' })

    // When an outside agent tries to write the terminal verdict over it
    const refused = (() => {
      try {
        ledger.applyRequest('ext', { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: 'codex' })
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()

    // Then the Host stays the authority, and nothing was recorded
    expect(refused).toContain('running task cannot receive an external outcome')
    const task = ledger.state().tasks[0]
    expect(task.status).toBe('running')
    expect(task.executions).toHaveLength(1)
    expect(task.executions[0].external).toBeUndefined()
  })

  it('operator recording an external outcome on an archived card is refused by the ledger', () => {
    // Given an archived card
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('archive', { kind: 'archive', taskId: 'task-a' })

    // When an outside agent reports an outcome for it
    const refused = (() => {
      try {
        ledger.applyRequest('ext', { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: 'codex' })
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()

    // Then the archived card stays read-only
    expect(refused).toContain('archived task is read-only')
    expect(ledger.state().tasks[0].executions).toHaveLength(0)
  })

  it('operator reading a ledger written before external outcomes existed gets those rows unchanged', () => {
    // Given a ledger document whose execution rows predate the external marker
    const root = tempRoot()
    const legacy = task('task-a')
    legacy.executions = [{
      id: 'old-execution',
      sessionId: 'session-old',
      startedAt: NOW - 500,
      endedAt: NOW - 100,
      result: 'succeeded',
      error: undefined,
      initiatedBy: 'session-old',
    }]
    writeFileSync(join(root, 'ledger-v2.json'), JSON.stringify({
      schemaVersion: TASK_BOARD_SCHEMA_VERSION, revision: 3, tasks: [legacy], scheduler: { timeZone: 'UTC' },
    }))

    // When the Host loads it
    const ledger = new HostTaskLedger(root, () => NOW)

    // Then the old row reads back exactly as it was, with no fabricated marker
    const stored = ledger.state().tasks[0].executions[0]
    expect(stored.result).toBe('succeeded')
    expect(stored.external).toBeUndefined()
    expect(stored.initiatedBy).toBe('session-old')
    ledger.dispose()
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
    expect(ledger.openScheduled('archived', NOW)).toEqual([])
    expect(ledger.state().tasks[0].executions).toEqual([])
  })

  it('edits task content only before the first execution and keeps targets editable after', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: 'd', prompt: 'p' } })
    const edited = ledger.applyRequest('update', { kind: 'update', taskId: 'task-a', patch: { title: 'B', description: 'd2', prompt: 'p2' } })
    expect(edited.state.tasks[0]).toMatchObject({ title: 'B', description: 'd2', prompt: 'p2' })

    expect(() => ledger.applyRequest('update-blank-title', { kind: 'update', taskId: 'task-a', patch: { title: '   ' } })).toThrow('title is required')

    const opened = ledger.applyRequest('run', { kind: 'run', taskId: 'task-a' })
    const executionId = opened.state.tasks[0].executions[0].id
    expect(() => ledger.applyRequest('update-running', { kind: 'update', taskId: 'task-a', patch: { prompt: 'live' } })).toThrow('task has already been executed')

    ledger.settle('task-a', executionId, 'failed', 'boom')
    expect(() => ledger.applyRequest('update-done', { kind: 'update', taskId: 'task-a', patch: { title: 'C' } })).toThrow('task has already been executed')

    // Execution targets stay editable on an executed task; content stays fixed.
    const targets = ledger.applyRequest('update-targets', { kind: 'update', taskId: 'task-a', patch: { workspaceId: 'ws-1', mode: 'anchored', permission: 'read-only' } })
    expect(targets.state.tasks[0]).toMatchObject({
      title: 'B', description: 'd2', prompt: 'p2',
      workspaceId: 'ws-1', mode: 'anchored', permission: 'read-only',
    })
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

  it('cleans stale temporary files on ledger startup (#1427)', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'scheduler-v2.json.tmp-12345'), 'orphaned', 'utf8')
    writeFileSync(join(root, 'ledger-v2.json.tmp-99999'), 'orphaned', 'utf8')
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(existsSync(join(root, 'scheduler-v2.json.tmp-12345'))).toBe(false)
    expect(existsSync(join(root, 'ledger-v2.json.tmp-99999'))).toBe(false)
    ledger.dispose()
  })

  it('gracefully handles ENOSPC during sidecar heartbeat write without throwing (#1427)', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    const enospcError = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    vi.spyOn(ledger as unknown as { writeSchedulerSidecar: () => void }, 'writeSchedulerSidecar').mockImplementationOnce(() => {
      throw enospcError
    })
    expect(() => {
      ledger.setScheduler({ lastTickAt: NOW + 30_000 })
    }).not.toThrow()
    expect(ledger.state().scheduler.lastTickAt).toBe(NOW + 30_000)
    ledger.dispose()
  })
})

describe('ledger schema v4 migration', () => {
  it('migrates a v2 document losslessly to v4 on load, stamping the schedule zone', () => {
    const root = tempRoot()
    const scheduled = withSchedule(
      { ...task('legacy-scheduled'), permission: 'workspace-write', workspaceId: 'ws-1', mode: 'mode-a' },
      // Disabled so the startup schedule repair does not recompute it; the
      // assertion then proves the migration itself preserved every field.
      { enabled: false, cron: '*/5 * * * *', nextRunAt: NOW + 120_000, lastTriggeredAt: NOW - 60_000 },
      NOW,
    )
    const settled = {
      ...task('legacy-settled'),
      archivedAt: NOW - 10,
      executions: [
        { id: 'exec-1', sessionId: 'session-1', startedAt: NOW - 500, endedAt: NOW - 400, result: 'succeeded' as const, error: undefined },
        { id: 'exec-2', sessionId: 'session-2', startedAt: NOW - 300, endedAt: NOW - 200, result: 'failed' as const, error: 'boom' },
      ],
    }
    const v2Document = JSON.stringify({
      schemaVersion: 2,
      revision: 41,
      tasks: [scheduled, settled],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-legacy', lastTickAt: NOW - 1_000, importedSources: ['browser-a'] },
      recentRequests: [{ requestId: 'req-legacy', fingerprint: 'fp-legacy' }],
    })
    writeFileSync(join(root, 'ledger-v2.json'), v2Document, 'utf8')

    const ledger = new HostTaskLedger(root, () => NOW + 2_000)
    const state = ledger.state()
    expect(state.revision).toBe(41)
    expect(state.tasks).toHaveLength(2)
    const migratedScheduled = state.tasks.find(entry => entry.id === 'legacy-scheduled')!
    expect(migratedScheduled.title).toBe('legacy-scheduled')
    expect(migratedScheduled.permission).toBe('workspace-write')
    expect(migratedScheduled.workspaceId).toBe('ws-1')
    expect(migratedScheduled.mode).toBe('mode-a')
    // v4 stamps the Host zone onto a pre-v4 rule so the trigger instant it
    // already committed stops following the process TZ. The instant itself is
    // untouched, because the stored nextRunAt already encodes the old zone.
    expect(migratedScheduled.schedule).toEqual({ enabled: false, mode: 'cron', cron: '*/5 * * * *', timeZone: expect.any(String), nextRunAt: NOW + 120_000, lastTriggeredAt: NOW - 60_000, runCount: 0 })
    const migratedSettled = state.tasks.find(entry => entry.id === 'legacy-settled')!
    expect(migratedSettled.archivedAt).toBe(NOW - 10)
    expect(migratedSettled.executions).toHaveLength(2)
    expect(migratedSettled.executions[1]).toEqual({ id: 'exec-2', sessionId: 'session-2', startedAt: NOW - 300, endedAt: NOW - 200, result: 'failed', error: 'boom' })
    expect(state.scheduler.ledgerId).toBe('ledger-legacy')
    expect(state.scheduler.lastTickAt).toBe(NOW - 1_000)
    // The migration is written back immediately as the current generation, keeping every field.
    const onDisk = JSON.parse(readFileSync(join(root, 'ledger-v2.json'), 'utf8'))
    expect(onDisk.schemaVersion).toBe(7)
    expect(onDisk.revision).toBe(41)
    expect(onDisk.tasks).toEqual(state.tasks)
    expect(onDisk.scheduler.ledgerId).toBe('ledger-legacy')
    expect(onDisk.scheduler.importedSources).toEqual(['browser-a'])
    expect(onDisk.recentRequests).toEqual([{ requestId: 'req-legacy', fingerprint: 'fp-legacy' }])
    ledger.dispose()
  })

  it('operator upgrading a v3 rule that stored no zone gets the Host zone stamped on it', () => {
    // Given a v3 document whose enabled rule committed a future target while
    // the Host zone was whatever the process reported
    // When the document is loaded and migrated
    const root = tempRoot()
    const committed = NOW + 120_000
    const v3Document = JSON.stringify({
      schemaVersion: 3, revision: 7,
      tasks: [{
        ...task('legacy-zoned'),
        schedule: { enabled: false, cron: '0 9 * * *', nextRunAt: committed, lastTriggeredAt: NOW - 60_000 },
      }],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-v3' },
      recentRequests: [],
    })
    writeFileSync(join(root, 'ledger-v2.json'), v3Document, 'utf8')

    // When it is loaded
    const ledger = new HostTaskLedger(root, () => NOW + 2_000)
    const migrated = ledger.state().tasks[0].schedule!

    // Then the rule carries the Host zone so it stops following a later TZ
    // change, and the instant it had already committed is untouched.
    expect(migrated.timeZone).toBe(resolveHostTimeZone())
    expect(migrated.nextRunAt).toBe(committed)
    expect(migrated.cron).toBe('0 9 * * *')
    ledger.dispose()
  })

  it('operator upgrading a v3 rule that already has a zone keeps that stored zone', () => {
    // Given a v3 row that already carries an explicit zone
    // When the document is loaded and migrated
    // Then the stored zone is kept rather than replaced by the Host zone
    const root = tempRoot()
    const committed = NOW + 120_000
    const v3Document = JSON.stringify({
      schemaVersion: 3, revision: 8,
      tasks: [{
        ...task('legacy-explicit'),
        schedule: { enabled: false, cron: '0 9 * * *', timeZone: 'Europe/London', nextRunAt: committed, lastTriggeredAt: NOW - 60_000 },
      }],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-v3b' },
      recentRequests: [],
    })
    writeFileSync(join(root, 'ledger-v2.json'), v3Document, 'utf8')

    // When it is loaded
    const ledger = new HostTaskLedger(root, () => NOW + 2_000)

    // Then the stored zone wins over the Host zone
    expect(ledger.state().tasks[0].schedule!.timeZone).toBe('Europe/London')
    ledger.dispose()
  })

  it('cold-starts an empty v4 ledger on a fresh directory and reloads an empty v4 document', () => {
    const fresh = tempRoot()
    const ledger = new HostTaskLedger(fresh, () => NOW)
    expect(ledger.state().tasks).toEqual([])
    expect(ledger.state().revision).toBe(0)
    expect(JSON.parse(readFileSync(join(fresh, 'ledger-v2.json'), 'utf8')).schemaVersion).toBe(7)
    ledger.dispose()

    const existing = tempRoot()
    writeFileSync(join(existing, 'ledger-v2.json'), JSON.stringify({
      schemaVersion: 5, revision: 0, tasks: [], scheduler: { timeZone: 'UTC', ledgerId: 'ledger-empty' }, recentRequests: [],
    }), 'utf8')
    const reloaded = new HostTaskLedger(existing, () => NOW)
    expect(reloaded.state().tasks).toEqual([])
    expect(reloaded.state().scheduler.ledgerId).toBe('ledger-empty')
    reloaded.dispose()
  })

  it('fails loudly and keeps the original v2 file when migration validation fails', () => {
    const root = tempRoot()
    const v2Document = JSON.stringify({
      schemaVersion: 2, revision: 3,
      tasks: [{ id: 42, title: 'broken row' }],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-broken' },
      recentRequests: [],
    })
    writeFileSync(join(root, 'ledger-v2.json'), v2Document, 'utf8')
    expect(() => new HostTaskLedger(root, () => NOW)).toThrow(/migration/)
    // No silent zeroing: the original file is untouched and nothing is quarantined.
    expect(readFileSync(join(root, 'ledger-v2.json'), 'utf8')).toBe(v2Document)
    expect(readdirSync(root).filter(name => name.startsWith('ledger-v2.json.corrupt-'))).toEqual([])
  })

  it('quarantines a document with an unsupported future schema version', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'ledger-v2.json'), JSON.stringify({
      schemaVersion: 99, revision: 1, tasks: [], scheduler: {}, recentRequests: [],
    }), 'utf8')
    const ledger = new HostTaskLedger(root, () => NOW)
    expect(ledger.state().tasks).toEqual([])
    expect(ledger.state().scheduler.error).toContain('quarantined')
    expect(readdirSync(root).some(name => name.startsWith('ledger-v2.json.corrupt-'))).toBe(true)
    ledger.dispose()
  })

  it('round-trips a v4 document through persist and reload without field drift', () => {
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('create', {
      kind: 'create', id: 'task-a',
      input: { title: 'A', description: 'desc', prompt: 'p', workspaceId: 'ws-1', mode: 'mode-a', permission: 'workspace-write' },
    })
    ledger.applyRequest('set-schedule', { kind: 'set-schedule', taskId: 'task-a', patch: { enabled: true, cron: '0 9 * * *' } })
    const before = ledger.state()
    ledger.dispose()

    const reloaded = new HostTaskLedger(root, () => NOW + 1_000)
    const after = reloaded.state()
    expect(after.revision).toBe(before.revision)
    expect(after.tasks).toEqual(before.tasks)
    expect(after.scheduler.ledgerId).toBe(before.scheduler.ledgerId)
    expect(JSON.parse(readFileSync(join(root, 'ledger-v2.json'), 'utf8')).schemaVersion).toBe(7)
    reloaded.dispose()
  })
})
describe('win32StartTimeMs', () => {
  /** Records every script the fallback chain runs and answers per script. */
  function recordingProbe(answers: (script: string) => string | undefined): { probe: PowerShellProbe; scripts: string[] } {
    const scripts: string[] = []
    return {
      scripts,
      probe: (script) => {
        scripts.push(script)
        return answers(script)
      },
    }
  }

  it('operator gets the lock identity from Win32_Process when Get-Process reads nothing', () => {
    // Given issue #1629: an unprivileged caller gets no StartTime for a protected
    // process (System, svchost), so the direct probe prints nothing
    const { probe, scripts } = recordingProbe(script => script.includes('Win32_Process') ? '1789782344683' : '')

    // When the Win32 start time is probed
    const startTime = win32StartTimeMs(4, probe)

    // Then the CIM fallback still supplies the identity of the PID the lock named
    expect(startTime).toBe(1789782344683)
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toContain('Get-Process -Id 4')
    expect(scripts[1]).toContain('Win32_Process -Filter "ProcessId=4"')
    expect(scripts[1]).toContain('CreationDate')
  })

  it('operator keeps the Get-Process reading and skips the CIM probe when it answers', () => {
    // Given a direct probe that answers
    const { probe, scripts } = recordingProbe(() => '1789782344683')

    // When the Win32 start time is probed
    const startTime = win32StartTimeMs(1234, probe)

    // Then the direct reading is used and no CIM script is built
    expect(startTime).toBe(1789782344683)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('Get-Process -Id 1234')
  })

  it('operator gets no start time when neither probe answers', () => {
    // Given both probes stay empty, which the lock treats as "cannot prove PID reuse"
    const { probe, scripts } = recordingProbe(() => undefined)

    // When the Win32 start time is probed
    const startTime = win32StartTimeMs(4, probe)

    // Then the caller gets no timestamp instead of a fabricated one
    expect(startTime).toBeUndefined()
    expect(scripts).toHaveLength(2)
  })

  it('operator sees a pid that is not a positive integer rejected before any script is built', () => {
    // Given a probe that records whether it was consulted
    let invocations = 0
    const probe = () => { invocations += 1; return '1' }

    // When a zero, negative and fractional pid are probed
    const results = [win32StartTimeMs(0, probe), win32StartTimeMs(-4, probe), win32StartTimeMs(1.5, probe)]

    // Then each is rejected and no script was built
    expect(results).toEqual([undefined, undefined, undefined])
    expect(invocations).toBe(0)
  })
})

/**
 * Lock-refusal text contract (issue #1730).
 *
 * The refusal message is not only a log line: the degraded-ledger reason the
 * task board renders carries it, and the panel unpacks the owning pid out of
 * it. Its shape must therefore keep naming the owner, so the panel can say
 * which process to close instead of advising a restart that cannot win a lock.
 */
describe('task-board ledger lock refusal text', () => {
  it('operator is told which live process owns the ledger', () => {
    // Given a ledger directory whose lock a live owner already holds
    const root = tempRoot()
    const first = new HostTaskLedger(root, () => NOW)
    // When a second board tries to start on the same directory
    let message = ''
    try {
      new HostTaskLedger(root, () => NOW)
    } catch (error) {
      message = (error as Error).message
    }
    // Then the refusal names the owning process, which is what the panel shows
    expect(message).toContain('already owned by process')
    expect(/already owned by process\s+\d+/.test(message)).toBe(true)
    first.dispose()
  })
})

describe('HostTaskLedger label management', () => {
  it('operator renaming and deleting labels rewrites every card and refuses an unknown label', () => {
    // Given a ledger with two cards sharing one label
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('label-create-a', { kind: 'create', id: 'label-a', input: { title: 'A', description: '', prompt: 'a', tags: [{ name: 'ship' }] } })
    ledger.applyRequest('label-create-b', { kind: 'create', id: 'label-b', input: { title: 'B', description: '', prompt: 'b', tags: [{ name: 'ship' }] } })
    const before = ledger.state().revision

    // When the operator renames the label
    ledger.applyRequest('label-rename', { kind: 'rename-tag', from: 'ship', to: 'release' })

    // Then both cards carry the new name and the revision moved exactly once
    expect(ledger.state().tasks.map(entry => entry.tags?.map(tag => tag.name))).toEqual([['release'], ['release']])
    expect(ledger.state().revision).toBe(before + 1)

    // And renaming a label no card carries is refused
    expect(() => ledger.applyRequest('label-rename-ghost', { kind: 'rename-tag', from: 'ghost', to: 'x' })).toThrow('label not found')

    // When the operator deletes the label
    ledger.applyRequest('label-delete', { kind: 'delete-tag', name: 'release' })

    // Then no card carries a label any more
    expect(ledger.state().tasks.map(entry => entry.tags)).toEqual([undefined, undefined])
  })
})

