/**
 * The launcher driven for real: a POSIX sh runs the shipped script, the script
 * starts actual processes, and these specs read what it wrote back. The four
 * promises a remote run depends on are pinned here — start is idempotent per
 * run id, status reports the live state and the exit code, tail returns the
 * bytes past an offset, and cancel takes the whole process group down.
 *
 * The waits are bounded condition polls (vi.waitFor) on a real child process,
 * because no fake timer can advance one.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildLauncherInstallCommand, launcherScriptPath, parseLauncherStatus, runDirectory, runFilePath } from '../src/core/launcher.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-task-board-ssh-process-'))
const startedGroups: number[] = []

afterAll(() => {
  for (const pid of startedGroups) {
    spawnSync('sh', ['-c', 'kill -9 -- -' + String(pid) + ' 2>/dev/null || true'])
  }
  rmSync(scratch, { recursive: true, force: true })
})

/** One isolated state directory with the shipped launcher already installed. */
function installedState(name: string): string {
  const stateDir = join(scratch, name)
  spawnSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })
  return stateDir
}

/** Write the run's command and working directory, as the provider does before start. */
function prepareRun(stateDir: string, runId: string, body: string): void {
  const directory = runDirectory(stateDir, runId)
  spawnSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })
  spawnSync('sh', ['-c', 'mkdir -p ' + JSON.stringify(directory)], { encoding: 'utf8' })
  writeFileSync(runFilePath(stateDir, runId, 'cmd.sh'), body)
  writeFileSync(runFilePath(stateDir, runId, 'cwd'), scratch)
}

/** Invoke one verb against a state directory. */
function runVerb(stateDir: string, args: readonly string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('sh', [launcherScriptPath(stateDir), ...args], {
    env: { ...process.env, TASK_BOARD_SSH_STATE: stateDir },
    encoding: 'utf8',
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Invoke the tail verb and keep its output as bytes. */
function tailBytes(stateDir: string, runId: string, offset: number): Buffer {
  const result = spawnSync('sh', [launcherScriptPath(stateDir), 'tail', runId, String(offset)], {
    env: { ...process.env, TASK_BOARD_SSH_STATE: stateDir },
  })
  return result.stdout ?? Buffer.alloc(0)
}

/** Whether a process group still has a member. */
function groupAlive(pid: number): boolean {
  return spawnSync('sh', ['-c', 'kill -s 0 -- -' + String(pid)], { encoding: 'utf8' }).status === 0
}

/** Record a pid so the cleanup can reach it even when a spec fails halfway. */
function remember(pid: number | undefined): void {
  if (pid !== undefined) startedGroups.push(pid)
}

describe('launcher start', () => {
  it('operator starting the same run twice gets one agent, not two', async () => {
    // Given a run whose agent writes one line and then stays alive
    const stateDir = installedState('start-twice')
    prepareRun(stateDir, 'run-1', 'echo up\nsleep 30\n')

    // When start runs twice
    const first = runVerb(stateDir, ['start', 'run-1'])
    const second = runVerb(stateDir, ['start', 'run-1'])

    // Then the second call reports the same process and says it started nothing
    const firstStatus = parseLauncherStatus(first.stdout)
    const secondStatus = parseLauncherStatus(second.stdout)
    remember(firstStatus.pid)
    expect(firstStatus.started).toBe(true)
    expect(secondStatus).toEqual({ state: 'running', pid: firstStatus.pid, bytes: secondStatus.bytes, started: false })

    // Then the agent ran once, which the log proves
    await vi.waitFor(() => {
      expect(readFileSync(runFilePath(stateDir, 'run-1', 'stdout.log'), 'utf8')).toContain('up')
    }, { timeout: 10_000, interval: 20 })
    expect(readFileSync(runFilePath(stateDir, 'run-1', 'stdout.log'), 'utf8').split('up').length - 1).toBe(1)
    runVerb(stateDir, ['cancel', 'run-1'])
  })
})

describe('launcher status', () => {
  it('operator watching a run in flight gets its state and process group', () => {
    // Given a run that keeps running
    const stateDir = installedState('status-running')
    prepareRun(stateDir, 'run-live', 'sleep 30\n')

    // When start and status run
    const started = parseLauncherStatus(runVerb(stateDir, ['start', 'run-live']).stdout)
    remember(started.pid)
    const status = parseLauncherStatus(runVerb(stateDir, ['status', 'run-live']).stdout)

    // Then the state is running and the pid is the one start reported
    expect(status.state).toBe('running')
    expect(status.pid).toBe(started.pid)
    expect(groupAlive(started.pid as number)).toBe(true)
    runVerb(stateDir, ['cancel', 'run-live'])
  })

  it('operator reading a finished run gets the exit code the agent returned', async () => {
    // Given a run whose agent exits with a non-zero code
    const stateDir = installedState('status-exited')
    prepareRun(stateDir, 'run-done', 'echo done\nexit 3\n')

    // When it is started
    runVerb(stateDir, ['start', 'run-done'])

    // Then status settles on the recorded exit code
    await vi.waitFor(() => {
      expect(parseLauncherStatus(runVerb(stateDir, ['status', 'run-done']).stdout).state).toBe('exited')
    }, { timeout: 10_000, interval: 20 })
    const settled = parseLauncherStatus(runVerb(stateDir, ['status', 'run-done']).stdout)
    expect(settled.exitCode).toBe(3)
    expect(settled.bytes).toBeGreaterThan(0)
  })

  it('operator asking about a run that was never started gets the missing state', () => {
    // Given an installed launcher and no such run
    const stateDir = installedState('status-missing')

    // When status runs for it
    const status = parseLauncherStatus(runVerb(stateDir, ['status', 'never-started']).stdout)

    // Then the answer says so instead of reporting a phantom run
    expect(status).toEqual({ state: 'missing' })
  })
})

describe('launcher tail', () => {
  it('operator tailing from a byte offset gets only the bytes past it', async () => {
    // Given a run whose agent wrote a known ten-character line
    const stateDir = installedState('tail-offset')
    prepareRun(stateDir, 'run-log', 'echo abcdefghij\n')
    runVerb(stateDir, ['start', 'run-log'])
    await vi.waitFor(() => {
      expect(parseLauncherStatus(runVerb(stateDir, ['status', 'run-log']).stdout).state).toBe('exited')
    }, { timeout: 10_000, interval: 20 })

    // When the log is read from the start and from an offset inside it
    const whole = tailBytes(stateDir, 'run-log', 0)
    const delta = tailBytes(stateDir, 'run-log', 4)

    // Then the first read is the whole log and the second is exactly its tail
    expect(whole.toString('utf8')).toBe('abcdefghij\n')
    expect(delta.toString('utf8')).toBe('efghij\n')
    expect(delta).toEqual(whole.subarray(4))
  })

  it('operator tailing past the end of the log gets nothing at all', () => {
    // Given a run directory that exists with no log yet
    const stateDir = installedState('tail-empty')
    prepareRun(stateDir, 'run-quiet', 'true\n')

    // When the log is read far past its end
    const delta = tailBytes(stateDir, 'run-quiet', 4_096)

    // Then nothing is returned, which is what the poller keeps as its offset
    expect(delta.toString('utf8')).toBe('')
  })
})

describe('launcher cancel', () => {
  it('operator cancelling a run stops every process in its group', async () => {
    // Given a run whose agent started two children of its own
    const stateDir = installedState('cancel-group')
    prepareRun(stateDir, 'run-kill', 'sleep 30 & sleep 30\n')

    const started = parseLauncherStatus(runVerb(stateDir, ['start', 'run-kill']).stdout)
    const pid = started.pid as number
    remember(pid)
    expect(groupAlive(pid)).toBe(true)

    // When cancel runs
    const cancelled = runVerb(stateDir, ['cancel', 'run-kill'])

    // Then the verb reports the cancellation and no group member survives
    expect(parseLauncherStatus(cancelled.stdout)).toEqual({ state: 'cancelled', pid })
    await vi.waitFor(() => {
      expect(groupAlive(pid)).toBe(false)
    }, { timeout: 10_000, interval: 20 })
    await vi.waitFor(() => {
      expect(parseLauncherStatus(runVerb(stateDir, ['status', 'run-kill']).stdout).state).toBe('cancelled')
    }, { timeout: 10_000, interval: 20 })
    expect(parseLauncherStatus(runVerb(stateDir, ['status', 'run-kill']).stdout).exitCode).toBeGreaterThan(0)
  })
})

describe('launcher input validation', () => {
  it('operator passing a run id that could escape the state directory is refused by the script too', () => {
    // Given an installed launcher
    const stateDir = installedState('validate')

    // When the script is asked for a run id with a path in it
    const refused = runVerb(stateDir, ['start', '../escape'])

    // Then it exits with the usage code and says what a run id may contain
    expect(refused.code).toBe(65)
    expect(refused.stderr).toContain('run id must be letters, digits, dots, underscores or hyphens')
  })

  it('operator invoking an unknown verb is shown the four verbs the script serves', () => {
    // Given an installed launcher
    const stateDir = installedState('unknown-verb')

    // When an unknown verb is asked for
    const refused = runVerb(stateDir, ['deploy', 'run-1'])

    // Then the usage line names the supported verbs
    expect(refused.code).toBe(64)
    expect(refused.stderr).toContain('start|status|tail|cancel')
  })
})
