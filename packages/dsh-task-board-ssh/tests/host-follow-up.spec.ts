/**
 * Follow-up and rework on a remote card: the same session continued, or a fresh
 * run that carries what the previous one reported.
 *
 * The instruction travels into the card's own payload and back out through the
 * board's rerun action, so these cases also prove the seam the proposal names:
 * the launch interceptor decides, the adapter chooses between resuming and
 * degrading, and the execution record says which of the two happened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { SSH_DEGRADED_SUMMARY_MARKER } from '../src/host/prompt.ts'
import { NOW, createBoard, executionsOf, type BoardHarness } from './support/board.ts'
import { mountEngine, runTool, type Mounted } from './support/engine.ts'
import { createScriptedSsh, type ScriptedSsh } from './support/fake-ssh.ts'
import { dshOutput } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** The SSH payload the board stored for one card. */
function payloadOf(board: BoardHarness, taskId: string) {
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  return parsed.ok ? parsed.value : undefined
}

/** The one call that wrote a run's files, whichever run it was for. */
function runFileWrite(ssh: ScriptedSsh, from = 0): string {
  const calls = ssh.calls.filter(call => call.command.includes("cmd.sh'"))
  const found = calls[calls.length - 1]
  void from
  return found?.command ?? ''
}

/**
 * Mount the provider with one card that already ran once and settled.
 * @param options - the agent overrides this deployment serves.
 * @returns the mount, the host, the card and the run it settled.
 */
async function settledCard(options: { agentCommands?: { dsh?: { command: string; resumeCommand?: string } } } = {}) {
  const ssh = createScriptedSsh()
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted: Mounted = mountEngine({
    board,
    ssh: ssh.service,
    workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver,
    now: () => NOW,
    ...(options.agentCommands === undefined ? {} : { settings: { agentCommands: options.agentCommands } }),
  })
  cleanups.push(() => { mounted.release() })
  const taskId = board.createCard('task-1', { title: 'nightly build', prompt: 'build it' }).id
  await mounted.extension.handleAction?.({
    extensionId: 'ssh',
    action: 'set-target',
    taskId,
    payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
  })
  board.apply({ kind: 'run', taskId })
  await mounted.tick(0)
  await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
  const runId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
  ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-A', text: 'first pass' }) })
  await vi.waitFor(async () => {
    await mounted.tick()
    expect(board.task(taskId)?.status).toBe('done')
  })
  return { ssh, board, mounted, taskId, runId }
}

describe('an instruction for a settled remote card', () => {
  it('operator following up on a finished card continues the remote session it recorded', async () => {
    // Given a card whose first run reported its session and settled
    const { ssh, board, mounted, taskId } = await settledCard()

    // When the operator sends one more instruction
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'also write the changelog' },
    }) as { ok: boolean }
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then the new run resumes that session and carries the instruction
    expect(reply.ok).toBe(true)
    const written = runFileWrite(ssh)
    expect(written).toContain("'--session-id'")
    expect(written).toContain('sess-A')
    expect(written).toContain('also write the changelog')
    expect(written).not.toContain('cannot be resumed')
    expect(board.task(taskId)?.status).toBe('running')

    // When that run finishes
    const secondRun = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    ssh.finish(secondRun, { output: dshOutput({ sessionId: 'sess-A', text: 'changelog written' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the card carries two external records, the second one about this run
    const executions = executionsOf(board.task(taskId))
    expect(executions).toHaveLength(2)
    expect(executions[1]?.initiatedBy).toBe('ssh:' + secondRun)
    expect(executions[1]?.summary?.text).toBe('changelog written')
  })

  it('operator following up on an agent that cannot resume gets a fresh run carrying the earlier summary', async () => {
    // Given an agent whose command override has no resume template
    const { ssh, board, mounted, taskId } = await settledCard({ agentCommands: { dsh: { command: 'sh {prompt_file}' } } })

    // When the operator sends one more instruction
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'also write the changelog' },
    })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then the run starts fresh and its prompt carries what the previous run reported
    const written = runFileWrite(ssh)
    expect(written).not.toContain('--session-id')
    expect(written).toContain('cannot be resumed in its earlier session')
    expect(written).toContain('first pass')
    expect(written).toContain('also write the changelog')

    // When that run finishes
    const secondRun = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    ssh.finish(secondRun, { output: dshOutput({ sessionId: 'sess-B', text: 'changelog written' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the record says it was the fresh run, not a continuation
    const executions = executionsOf(board.task(taskId))
    expect(executions).toHaveLength(2)
    expect(executions[1]?.summary?.text?.startsWith(SSH_DEGRADED_SUMMARY_MARKER)).toBe(true)
    expect(executions[1]?.summary?.text).toContain('changelog written')
  })

  it('operator sending a finished card back with rework instructions continues the same session', async () => {
    // Given a card whose first run settled with a session
    const { ssh, board, mounted, taskId } = await settledCard()

    // When the operator sends it back with rework instructions
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'rework',
      taskId,
      payload: { instructions: 'the second step was wrong, redo it' },
    }) as { ok: boolean }
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then the new run resumes the session and carries the instructions
    expect(reply.ok).toBe(true)
    const written = runFileWrite(ssh)
    expect(written).toContain('sess-A')
    expect(written).toContain('Rework instructions')
    expect(written).toContain('the second step was wrong, redo it')
    expect(board.task(taskId)?.status).toBe('running')
  })

  it('operator following up while a run is going is served once that run settles', async () => {
    // Given a card whose run is still going on the host
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'nightly build', prompt: 'build it' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    })
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    const firstRun = payloadOf(board, taskId)?.activeRun?.runId ?? ''

    // When the operator sends an instruction before that run ends
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'then run the smoke tests' },
    }) as { ok: boolean; message?: string }

    // Then it is queued, and the card says so
    expect(reply.ok).toBe(true)
    expect(reply.message).toBe('queued behind the run in flight')
    const status = await runTool(mounted, 'task_board_ssh_status', { taskId })
    expect((status.status as { pending?: string }).pending).toBe('follow-up')
    expect(ssh.commands('start')).toHaveLength(1)

    // When the run in flight settles
    ssh.finish(firstRun, { output: dshOutput({ sessionId: 'sess-A', text: 'first pass' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(ssh.commands('start')).toHaveLength(2)
    })

    // Then the queued instruction continues the session the finished run reported
    const written = runFileWrite(ssh)
    expect(written).toContain('sess-A')
    expect(written).toContain('then run the smoke tests')
    // The count belongs to the run the instruction was queued against.
    expect(payloadOf(board, taskId)?.history[0]?.followUps).toBe(1)
  })

  it('operator queueing a second follow-up while one is already pending is refused without overwriting the first', async () => {
    // Given a running card that already has one pending follow-up
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-dup-fu', { title: 'dup follow up' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    })
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    const first = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'first instruction' },
    }) as { ok: boolean }
    expect(first.ok).toBe(true)

    // When a second follow-up arrives before the first drains
    const second = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'second instruction' },
    }) as { ok: boolean; error?: string }

    // Then the second is refused and the first stays intact
    expect(second.ok).toBe(false)
    expect(second.error).toContain('already queued')
    expect(payloadOf(board, taskId)?.pending?.text).toBe('first instruction')
  })

  it('operator sending a follow-up to a proxy-mode card is refused instead of spawning a direct remote run', async () => {
    // Given a proxy-mode card
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-proxy-fu', { title: 'proxy follow up' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'proxy', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    })

    // When a remote follow-up is sent to it
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'check logs' },
    }) as { ok: boolean; error?: string }

    // Then it is refused and no direct run starts
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('proxy')
    expect(ssh.commands('start')).toEqual([])
  })

  it('operator following up a git-workspace card reuses the previous run worktree and branch', async () => {
    // Given a git-workspace card whose first run succeeded on a branch
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/srv/work' })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-git-fu', { title: 'git follow up' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'git', source: { kind: 'url', url: 'git@example.com:team/repo.git' } } } },
    })
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    const firstRunId = payloadOf(board, taskId)?.activeRun?.runId ?? ''
    ssh.finish(firstRunId, { output: dshOutput({ sessionId: 'sess-git', text: 'first commit' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // When the operator sends a follow-up
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'follow-up',
      taskId,
      payload: { text: 'fix lint' },
    }) as { ok: boolean }
    expect(reply.ok).toBe(true)
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then the second prepare call received reuseWorktreeRunId pointing to the first run
    expect(workspaces.recorder.runs[1]?.reuseWorktreeRunId).toBe(firstRunId)
  })
})
