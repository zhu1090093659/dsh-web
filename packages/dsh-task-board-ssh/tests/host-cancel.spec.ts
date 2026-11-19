/**
 * A run a person takes away: a card that leaves the running column, and a card
 * that is deleted outright.
 *
 * Both are the board's own words, not the provider's: the column move and the
 * deletion arrive as events after the ledger committed them, and what the
 * provider does about them is stop the remote process — and, for a deleted card,
 * leave nothing of it on the host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { NOW, createBoard, executionsOf } from './support/board.ts'
import { mountEngine } from './support/engine.ts'
import { createScriptedSsh } from './support/fake-ssh.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/**
 * A board with one pinned card already running on the scripted host.
 * @param cap - the host's ceiling.
 * @returns everything the case below drives.
 */
async function runningCard(cap = 2) {
  const ssh = createScriptedSsh()
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW, settings: { perHostCap: cap } })
  cleanups.push(() => { mounted.release() })
  const taskId = board.createCard('task-1', { title: 'long build' }).id
  await mounted.extension.handleAction?.({
    extensionId: 'ssh',
    action: 'set-target',
    taskId,
    payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
  })
  board.apply({ kind: 'run', taskId })
  await mounted.tick(0)
  await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  const runId = parsed.ok ? parsed.value.activeRun?.runId ?? '' : ''
  return { ssh, board, mounted, taskId, runId }
}

describe('a run a person takes away', () => {
  it('operator moving a running card out of the running column cancels the remote run and writes no verdict', async () => {
    // Given a card whose run is under way on the host
    const { ssh, board, mounted, taskId, runId } = await runningCard()

    // When the operator moves it back to the todo column
    board.apply({ kind: 'move', taskId, status: 'todo' })
    await vi.waitFor(() => { expect(ssh.commands('cancel')).toHaveLength(1) })

    // Then the host was told to stop, the card says cancelled, and nothing claims a verdict
    expect(ssh.commands('cancel')[0]).toContain(runId)
    expect(board.task(taskId)?.status).toBe('todo')
    const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
    expect(parsed.ok ? parsed.value.activeRun : 'missing').toBeUndefined()
    expect(parsed.ok ? parsed.value.history.map(run => run.phase) : []).toEqual(['cancelled'])
    expect(executionsOf(board.task(taskId))).toEqual([])

    // When the host is polled again
    await mounted.tick()

    // Then the cancelled run still records nothing
    expect(executionsOf(board.task(taskId))).toEqual([])
  })

  it('operator deleting a card cancels its run and removes the remote run directory', async () => {
    // Given a card whose run is under way on the host
    const { ssh, board, taskId, runId } = await runningCard()

    // When the operator deletes the card
    board.apply({ kind: 'delete', taskId })
    await vi.waitFor(() => { expect(ssh.runs.get(runId)?.removed).toBe(true) })

    // Then the run was stopped and its directory is gone from the host
    expect(ssh.commands('cancel')).toHaveLength(1)
    const removed = ssh.calls.filter(call => call.command.startsWith('rm -rf ')).map(call => call.command)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain(runId)
    expect(board.task(taskId)).toBeUndefined()
  })

  it('operator cancelling from the card surface stops the run, keeps no verdict and leaves the card in the todo column', async () => {
    // Given a card whose run is under way on the host
    const { ssh, board, mounted, taskId, runId } = await runningCard()

    // When the card surface asks for a cancel
    const reply = await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'cancel', taskId }) as { ok: boolean; runId?: string }
    await vi.waitFor(() => { expect(ssh.commands('cancel')).toHaveLength(1) })

    // Then the answer names the run and the host stopped it
    expect(reply.ok).toBe(true)
    expect(reply.runId).toBe(runId)
    expect(executionsOf(board.task(taskId))).toEqual([])

    // Then the card left the running column for the one it can be started from
    await vi.waitFor(() => { expect(board.task(taskId)?.status).toBe('todo') })
    const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
    expect(parsed.ok ? parsed.value.history.map(run => run.phase) : []).toEqual(['cancelled'])
  })

  it('operator moving a running card to the done column keeps the column the person chose', async () => {
    // Given a card whose run is under way on the host
    const { ssh, board, taskId } = await runningCard()

    // When the operator moves it to done rather than leaving it in the running column
    board.apply({ kind: 'move', taskId, status: 'done' })
    await vi.waitFor(() => { expect(ssh.commands('cancel')).toHaveLength(1) })

    // Then the run was stopped and the column stays the one the operator picked
    expect(board.task(taskId)?.status).toBe('done')
    expect(executionsOf(board.task(taskId))).toEqual([])
  })
})
