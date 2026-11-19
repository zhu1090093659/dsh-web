/**
 * A direct card: taken over before a session exists, started on the host, polled
 * to its verdict, and picked back up when the local host restarts mid-run.
 *
 * The first two cases drive the SHIPPED launcher: the `dshSsh` fake hands every
 * command to this machine's own `sh` inside a scratch home, so the script really
 * installs, detaches, writes its pid and exit files and produces the log the
 * adapter parses. The rest model the launcher's grammar in memory, so time and
 * reconnection are exact.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stateDirForHome } from '../src/core/launcher.ts'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { NOW, createBoard, executionsOf, type BoardHarness } from './support/board.ts'
import { mountEngine, type Mounted } from './support/engine.ts'
import { createLocalSsh, createScriptedSsh, type LocalSsh, type ScriptedSsh } from './support/fake-ssh.ts'
import { dshLines, dshOutput, printingPrompt, waitingLoop } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A scratch directory removed when the spec ends. */
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

/** The SSH payload the board stored for one card. */
function payloadOf(board: BoardHarness, taskId: string) {
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  return parsed.ok ? parsed.value : undefined
}

/** The target every card in this file pins. */
function directTarget(path: string) {
  return { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path } }
}

/** The agent override that runs a prompt as a script, because no account is logged in here. */
const SCRIPTED_AGENT = { agentCommands: { dsh: { command: 'sh {prompt_file}' } } }

/**
 * Mount the provider and pin one card to a direct target.
 * @param options - the board, the ssh face, the working directory and the prompt.
 * @returns the mount and the card id.
 */
async function pinCard(options: {
  board: BoardHarness
  ssh: LocalSsh['service'] | ScriptedSsh['service']
  work: string
  prompt?: string
  settings?: { agentCommands?: { dsh?: { command: string; resumeCommand?: string } } }
}): Promise<{ mounted: Mounted; taskId: string }> {
  const mounted = mountEngine({
    board: options.board,
    ssh: options.ssh,
    workspaces: fakeWorkspaces({ cwd: options.work }).resolver,
    now: () => NOW,
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  })
  cleanups.push(() => { mounted.release() })
  const taskId = options.board.createCard('task-1', {
    title: 'build the thing',
    prompt: options.prompt ?? 'do the work',
  }).id
  const reply = await mounted.extension.handleAction?.({
    extensionId: 'ssh',
    action: 'set-target',
    taskId,
    payload: { target: directTarget(options.work) },
  }) as { ok: boolean }
  expect(reply.ok).toBe(true)
  return { mounted, taskId }
}

describe('a direct card', () => {
  it('operator running a pinned card gets a run on the host, no local session and the adapter summary', async () => {
    // Given a stand-in remote home, a pinned direct card, and a card prompt that
    // really prints the event stream the dsh adapter parses
    const home = scratch('dsh-ssh-home-')
    const work = scratch('dsh-ssh-work-')
    const ssh = createLocalSsh({ home })
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const { mounted, taskId } = await pinCard({
      board,
      ssh: ssh.service,
      work,
      prompt: printingPrompt(dshLines({ sessionId: 'sess-real', text: 'the work is done' })),
      settings: SCRIPTED_AGENT,
    })

    // When the operator starts the card from the board
    board.apply({ kind: 'run', taskId })
    await vi.waitFor(() => { expect(ssh.calls.filter(call => call.verb === 'start')).toHaveLength(1) })

    // Then the card is in the running column and no local session exists
    expect(board.task(taskId)?.status).toBe('running')
    expect(board.prompts).toEqual([])
    const runId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    expect(payloadOf(board, taskId)?.activeRun?.phase).toBe('running')

    // When the detached agent really finishes on the host
    await vi.waitFor(() => { expect(existsSync(join(stateDirForHome(home), 'runs', runId, 'exit'))).toBe(true) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the card closed with one external record carrying the adapter's summary
    const executions = executionsOf(board.task(taskId))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.external).toBe(true)
    expect(executions[0]?.result).toBe('succeeded')
    expect(executions[0]?.error).toBe('the work is done')
    expect(executions[0]?.initiatedBy).toBe('ssh:' + runId)
    const settled = payloadOf(board, taskId)
    expect(settled?.activeRun).toBeUndefined()
    expect(settled?.history.map(run => [run.phase, run.sessionId, run.exitCode])).toEqual([['succeeded', 'sess-real', 0]])
    expect(readFileSync(join(stateDirForHome(home), 'runs', runId, 'stdout.log'), 'utf8')).toContain('sess-real')
  })

  it('operator replaying the start of a live run leaves one remote process behind', async () => {
    // Given a run that is still working on the host
    const home = scratch('dsh-ssh-home-')
    const work = scratch('dsh-ssh-work-')
    const release = join(work, 'release-the-run')
    const ssh = createLocalSsh({ home })
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const { mounted, taskId } = await pinCard({
      board,
      ssh: ssh.service,
      work,
      prompt: printingPrompt(dshLines({ sessionId: 'sess-replay', text: 'done' })) + '\n' + waitingLoop(release),
      settings: SCRIPTED_AGENT,
    })
    board.apply({ kind: 'run', taskId })
    await vi.waitFor(() => { expect(ssh.calls.filter(call => call.verb === 'start')).toHaveLength(1) })
    const startCommand = ssh.calls.find(call => call.verb === 'start')?.command ?? ''
    const runId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    const pidPath = join(stateDirForHome(home), 'runs', runId, 'pid')
    // The run is under way: the child wrote its pid and keeps working until this
    // spec creates the flag below.
    await vi.waitFor(() => {
      expect(payloadOf(board, taskId)?.activeRun?.phase).toBe('running')
      expect(existsSync(pidPath)).toBe(true)
    })
    const pid = Number(readFileSync(pidPath, 'utf8').trim())

    // When the connection pool replays exactly that command, as a reconnect does
    const replay = await ssh.run(startCommand)

    // Then the launcher answered for the run it already has, and its one process is untouched
    expect(replay.success).toBe(true)
    expect(replay.stdout).toContain('state=running')
    expect(replay.stdout).toContain('started=0')
    expect(Number(readFileSync(pidPath, 'utf8').trim())).toBe(pid)
    expect(() => { process.kill(pid, 0) }).not.toThrow()

    // When the run is let go and polled to its verdict
    await ssh.run("printf '%s' 'go' > '" + release + "'")
    await vi.waitFor(() => { expect(existsSync(join(stateDirForHome(home), 'runs', runId, 'exit'))).toBe(true) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then exactly one verdict was written for the one run
    expect(executionsOf(board.task(taskId))).toHaveLength(1)
  })

  it('operator running one card sees one start even when the pool replays the command', async () => {
    // Given a host whose pool replays every command once
    const ssh = createScriptedSsh({ replay: true })
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const { mounted, taskId } = await pinCard({ board, ssh: ssh.service, work: '/srv/work' })

    // When the operator starts the card
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })

    // Then the replay produced the same run, not a second agent process
    const runId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    expect(ssh.runs.get(runId)?.startCommands).toBe(2)
    expect(ssh.runs.get(runId)?.processes).toBe(1)

    // When that one run finishes and is polled
    ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-1', text: 'done' }) })
    await mounted.tick()

    // Then the card closed once
    expect(board.task(taskId)?.status).toBe('done')
    expect(executionsOf(board.task(taskId))).toHaveLength(1)
  })
})

describe('a git workspace run', () => {
  it('operator running a card in a git workspace gets the branch its strategy collected', async () => {
    // Given a card whose target asks for a per-run worktree and a strategy that brings a branch back
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/home/runner/worktrees/run-1', branch: 'dsh-task/run-1' })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'fix the parser' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: {
        target: {
          mode: 'direct',
          host: 'build-box',
          agent: { kind: 'dsh' },
          workspace: { kind: 'git', source: { kind: 'url', url: 'https://example.invalid/repo.git', base: 'main' } },
        },
      },
    })

    // When it runs to its verdict
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    const runId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-git', text: 'parser fixed' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the strategy was asked to place the run and to collect it, and the
    // branch it produced is on the card's record
    expect(workspaces.recorder.prepared).toEqual([runId])
    expect(workspaces.recorder.collected).toEqual([runId])
    expect(payloadOf(board, taskId)?.history[0]?.branch).toBe('dsh-task/run-1')
    expect(executionsOf(board.task(taskId))[0]?.error).toBe('parser fixed')
  })
})

describe('the card surface', () => {
  it('operator starting a pinned card from the card surface takes the same remote path', async () => {
    // Given a pinned card and a host that answers the launcher
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const { mounted, taskId } = await pinCard({ board, ssh: ssh.service, work: '/srv/work' })

    // When the card surface asks for a run
    const reply = await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'run', taskId }) as { ok: boolean }
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })

    // Then it runs on the host, with no local session
    expect(reply.ok).toBe(true)
    expect(board.task(taskId)?.status).toBe('running')
    expect(board.prompts).toEqual([])
  })

  it('operator pinning a card to a host this deployment does not know is refused by name', async () => {
    // Given a mounted provider with one configured host
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/srv/work' })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'card' }).id

    // When the target names an alias nobody configured
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'ghost-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    }) as { ok: boolean; error: string }

    // Then the card keeps no target and the refusal names the alias
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('ghost-box')
    expect(payloadOf(board, taskId)?.target).toBeUndefined()
  })
})

describe('a host that restarts mid-run', () => {
  it('operator restarting the local host records a finished remote run once and keeps polling a live one', async () => {
    // Given two running cards when the local host goes away
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/srv/work' })
    const first = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW })
    const finished = board.createCard('task-finished', { title: 'finished while away' }).id
    const live = board.createCard('task-live', { title: 'still running' }).id
    for (const taskId of [finished, live]) {
      await first.extension.handleAction?.({ extensionId: 'ssh', action: 'set-target', taskId, payload: { target: directTarget('/srv/work') } })
    }
    board.apply({ kind: 'run', taskId: finished })
    board.apply({ kind: 'run', taskId: live })
    await first.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })
    const finishedRun = payloadOf(board, finished)?.activeRun?.runId ?? ''
    const liveRun = payloadOf(board, live)?.activeRun?.runId ?? ''
    first.release()

    // When the host comes back after one of them finished and the other did not
    ssh.finish(finishedRun, { output: dshOutput({ sessionId: 'sess-done', text: 'closed while the host was down' }) })
    const second = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW })
    cleanups.push(() => { second.release() })
    await vi.waitFor(async () => {
      await second.tick(0)
      expect(board.task(finished)?.status).toBe('done')
    })

    // Then the run that finished was recorded exactly once, with its summary
    const executions = executionsOf(board.task(finished))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.result).toBe('succeeded')
    expect(executions[0]?.error).toBe('closed while the host was down')
    expect(executions[0]?.initiatedBy).toBe('ssh:' + finishedRun)
    expect(board.task(live)?.status).toBe('running')

    // When the live one finishes later
    ssh.finish(liveRun, { output: dshOutput({ sessionId: 'sess-live', text: 'finally done' }) })
    await vi.waitFor(async () => {
      await second.tick()
      expect(board.task(live)?.status).toBe('done')
    })

    // Then it was polled to its own verdict, and the finished one was not recorded twice
    expect(executionsOf(board.task(live))).toHaveLength(1)
    expect(executionsOf(board.task(finished))).toHaveLength(1)
  })
})
